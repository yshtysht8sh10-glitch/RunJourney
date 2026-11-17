package app.runjourney.announcer

import android.content.Context
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import expo.modules.kotlin.Promise

/** Sparse, bounded, Test-only lifecycle ledger. Never receives coordinates or sensor values. */
internal object DiagnosticAudit {
  private val writer = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(128))
  private val process = UUID.randomUUID().toString()
  private var log: MarkerLog? = null // writer thread only
  private var events = 0
  @Volatile var failure = ""; private set
  @Volatile var written = 0L; private set
  @Volatile var maxWriteMs = 0.0; private set
  private fun key(create: Boolean = true): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("RunJourney.Test.DiagnosticLifecycle.v36", null) as? SecretKey)?.let { return it }
    check(create) { "NO_EXISTING_AUDIT_KEY" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("RunJourney.Test.DiagnosticLifecycle.v36", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun record(c: Context, event: String, runId: String = "", session: String = "", data: JSONObject = JSONObject(), seal: Boolean = false) {
    if (c.packageName != "app.runjourney.mobile.test" || failure.isNotEmpty()) return
    val copy = JSONObject(data.toString()).put("event", event).put("runId", runId).put("sessionId", session)
      .put("processId", process).put("wallMs", System.currentTimeMillis()).put("elapsedNs", SystemClock.elapsedRealtimeNanos().toString())
    try { writer.execute {
      try {
        val started = SystemClock.elapsedRealtimeNanos()
        if (log == null) {
          val root = File(c.noBackupFilesDir, "diagnostic-lifecycle-v36")
          check((root.listFiles()?.sumOf { it.length() } ?: 0) < 10_000_000) { "AUDIT_CAPACITY" }
          log = MarkerLog(File(root, UUID.randomUUID().toString() + ".jsonl"), key())
          log!!.append("START", JSONObject().put("schema", 1).put("processId", process)); events = 0
        }
        log!!.append("EVENT", copy); events++; written++
        if (seal || events >= 1000) {
          log!!.append("END", JSONObject().put("complete", true).put("eventCount", events)); log = null
        }
        maxWriteMs = maxOf(maxWriteMs, (SystemClock.elapsedRealtimeNanos() - started) / 1e6)
      } catch (e: Exception) { failure = "AUDIT_WRITE_FAILED:" + e.javaClass.simpleName; log = null }
    } } catch (_: java.util.concurrent.RejectedExecutionException) { failure = "AUDIT_QUEUE_CAPACITY" }
  }
  /** Small last-state checkpoint, separate from RUN/settings and from the encrypted ledger. */
  fun checkpoint(c: Context, state: String, runId: String, session: String, reason: String, summary: String = "") {
    if (c.packageName != "app.runjourney.mobile.test") return
    try { writer.execute {
      if (!c.getSharedPreferences("diagnostic-lifecycle-v36", 0).edit().putString("sensorState", state)
          .putString("runId", runId).putString("session", session).putString("reason", reason).putString("summary", summary).commit()) failure = "AUDIT_CHECKPOINT_FAILED"
    } } catch (_: java.util.concurrent.RejectedExecutionException) { failure = "AUDIT_QUEUE_CAPACITY" }
  }
  fun read(c: Context, promise: Promise) {
    if (c.packageName != "app.runjourney.mobile.test") { promise.reject("TEST_ONLY", "Test only", null); return }
    try { writer.execute {
      try {
        check(!SensorDiagnostics.busy() && !RunMarkerService.active()) { "BUSY" }
        if (log != null) { log!!.append("END", JSONObject().put("complete", true).put("eventCount", events)); log = null }
        val files = File(c.noBackupFilesDir, "diagnostic-lifecycle-v36").listFiles()?.filter { it.extension == "jsonl" } ?: emptyList()
        val result = org.json.JSONArray()
        for (file in files) result.put(MarkerLog.read(file, key(false)).put("file", file.name))
        promise.resolve(JSONObject().put("files", result).put("auditFailure", failure).toString())
      } catch (e: Exception) { promise.reject("AUDIT_READ", e.message, e) }
    } } catch (e: Exception) { promise.reject("AUDIT_BUSY", e.message, e) }
  }
}
