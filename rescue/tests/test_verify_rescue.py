"""Independent PC verifier failures must preserve every fixture/export byte."""
import hashlib
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("verify_rescue", Path(__file__).parents[1] / "verify_rescue.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
HISTORY = "@runjourney/runs/v1"
DRAFT = "@runjourney/active-run/v1"


class VerifyTests(unittest.TestCase):
    def fixture(self, rows):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for directory in ("raw-source", "working", "values"):
            (root / directory).mkdir()
        database = root / "working/RKStorage"
        with closing(sqlite3.connect(database)) as db:
            db.execute("CREATE TABLE catalystLocalStorage(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            for key, value in rows:
                db.execute("INSERT INTO catalystLocalStorage VALUES(?,?)", (key, value))
            db.commit()
        raw = database.read_bytes()
        (root / "raw-source/RKStorage").write_bytes(raw)
        source = {"RKStorage": {"bytes": len(raw), "sha256": module.sha(raw), "modifiedMs": 123}}
        entries = []
        for row_id, (key, value) in enumerate(rows, 1):
            data = value.encode("utf-8") if isinstance(value, str) else value
            file = f"values/row-{row_id}.bin"
            (root / file).write_bytes(data)
            entries.append({"rowId": row_id, "key": key, "bytes": len(data), "sha256": module.sha(data), "file": file})
        manifest = {"format": "runjourney-read-only-rescue", "schemaVersion": 1,
                    "status": "bytes-exported-awaiting-pc-validation", "sourceUnchanged": True,
                    "sourceBefore": source, "sourceAfterCopy": source, "sourceAfterRescue": source,
                    "entries": entries, "keyCount": len(entries), "expectedKeys": [HISTORY, DRAFT]}
        self.write_manifest(root, manifest)
        return root, manifest

    def write_manifest(self, root, manifest):
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def fingerprints(self, root):
        return {str(file.relative_to(root)): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in root.rglob("*") if file.is_file()}

    def rejected_without_changes(self, root, message):
        before = self.fingerprints(root)
        with self.assertRaisesRegex(ValueError, message):
            module.verify(root)
        self.assertEqual(before, self.fingerprints(root))

    def test_large_json_history_draft_unknown_fields_and_saved_draft_overlap(self):
        run = {"id": "same-id", "startedAt": "2026-10-08T00:00:00Z", "points": [{"latitude": 35, "longitude": 139}],
               "events": [], "unknown": "庭先🏃足踏み" * 300000}
        root, _ = self.fixture([(HISTORY, json.dumps([run], ensure_ascii=False)),
                                (DRAFT, json.dumps(run, ensure_ascii=False)), ("opaque", b"\xff\x00raw")])
        before = self.fingerprints(root)
        result = module.verify(root)
        self.assertEqual(1, result["historyCount"])
        self.assertTrue(result["draftIdAlsoInHistory"])
        self.assertGreater(result["entries"][1]["bytes"], 2 * 1024 * 1024)
        self.assertEqual(1, result["draft"]["gpsCount"])
        self.assertEqual(before, self.fingerprints(root))

    def test_present_empty_history_distinguished_from_missing_history(self):
        root, _ = self.fixture([(HISTORY, "[]")])
        self.assertEqual(0, module.verify(root)["historyCount"])
        root, _ = self.fixture([("opaque", "")])
        result = module.verify(root)
        self.assertIsNone(result["historyCount"])
        self.assertIn(HISTORY, result["missingExpectedKeys"])

    def test_truncated_value_rejected(self):
        root, _ = self.fixture([(HISTORY, "[]")])
        (root / "values/row-1.bin").write_bytes(b"[")
        self.rejected_without_changes(root, "hash/size mismatch")

    def test_raw_database_corruption_rejected(self):
        root, _ = self.fixture([(HISTORY, "[]")])
        with (root / "raw-source/RKStorage").open("ab") as out:
            out.write(b"tamper")
        self.rejected_without_changes(root, "snapshot hash mismatch")

    def test_manifest_key_tampering_rejected(self):
        root, manifest = self.fixture([(HISTORY, "[]")])
        manifest["entries"][0]["key"] = "opaque"
        self.write_manifest(root, manifest)
        self.rejected_without_changes(root, "key differs")

    def test_path_escape_rejected(self):
        root, manifest = self.fixture([(HISTORY, "[]")])
        manifest["entries"][0]["file"] = "../outside.bin"
        self.write_manifest(root, manifest)
        self.rejected_without_changes(root, "escapes session")

    def test_failed_snapshot_rejected(self):
        root, manifest = self.fixture([(HISTORY, "[]")])
        manifest["status"] = "failed"
        self.write_manifest(root, manifest)
        self.rejected_without_changes(root, "Rescue failed")

    def test_invalid_json_duplicate_members_and_nonfinite_numbers_rejected(self):
        for value in ('{', '[{"id":"a","id":"b"}]', '[NaN]', '[1e999]'):
            with self.subTest(value=value):
                root, _ = self.fixture([(HISTORY, value)])
                before = self.fingerprints(root)
                with self.assertRaises(ValueError):
                    module.verify(root)
                self.assertEqual(before, self.fingerprints(root))

    def test_invalid_utf8_expected_history_is_retained(self):
        root, _ = self.fixture([(HISTORY, b"\xff")])
        self.rejected_without_changes(root, "decode")

    def test_duplicate_run_ids_rejected_and_retained(self):
        run = {"id": "duplicate", "startedAt": "2026-10-08T00:00:00Z", "points": []}
        root, _ = self.fixture([(HISTORY, json.dumps([run, run]))])
        self.rejected_without_changes(root, "Duplicate history IDs")


if __name__ == "__main__":
    unittest.main()
