package app.runjourney.storage;

import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.security.MessageDigest;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.StandardCopyOption;

/** Separate files only. No SQLite, old DB, shared preferences, migration or fallback. */
public class IsolatedFileStore {
    public static final String DIRECTORY = "runjourney-isolated-kv-v1";
    private static final Object LOCK = new Object();
    private static final List<String> KEYS = Arrays.asList("@runjourney/runs/v1", "@runjourney/active-run/v1",
        "@runjourney/run-features/v1", "@runjourney/voice-announcement/v1", "@runjourney/voice-items/v1");
    private final File root;

    public IsolatedFileStore(File appFiles) { root = new File(appFiles, DIRECTORY); }

    private File file(String key) throws IOException {
        int index = KEYS.indexOf(key);
        if (index < 0) throw new IOException("Unsupported isolated storage key");
        return new File(root, "key-" + index + ".json");
    }

    public String getItem(String key) throws Exception {
        synchronized (LOCK) {
            byte[] bytes;
            try { bytes = Files.readAllBytes(file(key).toPath()); }
            catch (NoSuchFileException missing) { return null; }
                JSONObject envelope = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                if (envelope.getInt("schemaVersion") != 1 || !key.equals(envelope.getString("key")) || !envelope.has("value"))
                    throw new IOException("Invalid isolated file format; preserved for investigation");
                Object value = envelope.get("value");
                if (value == JSONObject.NULL) {
                    if (!digest(null).equals(envelope.getString("sha256"))) throw new IOException("Isolated tombstone checksum mismatch");
                    return null;
                }
                if (!(value instanceof String)) throw new IOException("Invalid isolated value; preserved for investigation");
                if (!digest((String) value).equals(envelope.getString("sha256"))) throw new IOException("Isolated value checksum mismatch");
                return (String) value;
        }
    }

    public void setItem(String key, String value) throws Exception {
        synchronized (LOCK) {
            File file = file(key);
            if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create isolated storage directory");
            byte[] bytes = new JSONObject().put("schemaVersion", 1).put("key", key)
                .put("value", value == null ? JSONObject.NULL : value).put("sha256", digest(value)).toString().getBytes(StandardCharsets.UTF_8);
            File pending = new File(file + ".pending");
            try (FileOutputStream out = new FileOutputStream(pending)) {
                out.write(bytes);
                beforeCommit();
                out.getFD().sync();
            }
            // Same directory/filesystem. If atomic replacement is unsupported,
            // throw; never fall back to delete-then-move or touch the old DB.
            Files.move(pending.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            String stored = getItem(key);
            if (value == null ? stored != null : !value.equals(stored)) throw new IOException("Isolated write verification failed");
        }
    }

    /** A durable tombstone only in the NEW store; never deletes any legacy file. */
    public void removeItem(String key) throws Exception { setItem(key, null); }
    protected void beforeCommit() throws Exception { }
    private static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest((value == null ? "N" : "S" + value).getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte part : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", part & 255));
        return result.toString();
    }
}
