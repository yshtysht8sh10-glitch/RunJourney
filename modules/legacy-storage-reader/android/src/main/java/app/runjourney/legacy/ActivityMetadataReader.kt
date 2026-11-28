package app.runjourney.legacy

import android.content.Context
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import androidx.sqlite.driver.bundled.SQLITE_OPEN_READONLY
import java.io.File

/** Fixed app-private destinations, metadata only. No schema init, purge or repair. */
internal class ActivityMetadataReader(private val context: Context) {
  // Zone-bearing ISO values are absolute. Zone-less datetimes use device local
  // time; date-only values follow JS's UTC date convention. Unsupported legacy
  // strings are rejected visibly, never rewritten or silently coerced to epoch zero.
  private fun instant(column: String) = "CASE WHEN length($column)=10 OR $column GLOB '*Z' OR $column GLOB '*z' OR substr($column,-6,1) IN ('+','-') THEN julianday($column) ELSE julianday($column,'utc') END"
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
        val startInstant = instant("started_at"); val endInstant = instant("ended_at")
        val columns = "substr(id,1,257),substr(started_at,1,65),substr(ended_at,1,65),effective_distance,effective_time,typeof(id),typeof(started_at),typeof(ended_at),typeof(effective_distance),typeof(effective_time),$startInstant,$endInstant"
        val sql = if(mode == "draft") "SELECT $columns FROM runs WHERE status='draft' LIMIT 2"
        else "SELECT $columns FROM runs WHERE status='completed' AND trashed_at IS NULL ORDER BY ($startInstant IS NOT NULL) ASC,$startInstant DESC,id ASC LIMIT ? OFFSET ?"
        val rows = mutableListOf<Map<String, Any?>>()
        db.prepare(sql).use { cursor ->
          if(mode == "history") { cursor.bindLong(1, limit.toLong()); cursor.bindLong(2, offset.toLong()) }
          while(cursor.step()) {
            check(cursor.getText(5) == "text" && cursor.getText(6) == "text"
              && cursor.getText(7) in listOf("text", "null")
              && cursor.getText(8) in listOf("real", "integer") && cursor.getText(9) in listOf("real", "integer")) { "LEGACY_ACTIVITY_HEADER_TYPE" }
            val id = cursor.getText(0); val startedAt = cursor.getText(1)
            check(id.length in 1..256 && id.isNotBlank() && startedAt.length in 1..64) { "LEGACY_ACTIVITY_HEADER" }
            val distance = cursor.getDouble(3); val duration = cursor.getDouble(4)
            check(distance.isFinite() && distance >= 0 && duration.isFinite() && duration >= 0) { "LEGACY_ACTIVITY_HEADER" }
            val endedAt = if(cursor.isNull(2)) null else cursor.getText(2)
            check(endedAt == null || endedAt.length <= 64) { "LEGACY_ACTIVITY_HEADER" }
            if(mode == "history") {
              check(endedAt != null && !cursor.isNull(10) && !cursor.isNull(11)
                && cursor.getDouble(10) >= 2440587.5 && cursor.getDouble(11) >= cursor.getDouble(10)) { "LEGACY_ACTIVITY_HEADER_DATE" }
            }
            rows.add(mapOf("id" to id, "startedAt" to startedAt, "endedAt" to endedAt,
              "distanceMeters" to distance, "activeRunningTime" to duration))
          }
        }
        check(mode != "draft" || rows.size <= 1) { "LEGACY_ACTIVITY_DRAFT" }
        if(mode == "draft") {
          var count = 0
          db.prepare("SELECT substr(a.run_id,1,257),r.status,a.slot,typeof(a.slot) FROM active_run a LEFT JOIN runs r ON r.id=a.run_id LIMIT 3").use { cursor ->
            while(cursor.step()) {
              check(count == 0 && rows.size == 1 && cursor.getText(0) == rows[0]["id"] && !cursor.isNull(1) && cursor.getText(1) == "draft"
                && cursor.getText(3) == "integer" && cursor.getLong(2) == 1L) { "LEGACY_ACTIVITY_DRAFT" }
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
