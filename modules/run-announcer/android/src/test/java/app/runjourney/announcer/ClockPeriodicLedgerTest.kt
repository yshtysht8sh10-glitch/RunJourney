package app.runjourney.announcer

import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class ClockPeriodicLedgerTest {
  private val context get()=RuntimeEnvironment.getApplication()
  private lateinit var ledger:ClockPeriodicLedger
  private fun config(enabled:Boolean=true)=JSONObject().put("startedAt",1000).put("minutes",10).put("enabled",enabled)
  private fun notice(id:String)=JSONObject().put("id",id).put("type","CURRENT_TIME").put("message","CURRENT_TIME_AT_PLAYBACK").put("expiresAt",Long.MAX_VALUE).put("data",JSONObject().put("runId","r"))
  @Before fun setup(){android.util.AtomicFile(java.io.File(context.filesDir,"clock-periodic-v1.json")).delete();context.getSharedPreferences(RunAnnouncerService.PREFS,0).edit().clear().commit();ledger=ClockPeriodicLedger(context)}
  @Test fun receiptBoundaryAndNewestPendingCommitTogetherAndSurviveRestart(){
    ledger.configure("r",config(),1001);assertTrue(ledger.receive(1,notice("one")));assertTrue(ledger.receive(2,notice("two")))
    val next=ClockPeriodicLedger(context);assertEquals(2,next.snapshot().getInt("boundary"));assertEquals("two",next.pending("r")!!.getString("id"))
    assertTrue(next.complete("one"));assertNotNull(next.pending("r"));assertTrue(next.complete("two"));assertNull(next.pending("r"))
  }
  @Test fun failedReceiptAndCancellationCannotAdvanceDurableState(){
    ledger.configure("r",config(),1001);ledger.receive(1,notice("one"));val failed=ClockPeriodicLedger(context){false}
    assertFalse(failed.receive(2,notice("two")));assertEquals(1,ledger.snapshot().getInt("boundary"));assertEquals("one",ledger.pending("r")!!.getString("id"))
    assertFalse(failed.configure("r",config(false),2000));assertFalse(failed.end("r"));assertFalse(failed.complete("one"));assertNotNull(ledger.pending("r"))
  }
  @Test fun attemptedClockIsUnknownOnRestartAndNeverReportedDone(){
    ledger.configure("r",config(),1001);ledger.receive(1,notice("one"));ledger.bodyRequested("one",610000)
    val next=ClockPeriodicLedger(context);val recovery=next.recoverUnknown();assertTrue(recovery.first);assertEquals("one",recovery.second!!.getString("id"))
    assertNull(next.pending("r"));assertEquals(1,next.snapshot().getInt("unknownCompletionCount"));assertEquals(1,next.snapshot().getInt("boundary"))
  }
  @Test fun nextBoundaryCannotEraseInflightAttemptOrItsUnknownRecovery(){
    ledger.configure("r",config(),1001);ledger.receive(1,notice("one"));assertTrue(ledger.bodyRequested("one",610000))
    assertTrue(ledger.receive(2,notice("two")))
    val next=ClockPeriodicLedger(context);val recovery=next.recoverUnknown()
    assertTrue(recovery.first);assertEquals("one",recovery.second!!.getString("id"))
    assertEquals("two",next.pending("r")!!.getString("id"));assertEquals(2,next.snapshot().getInt("boundary"))
    assertEquals(1,next.snapshot().getInt("unknownCompletionCount"));assertNull(next.recoverUnknown().second)
  }
  @Test fun completingInflightKeepsTheNextPendingBoundary(){
    ledger.configure("r",config(),1001);ledger.receive(1,notice("one"));ledger.bodyRequested("one",610000);ledger.receive(2,notice("two"))
    assertTrue(ledger.complete("one"));assertEquals("two",ledger.pending("r")!!.getString("id"))
    assertNull(ClockPeriodicLedger(context).recoverUnknown().second)
  }
  @Test fun boundaryDuringChimeStillTracksActualBodyRequestedNotice(){
    ledger.configure("r",config(),1001);val first=notice("one");ledger.receive(1,first);ledger.receive(2,notice("two"))
    assertTrue(ledger.bodyRequested("one",610000,first))
    val next=ClockPeriodicLedger(context);assertEquals("one",next.recoverUnknown().second!!.getString("id"))
    assertEquals("two",next.pending("r")!!.getString("id"))
  }
}
