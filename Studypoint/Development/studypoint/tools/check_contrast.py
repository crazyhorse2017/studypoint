"""
WCAG contrast gate for Studypoint's design tokens (DESIGN §2.8, TESTING §1).

Reads the colour tokens for every style × theme straight from src/client/styles/tokens.css
(the single source of truth) and checks every text/background and non-text pair against its
WCAG 2.x floor. Exits 1 if any pair fails, so CI blocks the change.

Usage:
  uv run --no-project --python 3.12 python tools/check_contrast.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "src" / "client" / "styles" / "tokens.css"
STYLES = ("paper", "lab", "midnight")
THEMES = ("light", "dark")

# (foreground token, background token, minimum ratio). 4.5 = text (1.4.3), 3.0 = non-text (1.4.11).
CHECKS: list[tuple[str, str, float]] = [
    ("text", "page", 4.5), ("text", "surface", 4.5), ("text-2", "page", 4.5), ("text-2", "surface", 4.5),
    ("text-2", "sunken", 4.5), ("text-3", "page", 4.5), ("text-3", "surface", 4.5),
    ("accent", "page", 4.5), ("accent", "surface", 4.5), ("on-accent", "accent", 4.5),
    ("chip-text", "accent-bg", 4.5), ("general-text", "general-bg", 4.5), ("general-rule", "general-bg", 3.0),
    ("unverified-text", "unverified-bg", 4.5),
    ("again-text", "again-bg", 4.5), ("hard-text", "hard-bg", 4.5), ("good-text", "good-bg", 4.5), ("easy-text", "easy-bg", 4.5),
    ("danger", "surface", 4.5), ("success", "surface", 4.5), ("warning", "surface", 4.5),
    ("border-strong", "surface", 3.0), ("accent", "page", 3.0),
]
REQUIRED = sorted({t for fg, bg, _ in CHECKS for t in (fg, bg)})


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def parse_tokens(css: str) -> dict[tuple[str, str], dict[str, str]]:
    """Map (style, theme) -> {token: '#hex'} from blocks selected by [data-style][data-theme]."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out: dict[tuple[str, str], dict[str, str]] = {}
    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        m = re.search(r"\[data-style='(\w+)'\]\[data-theme='(\w+)'\]", selector)
        if not m:
            continue
        tokens = dict(re.findall(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;", body))
        out[(m.group(1), m.group(2))] = {k: v.lower() for k, v in tokens.items()}
    return out


def main() -> int:
    sets = parse_tokens(TOKENS.read_text(encoding="utf-8"))
    failures = 0
    for style in STYLES:
        for theme in THEMES:
            tok = sets.get((style, theme))
            if tok is None:
                print(f"FAIL {style}/{theme}: no token block found in {TOKENS.relative_to(ROOT)}")
                failures += 1
                continue
            missing = [t for t in REQUIRED if t not in tok]
            if missing:
                print(f"FAIL {style}/{theme}: missing tokens {missing}")
                failures += 1
                continue
            lowest = None
            for fg, bg, need in CHECKS:
                ratio = contrast(tok[fg], tok[bg])
                if ratio < need:
                    failures += 1
                    print(f"FAIL {style}/{theme}: --{fg} {tok[fg]} on --{bg} {tok[bg]} = {ratio:.2f} < {need}")
                if lowest is None or ratio < lowest[0]:
                    lowest = (ratio, fg, bg)
            assert lowest is not None
            print(f"{style:8} {theme:5} ok  lowest {lowest[0]:.2f} (--{lowest[1]} on --{lowest[2]})")
    print(f"failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
