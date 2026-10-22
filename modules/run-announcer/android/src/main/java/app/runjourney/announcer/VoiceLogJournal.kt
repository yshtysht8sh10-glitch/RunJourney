package app.runjourney.announcer

import java.io.File
import java.io.RandomAccessFile
import java.util.ArrayDeque

/** Append-only bounded chunks. Call only on the single voice-log worker. No Android dependency. */
internal class VoiceLogJournal(private val directory: File,
  private val maxBytes: Long = 20_000_000, private val maxCount: Int = 20_000,
  private val chunkBytes: Int = 256_000, private val retentionMs: Long = 7L * 86400000) {
  companion object {
    fun migrateLegacy(target: File, entries: () -> List<Pair<Long, String>>, now: Long) {
      if (target.exists()) return
      val staging = File(target.parentFile, target.name + "-migration")
      if (staging.exists()) check(staging.deleteRecursively())
      val migrated = VoiceLogJournal(staging)
      entries().forEach { (at, payload) -> migrated.append(payload, at, now) }
      check(staging.renameTo(target)) { "Voice migration rename failed" }
    }
  }
  private data class Chunk(val file: File, var bytes: Long, var count: Int, var lastAt: Long)
  private val chunks = ArrayDeque<Chunk>()
  private var nextId = 0L
  init {
    check(directory.isDirectory || directory.mkdirs()) { "Cannot create voice journal" }
    directory.listFiles()?.filter { it.name.endsWith(".ndjson") }?.sortedBy { it.name }?.forEach { file ->
      // A killed process may leave an incomplete last record. Retain complete lines only.
      RandomAccessFile(file, "rw").use { f ->
        var end = f.length()
        while (end > 0) { f.seek(end - 1); if (f.read() == 10) break; end-- }
        if (end != f.length()) f.setLength(end)
      }
      var count = 0; var lastAt = 0L
      file.bufferedReader(Charsets.UTF_8).useLines { lines -> lines.forEach { line ->
        val at = line.substringBefore('\t').toLongOrNull()
        if (at != null && line.contains('\t')) { count++; lastAt = maxOf(lastAt, at) }
      } }
      chunks.add(Chunk(file, file.length(), count, lastAt))
      nextId = maxOf(nextId, (file.nameWithoutExtension.toLongOrNull() ?: 0) + 1)
    }
  }
  fun append(payload: String, timestamp: Long, now: Long = timestamp) {
    require(!payload.contains('\n') && !payload.contains('\r')) { "Voice payload must be compact JSON" }
    if (timestamp < now - retentionMs) return
    val bytes = "$timestamp\t$payload\n".toByteArray(Charsets.UTF_8)
    require(bytes.size <= chunkBytes && bytes.size <= maxBytes) { "Voice record too large" }
    var tail = chunks.peekLast()
    if (tail == null || tail.bytes + bytes.size > chunkBytes) {
      val file = File(directory, "%020d.ndjson".format(java.util.Locale.ROOT, nextId++))
      check(file.createNewFile()) { "Voice chunk already exists" }
      tail = Chunk(file, 0, 0, timestamp); chunks.add(tail)
    }
    try { tail.file.appendBytes(bytes) }
    catch (e: Exception) {
      try { RandomAccessFile(tail.file, "rw").use { it.setLength(tail.bytes) } }
      catch (rollback: Exception) { e.addSuppressed(rollback) }
      throw e
    }
    tail.bytes += bytes.size; tail.count++; tail.lastAt = maxOf(tail.lastAt, timestamp)
    prune(now)
  }
  private fun prune(now: Long) {
    var bytes = chunks.sumOf { it.bytes }; var count = chunks.sumOf { it.count }
    while (chunks.isNotEmpty() && (bytes > maxBytes || count > maxCount || chunks.first.lastAt < now - retentionMs)) {
      val chunk = chunks.first
      check(chunk.file.delete()) { "Cannot prune voice chunk" }
      chunks.removeFirst(); bytes -= chunk.bytes; count -= chunk.count
    }
  }
  fun read(limit: Int, now: Long): String {
    prune(now)
    val retained = ArrayDeque<String>()
    // Preview reads only the latest chunks, rather than loading the whole 20MB journal.
    var remaining = limit.coerceIn(1, maxCount)
    for (chunk in chunks.toList().asReversed()) {
      val part = ArrayDeque<String>()
      chunk.file.bufferedReader(Charsets.UTF_8).useLines { lines -> lines.forEach { line ->
        val separator = line.indexOf('\t'); if (separator < 0) return@forEach
        val at = line.substring(0, separator).toLongOrNull() ?: return@forEach
        if (at >= now - retentionMs) {
          part.add(line.substring(separator + 1)); if (part.size > remaining) part.removeFirst()
        }
      } }
      val reverse = part.descendingIterator()
      while (reverse.hasNext()) retained.addFirst(reverse.next())
      remaining -= part.size
      if (remaining <= 0) break
    }
    return retained.joinToString(",", "[", "]")
  }
}
