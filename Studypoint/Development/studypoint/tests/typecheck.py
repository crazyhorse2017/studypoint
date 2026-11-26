"""
Full TypeScript type check (`tsc --noEmit` equivalent) WITHOUT Node.js. Ported from Prizm's harness.

How it works:
  1. Downloads the TypeScript compiler and the type definitions Studypoint uses from the
     official npm registry using only the Python standard library. Every tarball is
     verified against the registry's sha512 `integrity` hash before extraction.
     Only type files are kept, cached in %LOCALAPPDATA%/studypoint-typecheck-cache (outside the
     project, so editors and source control never see them); later runs are offline.
     TypeScript is pinned to 6.x (package.json): 7.x is the native-Go compiler and ships no
     lib/typescript.js, so it can't run in the browser.
     Compiler options are read from tsconfig.json, so this check and CI's `tsc` stay identical.
  2. Builds an in-memory virtual file system (src/**/*.ts(x) + .d.ts files).
  3. Runs the real TypeScript compiler API inside the signed headless Chrome/Edge that
     the JS test suite already uses (tests/chrome_cdp.py) and prints every diagnostic.

Usage:
  uv run --no-project --python 3.12 python tests/typecheck.py
  uv run --no-project --python 3.12 python tests/typecheck.py --refresh   # re-download

Exit code 0 = no type errors, 1 = type errors found.
"""

import base64
import functools
import hashlib
import http.server
import io
import json
import os
import re
import shutil
import sys
import tarfile
import threading
import urllib.parse
import urllib.request
from pathlib import Path

from chrome_cdp import ChromeCdpSession

ROOT = Path(__file__).resolve().parent.parent
# Cache lives OUTSIDE the project (per-user AppData) so editors / source control never see it.
CACHE = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".cache")) / "studypoint-typecheck-cache"
MODULES = CACHE / "node_modules"
REGISTRY = "https://registry.npmjs.org"
USER_AGENT = "studypoint-typecheck/1.0 (python-urllib)"

# Packages needed for type checking. Versions come from package.json (pinned exactly there).
# Add a package here whenever src/ starts importing it.
TYPE_PACKAGES = [
    "typescript",
    "@types/react",
    "@types/react-dom",
    "@cloudflare/workers-types",
    "vite",
]
# Transitive type-only dependencies (resolved from the dependent package's package.json).
TRANSITIVE = {"@types/react": ["csstype"]}


def _load_compiler_options() -> dict:
    """tsconfig.json is plain JSON in this repo (no comments), so json.loads is enough."""
    tsconfig = json.loads((ROOT / "tsconfig.json").read_text(encoding="utf-8"))
    return tsconfig["compilerOptions"]


TSCONFIG_COMPILER_OPTIONS = _load_compiler_options()


# ---------------------------------------------------------------- npm download --
def _get_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.npm.install-v1+json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_version(v: str):
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", v)
    return tuple(int(x) for x in m.groups()) if m else None


def _resolve_version(meta: dict, rng: str | None) -> str:
    versions = [v for v in meta.get("versions", {}) if _parse_version(v)]
    latest = meta.get("dist-tags", {}).get("latest")
    if not rng:
        return latest
    rng = rng.strip()
    m = re.match(r"^[\^~]?(\d+)\.(\d+)\.(\d+)", rng)
    if not m:
        return latest
    base = tuple(int(x) for x in m.groups())
    if rng.startswith("^"):
        ok = lambda t: t[0] == base[0] and t >= base if base[0] > 0 else t[:2] == base[:2] and t >= base
    elif rng.startswith("~"):
        ok = lambda t: t[:2] == base[:2] and t >= base
    else:
        ok = lambda t: t == base
    matching = sorted((_parse_version(v) for v in versions if ok(_parse_version(v))), reverse=True)
    if not matching:
        print(f"  ! no version of {meta.get('name')} satisfies {rng}; using latest {latest}")
        return latest
    return ".".join(str(x) for x in matching[0])


def _verify_integrity(data: bytes, integrity: str, name: str) -> None:
    algo, _, expected = (integrity or "").partition("-")
    if algo not in ("sha512", "sha384", "sha256") or not expected:
        raise RuntimeError(f"{name}: registry did not provide a usable integrity hash")
    digest = base64.b64encode(hashlib.new(algo, data).digest()).decode("ascii")
    if digest != expected:
        raise RuntimeError(f"{name}: tarball integrity mismatch â€” refusing to extract")


def _prune_to_type_files(package_dir: Path, keep_compiler: bool) -> None:
    """Keep only what type checking needs (package.json + .d.ts files, plus the compiler itself),
    so the cache stays small and never fills editors / source control with package sources."""
    for path in sorted(package_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_file():
            keep = (
                path.name == "package.json"
                or path.name.endswith((".d.ts", ".d.mts", ".d.cts"))
                or (keep_compiler and path.relative_to(package_dir).as_posix() == "lib/typescript.js")
            )
            if not keep:
                path.unlink()
        elif path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def _install(name: str, rng: str | None) -> dict:
    target = MODULES / name
    pkg_json = target / "package.json"
    if pkg_json.exists():
        return json.loads(pkg_json.read_text(encoding="utf-8"))
    meta = _get_json(f"{REGISTRY}/{urllib.parse.quote(name, safe='@')}")
    version = _resolve_version(meta, rng)
    dist = meta["versions"][version]["dist"]
    print(f"  downloading {name}@{version} ...")
    req = urllib.request.Request(dist["tarball"], headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    _verify_integrity(data, dist.get("integrity", ""), name)
    tmp = CACHE / "_extract"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(tmp, filter="data")  # rejects absolute paths, '..', links outside
    inner = next(p for p in tmp.iterdir() if p.is_dir())  # usually "package/"
    _prune_to_type_files(inner, keep_compiler=(name == "typescript"))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(target, ignore_errors=True)
    shutil.move(str(inner), str(target))
    shutil.rmtree(tmp, ignore_errors=True)
    return json.loads(pkg_json.read_text(encoding="utf-8"))


def ensure_packages(refresh: bool) -> None:
    if refresh:
        shutil.rmtree(CACHE, ignore_errors=True)
    MODULES.mkdir(parents=True, exist_ok=True)
    (CACHE / ".gitignore").write_text("*\n", encoding="utf-8")
    project = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    ranges = {**project.get("dependencies", {}), **project.get("devDependencies", {})}
    for name in TYPE_PACKAGES:
        pkg = _install(name, ranges.get(name))
        for dep in TRANSITIVE.get(name, []):
            _install(dep, (pkg.get("dependencies") or {}).get(dep))


# ------------------------------------------------------------ virtual FS build --
def build_vfs() -> dict:
    files: dict[str, str] = {}
    for path in sorted((ROOT / "src").rglob("*")):
        if path.suffix in (".ts", ".tsx") and path.is_file():
            files["/" + path.relative_to(ROOT).as_posix()] = path.read_text(encoding="utf-8")
    for path in MODULES.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(CACHE).as_posix()
        name = path.name
        # Skip Cloudflare's per-compatibility-date copies; the root index.d.ts is what resolves.
        if rel.startswith("node_modules/@cloudflare/workers-types/") and rel.count("/") > 3:
            continue
        if name == "package.json" or name.endswith((".d.ts", ".d.mts", ".d.cts")):
            files["/" + rel] = path.read_text(encoding="utf-8", errors="replace")
    return files


# ----------------------------------------------------------- browser checker --
CHECKER_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>Studypoint typecheck</title>
<script src="/typescript.js"></script></head><body><pre id="out">running</pre>
<script>
(async () => {
  try {
    const files = await (await fetch('/vfs.json')).json();
    const opts = await (await fetch('/options.json')).json();
    const dirs = new Set(['/']);
    for (const f of Object.keys(files)) {
      let d = f;
      while ((d = d.slice(0, d.lastIndexOf('/'))) ) dirs.add(d);
    }
    const parsed = ts.convertCompilerOptionsFromJson(opts, '/');
    if (parsed.errors.length) throw new Error(parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\\n')).join('; '));
    const options = parsed.options;
    const libDir = '/node_modules/typescript/lib/';
    const cache = new Map();
    const host = {
      getSourceFile(fileName, languageVersion) {
        if (cache.has(fileName)) return cache.get(fileName);
        const text = files[fileName];
        const sf = text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion, true);
        cache.set(fileName, sf);
        return sf;
      },
      getDefaultLibFileName: (o) => libDir + ts.getDefaultLibFileName(o),
      getDefaultLibLocation: () => libDir.slice(0, -1),
      writeFile() {},
      getCurrentDirectory: () => '/',
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\\n',
      fileExists: (f) => Object.prototype.hasOwnProperty.call(files, f),
      readFile: (f) => files[f],
      directoryExists: (d) => dirs.has(d.replace(/\\/$/, '') || '/'),
      getDirectories: (d) => {
        const base = d.replace(/\\/$/, '');
        const out = new Set();
        for (const x of dirs) {
          if (x.startsWith(base + '/') && !x.slice(base.length + 1).includes('/')) out.add(x.slice(base.length + 1));
        }
        return [...out];
      },
      realpath: (p) => p,
    };
    const roots = Object.keys(files).filter((f) => f.startsWith('/src/') && /\\.(ts|tsx)$/.test(f));
    const program = ts.createProgram({ rootNames: roots, options, host });
    const diags = ts.getPreEmitDiagnostics(program);
    window.__TYPECHECK__ = {
      version: ts.version,
      rootCount: roots.length,
      diagnostics: diags.map((d) => {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        return {
          file: d.file ? d.file.fileName : '',
          line: pos ? pos.line + 1 : 0,
          col: pos ? pos.character + 1 : 0,
          code: d.code,
          category: ts.DiagnosticCategory[d.category],
          message: ts.flattenDiagnosticMessageText(d.messageText, '\\n'),
        };
      }),
    };
  } catch (err) {
    window.__TYPECHECK__ = { fatal: String(err && err.stack || err) };
  }
  document.getElementById('out').textContent = 'done';
})();
</script></body></html>"""


def run_checker(files: dict) -> dict:
    payloads = {
        "/index.html": ("text/html; charset=utf-8", CHECKER_HTML.encode("utf-8")),
        "/vfs.json": ("application/json", json.dumps(files).encode("utf-8")),
        "/options.json": ("application/json", json.dumps(TSCONFIG_COMPILER_OPTIONS).encode("utf-8")),
        "/typescript.js": (
            "application/javascript; charset=utf-8",
            (MODULES / "typescript" / "lib" / "typescript.js").read_bytes(),
        ),
    }

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            entry = payloads.get(self.path.split("?", 1)[0])
            if not entry:
                self.send_error(404)
                return
            ctype, body = entry
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    session = None
    try:
        session = ChromeCdpSession()
        # Type checking ~100 files blocks the page's main thread for a while; CDP replies wait for it.
        session.ws.sock.settimeout(300)
        session.navigate(f"http://127.0.0.1:{server.server_address[1]}/index.html", wait_ms=200)
        session.wait_for("window.__TYPECHECK__", timeout_s=300)
        return session.evaluate("window.__TYPECHECK__")
    finally:
        if session:
            session.close()
        server.shutdown()
        server.server_close()


def main() -> int:
    refresh = "--refresh" in sys.argv
    print(f"Preparing TypeScript + type definitions (cache: {CACHE})...")
    ensure_packages(refresh)
    files = build_vfs()
    print(f"Type checking {sum(1 for f in files if f.startswith('/src/'))} source files in headless browser...")
    result = run_checker(files)
    if result.get("fatal"):
        print("FATAL:", result["fatal"])
        return 2
    diags = [d for d in result["diagnostics"] if d["category"] == "Error"]
    for d in sorted(diags, key=lambda x: (x["file"], x["line"], x["col"])):
        loc = f"{d['file'].lstrip('/')}:{d['line']}:{d['col']}" if d["file"] else "(global)"
        print(f"{loc}  TS{d['code']}: {d['message']}")
    print(f"\nTypeScript {result['version']}: {len(diags)} error(s) in {result['rootCount']} files.")
    return 1 if diags else 0


if __name__ == "__main__":
    sys.exit(main())
