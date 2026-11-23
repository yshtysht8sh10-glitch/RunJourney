package app.runjourney.rescue;

import android.database.Cursor;
import android.database.CursorWindow;
import android.database.sqlite.SQLiteBlobTooBigException;
import android.database.sqlite.SQLiteCursor;
import android.database.sqlite.SQLiteDatabase;
import android.content.pm.PackageInfo;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.SQLiteMode;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
public class RescueEngineTest {
    private File fixture() throws Exception {
        File db = new File(Files.createTempDirectory("rescue-fixture-").toFile(), "RKStorage");
        try (SQLiteDatabase connection = SQLiteDatabase.openOrCreateDatabase(db, null)) {
            connection.execSQL("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        }
        return db;
    }
    private void insert(SQLiteDatabase db, String key, String value) {
        db.execSQL("INSERT INTO catalystLocalStorage(key,value) VALUES(?,?)", new Object[]{key, value});
    }
    private JSONObject manifest(File session) throws Exception {
        return new JSONObject(new String(Files.readAllBytes(new File(session, "manifest.json").toPath()), StandardCharsets.UTF_8));
    }
    private File output() throws Exception { return Files.createTempDirectory("rescue-output-").toFile(); }

    @Test public void wholeValueFailsInNativeCursorWindowButSameRowIsRescuedInChunks() throws Exception {
        File original = fixture();
        String text = "庭先🏃足踏み\u0000".repeat(300000);
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(original.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            insert(db, "@runjourney/active-run/v1", text);
            // Exercise actual native SQLite/CursorWindow on PC, not an AsyncStorage mock.
            try (Cursor cursor = db.rawQuery("SELECT key,value FROM catalystLocalStorage WHERE key IN (?)", new String[]{"@runjourney/active-run/v1"})) {
                ((SQLiteCursor) cursor).setWindow(new CursorWindow("whole-value", 2L * 1024 * 1024));
                try { cursor.getCount(); fail("Whole value must not fit a 2MiB native window"); }
                catch (SQLiteBlobTooBigException expected) { assertTrue(expected.getMessage().contains("Row too big")); }
            }
        }
        String before = RescueEngine.hash(original);
        File session = new RescueEngine().rescue(original, output());
        JSONObject report = manifest(session);
        assertTrue(report.getBoolean("sourceUnchanged"));
        assertEquals("bytes-exported-awaiting-pc-validation", report.getString("status"));
        byte[] rescued = Files.readAllBytes(new File(session, report.getJSONArray("entries").getJSONObject(0).getString("file")).toPath());
        assertArrayEquals(text.getBytes(StandardCharsets.UTF_8), rescued);
        assertEquals(before, RescueEngine.hash(original));
    }

    @Test public void largeHistoryAndDraftPreserveIdsUnknownFieldsGpsAndAllBytes() throws Exception {
        File original = fixture();
        JSONArray history = new JSONArray();
        for (int i = 0; i < 4; i++) history.put(new JSONObject().put("id", "run-" + i).put("startedAt", "2026-10-08T00:00:00Z")
                .put("endedAt", "2026-10-08T00:01:00Z").put("points", new JSONArray().put(new JSONObject().put("latitude", 35.0).put("longitude", 139.0).put("timestamp", 1791417600000L)))
                .put("events", new JSONArray()).put("unknownField", "保存😀".repeat(300000)));
        JSONObject draft = new JSONObject(history.getJSONObject(0).toString()).put("id", "draft");
        String[] keys = {"@runjourney/runs/v1", "@runjourney/active-run/v1", "unknown-key", "empty-key"};
        String[] values = {history.toString(), draft.toString(), "非JSON\u0000raw", ""};
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(original.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            for (int i = 0; i < keys.length; i++) insert(db, keys[i], values[i]);
        }
        File session = new RescueEngine().rescue(original, output());
        JSONArray entries = manifest(session).getJSONArray("entries");
        assertEquals(4, entries.length());
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i);
            assertEquals(keys[i], entry.getString("key"));
            assertArrayEquals(values[i].getBytes(StandardCharsets.UTF_8), Files.readAllBytes(new File(session, entry.getString("file")).toPath()));
        }
        // Keep one generated session for the independent Python verifier; never a device DB.
        File target = new File(System.getProperty("user.dir"), "build/pc-rescue-fixture-location.txt");
        target.getParentFile().mkdirs();
        Files.write(target.toPath(), session.getPath().getBytes(StandardCharsets.UTF_8));
    }

    @Test public void committedWalDataIsIncludedWithoutCheckpointingOriginal() throws Exception {
        File original = fixture();
        try (SQLiteDatabase writer = SQLiteDatabase.openDatabase(original.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            assertTrue(writer.enableWriteAheadLogging());
            insert(writer, "@runjourney/runs/v1", "[]");
            File wal = new File(original + "-wal");
            assertTrue(wal.isFile());
            String dbHash = RescueEngine.hash(original), walHash = RescueEngine.hash(wal);
            File session = new RescueEngine().rescue(original, output());
            assertEquals(1, manifest(session).getInt("keyCount"));
            assertEquals(dbHash, RescueEngine.hash(original)); assertEquals(walHash, RescueEngine.hash(wal));
        }
    }

    @Test public void changingSourceIsRejectedAndPartialSnapshotRetained() throws Exception {
        File original = fixture(), root = output();
        RescueEngine engine = new RescueEngine() {
            @Override protected void afterSnapshotCopied() throws Exception {
                // Simulate an external writer. This write is fixture/test-only.
                try (SQLiteDatabase db = SQLiteDatabase.openDatabase(original.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) { insert(db, "concurrent", "changed"); }
            }
        };
        try { engine.rescue(original, root); fail("Must reject concurrent source changes"); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("changed during copy")); }
        File[] sessions = root.listFiles(); assertNotNull(sessions); assertEquals(1, sessions.length);
        assertEquals("failed", manifest(sessions[0]).getString("status"));
        assertTrue(new File(sessions[0], "raw-source/RKStorage").isFile());
    }

    @Test public void missingOrCorruptDatabaseNeverGetsCreatedDeletedOrRepaired() throws Exception {
        File original = new File(output(), "RKStorage");
        try { new RescueEngine().rescue(original, output()); fail(); } catch (java.io.IOException expected) { }
        assertFalse(original.exists());
        Files.write(original.toPath(), "not-a-sqlite-database".getBytes(StandardCharsets.UTF_8));
        String before = RescueEngine.hash(original);
        try { new RescueEngine().rescue(original, output()); fail(); } catch (java.io.IOException expected) { }
        assertEquals(before, RescueEngine.hash(original));
    }

    @Test public void overlappingOutputRejectedBeforeCreatingAnything() throws Exception {
        File original = fixture(), root = new File(original.getParentFile(), "rescue");
        try { new RescueEngine().rescue(original, root); fail(); } catch (java.io.IOException expected) { }
        assertFalse(root.exists());
    }

    @Test public void applicationAndActivityStartupDoNotTouchExistingDatabase() throws Exception {
        File original = RuntimeEnvironment.getApplication().getDatabasePath("RKStorage");
        original.getParentFile().mkdirs();
        Files.write(original.toPath(), "startup-sentinel".getBytes(StandardCharsets.UTF_8));
        String before = RescueEngine.hash(original);
        try (var controller = Robolectric.buildActivity(RescueActivity.class).setup()) {
            assertEquals(before, RescueEngine.hash(original));
            assertTrue(RuntimeEnvironment.getApplication() instanceof RescueApplication);
            PackageInfo info = RuntimeEnvironment.getApplication().getPackageManager().getPackageInfo("app.runjourney.mobile.test",
                    android.content.pm.PackageManager.GET_PROVIDERS | android.content.pm.PackageManager.GET_SERVICES | android.content.pm.PackageManager.GET_RECEIVERS);
            assertTrue(info.providers == null || info.providers.length == 0);
            assertTrue(info.services == null || info.services.length == 0);
            assertTrue(info.receivers == null || info.receivers.length == 0);
        }
    }
}
