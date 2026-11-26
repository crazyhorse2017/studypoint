import base64
import hashlib
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
from pathlib import Path

# Ported from Prizm's harness. Studyflare adds Linux paths so the same runner works in GitHub Actions.
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]


def find_browser_exe() -> str:
    override = os.environ.get("STUDYPOINT_CHROME")
    if override and os.path.exists(override):
        return override
    for path in CHROME_PATHS:
        if os.path.exists(path):
            return path
    raise RuntimeError("No Chrome or Edge executable found. Set STUDYPOINT_CHROME to its path.")


class SimpleWebSocket:
    def __init__(self, host: str, port: int, path: str):
        self.sock = socket.create_connection((host, port), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket handshake closed unexpectedly")
            buf += chunk
        header_end = buf.index(b"\r\n\r\n") + 4
        headers = buf[:header_end].decode("latin1")
        if "101" not in headers.splitlines()[0]:
            raise RuntimeError(f"WebSocket handshake failed: {headers}")
        self._leftover = buf[header_end:]

    def _recv_exact(self, n: int) -> bytes:
        chunks = []
        remaining = n
        if self._leftover:
            take = self._leftover[:remaining]
            chunks.append(take)
            self._leftover = self._leftover[remaining:]
            remaining -= len(take)
        while remaining > 0:
            data = self.sock.recv(remaining)
            if not data:
                raise EOFError("WebSocket connection closed")
            chunks.append(data)
            remaining -= len(data)
        return b"".join(chunks)

    def send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        mask_key = os.urandom(4)
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack(">H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack(">Q", length))
        header.extend(mask_key)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _send_pong(self, payload: bytes) -> None:
        mask_key = os.urandom(4)
        header = bytearray([0x8A, 0x80 | len(payload)])
        header.extend(mask_key)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv_text(self) -> str:
        message_chunks = []
        while True:
            b1, b2 = self._recv_exact(2)
            fin = (b1 & 0x80) != 0
            opcode = b1 & 0x0F
            masked = (b2 & 0x80) != 0
            length = b2 & 0x7F
            if length == 126:
                (length,) = struct.unpack(">H", self._recv_exact(2))
            elif length == 127:
                (length,) = struct.unpack(">Q", self._recv_exact(8))
            mask_key = self._recv_exact(4) if masked else None
            payload = self._recv_exact(length)
            if mask_key:
                payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise EOFError("WebSocket closed by remote")
            if opcode == 0x9:
                self._send_pong(payload)
                continue
            if opcode == 0xA:
                continue
            message_chunks.append(payload)
            if fin:
                return b"".join(message_chunks).decode("utf-8")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class ChromeCdpSession:
    def __init__(self, width: int = 1440, height: int = 900):
        self.width = width
        self.height = height
        self.user_data_dir = tempfile.mkdtemp(prefix="studypoint_chrome_")
        exe = find_browser_exe()
        self.proc = subprocess.Popen(
            [
                exe,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--no-first-run",
                "--no-default-browser-check",
                "--remote-debugging-port=0",
                f"--user-data-dir={self.user_data_dir}",
                f"--window-size={width},{height}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        port_file = Path(self.user_data_dir) / "DevToolsActivePort"
        deadline = time.time() + 15
        while not port_file.exists() or port_file.stat().st_size == 0:
            if time.time() > deadline:
                self.close()
                raise RuntimeError("Timed out waiting for Chrome DevToolsActivePort")
            time.sleep(0.05)

        lines = port_file.read_text(encoding="utf-8").splitlines()
        port = int(lines[0].strip())
        ws_path = lines[1].strip()
        self.ws = SimpleWebSocket("127.0.0.1", port, ws_path)
        self._msg_id = 0
        self.session_id = None
        self.console_errors: list[str] = []

        target = self._call_raw("Target.createTarget", {"url": "about:blank"})
        attached = self._call_raw(
            "Target.attachToTarget",
            {"targetId": target["targetId"], "flatten": True},
        )
        self.session_id = attached["sessionId"]
        try:
            self._call_raw(
                "Browser.setDownloadBehavior",
                {"behavior": "allow", "downloadPath": self.user_data_dir},
            )
        except Exception:
            try:
                self.call(
                    "Page.setDownloadBehavior",
                    {"behavior": "allow", "downloadPath": self.user_data_dir},
                )
            except Exception:
                pass
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.set_viewport(width, height)

    def _call_raw(self, method: str, params: dict | None = None, session_id: str | None = None) -> dict:
        self._msg_id += 1
        req_id = self._msg_id
        msg = {"id": req_id, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        self.ws.send_text(json.dumps(msg))
        while True:
            raw = self.ws.recv_text()
            data = json.loads(raw)
            if "id" not in data:
                self._handle_event(data)
                continue
            if data["id"] == req_id:
                if "error" in data:
                    raise RuntimeError(f"CDP error on {method}: {data['error']}")
                return data.get("result", {})

    def _handle_event(self, event: dict) -> None:
        method = event.get("method")
        params = event.get("params", {})
        if method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            args = [str(a.get("value", a.get("description", ""))) for a in params.get("args", [])]
            self.console_errors.append("CONSOLE ERROR: " + " ".join(args))
        elif method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails", {})
            desc = details.get("exception", {}).get("description") or details.get("text", "Uncaught exception")
            url = details.get("url", "")
            line_no = details.get("lineNumber", "")
            col_no = details.get("columnNumber", "")
            self.console_errors.append(f"PAGE EXCEPTION: {desc} at {url}:{line_no}:{col_no}")

    def call(self, method: str, params: dict | None = None) -> dict:
        return self._call_raw(method, params, session_id=self.session_id)

    def set_viewport(self, width: int, height: int) -> None:
        self.call(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": width,
                "height": height,
                "deviceScaleFactor": 1,
                "mobile": width < 768,
            },
        )

    def navigate(self, url: str, wait_ms: int = 350) -> None:
        self.call("Page.navigate", {"url": url})
        deadline = time.time() + 12
        while time.time() < deadline:
            ready = self.evaluate("document.readyState")
            if ready == "complete":
                break
            time.sleep(0.05)
        time.sleep(wait_ms / 1000)

    def evaluate(self, expression: str):
        res = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
            },
        )
        if "exceptionDetails" in res:
            details = res["exceptionDetails"]
            raise RuntimeError(details.get("exception", {}).get("description") or details.get("text"))
        return res.get("result", {}).get("value")

    def wait_for(self, js_predicate: str, timeout_s: float = 10.0):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            val = self.evaluate(f"Boolean({js_predicate})")
            if val:
                return True
            time.sleep(0.05)
        raise TimeoutError(f"Timed out waiting for: {js_predicate}")

    def screenshot(self, path: str | Path) -> None:
        res = self.call("Page.captureScreenshot", {"format": "png"})
        Path(path).write_bytes(base64.b64decode(res["data"]))

    def close(self) -> None:
        if hasattr(self, "ws"):
            self.ws.close()
        if hasattr(self, "proc"):
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass
        if hasattr(self, "user_data_dir"):
            shutil.rmtree(self.user_data_dir, ignore_errors=True)
