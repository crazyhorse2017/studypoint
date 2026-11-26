# Studyflare

An AI-assisted study platform (one owner plus invited people, each with a separate account): a library of your own course materials, a grounded assistant that cites its sources, and FSRS flashcards.
It runs on Cloudflare Workers, D1, R2, Vectorize and Workers AI, behind Cloudflare Access.

- **Rules for contributors and agents:** [AGENTS.md](AGENTS.md)
- **Product and technical docs:** [docs/](docs/). Start with [PRD](docs/PRD.md), then [ARCHITECTURE](docs/ARCHITECTURE.md).
- **Task list:** [docs/TASKS.md](docs/TASKS.md)

## Local checks (no Node required)
```powershell
uv run --no-project --python 3.12 python tests/verify_repo.py
uv run --no-project --python 3.12 python tests/verify_schema.py
uv run --no-project --python 3.12 python tests/run_js_tests.py all
uv run --no-project --python 3.12 python tests/typecheck.py
uv run --no-project --python 3.12 python tools/check_contrast.py
```

Builds, deploys and Node-based tests run in GitHub Actions and Cloudflare Workers Builds.
