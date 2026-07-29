# Chat Redesign + Default Dark Mode — Design Spec

**Date:** 2026-07-29
**Status:** Approved (design phase)
**Owner:** Claude Code

## 1. Goal

Make OpenHealth's chat scannable and readable instead of "walls of text," and convert the entire web app to a deliberate default dark mode (no light/dark toggle). Improve all default assistant prompts to prefer concise, well-formatted answers (bold, headings, lists).

## 2. Constraints (non-negotiable)

- **Do not break anything.** Every existing page must render and remain fully readable in dark mode.
- Default dark mode only — no theme toggle, no light mode path to maintain.
- Responsive down to mobile, visible keyboard focus, `prefers-reduced-motion` respected.
- Follow existing patterns (shadcn/ui + Tailwind token system, next-intl, SWR).

## 3. Decisions (from brainstorming)

- **Visual style:** Clean Prose (full-width readable column, avatars, role labels, rich markdown, copy buttons) — chosen by the user.
- **Role contrast:** two distinct surfaces — assistant on an elevated panel, user on a teal-tinted panel. Explicitly requested.
- **Default dark mode** for the whole app — explicitly requested.
- **Approach:** Token migration + deliberate dark palette (Approach #1) — lowest breakage risk while still distinctive.

## 4. Palette — "clinical ink" + vital teal accent

Dark, slightly cool, calm. Defined as HSL CSS variables in `src/app/globals.css`. **Put the deliberate dark values in `:root`** (so the app is dark even before `.dark` is parsed — no flash) **and also in `.dark`** (kept permanently on so existing `dark:` Tailwind variants and the aurora's `dark:invert-0` continue to work).

| Token | Hex | Approx HSL | Use |
|---|---|---|---|
| `--background` | `#0A0D12` | `213 30% 5%` | app base |
| `--card` | `#11151C` | `214 24% 9%` | assistant message surface, panels |
| `--popover` | `#11151C` | `214 24% 9%` | dropdowns |
| `--foreground` | `#E8ECF2` | `217 23% 93%` | body text (soft, not pure white) |
| `--muted` | `#161B24` | `215 22% 11%` | muted backgrounds |
| `--muted-foreground` | `#9AA4B2` | `213 14% 65%` | secondary text |
| `--border` | `#222A35` | `213 23% 17%` | dividers |
| `--input` | `#222A35` | `213 23% 17%` | input borders |
| `--primary` | `#2DD4BF` | `173 58% 51%` | **teal** accent (buttons, rails, links) |
| `--primary-foreground` | `#06231F` | `172 62% 8%` | text on teal |
| `--secondary` | `#161B24` | `215 22% 11%` | secondary buttons |
| `--ring` | `#2DD4BF` | `173 58% 51%` | focus ring |
| `--destructive` | `#FB7185` | `351 95% 72%` | errors / critical |

**User-message surface:** a teal tint, `#0E2A26`, exposed as a new token `--user-surface: 175 53% 11%` and consumed via `bg-user` (add `user: 'hsl(var(--user-surface))'` to the Tailwind `colors` map).

**Status chip colors** (deferred out of v1 — see §10): normal `#34D399`, caution `#FBBF24`, critical `#FB7185`. These require parsing/tagging individual biomarker values to know whether each is normal or abnormal, which is out of scope for v1. v1 delivers the mono data-chip treatment (deterministic, cheap), not value-based coloring.

**The default shadcn dark palette (neutral zinc) is replaced** by the above so the result does not read as the templated default.

## 5. Typography

- The app loads **Geist** (Sans + Mono) via `next/font` in `layout.tsx`, exposing `--font-geist-sans` and `--font-geist-mono`.
- **Bug to fix:** `globals.css` sets `body { font-family: Arial, Helvetica, sans-serif; }`, which overrides Geist entirely. Replace with `font-family: var(--font-geist-sans), ...`.
- **Geist Sans** → all UI and prose. **Geist Mono** → biomarker/lab values, code blocks, and the JSON viewer (instrument-readout feel).
- Type scale: body 15px (`text-[15px]` / `text-sm` tuned), generous line-height for prose, tight tracking on headings.

## 6. Chat redesign

### 6.1 `src/components/chat/chat-message.tsx` (full rewrite)

- **Layout:** each turn is a row inside a centered readable column (max-w handled by the list container in screen.tsx). Assistant left-aligned with avatar; user right-aligned, no avatar.
- **Role contrast (explicit ask):**
  - Assistant → `bg-card` (`#11151C`) rounded panel with a 2–3px teal left accent rail + a small teal dot.
  - User → right-aligned rounded panel on the teal tint surface (`#0E2A26`), no rail.
- **Role label + relative timestamp:** `Assistant · 2m` / `You · now` via `dayjs` (`@/lib/dayjs`) `fromNow()`/relative formatting.
- **Markdown:** keep `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`. Apply a **tuned `prose`** class (`prose prose-invert`) with explicit Tailwind typography overrides for heading sizes, list spacing, bold, links (teal), and code (mono, subtle chip). Map `code` to a mono "data chip" treatment.
- **Copy button** on each assistant message (`navigator.clipboard.writeText`), top-right, appears on hover + always tappable; `lucide` `Copy`/`Check` icon; shows "Copied" for ~1.5s.
- **Streaming caret:** when the message is the last assistant turn and a response is in flight, show a blinking caret at the end. Driven by an `isStreaming` prop from `screen.tsx`.
- User message: rendered with the same `prose prose-invert` so markdown the user types also formats (lighter weight).

### 6.2 `src/app/chat/[id]/screen.tsx`

- **Readability column:** wrap the messages list in `mx-auto w-full max-w-3xl` so long answers don't span the full width on desktop (the root cause of "walls of text").
- **Turn spacing:** replace `space-y-2 p-2` with `space-y-6 p-4 md:p-6`.
- **Streaming flag:** add `const [isStreaming, setIsStreaming] = useState(false)` set true around the fetch in `handleSendMessage`, false on completion/error. Pass `isStreaming` + whether a message is the last assistant turn to `ChatMessage`.
- **Empty state:** when `messages.length === 0`, render a welcome block (greeting + what the assistant can do) and 3–4 clickable **suggested prompts** that fill the input. Strings from i18n (`Chat.emptyState.*`, `Chat.suggestedPrompts.*`).
- **Input redesign:** replace single-line `<Input>` + icon button with an auto-growing `<Textarea>` (rows 1, grows to ~6) + a teal send button; **Enter** sends, **Shift+Enter** inserts a newline. Keep the existing streaming send logic.
- Migrate all hardcoded colors to tokens (header bar, sidebars wrappers, input bar, help buttons).

### 6.3 Sidebars

- `src/components/chat/chat-side-bar.tsx`: `bg-white`/`bg-gray-50`/`bg-gray-100`/`text-gray-500` → `bg-card`/`bg-background`/`bg-muted`/`text-muted-foreground`; active chat highlight uses `bg-muted`.
- `src/components/chat/chat-setting-side-bar.tsx`: same migration; the "select assistant mode" buttons already use `bg-white` → `bg-card`.
- Wrapper panels in `screen.tsx` (`w-72 border-r bg-gray-50`, `w-80 border-l bg-gray-50`) → `bg-card border-border`.

## 7. Assistant prompt rewrites

File: `prisma/data/assistant-mode.json`.

- **Response-style mandate added to every `systemPrompt`:** be concise, lead with the direct answer, use **bold**, short headings (`##`/`###`), and brief bulleted/numbered lists for steps or lists, prefer scannable structure, end with a single clarifying question. Keep the persona/medical guidance intact; only reshape *output style*.
- **Flip anti-list prompts:** the `daveshap/Chronic_Health_AI` mode currently says "Avoid using lists if possible." Change to encourage structured lists/bold for scannability while keeping the "full sentences, precise terminology, word economy" intent.
- **Dedup:** "Root Cause Analysis & Long Term Health." appears twice (index 0 and 7, identical) — remove the duplicate.
- **Propagation — new users:** the JSON is imported by `src/app/api/auth/register/route.ts` and seeded on signup, so new accounts get the improved prompts automatically.
- **Propagation — existing users:** write a one-off, idempotent migration script (`prisma/scripts/refresh-assistant-modes.ts`, run via `npx ts-node`) that updates only rows whose `systemPrompt` **exactly matches** a known original seed string → its rewritten counterpart. Unedited defaults get refreshed; user-edited or custom modes are left untouched. Documents how to run it.

## 8. Dark-mode audit — full file scope

Every file below is migrated from hardcoded light classes to the token system (and verified readable in dark). Strategy map:
- `bg-white` → `bg-background` (page areas) or `bg-card` (panels/surfaces)
- `bg-gray-50`/`bg-gray-100`/`bg-zinc-900` → `bg-card` / `bg-muted`
- `text-gray-500/600`, `text-zinc-400/500` → `text-muted-foreground`
- `text-gray-900`, `text-zinc-900`, `text-black` → `text-foreground`
- `text-white` (on dark heros) → keep where intentional (login headline), else `text-foreground`
- `border-gray-200`, `border-zinc-200/700/800` → `border-border`
- Files already using `dark:` variants (`footer.tsx`, `nav-links.tsx`, `aurora-background.tsx`): once `.dark` is permanent their dark values apply; optionally simplify to single token classes for cleanliness.

**Files (25):**
- Chat: `components/chat/chat-message.tsx`, `components/chat/chat-side-bar.tsx`, `components/chat/chat-setting-side-bar.tsx`, `app/chat/[id]/screen.tsx`
- Auth: `components/auth/login-screen.tsx`, `components/auth/logout-button.tsx`
- Onboarding (7): `components/onboarding/{Introduction,PersonalInfo,MedicalRecords,HealthConcerns,Analysis,PrivacyNotice,ProgressBar}.tsx`, `app/onboarding/page.tsx`
- Source: `components/source/source-add-screen.tsx`
- Assistant modes: `app/assistant-modes/add/page.tsx`
- Forms: `components/form/text-input.tsx`, `components/form/json-editor.tsx`
- UI kit: `components/ui/{footer,nav-links,combobox,select,dialog,aurora-background}.tsx` (verify `button,input,card,textarea,tooltip` already token-based)
- Root: `app/layout.tsx` (add `dark`), `app/globals.css` (palette + Geist fix)

## 9. i18n

- Add new keys only to `messages/en.json`: `Chat.emptyState.*` and `Chat.suggestedPrompts.*` (and input aria-labels). Because `src/i18n/request.ts` deepmerges `en.json` as the default base for every locale, all 10 locales inherit these strings via English fallback — no per-locale edits required and nothing breaks.

## 10. Signature element

The **vital accent**: assistant messages carry a teal rail + label, and inline `code` (lab/biomarker values) renders in **Geist Mono as a data chip** — reading like an instrument readout. This mono data-chip treatment is in v1 (deterministic and cheap). **Status coloring** of chips (emerald/amber/rose based on normal-vs-abnormal) is **deferred** — it requires value tagging and is out of scope for v1. Boldness is spent on the rail + mono chips; the rest of the UI stays disciplined.

## 11. Out of scope (YAGNI)

- No light/dark toggle, no `next-themes`, no persisted theme.
- No new pages or features beyond the chat UX, dark mode, and prompt rewrites.
- No full translation of new strings into all 9 non-English locales (English fallback covers them).
- No rewrite of the LLM streaming/provider logic (only the client rendering of its output).
- No re-architecture of sidebars or routing.

## 12. Verification

- `npm run build` (which runs `prisma generate` + `next build`) passes with no type/lint errors.
- Manual: every page renders in dark mode with readable contrast — login, onboarding (all steps), source add, assistant-modes add, chat (empty state, streaming, copy, long markdown, user vs assistant contrast).
- Mobile viewport check; keyboard focus visible; `prefers-reduced-motion` disables the aurora/caret animations.
- Migration script is idempotent and only touches exact-match default prompts.
