"""Local checks for the fixed Pages rollback, without network or deployment."""
import importlib.util
import hashlib
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
            # Verify the frozen recovery copy independently of current UI translations.
            self.assertEqual(hashlib.sha256((out / 'customer.js').read_bytes()).hexdigest(), 'cc62c21f11b8fcd7508df89c76cfb9638a8336ce745f6f1a9221103fbf3b21bc')
            self.assertEqual(hashlib.sha256((out / 'my-e2.js').read_bytes()).hexdigest(), '20203e9d0ab2544f902041547c33161f02e86337c275275067eb81da844e5356')
            for name in ['customer-session.mjs', 'car-detail-demo.css']:
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
