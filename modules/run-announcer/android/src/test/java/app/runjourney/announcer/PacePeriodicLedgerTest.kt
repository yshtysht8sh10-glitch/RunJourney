package app.runjourney.announcer

import android.content.Context
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class PacePeriodicLedgerTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private lateinit var ledger: PacePeriodicLedger
  private fun schedule(key:String="a", enabled:Boolean=true) = JSONObject().put("version",1).put("runId","r").put("configKey",key).put("startedAt",1000).put("intervalMs",60000).put("enabled",enabled)
  private fun notice(slot:Int, quality:String="READY", key:String="a") = JSONObject().put("id","r:$key:$slot").put("type","PACE_WARNING").put("message","immutable $slot")
    .put("data",JSONObject().put("runId","r").put("pacePeriodicSnapshot",JSONObject().put("version",1).put("runId","r").put("configKey",key).put("slot",slot).put("quality",quality)))
  @Before fun setup() { android.util.AtomicFile(java.io.File(context.filesDir,"pace-periodic-v1.json")).delete();context.getSharedPreferences("runjourney-pace-periodic-v1",0).edit().clear().commit();ledger=PacePeriodicLedger(context) }
  @Test fun receiptSurvivesNewInstanceAndDuplicateCannotReplaceSnapshot() {
    assertEquals("null",ledger.state("r","a"));assertTrue(ledger.configure(schedule(),1001))
    assertEquals("PERSISTED_ACK",ledger.accept(notice(1)));assertEquals("ALREADY_ACCEPTED",ledger.accept(notice(1).put("message","changed")))
    val reopened=PacePeriodicLedger(context)
    assertEquals(1,JSONObject(reopened.state("r","a")).getInt("acceptedThrough"));assertEquals("immutable 1",reopened.pending("r").single().getString("message"))
    assertTrue(reopened.complete("r:a:1"));assertTrue(reopened.pending("r").isEmpty())
  }
  @Test fun terminalCancellationAcknowledgesWithoutSpeechAndCannotSkipSlot() {
    ledger.configure(schedule(),1001)
    assertEquals("NONCONTIGUOUS_SLOT",ledger.accept(notice(2)))
    assertEquals("TERMINAL_CANCEL_ACK",ledger.accept(notice(1,"CANCELLED_NO_RUNNING")))
    assertEquals("TERMINAL_CANCEL_ACK",ledger.accept(notice(2,"CONFIG_CHANGED")))
    assertTrue(ledger.pending("r").isEmpty());assertEquals(2,JSONObject(ledger.state("r","a")).getInt("acceptedThrough"))
  }
  @Test fun boundedBackpressureDoesNotAcknowledgeAndSameIdCanRetry() {
    ledger.configure(schedule(),1001)
    (1..32).forEach { assertEquals("PERSISTED_ACK",ledger.accept(notice(it))) }
    assertEquals("BACKPRESSURE",ledger.accept(notice(33)))
    assertEquals(32,JSONObject(ledger.state("r","a")).getInt("acceptedThrough"))
    ledger.complete("r:a:1");assertEquals("PERSISTED_ACK",ledger.accept(notice(33)))
  }
  @Test fun storageFailureDoesNotAcknowledgeOrLoseRetryIdentity() {
    ledger.configure(schedule(),1001)
    val failed=PacePeriodicLedger(context) { false }
    assertEquals("PERSIST_FAILED",failed.accept(notice(1)))
    assertEquals(0,JSONObject(ledger.state("r","a")).getInt("acceptedThrough"))
    assertEquals("PERSISTED_ACK",ledger.accept(notice(1)))
  }
  @Test fun restartedBodyAttemptBecomesUnknownTerminalRatherThanSuccessfulOrReplayed(){
    ledger.configure(schedule(),1001);ledger.accept(notice(1));ledger.accept(notice(2))
    assertTrue(ledger.bodyRequested("r:a:1",70000))
    val reopened=PacePeriodicLedger(context);assertEquals(listOf("r:a:1"),reopened.recoverUnknown()!!.map{it.getString("id")})
    assertEquals(listOf("r:a:2"),reopened.pending("r").map{it.getString("id")})
    assertEquals(1,JSONObject(reopened.state("r","a")).getInt("unknownCompletionCount"))
    assertTrue(reopened.recoverUnknown()!!.isEmpty());assertEquals(2,JSONObject(reopened.state("r","a")).getInt("acceptedThrough"))
  }
  @Test fun failedUnknownTerminalPersistenceDoesNotSilentlyRemoveOrAcknowledgeIt(){
    ledger.configure(schedule(),1001);ledger.accept(notice(1));ledger.bodyRequested("r:a:1",70000)
    assertNull(PacePeriodicLedger(context){false}.recoverUnknown());assertEquals(1,ledger.pending("r").size)
    assertEquals(0,JSONObject(ledger.state("r","a")).getInt("unknownCompletionCount"))
  }
  @Test fun legacyPreferencesAreReadWithoutDeletingOrOverwritingTheirContents() {
    val raw=JSONObject().put("runId","r").put("configKey","a").put("enabled",true).put("acceptedThrough",1).put("activeFromMs",1000)
      .put("pending",org.json.JSONArray().put(notice(1))).toString()
    val prefs=context.getSharedPreferences("runjourney-pace-periodic-v1",0)
    prefs.edit().putString("ledger",raw).commit()
    assertEquals(1,ledger.pending("r").size);assertTrue(ledger.complete("r:a:1"))
    assertTrue(ledger.pending("r").isEmpty());assertEquals(raw,prefs.getString("ledger",null))
  }
  @Test fun settingOffAndChangedEpochCancelOldSnapshotsAndEndFencesLateReceipt() {
    ledger.configure(schedule(),1001);ledger.accept(notice(1))
    ledger.configure(schedule(enabled=false),70000);assertTrue(ledger.pending("r").isEmpty())
    ledger.configure(schedule(),80000);assertEquals(80000,JSONObject(ledger.state("r","a")).getLong("activeFromMs"))
    ledger.configure(schedule("b"),90000);ledger.configure(schedule(),100000)
    assertEquals(100000,JSONObject(ledger.state("r","a")).getLong("activeFromMs"))
    ledger.end("r");assertEquals("INACTIVE_SCHEDULE",ledger.accept(notice(2)));assertTrue(ledger.pending("r").isEmpty())
  }
}
