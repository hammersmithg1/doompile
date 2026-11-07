import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


class BackupVerificationTests(unittest.TestCase):
    def verify(self, directory):
        return subprocess.run(
            ['node', str(Path(__file__).with_name('verify-backup.mjs')), str(directory)],
            capture_output=True, text=True,
        )

    def fixture(self, directory):
        attachment_id = '613e83a9-92e2-4cd7-8477-9b9395b503c0'
        database = sqlite3.connect(directory / 'doompile.sqlite')
        database.execute('CREATE TABLE notes (payload TEXT NOT NULL)')
        database.execute('INSERT INTO notes VALUES (?)', (json.dumps({
            'attachments': [{'url': '/api/attachments/' + attachment_id, 'size': 3}],
        }),))
        database.commit()
        database.close()
        (directory / 'attachments').mkdir()
        (directory / 'attachments' / attachment_id).write_bytes(b'abc')
        return directory / 'attachments' / attachment_id

    def test_valid_backup_is_read_without_modifying_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.fixture(directory)
            before = (directory / 'doompile.sqlite').read_bytes()
            result = self.verify(directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((directory / 'doompile.sqlite').read_bytes(), before)

    def test_missing_and_incomplete_attachment_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            attachment = self.fixture(directory)
            attachment.write_bytes(b'a')
            self.assertNotEqual(self.verify(directory).returncode, 0)
            attachment.unlink()
            self.assertNotEqual(self.verify(directory).returncode, 0)

    def test_broken_database_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'doompile.sqlite').write_bytes(b'not a database')
            self.assertNotEqual(self.verify(directory).returncode, 0)
