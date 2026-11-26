# Studypoint — Sources

Every external source used during planning, grouped by topic. Findings are summarized in [[RESEARCH]]. Decisions are in [[PLANNING_LOG]].
Accessed 2026-11-25 unless noted. Cloudflare and Google pricing and limits change often, so re-check them before relying on a number.

## Spaced repetition (FSRS vs SM-2)
- [Benchmark of Spaced Repetition Algorithms](https://expertium.github.io/Benchmark.html): the open-spaced-repetition benchmark, about 10k Anki collections, scored on log loss.

## Mastery estimation (BKT, Elo, IRT)
- [Baker et al., Knowledge Inference Models Used in Adaptive Learning](https://learninganalytics.upenn.edu/ryanbaker/ComputationalPsychometricsSanPedro.pdf): overview of BKT and related models.
- [Pelánek, Applications of the Elo Rating System in Adaptive Educational Systems](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf): Elo for learner and item modeling.
- [Yudelson, Elo, I Love You Won't You Tell Me Your K (ECTEL 2019)](https://myudelson.github.io/pdf/ECTEL2019_Yudelson_Elo.pdf): Elo variants compared with BKT on small and large datasets.

## Cloudflare platform
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): Free is 10 ms CPU per request; Paid is 30 s by default, up to 5 min.
- [Workers AI Markdown conversion: supported formats](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/): PDF, DOCX and images are supported; PPTX is not.
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): 10,000 free neurons per day.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): storage, rows read and written, and Time Travel retention.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/): 10 GB-month free, free egress.
- [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/): 5M stored dimensions on the free tier.

## Auth (Cloudflare Access, NoteFlare pattern)
- [Cloudflare: Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): verifying `Cf-Access-Jwt-Assertion` in a Worker.
- [homielab/noteflare](https://github.com/homielab/noteflare): the reference implementation (MIT).
  - [docs/ARCHITECTURE.md](https://github.com/homielab/noteflare/blob/main/docs/ARCHITECTURE.md)
  - [worker/auth.ts](https://github.com/homielab/noteflare/blob/main/worker/auth.ts): JWT verification and the `ALLOWED_EMAILS` check.

## Architecture (added 2026-11-25 for ARCHITECTURE.md)
- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/): 10k steps, 30 s–5 min CPU per step, 1 MiB per step result (Paid).
- [Cloudflare Queues limits](https://developers.cloudflare.com/queues/platform/limits): compared against Workflows for ingestion.
- [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/): embedding models (bge-base 768-d, embeddinggemma-2 768-d, …) and vision-capable models.
- [unpdf](https://github.com/unjs/unpdf): PDF.js serverless build. Per-page text works on Workers; page rendering doesn't (no canvas).
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search): `include_domains` (max 300) and `exclude_domains` (max 150), optional raw content.
- [Tavily API credits](https://docs.tavily.com/documentation/api-credits): 1,000 free credits/month with no card; basic search costs 1 credit.

## Database & algorithms (added 2026-11-25 for DATABASE.md and AI_SYSTEM.md)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs): supports FSRS-3 through FSRS-7 and defaults to FSRS-7. No built-in optimiser.
- [ts-fsrs binding (optimiser)](https://github.com/open-spaced-repetition/ts-fsrs/blob/main/packages/binding/README.md): napi/WASI, public beta, not supported on edge runtimes.
- [FSRS-Optimizer (Python)](https://github.com/open-spaced-repetition/fsrs-optimizer): BSD-3. Planned for offline parameter optimisation.
- [FSRS4Anki wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki): background on FSRS. A minimum-data threshold was not found there.
- [CortexJS Compute Engine](https://epsil.dev/compute-engine/): LaTeX parsing and simplification, used for math answer equivalence.
- [math.js algebra](https://mathjs.org/docs/expressions/algebra.html) and [units](https://mathjs.org/docs/datatypes/units.html): simplify/rationalise, and unit conversion (warns about celsius/fahrenheit arithmetic).
- [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/): FTS5 is supported.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): 2 MB per row, 100 KB per statement, 100 bound parameters, 10 GB per DB on Paid.

## Design & accessibility (added 2026-11-25 for DESIGN.md)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): the AA target, including 2.4.11, 2.5.7, 2.5.8 and 3.3.8.
- [WCAG relative luminance and contrast ratio](https://www.w3.org/WAI/GL/wiki/Relative_luminance): the formula used to check the palette.
- [WAI-ARIA Authoring Practices Guide (APG) patterns](https://www.w3.org/WAI/ARIA/apg/patterns/): the basis for every custom component.
- [Literata](https://fonts.google.com/specimen/Literata), [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/), [Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/), [OpenDyslexic](https://opendyslexic.org/): fonts.
- [MathLive](https://mathlive.io/): math input field.
- [KaTeX options (MathML output)](https://katex.org/docs/options.html): screen-reader math.

## Schools & course codes (added 2026-11-25 for `INS-*`)
- [College Scorecard API](https://collegescorecard.ed.gov/data/api/): api.data.gov key, 1,000 requests/hour, name search. Bulk data at [collegescorecard.ed.gov/data](https://collegescorecard.ed.gov/data/) (updated 2026-11-02). Licence statement not found yet (**to verify** in T1.02a).
- [IPEDS](https://nces.ed.gov/ipeds/): 6,000–7,000+ institutions that take federal aid, with CSV downloads.
- No nationwide course-catalog API exists. Partial options: [ICPSR College and Beyond II](https://www.icpsr.umich.edu/web/ICPSR/studies/38588), [course-data-api (Banner schools only)](https://github.com/alec-rabold/course-data-api), [NCES College Course Map (a taxonomy, not catalogs)](https://edpolicy.umich.edu/college-course-map/background).
- UMBC: `catalog.umbc.edu` returned HTTP 403 to an automated fetch on 2026-11-25. The [UMBC mathematics BS requirements](https://mathstat.umbc.edu/wp-content/uploads/sites/152/2025/04/Mathematics_BS_requirements_2025.pdf) point to it as the official source.

## AI providers (Gemini)
- [Gemini API terms](https://aistudio.google.com/docs/terms): Unpaid Services data use and human review.
- [Gemini API pricing](https://aistudio.google.com/docs/pricing): which models have a free tier, and the "used to improve our products" flags.
- [Gemini document processing](https://aistudio.google.com/docs/document-processing): native PDF reading, page and size limits.
