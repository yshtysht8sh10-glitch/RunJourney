package app.runjourney.rescue;

import app.runjourney.storage.IsolatedFileStore;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class IsolatedFileStoreTest {
    private static final String HISTORY = "@runjourney/runs/v1", DRAFT = "@runjourney/active-run/v1";
    private File root() throws Exception { return Files.createTempDirectory("isolated-store-").toFile(); }

    @Test public void hugeValuesSurviveRecreatingStoreWithoutCursorWindow() throws Exception {
        File appFiles = root();
        String history = new JSONObject().put("raw", "庭先🏃\u0000".repeat(1000000)).toString();
        IsolatedFileStore first = new IsolatedFileStore(appFiles);
        first.setItem(HISTORY, history); first.setItem(DRAFT, history);
        assertEquals(history, new IsolatedFileStore(appFiles).getItem(HISTORY));
        assertEquals(history, new IsolatedFileStore(appFiles).getItem(DRAFT));
    }

    @Test public void interruptedCommitRollsBackAndRetryPersists() throws Exception {
        File appFiles = root();
        new IsolatedFileStore(appFiles).setItem(DRAFT, "frozen-stop");
        IsolatedFileStore failing = new IsolatedFileStore(appFiles) {
            @Override protected void beforeCommit() throws Exception { throw new java.io.IOException("simulated full disk/interruption"); }
        };
        try { failing.setItem(DRAFT, "replacement"); fail(); } catch (java.io.IOException expected) { }
        assertEquals("frozen-stop", new IsolatedFileStore(appFiles).getItem(DRAFT));
        new IsolatedFileStore(appFiles).setItem(DRAFT, "replacement");
        assertEquals("replacement", new IsolatedFileStore(appFiles).getItem(DRAFT));
    }

    @Test public void tombstoneIsDurableAndOnlyTouchesNewStore() throws Exception {
        File appFiles = root();
        File sentinel = new File(appFiles, "RKStorage");
        Files.write(sentinel.toPath(), "legacy23-plus-draft".getBytes(StandardCharsets.UTF_8));
        String hash = RescueEngine.hash(sentinel);
        IsolatedFileStore store = new IsolatedFileStore(appFiles);
        assertNull(store.getItem(DRAFT));
        assertFalse(new File(appFiles, IsolatedFileStore.DIRECTORY).exists());
        store.setItem(DRAFT, "new"); store.removeItem(DRAFT);
        assertNull(new IsolatedFileStore(appFiles).getItem(DRAFT));
        assertEquals(hash, RescueEngine.hash(sentinel));
    }

    @Test public void malformedAndTamperedFilesFailClosedWithoutOverwriting() throws Exception {
        File appFiles = root(); IsolatedFileStore store = new IsolatedFileStore(appFiles);
        store.setItem(HISTORY, "[]");
        File value = new File(new File(appFiles, IsolatedFileStore.DIRECTORY), "key-0.json");
        JSONObject content = new JSONObject(new String(Files.readAllBytes(value.toPath()), StandardCharsets.UTF_8));
        content.put("value", "[changed]"); Files.write(value.toPath(), content.toString().getBytes(StandardCharsets.UTF_8));
        String hash = RescueEngine.hash(value);
        try { store.getItem(HISTORY); fail(); } catch (java.io.IOException expected) { }
        assertEquals(hash, RescueEngine.hash(value));
        Files.write(value.toPath(), "broken-json".getBytes(StandardCharsets.UTF_8));
        try { store.getItem(HISTORY); fail(); } catch (org.json.JSONException expected) { }
    }

    @Test public void keyTraversalIsRejectedBeforeCreatingDirectory() throws Exception {
        File appFiles = root(); IsolatedFileStore store = new IsolatedFileStore(appFiles);
        try { store.setItem("../../databases/RKStorage", "overwrite"); fail(); } catch (java.io.IOException expected) { }
        assertFalse(new File(appFiles, IsolatedFileStore.DIRECTORY).exists());
    }

    @Test public void exactRescued23AndDraftStayUnchangedInProtectedDatabaseCopy() throws Exception {
        File workspace = new File(System.getProperty("user.dir"), "../../..").getCanonicalFile();
        File pointer = new File(workspace, ".expo/rescue-active-root.txt");
        // Optional real incident fixture on this PC; synthetic large fixture is
        // always exercised above. Source preservation files are read only.
        org.junit.Assume.assumeTrue(pointer.isFile());
        File evidence = new File(new String(Files.readAllBytes(pointer.toPath()), StandardCharsets.UTF_8).trim(), "session-original");
        JSONObject manifest = new JSONObject(new String(Files.readAllBytes(new File(evidence, "manifest.json").toPath()), StandardCharsets.UTF_8));
        File fixture = root(), files = new File(fixture, "files"), databases = new File(fixture, "databases");
        assertTrue(databases.mkdir());
        File source = new File(evidence, "raw-source/RKStorage"), protectedCopy = new File(databases, "RKStorage");
        String sourceHash = RescueEngine.hash(source);
        Files.copy(source.toPath(), protectedCopy.toPath());
        IsolatedFileStore store = new IsolatedFileStore(files);
        assertNull(store.getItem(HISTORY)); assertNull(store.getItem(DRAFT));
        for (int i = 0; i < manifest.getJSONArray("entries").length(); i++) {
            JSONObject entry = manifest.getJSONArray("entries").getJSONObject(i);
            if (!entry.getString("key").equals(HISTORY) && !entry.getString("key").equals(DRAFT)) continue;
            String bytes = new String(Files.readAllBytes(new File(evidence, entry.getString("file")).toPath()), StandardCharsets.UTF_8);
            store.setItem(entry.getString("key"), bytes);
            assertEquals(bytes, new IsolatedFileStore(files).getItem(entry.getString("key")));
        }
        store.removeItem(DRAFT);
        assertEquals(sourceHash, RescueEngine.hash(source));
        assertEquals(sourceHash, RescueEngine.hash(protectedCopy));
    }
}
