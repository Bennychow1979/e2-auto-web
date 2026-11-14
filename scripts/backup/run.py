"""Read-only source export -> gzip -> AES256 -> write-only S3 upload.

No SQL, filenames, row counts, HTTP bodies, or exception text go to CI logs.
All subprocess output is consumed privately; only fixed stage names are logged.
"""
import base64
from contextlib import contextmanager
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from status import UTC, MYT, NoRedirect, files_due, read_remote, result_path, timestamp

BUCKET = 's3://e2auto-web-backup-2026'
MANIFEST_PREFIX = b'-- E2_BACKUP_MANIFEST_V1 '
STAGE = 'configuration'


def stage(name):
    global STAGE
    STAGE = name
    print('Backup stage: ' + name, flush=True)


def require(name):
    value = os.environ.get(name)
    if not value:
        raise ValueError('Required backup secret missing')
    return value


def client_env(extra=None):
    # Secrets are deliberately not inherited by unrelated child processes.
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG', 'TMPDIR') if k in os.environ}
    env.update(extra or {})
    return env


def pg_env():
    from psycopg.conninfo import conninfo_to_dict
    # pg_dumpall overrides PGDATABASE internally. Parse once and pass connection
    # fields through libpq environment variables, never a URL/password in argv.
    fields = conninfo_to_dict(require('BACKUP_DATABASE_URL'))
    mapping = {'host': 'PGHOST', 'hostaddr': 'PGHOSTADDR', 'port': 'PGPORT',
               'user': 'PGUSER', 'password': 'PGPASSWORD', 'dbname': 'PGDATABASE',
               'sslmode': 'PGSSLMODE', 'sslrootcert': 'PGSSLROOTCERT',
               'connect_timeout': 'PGCONNECT_TIMEOUT', 'application_name': 'PGAPPNAME',
               'options': 'PGOPTIONS', 'channel_binding': 'PGCHANNELBINDING'}
    if set(fields) - set(mapping):
        raise ValueError('Unsupported database URL option')
    env = client_env({mapping[key]: value for key, value in fields.items()})
    if env.get('PGSSLMODE') not in ('verify-ca', 'verify-full'):
        env['PGSSLMODE'] = 'require'
    env.update(PGCONNECT_TIMEOUT='30', PGAPPNAME='e2-encrypted-backup')
    return env


def connection():
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    fields = conninfo_to_dict(require('BACKUP_DATABASE_URL'))
    mode = fields.get('sslmode', 'require')
    if mode not in ('verify-ca', 'verify-full'):
        mode = 'require'
    return psycopg.connect(require('BACKUP_DATABASE_URL'), sslmode=mode,
                          connect_timeout=30, application_name='e2-encrypted-backup')


@contextmanager
def encrypted_gzip(path, work):
    phrase = require('BACKUP_PASSPHRASE')
    if '\n' in phrase or '\r' in phrase or len(phrase.encode()) > 4096:
        raise ValueError('Passphrase must be a single line')
    read_fd, write_fd = os.pipe()
    gpg = None
    try:
        gpg = subprocess.Popen([
            'gpg', '--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback',
            '--no-symkey-cache', '--homedir', str(work / 'gnupg'),
            '--passphrase-fd', str(read_fd), '--symmetric', '--cipher-algo', 'AES256',
            '--s2k-mode', '3', '--s2k-digest-algo', 'SHA512', '--s2k-count', '65011712',
            '--compress-algo', 'none', '--output', str(path)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env=client_env(), pass_fds=(read_fd,))
        os.close(read_fd)
        read_fd = None
        os.write(write_fd, phrase.encode() + b'\n')
        os.close(write_fd)
        write_fd = None
        with gzip.GzipFile(fileobj=gpg.stdin, mode='wb', mtime=0) as compressed:
            yield compressed
        gpg.stdin.close()
        if gpg.wait(timeout=120) != 0 or not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError('Encryption failed')
    finally:
        for fd in (read_fd, write_fd):
            if fd is not None:
                os.close(fd)
        if gpg is not None and gpg.poll() is None:
            gpg.kill()
            gpg.wait()


def dump_to(command, target):
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=pg_env()) as proc:
        try:
            shutil.copyfileobj(proc.stdout, target, 1024 * 1024)
            if proc.wait() != 0:
                raise RuntimeError('PostgreSQL export failed')
        finally:
            if proc.poll() is None:
                proc.kill()


def database_backup(path, work):
    from psycopg import sql
    with connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        conn.execute('SET LOCAL row_security = off')
        conn.execute("SET LOCAL statement_timeout = '20min'")
        conn.execute("SET LOCAL lock_timeout = '30s'")
        snapshot = conn.execute('SELECT pg_export_snapshot()').fetchone()[0]
        version = conn.execute('SHOW server_version').fetchone()[0]
        extensions = conn.execute('SELECT extname, extversion FROM pg_extension ORDER BY extname').fetchall()
        # Count all non-extension user tables; count partition roots only.
        tables = conn.execute("""
            SELECT n.nspname, c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind IN ('r','p') AND NOT c.relispartition
              AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
                  AND d.objid=c.oid AND d.deptype='e')
            ORDER BY n.nspname,c.relname
        """).fetchall()
        counts = []
        for schema, table in tables:
            count = conn.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(
                sql.Identifier(schema), sql.Identifier(table))).fetchone()[0]
            counts.append({'schema': schema, 'table': table, 'rows': count})
        if not any(x['schema'] == 'public' and x['table'] == 'vehicles' for x in counts):
            raise RuntimeError('Expected E2 database table missing')
        manifest = {'format': 1, 'snapshot_at': timestamp(), 'postgres_version': version,
                    'extensions': extensions, 'table_counts': counts, 'role_passwords': False}
        with encrypted_gzip(path, work) as target:
            target.write(b'-- E2 full database backup: roles, schema, data, snapshot counts\n')
            stage('database-roles')
            dump_to(['pg_dumpall', '--roles-only', '--no-role-passwords', '--no-password',
                     '--quote-all-identifiers', '--database=' + pg_env().get('PGDATABASE', 'postgres')], target)
            stage('database-schema-and-data')
            dump_to(['pg_dump', '--format=plain', '--no-password', '--quote-all-identifiers',
                     '--lock-wait-timeout=30000', '--snapshot=' + snapshot], target)
            # A SQL comment keeps the one-file .sql contract and stays encrypted.
            target.write(b'\n' + MANIFEST_PREFIX + base64.b64encode(json.dumps(manifest).encode()) + b'\n')


def storage_inventory():
    # Query every row directly: no REST default limit, folder traversal, or bucket
    # allowlist. Includes empty/private buckets and newly added bucket names.
    with connection() as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        conn.execute('SET LOCAL row_security = off')
        buckets = conn.execute('SELECT to_jsonb(b) FROM storage.buckets b ORDER BY id').fetchall()
        with conn.cursor(name='e2_storage_inventory') as cursor:
            cursor.execute('SELECT to_jsonb(o) FROM storage.objects o ORDER BY bucket_id,name')
            objects = [row[0] for row in cursor]
    return {'buckets': [row[0] for row in buckets], 'objects': objects}


def object_url(base, bucket, name):
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Invalid Supabase URL')
    # Reject path normalisation ambiguity; never silently back up the wrong file.
    if any(part in ('.', '..') for part in name.split('/')):
        raise ValueError('Ambiguous Storage key')
    return base.rstrip('/') + '/storage/v1/object/authenticated/' + urllib.parse.quote(bucket, safe='') + '/' + urllib.parse.quote(name, safe='/')


def download_object(item, target):
    token = require('BACKUP_SUPABASE_SERVICE_ROLE_KEY')
    url = object_url(require('BACKUP_SUPABASE_URL'), item['bucket_id'], item['name'])
    headers = {'Authorization': 'Bearer ' + token, 'apikey': token, 'Accept-Encoding': 'identity',
               'Cache-Control': 'no-cache'}
    for attempt in range(4):
        target.seek(0)
        target.truncate()
        digest = hashlib.sha256()
        size = 0
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.build_opener(NoRedirect).open(request, timeout=120) as response:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    size += len(chunk)
                    target.write(chunk)
                declared = response.headers.get('Content-Length')
                if declared is not None and int(declared) != size:
                    raise ValueError('Incomplete download')
            expected = (item.get('metadata') or {}).get('size')
            if expected is not None and int(expected) != size:
                raise ValueError('Storage size mismatch')
            target.seek(0)
            return size, digest.hexdigest()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def add_bytes(archive, name, content):
    info = tarfile.TarInfo(name)
    info.size, info.mode = len(content), 0o600
    archive.addfile(info, io.BytesIO(content))


def storage_backup(path, work):
    before = storage_inventory()
    manifest = {'format': 1, 'started_at': timestamp(), 'buckets': before['buckets'], 'objects': []}
    with encrypted_gzip(path, work) as target:
        with tarfile.open(fileobj=target, mode='w|') as archive:
            for index, item in enumerate(before['objects']):
                # Indexed archive names prevent traversal/collisions and preserve
                # arbitrary original names in the encrypted manifest.
                member = f'objects/{index:09d}'
                with tempfile.TemporaryFile(dir=work) as body:
                    size, digest = download_object(item, body)
                    info = tarfile.TarInfo(member)
                    info.size, info.mode = size, 0o600
                    archive.addfile(info, body)
                manifest['objects'].append({'archive_path': member, 'bytes': size,
                                             'sha256': digest, 'source': item})
            if before != storage_inventory():
                raise RuntimeError('Storage changed during export; retry in a quiet window')
            manifest['finished_at'] = timestamp()
            add_bytes(archive, 'manifest.json', json.dumps(manifest, ensure_ascii=False).encode())


def upload(path, key):
    if path.suffix != '.gpg' or path.stat().st_size <= 0:
        raise ValueError('Only completed encrypted files may be uploaded')
    env = client_env({k: require(k) for k in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')})
    env.update(AWS_DEFAULT_REGION='ap-southeast-2', AWS_EC2_METADATA_DISABLED='true', AWS_MAX_ATTEMPTS='5')
    # A LOCAL source is essential. Monthly is a second local upload, never an
    # S3-to-S3 copy (which needs GetObject). No remote validation follows this.
    result = subprocess.run(['aws', 's3', 'cp', str(path), f'{BUCKET}/{key}',
                             '--region', 'ap-southeast-2', '--only-show-errors', '--no-progress'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800)
    if result.returncode:
        raise RuntimeError('S3 upload failed')
    return {'last_ok': timestamp(), 'bytes': path.stat().st_size}


def save_receipt(receipt):
    result_path().write_text(json.dumps(receipt), encoding='utf-8')


def run():
    os.umask(0o077)
    receipt = {'complete': False}
    save_receipt(receipt)
    previous, _ = read_remote()
    now = dt.datetime.now(UTC)
    local = now.astimezone(MYT)
    date = local.strftime('%Y-%m-%d')
    failed = False
    with tempfile.TemporaryDirectory(prefix='e2-backup-', dir=require('RUNNER_TEMP')) as temp:
        work = Path(temp)
        (work / 'gnupg').mkdir(mode=0o700)
        stage('database')
        try:
            path = work / f'e2-db-{date}.sql.gz.gpg'
            database_backup(path, work)
            stage('database-upload')
            db_receipt = upload(path, f'daily/{path.name}')
            if local.day == 1:
                stage('monthly-upload')
                upload(path, f'monthly/e2-db-{local:%Y-%m}.sql.gz.gpg')
            receipt['db'] = db_receipt
            save_receipt(receipt)
        except Exception:
            failed = True
            print('Backup failed at stage: ' + STAGE, file=sys.stderr)
        if files_due(previous, now, os.environ.get('INCLUDE_FILES') == 'true'):
            stage('storage-download-and-encryption')
            try:
                path = work / f'e2-storage-{date}.tar.gz.gpg'
                storage_backup(path, work)
                stage('storage-upload')
                receipt['files'] = upload(path, f'files/{path.name}')
                save_receipt(receipt)
            except Exception:
                failed = True
                print('Backup failed at stage: ' + STAGE, file=sys.stderr)
        receipt['complete'] = not failed
        save_receipt(receipt)
    # Only runner scratch is cleaned; no S3 object deletion is implemented.
    return 1 if failed else 0


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('Backup failed at stage: ' + STAGE + '; inspect secret configuration and service access.', file=sys.stderr)
        sys.exit(1)
