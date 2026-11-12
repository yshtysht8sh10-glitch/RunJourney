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
  @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
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
