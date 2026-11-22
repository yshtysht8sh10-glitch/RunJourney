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
  @Before fun setup() { context.getSharedPreferences("runjourney-pace-periodic-v1",Context.MODE_PRIVATE).edit().clear().commit();ledger=PacePeriodicLedger(context) }
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
  @Test fun settingOffAndChangedEpochCancelOldSnapshotsAndEndFencesLateReceipt() {
    ledger.configure(schedule(),1001);ledger.accept(notice(1))
    ledger.configure(schedule(enabled=false),70000);assertTrue(ledger.pending("r").isEmpty())
    ledger.configure(schedule(),80000);assertEquals(80000,JSONObject(ledger.state("r","a")).getLong("activeFromMs"))
    ledger.configure(schedule("b"),90000);ledger.configure(schedule(),100000)
    assertEquals(100000,JSONObject(ledger.state("r","a")).getLong("activeFromMs"))
    ledger.end("r");assertEquals("INACTIVE_SCHEDULE",ledger.accept(notice(2)));assertTrue(ledger.pending("r").isEmpty())
  }
}
