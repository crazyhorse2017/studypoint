"""
Studyflare repo audit (TESTING §3, AGENTS §3). Static checks that need no Node.js.

Usage:
  uv run --no-project --python 3.12 python tests/verify_repo.py              # audit the repo
  uv run --no-project --python 3.12 python tests/verify_repo.py --self-test  # prove every rule catches a planted violation

Each rule is a function (files) -> list[Violation], where `files` maps repo-relative
POSIX paths to text. `--self-test` runs every rule against planted violations and
clean examples, so a rule can't silently stop working.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".jsonc", ".sql", ".md", ".py", ".yml", ".yaml", ".txt"}
SKIP_DIRS = {"node_modules", "dist", ".wrangler", "__pycache__", ".git"}


@dataclass(frozen=True)
class Violation:
    rule: str
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        return f"[{self.rule}] {self.path}:{self.line}: {self.message}"


Files = dict[str, str]
Rule = Callable[[Files], list[Violation]]


def _strip_comments(src: str) -> str:
    """Blank out // and /* */ comments (keeping line numbers) so rules don't fire on prose."""
    out, i, n = [], 0, len(src)
    in_str: str | None = None
    while i < n:
        c = src[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == in_str:
                in_str = None
            i += 1; continue
        if c in "'\"`":
            in_str = c; out.append(c); i += 1; continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i)); i = j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in src[i:j])); i = j; continue
        out.append(c); i += 1
    return "".join(out)


def _scan(files: Files, rule: str, path_pred: Callable[[str], bool], pattern: re.Pattern[str], message: str,
          strip: bool = True) -> list[Violation]:
    found: list[Violation] = []
    for path, text in files.items():
        if not path_pred(path):
            continue
        body = _strip_comments(text) if strip and path.endswith((".ts", ".tsx")) else text
        for m in pattern.finditer(body):
            line = body.count("\n", 0, m.start()) + 1
            found.append(Violation(rule, path, line, message))
    return found


def is_src_ts(p: str) -> bool:
    return p.startswith("src/") and p.endswith((".ts", ".tsx"))


def is_client(p: str) -> bool:
    return p.startswith("src/client/") and p.endswith((".ts", ".tsx"))


# ------------------------------------------------------------------ rules --
def rule_native_controls(files: Files) -> list[Violation]:
    """AGENTS 17 / DESIGN §5: no native dialogs or controls in client code."""
    v = []
    v += _scan(files, "native-dialog", is_client, re.compile(r"(?<![\w.])(?:window\.)?(alert|confirm|prompt)\s*\("),
               "Native alert/confirm/prompt is banned. Use ConfirmDialog or Toast.")
    v += _scan(files, "native-select", is_client, re.compile(r"<select\b"), "<select> is banned. Use the ds Select.")
    v += _scan(files, "native-dialog-el", lambda p: is_client(p) and not p.startswith("src/client/ds/"),
               re.compile(r"<dialog\b"), "<dialog> is only allowed inside src/client/ds/.")
    bad_input = re.compile(r"""<input\b[^>]*\btype\s*=\s*\{?\s*["'](checkbox|radio|range|color|date|time|datetime-local|number|month|week)["']""")
    v += _scan(files, "native-input", is_client, bad_input, "Native input type is banned. Use the ds component.")
    file_input = re.compile(r"""<input\b[^>]*\btype\s*=\s*\{?\s*["']file["']""")
    v += _scan(files, "native-file-input", lambda p: is_client(p) and p != "src/client/ds/FileDrop.tsx", file_input,
               'type="file" is only allowed inside src/client/ds/FileDrop.tsx.')
    return v


def rule_erasable_ts(files: Files) -> list[Violation]:
    """AGENTS 21: erasable TypeScript only."""
    v = []
    v += _scan(files, "ts-enum", is_src_ts, re.compile(r"^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s+\w+", re.M),
               "enum is not erasable. Use a string-union type.")
    v += _scan(files, "ts-namespace", is_src_ts, re.compile(r"^\s*(export\s+)?(declare\s+)?(namespace|module)\s+[\w.]+\s*\{", re.M),
               "namespace is not erasable.")
    # The local type stripper (tests/ts_strip.py) can't parse a function-type *return* annotation such as
    # `function f(): () => number {`. Use a type alias instead: `type Rand = () => number; function f(): Rand {`.
    v += _scan(files, "ts-fn-type-return", lambda p: p.endswith((".ts", ".tsx")) and p.startswith(("src/", "tests/")),
               re.compile(r"\)\s*:\s*\([^()]*\)\s*=>\s*[\w<>\[\]|. ]+\s*\{"),
               "Function-type return annotation breaks tests/ts_strip.py. Use a type alias.")
    # Same stripper limitation for type guards with an inline object type: `(x): x is { a: string } =>`.
    v += _scan(files, "ts-inline-type-guard", lambda p: p.endswith((".ts", ".tsx")) and p.startswith(("src/", "tests/")),
               re.compile(r"\)\s*:\s*\w+\s+is\s+\{"),
               "Type guard with an inline object type breaks tests/ts_strip.py. Use a named type.")
    v += _scan(files, "ts-param-property", is_src_ts,
               re.compile(r"constructor\s*\([^)]*\b(public|private|protected|readonly)\s+\w"),
               "Constructor parameter properties are not erasable.")
    return v


AI_SDKS = r"@google/genai|@google/generative-ai|openai|@anthropic-ai/sdk|@ai-sdk/[\w-]+|langchain|@langchain/[\w-]+"


def rule_no_ai_sdks(files: Files) -> list[Violation]:
    """ARCHITECTURE A8: REST only, no AI SDKs."""
    v = _scan(files, "ai-sdk-import", is_src_ts, re.compile(rf"""from\s+['"]({AI_SDKS})['"]|import\(\s*['"]({AI_SDKS})['"]"""),
              "AI SDKs are banned. Call providers over REST in src/worker/ai/providers/.")
    pkg = files.get("package.json")
    if pkg:
        data = json.loads(pkg)
        for section in ("dependencies", "devDependencies"):
            for name in data.get(section, {}):
                if re.fullmatch(AI_SDKS, name):
                    v.append(Violation("ai-sdk-dependency", "package.json", 1, f"{name} is an AI SDK and is banned."))
    return v


def rule_provider_calls_in_gateway(files: Files) -> list[Violation]:
    """AGENTS 1: provider hosts are only referenced from src/worker/ai/."""
    hosts = re.compile(r"generativelanguage\.googleapis\.com|api\.tavily\.com|api\.anthropic\.com|api\.openai\.com")
    return _scan(files, "provider-outside-gateway", lambda p: is_src_ts(p) and not p.startswith("src/worker/ai/"), hosts,
                 "Provider endpoints may only be called from src/worker/ai/ (the gateway).")


def rule_no_hardcoded_models(files: Files) -> list[Violation]:
    """NFR-PORT: model IDs live in AI_MODELS config, not code."""
    model = re.compile(r"""['"`](gemini-\d[\w.-]*|@cf/[\w./-]+|claude-[a-z]+-[\w.-]+)['"`]""")
    allowed = lambda p: p.startswith("src/worker/ai/config")  # noqa: E731 - config schema defaults only
    return _scan(files, "hardcoded-model-id", lambda p: is_src_ts(p) and not allowed(p), model,
                 "Hard-coded model ID. Read it from the AI_MODELS config.")


def rule_server_only(files: Files) -> list[Violation]:
    """AGENTS 22: client never imports worker code; shared code stays pure."""
    v = _scan(files, "client-imports-worker", is_client, re.compile(r"""from\s+['"][^'"]*\bworker/"""),
              "Client code must not import from src/worker/.")
    v += _scan(files, "shared-impure", lambda p: p.startswith("src/shared/") and p.endswith((".ts", ".tsx")),
               # `document.`/`window.` as DOM globals, not inside paths like 'word/document.xml'.
               re.compile(r"""from\s+['"][^'"]*\b(worker|client)/|(?<![\w/])document\.|(?<![\w/])window\.|\benv\.(DB|FILES|VEC|AI|ASSETS)\b"""),
               "src/shared/ must stay pure: no DOM, no bindings, no client/worker imports.")
    return v


SECRET = re.compile(r"AIza[0-9A-Za-z_\-]{35}|tvly-[0-9A-Za-z]{20,}|sk-ant-[0-9A-Za-z_\-]{20,}|sk-[0-9A-Za-z]{40,}")


def rule_no_secrets(files: Files) -> list[Violation]:
    """AGENTS 14 / NFR-SEC: no API keys anywhere in the repo."""
    return _scan(files, "secret", lambda p: True, SECRET, "Looks like an API key. Secrets belong in Worker secrets only.",
                 strip=False)


EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
EMAIL_OK = re.compile(r"@(studypoint\.invalid|example\.(com|org|net)|users\.noreply\.github\.com)$")


def rule_no_emails_in_code(files: Files) -> list[Violation]:
    """AUTH-03: ALLOWED_EMAILS is a secret; no real addresses in code or config."""
    v = []
    targets = lambda p: (p.startswith(("src/", "migrations/", "tests/fixtures/")) or p in ("wrangler.jsonc", "package.json"))  # noqa: E731
    for path, text in files.items():
        if not targets(path):
            continue
        for m in EMAIL.finditer(text):
            if EMAIL_OK.search(m.group(0)):
                continue
            v.append(Violation("email-in-code", path, text.count("\n", 0, m.start()) + 1,
                               "Real email address in code/config. Use the ALLOWED_EMAILS secret."))
    return v


def rule_migrations(files: Files) -> list[Violation]:
    """DATABASE §1: numbered, forward-only, schema-only (no seed data), never edited after merge."""
    v: list[Violation] = []
    migs = sorted(p for p in files if p.startswith("migrations/") and p.endswith(".sql"))
    for idx, path in enumerate(migs, start=1):
        name = path.rsplit("/", 1)[1]
        m = re.fullmatch(r"(\d{4})_[a-z0-9_]+\.sql", name)
        if not m:
            v.append(Violation("migration-name", path, 1, "Migrations must be named NNNN_snake_case.sql."))
            continue
        if int(m.group(1)) != idx:
            v.append(Violation("migration-sequence", path, 1, f"Expected migration number {idx:04d}."))
        # Trigger bodies (e.g. keeping passages_fts in sync) aren't seed data: blank them out, keeping line numbers.
        body = re.sub(r"CREATE\s+TRIGGER\b.*?\bEND\s*;", lambda m: re.sub(r"[^\n]", " ", m.group(0)),
                      files[path], flags=re.I | re.S)
        for ins in re.finditer(r"\bINSERT\s+INTO\s+(\w+)", body, re.I):
            if ins.group(1).lower() != "schema_meta":
                v.append(Violation("migration-seed-data", path, body.count("\n", 0, ins.start()) + 1,
                                   "Migrations are schema-only (LIB-12, NFR-DATA). No seed rows."))
    applied = files.get("migrations/.applied-hashes")
    if applied:
        for line_no, line in enumerate(applied.splitlines(), start=1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, _, digest = line.partition(" ")
            path = f"migrations/{name}"
            if path not in files:
                v.append(Violation("migration-deleted", path, 1, "An applied migration was deleted."))
            elif hashlib.sha256(files[path].encode("utf-8")).hexdigest() != digest.strip():
                v.append(Violation("migration-edited", path, 1, "An applied migration was edited. Add a new migration instead."))
    return v


def rule_ships_blank(files: Files) -> list[Violation]:
    """LIB-12: no course names or fixture titles in app code."""
    denylist = files.get("tests/blank_denylist.txt", "")
    patterns = [ln.strip() for ln in denylist.splitlines() if ln.strip() and not ln.startswith("#")]
    v: list[Violation] = []
    for pat in patterns:
        rx = re.compile(re.escape(pat).replace(r"\ ", r"\s*"), re.I)
        v += _scan(files, "ships-blank", lambda p: p.startswith("src/") or p == "index.html", rx,
                   f'"{pat}" is on the blank-app denylist (LIB-12). The app ships with no course content.', strip=False)
    return v


HEX_COLOR = re.compile(r"(?<![\w&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b")
TOKEN_FILES = ("src/client/styles.css", "src/client/styles/tokens.css")


def rule_tokens_not_hex(files: Files) -> list[Violation]:
    """AGENTS 18: components use design tokens, never raw hex colours."""
    return _scan(files, "raw-hex-colour", lambda p: p.startswith("src/client/") and p.endswith((".ts", ".tsx", ".css"))
                 and p not in TOKEN_FILES, HEX_COLOR, "Raw hex colour. Use a design token (var(--…)).")


def rule_required_files(files: Files) -> list[Violation]:
    required = ["AGENTS.md", "CLAUDE.md", "package.json", "wrangler.jsonc", "tsconfig.json", "tests/blank_denylist.txt"] + [
        f"docs/{d}.md" for d in ("PRD", "ARCHITECTURE", "DATABASE", "AI_SYSTEM", "DESIGN", "IMPLEMENTATION", "TASKS", "TESTING")
    ]
    return [Violation("required-file", r, 1, "Required file is missing.") for r in required if r not in files]


def rule_pinned_versions(files: Files) -> list[Violation]:
    """IMPLEMENTATION §4: dependencies pinned to exact versions."""
    pkg = files.get("package.json")
    if not pkg:
        return []
    v = []
    data = json.loads(pkg)
    for section in ("dependencies", "devDependencies"):
        for name, ver in data.get(section, {}).items():
            if not re.fullmatch(r"\d+\.\d+\.\d+", ver):
                v.append(Violation("unpinned-dependency", "package.json", 1, f"{name}@{ver} must be pinned to an exact version."))
    return v


MOJIBAKE = re.compile("Â[ -¿]|Ã[\u0080-¿‘-›]|â€")


def rule_no_mojibake(files: Files) -> list[Violation]:
    """UTF-8 read as Windows-1252 (e.g. by PowerShell 5.1 Get-Content) turns '§' into 'Â§' and '—' into 'â€”'."""
    # This file itself is excluded: it must spell out the garbled sequences to detect them.
    return _scan(files, "mojibake", lambda p: not p.endswith(".json") and p != "tests/verify_repo.py", MOJIBAKE,
                 "Garbled characters (UTF-8 read as Windows-1252). Re-save the file as UTF-8.", strip=False)


RULES: list[Rule] = [
    rule_no_mojibake,
    rule_native_controls, rule_erasable_ts, rule_no_ai_sdks, rule_provider_calls_in_gateway, rule_no_hardcoded_models,
    rule_server_only, rule_no_secrets, rule_no_emails_in_code, rule_migrations, rule_ships_blank, rule_tokens_not_hex,
    rule_required_files, rule_pinned_versions,
]


def audit(files: Files) -> list[Violation]:
    out: list[Violation] = []
    for rule in RULES:
        out += rule(files)
    return out


def load_repo() -> Files:
    files: Files = {}
    for path in ROOT.rglob("*"):
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts) or not path.is_file():
            continue
        if path.suffix in TEXT_SUFFIXES or path.name in (".applied-hashes", ".gitignore"):
            files[rel.as_posix()] = path.read_text(encoding="utf-8", errors="replace")
    return files


# -------------------------------------------------------------- self-test --
PLANTED: list[tuple[str, Files]] = [
    ("native-dialog", {"src/client/A.tsx": "export const f = () => alert('hi');"}),
    ("native-dialog", {"src/client/A.tsx": "if (window.confirm('ok?')) go();"}),
    ("native-select", {"src/client/A.tsx": "const x = <select><option/></select>;"}),
    ("native-dialog-el", {"src/client/A.tsx": "const x = <dialog open />;"}),
    ("native-input", {"src/client/A.tsx": 'const x = <input type="checkbox" />;'}),
    ("native-input", {"src/client/A.tsx": "const x = <input className='a' type='range' />;"}),
    ("native-file-input", {"src/client/Upload.tsx": 'const x = <input type="file" />;'}),
    ("ts-enum", {"src/shared/a.ts": "export enum Color { Red }"}),
    ("ts-namespace", {"src/shared/a.ts": "namespace Foo { export const x = 1; }"}),
    ("ts-param-property", {"src/shared/a.ts": "class A { constructor(private db: string) {} }"}),
    ("ts-inline-type-guard", {"src/worker/a.ts": "xs.filter((x): x is { k: string } => x !== null);"}),
    ("ts-fn-type-return", {"tests/suites/a.test.ts": "function rng(seed: number): () => number {\n  return () => seed;\n}"}),
    ("ai-sdk-import", {"src/worker/x.ts": "import { GoogleGenAI } from '@google/genai';"}),
    ("ai-sdk-dependency", {"package.json": json.dumps({"dependencies": {"openai": "4.0.0"}})}),
    ("provider-outside-gateway", {"src/worker/routes/chat.ts": "fetch('https://generativelanguage.googleapis.com/v1')"}),
    ("hardcoded-model-id", {"src/worker/routes/chat.ts": "const m = 'gemini-3.8-flash';"}),
    ("hardcoded-model-id", {"src/worker/ingest/ocr.ts": 'const m = "@cf/mistral/mistral-small-3.1-24b-instruct";'}),
    ("client-imports-worker", {"src/client/A.tsx": "import { x } from '../worker/http.ts';"}),
    ("shared-impure", {"src/shared/a.ts": "export const t = () => document.title;"}),
    ("secret", {"docs/notes.md": "key AIza" + "A" * 35}),
    ("email-in-code", {"wrangler.jsonc": '{ "vars": { "ALLOWED_EMAILS": "someone@umbc.edu" } }'}),
    ("migration-name", {"migrations/init.sql": "CREATE TABLE a (id TEXT);"}),
    ("migration-sequence", {"migrations/0002_init.sql": "CREATE TABLE a (id TEXT);"}),
    ("migration-seed-data", {"migrations/0001_init.sql": "CREATE TABLE courses (id TEXT); INSERT INTO courses VALUES ('x');"}),
    ("migration-edited", {"migrations/0001_init.sql": "CREATE TABLE a (id TEXT);",
                          "migrations/.applied-hashes": "0001_init.sql " + "0" * 64}),
    ("ships-blank", {"tests/blank_denylist.txt": "MATH 152", "src/client/Onboarding.tsx": "placeholder='MATH152'"}),
    ("raw-hex-colour", {"src/client/A.tsx": "const s = { color: '#1F3B66' };"}),
    ("mojibake", {"docs/notes.md": "See DESIGN Â§8 for details"}),
    ("required-file", {}),
    ("unpinned-dependency", {"package.json": json.dumps({"dependencies": {"react": "^19.0.0"}})}),
]

CLEAN: list[tuple[str, Files]] = [
    ("comment mentioning alert( and <select>", {"src/client/A.tsx": "// never use alert() or <select> here\nexport const a = 1;"}),
    ("FileDrop may use a file input", {"src/client/ds/FileDrop.tsx": 'const x = <input type="file" hidden />;'}),
    ("schema_meta insert is allowed", {"migrations/0001_init.sql": "CREATE TABLE schema_meta (k TEXT); INSERT INTO schema_meta VALUES ('v','1');"}),
    ("INSERT inside a trigger is not seed data", {"migrations/0001_init.sql":
        "CREATE TABLE p (t TEXT);\nCREATE TRIGGER p_ai AFTER INSERT ON p BEGIN\n  INSERT INTO p_fts(rowid, t) VALUES (new.rowid, new.t); END;"}),
    ("test address is allowed", {"src/worker/auth.ts": "const CI = 'ci@studypoint.invalid';"}),
    ("a path containing document. is not DOM use", {"src/shared/sniff.ts": "const part = 'word/document.xml';"}),
    ("tokens file may hold hex", {"src/client/styles.css": ":root { --page: #fbf8f2; }"}),
    ("arrow function with a return type is fine", {"src/shared/a.ts": "export const f = (x: number): number => x;\ntype R = () => number;\nfunction g(): R { return () => 1; }"}),
    ("type-only import with 'as'", {"src/shared/a.ts": "import type { X as Y } from './b.ts';\nexport const n = 1 as number;"}),
    ("model id in config defaults", {"src/worker/ai/config.ts": "export const DEFAULT = 'gemini-3.8-flash';"}),
]


def self_test() -> int:
    failures = 0
    for rule_name, files in PLANTED:
        hits = {v.rule for v in audit(files)}
        if rule_name not in hits:
            failures += 1
            print(f"SELF-TEST FAIL: planted '{rule_name}' was not detected (got {sorted(hits)})")
    ignore = {"required-file"}  # partial file maps never contain every required file
    for label, files in CLEAN:
        hits = [v for v in audit(files) if v.rule not in ignore]
        if hits:
            failures += 1
            print(f"SELF-TEST FAIL: clean case '{label}' was flagged: {[str(h) for h in hits]}")
    total = len(PLANTED) + len(CLEAN)
    print(f"verify_repo self-test: {total - failures}/{total} cases behaved correctly.")
    return 1 if failures else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    rc = self_test()
    files = load_repo()
    violations = audit(files)
    for v in violations:
        print(v)
    print(f"verify_repo: {len(files)} files audited, {len(violations)} violation(s), {len(RULES)} rules.")
    return 1 if violations or rc else 0


if __name__ == "__main__":
    sys.exit(main())
