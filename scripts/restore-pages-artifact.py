"""Restore the verified original Pages files without rebuilding or accessing inventory."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
import zipfile

EXPECTED_ZIP_SHA256 = "2bf6564c2b910d9c1b878f6fdecc9b5ad9e5125cacda9749f1367f3a67db1e0d"
ROOT = Path(__file__).resolve().parent.parent

def restore(output):
    out = Path(output).resolve()
    if out.exists() or out == ROOT or out in ROOT.parents:
        raise ValueError("Restore requires a new isolated output directory")
    archive = ROOT / ".release-backups" / "e2-pages-905b410.zip"
    data = archive.read_bytes()
    if len(data) != 3536725 or hashlib.sha256(data).hexdigest() != EXPECTED_ZIP_SHA256:
        raise ValueError("Original Pages artifact digest/size mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        if bundle.namelist() != ["artifact.tar"]:
            raise ValueError("Unexpected original artifact layout")
        tar_bytes = bundle.read("artifact.tar")
    if len(tar_bytes) != 9646080:
        raise ValueError("Unexpected tar length")
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as tar:
        members = tar.getmembers()
        files = [m for m in members if m.isfile()]
        if len(files) != 484:
            raise ValueError("Unexpected original file count")
        seen = set()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or "\\" in member.name or ":" in member.name:
                raise ValueError("Unsafe archive path")
            if not (member.isdir() or member.isfile()):
                raise ValueError("Links and special files are not allowed")
            if member.isfile():
                if str(name) in seen:
                    raise ValueError("Duplicate file path")
                seen.add(str(name))
        out.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".pages-restore-", dir=out.parent))
        hashes = {}
        for member in files:
            relative = PurePosixPath(member.name)
            target = stage.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            body = tar.extractfile(member).read()
            if len(body) != member.size:
                raise ValueError("Truncated archive member")
            target.write_bytes(body)
            hashes[str(relative)] = hashlib.sha256(body).hexdigest()
        if out.exists():
            raise ValueError("Output appeared during restoration")
        stage.rename(out)
    tree_sha = hashlib.sha256("".join(k + "\0" + hashes[k] + "\n" for k in sorted(hashes)).encode()).hexdigest()
    return {"restoredFiles": len(hashes), "sourceCommit": "905b410c57a75978d52604b6f4d344aa71856897", "officialZipSHA256": EXPECTED_ZIP_SHA256, "restoredTreeSHA256": tree_sha, "rebuilt": False, "deployed": False}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/restore-pages-artifact.py <new-output-directory>")
    print(json.dumps(restore(sys.argv[1])))
