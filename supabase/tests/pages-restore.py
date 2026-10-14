"""Local checks for the fixed Pages rollback, without network or deployment."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pages_restore', ROOT / 'scripts' / 'restore-pages-artifact.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RestoreTests(unittest.TestCase):
    def test_verified_official_archive_restores_expected_tree(self):
        with tempfile.TemporaryDirectory(prefix='e2-rollback-test-') as directory:
            out = Path(directory) / 'site'
            result = module.restore(out)
            self.assertEqual(result['restoredFiles'], 484)
            self.assertEqual(result['restoredTreeSHA256'], 'c82dd669144b93a6bb0c89da303faa8f0a9cff5d745c89f61e9e2993c6330f2b')
            self.assertFalse(result['rebuilt'])
            self.assertFalse(result['deployed'])
            for name in ['customer.js', 'customer-session.mjs', 'my-e2.js', 'car-detail-demo.css']:
                self.assertEqual((out / name).read_bytes(), (ROOT / name).read_bytes())

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='e2-rollback-existing-') as directory:
            out = Path(directory)
            marker = out / 'keep.txt'
            marker.write_text('existing site')
            with self.assertRaisesRegex(ValueError, 'new isolated'):
                module.restore(out)
            self.assertEqual(marker.read_text(), 'existing site')

    def test_wrong_archive_fails_before_output_is_created(self):
        with tempfile.TemporaryDirectory(prefix='e2-rollback-corrupt-') as directory:
            root = Path(directory)
            (root / '.release-backups').mkdir()
            (root / '.release-backups' / 'e2-pages-905b410.zip').write_bytes(b'corrupt archive')
            out = root / 'site'
            with patch.object(module, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'digest/size'):
                    module.restore(out)
            self.assertFalse(out.exists())

if __name__ == '__main__':
    unittest.main()
