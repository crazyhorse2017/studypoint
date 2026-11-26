# Studypoint — Implementation Plan

| | |
|---|---|
| Status | **Approved v1.0**, 2026-11-25 |
| Inputs | [[PRD]] (phases §5), [[ARCHITECTURE]], [[DATABASE]], [[AI_SYSTEM]], [[DESIGN]] |
| Task breakdown | [[TASKS]] · Test plan: [[TESTING]] · Agent rules: [[AGENTS]] |

This doc covers **how** and **in what order** Studypoint gets built: environments, workflow, dependencies, phase milestones, spikes and exit criteria. Individual tasks are in [[TASKS]].

---

## 1. Constraints that shape the plan
- **No local Node, npm, git or wrangler** on Alex's Windows machine, and no admin installers or unsigned binaries (Smart App Control).
  - All Node-based work (typecheck, build, vitest, Playwright, deploy) runs in **GitHub Actions** and **Cloudflare Workers Builds**.
  - Local verification reuses **Prizm's Python harness** through `uv run --no-project --python 3.12`.
- **Workers Paid** ($5/mo) is bought in early December 2026, before P0 deploys anything.
- **Calendar:**
  - No build work during finals. MATH 152's final is **2026-12-14**.
  - P0 runs over winter break.
  - **P1 should be usable early in Spring 2027**, before the first exams.
- **One developer** working with AI coding agents. Every task is small, independently verifiable, and tied to requirement IDs.

## 2. Environments
| Env | URL | Data | Deploys from | Access |
|---|---|---|---|---|
| **Production** | `studypoint.<subdomain>.workers.dev` | D1 `studypoint-db`, R2 `studypoint-files`, Vectorize `passages-v1` | `main` via Workers Builds | Access policy: Alex's two emails |
| **Preview** | Workers Builds preview URL per branch | D1 `studypoint-preview`, R2 `studypoint-preview`, Vectorize `passages-preview` (separate bindings in a `preview` env in `wrangler.jsonc`) | every branch push | Access policy: Alex's emails **plus a CI service token** (TESTING §5) |
| **CI** | none (ephemeral) | Miniflare/workerd local bindings inside `@cloudflare/vitest-pool-workers` | every push and PR | n/a |
| **Local (Alex's PC)** | none | none; pure-logic tests only | n/a | n/a |

**As set up on 2026-11-26:**
- The GitHub repo `studypoint` holds the project at `Studypoint/Development/studypoint/` (the same layout as the vault).
- **Workers Builds** uses root directory `/Studypoint/Development/studypoint`, and its build command runs the checks before building:
  `npm run typecheck && python3 tests/verify_repo.py && python3 tests/verify_schema.py && python3 tools/check_contrast.py && npm run build`.
  A failing check blocks the deploy. The build image has Python 3.14. Browser-based JS tests can't run there (no Chrome), so they stay local until GitHub Actions is active.
- **GitHub Actions** only reads `.github/workflows/` at the repo root, so the nested workflows don't run yet. Moving the project to the repo root (or adding a root workflow with `working-directory`) turns them on.
- Live at `https://studypoint.r279.workers.dev`. Preview URLs are off until the protected preview environment exists.

There's no `wrangler dev` locally because there's no Node. The dev loop is: **edit → local Python checks → push branch → CI + preview deploy → check on the preview URL**.

## 3. Workflow
1. Pick a task from [[TASKS]]. It names the requirement IDs it covers and its "done when" checks.
2. Create a branch `t<id>-<slug>`, e.g. `t1.07-pdf-extract`.
3. Implement it, following [[AGENTS]]: erasable TypeScript, no native controls, privacy routing, and the other rules there.
4. **Local checks** (must pass before pushing):
   - `uv run --no-project --python 3.12 python tests/verify_repo.py`: repo audit rules (TESTING §3).
   - `uv run --no-project --python 3.12 python tests/verify_schema.py`: migrations applied to SQLite, checked for drift from DATABASE.md, constraints and FTS triggers.
   - `uv run --no-project --python 3.12 python tests/run_js_tests.py all`: pure-module tests in headless Chromium.
   - `uv run --no-project --python 3.12 python tests/typecheck.py`: TypeScript check, which must show 0 errors.
   - `uv run --no-project --python 3.12 python tools/check_contrast.py`, if tokens changed.
5. Push and open a PR. **CI** must be green: tsc, unit, integration, end-to-end + axe on the preview, and contrast.
6. Merging to `main` deploys to production. D1 migrations are applied in the build step **before** the new Worker goes live, and migrations must be backward-compatible with the previous Worker version (expand-then-contract).
7. Update docs in the same PR whenever a decision changes. Doc changes go in the ADR table (ARCHITECTURE §2) or the planning log.

**Getting code to GitHub (answered 2026-11-25):** Alex uploads files through **github.com**, the same way as Prizm. Claude Code writes the files and lists exactly which ones changed. Alex uploads them to the task branch and opens the PR on the website. Because of this, tasks keep their changed-file lists small.

**Builder:** Claude Code, chosen by Alex. **P0 started 2026-11-26.** Alex moved it up from Dec 15 because he has time alongside finals.
Workers Paid is needed before P1 ingestion, not before P0.

## 4. Dependencies (pinned to exact versions in P0)
| Area | Package | Why / rule |
|---|---|---|
| Build | `vite`, `@vitejs/plugin-react`, `@cloudflare/vite-plugin`, `wrangler`, `typescript`, `@cloudflare/workers-types`, `tailwindcss` v4 + `@tailwindcss/vite` | Same toolchain as Prizm |
| UI | `react` 19, `react-dom`, `react-router` (SPA mode), `@tanstack/react-query`, `lucide-react` | ARCHITECTURE A12/A13, DESIGN §10 |
| Content | `react-markdown`, `remark-math`, `rehype-katex`, `rehype-sanitize`, `katex`, `pdfjs-dist`, `mathlive` | DESIGN §5, ARCHITECTURE §3.1 |
| Domain | `ts-fsrs` (pinned to FSRS-6 in config), `zod`, `@cortex-js/compute-engine` (P2), `mathjs` (P2) | AI_SYSTEM §7, §9 |
| Worker | `jose` (Access JWT), `unpdf` (PDF text), `fflate` (PPTX unzip), a small XML parser for PPTX slides (chosen in T1.08) | ARCHITECTURE §3.2–3.3 |
| Test (CI only) | `vitest`, `@cloudflare/vitest-pool-workers`, `@playwright/test`, `@axe-core/playwright`, `fast-check` (property tests) | TESTING |

**Pinned in T0.02 (2026-11-26):**
- react 19.3.1, vite 8.3.8, @vitejs/plugin-react 6.3.0, @cloudflare/vite-plugin 1.70.2, wrangler 4.168.0, @cloudflare/workers-types 5.20261125.1, tailwindcss and @tailwindcss/vite 4.3.5.
- **TypeScript is pinned to 6.0.3, not 7.x.** TypeScript 7 is the native-Go compiler. It ships platform binaries and no `lib/typescript.js`, so it can't run inside the browser-based local type check. Its unsigned binaries would also be blocked by Smart App Control. CI and the local check use the same 6.0.3.
- **Vitest must stay on 4.x** (4.1.12 when added). `@cloudflare/vitest-pool-workers` 0.23 requires `vitest ^4.1`, but Vitest's latest is 5.x.
- jose 6.2.18 (MIT, no dependencies), added in T0.12 for Access JWT verification.
- **Lockfile:** there's no local npm. Run the `Generate lockfile` workflow once (Actions tab), then upload its `package-lock.json`. Until then, CI uses `npm install` with the exact pins.

Rules:
- **No AI SDKs** (ARCHITECTURE A8).
- Every new dependency needs a line in this table explaining why.
- Lockfile committed. Dependabot or Renovate runs weekly, security updates only.

## 5. Phase plan

### P0 — Foundations (target: winter break, Dec 15 2026 → mid-Jan 2027)
**Goal:** a deployed, authenticated, tested empty shell, with the risky unknowns resolved.
- **Spikes first.** Each produces a short write-up in `docs/spikes/` and a go/no-go decision:
  - `P0-AI-1`: model quality, neuron cost, handwriting OCR (AI_SYSTEM §2, §8)
  - `P0-FSRS`: ts-fsrs in the browser and Worker, pinning FSRS-6
  - `P0-PDF`: browser page rendering (pdf.js → WebP) and Worker unpdf text extraction with positions, on 3 real PDFs
  - `P0-ACCESS`: Access on workers.dev, JWT verification, CI service-token access to preview
- Repo scaffold, the harness ported from Prizm, CI, Workers Builds, environments.
- Auth middleware (`AUTH-01..04`), `0001_init.sql` with the **full schema** (DATABASE §6), migration tests.
- AI gateway with privacy routing and its tests (`PRV-02`), the provider capability table, usage metering.
- Design tokens for **all three styles** × 2 themes, the contrast checker in CI, and the core DS components needed by P1: Button, TextField, Dialog, Toast, Tabs, Select, Switch, Slider, Menu, Tooltip, FileDrop.
- Settings page shell: style/theme picker and reading settings (`UX-01`, `UX-03`).
- Nightly JSON backup cron (`EXP-02`) and JSON export/restore (`EXP-01`). Built early because everything after this creates real data.

**Exit criteria:**
- Alex can sign in on production with either email, and anyone else is refused.
- Settings persist.
- The backup runs nightly and a restore round-trip test passes.
- All spikes are decided, with any model or library swaps written back into AI_SYSTEM and ARCHITECTURE.
- CI is green, including axe on the settings page in all 6 style × theme combinations.

### P1 — Core study loop (target: mid-Jan → late Feb 2027) — first usable release
**Goal:** upload real course material, ask grounded questions, make and review cards.
**Order** (each step is usable before the next starts):
1. **Wireframes** for P1 screens (DESIGN §6), reviewed with Alex.
2. College directory build + school picker (`INS-01`), then courses with school and code, units, topics and tags (`LIB-01`, `INS-02`). App shell, navigation, command palette.
3. Upload + ingestion Workflow: PDF first, then Markdown/Obsidian, then PPTX, DOCX and images (`LIB-02..05`). Status UI.
4. OCR route + confidence (`LIB-04`), privacy flag UI (`PRV-01`).
5. Source reader with deep links, highlights and studied tracking (`LIB-06`, `LIB-09`).
6. Hybrid search (`LIB-07`).
7. Assistant: retrieval → streaming → citation verifier → trust rendering → not-found flow → tutor mode (`AST-01..08`, `PRV-03`).
8. Cards: manual creation (3 types), FSRS review with budget and interleaving (`CRD-01..03`, `CRD-05/06/08/09`).
9. Card generation + validation + review tray (`CRD-04`, `AST-09`).
10. Versioning + source-change flags (`LIB-10`, `SRC-01/02`).
11. Notes editor (`LIB-08`).
12. Golden eval set v1 from Alex's real material, with the eval CI job (AI_SYSTEM §11).

**Exit criteria:**
- Starting from a blank app (`LIB-12`), Alex adds his Spring 2027 courses and sources himself and uses Studypoint for one full week of real coursework.
- `NFR-ACC` targets are met on the eval set.
- `NFR-PERF` targets are met on production.
- No open P1 accessibility bugs.
- A restore drill succeeds.

### P2 — Grow & test (target: Mar → Apr 2027)
- Spike `P2-MATH` first.
- Then:
  - Lookup with Tavily and the allowlist (`LKP-*`)
  - add a course by code: catalog lookup on the school's domain + topic suggestions (`INS-03..06`)
  - questions + quiz builder/runner in all 4 formats (`QZ-*`)
  - Elo mastery + adaptive selection (`ADP-*`)
  - image occlusion (`CRD-01`)
  - ramp-up warning (`CRD-07`)
- **Exit:** quizzes used in a real exam prep cycle. Validator rejection reasons are reviewed and prompts tuned. Elo constants re-fit (AI_SYSTEM §10).

### P3 — Plan & analyse (target: summer 2027)
- Practice exams + weak-area analysis (`EXM-*`), planner + ICS import (`PLN-*`), sessions + focus mode, analytics dashboard (`ANL-*`), text-to-speech (`UX-05`).
- **Exit:** every analytics panel has a working action. Planner recommendations are accepted at least half the time over 2 weeks of use.

### P4 — Portability & polish (target: fall 2027)
- Markdown → Obsidian export, Anki export (`EXP-03/04`).
- FSRS optimisation round-trip (`CRD-10`).
- Claude provider (`NFR-PORT`).
- Performance and accessibility audit.

These dates are **estimates for a full-time student**, to be re-planned at the end of each phase. If something has to give, scope moves to a later phase. Accuracy and accessibility targets don't get cut.

## 6. Definition of done (every task)
- Requirement IDs listed in the PR and covered by tests (TESTING §2 maps the test level).
- Local checks and CI are green, and there are no new axe violations.
- Docs updated if behaviour or a decision changed.
- No mock or seed data in runtime code (`NFR-DATA`).
- Visual changes screenshotted on the preview in Paper light and dark at minimum. All 3 styles if tokens changed.
- AI-affecting changes (prompts, models, retrieval) have a fresh eval run attached.

## 7. Operational runbook (summary)
| Situation | Action |
|---|---|
| Bad deploy | Workers Builds rollback to the previous version. Migrations are backward-compatible, so no DB rollback is needed |
| Data loss or corruption | D1 Time Travel restore (30 days), or restore the nightly JSON backup from R2 |
| Free AI quota exhausted | Automatic (AI_SYSTEM §14). Check `/usage` |
| Model deprecated | Change `AI_MODELS`, run the eval, deploy |
| Secret rotation | `wrangler secret put` through a CI job or the dashboard. Never commit secrets |
