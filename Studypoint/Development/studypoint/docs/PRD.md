# Studypoint — Product Requirements (PRD)

| | |
|---|---|
| Status | **Approved v1.0**, 2026-11-25 |
| Owner | Alex (sole user and developer) |
| Derived from | [[PLANNING_LOG]] (decisions), [[RESEARCH]] (evidence), [[SOURCES]] |
| Feeds | ARCHITECTURE, DATABASE, AI_SYSTEM, DESIGN, IMPLEMENTATION, TASKS, TESTING, AGENTS |

Requirement IDs (e.g. `LIB-03`) are stable. The other docs refer to them, so never renumber; deprecate an ID instead.
**MUST** = required for its phase. **SHOULD** = expected unless a documented trade-off says otherwise. **MAY** = optional.

---

## 1. Problem
Course material for one student is spread across PDFs, slide decks, scans, handwritten notes and an Obsidian vault.
General-purpose AI tools answer confidently without saying where an answer came from. Flashcard apps don't know what's in the course.
Studypoint is one place where the material lives, where every AI answer is traceable to a page, and where review is scheduled by evidence-based algorithms instead of guesswork.

## 2. User
A single user: Alex, a UMBC Mechanical Engineering student.
- Math-heavy engineering courses. **Which courses changes every semester, so the app assumes none** (`LIB-12`).
- Studies mostly on a laptop or desktop.
- Already keeps class notes in Obsidian.
- Wants a tool that is honest about uncertainty and never invents facts.

The data model keeps a `user_id` everywhere so the app could become multi-user later. Multi-user is **not** a goal.

## 3. Product principles
These settle conflicts between features.
1. **Traceable or labelled.** Every statement shown by the AI is either cited to a passage in Alex's library or visibly labelled "general AI knowledge". There is no third category.
2. **Never fabricate.** When the library doesn't cover something, say so first (`AST-05`). Low-confidence output is flagged, never smoothed over.
3. **Evidence over vibes.** Scheduling and mastery use published models: FSRS, and an Elo-style learner/item model. A number we can't justify is shown as "not enough data".
4. **Every metric leads to an action.** If a number has no action attached, it doesn't ship.
5. **Your data is yours.** Personal content never goes to a provider that trains on it (`PRV-*`). Everything can be exported (`EXP-*`).
6. **Free-first.** Hosting is Cloudflare Workers Paid ($5/mo). AI uses free tiers until Alex chooses to upgrade.

## 4. Goals and non-goals
**Goals**
- G1. Ingest Alex's real materials (text PDFs, slides, scans, handwriting, math) with page- or slide-level references.
- G2. Answer questions grounded in those materials, with checkable citations.
- G3. Turn material into well-formed flashcards and questions that are checked against the source.
- G4. Schedule review so that measured recall stays close to Alex's chosen target.
- G5. Show where Alex is weak, and give one-click actions to fix it.

**Non-goals**
- Multi-user accounts, sharing, billing or public signup.
- Native mobile apps. Tablet and phone layouts must still work (`NFR-RESP`).
- Live calendar sync. Calendars come in by `.ics` import only.
- Being usable during Fall 2026 finals. Building starts 2026-12-15, so the first real target is the Spring 2027 semester.
- Shipping any built-in courses, subjects, topic lists or study content. Fall 2026 courses (e.g. MATH 152, ENES 101) will be over by then, and every semester's content comes from Alex (`LIB-12`).
- Gamification: XP, levels, badges or streak pressure.
- End-to-end encryption. The server must read content to do AI, search and generation.

## 5. Phases
Each phase ends with a usable app. Later phases MUST NOT require migrating data created in earlier ones. The schema is designed for all phases up front.

| Phase | Scope | Theme |
|---|---|---|
| **P0 Foundations** | Auth, design system core, schema, AI provider layer with privacy routing, CI/test harness | Nothing visible to study with yet |
| **P1 Core study loop (v1)** | School picker + course codes (`INS-01/02`), Library + ingestion, search, grounded assistant, flashcards (Basic, Cloze, Worked-problem), FSRS review, source-change flags, accessibility baseline, JSON backup | **First usable release** |
| **P2 Grow & test** | Lookup section, add-course-by-code catalog lookup (`INS-03..06`), quizzes (all four formats), Elo mastery, image occlusion, ramp-up warning (`CRD-07`) with a minimal deadline entry | |
| **P3 Plan & analyse** | Practice exams + weak-area analysis, planner (+ ICS import), study sessions + focus mode, analytics dashboard, text-to-speech | |
| **P4 Portability & polish** | Markdown export to Obsidian, Anki export, scheduled backups UI, FSRS parameter optimisation, Claude provider option | |

---

## 6. Functional requirements

### 6.1 Access & identity (`AUTH`) — P0
- **AUTH-01 MUST** — Cloudflare Access protects every route.
  - Sign-in is a **passkey** (added 2026-11-26) or a one-time email PIN.
  - A passkey can only be registered after verifying the email by PIN, and the same email allowlist applies to both methods.
- **AUTH-02 MUST** — The Worker verifies the `Cf-Access-Jwt-Assertion` JWT on every API request: signature against the team certs, plus `iss` and `aud`. It never trusts the email header alone.
- **AUTH-03 MUST** — After verification, the email must also be on the `ALLOWED_EMAILS` list (school and personal address). The list is a Worker variable or secret and is never committed.
- **AUTH-03b MUST** — **One person, several logins.** Every allowed email signs in to the **same** account and library (the single-user owner). This is stored in `user_emails`. CI and dev identities stay separate.
- **AUTH-04 MUST** — Local dev bypass works only on localhost with an explicit dev variable. It is impossible in production.
- **AUTH-05 MUST** — **Preview only:** a Cloudflare Access service token (`CI_SERVICE_TOKEN_ID`) maps to a dedicated CI test user for end-to-end tests, and `AI_FAKE=1` routes AI calls to recorded responses.
  A test asserts that both are unset in production (TESTING §5).

### 6.2 Study Library (`LIB`) — P1
- **LIB-01 MUST** — Organisation follows a hierarchy:
  - **Course → Unit (optional) → Topic.** Sources and items attach to one or more topics.
  - Tags are free-form and work across courses.
- **LIB-02 MUST** — Upload PDF, DOCX, PPTX, Markdown (`.md`, including Obsidian notes), and images (PNG/JPG/WebP).
- **LIB-03 MUST** — Every extracted passage keeps a **location**. Citations depend on this.
  - PDF: page number.
  - PPTX: slide number.
  - DOCX: heading path + paragraph index. DOCX files don't store reliable page numbers, and the UI says so.
  - Markdown: heading path.
  - Images: region.
- **LIB-04 MUST** — Pages with little or no text layer (scans, handwriting, equation-heavy pages) go through OCR/vision extraction into Markdown + LaTeX.
  OCR'd passages are marked `extraction: ocr` and shown as lower confidence.
- **LIB-05 MUST** — Ingestion runs in the background and shows per-file status: queued, extracting, OCR, indexing, ready, or failed with the reason.
  Partial failures name the failing pages.
- **LIB-06 MUST** — Original files are stored and viewable. Clicking a citation opens the original at the cited page or slide, with the passage highlighted where possible.
- **LIB-07 MUST** — Search across the library is hybrid: keyword (full-text) plus semantic (vector). It can be filtered by course, topic, tag, source type and privacy flag.
- **LIB-08 MUST** — Notes written in Studypoint support Markdown, KaTeX math and links to sources and passages. They are sources too (privacy `personal` by default).
- **LIB-09 MUST** — Studied-tracking per source, at the level of pages or sections: unread, read, or reviewed. It is updated automatically by reading and review, and can be overridden by hand.
- **LIB-10 MUST** — Re-importing or editing a source creates a new **version**.
  Cards and questions linked to changed or removed passages are flagged "source changed" (`SRC-01`).
- **LIB-11 SHOULD** — Detect duplicate uploads by content hash and offer to link instead of re-ingesting.
- **LIB-12 MUST** — **The app ships blank.**
  - A fresh install has no courses, units, topics, tags, sources, notes, cards, questions, deadlines or sample content of any kind, and no built-in subject list or curriculum.
  - Every course and subject is created by Alex and filled from his own sources: uploads (PDF, DOCX, PPTX, Markdown, images), pasted URLs, and trusted Lookup results.
  - The first run shows an onboarding empty state: **Add your first course → add sources**.
  - AI may *suggest* topics only from sources Alex has added (`LKP-05`), never from a built-in catalogue.
  - Archiving a finished semester's courses is supported (`courses.archived_at`), so old courses don't clutter the app.
  - **Allowed exception:** the **college directory** (`INS-01`) ships with the app. It's reference data (school names and websites), not study content. Catalog lookups (`INS-03`) run only when Alex asks for a specific course code.

### 6.2b Institutions & course codes (`INS`) — P1 (catalog lookup P2)
- **INS-01 MUST (P1)** — **Pick a school.**
  - First-run setup (and Settings → School) asks for Alex's **home school** through a typeahead combobox. It searches a bundled directory of US colleges, including community and 2-year colleges, from the federal College Scorecard/IPEDS data.
  - It matches on name, common alias (e.g. "UMBC" → University of Maryland, Baltimore County), city and state.
  - Each result shows city, state and 2-year/4-year.
  - **"Not listed"** lets Alex type any school name and an optional website domain. This covers international schools too.
- **INS-02 MUST (P1)** — **Courses carry school + code.** Every course stores its school (the home school by default, changeable per course, e.g. a summer class at a community college), an optional **subject code + number** (e.g. `CHEM 101`) and an official title.
  - Codes are normalised (upper-case, single space).
  - Codes are checked against the school's code format: a default pattern, refined from codes already confirmed at that school.
  - In P1, code and title are entered by hand.
- **INS-03 MUST (P2)** — **Add a course by code.** Alex types a code (e.g. `MATH 152`), and Studypoint looks it up **only on that school's own website domain**, which is the official source for its own courses. Then:
  1. It extracts the code, title, credits, description and prerequisites.
  2. **Mechanical checks:** the code and the title must appear **word for word** on the fetched page, and the page's final URL must be on the school's domain.
  3. A confirmation screen shows the result, with a citation chip to the catalog page.
  4. Creating the course saves the catalog page as a `published`, citable source (`origin = catalog`).
  - Nothing is invented. If the checks fail, the result is shown as unverified with the manual fallbacks (`INS-04`).
- **INS-04 MUST (P2)** — **Fallbacks when a catalog can't be reached.** Some catalogs block automated access (UMBC's catalog refused our research fetch with HTTP 403). The order is:
  1. the search API's own copy of the page
  2. Alex pastes the catalog URL
  3. Alex pastes the catalog text
  4. manual entry

  Each path runs the same verbatim checks where there's page text.
- **INS-05 MUST (P2)** — **Suggested topics.** After a code lookup, the AI proposes a topic list from the catalog description only. It's labelled "Suggested from the catalog". Alex accepts, edits or discards each topic, and no topics are created without his acceptance.
- **INS-06 SHOULD (P2)** — Confirmed lookups are cached per school (`catalog_courses`), so re-adding a course or typing a known subject prefix autocompletes instantly.
- **INS-07 MUST** — The directory is a versioned static file built by `tools/build_institutions.py` from the federal bulk data and refreshed yearly. Courses store the school's ID **and** a name snapshot, so a directory update never breaks an existing course.

### 6.3 Privacy routing (`PRV`) — P0/P1
- **PRV-01 MUST** — Every source has `privacy ∈ {personal, published}`.
  - Defaults to `personal`: app notes, Obsidian imports, and uploads Alex marks personal.
  - Defaults to `published`: textbooks, slides, web lookups.
  - The flag can be changed per source.
- **PRV-02 MUST** — Any AI call whose input contains `personal` content runs on Workers AI only. That includes generation, OCR, chat context and grading.
  This is enforced in the provider layer and covered by automated tests (`TESTING`).
- **PRV-03 MUST** — When retrieval returns both kinds, the assistant either answers on Workers AI with all passages, or on Gemini with `published` passages only. The answer states which happened. The default is set in AI_SYSTEM.
- **PRV-04 MUST** — Settings show which provider handles which content, and what each provider's data terms are.

### 6.4 AI Study Assistant (`AST`) — P1
- **AST-01 MUST** — Answers are grounded in retrieved library passages. Each claim drawn from a source carries an inline citation: source, page or slide, and the passage.
- **AST-02 MUST** — Before an answer is shown, citations are **verified mechanically**. The cited span must exist in the cited passage. A claim whose citation fails verification is dropped, or shown re-labelled as uncited.
- **AST-03 MUST** — Text from sources and general AI knowledge are visually distinct (DESIGN defines how). General knowledge is never shown as a citation.
- **AST-04 MUST** — The assistant flags uncertainty explicitly. Examples: sources conflict, low-confidence OCR, a partial match.
- **AST-05 MUST** — When the library doesn't cover a question, the assistant first says "Not found in your materials", then offers (a) a labelled general-knowledge answer or (b) a Lookup for a trusted source (`LKP`, P2).
- **AST-06 MUST** — Default mode gives direct answers. A **Tutor mode** toggle switches to Socratic hints that ask Alex to attempt the next step first.
- **AST-07 MUST** — Math renders with KaTeX. Answers may contain LaTeX.
- **AST-08 MUST** — Conversations are saved and attached to a course or topic, and can be scoped to chosen sources.
- **AST-09 SHOULD** — Turn an answer, or a passage of one, into flashcards in one click (this goes through `CRD-04` validation).

### 6.5 Flashcards & review (`CRD`) — P1 (image occlusion P2)
- **CRD-01 MUST** — Card types:
  - **Basic** (optionally reversible)
  - **Cloze** (one or more deletions, can include math)
  - **Worked-problem**: a problem with a step-by-step solution, where Alex works it, reveals the solution and rates themselves
  - **Image occlusion** (P2). The schema supports it from P0.
- **CRD-02 MUST** — Each card links to the passage(s) it came from, or is marked "manual" if Alex wrote it.
- **CRD-03 MUST** — Cards can be created by hand or generated by AI from selected passages, pages or topics.
- **CRD-04 MUST** — Generated cards are validated before being saved:
  - the answer is supported by the cited passage
  - the question is unambiguous
  - it isn't a duplicate of an existing card

  Cards that fail are discarded or shown to Alex for a decision. They are never added silently.
- **CRD-05 MUST** — Scheduling uses **FSRS** with a target retention set by Alex (default 0.90). The raw review log is always stored (`DATABASE`).
- **CRD-06 MUST** — Daily load is set by a **minutes-per-day budget**. New-card introduction is capped so expected review time fits the budget.
- **CRD-07 MUST (P2)** — Ramp-up warning before exams. It ships in P2 with a minimal deadline entry pulled forward from `PLN-01`. If an exam date (`PLN`) is set for a topic, warn when its unseen or unstable cards can't be covered by then at the current budget.
- **CRD-08 MUST** — Reviews run fully by keyboard, with a 4-button rating (Again / Hard / Good / Easy) as in FSRS.
- **CRD-09 SHOULD** — Review queues interleave topics within a course by default (`ADP-03`).
- **CRD-10 MAY** — Optimise FSRS parameters from Alex's own history once there's enough data (P4; threshold to be decided in AI_SYSTEM).

### 6.6 Source changes (`SRC`) — P1
- **SRC-01 MUST** — When a source version changes, cards and questions linked to changed or removed passages get a "source changed" flag, with a side-by-side diff of the old and new passage.
- **SRC-02 MUST** — Alex chooses per item: keep, edit, regenerate, or retire. Review history is kept in every case. Nothing is regenerated automatically.

### 6.7 Lookup (`LKP`) — P2
- **LKP-01 MUST** — **Trusted web search**, limited to a domain allowlist **enforced in code**.
  - Allowed tiers: `.edu` course pages, OpenStax, MIT OCW, LibreTexts, government and standards bodies, DOI-resolved papers, official documentation.
  - Hard blocklist: Wikipedia, AI Overviews and other AI-answer sites, Chegg, Course Hero, content farms.
  - **Exception for catalog lookups (`INS-03`):** a course-code lookup may search **only the selected school's own domain**, even if that domain isn't on the allowlist. It's the authoritative source for its own course codes. That domain is still post-filtered in code, so redirects off-domain are rejected.
- **LKP-02 MUST** — Alex chooses which results to keep. Kept results become `published` sources with the URL and retrieval date stored, and go through normal ingestion.
- **LKP-03 MUST** — Paste a URL or upload a file to import a source from outside the allowlist. This is the escape hatch, and the source is marked "user-vetted".
- **LKP-04 MUST** — **AI topic primer**: a generated overview of a new topic, always labelled "general AI knowledge". It is never cited as a source and never used as the only basis for generated questions.
- **LKP-05 SHOULD** — Suggest which existing topic or course new content belongs to.

### 6.8 Quizzes (`QZ`) — P2
- **QZ-01 MUST** — Question formats:
  - multiple choice and true/false
  - short answer / fill-in
  - numeric/math (with tolerance and units, and symbolic equivalence where feasible)
  - multi-step problems with step-by-step partial credit
- **QZ-02 MUST** — Configurable: topics or sources, number of questions, formats, difficulty (or adaptive), time limit (optional), and whether feedback is immediate or given at the end.
- **QZ-03 MUST** — Generated questions are validated against the source:
  - the correct answer is supported by a cited passage
  - every MC distractor is checked **not** to be supported as correct
  - questions without a verifiable source are rejected
- **QZ-04 MUST** — AI grading (short answer, multi-step) is shown as a **suggested grade with a rubric**, and Alex can override it. Overrides are recorded.
- **QZ-05 MUST** — Every question's feedback links to its source passage.
- **QZ-06 SHOULD** — Missed questions can become flashcards in one click.

### 6.9 Mastery & adaptive engine (`ADP`) — P2
- **ADP-01 MUST** — Per-topic mastery uses an Elo-style learner/item model: learner skill θ per topic, item difficulty b, and P(correct) = σ(θ − b).
  It is updated from quiz, exam and card evidence, as specified in AI_SYSTEM.
- **ADP-02 MUST** — Mastery is shown with a confidence band. Below a minimum evidence count it shows "Not enough data", not a number.
- **ADP-03 MUST** — **Interleaving**: sessions and quizzes mix topics by default. Alex can choose blocked practice.
- **ADP-04 MUST** — **Progressive difficulty**: question selection targets roughly 70–85% expected success (tuned in AI_SYSTEM).
- **ADP-05 MUST** — **Active recall**: every study surface leads to retrieval (answering before seeing). Passive re-reading is never the suggested next step.

### 6.10 Practice exams (`EXM`) — P3
- **EXM-01 MUST** — Build a timed practice exam from chosen topics, weighted by Alex's input or a syllabus. All `QZ` formats are allowed.
- **EXM-02 MUST** — Exam conditions: no assistant, no hints, feedback only after submitting.
- **EXM-03 MUST** — Weak-area analysis after the exam:
  - per topic: score, mastery change, the questions missed, and the source passages to review
  - every weakness comes with an action: review these cards, take a targeted quiz, or reread these pages

### 6.11 Planner & sessions (`PLN`) — P3
- **PLN-01 MUST** — Deadlines and exams can be entered by hand or imported from `.ics` files. They link to courses and topics.
- **PLN-02 MUST** — Goals, for example "Master topics X, Y by date D" or "N minutes/day".
- **PLN-03 MUST** — Recommendations: a proposed weekly plan from the deadlines, mastery, due cards and the daily budget. Alex can accept or edit it.
- **PLN-04 MUST** — **Study sessions** start from the planner or a dashboard action. They interleave cards and questions, offer an optional Pomodoro timer, and have a distraction-free focus view.
  Time spent is logged.

### 6.12 Analytics (`ANL`) — P3
- **ANL-01 MUST** — A dashboard of panels. **Each panel has at least one action button** (Principle 4). Panels:
  - due/overdue load
  - retention, actual vs target
  - mastery by topic
  - exam readiness
  - study time vs budget
  - study heatmap
  - weak areas
- **ANL-02 MUST** — Every metric shows how it's calculated (tooltip or details panel) and its data window.
- **ANL-03 MUST** — No vanity metrics: no XP, points or streak counters.

### 6.13 Personalisation & accessibility (`UX`) — P1 (TTS P3)
- **UX-01 MUST** — Light and dark themes, plus a "system" option.
  Three visual **styles** can be chosen in Settings: **Paper (default)**, Lab notebook and Midnight focus. Every style × theme combination meets the same accessibility floors (DESIGN §2.8).
- **UX-02 MUST** — Meets **WCAG 2.2 AA**:
  - full keyboard operation
  - visible focus
  - honours `prefers-reduced-motion`
  - no native browser controls: every control is custom and keyboard- and screen-reader-accessible (DESIGN)
- **UX-03 MUST** — Dyslexia-friendly reading settings: font choice, letter and line spacing, reading width.
- **UX-04 MUST** — Screen-reader math (KaTeX with MathML output).
- **UX-05 MUST (P3)** — Text-to-speech for sources and cards using the browser's built-in speech.
- **UX-06 MUST** — Settings for the review budget, target retention, default assistant mode and session defaults.

### 6.14 Export & backup (`EXP`) — P1 / P4
- **EXP-01 MUST (P1)** — Full JSON export of all data (sources' metadata and extracted text, cards, review logs, notes, settings), plus a restore from that file.
- **EXP-02 MUST (P1)** — Scheduled automatic database backups to R2, alongside D1 Time Travel (30 days on Workers Paid).
- **EXP-03 MUST (P4)** — Markdown export of notes, summaries and cards into an Obsidian-friendly folder structure.
- **EXP-04 MUST (P4)** — Anki export (`.apkg`). It is documented that review history may not fully carry over.

---

## 7. Non-functional requirements
- **NFR-ACC (educational accuracy) MUST** — measured by the TESTING evaluation set:
  - citation verification pass rate **≥ 98%** on shown citations, because failing ones are dropped by `AST-02`
  - **≥ 95%** of generated cards and questions judged correct and supported by their source on a hand-checked sample
  - **0** unlabelled general-knowledge statements in sampled answers
- **NFR-DATA MUST** — Persistent storage only: D1, R2 and Vectorize. No mock data in the running app.
  - Production starts **empty** (`LIB-12`). The only rows created automatically are Alex's `users` and `settings` rows on first sign-in.
  - Fixture data lives only in tests, on the preview env, and in the dev-only component gallery.
- **NFR-SEC MUST** — Secrets (API keys, `ALLOWED_EMAILS`) live in Worker secrets, never in the repo or the client bundle.
  All AI calls go through the Worker. Uploads are size- and type-checked.
- **NFR-PERF SHOULD**
  - First page interactive in **< 2 s** on a laptop.
  - Card flip and rating feel instant (**< 100 ms**, optimistic UI).
  - First streamed assistant token in **< 3 s**.
  - A 50-page text PDF is ready in **< 2 min** (scans are slower, with progress shown).
- **NFR-RESP MUST** — Desktop first. Fully usable at tablet and phone widths (DESIGN sets the breakpoints).
- **NFR-COST MUST** — Running cost **$5/mo** (Workers Paid) plus $0 of AI, while using free tiers. The app shows AI usage against the free limits and degrades gracefully, by queueing or falling back to another provider, instead of failing.
- **NFR-PORT SHOULD** — The AI provider can be swapped by configuration (Gemini → Claude) with no change to feature code. Model IDs are configuration, never hard-coded.
- **NFR-TEST MUST** — Real automated tests:
  - unit tests (FSRS and Elo maths, citation verification, privacy routing)
  - integration tests against local D1/R2
  - end-to-end tests of the core loop
  - automated accessibility checks
  - the AI evaluation set

  See TESTING.
- **NFR-BUILD MUST** — Hosted on a free `workers.dev` subdomain. Builds and deploys run on GitHub and Cloudflare Workers Builds. There is no local Node; local checks use `uv run --no-project --python 3.12` scripts, following Prizm's conventions.

## 8. Success measures (personal)
| Measure | Target | Source |
|---|---|---|
| Actual recall on reviews | Within ±3 points of target retention, measured monthly | Review log |
| Daily review time | Within the budget on ≥ 80% of days | Session log |
| Citation precision | ≥ 98% verified | Eval set + `AST-02` logs |
| Generated item acceptance | ≥ 80% of generated cards kept without editing | Card log |
| Exam-readiness accuracy (P3) | Mastery predictions vs real exam scores, reviewed after each exam | Manual |

## 9. Risks
| Risk | Mitigation |
|---|---|
| Free-tier AI rate limits or model deprecations | Provider layer with fallbacks, queued ingestion, model IDs in config |
| OCR quality on handwriting and math | Mark as `ocr`, show confidence, side-by-side view of the original, easy correction |
| Weaker Workers AI output on personal notes | Labelled in the UI. Option to upgrade to paid Gemini or Claude later |
| Vectorize storage cap on large libraries | Hybrid search with D1 FTS5. Compact embeddings |
| Scope creep (8 modules, one developer) | Phased plan. Each phase is usable on its own |
| Web lookup pulls in low-quality content | Allowlist enforced in code, Alex picks what to keep, user-vetted escape hatch |

## 10. Open questions (owner doc)
- ~~Web search provider~~ → **Tavily**, with the allowlist also enforced in code (ARCHITECTURE A9/A10).
- ~~Mixed-privacy chat default (`PRV-03`)~~ → **`private_all`**: Workers AI with all passages (AI_SYSTEM §4).
- ~~Symbolic math equivalence~~ → randomised numeric identity test via CortexJS Compute Engine. Still pending SPIKE P2-MATH (AI_SYSTEM §7.2).
- ~~FSRS optimisation threshold (`CRD-10`)~~ → assumed ≥ 1,000 reviews over 30 days, run offline with the Python FSRS-Optimizer (AI_SYSTEM §9). The threshold is still **to verify**.
- ~~Elo parameters (`ADP-02`)~~ → initial values in AI_SYSTEM §10, re-tuned after P2.
- ~~Visual direction~~ → **A · Paper** (DESIGN).

## 11. Glossary
- **School (institution):** a college from the bundled directory (keyed by its federal UNITID) or a "Not listed" school Alex typed. There's one home school, and each course can override it.
- **Course code:** subject + number (e.g. `CHEM 101`), unique only within a school.
- **Source:** an uploaded or imported document, note or web page. Sources are versioned.
- **Passage:** an extracted chunk of a source with a location (page, slide or heading).
- **Citation:** a reference from AI output to a passage, verified by `AST-02`.
- **Item:** anything Alex answers: a card or a question.
- **Mastery:** estimated probability that Alex answers a typical item in a topic correctly, with uncertainty.
- **Retention target:** the recall probability FSRS schedules for.
