"""Restricted SSH receiver. Append verified immutable files and retain every release."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile

LIMIT = 128 * 1024 * 1024


def validate_archive(archive):
    files = {}
    size = 0
    with tarfile.open(archive, "r:gz") as tar:
        for entry in tar:
            name = entry.name
            path = PurePosixPath(name)
            if (not entry.isfile() or name in files or path.is_absolute()
                    or ".." in path.parts or str(path) != name
                    or not (name == "manifest.json" or name.startswith("assets/"))):
                raise ValueError("Invalid archive entry: " + name)
            size += entry.size
            if size > LIMIT or len(files) >= 10000:
                raise ValueError("Remote assets archive is too large")
            files[name] = tar.extractfile(entry).read()
    manifest = json.loads(files.pop("manifest.json"))
    if (not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", manifest["version"])
            or not re.fullmatch(r"[a-z0-9-]+", manifest["label"])):
        raise ValueError("Invalid release version or build label")
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    if not files or hashes != manifest["files"]:
        raise ValueError("Remote asset checksum mismatch")
    if not all(any(name.endswith(extension) for name in files) for extension in (".js", ".css")):
        raise ValueError("Missing JavaScript or CSS assets")
    return manifest, files


def install(archive, root, check_only=False):
    import fcntl

    manifest, files = validate_archive(archive)
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    with (root / "install.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        identity = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        receipt = root / "releases" / (manifest["version"] + "-" + manifest["label"] + "-" + identity + ".json")
        for name, digest in manifest["files"].items():
            destination = root / "shared" / name
            if destination.is_symlink() or any(p.is_symlink() for p in destination.parents):
                raise ValueError("Symlink in asset storage")
            if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                raise ValueError("Refusing to overwrite immutable asset " + name)
        if check_only:
            print("Asset preflight passed", manifest["version"], manifest["label"])
            return
        for name, data in files.items():
            destination = root / "shared" / name
            if destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temp:
                temporary = Path(temp.name)
                try:
                    temp.write(data)
                    temp.flush()
                    temporary.chmod(0o644)
                    os.link(temporary, destination)
                finally:
                    temporary.unlink()
        receipt.parent.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=receipt.parent, delete=False) as temp:
            json.dump(manifest, temp, sort_keys=True)
        os.replace(temp.name, receipt)
    print("Installed", manifest["version"], manifest["label"], len(files), "assets; old files retained")


def main():
    action = os.environ.get("SSH_ORIGINAL_COMMAND", "")
    if action not in ("check", "install"):
        raise ValueError("Only check/install are allowed")
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "assets.tar.gz"
        with archive.open("wb") as output:
            remaining = LIMIT + 1
            while remaining:
                block = sys.stdin.buffer.read(min(1024 * 1024, remaining))
                if not block:
                    break
                output.write(block)
                remaining -= len(block)
            if not remaining:
                raise ValueError("Archive exceeds size limit")
        install(archive, "/opt/onework-static", action == "check")


if __name__ == "__main__":
    main()
