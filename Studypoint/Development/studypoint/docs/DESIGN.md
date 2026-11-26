# Studypoint — Design System & UX

| | |
|---|---|
| Status | **Approved v1.0**, 2026-11-25 |
| Direction | **A · Paper** is the default style, chosen by Alex on 2026-11-25. **Lab notebook** and **Midnight focus** are selectable in Settings (§2.8) |
| Implements | [[PRD]] `UX-*`, `AST-03`, `ADP-02`, `ANL-*`, `NFR-RESP` |
| Related | [[ARCHITECTURE]] §3.1 (client stack), [[TESTING]] (a11y and visual checks) |

**The idea:** a calm, book-like study space. Warm paper, serif reading text and ink-blue accents.
Trust signals (sourced, general knowledge, unverified) are the most important visual language in the app, so they get the strongest, most consistent treatment.
Numbers in analytics use tabular monospace figures, borrowed from direction B.

---

## 1. Principles
1. **Reading comes first.** Long-form text (sources, answers, cards) uses the reading serif, with a comfortable line length (60–75 characters) and generous leading.
2. **Trust is visible without colour.** Every trust state has a **label + icon + shape**. Colour reinforces it but never carries it alone (WCAG 1.4.1).
3. **Quiet chrome.** Borders and surfaces instead of shadows. At most one primary button per view. Accent colour marks links, focus, selection and the citation chip, nothing else.
4. **Fully keyboard-operable, and calm in motion.** Every action is reachable by keyboard. Motion is short and functional, and turned off under reduced-motion.
5. **No native controls.** Every control is a custom component built on WAI-ARIA Authoring Practices patterns (§5).

## 2. Tokens
Tokens are CSS custom properties on `:root` with `[data-theme="dark"]` overrides, exposed to Tailwind v4 via `@theme`.
**The ratios below were computed** with the WCAG 2.x relative-luminance formula. CI repeats this check on every token change (TESTING).

### 2.1 Colour — light
| Token | Value | Use | Contrast |
|---|---|---|---|
| `--page` | `#FBF8F2` | App background (warm paper) | — |
| `--surface` | `#FFFFFF` | Cards, panels, reading column | — |
| `--sunken` | `#F4EFE6` | Wells, input backgrounds, code | — |
| `--border` | `#E4DCCD` | Decorative hairlines | (decorative) |
| `--border-strong` | `#9C8E76` | **Control boundaries** (fields, toggles) | 3.21:1 on surface ✓ (1.4.11) |
| `--text` | `#2B2620` | Body | 14.1:1 on page ✓ |
| `--text-2` | `#5E5548` | Secondary | 6.9:1 on page ✓ |
| `--text-3` | `#6F6557` | Captions, metadata, placeholders | 5.4:1 on page ✓ |
| `--accent` | `#1F3B66` | Links, focus, selection, primary button fill | 10.6:1 on page ✓ |
| `--on-accent` | `#FFFFFF` | Text on accent fill | 11.2:1 ✓ |
| `--accent-bg` | `#E8EEF7` | Selected rows, citation chip | chip text 9.6:1 ✓ |
| `--danger` / `--success` / `--warning` | `#A3321F` / `#2F6B33` / `#8A5A00` | Status text and icons | 6.9 / 6.4 / 5.9:1 ✓ |

### 2.2 Colour — dark (warm charcoal)
| Token | Value | Contrast |
|---|---|---|
| `--page` | `#1E1B17` | — |
| `--surface` | `#26221D` | — |
| `--sunken` | `#191714` | — |
| `--border` | `#3A342C` | (decorative) |
| `--border-strong` | `#7A6F5E` | 3.21:1 on surface ✓ |
| `--text` / `--text-2` / `--text-3` | `#EDE6DA` / `#BDB3A3` / `#A09685` | 13.8 / 8.3 / 5.9:1 on page ✓ |
| `--accent` / `--on-accent` | `#9DB4D8` / `#1E1B17` | 8.1:1 ✓ |
| `--accent-bg` | `#22304A` (chip text `#B7CAE8`, 7.9:1 ✓) | |
| `--danger` / `--success` / `--warning` | `#F09A86` / `#8FCB8E` / `#E9C27A` | 7.3 / 8.4 / 9.4:1 on surface ✓ |

### 2.3 Trust-state tokens (`AST-02/03`, `LIB-04`)
| State | Light (fg on bg, rule) | Dark | Contrast |
|---|---|---|---|
| **Sourced**: citation chip | `#1F3B66` on `#E8EEF7` | `#B7CAE8` on `#22304A` | 9.6 / 7.9 ✓ |
| **General knowledge** | text `#5E5548` on `#F6F0E4`, left rule `#8C7853` | `#BDB3A3` on `#2C2720`, rule `#8C7C60` | text 6.5 / 7.2 ✓, rule 3.8 / 3.6 ✓ |
| **Unverified** | `#6B4A10` on `#FBEFD9`, dashed border | `#E9C27A` on `#33281A` | 7.1 / 8.5 ✓ |
| **OCR / uncertain** | warning icon + "OCR" badge in `--warning` | same | ✓ |

### 2.4 Review ratings (`CRD-08`)
| Rating | Light | Dark | Contrast |
|---|---|---|---|
| 1 Again | `#7A2E1E` on `#F6E3DE` | `#F2B4A6` on `#3A221C` | 7.6 / 8.3 ✓ |
| 2 Hard | `#6B5320` on `#F3ECDD` | `#E8CF95` on `#352C1A` | 6.2 / 9.0 ✓ |
| 3 Good | `#2F5A30` on `#E3EEE3` | `#A9D6A8` on `#1F3220` | 6.7 / 8.4 ✓ |
| 4 Easy | `#1F3B66` on `#E8EEF7` | `#B7CAE8` on `#22304A` | 9.6 / 7.9 ✓ |

Every rating button shows its **number key** and its **next interval** (e.g. "3 Good · 4d"), so colour is never the only cue.

### 2.5 Data visualisation
- Analytics series use a colour-vision-safe sequence: ink blue `#1F3B66`, teal `#2E7D6B`, clay `#B0593A`, ochre `#9A7414`, plum `#6E4A7E`, plus dark-theme equivalents.
- Charts also use direct labels, and patterns where series touch.
- Mastery meters show a **band** (light fill) with a point estimate (tick), not a single bar (`ADP-02`). "Not enough data" is shown as a hatched empty meter with text.
- The full chart spec gets added once P3 analytics are designed. It reuses these tokens.

### 2.6 Typography
| Role | Family | Notes |
|---|---|---|
| Reading (sources, answers, cards, notes) | **Literata** (OFL) | Designed for long-form screen reading |
| UI (navigation, labels, buttons, forms) | **Inter** (OFL) | `font-feature-settings: "tnum"` in tables |
| Numbers and code (analytics, intervals, IDs, code) | **JetBrains Mono** (OFL) | Borrowed from direction B |
| Dyslexia-friendly options (`UX-03`) | **Atkinson Hyperlegible** (OFL), **OpenDyslexic** (OFL) | Swap the reading and UI families |
| Math | KaTeX fonts | `output: 'htmlAndMathml'` for screen readers (`UX-04`) |

Fonts are self-hosted as woff2 (ARCHITECTURE: the CSP allows `self` only) and subset to Latin + math symbols.

**Scale** (rem, 1 rem = 16 px; reading text scales with the user's reading-size setting):
| Token | UI size / line height | Reading size / line height |
|---|---|---|
| `--fs-xs` | 0.75 / 1.4 | — |
| `--fs-sm` | 0.875 / 1.5 | — |
| `--fs-md` | 1 / 1.5 | 1.125 / 1.7 (default reading) |
| `--fs-lg` | 1.25 / 1.35 | 1.375 / 1.5 |
| `--fs-xl` | 1.625 / 1.25 | — |
| `--fs-2xl` | 2.125 / 1.2 | — |

Weights: 400 and 600, with 500 for UI labels only. Text is sentence case everywhere.

### 2.7 Space, shape, elevation, motion
- **Spacing:** 4 px base: `--s-1` = 4, `--s-2` = 8, `--s-3` = 12, `--s-4` = 16, `--s-6` = 24, `--s-8` = 32, `--s-12` = 48.
- **Radius:** `--r-sm` 6 px (chips, inputs), `--r-md` 10 px (cards, buttons), `--r-lg` 14 px (dialogs).
- **Elevation:** surfaces and borders only. One shadow token, `--shadow-pop` (`0 8px 24px rgb(43 38 32 / 0.12)`), for popovers, menus and dialogs. At most two floating layers on screen.
- **Motion:**
  - `--dur-fast` 120 ms (hover, press)
  - `--dur-base` 200 ms (panels, card flip)
  - `--ease` `cubic-bezier(.2,.7,.2,1)`
  - `prefers-reduced-motion` or the in-app "Reduce motion" setting → durations 0, and the card flip becomes a cross-fade.
- **Focus ring:** 2 px `--accent` outline at a 2 px offset (`outline`, not `box-shadow`, so it survives forced-colours mode). It's never hidden, and sticky headers leave room for it (WCAG 2.4.11 Focus Not Obscured).

### 2.8 Styles (Settings → Appearance → Style) — `UX-01`
Three styles, each with a light and a dark theme. **Style** and **theme** are separate settings:
- **Style:** Paper (default), Lab notebook, Midnight focus.
- **Theme:** System (default), Light, Dark. Each style keeps its own default for "System" when the OS doesn't express a preference: Paper and Lab notebook use light, Midnight focus uses dark.

How styles are built:
- Styles only change **tokens**: colour, default font families, radius and a few decorations. Layout, components, behaviour and trust semantics are identical across styles.
- They're applied with `data-style="paper|lab|midnight"` and `data-theme="light|dark"` on `<html>`. Each combination defines the full token set (§2.1–2.4 names).
- Reading settings (`UX-03`) override a style's default fonts. "Style default" is the first option in the font picker.
- **Every style meets the same contrast floors** (text ≥ 4.5:1, control edges, rules and focus ≥ 3:1). The checker is [`tools/check_contrast.py`](../tools/check_contrast.py) and runs in CI.
- Settings show the styles as a live preview grid (the same sample answer and card as the original mockups). Choosing one applies it instantly, with no reload.

| | **Paper** (default) | **Lab notebook** | **Midnight focus** |
|---|---|---|---|
| Feel | Warm, book-like | Cool, precise, engineering tool | Dark-first, high contrast, soft violet |
| Reading font | Literata (serif) | Inter | Inter |
| UI font | Inter | Inter, with JetBrains Mono for labels and IDs | Inter |
| Numbers | JetBrains Mono (tabular) | JetBrains Mono everywhere numeric | JetBrains Mono (tabular) |
| Radius | 6 / 10 / 14 px | 4 / 8 / 10 px | 8 / 12 / 16 px |
| Decoration | none | faint 22 px grid in page margins only, **never behind reading text** | none |
| General-knowledge block | left rule + label | dashed outline + "GENERAL" label | **left rule + label + tinted background**. This strengthens the mockup, where background tint alone was too subtle |

**Lab notebook tokens** (light / dark):
| Token | Light | Dark |
|---|---|---|
| page / surface / sunken | `#F4F6F8` / `#FFFFFF` / `#EBEFF3` | `#14181D` / `#1B2027` / `#101317` |
| border / border-strong | `#D5DCE3` / `#8593A3` (3.13:1) | `#2A313A` / `#6B7785` (3.59:1) |
| text / text-2 / text-3 | `#1B2430` / `#4A5664` / `#5A6675` | `#E3E8EE` / `#AAB4C0` / `#8E99A6` |
| accent / on-accent | `#0E705C` (5.6:1 on page) / `#FFFFFF` | `#4FD1B0` (9.4:1) / `#0B1F1A` |
| chip (accent-bg / text) | `#DDF2EC` / `#0B5446` | `#12352D` / `#8FE5CF` |
| general (bg / text / rule) | `#EEF2F5` / `#4A5664` / `#7A8796` (3.25:1) | `#1F252D` / `#AAB4C0` / `#6B7785` (3.38:1) |
| unverified (bg / text) | `#FBF0D9` / `#6E4A08` | `#33291A` / `#F0C674` |
| ratings Again / Hard / Good / Easy (text on bg) | `#7D1F1F`/`#FBE3E3` · `#6E4A08`/`#FBF0D9` · `#0B5446`/`#DDF2EC` · `#173F6B`/`#E2ECF8` | `#F5A3A3`/`#3A1E1E` · `#F0C674`/`#33291A` · `#8FE5CF`/`#12352D` · `#A9C8F0`/`#1A2B44` |
| danger / success / warning | `#B42318` / `#1E6B3E` / `#8A5A00` | `#F28B82` / `#7FD8A4` / `#F0C674` |

**Midnight focus tokens** (dark is primary):
| Token | Dark | Light |
|---|---|---|
| page / surface / sunken | `#0E1220` / `#161B2E` / `#0B0F1A` | `#F5F5FA` / `#FFFFFF` / `#ECECF4` |
| border / border-strong | `#2A3150` / `#5D6690` (3.06:1) | `#DCDCE8` / `#8A8AA6` (3.35:1) |
| text / text-2 / text-3 | `#E6E8F0` / `#AEB4C8` / `#9AA1B8` | `#1A1C2B` / `#4A4D63` / `#5C5F78` |
| accent / on-accent | `#B3A6FF` (8.7:1 on page) / `#0E1220` | `#5B47D6` (5.8:1) / `#FFFFFF` |
| chip (accent-bg / text) | `#2B2550` / `#C9BEFF` | `#ECE9FD` / `#3F2FA8` |
| general (bg / text / rule) | `#1C2238` / `#AEB4C8` / `#7C86B0` (4.41:1) | `#F0F0F7` / `#4A4D63` / `#76769A` (3.83:1; first try `#8A8AA6` failed at 2.95 and was darkened) |
| unverified (bg / text) | `#3A311C` / `#F5D08A` | `#FBEFD9` / `#6B4A10` |
| ratings Again / Hard / Good / Easy | `#FFB3C1`/`#3A1E28` · `#F5D08A`/`#3A311C` · `#9BE3B8`/`#173326` · `#C9BEFF`/`#2B2550` | `#8A1F35`/`#FCE4EA` · `#6B5320`/`#F6EEDC` · `#1F5A3A`/`#E0F2E8` · `#3F2FA8`/`#ECE9FD` |
| danger / success / warning | `#FF8FA3` / `#7FDCA8` / `#F5D08A` | `#B4233C` / `#1F6B42` / `#8A5A00` |

All 23 contrast checks pass for all six style × theme combinations. The lowest ratio is 3.06:1, on a non-text control edge where 3:1 is required.

## 3. Layout & responsiveness (`NFR-RESP`)
| Width | Shell | Notes |
|---|---|---|
| **≥ 1280 px** (desktop, primary) | Left sidebar (courses/topics, 264 px) + top bar (search ⌘K, Today, usage) + content | The source reader and assistant sit **side by side** (resizable split, keyboard-resizable) |
| 1024–1279 | Collapsible sidebar (icon rail) | The split stays |
| 768–1023 (tablet) | The sidebar becomes a drawer | Reader and assistant become **two tabs** with a "pin answer" sheet |
| < 768 (phone) | Bottom nav (Today, Library, Review, Ask, More) | Single column. Review is full screen. Uploads and the occlusion editor are reachable but say "best on a larger screen" |

- Reading column max width is `68ch`. Pointer targets are ≥ 24 × 24 px everywhere (WCAG 2.5.8) and ≥ 44 × 44 px under `pointer: coarse`.
- Content never needs horizontal scrolling at a 320 px CSS width (WCAG 1.4.10 Reflow), except data tables and PDF pages, which scroll inside their own region with a visible control.

## 4. Trust & citation language (the core pattern)
| Element | Look | Behaviour |
|---|---|---|
| **Citation chip** | Small rounded chip in `--accent-bg`: `<source title> · p. 472` (book icon), using the title of Alex's own source. OCR passages add a ⚠ "OCR" badge | Hover or focus: a preview popover with the quoted passage highlighted. Enter or click: opens the source at the location (deep link, ARCHITECTURE A12). Screen readers hear "Source: <title>, page 472" |
| **Sourced text** | Normal reading text with chips at the end of the sentence | — |
| **General knowledge** | Indented block with a 3 px left rule, background `--general-bg`, starting with a "General knowledge" label and a globe icon | Never contains chips. Copying it keeps the label |
| **Unverified** | Dashed border, collapsed by default: "Couldn't verify this against your sources" (expand to read) | Expanding announces the content |
| **Not found** | Banner at the top of the answer: "Not found in your materials", with two secondary buttons, **Answer from general knowledge** and **Look it up** | — |
| **Conflict** | Inline "Sources disagree" note showing both chips side by side | — |
| **Privacy route** | Small footer on each answer: "Answered with Workers AI · includes your notes" or "Gemini · published sources only (2 personal passages not used)" | Links to Settings → AI & privacy (`PRV-04`) |
| **AI-generated item** | A "Generated" badge on cards and questions until accepted, plus a "From p. 472" chip | — |

Tutor mode (`AST-06`) shows a "Tutor" pill in the composer. Hints appear as numbered steps with a "Show next hint" button. The full solution sits behind "Reveal solution".

## 5. Component inventory (custom only)
All components live in `src/client/ds/`, follow the WAI-ARIA APG pattern named, and are documented in a `ds` gallery route.
The gallery is **dev and preview builds only**. Its placeholder text is generic (e.g. "Sample source · p. 12") and is excluded from production builds (`LIB-12`).
**Banned in app code** (enforced by the repo audit, like Prizm's `verify_repo.py`):
- `alert` / `confirm` / `prompt`
- `<select>`
- visible native `<input type="checkbox|radio|range|color|date|time|number">`
- `<dialog>` without our wrapper

The one allowed exception is a **visually hidden `<input type="file">`** behind `FileDrop`, because it's the only way to open the OS file picker.

| Group | Components (APG pattern) |
|---|---|
| Actions | `Button` (primary / secondary / ghost / danger), `IconButton` (needs `aria-label`), `ButtonGroup`, `Kbd` |
| Inputs | `TextField`, `TextArea` (autosize), `SearchField`, `NumberField` (spinbutton), `MathField` (MathLive web component wrapped with our tokens, producing LaTeX; `QZ-01`), `Checkbox`, `Switch`, `RadioGroup`, `SegmentedControl` (radiogroup), `Slider` (slider; used for daily minutes and retention target), `Select` (listbox popup), `Combobox` (combobox with listbox, for tags and topics), `DatePicker` (dialog + grid), `TimeField`, `FileDrop` (drop zone + hidden file input + paste) |
| Overlays | `Dialog`, `ConfirmDialog` (replaces `confirm()`), `Drawer`, `Popover`, `Menu` (menu button), `Tooltip` (on focus too; dismissible with Esc, WCAG 1.4.13), `Toast` (live region, polite), `CommandPalette` (⌘K, combobox in a dialog) |
| Navigation | `Sidebar` (tree), `Tabs`, `Breadcrumbs`, `BottomNav` |
| Display | `Badge`, `CitationChip`, `TrustBlock` (sourced / general / unverified / notice), `Banner`, `EmptyState`, `Skeleton`, `ProgressBar`, `StatusSteps` (ingestion: queued → … → ready), `MasteryMeter` (band + tick, "Not enough data"), `Heatmap` (grid with a table fallback), `DataTable` (grid; sortable headers), `Markdown` (react-markdown + KaTeX + sanitize) |
| Study | `ReviewCard` (front/back, flip), `RatingBar` (1–4 + intervals), `ClozeView`, `WorkedSolution` (stepwise reveal), `OcclusionEditor` (P2; keyboard alternative to dragging: arrow-key nudge/resize with numeric fields, WCAG 2.5.7), `QuizItem` per format, `Timer` / `Pomodoro` (announces at intervals, not every second), `SourceViewer` (pdf.js + highlight layer; slide view for PPTX; Markdown view for DOCX/MD) |

**Component rules:**
- Forms: labels always visible (no placeholder-only labels). Errors are inline, linked with `aria-describedby`, and focus moves to the first error on submit.
- Every async action shows progress within 100 ms (skeleton or spinner), and long tasks show `StatusSteps`.
- Destructive actions use `ConfirmDialog` with the object's name, and prefer **undo toasts** where they can be undone (soft deletes).

## 6. Key screens (P1 first; later phases outlined)
| Screen | Purpose | Key contents |
|---|---|---|
| **First run** (`LIB-12`, `INS-01`) | The app ships blank | A two-step setup shown while there are no courses:<br>**1. Choose your school**: a typeahead `Combobox` over the college directory. Results show name, city/state and a 2-year/4-year badge. Aliases match (typing "UMBC" finds University of Maryland, Baltimore County). "Not listed" opens name + website fields. Skippable, with a reminder later.<br>**2. Add your first course**: four option cards:<br>• **Search by course code**: a code field with the school's format check, e.g. placeholder `SUBJ 101` (P2: catalog lookup → confirm card)<br>• **Upload files**<br>• **Paste a URL**<br>• **Look up a topic** (P2)<br>In P1 the code card asks for code + title by hand.<br>It also mentions the privacy flag and that everything in Studypoint comes from your own sources. No sample data, no demo course, no built-in subjects |
| **Add course by code** (P2, `INS-03..05`) | Official course details | Code field with autocomplete from confirmed lookups. A result card shows code, official title, credits, a description excerpt and a citation chip to the catalog page, with a **Verified from <school> catalog** badge or an **Unverified** dashed block with fallbacks (paste URL, paste text, enter manually). Then "Suggested from the catalog" topic checkboxes, all unchecked by default |
| **Today** (home) | The next best actions | Due reviews (count + est. minutes vs budget) → **Start review** (primary). Open "source changed" flags. Sources still ingesting. Recent conversations. (P2: ramp-up warnings. P3: plan blocks) |
| **Library** | Courses → units → topics → sources | Tree + list. Upload (FileDrop). Filters: type, tag, privacy, studied state. Each source row shows its status steps, privacy badge (lock icon "Personal" / globe "Published") and studied progress |
| **Source reader** | Read with citations | `SourceViewer` + page thumbnails + studied markers + "Make cards from selection" + assistant split pane scoped to this source |
| **Assistant** | Grounded Q&A | Conversation list, scope chips (course and sources), Direct/Tutor toggle, `TrustBlock` rendering, privacy route footer |
| **Card tray** | Accept generated items (`CRD-04`) | Item list with validation result, cited passage preview, Accept all / Edit / Discard. Rejected items are collapsed, with reasons |
| **Review** | FSRS session | Focus layout: card centred, `RatingBar`, progress (done / remaining / minutes), source chip on the back. Keys: Space shows the answer, 1–4 rate, E edits, S suspends, U undoes the last rating |
| **Flags** | Source changed (`SRC-01/02`) | Side-by-side old/new passage diff and Keep / Edit / Regenerate / Retire |
| **Settings** | `UX-01..06`, `PRV-04`, `INS-01` | **School** (change the home school; existing courses keep theirs), Appearance (**style**: Paper / Lab notebook / Midnight focus as a live preview grid; theme: system/light/dark; reading font/size/spacing/width; reduce motion), Study (daily minutes, retention target, interleaving), Assistant (default mode, mixed-privacy setting), AI & privacy (routing table and provider data terms, usage vs free limits), Data (export, restore, backups list) |
| P2 **Lookup**, **Quiz** | `LKP-*`, `QZ-*` | Search results grouped by trust tier, each with domain and "Keep"; quiz builder (config form), quiz runner, results with per-question sources |
| P3 **Exam**, **Planner**, **Analytics**, **Session** | `EXM-*`, `PLN-*`, `ANL-*` | Exam mode hides the assistant and timer controls. Week planner (list view is the accessible default; a calendar grid is optional). Analytics panels, each with an action button. Focus session view with Pomodoro |

Wireframes for P1 screens are produced as the first task of P1 (TASKS) and reviewed with Alex before building.

## 7. Keyboard model
| Key | Action |
|---|---|
| `⌘/Ctrl K` | Command palette (search everything, run actions) |
| `/` | Focus search |
| `g t` / `g l` / `g r` / `g a` | Go to Today / Library / Review / Assistant |
| `?` | Shortcut help |
| `Space` / `1–4` | Review: show answer / rate |
| `U` | Undo the last rating |
| `[` and `]` | Previous / next page in the reader |

Single-key shortcuts only work while the relevant screen has focus, and they can be **turned off** in Settings (WCAG 2.1.4).

## 8. Accessibility checklist (WCAG 2.2 AA + `UX-03..05`)
- Contrast: every token pair in every style × theme is checked in CI (§2, `tools/check_contrast.py`).
- Not colour alone: trust states and ratings have text and icons.
- Keyboard: all functionality, a logical focus order, and no keyboard traps (dialogs trap intentionally and release on Esc).
- 2.4.11 focus not obscured · 2.5.7 dragging alternatives · 2.5.8 target size · 3.3.7 no redundant entry · 3.3.8 accessible authentication (Cloudflare's email PIN, no cognitive test).
- Screen readers:
  - landmarks
  - one `h1` per view
  - live regions for toasts, ingestion progress and streaming answers (announced at sentence boundaries, not per token)
  - math as MathML
- Reading settings (`UX-03`): font family, size (90–160%), letter spacing (0–0.12 em), line height (1.5–2.0), reading width (50–80 ch). Stored in `settings.reading_json`.
- Text-to-speech (`UX-05`, P3): the browser's built-in speech synthesis, with play/pause/rate controls. It reads the passage under the cursor or the current card, and math is spoken from its MathML/alt text.
- Forced colours and Windows High Contrast: system colours are respected, and focus and borders use `CanvasText` / `Highlight`.
- Testing: axe-core in Playwright end-to-end tests on every screen in both themes, plus a manual keyboard and NVDA pass on each release (TESTING).

## 9. Voice & content
- Plain, honest and brief. Sentence case. Contractions. No "please", no exclamation marks, no "simply".
- Uncertainty is stated directly, for example "I couldn't find this in your materials" or "This page was read by OCR and may contain errors". Never hedge in a way that hides that something failed.
- Numbers come with what they mean, e.g. "Retention 87% (target 90%) → Lower new cards or add 5 min".
- Empty states invite action: "Add your first course", "Upload lecture slides to start".

## 10. Assets
- **Icons:** Lucide (as in Prizm), outline, 1.5 px stroke, 16 or 20 px. Icon-only buttons need `aria-label` (checked by the audit).
- **Illustration:** none in v1. Empty states use icon + text.
- **Favicon/logo:** a simple open-book or bookmark glyph in ink blue on paper. Final design is a P1 task.
