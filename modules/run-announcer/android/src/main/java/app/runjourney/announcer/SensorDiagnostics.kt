package app.runjourney.announcer

import android.content.Context
import android.hardware.*
import android.os.*
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import org.json.JSONArray
import java.io.*
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Diagnostic-only actor. No dependency on detector, SQLite, speech or MediaSession. */
internal object SensorDiagnostics : SensorEventListener {
  private const val PACKAGE = "app.runjourney.mobile.test"
  private const val ALIAS = "RunJourney.Test.SensorDiagnostics.v1"
  private val thread = HandlerThread("sensor-diagnostic-events").apply { start() }
  private val handler = Handler(thread.looper)
  private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(256))
  private val pendingBytes = AtomicLong()
  @Volatile private var state = "OFF"
  @Volatile private var failure = ""
  @Volatile private var runId = ""
  @Volatile private var mode = ""
  private var context: Context? = null
  private var manager: SensorManager? = null
  private var log: SensorJournal? = null // writer thread only
  @Volatile private var writerFailed = false
  @Volatile private var failNextWrite = false
  private var position = ""
  private var sensorsEnabled = true
  private var session = ""
  private var captureStarted = 0L
  private var deadline = 0L
  private var gpsCount = 0L
  private var missingGpsClock = 0L
  private var maxClockRoundTrip = 0L
  private var labelCount = 0
  private var lastGpsMono = 0L
  private var gpsReversals = 0L
  private var maxEpochResidualMs = 0.0
  private var maxAnchorUncertaintyMs = 0.0
  private var cpuStarted = 0L
  private var sampleWritten = 0L // writer thread only
  @Volatile private var maxWriteMs = 0.0
  @Volatile private var maxSyncMs = 0.0
  @Volatile private var storedBytes = 0L
  private var ticks = 0
  private val timings = mutableMapOf<Int, SensorTiming>()
  private val buffers = mutableMapOf<Int, ByteArrayOutputStream>()
  private val blockCounts = mutableMapOf<Int, Int>()
  private val blockStarted = mutableMapOf<Int, Long>()
  private val conditions = listOf("STILL", "LEG_SWING", "BOUNCE", "WALK", "RUNNING_UTURN", "RUNNING_UTURN", "WALK", "BOUNCE", "LEG_SWING", "STILL")
  fun allowed(c: Context) = c.packageName == PACKAGE
  fun recording() = state == "RECORDING" && mode == "RUN" && sensorsEnabled
  private fun clockPatch(): Boolean = try {
    Class.forName("expo.modules.location.records.LocationResponse").declaredFields.any { it.name == "diagnosticElapsedNanos" }
  } catch (_: Exception) { false }
  private fun root(c: Context) = File(c.noBackupFilesDir, "sensor-diagnostic-v1")
  private fun key(create: Boolean): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    check(create) { "NO_KEY" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true).build())
    }.generateKey()
  }
  fun control(c: Context, action: String, value: String): Boolean {
    if (!allowed(c)) return false
    if (action in listOf("arm", "armMetrics")) {
      if (state in listOf("STARTING", "RECORDING", "CLOSING")) return false
      if (value !in listOf("WAIST_POUCH", "POCKET", "HAND", "ARM", "OTHER")) return false
      if (!clockPatch()) { failure = "GPS_CLOCK_PATCH_UNAVAILABLE"; state = "UNAVAILABLE"; return false }
      sensorsEnabled = action == "arm"; position = value; state = "ARMED"; failure = ""; return true
    }
    if (action == "off") { if (state == "ARMED") state = "OFF" else handler.post { finish("USER_ENDED", true) }; return true }
    if (action == "begin") { handler.post { if (state == "ARMED") begin(c.applicationContext, value, "RUN", 95 * 60_000L) }; return true }
    // Foreground desk collection, not a RUN and not a screen-OFF guarantee.
    if (action == "bench") {
      if (state in listOf("STARTING", "RECORDING", "CLOSING")) return false
      sensorsEnabled = true; position = "DESK"; state = "ARMED"
      handler.post { begin(c.applicationContext, "bench-" + UUID.randomUUID(), "DESK", 60_000L) }; return true
    }
    if (action == "endRun") { handler.post { if (runId == value) finish("RUN_FINISH", true) }; return true }
    if (action == "gpsEnded") { handler.post { if (mode == "RUN" && runId == value) finish("GPS_DIAGNOSTIC_ENDED", true) }; return true }
    if (action == "gpsFailed") { handler.post { if (mode == "RUN" && runId == value) finish("GPS_DIAGNOSTIC_FAILED", false) }; return true }
    if (action == "testWriteFailure") {
      if (state != "RECORDING") return false
      failNextWrite = true; return true
    }
    return false
  }
  private fun begin(c: Context, id: String, captureMode: String, limitMs: Long) {
    if (state != "ARMED" || id.isBlank()) return
    state = "STARTING"; context = c; runId = id; mode = captureMode; failure = ""; writerFailed = false; failNextWrite = false
    session = UUID.randomUUID().toString(); gpsCount = 0; missingGpsClock = 0; labelCount = 0; captureStarted = SystemClock.elapsedRealtime()
    lastGpsMono = 0; gpsReversals = 0; maxClockRoundTrip = 0; sampleWritten = 0; maxWriteMs = 0.0
    maxEpochResidualMs = 0.0; maxAnchorUncertaintyMs = 0.0; cpuStarted = android.os.Process.getElapsedCpuTime(); maxSyncMs = 0.0; ticks = 0; storedBytes = 0
    timings.clear(); buffers.clear(); blockCounts.clear(); blockStarted.clear()
    manager = c.getSystemService(SensorManager::class.java)
    val sensors = listOf(1, 4).map { manager?.getDefaultSensor(it) }
    if (sensors.any { it == null }) { state = "UNAVAILABLE"; failure = "SENSOR_MISSING"; return }
    val metadata = JSONArray(sensors.map { sensor -> sensor!!; JSONObject().put("type", sensor.type).put("name", sensor.name)
      .put("vendor", sensor.vendor).put("unit", if (sensor.type == 1) "m/s2_gravity_included" else "rad/s")
      .put("minDelayUs", sensor.minDelay).put("fifoMax", sensor.fifoMaxEventCount).put("fifoReserved", sensor.fifoReservedEventCount)
      .put("powerMaReported", sensor.power.toDouble()).put("wakeUp", sensor.isWakeUpSensor) })
    val file = File(root(c), "$session.sdiag")
    val start = stamp().put("schema", 1).put("runId", id).put("mode", mode).put("position", position)
      .put("sensors", metadata).put("requestedHz", if (sensorsEnabled) 25 else 0).put("reportLatencyUs", if (sensorsEnabled) 1_000_000 else 0)
      .put("algorithmApplied", false).put("clockBasis", "ANDROID_ELAPSED_REALTIME_NANOS")
      .put("sensorsEnabled", sensorsEnabled)
      .put("processCpuStartMs", cpuStarted).put("battery", battery())
    worker.execute {
      try {
        check(c.filesDir.usableSpace >= 100L * 1024 * 1024) { "LOW_STORAGE" }
        log = SensorJournal(file, key(true)); log!!.json("START", start); log!!.sync(); storedBytes = file.length()
        c.getSharedPreferences("sensor-diagnostic-v1", 0).edit().putString("last", file.name).apply()
        handler.post {
          if (state != "STARTING") { finish("START_CANCELLED", false); return@post }
          captureStarted = SystemClock.elapsedRealtime(); deadline = captureStarted + limitMs
          for (sensor in if (sensorsEnabled) sensors else emptyList()) {
            timings[sensor!!.type] = SensorTiming()
            if (manager?.registerListener(this, sensor, 40_000, 1_000_000, handler) != true) {
              finish("REGISTER_FAILED", false); return@post
            }
          }
          state = "RECORDING"; json("CAPTURE_BEGIN", stamp()); handler.post(tick)
        }
      } catch (e: Exception) { failure = e.javaClass.simpleName + ":" + (e.message ?: ""); writerFailed = true; handler.post { finish("START_FAILED", false) } }
    }
  }
  private fun stamp(): JSONObject {
    val before = SystemClock.elapsedRealtimeNanos(); val wall = System.currentTimeMillis(); val after = SystemClock.elapsedRealtimeNanos()
    return JSONObject().put("wallMs", wall).put("elapsedBeforeNs", before.toString()).put("elapsedAfterNs", after.toString())
  }
  private fun offer(kind: String, payload: ByteArray, sampleCount: Int = 0) {
    val queuedAt = SystemClock.elapsedRealtime()
    if (pendingBytes.addAndGet(payload.size.toLong()) > 512 * 1024) { pendingBytes.addAndGet(-payload.size.toLong()); finish("QUEUE_CAPACITY", false); return }
    try { worker.execute {
      try {
        if (!writerFailed) {
          if (failNextWrite) { failNextWrite = false; throw IOException("SYNTHETIC_WRITE_FAILURE") }
          check(SystemClock.elapsedRealtime() - queuedAt <= 10_000) { "WRITER_LAG" }
          val before = SystemClock.elapsedRealtimeNanos()
          log!!.append(kind, payload); sampleWritten += sampleCount
          storedBytes = log!!.file.length()
          maxWriteMs = maxOf(maxWriteMs, (SystemClock.elapsedRealtimeNanos() - before) / 1e6)
        }
      } catch (e: Exception) { writerFailed = true; failure = e.javaClass.simpleName + ":" + (e.message ?: ""); handler.post { finish("WRITE_FAILED", false) } }
      finally { pendingBytes.addAndGet(-payload.size.toLong()) }
    } } catch (_: java.util.concurrent.RejectedExecutionException) {
      pendingBytes.addAndGet(-payload.size.toLong()); finish("QUEUE_CAPACITY", false)
    }
  }
  private fun json(kind: String, data: JSONObject) = offer(kind, data.toString().toByteArray(Charsets.UTF_8))
  override fun onSensorChanged(event: SensorEvent) {
    if (state != "RECORDING") return
    val received = SystemClock.elapsedRealtimeNanos(); val type = event.sensor.type
    timings[type]?.observe(event.timestamp, received)
    val buffer = buffers.getOrPut(type) { ByteArrayOutputStream() }
    DataOutputStream(buffer).apply { writeLong(event.timestamp); writeLong(received); writeFloat(event.values[0]); writeFloat(event.values[1]); writeFloat(event.values[2]); writeInt(event.accuracy) }
    blockCounts[type] = (blockCounts[type] ?: 0) + 1
    blockStarted.putIfAbsent(type, received)
    if (received - blockStarted.getValue(type) >= 1_000_000_000 || blockCounts.getValue(type) >= 1024) flush(type)
  }
  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* Per-sample accuracy is retained. */ }
  private fun flush(type: Int) {
    val count = blockCounts[type] ?: 0; if (count == 0) return
    val bytes = ByteArrayOutputStream(); DataOutputStream(bytes).use { it.writeInt(type); it.writeInt(count); it.write(buffers.getValue(type).toByteArray()) }
    buffers.remove(type); blockCounts.remove(type); blockStarted.remove(type)
    offer("SAMPLES", bytes.toByteArray(), count)
  }
  private val tick = object : Runnable {
    override fun run() {
      if (state != "RECORDING") return
      if (SystemClock.elapsedRealtime() >= deadline) { finish("CAPTURE_LIMIT", true); return }
      for (type in listOf(1, 4)) flush(type)
      if (Build.VERSION.SDK_INT >= 29 && (context?.getSystemService(PowerManager::class.java)?.currentThermalStatus ?: 0) >= PowerManager.THERMAL_STATUS_SEVERE) { finish("THERMAL_LIMIT", true); return }
      if (ticks++ % 5 == 0) {
        val currentBattery = battery()
        if (currentBattery.optInt("level", -1) in 0..15) { finish("LOW_BATTERY", true); return }
        json("HEALTH", snapshot().put("clock", stamp()).put("processCpuMs", android.os.Process.getElapsedCpuTime() - cpuStarted)
          .put("pssKb", Debug.getPss()).put("battery", currentBattery))
      }
      try { worker.execute { try { if (!writerFailed) { val start = SystemClock.elapsedRealtimeNanos(); log?.sync(); maxSyncMs = maxOf(maxSyncMs, (SystemClock.elapsedRealtimeNanos() - start) / 1e6) } } catch (_: Exception) { writerFailed = true; handler.post { finish("SYNC_FAILED", false) } } } }
      catch (_: java.util.concurrent.RejectedExecutionException) { finish("QUEUE_CAPACITY", false) }
      handler.postDelayed(this, 2000)
    }
  }
  fun gps(c: Context, payload: String) {
    if (!allowed(c) || state !in listOf("STARTING", "RECORDING")) return
    val received = SystemClock.elapsedRealtimeNanos()
    // The bridge never blocks normal GPS ingestion waiting for the diagnostic actor.
    handler.post {
      if (state != "RECORDING") return@post
      try {
        val data = JSONObject(payload); if (data.getString("runId") != runId) return@post
        val mono = data.optString("fixElapsedNs").toLongOrNull()
        val serialized = data.optString("serializedElapsedNs").toLongOrNull()
        if (mono == null || serialized == null || mono > serialized || serialized > received) {
          missingGpsClock++; finish("GPS_CLOCK_INVALID", false); return@post
        }
        if (lastGpsMono > 0 && mono <= lastGpsMono) gpsReversals++
        lastGpsMono = mono; gpsCount++
        data.put("bridgeReceivedElapsedNs", received.toString())
        val clock = stamp()
        val before = clock.getString("elapsedBeforeNs").toLong(); val after = clock.getString("elapsedAfterNs").toLong()
        val residual = (data.getDouble("epochMs") - mono / 1e6) - (clock.getLong("wallMs") - (before / 2.0 + after / 2.0) / 1e6)
        maxEpochResidualMs = maxOf(maxEpochResidualMs, kotlin.math.abs(residual))
        maxAnchorUncertaintyMs = maxOf(maxAnchorUncertaintyMs, (after - before) / 2e6 + .5)
        data.put("epochResidualMs", residual).put("anchor", clock)
        maxClockRoundTrip = maxOf(maxClockRoundTrip, received - serialized)
        json("GPS", data)
      } catch (_: Exception) { missingGpsClock++; finish("GPS_CLOCK_INVALID", false) }
    }
  }
  /** Independent experimental interval labels, never STOP/RESUME detector commands. */
  fun marker(c: Context, data: JSONObject) {
    if (!allowed(c) || state != "RECORDING" || mode != "RUN") return
    val copy = JSONObject(data.toString())
    handler.post {
      if (state != "RECORDING" || labelCount >= conditions.size * 2) return@post
      val trial = labelCount / 2
      copy.put("trial", trial + 1).put("condition", conditions[trial]).put("boundary", if (labelCount % 2 == 0) "BEGIN" else "END")
        .put("physicalTruth", "USER_REPORTED_WITH_REACTION_AND_BLUETOOTH_UNCERTAINTY")
      labelCount++; json("LABEL", copy)
    }
  }
  private fun snapshot(): JSONObject = JSONObject().put("state", state).put("mode", mode).put("runId", runId)
    .put("position", position).put("failure", failure).put("sensorsEnabled", sensorsEnabled).put("requestedHz", if (sensorsEnabled) 25 else 0).put("gpsLinks", gpsCount)
    .put("missingGpsClock", missingGpsClock).put("gpsTimestampReversals", gpsReversals)
    .put("maxSerializeToBridgeMs", maxClockRoundTrip / 1e6).put("labelBoundaries", labelCount)
    .put("maxGpsEpochResidualMs", maxEpochResidualMs).put("maxWallAnchorUncertaintyMs", maxAnchorUncertaintyMs)
    .put("pendingBytes", pendingBytes.get()).put("maxFrameWriteMs", maxWriteMs).put("maxFsyncMs", maxSyncMs)
    .put("storedBytes", storedBytes).put("sessionLimitBytes", 16 * 1024 * 1024)
    .put("accel", timings[1]?.json(SystemClock.elapsedRealtimeNanos(), captureStarted * 1_000_000) ?: JSONObject.NULL)
    .put("gyro", timings[4]?.json(SystemClock.elapsedRealtimeNanos(), captureStarted * 1_000_000) ?: JSONObject.NULL)
    .put("clockPatch", clockPatch()).put("nextCondition", conditions.getOrNull(labelCount / 2) ?: "COMPLETE")
  fun stats(c: Context): String {
    if (!allowed(c)) return "{\"state\":\"UNAVAILABLE\"}"
    // UI is a bounded asynchronous snapshot: no sensor/raw samples cross to JS.
    return cached.also { handler.post { cached = snapshot().toString() } }
  }
  @Volatile private var cached = "{\"state\":\"OFF\"}"
  private fun battery(): JSONObject {
    val c = context ?: return JSONObject()
    val intent = c.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
    val charge = c.getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
    val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    return JSONObject().put("chargeCounterUah", if (charge != Int.MIN_VALUE) charge else JSONObject.NULL)
      .put("level", if (level >= 0 && scale > 0) level * 100.0 / scale else JSONObject.NULL)
      .put("temperatureDeciC", if (intent?.hasExtra(BatteryManager.EXTRA_TEMPERATURE) == true) intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) else JSONObject.NULL)
      .put("plugged", if (intent?.hasExtra(BatteryManager.EXTRA_PLUGGED) == true) intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) else JSONObject.NULL)
  }
  private fun finish(reason: String, complete: Boolean) {
    if (state !in listOf("STARTING", "RECORDING")) return
    state = "CLOSING"; manager?.unregisterListener(this); handler.removeCallbacks(tick)
    for (type in listOf(1, 4)) flush(type)
    val final = snapshot().put("reason", reason).put("complete", complete && missingGpsClock == 0L)
      .put("labelProtocolComplete", labelCount == conditions.size * 2)
      .put("processCpuMs", android.os.Process.getElapsedCpuTime() - cpuStarted).put("battery", battery())
      .put("clock", stamp()).put("captureElapsedMs", SystemClock.elapsedRealtime() - captureStarted)
    // Reserved queue slot is not guaranteed; retry sealing after queued frames drain.
    fun seal() {
      try { worker.execute {
        try {
          final.put("sampleCount", sampleWritten).put("complete", final.getBoolean("complete") && !writerFailed)
          log?.json("END", final); log?.close(); log = null
          state = if (final.getBoolean("complete")) "SEALED" else "INCOMPLETE"
        } catch (_: Exception) { state = "INCOMPLETE"; try { log?.close() } catch (_: Exception) { }; log = null }
        cached = final.put("state", state).toString()
      } } catch (_: java.util.concurrent.RejectedExecutionException) { handler.postDelayed({ seal() }, 50) }
    }
    seal()
  }
  fun read(c: Context): String {
    check(allowed(c)); check(state !in listOf("STARTING", "RECORDING", "CLOSING")) { "BUSY" }
    val name = c.getSharedPreferences("sensor-diagnostic-v1", 0).getString("last", "") ?: ""
    check(name.matches(Regex("[0-9a-f-]{36}\\.sdiag"))) { "NO_RECORD" }
    return SensorJournal.verify(File(root(c), name), key(false)).toString()
  }
}
