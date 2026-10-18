package app.runjourney.rescue;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Reads source files only. Every SQLite operation targets a separate working copy. */
public class RescueEngine {
    public static final int CHUNK_BYTES = 64 * 1024;
    static final String INVENTORY = "SELECT rowid, length(CAST(key AS BLOB)), length(CAST(value AS BLOB)), typeof(value) FROM catalystLocalStorage ORDER BY rowid";
    static final String CHUNK = "SELECT substr(CAST(value AS BLOB), ?, ?) FROM catalystLocalStorage WHERE rowid = ?";
    private static final String[] SUFFIXES = {"", "-wal", "-shm", "-journal"};
    private static final String[] EXPECTED_KEYS = {"@runjourney/runs/v1", "@runjourney/active-run/v1",
            "@runjourney/run-features/v1", "@runjourney/voice-announcement/v1", "@runjourney/voice-items/v1"};

    public File rescue(File source, File outputRoot) throws Exception {
        File original = source.getCanonicalFile();
        File root = outputRoot.getCanonicalFile();
        String protectedDirectory = original.getParentFile().getPath();
        if (root.getPath().equals(protectedDirectory) || root.getPath().startsWith(protectedDirectory + File.separator))
            throw new IOException("Output must be outside the source database directory");
        if (!original.isFile()) throw new IOException("Existing RKStorage not found; refusing to create a database");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create output directory");
        File session = new File(root, "rescue-" + System.currentTimeMillis() + "-" + UUID.randomUUID());
        if (!session.mkdir()) throw new IOException("Cannot create a new rescue session");
        JSONObject manifest = new JSONObject();
        manifest.put("format", "runjourney-read-only-rescue").put("schemaVersion", 1)
                .put("chunkBytes", CHUNK_BYTES).put("sourceDatabase", original.getPath())
                .put("status", "incomplete").put("sourceUnchanged", false)
                .put("expectedKeys", new JSONArray(EXPECTED_KEYS));
        try {
            File raw = new File(session, "raw-source"), working = new File(session, "working"), values = new File(session, "values");
            if (!raw.mkdir() || !working.mkdir() || !values.mkdir()) throw new IOException("Cannot create rescue subdirectories");
            Map<String, JSONObject> before = fingerprints(original);
            manifest.put("sourceBefore", asJson(before));
            for (String name : before.keySet()) copyNew(new File(original.getParentFile(), name), new File(raw, name));
            afterSnapshotCopied();
            Map<String, JSONObject> after = fingerprints(original);
            manifest.put("sourceAfterCopy", asJson(after));
            if (!same(before, after) || !sameContent(before, directoryFingerprints(raw, before)))
                throw new IOException("Source DB/sidecars changed during copy; retained snapshot is not marked consistent");
            for (String name : before.keySet()) copyNew(new File(raw, name), new File(working, name));
            manifest.put("rawSourceFiles", asJson(directoryFingerprints(raw, before)));
            // Never use SQLiteOpenHelper / ReactDatabaseSupplier: their open/retry
            // paths can create, migrate or delete storage. No original DB is opened.
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(new File(working, original.getName()).getPath(), null,
                    SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS)) {
                if (!db.isReadOnly()) throw new IOException("Working connection is not read-only");
                manifest.put("sqliteReadOnly", true);
                try (Cursor cursor = db.rawQuery("PRAGMA quick_check", null)) {
                    if (!cursor.moveToFirst() || !"ok".equals(cursor.getString(0))) throw new IOException("Copied SQLite quick_check failed");
                }
                manifest.put("quickCheck", "ok");
                JSONArray entries = new JSONArray();
                manifest.put("entries", entries);
                // Inventory never includes whole values (nor potentially huge keys).
                try (Cursor cursor = db.rawQuery(INVENTORY, null)) {
                    while (cursor.moveToNext()) {
                        if (entries.length() >= 100000) throw new IOException("Excessive key count; raw snapshot retained");
                        long rowId = cursor.getLong(0), keyBytes = cursor.getLong(1), byteCount = cursor.getLong(2);
                        JSONObject entry = new JSONObject().put("rowId", rowId).put("keyBytes", keyBytes)
                                .put("bytes", byteCount).put("sqliteType", cursor.getString(3));
                        entries.put(entry);
                        if (cursor.isNull(2)) throw new IOException("Unexpected NULL value; raw snapshot retained");
                        if (keyBytes <= 8192) {
                            try (Cursor key = db.rawQuery("SELECT CAST(key AS BLOB) FROM catalystLocalStorage WHERE rowid = ?", new String[]{Long.toString(rowId)})) {
                                if (!key.moveToFirst()) throw new IOException("Missing key row");
                                entry.put("key", new String(key.getBlob(0), StandardCharsets.UTF_8));
                            }
                        } else entry.put("keyNotice", "Oversized key: preserved in raw SQLite only");
                        File value = new File(values, "row-" + rowId + ".bin");
                        MessageDigest digest = MessageDigest.getInstance("SHA-256");
                        try (BufferedOutputStream out = new BufferedOutputStream(Files.newOutputStream(value.toPath(), StandardOpenOption.CREATE_NEW))) {
                            for (long offset = 0; offset < byteCount; ) {
                                int requested = (int) Math.min(CHUNK_BYTES, byteCount - offset);
                                try (Cursor part = db.rawQuery(CHUNK, new String[]{Long.toString(offset + 1), Integer.toString(requested), Long.toString(rowId)})) {
                                    if (!part.moveToFirst()) throw new IOException("Missing chunk row");
                                    byte[] bytes = part.getBlob(0);
                                    if (bytes.length != requested) throw new IOException("Short/inconsistent chunk");
                                    out.write(bytes); digest.update(bytes); offset += bytes.length;
                                }
                            }
                        }
                        String sha = hex(digest.digest());
                        if (value.length() != byteCount || !sha.equals(hash(value))) throw new IOException("Written value verification failed");
                        entry.put("file", "values/" + value.getName()).put("sha256", sha).put("verifiedBytes", true);
                    }
                }
                manifest.put("keyCount", entries.length());
            }
            Map<String, JSONObject> finalSource = fingerprints(original);
            manifest.put("sourceAfterRescue", asJson(finalSource));
            if (!same(before, finalSource)) throw new IOException("Source changed during rescue; investigate external writer");
            manifest.put("sourceUnchanged", true).put("status", "bytes-exported-awaiting-pc-validation");
        } catch (Exception error) {
            manifest.put("status", "failed").put("errorClass", error.getClass().getName()).put("error", String.valueOf(error.getMessage()));
            writeNew(new File(session, "manifest.json"), manifest.toString(2).getBytes(StandardCharsets.UTF_8));
            throw new IOException("Rescue stopped; partial evidence retained at " + session + ": " + error.getMessage(), error);
        }
        writeNew(new File(session, "manifest.json"), manifest.toString(2).getBytes(StandardCharsets.UTF_8));
        return session;
    }

    /** Test seam for a simulated concurrent writer; production implementation is empty. */
    protected void afterSnapshotCopied() throws Exception { }

    private static Map<String, JSONObject> fingerprints(File database) throws Exception {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (String suffix : SUFFIXES) {
            File file = new File(database.getPath() + suffix);
            if (file.exists()) {
                if (!file.isFile()) throw new IOException("Source sidecar is not a regular file");
                result.put(file.getName(), fingerprint(file));
            }
        }
        if (!result.containsKey(database.getName())) throw new IOException("Source database disappeared");
        return result;
    }

    private static Map<String, JSONObject> directoryFingerprints(File directory, Map<String, JSONObject> names) throws Exception {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (String name : names.keySet()) result.put(name, fingerprint(new File(directory, name)));
        return result;
    }
    private static JSONObject fingerprint(File file) throws Exception {
        return new JSONObject().put("bytes", file.length()).put("sha256", hash(file)).put("modifiedMs", file.lastModified());
    }
    private static boolean same(Map<String, JSONObject> a, Map<String, JSONObject> b) throws Exception {
        if (!sameContent(a, b)) return false;
        for (String key : a.keySet()) if (a.get(key).getLong("modifiedMs") != b.get(key).getLong("modifiedMs")) return false;
        return true;
    }
    private static boolean sameContent(Map<String, JSONObject> a, Map<String, JSONObject> b) throws Exception {
        if (!a.keySet().equals(b.keySet())) return false;
        for (String key : a.keySet()) if (a.get(key).getLong("bytes") != b.get(key).getLong("bytes")
                || !a.get(key).getString("sha256").equals(b.get(key).getString("sha256"))) return false;
        return true;
    }
    private static JSONObject asJson(Map<String, JSONObject> map) throws Exception {
        JSONObject json = new JSONObject();
        for (Map.Entry<String, JSONObject> entry : map.entrySet()) json.put(entry.getKey(), entry.getValue());
        return json;
    }
    private static void copyNew(File from, File to) throws Exception {
        try (FileInputStream in = new FileInputStream(from);
             BufferedOutputStream out = new BufferedOutputStream(Files.newOutputStream(to.toPath(), StandardOpenOption.CREATE_NEW))) {
            byte[] buffer = new byte[CHUNK_BYTES]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
        }
    }
    private static void writeNew(File file, byte[] bytes) throws IOException {
        try (java.io.OutputStream out = Files.newOutputStream(file.toPath(), StandardOpenOption.CREATE_NEW)) { out.write(bytes); }
    }
    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[CHUNK_BYTES]; int count;
            while ((count = in.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
