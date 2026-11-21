"""Package the renderer from the shipped ASAR and deploy it before updater manifests."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tarfile
import tempfile

from install_tunnel_assets import validate_archive

HOSTS = ("62.234.93.202", "43.163.105.71")


def package(asar, output, label):
    if not re.fullmatch(r"[a-z0-9-]+", label):
        raise ValueError("Invalid build label")
    with Path(asar).open("rb") as source:
        prefix = source.read(16)
        _, header_size, _, json_size = struct.unpack("<4I", prefix)
        if json_size > 64 * 1024 * 1024 or json_size > header_size:
            raise ValueError("Invalid ASAR header")
        header = json.loads(source.read(json_size))

        def read(entry):
            if entry.get("unpacked") or "link" in entry:
                raise ValueError("Renderer must be stored in the packaged ASAR")
            source.seek(8 + header_size + int(entry["offset"]))
            data = source.read(entry["size"])
            if len(data) != entry["size"]:
                raise ValueError("Truncated ASAR entry")
            return data

        version = json.loads(read(header["files"]["package.json"]))["version"]
        assets = header["files"]["out"]["files"]["renderer"]["files"]["assets"]
        files = {}

        def collect(tree, parent):
            for name, entry in sorted(tree["files"].items()):
                path = parent + "/" + name
                if "files" in entry:
                    collect(entry, path)
                else:
                    files[path] = read(entry)

        collect(assets, "assets")
    manifest = {"version": version, "label": label,
                "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / ("remote-ui-" + version + "-" + label + ".tar.gz")
    with tempfile.TemporaryDirectory() as temporary:
        candidate = Path(temporary) / "assets.tar.gz"
        with tarfile.open(candidate, "w:gz") as tar:
            for name, data in {"manifest.json": json.dumps(manifest).encode(), **files}.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o644
                tar.addfile(entry, io.BytesIO(data))
        validate_archive(candidate)
        archive.write_bytes(candidate.read_bytes())
    print(archive)
    return archive


def deploy(directory, version, dry_run=False):
    archives = sorted(Path(directory).glob("remote-ui-*.tar.gz"))
    if not archives:
        raise ValueError("Missing packaged remote-ui archives; rebuild the release before publishing")
    bundles = []
    merged = {}
    for archive in archives:
        manifest, files = validate_archive(archive)
        if manifest["version"] != version:
            raise ValueError("Remote assets version differs from the updater version")
        for name, digest in manifest["files"].items():
            if name in merged and merged[name] != digest:
                raise ValueError("Platform builds disagree on immutable asset " + name)
            merged[name] = digest
        bundles.append((archive, files))
    if dry_run:
        print("Validated", len(bundles), "packaged asset bundles for both NGINX servers")
        return
    with tempfile.TemporaryDirectory() as temporary:
        key = Path(os.environ.get("ONEWORK_STATIC_SSH_KEY", str(Path.home() / ".ssh/onework_static")))
        if os.environ.get("ONEWORK_STATIC_SSH_PRIVATE_KEY"):
            key = Path(temporary) / "key"
            key.write_text(os.environ["ONEWORK_STATIC_SSH_PRIVATE_KEY"] + "\n")
            key.chmod(0o600)
        ssh = ["ssh", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
               "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
               "-o", "UserKnownHostsFile=" + str(Path(__file__).with_name("known_hosts")), "-i", str(key)]
        for action in ("check", "install"):
            for host in HOSTS:
                for archive, _ in bundles:
                    for attempt in range(3):
                        with archive.open("rb") as stream:
                            result = subprocess.run(ssh + ["root@" + host, action], stdin=stream, timeout=120)
                        if result.returncode == 0:
                            break
                    else:
                        raise RuntimeError("Static asset " + action + " failed on " + host)
        # Check actual HTTP delivery as well as the receiver's byte-for-byte checks.
        for host in HOSTS:
            for _, files in bundles:
                for extension in (".js", ".css"):
                    names = [name for name in files if name.endswith(extension)]
                    name = max(names, key=lambda item: len(files[item]))
                    result = subprocess.run(["curl", "--noproxy", "*", "-fsS", "--retry", "2",
                                             "--connect-timeout", "10", "--max-time", "30",
                                             "--resolve", "releaseassetscheck.r.1work.vip:443:" + host,
                                             "https://releaseassetscheck.r.1work.vip/" + name],
                                            capture_output=True, check=True, timeout=100)
                    if hashlib.sha256(result.stdout).hexdigest() != merged[name]:
                        raise RuntimeError("NGINX served different content on " + host + ": " + name)
        print("Both NGINX servers verified; previous versions retained")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack")
    pack.add_argument("asar")
    pack.add_argument("output")
    pack.add_argument("label")
    build = commands.add_parser("pack-build")
    build.add_argument("directory")
    build.add_argument("label")
    sync = commands.add_parser("deploy")
    sync.add_argument("directory")
    sync.add_argument("version")
    sync.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.command == "pack-build":
        candidates = [path for path in Path(args.directory).rglob("app.asar")
                      if "node_modules" not in path.parts]
        if not candidates:
            raise ValueError("Packaged app.asar missing after desktop build")
        package(max(candidates, key=lambda path: path.stat().st_mtime_ns), args.directory, args.label)
    elif args.command == "pack":
        package(args.asar, args.output, args.label)
    else:
        deploy(args.directory, args.version, args.dry_run)


if __name__ == "__main__":
    main()
