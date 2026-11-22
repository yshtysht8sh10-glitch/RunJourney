"""PC-only verification. Reads exports/copy; writes a NEW report, never imports data."""
import argparse
from contextlib import closing
import hashlib
import json
import math
from pathlib import Path
import sqlite3


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON member: {key}")
            result[key] = value
        return result
    def invalid_number(value):
        raise ValueError(f"Invalid JSON number: {value}")
    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(f"Nonfinite JSON number: {value}")
        return number
    return json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=invalid_number, parse_float=finite_float)


def contained(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Export path escapes session")
    return path


def run_summary(run):
    if not isinstance(run, dict) or not isinstance(run.get("id"), str):
        raise ValueError("Run ID missing or invalid")
    if not isinstance(run.get("startedAt"), str):
        raise ValueError("Run start missing or invalid")
    points = run.get("points")
    events = run.get("events", [])
    if not isinstance(points, list) or not isinstance(events, list):
        raise ValueError("GPS/events are not arrays")
    # Canonical hashes supplement the exact exported value hash. No coordinates
    # are included in the report; no Effective Run is recalculated or rewritten.
    canonical = lambda value: json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
    return {"id": run["id"], "startedAt": run["startedAt"], "endedAt": run.get("endedAt"),
            "gpsCount": len(points), "eventCount": len(events), "gpsCanonicalSha256": sha(canonical(points)),
            "eventsCanonicalSha256": sha(canonical(events)), "allFieldsCanonicalSha256": sha(canonical(run))}


def verify(session):
    session = Path(session).resolve()
    manifest = strict_json((session / "manifest.json").read_bytes())
    if manifest.get("format") != "runjourney-read-only-rescue" or manifest.get("schemaVersion") != 1:
        raise ValueError("Unknown rescue format")
    if manifest.get("status") != "bytes-exported-awaiting-pc-validation" or manifest.get("sourceUnchanged") is not True:
        raise ValueError("Rescue failed or source was not verified unchanged")
    before = manifest["sourceBefore"]
    if before != manifest["sourceAfterCopy"] or before != manifest["sourceAfterRescue"]:
        raise ValueError("Source fingerprints changed")
    for name, expected in before.items():
        data = contained(session, "raw-source/" + name).read_bytes()
        if len(data) != expected["bytes"] or sha(data) != expected["sha256"]:
            raise ValueError("Raw database snapshot hash mismatch")
    entries = manifest["entries"]
    if len(entries) != manifest["keyCount"]:
        raise ValueError("Key count mismatch")
    # Only the disposable working copy is opened on PC, never an Android original.
    dbfile = contained(session, "working/RKStorage")
    with closing(sqlite3.connect(dbfile.as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Working SQLite integrity check failed")
        inventory = list(db.execute("SELECT rowid,length(CAST(value AS BLOB)) FROM catalystLocalStorage ORDER BY rowid"))
        if inventory != [(entry["rowId"], entry["bytes"]) for entry in entries]:
            raise ValueError("SQLite inventory differs from exported rows")
        result = {"status": "verified", "keyCount": len(entries), "entries": [], "historyCount": None,
                  "draft": None, "notice": "Logical export of surviving bytes; not proof of absent records or a restorable atomic device backup."}
        for entry in entries:
            key_bytes = db.execute("SELECT CAST(key AS BLOB) FROM catalystLocalStorage WHERE rowid=?",
                                   (entry["rowId"],)).fetchone()[0]
            if len(key_bytes) <= 8192 and key_bytes.decode("utf-8") != entry.get("key"):
                raise ValueError("Manifest key differs from SQLite key")
            if len(key_bytes) > 8192 and "key" in entry:
                raise ValueError("Oversized key was unexpectedly classified")
            data = contained(session, entry["file"]).read_bytes()
            if len(data) != entry["bytes"] or sha(data) != entry["sha256"]:
                raise ValueError("Exported value hash/size mismatch")
            digest = hashlib.sha256()
            for offset in range(0, len(data), 65536):
                part = db.execute("SELECT substr(CAST(value AS BLOB), ?, ?) FROM catalystLocalStorage WHERE rowid=?",
                                  (offset + 1, min(65536, len(data) - offset), entry["rowId"])).fetchone()[0]
                digest.update(part)
            if digest.hexdigest() != entry["sha256"]:
                raise ValueError("Independent SQLite chunk hash mismatch")
            summary = {"key": entry.get("key"), "rowId": entry["rowId"], "bytes": len(data), "sha256": sha(data)}
            if entry.get("key") == "@runjourney/runs/v1":
                runs = strict_json(data)
                if not isinstance(runs, list):
                    raise ValueError("History is not an array")
                summaries = [run_summary(run) for run in runs]
                ids = [run["id"] for run in summaries]
                if len(ids) != len(set(ids)):
                    raise ValueError("Duplicate history IDs (raw bytes retained)")
                summary["runs"] = summaries
                result["historyCount"] = len(runs)
            elif entry.get("key") == "@runjourney/active-run/v1":
                result["draft"] = run_summary(strict_json(data))
            result["entries"].append(summary)
        result["missingExpectedKeys"] = [key for key in manifest["expectedKeys"] if key not in {e.get("key") for e in entries}]
        if result["draft"] is not None:
            history_ids = {run["id"] for entry in result["entries"] for run in entry.get("runs", [])}
            result["draftIdAlsoInHistory"] = result["draft"]["id"] in history_ids
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("session", type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = verify(args.session)
    except Exception as error:
        report = {"status": "failed", "error": str(error), "notice": "All rescued raw files are retained; no import or repair was performed."}
    with args.report.open("x", encoding="utf-8") as out:
        json.dump(report, out, ensure_ascii=True, indent=2)
    print(f"PC validation: {report['status']}; report: {args.report}")
    raise SystemExit(0 if report["status"] == "verified" else 1)
