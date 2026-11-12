package app.runjourney.markerprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import java.io.File;
import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.security.MessageDigest;
import org.json.JSONObject;

/** Read-only hashes. Output is private evidence, never a repository/CI artifact. */
public final class MarkerInventory extends Instrumentation {
  private boolean readMarker;
  private boolean cryptoCheck;
  @Override public void onCreate(Bundle args) { super.onCreate(args); readMarker = "true".equals(args.getString("readMarker")); cryptoCheck = "true".equals(args.getString("cryptoCheck")); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      if (!"app.runjourney.mobile.test".equals(getTargetContext().getPackageName())) throw new SecurityException();
      JSONObject hashes = new JSONObject();
      File diagnostic = new File(getTargetContext().getNoBackupFilesDir(), "detector-journal-v1");
      File voice = new File(getTargetContext().getFilesDir(), "voice-log-v2");
      visit(diagnostic, diagnostic, "diagnostic/", hashes);
      visit(voice, voice, "voice/", hashes);
      result.putString("hashes", hashes.toString());
      if (cryptoCheck) {
        android.content.Context c = getTargetContext();
        Class<?> service = Class.forName("app.runjourney.announcer.RunMarkerService", true, c.getClassLoader());
        Object companion = service.getDeclaredField("Companion").get(null);
        java.lang.reflect.Method keyMethod = companion.getClass().getDeclaredMethod("key"); keyMethod.setAccessible(true);
        javax.crypto.SecretKey key = (javax.crypto.SecretKey)keyMethod.invoke(companion);
        javax.crypto.Cipher encoder = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        encoder.init(javax.crypto.Cipher.ENCRYPT_MODE, key);
        byte[] iv = encoder.getIV();
        byte[] plain = "synthetic-marker-keystore-check".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] encrypted = encoder.doFinal(plain);
        javax.crypto.Cipher decoder = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
        decoder.init(javax.crypto.Cipher.DECRYPT_MODE, key, new javax.crypto.spec.GCMParameterSpec(128, iv));
        if (iv.length != 12 || !java.util.Arrays.equals(plain, decoder.doFinal(encrypted))) throw new IllegalStateException("Keystore roundtrip");
        encrypted[0] ^= 1;
        boolean rejected = false;
        try { decoder.init(javax.crypto.Cipher.DECRYPT_MODE, key, new javax.crypto.spec.GCMParameterSpec(128, iv)); decoder.doFinal(encrypted); }
        catch (javax.crypto.AEADBadTagException expected) { rejected = true; }
        if (!rejected) throw new IllegalStateException("Tamper not rejected");
        result.putString("cryptoCheck", "KEYSTORE_PROVIDER_IV_ROUNDTRIP_AND_TAMPER_PASS");
      }
      if (readMarker) {
        android.content.Context c = getTargetContext();
        ClassLoader loader = c.getClassLoader();
        Class<?> service = Class.forName("app.runjourney.announcer.RunMarkerService", true, loader);
        Object companion = service.getDeclaredField("Companion").get(null);
        java.lang.reflect.Method keyMethod = companion.getClass().getDeclaredMethod("key"); keyMethod.setAccessible(true);
        javax.crypto.SecretKey key = (javax.crypto.SecretKey)keyMethod.invoke(companion);
        String name = c.getSharedPreferences("runjourney-markers", 0).getString("last", "");
        if (name == null || !name.matches("[0-9a-f-]{36}\\.jsonl")) throw new IllegalStateException("No marker session");
        Class<?> log = Class.forName("app.runjourney.announcer.MarkerLog", true, loader);
        Object reader = log.getDeclaredField("Companion").get(null);
        Object marker = reader.getClass().getMethod("read", File.class, javax.crypto.SecretKey.class)
          .invoke(reader, new File(c.getNoBackupFilesDir(), "run-markers-v1/" + name), key);
        result.putString("marker", marker.toString()); // Local/private output only. Never returns key bytes.
        org.json.JSONArray voiceTrial = new org.json.JSONArray();
        File[] chunks = new File(c.getFilesDir(), "voice-log-marker-v33").listFiles();
        if (chunks != null) for (File chunk : chunks) {
          for (String line : java.nio.file.Files.readAllLines(chunk.toPath())) {
            int tab = line.indexOf('\t'); if (tab < 0) continue;
            JSONObject record = new JSONObject(line.substring(tab + 1));
            if (!record.optString("id").startsWith("marker-preview-")) continue;
            JSONObject safe = new JSONObject();
            for (String field : new String[]{"id", "type", "status", "loggedAt", "startedAt", "generatedAt", "nativeQueuedAt", "queueWaitMs"})
              if (record.has(field)) safe.put(field, record.get(field));
            voiceTrial.put(safe);
          }
        }
        result.putString("voiceTrial", voiceTrial.toString());
      }
      finish(Activity.RESULT_OK, result);
    } catch (Exception e) { result.putString("failure", e.getClass().getSimpleName()); finish(Activity.RESULT_CANCELED, result); }
  }
  private void visit(File root, File item, String prefix, JSONObject hashes) throws Exception {
    if (!item.exists()) throw new IllegalStateException("Preservation root missing");
    if (item.isDirectory()) {
      File[] children = item.listFiles(); if (children == null) throw new IllegalStateException("List failed");
      for (File child : children) visit(root, child, prefix, hashes);
      return;
    }
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(item))) {
      byte[] buffer = new byte[65536]; int count;
      while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
    }
    StringBuilder hash = new StringBuilder(); for (byte b : digest.digest()) hash.append(String.format("%02x", b & 255));
    hashes.put(prefix + root.toPath().relativize(item.toPath()), new JSONObject().put("bytes", item.length()).put("sha256", hash.toString()));
  }
}
