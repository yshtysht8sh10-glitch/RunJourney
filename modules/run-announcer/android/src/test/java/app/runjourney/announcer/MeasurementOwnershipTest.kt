package app.runjourney.announcer

import java.io.File
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class MeasurementOwnershipTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private lateinit var owner: MeasurementOwnership
  private fun request(purpose: String = "cycling", id: String = "cycle1", db: String = "runjourney-cycling.sqlite") = JSONObject()
    .put("sessionId", id).put("purpose", purpose).put("profileVersion", 1).put("databaseKey", db).put("startedAt", 1000)
  private fun claim() = JSONObject(owner.command("claim", request().toString())).getJSONObject("binding")
  private fun rejected(action: () -> Unit) { try { action(); fail("Expected ownership rejection") } catch (_: IllegalStateException) { } }
  @Before fun setup() {
    // Synthetic Robolectric sandbox only. Never exposed as a device reset API.
    File(context.noBackupFilesDir, "measurement-ownership-v1").deleteRecursively()
    owner = MeasurementOwnership(context)
  }
  @Test fun durableClaimLocksOtherPurposesAndBindsDestination() {
    val b = claim()
    assertEquals("STARTING", b.getString("status"))
    val reopened = MeasurementOwnership(context)
    assertEquals("cycle1", JSONObject(reopened.command("read")).getJSONObject("binding").getString("sessionId"))
    rejected { reopened.command("claim", request("running", "run1", "runjourney.sqlite").toString()) }
    assertEquals("runjourney-cycling.sqlite", b.getString("databaseKey"))
  }
  @Test fun invalidPurposeDatabaseAndProfileNeverAcquire() {
    rejected { owner.command("claim", request(db="runjourney.sqlite").toString()) }
    rejected { owner.command("claim", request("generic", db="runjourney.sqlite").toString()) }
    rejected { owner.command("claim", request().put("profileVersion", 2).toString()) }
    assertTrue(JSONObject(owner.command("read")).isNull("binding"))
  }
  @Test fun stopFencesNewLeasesAndCannotFinishUntilAllWritesDrain() {
    val b = claim(); owner.command("activate", b.toString())
    val token = JSONObject(owner.command("lease", b.toString())).getString("token")
    owner.command("stop", b.toString())
    rejected { owner.command("lease", b.toString()) }
    rejected { owner.command("finish", b.toString()) }
    owner.command("release", JSONObject(b.toString()).put("token", token).toString())
    owner.command("finish", b.toString())
    val next = claim(); assertTrue(next.getLong("generation") > b.getLong("generation"))
    rejected { owner.command("stop", b.toString()) }
  }
  @Test fun failedFinalAckRetainsOwnershipAndSameGenerationCanRetry() {
    val b = claim(); owner.command("stop", b.toString()); owner.command("failed", b.toString())
    rejected { owner.command("claim", request().toString()) }
    rejected { owner.command("finish", b.toString()) }
    owner.command("stop", b.toString()); owner.command("finish", b.toString())
    assertTrue(JSONObject(owner.command("read")).isNull("binding"))
  }
  @Test fun leaseSurvivesRecreationAndNoTimeoutMayReleaseIt() {
    val b = claim(); owner.command("activate", b.toString()); owner.command("lease", b.toString())
    val reopened = MeasurementOwnership(context)
    assertEquals(1, JSONObject(reopened.command("read")).getJSONObject("leases").length())
    reopened.command("stop", b.toString())
    rejected { reopened.command("finish", b.toString()) }
  }
  @Test fun duplicateReleaseDoesNotReleaseAnotherLease() {
    val b = claim(); owner.command("activate", b.toString())
    val first = JSONObject(owner.command("lease", b.toString())).getString("token")
    owner.command("lease", b.toString())
    val release = JSONObject(b.toString()).put("token", first).toString()
    owner.command("release", release); rejected { owner.command("release", release) }
    assertEquals(1, JSONObject(owner.command("read")).getJSONObject("leases").length())
  }
  @Test fun failedWriteDoesNotAcknowledgeOrChangeCommittedOwner() {
    val b = claim()
    val failed = MeasurementOwnership(context) { false }
    rejected { failed.command("activate", b.toString()) }
    assertEquals("STARTING", JSONObject(owner.command("read")).getJSONObject("binding").getString("status"))
  }
  @Test fun corruptedOrUnknownControlFileIsNeverReplacedWithIdle() {
    owner.command("read")
    val file = File(context.noBackupFilesDir, "measurement-ownership-v1/owner.json")
    val raw = "{\"version\":2,\"generation\":1,\"binding\":null,\"leases\":{}}"
    file.writeText(raw)
    rejected { owner.command("claim", request().toString()) }
    assertEquals(raw, file.readText())
  }
  @Test fun simultaneousInstancesHaveExactlyOneWinner() {
    val winners = java.util.concurrent.atomic.AtomicInteger()
    val gate = java.util.concurrent.CountDownLatch(1)
    val threads = (1..8).map { index -> Thread {
      gate.await()
      try { MeasurementOwnership(context).command("claim", request(id="c$index").toString()); winners.incrementAndGet() }
      catch (_: IllegalStateException) { }
    }.also { it.start() } }
    gate.countDown(); threads.forEach { it.join() }; assertEquals(1, winners.get())
  }
}
