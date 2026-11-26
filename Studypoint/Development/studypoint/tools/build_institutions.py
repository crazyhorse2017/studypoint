"""
Build the bundled college directory (INS-01, INS-07, ARCHITECTURE A16) from the federal IPEDS
"Institutional Characteristics: Directory information" (HD) file published by NCES.
IPEDS data is a U.S. federal government work (public domain).

Keeps institutions that are currently active, degree-granting, and 2-year or 4-year
(community colleges included). Writes public/data/institutions.json, served as a static asset.

Usage (refresh yearly):
  uv run --no-project --python 3.12 python tools/build_institutions.py            # downloads HD<year>.zip
  uv run --no-project --python 3.12 python tools/build_institutions.py --year 2024
  uv run --no-project --python 3.12 python tools/build_institutions.py --zip path/to/HD2024.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "institutions.json"
URL = "https://nces.ed.gov/ipeds/datacenter/data/HD{year}.zip"
USER_AGENT = "studypoint-directory-builder/1.0 (python-urllib)"

STATES = {  # 50 states, DC and territories, as IPEDS uses them
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
    "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI", "FM", "MH", "PW",
}


def domain_of(webaddr: str) -> str | None:
    """'www.umbc.edu/' -> 'umbc.edu'. Returns None for empty or malformed values."""
    v = webaddr.strip().lower()
    if not v:
        return None
    v = re.sub(r"^[a-z]+://", "", v).split("/")[0].split("?")[0].split(":")[0]
    v = re.sub(r"^www\d?\.", "", v)
    return v if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", v) else None


def aliases_of(ialias: str, name: str) -> list[str]:
    """IPEDS IALIAS is a free-text, comma/pipe/semicolon separated list. Keep short, distinct entries."""
    out: list[str] = []
    for part in re.split(r"[|;,]", ialias or ""):
        a = part.strip()
        if 2 <= len(a) <= 60 and a.lower() != name.lower() and a not in out:
            out.append(a)
    return out[:6]


def read_rows(zip_bytes: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        csv_name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        raw = z.read(csv_name)
    text = raw.decode("utf-8-sig", errors="strict") if raw[:3] == b"\xef\xbb\xbf" else raw.decode("cp1252", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def build(rows: list[dict[str, str]]) -> list[dict]:
    keep = []
    for r in rows:
        g = lambda k: (r.get(k) or r.get(k.lower()) or "").strip()  # noqa: E731
        if g("CYACTIVE") not in ("1",):  # currently active
            continue
        if g("DEGGRANT") != "1":  # degree-granting
            continue
        level = g("ICLEVEL")  # 1 = four-year or above, 2 = at least two but less than four years
        if level not in ("1", "2"):
            continue
        state = g("STABBR")
        if state not in STATES:
            continue
        name = g("INSTNM")
        if not name:
            continue
        keep.append({
            "id": g("UNITID"),
            "name": name,
            "aliases": aliases_of(g("IALIAS"), name),
            "city": g("CITY"),
            "state": state,
            "level": "4yr" if level == "1" else "2yr",
            "domain": domain_of(g("WEBADDR")),
        })
    keep.sort(key=lambda x: (x["name"].lower(), x["state"]))
    return keep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2024)
    ap.add_argument("--zip", type=Path)
    args = ap.parse_args()

    if args.zip:
        data = args.zip.read_bytes()
        source = args.zip.name
    else:
        url = URL.format(year=args.year)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
        # Keep a copy outside the repo for inspection; never committed.
        tmp = Path(tempfile.mkdtemp(prefix="ipeds_")) / f"HD{args.year}.zip"
        tmp.write_bytes(data)
        source = url
        print(f"downloaded {len(data):,} bytes from {url} (copy at {tmp})")

    institutions = build(read_rows(data))
    doc = {
        "source": "IPEDS Institutional Characteristics, Directory information (HD), NCES. U.S. federal government data.",
        "sourceFile": source,
        "year": args.year,
        "count": len(institutions),
        "institutions": institutions,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    two = sum(1 for i in institutions if i["level"] == "2yr")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(institutions):,} institutions ({two:,} two-year), {OUT.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
