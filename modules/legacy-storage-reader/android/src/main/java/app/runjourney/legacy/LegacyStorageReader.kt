package app.runjourney.legacy

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.os.Build
import android.os.SystemClock
import java.security.MessageDigest
import java.util.UUID
import java.io.File

/** Read-only access to this application's fixed legacy database. All methods
 * must run on one worker: Android's SQLite transaction ownership is per-thread.
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
  private data class Session(val token: String, val database: SQLiteDatabase, val entries: Map<String, Entry>, val expiresAt: Long)
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
    // Older Android cannot establish a public, thread-pinned DEFERRED read
    // transaction on a read-only handle. Never weaken snapshot consistency or
    // upgrade the source to writable just to support an older OS.
    check(Build.VERSION.SDK_INT >= 35) { "LEGACY_READ_TRANSACTION_UNSUPPORTED" }
    check(file.isFile && file.canonicalFile.name == "RKStorage"
      && file.canonicalFile.parentFile == file.absoluteFile.parentFile?.canonicalFile) { "LEGACY_INVALID_PATH" }
    // Do not let SQLite create a missing shared-memory WAL index beside the
    // original source. Existing read marks are SQLite-managed runtime state.
    check(!File(file.path + "-wal").exists() || File(file.path + "-shm").isFile) { "LEGACY_WAL_INDEX_MISSING" }
    // Android's default corruption handler may DELETE the source database.
    // Override it even for a read-only handle; corruption must only fail closed.
    val database = SQLiteDatabase.openDatabase(file.absolutePath, null,
      SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
      { throw SQLiteDatabaseCorruptException("LEGACY_DATABASE_CORRUPT") })
    try {
      check(database.isReadOnly) { "LEGACY_NOT_READ_ONLY" }
      database.beginTransactionReadOnly()
      val entries = linkedMapOf<String, Entry>()
      var totalBytes = 0L
      database.rawQuery("SELECT substr(key,1,257), length(key), typeof(key), typeof(value), length(value), length(CAST(value AS BLOB)), instr(value,char(0)) FROM catalystLocalStorage WHERE CAST(key AS TEXT) GLOB '@runjourney/*' ORDER BY key LIMIT 513", null).use { cursor ->
        while (cursor.moveToNext()) {
          check(entries.size < MAX_KEYS) { "LEGACY_KEY_LIMIT" }
          val key = cursor.getString(0)
          check(cursor.getString(2) == "text" && cursor.getLong(1) in 1..MAX_KEY_CODEPOINTS.toLong()
            && key.startsWith("@runjourney/") && key.codePointCount(0, key.length) == cursor.getInt(1)) { "LEGACY_INVALID_KEY" }
          check(cursor.getString(3) == "text" && !cursor.isNull(4) && !cursor.isNull(5) && cursor.getLong(6) == 0L) { "LEGACY_INVALID_VALUE_TYPE" }
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
      try { if (database.inTransaction()) database.endTransaction() } finally { database.close() }
      throw error
    }
  }

  /** Hash original SQLite UTF-8 bytes, not a re-encoded/normalised full value.
   * The bounded blob slices never load a large row into a CursorWindow. */
  private fun hash(database: SQLiteDatabase, entry: Entry): String {
    val digest = MessageDigest.getInstance("SHA-256")
    var offset = 0L
    while (offset < entry.bytes) {
      database.rawQuery("SELECT substr(CAST(value AS BLOB),?,16384) FROM catalystLocalStorage WHERE key=?", arrayOf((offset + 1).toString(), entry.key)).use { cursor ->
        check(cursor.moveToFirst()) { "LEGACY_VALUE_MISSING" }
        val bytes = cursor.getBlob(0)
        check(bytes.size.toLong() == minOf(16384L, entry.bytes - offset) && !cursor.moveToNext()) { "LEGACY_VALUE_CHANGED" }
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
    current.database.rawQuery("SELECT substr(value,?,16384) FROM catalystLocalStorage WHERE key=?", arrayOf((offset + 1).toString(), key)).use { cursor ->
      check(cursor.moveToFirst()) { "LEGACY_VALUE_MISSING" }
      val text = cursor.getString(0)
      val count = text.codePointCount(0, text.length)
      check(count == minOf(CHUNK_CODEPOINTS, entry.length - offset) && !cursor.moveToNext()) { "LEGACY_VALUE_CHANGED" }
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
    try { current.database.endTransaction() } finally { current.database.close() }
  }
}
