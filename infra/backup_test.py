import gzip
import hashlib
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

    def test_history_hashes_and_referenced_blobs_are_verified(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.fixture(directory)
            database = sqlite3.connect(directory / 'doompile.sqlite')
            database.executescript('CREATE TABLE note_history_blobs(hash TEXT PRIMARY KEY,payload BLOB); CREATE TABLE note_versions(note_id TEXT,revision INTEGER,parent_revision INTEGER,delta_hash TEXT,checkpoint_hash TEXT,input_hash TEXT,snapshot_hash TEXT,legacy_hash TEXT); CREATE TABLE note_replicas(note_id TEXT,state BLOB);')
            data = b'synthetic saved version'
            key = hashlib.sha256(data).hexdigest()
            database.execute('INSERT INTO note_history_blobs VALUES (?,?)', (key, gzip.compress(data)))
            database.execute('INSERT INTO note_versions VALUES (?,?,NULL,?,NULL,NULL,NULL,NULL)', ('note', 1, key))
            database.commit()
            self.assertEqual(self.verify(directory).returncode, 0)
            database.execute('UPDATE note_history_blobs SET payload=?', (gzip.compress(b'damaged version'),))
            database.commit()
            self.assertNotEqual(self.verify(directory).returncode, 0)
            database.execute('DELETE FROM note_history_blobs')
            database.commit()
            self.assertNotEqual(self.verify(directory).returncode, 0)
            database.close()
