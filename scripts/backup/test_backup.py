"""Synthetic tests only: never reads production secrets or calls remote services."""
from contextlib import contextmanager
import base64
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import run as backup
import status
import verify_restore


class PolicyTests(unittest.TestCase):
    def test_malaysia_month_boundary(self):
        utc = dt.datetime(2026, 11, 30, 19, tzinfo=status.UTC)
        local = utc.astimezone(status.MYT)
        self.assertEqual(local.strftime('%Y-%m-%d'), '2026-12-01')
        self.assertEqual(local.strftime('%Y-%m'), '2026-12')

    def test_files_first_run_sunday_retry_and_weekday(self):
        state = status.empty_status()
        sunday = dt.datetime(2026, 11, 14, 19, tzinfo=status.UTC)
        self.assertTrue(status.files_due(state, sunday))
        state['files_last_ok'] = status.timestamp(sunday - dt.timedelta(days=2))
        self.assertTrue(status.files_due(state, sunday))
        self.assertTrue(status.files_due(state, sunday + dt.timedelta(days=1)))
        state['files_last_ok'] = status.timestamp(sunday)
        self.assertFalse(status.files_due(state, sunday + dt.timedelta(minutes=5)))
        self.assertFalse(status.files_due(state, sunday + dt.timedelta(days=1)))
        self.assertTrue(status.files_due(state, sunday + dt.timedelta(days=7)))
        self.assertTrue(status.files_due(state, sunday, True))

    def test_failed_attempt_preserves_success_times(self):
        now = dt.datetime(2026, 11, 15, tzinfo=status.UTC)
        old = status.empty_status()
        old.update(db_last_ok=status.timestamp(now - dt.timedelta(days=1)), db_bytes=99,
                   files_last_ok=status.timestamp(now - dt.timedelta(days=5)), files_bytes=100)
        failed = status.combine(old, {}, False, now)
        self.assertEqual(failed['db_last_ok'], old['db_last_ok'])
        self.assertEqual(failed['files_last_ok'], old['files_last_ok'])
        self.assertFalse(failed['ok'])
        success = status.combine(old, {'complete': True, 'db': {'last_ok': status.timestamp(now), 'bytes': 200}}, True, now)
        self.assertTrue(success['ok'])
        self.assertEqual(success['files_bytes'], 100)
        self.assertEqual(set(success), status.FIELDS)
        self.assertFalse(status.combine(old, {'complete': True}, True, now + dt.timedelta(days=3))['ok'])

    def test_status_rejects_extra_data_and_invalid_sizes(self):
        for additions in ({'customer': 'private'}, {'db_bytes': '123'}, {'db_bytes': True}):
            with self.assertRaises(ValueError):
                status.validate_status({**status.empty_status(), **additions})

    def test_partial_success_preserved_but_overall_failure(self):
        now = dt.datetime.now(status.UTC)
        result = status.combine(status.empty_status(), {
            'db': {'last_ok': status.timestamp(now), 'bytes': 12}, 'complete': False}, False, now)
        self.assertEqual(result['db_bytes'], 12)
        self.assertFalse(result['ok'])


class DataPathTests(unittest.TestCase):
    def test_upload_local_ciphertext_only_no_read(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'backup.sql.gz.gpg'
            path.write_bytes(b'synthetic-ciphertext')
            with patch.dict(os.environ, {'AWS_ACCESS_KEY_ID': 'synthetic', 'AWS_SECRET_ACCESS_KEY': 'synthetic'}), \
                 patch.object(backup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as call:
                receipt = backup.upload(path, 'monthly/e2-db-2026-11.sql.gz.gpg')
                command = call.call_args.args[0]
                self.assertEqual(command[:4], ['aws', 's3', 'cp', str(path)])
                self.assertEqual(receipt['bytes'], path.stat().st_size)
                self.assertEqual(call.call_count, 1)
                self.assertNotIn('BACKUP_PASSPHRASE', call.call_args.kwargs['env'])
                call.return_value = subprocess.CompletedProcess([], 1)
                with self.assertRaises(RuntimeError):
                    backup.upload(path, 'daily/test.gpg')
            plain = Path(temp) / 'plain.sql'
            plain.write_bytes(b'synthetic')
            with self.assertRaises(ValueError):
                backup.upload(plain, 'daily/test.gpg')

    def test_encoded_download_and_no_redirect(self):
        self.assertEqual(backup.object_url('https://example.supabase.co', 'private', 'folder/a #%.pdf'),
                         'https://example.supabase.co/storage/v1/object/authenticated/private/folder/a%20%23%25.pdf')
        for name in ('../private', 'a/../b'):
            with self.assertRaises(ValueError):
                backup.object_url('https://example.supabase.co', 'private', name)
        with self.assertRaises(ValueError):
            backup.object_url('http://example.supabase.co', 'private', 'a')
        self.assertIsNone(status.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.test'))

    def test_storage_all_buckets_nested_names_zero_bytes_and_hashes(self):
        objects = [{'bucket_id': f'bucket-{i % 3}', 'name': f'nested/file-{i}.pdf'} for i in range(354)]
        inventory = {'buckets': [{'id': f'bucket-{i}'} for i in range(4)], 'objects': objects}
        @contextmanager
        def fake_encrypt(path, work):
            with gzip.open(path, 'wb') as out:
                yield out
        def fake_download(item, target):
            content = b'' if item == objects[0] else item['name'].encode()
            target.write(content)
            target.seek(0)
            return len(content), hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'synthetic.tar.gz'
            with patch.object(backup, 'encrypted_gzip', fake_encrypt), \
                 patch.object(backup, 'storage_inventory', return_value=inventory), \
                 patch.object(backup, 'download_object', fake_download):
                backup.storage_backup(path, Path(temp))
            with patch('builtins.print'):
                verify_restore.check_storage(path)
            with tarfile.open(path) as archive:
                manifest = json.load(archive.extractfile('manifest.json'))
                self.assertEqual(len(manifest['objects']), 354)
                self.assertEqual(len(manifest['buckets']), 4)
                self.assertEqual(manifest['objects'][0]['bytes'], 0)
            with patch.object(backup, 'encrypted_gzip', fake_encrypt), \
                 patch.object(backup, 'storage_inventory', side_effect=[inventory, {'buckets': [], 'objects': []}]), \
                 patch.object(backup, 'download_object', fake_download):
                with self.assertRaises(RuntimeError):
                    backup.storage_backup(path, Path(temp))

    def test_manifest_is_valid_sql_comment_and_round_trips(self):
        value = {'format': 1, 'table_counts': [{'schema': 'public', 'table': 'vehicles', 'rows': 5}]}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'synthetic.sql'
            path.write_bytes(b'SELECT 1;\n' + backup.MANIFEST_PREFIX + base64.b64encode(json.dumps(value).encode()) + b'\n')
            self.assertEqual(verify_restore.read_manifest(path), value)

    def test_monthly_failure_does_not_record_db_success(self):
        class MonthStart(dt.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 11, 30, 19, tzinfo=status.UTC)
        calls = []
        def fake_db(path, work):
            path.write_bytes(b'ciphertext')
        def fake_upload(path, key):
            calls.append((path, key))
            if key.startswith('monthly/'):
                raise RuntimeError('synthetic upload failure')
            return {'last_ok': '2026-11-30T19:01:00Z', 'bytes': 10}
        with tempfile.TemporaryDirectory() as temp, \
             patch.dict(os.environ, {'RUNNER_TEMP': temp}), \
             patch.object(backup, 'read_remote', return_value=(status.empty_status(), 'sha')), \
             patch.object(backup.dt, 'datetime', MonthStart), \
             patch.object(backup, 'database_backup', fake_db), \
             patch.object(backup, 'files_due', return_value=False), \
             patch.object(backup, 'upload', fake_upload), patch('builtins.print'):
            self.assertEqual(backup.run(), 1)
            receipt = json.loads(status.result_path().read_text())
            self.assertNotIn('db', receipt)
            self.assertFalse(receipt['complete'])
            self.assertEqual(calls[0][0], calls[1][0])
            self.assertEqual(calls[1][1], 'monthly/e2-db-2026-12.sql.gz.gpg')


@unittest.skipUnless(os.environ.get('BACKUP_INTEGRATION') == '1', 'isolated CI PostgreSQL services required')
class IntegrationTests(unittest.TestCase):
    def test_real_dump_encrypt_decrypt_restore_and_count(self):
        import psycopg
        source = 'host=127.0.0.1 port=5432 user=e2_source password=synthetic dbname=source sslmode=disable'
        target = 'host=127.0.0.1 port=5433 user=e2_restore password=synthetic dbname=restore sslmode=disable'
        with psycopg.connect(source, autocommit=True) as conn:
            conn.execute('CREATE TABLE vehicles (id int PRIMARY KEY, name text)')
            conn.execute("INSERT INTO vehicles VALUES (1,'synthetic'),(2,'more synthetic')")
            conn.execute('CREATE ROLE e2_sample NOLOGIN')
            conn.execute('GRANT SELECT ON vehicles TO e2_sample')
            conn.execute('CREATE SCHEMA auth')
            conn.execute('CREATE TABLE auth.users (id int)')
            conn.execute('INSERT INTO auth.users VALUES (1)')
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            (work / 'gnupg').mkdir(mode=0o700)
            encrypted = work / 'test.sql.gz.gpg'
            env = backup.client_env({'PGHOST': '127.0.0.1', 'PGPORT': '5432', 'PGUSER': 'e2_source',
                                     'PGPASSWORD': 'synthetic', 'PGDATABASE': 'source', 'PGSSLMODE': 'disable'})
            with patch.dict(os.environ, {'BACKUP_PASSPHRASE': 'synthetic-test-passphrase'}), \
                 patch.object(backup, 'connection', side_effect=lambda: psycopg.connect(source)), \
                 patch.object(backup, 'pg_env', return_value=env):
                backup.database_backup(encrypted, work)
            decrypted = subprocess.run(['gpg', '--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
                '--homedir', str(work / 'gnupg'), '--decrypt', str(encrypted)],
                input=b'synthetic-test-passphrase\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            plain = gzip.decompress(decrypted.stdout)
            self.assertIn(b'CREATE ROLE "e2_sample"', plain)
            self.assertIn(b'CREATE TABLE "auth"."users"', plain)
            self.assertNotIn(b"PASSWORD 'synthetic'", plain)
            # Restore only after GPG has authenticated the entire file.
            restored = subprocess.run(['psql', '-X', '--set', 'ON_ERROR_STOP=on', '--single-transaction'],
                input=plain, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=backup.client_env({'PGHOST': '127.0.0.1', 'PGPORT': '5433', 'PGUSER': 'e2_restore',
                                      'PGPASSWORD': 'synthetic', 'PGDATABASE': 'restore'}))
            self.assertEqual(restored.returncode, 0, restored.stderr.decode())
            sqlfile = work / 'test.sql'
            sqlfile.write_bytes(plain)
            with psycopg.connect(target) as conn:
                verify_restore.check_database(conn, verify_restore.read_manifest(sqlfile))
                self.assertTrue(conn.execute("SELECT has_table_privilege('e2_sample','vehicles','SELECT')").fetchone()[0])
            corrupted = work / 'corrupt.gpg'
            damaged = bytearray(encrypted.read_bytes())
            damaged[-12] ^= 1
            corrupted.write_bytes(damaged)
            bad = subprocess.run(['gpg', '--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
                '--homedir', str(work / 'gnupg'), '--decrypt', str(corrupted)],
                input=b'synthetic-test-passphrase\n', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertNotEqual(bad.returncode, 0)


if __name__ == '__main__':
    unittest.main()
