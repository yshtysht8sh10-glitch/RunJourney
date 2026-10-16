"""PC-only APK class inventory. Never contacts a device or reads a database."""
import argparse
import json
from pathlib import Path
import struct
import zipfile


def classes(dex):
    if not dex.startswith(b"dex\n"):
        raise ValueError("Not a standard DEX")
    word = lambda offset: struct.unpack_from("<I", dex, offset)[0]
    strings = []
    for index in range(word(56)):
        offset = word(word(60) + index * 4)
        while dex[offset] & 128:
            offset += 1
        offset += 1  # Skip UTF-16 length; class descriptors are ASCII.
        end = dex.index(0, offset)
        strings.append(dex[offset:end])
    types = [strings[word(word(68) + index * 4)] for index in range(word(64))]
    return [types[word(word(100) + index * 32)].decode("ascii") for index in range(word(96))]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk) as archive:
        names = archive.namelist()
        inventory = [name for file in names if file.endswith(".dex") for name in classes(archive.read(file))]
        result = {"classes": inventory, "files": names,
                  "onlyRescueClasses": bool(inventory) and all(name.startswith("Lapp/runjourney/rescue/") for name in inventory),
                  "hasNativeLibraries": any(name.startswith("lib/") for name in names),
                  "hasAssets": any(name.startswith("assets/") for name in names)}
    with args.report.open("x", encoding="utf-8") as out:
        json.dump(result, out, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key != "files"}, indent=2))
    raise SystemExit(0 if result["onlyRescueClasses"] and not result["hasNativeLibraries"] and not result["hasAssets"] else 1)
