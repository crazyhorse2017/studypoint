# Studyflare — Planning Log

Decisions made during the planning interview. These feed the final docs: PRD, ARCHITECTURE, DATABASE, DESIGN, AI_SYSTEM, IMPLEMENTATION, TASKS, TESTING, AGENTS.
When a later decision replaces an earlier one, it is marked **SUPERSEDES**.

## Status
All nine planning docs were drafted on 2026-11-25: [[PRD]], [[ARCHITECTURE]], [[DATABASE]], [[AI_SYSTEM]], [[DESIGN]], [[IMPLEMENTATION]], [[TASKS]], [[TESTING]], [[AGENTS]].
**Plan approved by Alex on 2026-11-25** (all docs v1.0). Next is P0, which starts after the MATH 152 final (2026-12-14), per IMPLEMENTATION §5.
- **Builder:** Claude Code (Alex's choice).
- **Start:** ~~P0 on 2026-12-15~~ → **P0 started 2026-11-26**. Alex chose to start right away. The blank-app decision removed any reason to time the build around a semester.
- **GitHub:** Alex uploads via github.com, as with Prizm.
- **Remaining prerequisite:** T0.06, buy Workers Paid in early December.
Open question: how Prizm's code reaches GitHub without local git (TASKS T0.01).

## Product
- **Audience:** single user (Alex). Every table keeps a `user_id` column so a later move to multi-user needs no rewrite.
- **First version (the core study loop):** Study Library (uploads with page/slide references), a grounded AI assistant with citations, and spaced-repetition flashcards.
  Quizzes, practice exams, the planner and analytics come in later phases.
- **Materials:** text PDFs, lecture slides (PPTX/PDF), scanned or handwritten pages, and math-heavy content.
  So OCR/vision extraction and KaTeX rendering are both required.
- **Lookup section:** brings in new content when a new topic comes up. Three ways in:
  1. Web search, limited to a domain **allowlist enforced in code**. Results become library sources with URLs.
     Blocked: Wikipedia, AI Overviews and other AI answer sites, Chegg, Course Hero, content farms.
     Allowed tiers: .edu course pages, OpenStax, MIT OCW, LibreTexts, government and standards bodies, papers with a DOI, official documentation. Approved with no edits.
  2. Paste a URL, or import a file. This is the escape hatch for good sources outside the allowlist.
  3. AI-written topic primer. Always labelled "general AI knowledge", never cited as a source.
- **When a source changes:** affected cards and quizzes are flagged "source changed" and Alex decides what to do. FSRS history is never silently lost.
- **Obsidian:** vault `.md` files can be imported as library sources. Notes written in the app stay in the app.
- **Assistant:** direct answers with citations by default. A toggle switches to Socratic tutor mode.
- **Card types:** Basic, Cloze and Worked-problem (KaTeX) in v1. Image occlusion in phase 2, with the data model ready for it from day one.
- **Devices:** mainly laptop/desktop. Tablet and mobile layouts must still work.

- **Ships blank** (decided 2026-11-25, `LIB-12`): there are no pre-built courses, subjects or content.
  - Alex fills every course himself from PDFs, URLs and other sources, starting with his Spring 2027 classes.
  - Fall 2026 courses (MATH 152, ENES 101) will be over and must not appear in the app.
  - Course archiving lets finished semesters be put away.

- **School picker + course codes** (decided 2026-11-25, PRD `INS-*`):
  - A typeahead over a bundled directory of US colleges, including 2-year colleges (federal College Scorecard/IPEDS data), plus "Not listed" for any other school.
  - One home school, and each course can use a different one.
  - **P1:** the picker, plus codes and titles entered by hand with a format check.
  - **P2:** add a course by code. It looks the code up **only on that school's own website**, requires the code and title to appear word for word, saves the catalog page as a citable source, and suggests topics for Alex to accept.
  - No nationwide course-code dataset exists, and some catalogs block bots (UMBC's returned 403), so there are fallbacks: paste the URL, paste the text, or enter it manually.

- **Two logins, one library** (found and fixed while building T0.15 on 2026-11-26, PRD `AUTH-03b`):
  - Each sign-in email would otherwise have created its own user, so the school and personal logins would have shown two separate libraries.
  - All allowed emails now link to the one owner account through the `user_emails` table.

## Cost & AI
- **SUPERSEDES the Claude-first choice:** make the app as free as possible.
  - AI is free-first and Claude-ready: Gemini's free tier for chat, generation and OCR/vision, and Workers AI's free tier for embeddings, all behind a provider interface. Claude is the planned paid upgrade.
  - Documented caveat: Gemini's free tier has rate limits and may use submitted data to improve Google's products.
- Free tiers also decide the infrastructure.

## Stack & auth
- **Cloudflare:** Workers, D1, R2 (files), Vectorize (semantic search), and Access.
  React + TypeScript + Vite + Tailwind v4 is likely, reusing conventions from Prizm Studios. Final confirmation comes after research.
- **Auth follows NoteFlare's model:**
  - Cloudflare Access (Zero Trust free plan) sits in front of the Worker. Sign-in is a one-time email PIN.
  - The app also checks an `ALLOWED_EMAILS` list (school + personal address).
    The addresses are set as a Worker variable/secret in the Cloudflare dashboard and are **never committed to the repo**.
  - The Worker verifies the `Cf-Access-Jwt-Assertion` JWT (signature against the team certs, plus `aud` and `iss`) rather than trusting the email header alone.
  - No end-to-end encryption, because the server needs to read materials for AI, search and generation.
  - The NoteFlare details came from a pasted AI summary. Verify them against the homielab/noteflare repo and Cloudflare docs.
- **Hosting:** free `workers.dev` subdomain.
- **Builds:** GitHub + Cloudflare Workers Builds. There is no local Node; local checks use `uv run` Python scripts.

## Design
- Fully custom design system with no native browser controls. Light and dark themes. Accessible.
- **Visual direction: A · Paper**, chosen 2026-11-25 from three mockups (Paper, Lab notebook, Midnight focus).
  - Warm paper palette with an ink-blue accent.
  - Literata for reading text, Inter for the UI, and JetBrains Mono for numbers (taken from direction B).
  - Every colour pair was contrast-checked against WCAG AA. See [[DESIGN]].
- **The other two directions are selectable styles** in Settings → Appearance (decided 2026-11-25). **Paper stays the default.**
  - Style and theme are separate settings, so each style has light and dark.
  - All 6 combinations pass the contrast checks (`tools/check_contrast.py`).
  - Midnight's general-knowledge block was strengthened with a left rule and label.
  - Stored in `settings.style`.

## Planner, quizzes, analytics, accessibility
- **Planner:** deadlines and exams are entered by hand or imported from `.ics` files. No live calendar sync.
- **Quiz/exam formats (post-v1; data model planned now):** all of these:
  - multiple choice and true/false, with distractors checked against the source
  - short answer / fill-in, with exact match plus an AI rubric whose grade Alex can override
  - numeric/math, with tolerance, units and symbolic equivalence
  - multi-step problems, graded step by step with partial credit
- **Analytics:** a dashboard of actions. Several metric panels, each with its own action button. Every metric leads to an action.
- **Accessibility:** WCAG 2.2 AA, full keyboard support, visible focus and reduced motion, **plus**:
  - dyslexia-friendly reading settings (font, letter and line spacing, reading width)
  - screen-reader math (KaTeX MathML output)
  - text-to-speech using the browser's built-in speech (free)

## Behaviour, workload, motivation, export, sessions
- **No coverage in sources:** the assistant says "Not found in your materials" first, then offers a clearly labelled general-knowledge answer or a trusted-source lookup.
- **Daily load:** Alex sets a minutes-per-day budget and a target recall rate (FSRS default 0.90). New cards are capped so reviews fit the budget, with a ramp-up warning before exams.
- **Motivation:** light, honest stats only: a study heatmap, topics mastered, retention. No XP and no streak pressure.
- **Export / no lock-in:**
  - full JSON backup and restore
  - Markdown export into Obsidian
  - Anki export
  - scheduled D1 backups, plus D1 Time Travel for point-in-time restore
- **Sessions:** start a planned session from the planner or a dashboard action. It interleaves cards and questions across topics, with an optional Pomodoro timer and a focus view. Session time feeds analytics.

## Post-research decisions
- **Workers Paid ($5/mo):** Alex will buy it in early December 2026. The plan assumes Paid limits:
  - 30 s default CPU (up to 5 min), so files can be parsed and OCR'd on the server
  - Queues for background ingestion
  - D1 Time Travel: 30 days
  
  This partly SUPERSEDES "as free as possible": hosting is $5/mo, and AI stays free-first.
  Nothing is deployed before the purchase, and no code is written before the plan is approved, so there's no gap.
- **Gemini free-tier privacy:** decided: **personal content goes to Workers AI only.**
  - Every source has a `privacy` flag: `personal` or `published`.
    - Defaults to `personal`: notes written in the app, imported Obsidian notes, and uploads Alex marks as personal (e.g. handwritten notes).
    - Defaults to `published`: textbooks, lecture slides, web lookups.
    - The flag can be changed per source.
  - Any AI call whose input includes `personal` content (generation, OCR, embeddings, or chat with personal passages retrieved) is routed to Workers AI and never sent to Gemini. This is enforced in the provider layer, not by convention, and has tests.
  - Chat when retrieval returns both kinds: answer on Workers AI using everything, **or** on Gemini using only `published` passages. The UI says which happened. (Default to settle in AI_SYSTEM.md.)
  - Expected trade-off: answers, cards and OCR built from personal notes are weaker. Turning on Gemini billing later lifts the restriction.
  - Embeddings run on Workers AI for everything anyway, so search treats both kinds the same.

## Open items
- Research parsing and OCR for scans, math and PPTX on Workers.
- Research FSRS vs SM-2 for scheduling, and BKT vs Elo-style models for mastery.
- Research symbolic-equivalence checking for math answers, which is hard on Workers.
