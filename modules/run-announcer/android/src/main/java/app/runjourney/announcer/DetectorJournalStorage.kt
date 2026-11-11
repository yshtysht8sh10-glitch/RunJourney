package app.runjourney.announcer

import android.content.Context
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import java.util.concurrent.ArrayBlockingQueue
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Raw GPS is confined to this no-backup encrypted store. Never log payloads/errors. */
internal object DetectorJournalStorage {
  const val BUFFER_BYTES = 2 * 1024 * 1024
  const val BUFFER_RECORDS = 2048
  const val SEGMENT_BYTES = 8L * 1024 * 1024
  const val SESSION_BYTES = 64L * 1024 * 1024
  const val TOTAL_BYTES = 256L * 1024 * 1024
  const val RETENTION_MS = 7L * 86400000
  private const val ALIAS = "runjourney.detector-journal.v1"
  private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "detector-journal").apply { isDaemon = true } }
  private val lock = Any()
  private var cursor: Pair<String, Reader>? = null
  private fun closeReader() {
    val reader = cursor?.second
    cursor = null
    reader?.close()
  }

  private var active: Journal? = null
  private var lastJournal: Journal? = null
  private var failureCode=""
  private var accepting = false
  private var draining = false
  private val budget = JournalBufferBudget(BUFFER_BYTES, BUFFER_RECORDS)
  private var generation = 0L
  private val writeTimes=JournalTiming()
  private val queueTimes=JournalTiming()
  private var acceptedCount=0L
  private var rejectedCount=0L
  private var maxPendingBytes=0
  private var maxPendingCount=0
  fun stats(context: Context): String {
    root(context) // Same exact Test package gate; no payload or location leaves here.
    val secret=key()
    return synchronized(lock) { JSONObject().put("writtenInputs",lastJournal?.inputCount?:0).put("failureCode",failureCode).put("accepted",acceptedCount).put("rejected",rejectedCount)
      .put("pendingBytes",budget.bytes).put("pendingCount",budget.count).put("maxPendingBytes",maxPendingBytes).put("maxPendingCount",maxPendingCount)
      .put("recordBytes",lastJournal?.recordBytes()).put("writeMs",writeTimes.json()).put("queueMs",queueTimes.json())
      .put("keyClass",secret.javaClass.simpleName).put("keyExportable",secret.encoded!=null).toString() }
  }
  private data class Pending(val payload: ByteArray, val wall: Long, val mono: Long) { val size get() = payload.size }
  private val queue = ArrayBlockingQueue<Pending>(BUFFER_RECORDS)

  internal fun root(context: Context): File {
    check(context.packageName == "app.runjourney.mobile.test") { "Test only" }
    return File(context.noBackupFilesDir, "detector-journal-v1").apply { check(exists() || mkdirs()) }
  }
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generateKey()
    }
  }
  private fun used(root: File) = root.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  fun open(context: Context): String = worker.submit<String> {
    val root = root(context)
    synchronized(lock) { check(active == null && !accepting && budget.count == 0) { "Capture busy" } }
    closeReader()
    check(used(root) + 128 < TOTAL_BYTES) { "Capacity" }
    val journal = Journal(root, UUID.randomUUID().toString(), key())
    synchronized(lock) { active = journal;lastJournal=journal;failureCode=""; accepting = true; generation++
      acceptedCount=0;rejectedCount=0;maxPendingBytes=0;maxPendingCount=0;writeTimes.clear();queueTimes.clear() }
    journal.id
  }.get()

  /** No disk/encryption/wait here. Capacity includes the record currently being written. */
  fun offer(payload: String): Boolean {
    val encoded = payload.toByteArray(Charsets.UTF_8)
    val size = encoded.size
    synchronized(lock) {
      if (!accepting) {rejectedCount++;return false}
      if (!budget.reserve(size)) {
        rejectedCount++;failureCode="BUFFER_LIMIT";accepting = false
        active?.failed = true
        return false
      }
      val pending = Pending(encoded, System.currentTimeMillis(), SystemClock.elapsedRealtime())
      if (!queue.offer(pending)) { budget.release(size); rejectedCount++;failureCode="QUEUE_LIMIT";accepting = false; active?.failed = true; return false }
      // One drain task per generation; scheduling a task per GPS record is unbounded.
      acceptedCount++;maxPendingBytes=maxOf(maxPendingBytes,budget.bytes);maxPendingCount=maxOf(maxPendingCount,budget.count)
      if (!draining) { draining = true; worker.execute { drain() } }
      return true
    }
  }
  private fun drain() {
    while (true) {
      val pending = synchronized(lock) { queue.poll().also { if (it == null) draining = false } } ?: return
      val journal = synchronized(lock) { active }
      val started=SystemClock.elapsedRealtimeNanos()
      val attempted=journal!=null && !journal.failed
      try { if (attempted && journal != null) journal.append(String(pending.payload, Charsets.UTF_8), pending.wall, pending.mono) }
      catch (e: Exception) { synchronized(lock) { accepting = false;failureCode=if(e.message=="Capacity")"CAPACITY" else "WRITE_OR_CRYPTO"; journal?.failed = true } }
      synchronized(lock) { if(attempted)writeTimes.add((SystemClock.elapsedRealtimeNanos()-started)/1000000.0);queueTimes.add((started/1000000.0-pending.mono).coerceAtLeast(0.0));budget.release(pending.size) }
    }
  }
  fun stop() {
    val token = synchronized(lock) { accepting = false; generation }
    worker.execute {
      drain()
      synchronized(lock) {
        if (token == generation) {
          try { active?.seal() } catch (_: Exception) { /* CAPTURING remains incomplete */ }
          active = null
        }
      }
    }
  }
  fun list(context: Context): String = worker.submit<String> {
    val root = root(context)
    JSONArray(root.listFiles()?.filter { it.isDirectory }?.map { dir ->
      JSONObject().put("id", dir.name).put("bytes", used(dir)).put("expired", System.currentTimeMillis() - File(dir, "status").lastModified() > RETENTION_MS)
        .put("status", "REQUIRES_INTEGRITY_AND_REPLAY_CHECK")
        .put("sealState",File(dir,"status").takeIf{it.isFile}?.readText()?.substringBefore(":")?:"UNKNOWN")
    } ?: emptyList<JSONObject>()).toString()
  }.get()

  /** Internal bounded page. No file export, sharing, backup or plaintext temporary file. */
  fun read(context: Context, id: String, offset: Int): String = worker.submit<String> {
    val root = root(context)
    synchronized(lock) { check(active == null && !accepting) { "Capture must be OFF" } }
    readJournal(root, id, offset, key())
  }.get()

  fun openReader(context: Context, id: String): String = worker.submit<String> {
    val root = root(context)
    synchronized(lock) { check(active == null && !accepting) { "Capture must be OFF" } }
    check(cursor == null) { "Reader busy" }
    val token = UUID.randomUUID().toString()
    cursor = token to Reader(root, id, key())
    worker.schedule({ if (cursor?.first == token) closeReader() }, 15, TimeUnit.MINUTES)
    token
  }.get()

  fun nextPage(context: Context, token: String): String = worker.submit<String> {
    root(context)
    val current = cursor
    check(current?.first == token) { "Reader expired" }
    val reader = requireNotNull(current).second
    try {
      val page = reader.next()
      if (page.getBoolean("done")) closeReader()
      page.put("jvmHeapUsedBytes", heapUsed()).toString()
    } catch (e: Exception) {
      closeReader()
      throw e
    }
  }.get()

  fun closeReader(context: Context, token: String) {
    root(context)
    worker.submit { if (cursor?.first == token) closeReader() }.get()
  }

  internal class Reader(root: File, private val id: String, private val secret: SecretKey) : AutoCloseable {
    private val dir = File(root, id)
    private val segments: List<Pair<File, Long>>
    private var segmentIndex = 0
    private var input: DataInputStream? = null
    private var remaining = 0L
    private var seq = 0
    private var previous = ""
    private var lastKind = ""
    private var pending: String? = null

    init {
      check(id.matches(Regex("[a-f0-9-]{36}")) && dir.isDirectory)
      segments = dir.listFiles().orEmpty().filter { it.extension == "enc" }.sortedBy { it.name }
        .mapIndexed { index, file ->
          check(file.name == "%04d.enc".format(index) && file.isFile && file.length() > 0) { "Segment gap" }
          file to file.length()
        }
      check(segments.isNotEmpty()) { "Empty capture" }
    }

    private fun readFrame(): String? {
      if (remaining == 0L) {
        close()
        val (file, size) = segments.getOrNull(segmentIndex++) ?: return null
        input = DataInputStream(file.inputStream().buffered())
        remaining = size
      }
      val stream = requireNotNull(input)
      check(remaining >= 4) { "Truncated frame" }
      val length = stream.readInt()
      check(length in 29..SEGMENT_BYTES.toInt() && length <= remaining - 4) { "Invalid frame size" }
      val encrypted = ByteArray(length)
      stream.readFully(encrypted)
      remaining -= length + 4L
      if (remaining == 0L) check(stream.read() == -1) { "Segment grew" }
      val plain = JournalCipher.decrypt(secret, id, encrypted)
      val frame = JSONObject(plain)
      check(lastKind != "END" && frame.getInt("seq") == seq && frame.getString("previous") == previous) { "Sequence" }
      val payload = frame.getString("payload")
      val record = JSONObject(payload)
      check(record.getInt("seq") == seq) { "Payload sequence" }
      lastKind = record.getString("kind")
      previous = JournalCipher.hash(plain)
      seq++
      return payload
    }

    fun next(): JSONObject {
      val records = JSONArray()
      var bytes = 0
      while (records.length() < 128) {
        val payload = pending ?: readFrame() ?: break
        val size = payload.toByteArray(Charsets.UTF_8).size
        if (records.length() > 0 && bytes + size > BUFFER_BYTES) {
          pending = payload
          break
        }
        pending = null
        records.put(payload)
        bytes += size
      }
      val done = pending == null && remaining == 0L && segmentIndex >= segments.size
      val complete = done && lastKind == "END" &&
        dir.listFiles().orEmpty().filter { it.extension == "enc" }.map { it.name }.toSet() == segments.map { it.first.name }.toSet() &&
        segments.all { (file, size) -> file.length() == size } &&
        File(dir, "status").takeIf { it.isFile }?.readText() == "SEALED:$previous"
      return JSONObject().put("records", records).put("done", done).put("authenticatedRecords", seq)
        .put("storageComplete", complete)
    }

    override fun close() {
      input?.close()
      input = null
    }
  }

  private fun heapUsed() = Runtime.getRuntime().let { it.totalMemory() - it.freeMemory() }

  internal fun readJournal(root: File, id: String, offset: Int, secret: SecretKey): String {
    check(id.matches(Regex("[a-f0-9-]{36}")) && offset >= 0)
    val dir = File(root, id); check(dir.isDirectory)
    val records = JSONArray()
    var seq = 0
    var previous = ""
    val segments = dir.listFiles()?.filter { it.extension == "enc" }?.sortedBy { it.name } ?: emptyList()
    check(segments.isNotEmpty()) { "Empty capture" }
    for ((segmentIndex, segment) in segments.withIndex()) {
      check(segment.name == "%04d.enc".format(segmentIndex)) { "Segment gap" }
      DataInputStream(segment.inputStream().buffered()).use { input ->
        while (input.available() > 0) {
          val length = input.readInt(); check(length in 29..SEGMENT_BYTES.toInt())
          val encrypted = ByteArray(length); input.readFully(encrypted)
          val plain = JournalCipher.decrypt(secret, id, encrypted)
          val frame = JSONObject(plain)
          check(frame.getInt("seq") == seq && frame.getString("previous") == previous) { "Sequence" }
          val payload = frame.getString("payload")
          previous = JournalCipher.hash(plain)
          if (seq == offset + records.length() && records.length() < 128 && (records.length() == 0 || records.toString().length + payload.length < BUFFER_BYTES)) records.put(payload)
          seq++
        }
      }
    }
    check(offset <= seq)
    return JSONObject().put("records", records).put("done", offset + records.length() == seq).put("authenticatedRecords", seq)
      .put("jvmHeapUsedBytes", heapUsed()).put("storageComplete", File(dir, "status").takeIf { it.isFile }?.readText() == "SEALED:$previous").toString()
  }

  internal class Journal(val root: File, val id: String, val secret: SecretKey,
    private val segmentLimit: Long = SEGMENT_BYTES, private val sessionLimit: Long = SESSION_BYTES, private val totalLimit: Long = TOTAL_BYTES, private val compact: Boolean = true) {
    @Volatile var failed = false
    @Volatile var inputCount=0;private set
    private val dir = File(root, id).apply { check(mkdir()); File(this, "status").writeText("CAPTURING") }
    private var seq = 0
    private var previous = ""
    private var segment = 0
    private var size = 0L
    private var lastKind = ""
    private val sizes = linkedMapOf<String, RecordSize>()
    private data class RecordSize(var count: Int = 0, var logicalBytes: Long = 0, var legacyBytes: Long = 0, var storedBytes: Long = 0)
    @Synchronized fun recordBytes(): JSONObject = JSONObject().apply {
      sizes.forEach { (kind, size) ->
        put(kind, JSONObject().put("count", size.count).put("logicalBytes", size.logicalBytes)
          .put("legacyBytes", size.legacyBytes).put("storedBytes", size.storedBytes))
      }
    }
    @Synchronized private fun countRecord(kind: String, payloadBytes: Int, frameBytes: Int, storedBytes: Long) {
      val size = sizes.getOrPut(kind) { RecordSize() }
      size.count++
      size.logicalBytes += payloadBytes
      size.legacyBytes += frameBytes + 32L
      size.storedBytes += storedBytes
    }
    fun seal() {
      val state = if (!failed && lastKind == "END") "SEALED:$previous" else "INCOMPLETE"
      FileOutputStream(File(dir, "status")).use { it.write(state.toByteArray()); it.fd.sync() }
    }
    fun append(payload: String, wall: Long, mono: Long) {
      val body = JSONObject(payload)
      check(body.getInt("seq") == seq)
      val plain = JSONObject().put("seq", seq).put("previous", previous).put("payload", payload)
        .put("nativeWallAt", wall).put("nativeElapsedMs", mono).toString()
      val plainBytes = plain.toByteArray(Charsets.UTF_8)
      val encoded = if (compact) JournalFrameEncoding.encode(plainBytes) else plainBytes
      val encrypted = JournalCipher.encryptBytes(secret, id, encoded)
      val length = encrypted.size + 4L
      var file = File(dir, "%04d.enc".format(segment))
      if (file.length() + length > segmentLimit) { segment++; file = File(dir, "%04d.enc".format(segment)) }
      check(length <= segmentLimit && size + length + 128 <= sessionLimit && used(root) + length + 128 <= totalLimit) { "Capacity" }
      FileOutputStream(file, true).use { stream ->
        val output = java.io.DataOutputStream(stream)
        output.writeInt(encrypted.size); output.write(encrypted); output.flush(); stream.fd.sync()
      }
      size += length; previous = JournalCipher.hash(plain); seq++
      lastKind = body.getString("kind")
      countRecord(lastKind, payload.toByteArray(Charsets.UTF_8).size, plainBytes.size, length)
      if(lastKind=="INPUT")inputCount+=(body.optJSONObject("data")?.optJSONArray("raws")?.length()?:0)
    }
  }
}

/** Called under the producer lock; includes the frame being written. No eviction. */
internal class JournalBufferBudget(private val maxBytes: Int, private val maxCount: Int) {
  var count = 0; private set
  var bytes = 0; private set
  fun reserve(size: Int): Boolean {
    if (size < 0 || count >= maxCount || size > maxBytes - bytes) return false
    bytes += size; count++; return true
  }
  fun release(size: Int) { check(count > 0 && size <= bytes); count--; bytes -= size }
}

/**
 * Storage encoding v2. Logical record schema v1 and hash input stay byte-for-byte intact.
 * A legacy plaintext frame starts with '{'; a compressed frame starts with the codec version.
 */
internal object JournalFrameEncoding {
  private const val VERSION = 2
  private const val MAX_PLAIN_BYTES = DetectorJournalStorage.BUFFER_BYTES * 6 + 1024

  fun encode(plain: ByteArray): ByteArray {
    check(plain.size <= MAX_PLAIN_BYTES) { "Frame too large" }
    val output = ByteArrayOutputStream()
    output.write(VERSION)
    GZIPOutputStream(output).use { it.write(plain) }
    val compressed = output.toByteArray()
    return if (compressed.size < plain.size) compressed else plain
  }

  fun decode(encoded: ByteArray): String {
    check(encoded.isNotEmpty()) { "Empty frame" }
    if (encoded[0].toInt() == '{'.code) return encoded.toString(Charsets.UTF_8)
    check(encoded[0].toInt() == VERSION) { "Unsupported frame encoding" }
    val output = ByteArrayOutputStream()
    GZIPInputStream(ByteArrayInputStream(encoded, 1, encoded.size - 1)).use { input ->
      val chunk = ByteArray(8192)
      while (true) {
        val size = input.read(chunk)
        if (size < 0) break
        check(output.size() + size <= MAX_PLAIN_BYTES) { "Frame too large" }
        output.write(chunk, 0, size)
      }
    }
    return output.toByteArray().toString(Charsets.UTF_8)
  }
}

/** Separate cipher to exercise encryption/tamper checks with a test key, not a Keystore mock. */
internal object JournalCipher {
  fun hash(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  fun encrypt(key: SecretKey, id: String, plain: String) = encryptBytes(key, id, plain.toByteArray(Charsets.UTF_8))
  fun encryptBytes(key: SecretKey, id: String, plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return cipher.iv + cipher.doFinal(plain)
  }
  fun decrypt(key: SecretKey, id: String, encrypted: ByteArray): String {
    check(encrypted.size >= 28)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return JournalFrameEncoding.decode(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)))
  }
}

/** Bounded 0.1ms histogram, last bin is overflow; exact max retained. */
internal class JournalTiming {
  private val bins=LongArray(2001);private var count=0L;private var maximum=0.0
  fun clear(){bins.fill(0);count=0;maximum=0.0}
  fun add(ms:Double){if(!ms.isFinite()||ms<0)return;bins[(ms*10).toInt().coerceIn(0,2000)]++;count++;maximum=maxOf(maximum,ms)}
  fun json():JSONObject {
    fun q(p:Double):Double {var n=0L;val target=kotlin.math.ceil(count*p).toLong();for(i in bins.indices){n+=bins[i];if(n>=target)return i/10.0};return 0.0}
    return JSONObject().put("count",count).put("p50",if(count>0)q(.5)else JSONObject.NULL).put("p95",if(count>0)q(.95)else JSONObject.NULL).put("max",maximum).put("binMs",.1).put("overflowAtMs",200)
  }
}
