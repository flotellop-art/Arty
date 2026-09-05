"""Independent synthetic fixture reader + writer; no personal workspace access.

Requires cryptography (bundled runtime). Input directory is produced by the
workspaceBackup Vitest suite with ARTY_BACKUP_FIXTURE_DIR set. The recovery code
is the PUBLIC test vector, never a real user code. Writes only python.artybackup
and python-expected.json in that explicitly supplied fixture directory.
"""
import hashlib
import json
import os
import struct
import sys
import uuid
from base64 import b64decode
from pathlib import Path

import cryptography
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

CODE = bytes.fromhex("00112233445566778899aabbccddeeff" * 2)
CHUNK = 256 * 1024
INFO = b"arty-workspace-backup/v1"


def derive(salt):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=INFO).derive(CODE)


def read_archive(path):
    assert 90 <= path.stat().st_size <= 64 * 1024 * 1024
    with path.open("rb") as stream:
        header = stream.read(64)
        assert header[:8] == b"ARTYBKP1"
        count, manifest_size = struct.unpack(">II", header[56:64])
        assert 1 <= count <= 512 and 1 <= manifest_size <= 4 * 1024 * 1024
        cipher = AESGCM(derive(header[24:56]))
        index = 0

        def frame(size):
            nonlocal index
            prefix = stream.read(9)
            assert prefix == struct.pack(">BII", 1 if index == 0 else 2, index, size)
            encrypted = stream.read(size + 16)
            assert len(encrypted) == size + 16
            nonce = b"\0" * 8 + struct.pack(">I", index)
            data = cipher.decrypt(nonce, encrypted, header + prefix)
            index += 1
            assert len(data) == size
            return data

        manifest = json.loads(frame(manifest_size).decode("utf-8", errors="strict"))
        assert manifest["format"] == "arty-workspace"
        assert manifest["version"] == manifest["minReader"] == 1
        assert manifest["features"] == ["additive-restore", "inert-restore", "eu-monotone"]
        assert uuid.UUID(manifest["archiveId"]).bytes == header[8:24]
        objects = {}
        total = manifest_size
        for descriptor in manifest["objects"]:
            size = descriptor["bytes"]
            assert type(size) is int and 1 <= size <= 10 * 1024 * 1024
            assert descriptor["id"] not in objects
            total += size
            assert total <= 60 * 1024 * 1024
            value = bytearray()
            while len(value) < size:
                value.extend(frame(min(CHUNK, size - len(value))))
            assert hashlib.sha256(value).hexdigest() == descriptor["sha256"]
            objects[descriptor["id"]] = bytes(value)
        assert index == count and stream.read(1) == b""
    for project in manifest["projects"]:
        for doc in project["documents"]:
            source = objects[doc["sourceObjectId"]]
            assert len(source) == doc["sourceBytes"]
            assert hashlib.sha256(source).hexdigest() == doc["sourceHash"]
            text = objects[doc["textObjectId"]].decode("utf-8", errors="strict")
            # JS string length is UTF-16 code units, not Python Unicode points.
            assert len(text.encode("utf-16-le")) // 2 == doc["textChars"]
    return manifest, objects


def write_archive(path, manifest, objects):
    manifest = {**manifest, "archiveId": str(uuid.uuid4())}
    raw = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    count = 1 + sum((d["bytes"] + CHUNK - 1) // CHUNK for d in manifest["objects"])
    header = b"ARTYBKP1" + uuid.UUID(manifest["archiveId"]).bytes + os.urandom(32) + struct.pack(">II", count, len(raw))
    cipher = AESGCM(derive(header[24:56]))
    index = 0
    with path.open("wb") as stream:
        stream.write(header)

        def frame(data):
            nonlocal index
            prefix = struct.pack(">BII", 1 if index == 0 else 2, index, len(data))
            stream.write(prefix)
            stream.write(cipher.encrypt(b"\0" * 8 + struct.pack(">I", index), data, header + prefix))
            index += 1

        frame(raw)
        for descriptor in manifest["objects"]:
            value = objects[descriptor["id"]]
            for offset in range(0, len(value), CHUNK):
                frame(value[offset:offset + CHUNK])
    assert index == count


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check-workspace-backup-fixture.py SYNTHETIC_FIXTURE_DIRECTORY")
    directory = Path(sys.argv[1]).resolve(strict=True)
    assert directory.is_dir()
    expected_path = directory / "expected.json"
    assert expected_path.stat().st_size <= 4 * 1024 * 1024
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    manifest, objects = read_archive(directory / "arty-workspace.artybackup")
    for field in ("conversations", "projects", "files", "objects"):
        assert manifest[field] == expected["snapshot"][field]
    for object_id, encoded in expected["objects"].items():
        assert objects[object_id] == b64decode(encoded, validate=True)
    write_archive(directory / "python.artybackup", manifest, objects)
    (directory / "python-expected.json").write_text(json.dumps(expected, ensure_ascii=False), encoding="utf-8")
    print(f"PASS cryptography {cryptography.__version__}: independent read/write, {len(objects)} exact binary objects, authenticated frames and metadata")


if __name__ == "__main__":
    main()
