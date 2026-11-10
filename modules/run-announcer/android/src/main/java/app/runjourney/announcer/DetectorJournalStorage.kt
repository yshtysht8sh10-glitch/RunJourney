package app.runjourney.announcer

import android.content.Context
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
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
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "detector-journal").apply { isDaemon = true } }
  private val lock = Any()
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
      .put("writeMs",writeTimes.json()).put("queueMs",queueTimes.json())
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
      .put("storageComplete", File(dir, "status").takeIf { it.isFile }?.readText() == "SEALED:$previous").toString()
  }

  internal class Journal(val root: File, val id: String, val secret: SecretKey,
    private val segmentLimit: Long = SEGMENT_BYTES, private val sessionLimit: Long = SESSION_BYTES, private val totalLimit: Long = TOTAL_BYTES) {
    @Volatile var failed = false
    @Volatile var inputCount=0;private set
    private val dir = File(root, id).apply { check(mkdir()); File(this, "status").writeText("CAPTURING") }
    private var seq = 0
    private var previous = ""
    private var segment = 0
    private var size = 0L
    private var lastKind = ""
    fun seal() {
      val state = if (!failed && lastKind == "END") "SEALED:$previous" else "INCOMPLETE"
      FileOutputStream(File(dir, "status")).use { it.write(state.toByteArray()); it.fd.sync() }
    }
    fun append(payload: String, wall: Long, mono: Long) {
      val body = JSONObject(payload)
      check(body.getInt("seq") == seq)
      val plain = JSONObject().put("seq", seq).put("previous", previous).put("payload", payload)
        .put("nativeWallAt", wall).put("nativeElapsedMs", mono).toString()
      val encrypted = JournalCipher.encrypt(secret, id, plain)
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

/** Separate cipher to exercise encryption/tamper checks with a test key, not a Keystore mock. */
internal object JournalCipher {
  fun hash(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  fun encrypt(key: SecretKey, id: String, plain: String): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
  }
  fun decrypt(key: SecretKey, id: String, encrypted: ByteArray): String {
    check(encrypted.size >= 28)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return String(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)), Charsets.UTF_8)
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
