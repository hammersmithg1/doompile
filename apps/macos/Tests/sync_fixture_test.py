"""Exercise the native review fixture over HTTP with the real causal store."""
import copy
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
import uuid


class SyncFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        cls.origin = f"http://127.0.0.1:{port}"
        script = Path(__file__).parents[1] / "scripts/composer-fixture.py"
        cls.process = subprocess.Popen([sys.executable, str(script)],
            env={**os.environ, "DOOMPILE_COMPOSER_FIXTURE_PORT": str(port)},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                cls.request("/api/review/sync")
                return
            except (OSError, urllib.error.URLError):
                if cls.process.poll() is not None:
                    raise RuntimeError("Native review fixture exited before becoming ready")
                time.sleep(0.05)
        raise RuntimeError("Native review fixture did not become ready")

    @classmethod
    def stop(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()

    @classmethod
    def request(cls, path, body=None):
        payload = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(cls.origin + path, data=payload,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def setUp(self):
        self.request("/api/review/reset", {})

    def test_offline_legacy_edit_merges_with_remote_and_keeps_authored_history(self):
        seed = self.request("/api/review/sync", {})["note"]
        cached = copy.deepcopy(seed)
        cached.pop("replica")
        cached["body"]["content"][0]["content"][0]["text"] += " local"
        cached["plainText"] += " local"
        self.request("/api/review/offline", {})
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.request("/api/notes?cursor=0")
        self.assertEqual(failure.exception.code, 503)
        failure.exception.close()
        self.request("/api/review/remote", {})
        self.request("/api/review/online", {})
        mutation_id = str(uuid.uuid4())
        change = {"legacy": [{"id": mutation_id, "note": cached,
            "baseline": seed, "baseRevision": seed["revision"], "origin": "ios"}]}
        saved = self.request(f'/api/notes/{seed["id"]}/sync', change)
        self.assertEqual(saved["note"]["plainText"], "Remote Sync review local")
        self.assertEqual(saved["acknowledged"], [mutation_id])
        retry = self.request(f'/api/notes/{seed["id"]}/sync', change)
        self.assertEqual(retry["note"]["revision"], saved["note"]["revision"])
        state = self.request("/api/review/sync")
        self.assertEqual([n["id"] for n in state["notes"]], [seed["id"]])
        path = f'/api/notes/{seed["id"]}/versions/{saved["note"]["revision"]}'
        self.assertEqual(self.request(path + "?view=authored")["note"]["plainText"], "Sync review local")
        restored = self.request(f'/api/notes/{seed["id"]}/versions/1', {"origin": "macos", "view": "merged"})
        self.assertEqual(restored["note"]["id"], seed["id"])
        self.assertEqual(restored["note"]["plainText"], "Sync review")
        self.assertGreater(restored["note"]["revision"], saved["note"]["revision"])

    def test_collection_contract_and_reset(self):
        seed = self.request("/api/review/sync", {})["note"]
        page = self.request("/api/notes?cursor=0")
        self.assertEqual([n["id"] for n in page["notes"]], [seed["id"]])
        self.assertFalse(page["more"])
        self.assertEqual(self.request(f'/api/notes?cursor={page["cursor"]}')["notes"], [])
        self.request("/api/review/reset", {})
        self.assertEqual(self.request("/api/notes?cursor=0")["notes"], [])
        self.assertFalse(self.request("/api/review/sync")["active"])
