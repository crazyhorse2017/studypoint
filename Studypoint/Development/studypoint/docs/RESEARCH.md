# Studypoint — Research Findings (pass 1, 2026-11-25)

Inputs to ARCHITECTURE, AI_SYSTEM and DATABASE. Every claim is either sourced or marked **to verify**. The full source list is in [[SOURCES]].

> **Update:** Alex chose Workers Paid ($5/mo, purchase planned for early December 2026). Section 3's "extract in the browser" proposal is now optional: parsing and OCR can run on the server.

## 1. Spaced repetition: FSRS over SM-2
- The open-spaced-repetition benchmark covers about 10k Anki collections and about 350M reviews, scored on log loss (lower is better).
  FSRS-6, optimized per user, beats adapted SM-2 in about 99.6% of collections. ([Benchmark](https://expertium.github.io/Benchmark.html))
- Caveats:
  - SM-2 doesn't predict recall probabilities, so the benchmark had to add formulas on top of it to compare.
  - SuperMemo disputes log loss as the right metric.
  - Neither caveat changes the practical choice.
- **Decision:** use FSRS through the official TypeScript implementation, `ts-fsrs`.
  - Start with the default parameters and the default retention target of 0.90.
  - Re-optimize parameters once there is enough review history. **To verify:** the minimum review count and whether `ts-fsrs` exposes FSRS-6 and its optimizer.
  - Store the raw review log (card, timestamp, rating, elapsed time), never just the derived state, so re-optimizing or switching algorithms is always possible.

## 2. Mastery estimation: Elo-style per topic, not IRT
- IRT needs many learners per item to calibrate. A single-user app can't support it. **Rejected.**
- BKT is the dominant classic model, but it fits four parameters per skill and needs many observations per skill. ([Baker chapter](https://learninganalytics.upenn.edu/ryanbaker/ComputationalPsychometricsSanPedro.pdf))
- Elo has few parameters and is easy to implement, which makes it a good fit for small data. Its weakness is imprecise early estimates, which sensible priors reduce. ([Pelánek](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf), [Yudelson 2019](https://myudelson.github.io/pdf/ECTEL2019_Yudelson_Elo.pdf))
- There is no definitive small-data benchmark between the two. Read the full papers before ARCHITECTURE is finalized.
- **Proposal:**
  - Each topic gets a learner skill θ. Each question or card gets a difficulty b, seeded from its generated difficulty level.
  - P(correct) = σ(θ − b). After each response, θ and b update with an uncertainty-decaying step size.
  - Mastery is shown as a probability **with a confidence band**. Below a minimum evidence count, the UI says "not enough data", not a fake number.
  - Flashcard recall stays FSRS's job. Mastery combines quiz/exam answers and card reviews per topic.

## 3. Document parsing and the 10 ms CPU limit
- **Workers Free gives 10 ms of CPU per request**, 128 MB of memory and 50 subrequests. ([Limits](https://developers.cloudflare.com/workers/platform/limits/))
  Parsing a PDF or PPTX inside the Worker will exceed that. Waiting on network I/O (AI calls) does not count as CPU time.
- Cloudflare's `toMarkdown` handles PDF, DOCX, images and HTML, but **not PPTX**, and documents no page or slide numbers. Image conversion draws on Workers AI neurons. ([Formats](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/))
- **Proposal: extract in the browser. The Worker stays a thin proxy.**
  - PDF: `pdf.js`, which gives exact per-page text. That makes page-level citations reliable.
  - PPTX and DOCX are zip files of XML, so `JSZip` plus an XML parser works, with per-slide text for PPTX.
  - Pages with little or no text (scans, handwriting, equation-heavy pages): render the page to an image in the browser and send it through the Worker to a vision model for OCR into Markdown + LaTeX. Every OCR'd passage is flagged `extraction: ocr` and shown with lower confidence.
  - Original files go to R2. Extracted pages and chunks go to D1.
- **Alternative:** Workers Paid ($5/mo) raises the CPU limit to 30 s by default, and allows up to 5 min. It also adds Queues for background ingestion. That's simpler engineering, but not free.

## 4. AI providers
- **Gemini's free tier:** every free-tier model is marked "used to improve our products", and **human reviewers may read inputs and outputs** after they're disconnected from your account. Google's terms say not to submit sensitive, confidential or personal information. A paid billing account switches this off. ([Terms](https://aistudio.google.com/docs/terms), [Pricing](https://aistudio.google.com/docs/pricing))
- Gemini reads PDFs natively, up to 1,000 pages and 50 MB, treating scanned pages as images. Its math quality is not documented. **To verify** with real math-heavy material (synthetic test PDFs, or whatever courses Alex is taking at the time). ([Docs](https://aistudio.google.com/docs/document-processing))
- Model names change often: the 2.5 generation is already deprecated. **Model IDs must be configuration, never hard-coded.**
- **Workers AI** includes 10,000 neurons/day free, with no training on your data. On the Free plan it hard-stops at that limit. ([Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)) Use it for embeddings, possibly as a fallback.
- **Claude** has no free tier. It is the planned upgrade, behind the same provider interface.

## 5. Free-tier capacity for one user
| Service | Free allowance | Impact on Studypoint |
|---|---|---|
| Workers | 100k requests/day | Plenty. |
| D1 | 500 MB per DB, 5 GB per account, 5M rows read and 100k written per day, 7-day Time Travel | Fine. Time Travel is **7 days on Free** (30 on Paid), which corrects the earlier assumption, so scheduled R2 backups matter. |
| R2 | 10 GB-month, free egress | Roughly hundreds of PDFs and slide decks. |
| Vectorize | 5M stored dimensions | At 768 dims that's about 6.5k chunks. **Tight** for several textbooks. Mitigation: hybrid retrieval with D1 FTS5 keyword search plus vectors, and smaller or quantized embeddings. |
| Workers AI | 10k neurons/day | Embeddings for normal daily uploads. Bulk-importing a textbook may take more than one day. |
Sources: [D1](https://developers.cloudflare.com/d1/platform/limits/), [R2](https://developers.cloudflare.com/r2/pricing/), [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/).

## 6. Auth: NoteFlare verified
- The repo exists (homielab/noteflare, MIT). `worker/auth.ts` verifies `Cf-Access-Jwt-Assertion` with `jose`, against `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, checking `issuer` and `audience = ACCESS_AUD`.
- `ALLOWED_EMAILS` is an optional extra allowlist (comma- or space-separated, and supports `@domain`).
- Dev mode applies only on localhost with `DEV_USER_EMAIL` set. ([repo](https://github.com/homielab/noteflare))
- This matches Cloudflare's own guidance ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)), and Access can be enabled on a `workers.dev` route.
- **Decision:** copy this pattern. Skip NoteFlare's client-side encryption.

## 7. Still open
- Symbolic math equivalence. Proposal: evaluate both expressions at random points in the browser, with CAS normalization as a stretch goal. Needs a library survey.
- Grounding and citation evaluation method (for TESTING.md).
- Confirm `ts-fsrs` FSRS-6 support and the optimizer's data threshold.
