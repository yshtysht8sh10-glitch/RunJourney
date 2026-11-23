package app.runjourney.legacy

import android.content.Context
import android.os.SystemClock
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import java.security.MessageDigest
import java.util.UUID

/** Read-only access to this application's fixed legacy database. All methods
 * run on one worker. A single AndroidX connection owns the read snapshot.
 * No source copies, checkpoints, PRAGMA changes, schema repair or writes. */
internal class LegacyStorageReader(
  private val context: Context,
  private val clock: () -> Long = { SystemClock.elapsedRealtime() },
) {
  companion object {
    const val CHUNK_CODEPOINTS = 16384
    const val MAX_KEYS = 512
    const val MAX_KEY_CODEPOINTS = 256
    const val MAX_UTF8_BYTES = 32L * 1024 * 1024
    const val SESSION_MS = 5L * 60 * 1000
  }
  private data class Entry(val key: String, val length: Int, val bytes: Long, val sha256: String = "")
  private data class Session(val token: String, val database: SQLiteConnection, val entries: Map<String, Entry>, val expiresAt: Long)
  private var session: Session? = null
  private var owner: Thread? = null

  private fun checkThread() {
    if (owner == null) owner = Thread.currentThread()
    check(owner === Thread.currentThread()) { "LEGACY_READER_THREAD" }
  }

  fun open(): Map<String, Any?> {
    checkThread(); expire()
    check(session == null) { "LEGACY_READER_BUSY" }
    val file = context.getDatabasePath("RKStorage")
    if (!file.exists()) return mapOf("applicationId" to context.packageName, "token" to null, "entries" to emptyList<Any>())
    check(file.isFile && file.canonicalFile.name == "RKStorage"
      && file.canonicalFile.parentFile == file.absoluteFile.parentFile?.canonicalFile) { "LEGACY_INVALID_PATH" }
    // SQLite may create missing runtime WAL/SHM sidecars for a WAL-mode source.
    // It alone manages those files; the app never creates, removes, truncates,
    // repairs or checkpoints them. Existing main/WAL contents stay read-only.
    // Explicit public read-only flag: no CREATE/READWRITE, no Android locale
    // metadata and no default Android corruption handler that could delete it.
    val database = BundledSQLiteDriver().open(file.absolutePath, SQLITE_OPEN_READONLY)
    var transactionStarted = false
    try {
      database.prepare("BEGIN DEFERRED").use { it.step() }
      transactionStarted = true
      val entries = linkedMapOf<String, Entry>()
      var totalBytes = 0L
      database.prepare("SELECT substr(key,1,257), length(key), typeof(key), typeof(value), length(value), length(CAST(value AS BLOB)), instr(value,char(0)) FROM catalystLocalStorage WHERE CAST(key AS TEXT) GLOB '@runjourney/*' ORDER BY key LIMIT 513").use { cursor ->
        while (cursor.step()) {
          check(entries.size < MAX_KEYS) { "LEGACY_KEY_LIMIT" }
          val key = cursor.getText(0)
          check(cursor.getText(2) == "text" && cursor.getLong(1) in 1..MAX_KEY_CODEPOINTS.toLong()
            && key.startsWith("@runjourney/") && key.codePointCount(0, key.length).toLong() == cursor.getLong(1)) { "LEGACY_INVALID_KEY" }
          check(cursor.getText(3) == "text" && !cursor.isNull(4) && !cursor.isNull(5) && cursor.getLong(6) == 0L) { "LEGACY_INVALID_VALUE_TYPE" }
          val length = cursor.getLong(4); val bytes = cursor.getLong(5)
          check(length in 0..MAX_UTF8_BYTES && bytes in 0..MAX_UTF8_BYTES) { "LEGACY_VALUE_LIMIT" }
          totalBytes += bytes
          check(totalBytes <= MAX_UTF8_BYTES && !entries.containsKey(key)) { "LEGACY_TOTAL_LIMIT" }
          entries[key] = Entry(key, length.toInt(), bytes)
        }
      }
      val verified = entries.mapValues { (_, entry) -> entry.copy(sha256 = hash(database, entry)) }
      val token = UUID.randomUUID().toString()
      session = Session(token, database, verified, clock() + SESSION_MS)
      return mapOf("applicationId" to context.packageName, "token" to token,
        "entries" to verified.values.map { mapOf("key" to it.key, "length" to it.length, "sha256" to it.sha256) })
    } catch (error: Exception) {
      try { if (transactionStarted) database.prepare("ROLLBACK").use { it.step() } } finally { database.close() }
      throw error
    }
  }

  /** Hash original SQLite UTF-8 bytes, not a re-encoded/normalised full value.
   * The bounded blob slices never load a large row into a CursorWindow. */
  private fun hash(database: SQLiteConnection, entry: Entry): String {
    val digest = MessageDigest.getInstance("SHA-256")
    var offset = 0L
    while (offset < entry.bytes) {
      database.prepare("SELECT substr(CAST(value AS BLOB),?,16384) FROM catalystLocalStorage WHERE key=?").use { cursor ->
        cursor.bindLong(1, offset + 1); cursor.bindText(2, entry.key)
        check(cursor.step()) { "LEGACY_VALUE_MISSING" }
        val bytes = cursor.getBlob(0)
        check(bytes.size.toLong() == minOf(16384L, entry.bytes - offset) && !cursor.step()) { "LEGACY_VALUE_CHANGED" }
        digest.update(bytes); offset += bytes.size
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }

  fun read(token: String, key: String, offset: Int): Map<String, Any> {
    checkThread(); expire()
    val current = session
    check(current != null && current.token == token) { "LEGACY_SESSION_INVALID" }
    val entry = current.entries[key] ?: error("LEGACY_KEY_NOT_LISTED")
    check(offset in 0..entry.length) { "LEGACY_OFFSET_INVALID" }
    current.database.prepare("SELECT substr(value,?,16384) FROM catalystLocalStorage WHERE key=?").use { cursor ->
      cursor.bindLong(1, offset.toLong() + 1); cursor.bindText(2, key)
      check(cursor.step()) { "LEGACY_VALUE_MISSING" }
      val text = cursor.getText(0)
      val count = text.codePointCount(0, text.length)
      check(count == minOf(CHUNK_CODEPOINTS, entry.length - offset) && !cursor.step()) { "LEGACY_VALUE_CHANGED" }
      val next = offset + count
      return mapOf("text" to text, "nextOffset" to next, "done" to (next == entry.length))
    }
  }

  fun close(token: String) {
    checkThread(); expire()
    val current = session ?: return
    check(current.token == token) { "LEGACY_SESSION_INVALID" }
    closeAll()
  }

  fun expire() {
    checkThread()
    if (session?.let { clock() >= it.expiresAt } == true) closeAll()
  }

  fun closeAll() {
    checkThread()
    val current = session ?: return
    session = null
    try { current.database.prepare("ROLLBACK").use { it.step() } } finally { current.database.close() }
  }
}
