package app.runjourney.legacy

import android.content.Context
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import java.io.File

/** Fixed app-private destinations, metadata only. No schema init, purge or repair. */
internal class ActivityMetadataReader(private val context: Context) {
  fun read(kind: String, mode: String, limit: Int, offset: Int): Map<String, Any?> {
    val name = when(kind) { "running" -> "runjourney.sqlite"; "cycling" -> "runjourney-cycling.sqlite"; else -> error("LEGACY_ACTIVITY_INVALID") }
    check(mode in listOf("draft", "history")) { "LEGACY_ACTIVITY_MODE" }
    check(limit in 1..128 && offset in 0..10000000) { "LEGACY_ACTIVITY_PAGE" }
    val directory = File(context.filesDir, "SQLite")
    val file = File(directory, name)
    if (!file.exists()) return mapOf("exists" to false, "rows" to emptyList<Any>())
    check(file.isFile && file.canonicalFile.parentFile == directory.canonicalFile) { "LEGACY_ACTIVITY_PATH" }
    val db = BundledSQLiteDriver().open(file.absolutePath, SQLITE_OPEN_READONLY)
    try {
      db.prepare("BEGIN DEFERRED").use { it.step() }
      try {
        db.prepare("PRAGMA user_version").use { cursor ->
          check(cursor.step() && cursor.getLong(0) in 1..2) { "LEGACY_ACTIVITY_VERSION" }
        }
        val sql = if(mode == "draft")
          "SELECT substr(id,1,257),substr(started_at,1,65),substr(ended_at,1,65),effective_distance,effective_time FROM runs WHERE status='draft' LIMIT 2"
        else "SELECT substr(id,1,257),substr(started_at,1,65),substr(ended_at,1,65),effective_distance,effective_time FROM runs WHERE status='completed' AND trashed_at IS NULL ORDER BY started_at DESC,id ASC LIMIT ? OFFSET ?"
        val rows = mutableListOf<Map<String, Any?>>()
        db.prepare(sql).use { cursor ->
          if(mode == "history") { cursor.bindLong(1, limit.toLong()); cursor.bindLong(2, offset.toLong()) }
          while(cursor.step()) {
            val id = cursor.getText(0); val startedAt = cursor.getText(1)
            check(id.length in 1..256 && startedAt.length <= 64) { "LEGACY_ACTIVITY_HEADER" }
            val distance = cursor.getDouble(3); val duration = cursor.getDouble(4)
            check(distance.isFinite() && distance >= 0 && duration.isFinite() && duration >= 0) { "LEGACY_ACTIVITY_HEADER" }
            val endedAt = if(cursor.isNull(2)) null else cursor.getText(2)
            check(endedAt == null || endedAt.length <= 64) { "LEGACY_ACTIVITY_HEADER" }
            rows.add(mapOf("id" to id, "startedAt" to startedAt, "endedAt" to endedAt,
              "distanceMeters" to distance, "activeRunningTime" to duration))
          }
        }
        check(mode != "draft" || rows.size <= 1) { "LEGACY_ACTIVITY_DRAFT" }
        if(mode == "draft") {
          var count = 0
          db.prepare("SELECT substr(a.run_id,1,257),r.status FROM active_run a LEFT JOIN runs r ON r.id=a.run_id WHERE a.slot=1 LIMIT 2").use { cursor ->
            while(cursor.step()) {
              check(rows.size == 1 && cursor.getText(0) == rows[0]["id"] && !cursor.isNull(1) && cursor.getText(1) == "draft") { "LEGACY_ACTIVITY_DRAFT" }
              count++
            }
          }
          check(count == rows.size) { "LEGACY_ACTIVITY_DRAFT" }
        }
        return mapOf("exists" to true, "rows" to rows)
      } finally { db.prepare("ROLLBACK").use { it.step() } }
    } finally { db.close() }
  }
}
