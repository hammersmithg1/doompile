#!/usr/bin/env python3
"""Local-only API for reviewing native composer uploads with synthetic data."""

import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Fixture(BaseHTTPRequestHandler):
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
            self.json_response({"notes": []})
        else:
            self.json_response({}, 404)

    def do_POST(self):
        body = self.read_body()
        if self.path == "/api/telemetry":
            self.json_response({})
        elif self.path == "/api/attachments":
            head, _, tail = body.partition(b"\r\n\r\n")
            name = re.search(br'filename="([^"]*)"', head)
            mime = re.search(br"Content-Type: ([^\r\n]+)", head)
            attachment_id = self.headers.get("X-Doompile-Upload-ID")
            if name is None or mime is None or attachment_id is None:
                self.json_response({}, 400)
                return
            time.sleep(8)
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
        note = body["note"]
        note["revision"] = body["baseRevision"] + 1
        self.json_response({"note": note}, 201)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18743), Fixture).serve_forever()
