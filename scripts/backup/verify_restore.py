"""Local-only restore checks. Never run against production or publish output."""
import argparse
import base64
import getpass
import hashlib
import json
from pathlib import Path
import sys
import tarfile

PREFIX = b'-- E2_BACKUP_MANIFEST_V1 '


def read_manifest(path):
    manifest = None
    with Path(path).open('rb') as source:
        for line in source:
            if line.startswith(PREFIX):
                manifest = json.loads(base64.b64decode(line[len(PREFIX):].strip(), validate=True))
    if not manifest or manifest.get('format') != 1 or not manifest.get('table_counts'):
        raise ValueError('Missing backup row-count manifest')
    return manifest


def check_database(conn, manifest):
    from psycopg import sql
    mismatches = 0
    with conn.transaction():
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        conn.execute('SET LOCAL row_security = off')
        for table in manifest['table_counts']:
            actual = conn.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(
                sql.Identifier(table['schema']), sql.Identifier(table['table']))).fetchone()[0]
            if actual != table['rows']:
                mismatches += 1
            print(f"{table['schema']}.{table['table']}: expected={table['rows']} actual={actual}")
    if mismatches:
        raise ValueError('Restored table row counts differ')
    print('All snapshot row counts match.')


def check_storage(path):
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(set(names)) != len(names) or any(not member.isfile() for member in members):
            raise ValueError('Invalid archive members')
        manifest = json.load(archive.extractfile('manifest.json'))
        expected = {'manifest.json'}
        for item in manifest['objects']:
            name = item['archive_path']
            if name in expected or not name.startswith('objects/') or not name[8:].isdigit():
                raise ValueError('Invalid object member')
            expected.add(name)
            digest = hashlib.sha256()
            size = 0
            with archive.extractfile(name) as body:
                while chunk := body.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
            if digest.hexdigest() != item['sha256'] or size != item['bytes']:
                raise ValueError('Storage content integrity mismatch')
        if set(names) != expected:
            raise ValueError('Unexpected or missing archive member')
    print(f"Verified {len(manifest['objects'])} Storage files and all SHA-256 hashes.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('manifest', 'database', 'storage'))
    parser.add_argument('path')
    args = parser.parse_args()
    if args.mode == 'storage':
        check_storage(args.path)
    else:
        manifest = read_manifest(args.path)
        if args.mode == 'manifest':
            print(json.dumps(manifest, indent=2, ensure_ascii=False))
        else:
            import psycopg
            url = getpass.getpass('ISOLATED TEST database URL (hidden): ')
            if input('Type ISOLATED to confirm this is a disposable test database: ') != 'ISOLATED':
                raise ValueError('Confirmation missing')
            with psycopg.connect(url, connect_timeout=30) as conn:
                check_database(conn, manifest)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Restore verification failed. Check the local test database, manifest and backup integrity.', file=sys.stderr)
        sys.exit(1)
