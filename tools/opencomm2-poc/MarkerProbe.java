package app.runjourney.markerprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.KeyEvent;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Isolated routing gate. No GPS/RUN/voice-log access or audio focus request.
 * An optional real activation chime tests whether local playback changes routing. */
public final class MarkerProbe extends Instrumentation {
  private MediaSession session;
  private PowerManager.WakeLock lock;
  private final MarkerKeys keys = new MarkerKeys();
  private volatile int presses;
  private long began;
  private int duration;
  private String phase;
  private boolean activationCue;
  private final CountDownLatch done = new CountDownLatch(1);
  private boolean voiceTrial;
  private File voiceDirectory;
  private String voiceNoticeId;

  @Override public void onCreate(Bundle args) {
    super.onCreate(args);
    duration = Math.max(10, Math.min(900, Integer.parseInt(args.getString("seconds", "180"))));
    phase = args.getString("phase", "silent");
    activationCue = "true".equals(args.getString("cue", "false"));
    voiceTrial = "true".equals(args.getString("speech", "false"));
    if (!phase.matches("[a-z-]{1,30}")) throw new IllegalArgumentException("Phase");
    start();
  }
  private void startVoice() {
    if (voiceDirectory != null) return;
    try {
      Context c = getTargetContext();
      voiceDirectory = new File(c.getNoBackupFilesDir(), "marker-poc-audit/" + phase + "-" + began);
      ClassLoader loader = c.getClassLoader();
      Class<?> journal = Class.forName("app.runjourney.announcer.VoiceLogJournal", true, loader);
      Object isolated = journal.getDeclaredConstructor(File.class, long.class, int.class, int.class, long.class)
        .newInstance(voiceDirectory, 2000000L, 2000, 256000, 604800000L);
      Class<?> storage = Class.forName("app.runjourney.announcer.VoiceLogStorage", true, loader);
      java.lang.reflect.Field field = storage.getDeclaredField("journal"); field.setAccessible(true); field.set(null, isolated);
      // The existing queue is used unchanged. Its audit is redirected only in
      // this isolated process so no original voice-log chunk can be pruned.
      String id = "marker-poc-" + began;
      voiceNoticeId = id + ":speech";
      long now = System.currentTimeMillis();
      String message = "これは音声案内中のマーカー試験です。ボタンを一秒間隔で十回押してください。"
        + "この一分で五秒貯金が増えました。八点三キロを通過。ここまでの走行で貯金は三十六秒です。"
        + "これは実際の走行記録ではありません。音声が途中で切れず、最後まで聞こえるか確認してください。音声の干渉確認を終了します。";
      JSONObject n = new JSONObject().put("id", voiceNoticeId).put("type", "FIVE_MINUTES").put("priority", 40)
        .put("message", message).put("generatedAt", now).put("expiresAt", now + 60000)
        .put("data", new JSONObject().put("runId", id).put("simulation", true));
      JSONObject batch = new JSONObject().put("runId", id).put("state", "RUNNING").put("paused", false)
        .put("latestEventIndex", -1).put("notices", new JSONArray().put(n));
      c.startForegroundService(new Intent().setClassName(c.getPackageName(), "app.runjourney.announcer.RunAnnouncerService")
        .setAction("app.runjourney.announcer.BATCH").putExtra("payload", batch.toString()));
      emit("NATIVE_VOICE_REQUESTED", new JSONObject());
    } catch (Exception e) { emit("VOICE_SETUP_FAILED", new JSONObject()); done.countDown(); }
  }
  private boolean voiceComplete() throws Exception {
    if (voiceDirectory == null) return false;
    File[] chunks = voiceDirectory.listFiles(); if (chunks == null) return false;
    for (File file : chunks) {
      for (String line : Files.readAllLines(file.toPath())) {
        int tab = line.indexOf('\t'); if (tab < 0) continue;
        JSONObject record;
        try { record = new JSONObject(line.substring(tab + 1)); } catch (Exception incomplete) { continue; }
        if (!voiceNoticeId.equals(record.optString("id"))) continue;
        String status = record.optString("status");
        if (status.equals("DONE") || status.equals("ERROR") || status.equals("PLAYBACK_TIMEOUT") || status.equals("SPEAK_FAILED") || status.equals("INIT_FAILED")) {
          emit("NATIVE_VOICE_TERMINAL", new JSONObject().put("voiceStatus", status)); return true;
        }
      }
    }
    return false;
  }
  private synchronized void emit(String status, JSONObject data) {
    try {
      data.put("status", status).put("phase", phase).put("wall", System.currentTimeMillis())
        .put("elapsed", SystemClock.elapsedRealtime()).put("uptime", SystemClock.uptimeMillis())
        .put("interactive", ((PowerManager)getTargetContext().getSystemService(Context.POWER_SERVICE)).isInteractive());
      Bundle result = new Bundle(); result.putString("marker", data.toString()); sendStatus(0, result);
      android.util.Log.i("RunJourneyMarkerProbe", data.toString());
      if (session != null) session.setMetadata(new MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, status + " presses=" + presses).build());
    } catch (Exception e) { throw new IllegalStateException(e); }
  }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      Context context = getTargetContext();
      if (!"app.runjourney.mobile.test".equals(context.getPackageName())) throw new SecurityException("Test only");
      began = SystemClock.elapsedRealtime();
      lock = ((PowerManager)context.getSystemService(Context.POWER_SERVICE))
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunJourney:MarkerRoutingProbe");
      lock.acquire((duration + 10L) * 1000);
      runOnMainSync(() -> {
        session = new MediaSession(context, "RunJourney-Test-Marker-PoC");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
          private void transport(String name, boolean marker) {
            try {
              if (marker) presses++;
              emit("TRANSPORT", new JSONObject().put("command", name).put("accepted", marker)
                .put("presses", presses).put("keyEventTimeAvailable", false));
              if (marker && voiceTrial && presses == 1) startVoice();
              if (!voiceTrial && marker && presses == 10) new Handler(Looper.getMainLooper()).postDelayed(() -> done.countDown(), 500);
            } catch (Exception e) { emit("CALLBACK_ERROR", new JSONObject()); }
          }
          @Override public void onPlay() { transport("PLAY", true); }
          @Override public void onPause() { transport("PAUSE", true); }
          @Override public void onStop() { transport("STOP", false); }
          @Override public void onSkipToNext() { transport("NEXT", false); }
          @Override public void onSkipToPrevious() { transport("PREVIOUS", false); }
          @Override public boolean onMediaButtonEvent(Intent intent) {
            KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
            if (event == null) return false;
            try {
              JSONObject data = new JSONObject().put("action", event.getAction()).put("keyCode", event.getKeyCode())
                .put("repeat", event.getRepeatCount()).put("keyEventUptime", event.getEventTime())
                .put("keyDownUptime", event.getDownTime()).put("keyEventTimeAvailable", event.getEventTime() > 0);
              boolean relevant = event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                || event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_PLAY || event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_PAUSE
                || event.getKeyCode() == KeyEvent.KEYCODE_HEADSETHOOK;
              String decision = keys.admit(relevant, event.getAction(), event.getRepeatCount(), event.getDeviceId(), event.getDownTime());
              boolean accepted = "ACCEPTED".equals(decision);
              if (accepted) presses++;
              data.put("accepted", accepted).put("decision", decision).put("presses", presses)
                .put("musicActive", ((AudioManager)context.getSystemService(Context.AUDIO_SERVICE)).isMusicActive());
              emit("KEY", data);
              if (accepted && voiceTrial && presses == 1) startVoice();
              if (!voiceTrial && accepted && presses == 10) new Handler(Looper.getMainLooper()).postDelayed(() -> done.countDown(), 500);
              return relevant; // Never delegate play/pause to a player or to the TTS service.
            } catch (Exception e) { emit("CALLBACK_ERROR", new JSONObject()); return true; }
          }
        }, new Handler(Looper.getMainLooper()));
        session.setPlaybackState(new PlaybackState.Builder()
          .setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
          .setState(PlaybackState.STATE_PAUSED, 0, 0).build());
        session.setActive(true);
        if (activationCue) {
          try {
            if (((AudioManager)context.getSystemService(Context.AUDIO_SERVICE)).isMusicActive())
              throw new IllegalStateException("External audio already active");
            int id = context.getResources().getIdentifier("run_notice", "raw", context.getPackageName());
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            try (android.content.res.AssetFileDescriptor fd = context.getResources().openRawResourceFd(id)) {
              player.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            }
            player.setOnCompletionListener(p -> {
              p.release();
              session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
                .setState(PlaybackState.STATE_PAUSED, 0, 0).build());
              emit("ACTIVATION_CUE_COMPLETED", new JSONObject());
            });
            player.setOnErrorListener((p, what, extra) -> { p.release(); emit("ACTIVATION_CUE_FAILED", new JSONObject()); return true; });
            player.prepare(); player.start();
            session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE)
              .setState(PlaybackState.STATE_PLAYING, 0, 1).build());
          } catch (Exception e) { throw new IllegalStateException("Activation cue failed", e); }
        }
      });
      emit("READY", new JSONObject().put("sessionState", session.getController().getPlaybackState().getState()).put("audioFocusRequested", false)
        .put("audioPlaybackStarted", activationCue).put("durationSeconds", duration));
      if (voiceTrial) {
        boolean terminal = false;
        while (SystemClock.elapsedRealtime() - began < duration * 1000L && done.getCount() > 0) {
          if (!terminal) terminal = voiceComplete();
          if (terminal && presses >= 11) break;
          Thread.sleep(200);
        }
      } else done.await(duration, TimeUnit.SECONDS);
      result.putInt("presses", presses);
      emit("FINISHED", new JSONObject().put("presses", presses).put("durationMs", SystemClock.elapsedRealtime() - began));
    } catch (Exception e) { result.putString("failure", e.getClass().getSimpleName()); }
    finally {
      runOnMainSync(() -> { if (session != null) { session.setActive(false); session.release(); session = null; } });
      if (lock != null && lock.isHeld()) lock.release();
    }
    finish(result.containsKey("failure") ? Activity.RESULT_CANCELED : Activity.RESULT_OK, result);
  }
}
