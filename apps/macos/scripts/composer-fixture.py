#!/usr/bin/env python3
"""Local-only API for reviewing native composer uploads with synthetic data."""

import json
import os
import re
import copy
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class SyncReview:
    """Revision checks for the isolated native conflict review, disabled by default."""
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        with self.lock:
            self.active = False
            self.notes = {}
            self.original_id = None
            self.conflicts = 0
            self.requests = 0

    @staticmethod
    def document(text):
        return {"type": "doc", "attrs": {"editorVersion": 1, "attachmentRecoveryVersion": 1},
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}

    def start(self):
        self.reset()
        with self.lock:
            self.active = True
            self.original_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            note = {"id": self.original_id, "title": "Sync review", "plainText": "Sync review",
                    "body": self.document("Sync review"), "tags": [], "pinned": False, "urgent": False,
                    "kind": "note", "attachments": [], "createdAt": now, "updatedAt": now, "revision": 1}
            self.notes[note["id"]] = note
            return copy.deepcopy(note)

    def remote_edit(self):
        with self.lock:
            note = self.notes[self.original_id]
            note.update(title="Remote branch preserved", plainText="Remote branch preserved",
                        body=self.document("Remote branch preserved"), revision=note["revision"] + 1)
            return copy.deepcopy(note)

    def snapshot(self):
        with self.lock:
            return {"active": self.active, "originalID": self.original_id,
                    "conflicts": self.conflicts, "requests": self.requests,
                    "notes": copy.deepcopy(list(self.notes.values()))}

    def write(self, incoming, base):
        with self.lock:
            note = copy.deepcopy(incoming)
            current = self.notes.get(note["id"])
            # Other tests may leave tombstones in the app's dedicated local account.
            if not self.active or (current is None and note.get("deletedAt")):
                note["revision"] = base + 1
                return {"note": note}, 201, 0
            self.requests += 1
            content = lambda value: {key: val for key, val in value.items() if key != "revision"}
            if current and content(current) == content(note):
                return {"note": copy.deepcopy(current)}, 200, 0
            if (current or {}).get("revision", 0) != base:
                self.conflicts += 1
                # Keep typing possible while the actual 409 is in flight.
                return {"current": copy.deepcopy(current)}, 409, 2
            note["revision"] = base + 1
            self.notes[note["id"]] = note
            return {"note": copy.deepcopy(note)}, 200, 0


class Fixture(BaseHTTPRequestHandler):
    review = SyncReview()

    def json_response(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def do_GET(self):
        if self.path == "/api/notes":
            state = self.review.snapshot()
            self.json_response({"notes": state["notes"] if state["active"] else []})
        elif self.path == "/api/review/sync":
            self.json_response(self.review.snapshot())
        else:
            self.json_response({}, 404)

    def do_POST(self):
        body = self.read_body()
        if self.path == "/api/review/sync":
            self.json_response({"note": self.review.start()})
        elif self.path == "/api/review/remote":
            self.json_response({"note": self.review.remote_edit()})
        elif self.path == "/api/review/reset":
            self.review.reset()
            self.json_response({})
        elif self.path == "/api/telemetry":
            self.json_response({})
        elif self.path == "/api/attachments":
            head, _, tail = body.partition(b"\r\n\r\n")
            name = re.search(br'filename="([^"]*)"', head)
            mime = re.search(br"Content-Type: ([^\r\n]+)", head)
            attachment_id = self.headers.get("X-Doompile-Upload-ID")
            if name is None or mime is None or attachment_id is None:
                self.json_response({}, 400)
                return
            time.sleep(float(os.environ.get("DOOMPILE_COMPOSER_FIXTURE_DELAY", "8")))
            self.json_response({"attachment": {
                "id": attachment_id,
                "name": name[1].decode(),
                "mimeType": mime[1].decode(),
                "size": len(tail.rsplit(b"\r\n--", 1)[0]),
                "url": f"/api/attachments/{attachment_id}",
            }}, 201)
        else:
            self.json_response({}, 404)

    def do_PUT(self):
        body = json.loads(self.read_body())
        result, status, delay = self.review.write(body["note"], body["baseRevision"])
        time.sleep(delay)
        self.json_response(result, status)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18743), Fixture).serve_forever()
