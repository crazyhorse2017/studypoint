"""
Build the public, app-only copy of Studyflare for the "Deploy to Cloudflare" button (AUTH-07).

    uv run --no-project --python 3.12 python tools/export_public.py

Writes ../studyflare-public/ (next to this folder, outside the private repo). Alex pushes that folder
to the PUBLIC GitHub repo crazyhorse2017/studyflare. Only the app ships: no docs, planning notes, tests,
agent rules, or this deployment's ids. The generic wrangler.jsonc and README come from deploy/public/.

The export refuses to finish if any real email address, or any id from the private wrangler.jsonc
(account, database, Access app), appears in the output.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "studyflare-public"

INCLUDE = ["src", "public", "migrations", "index.html", "package.json", "tsconfig.json", "vite.config.ts", ".gitignore"]
SKIP_NAMES = {".applied-hashes", "node_modules", "dist", ".wrangler", "__pycache__"}
REPLACE = {"wrangler.jsonc": ROOT / "deploy" / "public" / "wrangler.jsonc", "README.md": ROOT / "deploy" / "public" / "README.md"}

# A real address ends in a letter TLD (.com, .edu …); "package@6.0.1" version strings don't.
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")
SAFE_EMAIL_DOMAINS = ("example.com", "example.edu", "example.org", ".invalid")
TEXT_SUFFIXES = {".ts", ".tsx", ".css", ".html", ".json", ".jsonc", ".sql", ".md", ".svg", ".txt"}


def private_ids() -> set[str]:
    """Long hex/uuid ids from the private wrangler.jsonc (account, database, Access app and policy)."""
    text = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
    return {m for m in re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32,64}", text)}


def copy_tree(src: Path, dst: Path) -> None:
    if src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return
    for p in src.rglob("*"):
        if any(part in SKIP_NAMES for part in p.relative_to(ROOT).parts) or not p.is_file():
            continue
        target = dst / p.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)


def audit(out: Path) -> list[str]:
    ids = private_ids()
    problems: list[str] = []
    for p in out.rglob("*"):
        if not p.is_file() or p.suffix not in TEXT_SUFFIXES:
            continue
        rel = p.relative_to(out).as_posix()
        if rel == "public/data/institutions.json":
            continue  # public IPEDS directory: school web addresses, no personal emails
        text = p.read_text(encoding="utf-8", errors="replace")
        for e in EMAIL.findall(text):
            if not e.lower().endswith(SAFE_EMAIL_DOMAINS):
                problems.append(f"{rel}: email address {e}")
        for i in ids:
            if i in text:
                problems.append(f"{rel}: private id {i[:8]}…")
    return problems


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for name in INCLUDE:
        src = ROOT / name
        if src.exists():
            copy_tree(src, OUT / name)
    for name, src in REPLACE.items():
        shutil.copy2(src, OUT / name)
    problems = audit(OUT)
    if problems:
        print("REFUSED: the public copy would leak private details:")
        for p in problems:
            print("  " + p)
        shutil.rmtree(OUT)
        return 1
    count = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"OK: wrote {count} files to {OUT}")
    print("Push that folder to the PUBLIC repo crazyhorse2017/studyflare (repo root = this folder).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
