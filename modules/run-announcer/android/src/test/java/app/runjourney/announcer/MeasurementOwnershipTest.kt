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
  // Windows Robolectric cannot perform the Android directory/rename syscalls.
  // Keep real file sync/locking and use an actual host atomic rename, not a no-op.
  private fun newOwner(ioCheck: (String) -> Unit = {}, allowWrite: () -> Boolean = { true }) =
    MeasurementOwnership(context, ioCheck = ioCheck, directorySync = {}, allowWrite = allowWrite,
      atomicReplace = { source, target -> java.nio.file.Files.move(source.toPath(), target.toPath(),
        java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING); Unit })
  private fun claim() = JSONObject(owner.command("claim", request().toString())).getJSONObject("binding")
  private fun rejected(action: () -> Unit) { try { action(); fail("Expected ownership rejection") } catch (_: IllegalStateException) { } }
  @Before fun setup() {
    // Synthetic Robolectric sandbox only. Never exposed as a device reset API.
    File(context.noBackupFilesDir, "measurement-ownership-v1").deleteRecursively()
    owner = newOwner()
  }
  @Test fun recoveryLeaseFencesOsStopAgainstFinishAndNewGeneration() {
    val b = claim(); owner.command("activate", b.toString())
    rejected { owner.command("recoveryLease", b.toString()) }
    owner.command("stop", b.toString())
    val token = JSONObject(owner.command("recoveryLease", b.toString())).getString("token")
    rejected { owner.command("recoveryLease", b.toString()) }
    rejected { owner.command("finish", b.toString()) }
    rejected { claim() }
    owner.command("release", JSONObject(b.toString()).put("token", token).toString())
    owner.command("finish", b.toString()); claim()
    rejected { owner.command("recoveryLease", b.toString()) }
  }
  @Test fun durableClaimLocksOtherPurposesAndBindsDestination() {
    val b = claim()
    assertEquals("STARTING", b.getString("status"))
    val reopened = newOwner()
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
    val reopened = newOwner()
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
    val failed = newOwner() { false }
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
      try { newOwner().command("claim", request(id="c$index").toString()); winners.incrementAndGet() }
      catch (_: IllegalStateException) { }
    }.also { it.start() } }
    gate.countDown(); threads.forEach { it.join() }; assertEquals(1, winners.get())
  }
  @Test fun fractionalAndStringIntegersAreRejectedWithoutChangingRawControl() {
    owner.command("read")
    val file = File(context.noBackupFilesDir, "measurement-ownership-v1/owner.json")
    listOf("1.5" to "0", "1" to "1.5", "\"1\"" to "0", "1" to "9007199254740992").forEach { (version, generation) ->
      val raw = "{\"version\":$version,\"generation\":$generation,\"binding\":null,\"leases\":{}}"
      file.writeText(raw); rejected { claim() }; assertEquals(raw, file.readText())
    }
  }
  @Test fun fractionalRequestProfileAndGenerationAreRejected() {
    rejected { owner.command("claim", request().put("profileVersion", 1.5).toString()) }
    val b = claim()
    rejected { owner.command("activate", JSONObject(b.toString()).put("generation", 1.5).toString()) }
    assertEquals("STARTING", JSONObject(owner.command("read")).getJSONObject("binding").getString("status"))
  }
  @Test fun checkedFileSyncOrRenameFailureNeverAcknowledgesClaim() {
    listOf("FILE_SYNC", "RENAME").forEach { stage ->
      val failed = newOwner(ioCheck = { if(it == stage) throw java.io.IOException("injected") })
      var acknowledged = false
      try { failed.command("claim", request().toString()); acknowledged = true } catch (_: java.io.IOException) { }
      assertFalse(acknowledged); assertTrue(JSONObject(owner.command("read")).isNull("binding"))
    }
  }
  @Test fun postRenameDirectorySyncFailureIsUnknownAndFencesAnotherStart() {
    owner.command("read") // Parent directory sync already confirmed in this synthetic process.
    val failed = newOwner(ioCheck = { if(it == "DIRECTORY_SYNC") throw java.io.IOException("injected") })
    var acknowledged = false
    try { failed.command("claim", request().toString()); acknowledged = true } catch (_: java.io.IOException) { }
    assertFalse(acknowledged)
    assertEquals("cycle1", JSONObject(owner.command("read")).getJSONObject("binding").getString("sessionId"))
    rejected { claim() }
  }
  @Test fun newInstallTopDefaultsSurviveStorageGateCreatingAnEmptyDatabase() {
    val sqlite = File(context.filesDir, "SQLite/runjourney.sqlite")
    sqlite.delete()
    assertFalse(JSONObject(owner.command("topRead")).getBoolean("assistantEnabled"))
    sqlite.parentFile!!.mkdirs(); sqlite.writeText("synthetic empty gate-created DB")
    assertFalse(JSONObject(newOwner().command("topRead")).getBoolean("assistantEnabled"))
    sqlite.delete()
  }
  @Test fun bootstrapEvidenceSurvivesFailureBeforeTopSettingsAck() {
    val sqlite = File(context.filesDir, "SQLite/runjourney.sqlite"); sqlite.delete()
    var renames = 0
    val interrupted = newOwner(ioCheck = { if(it == "RENAME" && ++renames == 2) throw java.io.IOException("after evidence ACK") })
    try { interrupted.command("topRead"); fail("Expected interrupted settings write") } catch (_: java.io.IOException) { }
    sqlite.parentFile!!.mkdirs(); sqlite.writeText("synthetic gate-created DB")
    assertFalse(JSONObject(newOwner().command("topRead")).getBoolean("assistantEnabled"))
    sqlite.delete()
  }
  @Test fun upgradeDefaultsOnAndGenericTimePreferenceIsNotDestroyed() {
    val sqlite = File(context.filesDir, "SQLite/runjourney.sqlite")
    sqlite.parentFile!!.mkdirs(); sqlite.writeText("synthetic pre-existing file")
    val top = JSONObject(owner.command("topRead"))
    assertTrue(top.getBoolean("assistantEnabled")); assertFalse(top.getBoolean("genericTimeEnabled"))
    top.put("assistantEnabled", false).put("genericTimeEnabled", true)
    owner.command("topSave", top.toString()); top.put("assistantEnabled", true)
    owner.command("topSave", top.toString())
    assertTrue(JSONObject(owner.command("topRead")).getBoolean("genericTimeEnabled"))
    sqlite.delete()
  }
  @Test fun topSaveCannotRaceWithActiveClaimOrReplaceUnknownSettings() {
    val top = owner.command("topRead"); claim()
    rejected { owner.command("topSave", top) }
    val file = File(context.noBackupFilesDir, "measurement-ownership-v1/top-settings.json")
    val unknown = "{\"version\":2}"
    file.writeText(unknown); rejected { owner.command("topRead") }; assertEquals(unknown, file.readText())
  }
  @Test fun newSportClaimChecksAssistantUnderTheSameLockAsModeChanges() {
    val top = JSONObject(owner.command("topRead")).put("assistantEnabled", false)
    owner.command("topSave", top.toString())
    rejected { owner.command("claimSport", request().toString()) }
    assertTrue(JSONObject(owner.command("read")).isNull("binding"))
    top.put("assistantEnabled", true); owner.command("topSave", top.toString())
    owner.command("claimSport", request().toString())
    rejected { owner.command("topSave", top.put("assistantEnabled", false).toString()) }
  }
  @Test fun existingOpaqueRunIdsAreNotRewrittenOrUsedAsFilesystemPaths() {
    val id = "旧RUN:2020 / original"
    owner.command("claim", request(id=id).toString())
    assertEquals(id, JSONObject(owner.command("read")).getJSONObject("binding").getString("sessionId"))
    assertTrue(File(context.noBackupFilesDir, "measurement-ownership-v1/owner.json").isFile)
  }
}
