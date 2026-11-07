import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from publish_macos_update import publish


class MacUpdatePublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.destination = self.root / 'public'

    def release(self, build, contents=b'a release archive'):
        source = self.root / ('release-' + build)
        source.mkdir(exist_ok=True)
        name = 'Doompile-macOS-' + build + '.zip'
        (source / name).write_bytes(contents)
        (source / 'release.json').write_text(json.dumps({
            'platform': 'macos', 'file': name, 'build': build,
            'size': len(contents), 'sha256': hashlib.sha256(contents).hexdigest(),
        }))
        (source / 'appcast.xml').write_text(f'''<?xml version="1.0"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item>
<sparkle:version>{build}</sparkle:version><enclosure url="https://notes.example.org/doompile/downloads/macos/{name}"
length="{len(contents)}" sparkle:edSignature="signature-from-trusted-CI"/>
</item></channel></rss>''')
        return source

    def test_publishes_bytes_without_changing_signed_feed_and_keeps_old_archives(self):
        first = self.release('8.1')
        publish(first, self.destination)
        publish(first, self.destination)
        second = self.release('9.1')
        publish(second, self.destination)
        self.assertEqual((self.destination / 'appcast.xml').read_bytes(), (second / 'appcast.xml').read_bytes())
        self.assertTrue((self.destination / 'Doompile-macOS-8.1.zip').is_file())
        self.assertEqual((self.destination / 'Doompile-macOS-9.1.zip').read_bytes(), b'a release archive')

    def test_rejects_tampered_downloads_and_feed_mismatch(self):
        source = self.release('8.1')
        (source / 'Doompile-macOS-8.1.zip').write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            publish(source, self.destination)
        source = self.release('8.1')
        (source / 'appcast.xml').write_text((source / 'appcast.xml').read_text().replace('<sparkle:version>8.1', '<sparkle:version>7.1'))
        with self.assertRaises(ValueError):
            publish(source, self.destination)
        self.assertFalse((self.destination / 'appcast.xml').exists())

    def test_refuses_rollback_and_changing_an_existing_release(self):
        source = self.release('9.1')
        publish(source, self.destination)
        for release in (self.release('8.1'), self.release('9.1', b'changed')):
            with self.assertRaises(ValueError):
                publish(release, self.destination)
        self.assertEqual((self.destination / 'Doompile-macOS-9.1.zip').read_bytes(), b'a release archive')

    def test_copy_failure_cannot_publish_a_feed_pointing_to_missing_archive(self):
        first = self.release('8.1')
        publish(first, self.destination)
        second = self.release('9.1')
        with patch('publish_macos_update.atomic_copy', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                publish(second, self.destination)
        self.assertEqual((self.destination / 'appcast.xml').read_bytes(), (first / 'appcast.xml').read_bytes())


if __name__ == '__main__':
    unittest.main()
