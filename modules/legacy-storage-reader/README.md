# Legacy storage reader

Android-only, read-only access to the current application's fixed `RKStorage`.
The JS contract and all existing capacity, namespace, token and chunk limits
remain unchanged. No path is accepted from JS. No source repair, checkpoint,
copy, deletion, migration write or writable open is provided by this module.

## Driver selection

AndroidX `sqlite-bundled:2.6.2` supplies public
`BundledSQLiteDriver.open(path, SQLITE_OPEN_READONLY)` and statement APIs. One
connection executes `BEGIN DEFERRED`, metadata and chunk reads, then `ROLLBACK`.
This avoids Android framework `SQLiteSession`'s pre-API35 limitation without a
hidden API, SQL-parser workaround, `immutable=1`, or read/write fallback.

2.6.2 is a stable release with minSDK23; this app currently uses minSDK26. The
latest stable version listed during investigation was 2.7.1. 2.6.2 was chosen as
the smaller API change for this PoC, not asserted to be the latest version.

References: [release notes](https://developer.android.com/jetpack/androidx/releases/sqlite),
[driver API](https://developer.android.com/reference/kotlin/androidx/sqlite/driver/bundled/BundledSQLiteDriver).

## WAL protection and runtime sidecars

Read-only SQLite may create runtime WAL/SHM sidecars when the database header is
in WAL mode and they do not exist. This is SQLite-engine behaviour permitted by
its [read-only WAL specification](https://sqlite.org/wal.html#read_only_databases).
The application does not create, remove, truncate, repair or checkpoint them.
It does not change journal mode, ignore a WAL, fall back to writable opening or
use immutable mode. Existing SHM read marks are SQLite-managed runtime state;
the original main database and existing WAL bytes must remain unchanged.

Closed clean WAL-mode sources and committed WALs without an SHM index can be
read. If required runtime sidecars cannot be created/read, opening fails closed,
never returns empty history. Filesystem-wide byte-for-byte immutability is not
claimed: newly created engine sidecars and SHM read marks are distinguished
from changes to original database/WAL contents.

## Local verification (synthetic only)

Robolectric: **48 tests passed**, 16 each on API28/33/35. Includes multi-megabyte
emoji values, exact original UTF-8 SHA-256, bounded chunks, malformed schema and
types, limits, sessions/expiry, clean closed WALs, missing SHM, uncommitted WAL
tails, actual write rejection, and a WAL writer changing data while the reader
keeps its original snapshot. Original main/WAL hashes were compared. Sidecar
creation failures were synthesized using obstructing directory entries; actual
OS permission revocation and a full disk/ENOSPC have not been tested. No real
application data or phone was used. No APK was built or installed for this PoC.

The test task extracts a host-native library from the same-version JVM artifact
into the ignored build directory. These desktop binaries/classes are not an
Android runtime dependency. Distinct test-only copies are needed because each
Robolectric API sandbox has its own JNI classloader.

## Size and 16KiB-page inspection

Downloaded Android AAR: 2,537,459 bytes. `libsqliteJni.so` sizes:

| ABI | Uncompressed bytes | ZIP compressed bytes |
| --- | ---: | ---: |
| arm64-v8a | 1,310,776 | 643,477 |
| armeabi-v7a | 1,253,332 | 617,574 |
| x86 | 1,159,896 | 630,845 |
| x86_64 | 1,220,840 | 624,466 |

All PT_LOAD segments in all four ELF files have alignment 16,384 and matching
offset/address modulo 16,384. This validates the library's ELF alignment only;
final APK ZIP alignment, device loading, APK-size delta and device integration
remain unverified. Existing ABI filters determine which libraries are packaged.
