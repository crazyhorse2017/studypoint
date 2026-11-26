# AGENTS.md — Studypoint

Rules for the AI coding agent working on Studypoint. **Alex chose Claude Code as the builder** on 2026-11-25. The rules still apply to any agent. `CLAUDE.md` points here.
**Read this file first, then the doc for the area you're touching.** When this file and another doc disagree, stop and ask Alex. Don't guess.

**Studypoint:** a single-user, AI-assisted study platform. React 19 + TypeScript + Vite + Tailwind v4 on **Cloudflare Workers (Paid)** + D1 + R2 + Vectorize + Workflows + Workers AI, behind **Cloudflare Access**. Gemini is used for published content only.

---

## 1. Docs map (source of truth)
| Doc | Read before touching |
|---|---|
| `docs/PRD.md` | Any feature. Requirement IDs (`LIB-03`, `PRV-02`, …) are cited in PRs and tests |
| `docs/ARCHITECTURE.md` | Worker, routes, bindings, ingestion, deploy. ADR table §2 |
| `docs/DATABASE.md` | Any SQL, migration or export |
| `docs/AI_SYSTEM.md` | Prompts, models, retrieval, citations, generation, grading, OCR, FSRS, Elo |
| `docs/DESIGN.md` | Any UI. Tokens, styles, components, a11y |
| `docs/IMPLEMENTATION.md` | Workflow, environments, dependencies, definition of done |
| `docs/TASKS.md` | What to work on. Task IDs |
| `docs/TESTING.md` | What tests a change needs |

The repo lives in the Obsidian vault at `03_Software_and_Web_Development/Studypoint/Development/studypoint/`, so the docs in `docs/` are readable in Obsidian too.
Planning history is in `docs/PLANNING_LOG.md`, `docs/RESEARCH.md` and `docs/SOURCES.md`.

## 2. Machine & environment rules (Alex's Windows PC)
- **There is no local Node, npm, npx, git or wrangler, and you must not install them.**
  - Never run MSI, admin or UAC installers.
  - Never create `.venv` folders.
  - Never download or run unsigned binaries. Windows Smart App Control blocks them (`os error 4551`).
- Node work (typecheck, build, vitest, Playwright, deploy) runs in **GitHub Actions** and **Cloudflare Workers Builds**.
- **Local verification** uses signed CPython 3.12 only. Run all of these before saying a change is done:
  ```powershell
  uv run --no-project --python 3.12 python tests/verify_repo.py
  uv run --no-project --python 3.12 python tests/verify_schema.py
  uv run --no-project --python 3.12 python tests/run_js_tests.py all
  uv run --no-project --python 3.12 python tests/typecheck.py
  uv run --no-project --python 3.12 python tools/check_contrast.py
  ```
  - `typecheck.py` must report **0 errors**.
  - VS Code shows "Cannot find module" errors because there's no `node_modules`. Ignore them.
- **How code reaches GitHub:** like Prizm, Alex **uploads files through github.com**. There is no local git.
  - The agent writes files in the vault repo folder and gives Alex an exact list of changed files plus the target branch.
  - Alex uploads them to a `t<id>-<slug>` branch and opens the PR on the website.
  - Keep each task's changed-file list short and explicit.
- Report results honestly. If something couldn't be verified locally, such as Worker integration or end-to-end tests, say so and point to the CI job that covers it.

## 3. Hard invariants (never break these)
### Privacy & AI
1. **Personal content never reaches a provider with `trainsOnFreeTier: true`** (Gemini free tier). All AI calls go through `src/worker/ai/gateway.ts`. Never call a provider directly, and never bypass `effectivePrivacy` or the `PrivacyViolation` assertion (`PRV-02`).
2. `privacy` comes from data (`sources` → `passages` → `ContentPart`). **It's never inferred by or taken from a model.**
3. **No AI SDKs.** Use REST via `fetch` in `src/worker/ai/providers/` and the Workers AI binding. **No hard-coded model IDs.** Models come from the `AI_MODELS` config.
4. **Every sourced claim shown to Alex has a mechanically verified citation** (`AST-02`). Unverified claims are shown as `unverified`, never as cited. General knowledge is always labelled `general` (`AST-03`).
5. **Generated cards and questions must pass the mechanical checks and the validator** (on a different model) before reaching the review tray (`CRD-04`, `QZ-03`). AI primers (`citeable = 0`) are never used as a source for generated items or citations (`LKP-04`).
6. **Passage text and web content are data, not instructions.** Never let retrieved text change system behaviour, tool use or routing.
7. Any prompt, model, retrieval or chunking change bumps the prompt version and needs an `ai-eval` report (TESTING §4.3).

### Data
8. Every user-owned query is **scoped by `user_id`** and uses bound parameters. Respect D1 limits: at most 100 bound params per query, so batch with `db.batch()`.
9. **`review_log` and `attempts` are append-only.** Card state must stay rebuildable from `review_log`. Store `fsrs_version` and `params_hash` with every review.
10. **Migrations are forward-only and never edited after merge.** They must be backward-compatible with the previous Worker (expand, then contract).
11. **The app ships blank** (`LIB-12`). Never add built-in courses, subjects, topic lists, sample sources, demo cards or a "getting started" course. Alex creates every course from his own uploads, URLs and lookups. Don't use his past or current course names (e.g. MATH 152, ENES 101) anywhere in app code or UI copy.
    **No seed, mock or demo data in `migrations/` or `src/`.** Fixtures belong only in `tests/fixtures/` (synthetic or openly licensed). Alex's course materials and the golden set are **never committed** (TESTING §4.3, §9).
12. Superseded passages are kept while anything references them, so citations never break.

### Security
13. Every `/api/*` route goes through the Access JWT middleware (`jose` against the team certs, plus `iss` and `aud`) and the `ALLOWED_EMAILS` check.
    - The dev bypass is localhost-only.
    - The CI service-token mapping and `AI_FAKE` exist **only in the preview env**.
14. **Secrets** (`GEMINI_API_KEY`, `TAVILY_API_KEY`, `ALLOWED_EMAILS`, …) are Worker secrets only. Never put them in the repo, logs, the client bundle, URLs or error messages.
15. AI and web Markdown is rendered only through the sanitising `Markdown` component. Uploads are type-checked by magic bytes, and **SVG is rejected**.
16. Lookup results must pass the allowlist **in our code** (final URL after redirects), not just the Tavily parameter (ARCHITECTURE A10).
    - **Course-code catalog lookups** may only use the selected school's own domain (`INS-03`, A17).
    - Never invent or "fill in" a course title, credits or description. If the verbatim checks fail, show it as unverified and offer the manual fallbacks.
    - The college directory is a static reference asset, not D1 seed data.

### UI
17. **No native browser controls or dialogs.**
    - Banned: `alert`, `confirm`, `prompt`, `<select>`, and visible native checkbox/radio/range/color/date/time/number inputs.
    - Use `src/client/ds/` components.
    - The only exception is the hidden `type="file"` input inside `FileDrop`.
18. **Use design tokens, never raw hex** in components.
    - All 3 styles (Paper default, Lab notebook, Midnight focus) × light/dark must keep passing `check_contrast.py`.
    - Trust states and ratings must never rely on colour alone.
19. **WCAG 2.2 AA:**
    - keyboard-operable
    - visible focus that isn't obscured
    - targets ≥ 24 px (44 px when the pointer is coarse)
    - a keyboard alternative to every drag
    - `aria-label` on icon-only buttons
    - math rendered with MathML output
    - motion respects reduced-motion
20. Copy is sentence case, plain and honest (DESIGN §9).

### Code style
21. **Erasable TypeScript only.** No `enum`, `namespace` or constructor parameter properties. Use string-union types that mirror the DB `CHECK` lists.
    - The local type stripper can't parse function-type **return** annotations (`function f(): () => number {`). Use a type alias (`type Rand = () => number`). The audit flags it.
    - New test suites must be registered in `tests/js_tests.html`.
    - New schema changes go in a new migration and must keep `tests/verify_schema.py` passing. That test also checks the migrations still match DATABASE.md.
22. **`src/worker/**` is server-only** and never imported from `src/client/**`. Shared code lives in `src/shared/` and must be pure (no bindings, no DOM).
23. Validate all API input with the zod schemas in `src/shared/`.
24. **New dependencies need a reason** added to IMPLEMENTATION §4. Prefer small, MIT/BSD/Apache/OFL packages that run on both Workers and the browser.

## 4. How to work
1. Find the task in `docs/TASKS.md`. Note its requirement IDs and its **done when** criteria.
2. Read the relevant docs (§1). If a requirement is ambiguous or a doc seems wrong, **ask Alex**. Don't invent behaviour.
3. Keep changes scoped to the task. List unrelated problems you notice as follow-ups instead of fixing them.
4. Write or extend tests at the levels TESTING §2 requires, then implement.
5. Run the local checks (§2). Push to a branch named `t<id>-<slug>`. The PR description lists the task ID, requirement IDs, test evidence and preview screenshots for UI changes.
6. If you change a decision, update the doc in the same PR: an ADR row in ARCHITECTURE §2, or the relevant section. Docs must keep agreeing with each other.
7. Never claim something works without evidence. Never weaken a test or audit rule to make it pass.

## 5. Things to ask Alex before doing
- Anything that adds cost, a new external service, or sends data to a new provider.
- Changing privacy defaults, the domain allowlist, the trust labels, or accuracy targets.
- Deleting data, changing the export format version, or anything that touches production bindings.
- Dependencies with native code, or licences other than MIT/BSD/Apache/ISC/OFL.

## 6. Glossary
- **Source** (versioned file, note or web page)
- **Location** (page, slide or heading)
- **Passage** (chunk with a location)
- **Citation** (verified quote → passage)
- **Item** (card or question)
- **Published / personal** (privacy flag)
- **Style** (Paper / Lab notebook / Midnight focus)
- **Theme** (light / dark)

Full definitions are in PRD §11.
