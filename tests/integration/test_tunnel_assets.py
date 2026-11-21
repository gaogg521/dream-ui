import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/release'))
from install_tunnel_assets import install, validate_archive
from tunnel_assets import deploy


class AssetsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def archive(self, version='3.0.20', files=None):
        files = files or {'assets/new-hash.js': b'new JS', 'assets/new-hash.css': b'CSS'}
        manifest = {'version': version, 'label': 'win32-x64',
                    'files': {p: hashlib.sha256(data).hexdigest() for p, data in files.items()}}
        output = self.root / ('remote-ui-' + version + '.tar.gz')
        with tarfile.open(output, 'w:gz') as archive:
            for name, data in {'manifest.json': json.dumps(manifest).encode(), **files}.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        return output

    def test_checksum_rejects_modified_payload(self):
        archive = self.archive()
        manifest, _ = validate_archive(archive)
        self.assertIn('assets/new-hash.js', manifest['files'])
        with tarfile.open(archive, 'r:gz') as tar:
            entries = {item.name: tar.extractfile(item).read() for item in tar}
        entries['assets/new-hash.js'] = b'corrupted'
        with tarfile.open(archive, 'w:gz') as tar:
            for name, data in entries.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))
        with self.assertRaisesRegex(ValueError, 'checksum'):
            validate_archive(archive)

    def test_rejects_path_traversal(self):
        with self.assertRaisesRegex(ValueError, 'Invalid archive'):
            validate_archive(self.archive(files={'assets/../../escape.js': b'bad'}))

    def test_missing_archive_blocks_publishing(self):
        with self.assertRaisesRegex(ValueError, 'Missing packaged'):
            deploy(self.root, '3.0.20', True)

    def test_different_updater_version_is_rejected(self):
        self.archive()
        with self.assertRaisesRegex(ValueError, 'version differs'):
            deploy(self.root, '3.0.21', True)

    @unittest.skipUnless(sys.platform != 'win32', 'Production installer uses Linux flock')
    def test_upgrade_and_retry_keep_old_assets(self):
        storage = self.root / 'storage'
        old = self.archive('3.0.19', {'assets/old-hash.js': b'old JS', 'assets/old-hash.css': b'old CSS'})
        install(old, storage)
        new = self.archive()
        install(new, storage)
        install(new, storage)
        self.assertEqual((storage / 'shared/assets/old-hash.js').read_bytes(), b'old JS')
        self.assertEqual((storage / 'shared/assets/new-hash.js').read_bytes(), b'new JS')

    @unittest.skipUnless(sys.platform != 'win32', 'Production installer uses Linux flock')
    def test_collision_cannot_overwrite_existing_release(self):
        storage = self.root / 'storage'
        install(self.archive(), storage)
        clash = self.archive('3.0.21', {'assets/new-hash.js': b'different', 'assets/new.css': b'CSS'})
        with self.assertRaisesRegex(ValueError, 'immutable'):
            install(clash, storage)
        self.assertEqual((storage / 'shared/assets/new-hash.js').read_bytes(), b'new JS')

    @unittest.skipUnless(sys.platform != 'win32', 'Production installer uses Linux flock')
    def test_forced_same_version_publish_retains_both_sets_of_hashes(self):
        storage = self.root / 'storage'
        install(self.archive(), storage)
        install(self.archive(files={'assets/rebuilt-hash.js': b'rebuilt', 'assets/rebuilt-hash.css': b'CSS'}), storage)
        self.assertEqual(len(list((storage / 'releases').glob('*.json'))), 2)
        self.assertTrue((storage / 'shared/assets/new-hash.js').exists())


if __name__ == '__main__':
    unittest.main()
