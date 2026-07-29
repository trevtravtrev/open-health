# Chat Redesign + Default Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenHealth's chat scannable and readable, convert the entire app to a deliberate default dark mode, and improve all default assistant prompts to prefer concise, well-formatted answers.

**Architecture:** Activate permanent dark mode via the existing CSS-variable token system, migrate every hardcoded light color to tokens, define a deliberate "clinical ink + vital teal" palette, rewrite the chat message + screen components for clean-prose role contrast, and rewrite the default assistant prompts (with a migration for existing users).

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 3.4 (`@tailwindcss/typography`, `tailwindcss-animate`), shadcn/ui (Radix), `react-markdown` + remark/rehype, framer-motion, next-intl, Prisma 6.

## Global Constraints

- Default dark mode only. Add `className="dark"` to `<html>`; put dark palette values in `:root` AND `.dark`. No toggle, no light path, no `next-themes`.
- Do not break any page — every screen must remain fully readable in dark mode.
- No test runner exists in this project. Per-task verification = `npx tsc --noEmit` (type gate) + the visual check described; the full `npm run build` runs in the final task.
- Commits: a prior auto-commit was declined by the user, so commit steps are optional — apply the edit regardless and commit only if permitted.
- Use the canonical **Token Migration Map** (below) for all mechanical color swaps; do not invent new ad-hoc colors.
- Keep personas/medical content intact when editing prompts; only reshape output style.

## File Structure

**Rewrites (full new code):**
- `src/app/globals.css` — palette + Geist font fix
- `tailwind.config.ts` — add `user` surface color
- `src/app/layout.tsx` — `dark` class on `<html>`
- `src/lib/dayjs.ts` — add `relativeTime` plugin
- `src/components/chat/chat-message.tsx` — full rewrite (clean prose, role contrast, copy, streaming caret, mono data chips)
- `src/app/chat/[id]/screen.tsx` — readability column, spacing, streaming flag, empty state, textarea input
- `messages/en.json` — empty-state + suggested-prompt strings (other locales inherit via fallback)
- `prisma/data/assistant-mode.json` — rewritten prompts + dedup
- `prisma/data/assistant-mode.legacy.json` — NEW snapshot of pre-rewrite prompts (for migration)
- `prisma/scripts/refresh-assistant-modes.ts` — NEW idempotent migration

**Token migrations (apply Migration Map):**
- UI kit: `src/components/ui/{select,combobox,footer,nav-links}.tsx`
- Auth: `src/components/auth/{login-screen,logout-button}.tsx`
- Onboarding: `src/components/onboarding/{Introduction,PersonalInfo,MedicalRecords,HealthConcerns,Analysis,PrivacyNotice,ProgressBar}.tsx`, `src/app/onboarding/page.tsx`
- Source/forms: `src/components/source/source-add-screen.tsx`, `src/app/assistant-modes/add/page.tsx`, `src/components/form/{text-input,json-editor}.tsx`
- Chat sidebars: `src/components/chat/{chat-side-bar,chat-setting-side-bar}.tsx`

## Token Migration Map (reference for Tasks 2–5, 8)

| Find (substring) | Replace with |
|---|---|
| `bg-white` (dropdown content / SelectContent / combobox list) | `bg-popover` |
| `bg-white` (page/screen wrappers, panels, cards) | `bg-card` |
| `bg-white` (full-page backgrounds) | `bg-background` |
| `bg-gray-50`, `bg-gray-100` | `bg-muted` |
| `bg-zinc-900`, `bg-zinc-800` (solid surfaces) | `bg-card` |
| `bg-gray-200`, `bg-gray-300` (secondary buttons) | `bg-muted` |
| `hover:bg-gray-50`, `hover:bg-gray-100` | `hover:bg-muted` |
| `hover:bg-gray-300`, `hover:bg-gray-400` | `hover:bg-muted` |
| `text-gray-500`, `text-gray-600`, `text-zinc-400`, `text-zinc-500` | `text-muted-foreground` |
| `text-gray-900`, `text-gray-700`, `text-gray-800`, `text-zinc-900`, `text-black` | `text-foreground` |
| `text-zinc-300`, `text-zinc-100` (already-dark contexts like login) | `text-foreground` / `text-muted-foreground` (per context) |
| `border-gray-200`, `border-gray-300`, `border-zinc-200`, `border-zinc-700`, `border-zinc-800` | `border-border` |
| `bg-blue-500`, `bg-blue-600` | `bg-primary` / `hover:bg-primary/90` |
| `text-blue-500`, `text-blue-600`, `text-blue-800` (links) | `text-primary` |
| `border-blue-500`, `bg-blue-50` (drag-active) | `border-primary`, `bg-primary/10` |
| `text-indigo-500`, `focus:border-indigo-500` | `text-primary`, `focus:border-primary` |
| `text-red-500` (errors) | `text-destructive` |
| `bg-red-50` (error tint) | `bg-destructive/10` |
| `border-red-500` (error border) | `border-destructive` |
| `bg-red-500` (NEW badge) | `bg-destructive` |

**For files already using `dark:` variants** (`footer.tsx`, `nav-links.tsx`, `logout-button.tsx`, `screen.tsx` header): drop the duplicated `light dark:` pairs and use the single token class from the map.

---

### Task 1: Dark mode foundation (palette, fonts, html class)

**Files:** Modify `src/app/globals.css`, `tailwind.config.ts`, `src/app/layout.tsx`

**Interfaces:**
- Produces: the `--user-surface` CSS var and `bg-user` Tailwind color consumed by Task 6; the `.dark`-on-`<html>` state relied on by every migration task.

- [ ] **Step 1: Replace the palette + fix the font in `src/app/globals.css`**

Replace the entire `body { font-family: Arial, Helvetica, sans-serif; }` rule (top of file) and both color blocks. New content for the top + first `@layer base`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: var(--font-geist-sans), Arial, Helvetica, sans-serif;
}

@layer base {
  :root {
    /* "clinical ink" base — dark by default (no light mode) */
    --background: 217 30% 5%;
    --foreground: 217 23% 93%;
    --card: 214 24% 9%;
    --card-foreground: 217 23% 93%;
    --popover: 214 24% 9%;
    --popover-foreground: 217 23% 93%;
    --primary: 173 58% 51%;            /* vital teal */
    --primary-foreground: 172 62% 8%;
    --secondary: 215 22% 11%;
    --secondary-foreground: 217 23% 93%;
    --muted: 215 22% 11%;
    --muted-foreground: 213 14% 65%;
    --accent: 215 22% 14%;
    --accent-foreground: 217 23% 93%;
    --destructive: 351 95% 72%;
    --destructive-foreground: 217 23% 93%;
    --border: 213 23% 17%;
    --input: 213 23% 17%;
    --ring: 173 58% 51%;
    --user-surface: 172 50% 11%;        /* user message teal tint */
    --radius: 0.65rem;
  }
  .dark {
    /* identical to :root — kept so existing dark: variants and aurora dark:invert-0 resolve */
    --background: 217 30% 5%;
    --foreground: 217 23% 93%;
    --card: 214 24% 9%;
    --card-foreground: 217 23% 93%;
    --popover: 214 24% 9%;
    --popover-foreground: 217 23% 93%;
    --primary: 173 58% 51%;
    --primary-foreground: 172 62% 8%;
    --secondary: 215 22% 11%;
    --secondary-foreground: 217 23% 93%;
    --muted: 215 22% 11%;
    --muted-foreground: 213 14% 65%;
    --accent: 215 22% 14%;
    --accent-foreground: 217 23% 93%;
    --destructive: 351 95% 72%;
    --destructive-foreground: 217 23% 93%;
    --border: 213 23% 17%;
    --input: 213 23% 17%;
    --ring: 173 58% 51%;
    --user-surface: 172 50% 11%;
  }
}
```

Leave the trailing `@layer base { * { @apply border-border; } body { @apply bg-background text-foreground; } }` block as-is.

- [ ] **Step 2: Add the `user` surface color in `tailwind.config.ts`**

In `theme.extend.colors`, add after the `destructive` entry:

```ts
              destructive: {
                DEFAULT: 'hsl(var(--destructive))',
                foreground: 'hsl(var(--destructive-foreground))'
              },
              user: 'hsl(var(--user-surface))',
```

- [ ] **Step 3: Activate dark mode in `src/app/layout.tsx`**

Change `<html lang={locale}>` to:

```tsx
        <html lang={locale} className="dark">
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Then start the app (`npm run dev`) and confirm the page background is dark teal-black with teal focus rings — if dev can't run in this environment, rely on the full build in Task 10.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/app/globals.css tailwind.config.ts src/app/layout.tsx
git commit -m "feat(theme): default dark mode + clinical-ink/teal palette, enable Geist"
```

---

### Task 2: UI kit token migration

**Files:** Modify `src/components/ui/select.tsx`, `src/components/ui/combobox.tsx`, `src/components/ui/footer.tsx`, `src/components/ui/nav-links.tsx`

- [ ] **Step 1: `select.tsx`** — line 22 trigger `bg-white` → `bg-background`; line 43 SelectContent `bg-white` → `bg-popover`.

- [ ] **Step 2: `combobox.tsx`** — line 82 `bg-white` → `bg-popover`; line 85 `text-gray-500` → `text-muted-foreground`; line 91 `hover:bg-gray-100` → `hover:bg-muted`; line 92 `bg-gray-100` → `bg-muted`.

- [ ] **Step 3: `footer.tsx`** — line 6 `bg-white/80 dark:bg-zinc-900/80` → `bg-background/80`, `border-zinc-200 dark:border-zinc-800` → `border-border`; lines 12/21/30 `text-zinc-500 dark:text-zinc-400` → `text-muted-foreground`, `hover:text-zinc-900 dark:hover:text-white` → `hover:text-foreground`.

- [ ] **Step 4: `nav-links.tsx`** — every `text-zinc-600 dark:text-zinc-400` → `text-muted-foreground` and `hover:text-zinc-900 dark:hover:text-white` → `hover:text-foreground` (lines 10, 18, 27, 35, 43, 51); line 21 `bg-red-500` → `bg-destructive`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`. Visual: header/footer/nav links are legible on dark.

- [ ] **Step 6: Commit (optional)** — `git add src/components/ui && git commit -m "feat(theme): migrate UI kit to dark tokens"`

---

### Task 3: Auth screens token migration

**Files:** Modify `src/components/auth/login-screen.tsx`, `src/components/auth/logout-button.tsx`

- [ ] **Step 1: `logout-button.tsx`** — line 10 `text-zinc-600 dark:text-zinc-400` → `text-muted-foreground`, `hover:text-zinc-900 dark:hover:text-white` → `hover:text-foreground`.

- [ ] **Step 2: `login-screen.tsx`** — apply Migration Map: line 94 `bg-zinc-900/40` → `bg-card/50`; lines 104/120 labels `text-zinc-300` → `text-foreground`; lines 112/128 inputs `border-zinc-700/50 bg-zinc-800/30 text-zinc-100 placeholder-zinc-500 focus:ring-zinc-500 focus:border-zinc-500` → `border-border bg-background/40 text-foreground placeholder:text-muted-foreground focus:ring-ring focus:border-ring`; line 139 submit button `text-zinc-900 bg-white hover:bg-zinc-100 focus:ring-zinc-500` → `text-primary-foreground bg-primary hover:bg-primary/90 focus:ring-ring`; line 150 toggle link `text-zinc-400 hover:text-zinc-300` → `text-muted-foreground hover:text-foreground`; line 97 error `text-red-500` → `text-destructive`. Keep line 83 `text-white` headline (intentional on aurora).

- [ ] **Step 3: Verify** — `npx tsc --noEmit`. Visual: login card uses teal submit button and readable fields on the aurora.

- [ ] **Step 4: Commit (optional)** — `git add src/components/auth && git commit -m "feat(theme): migrate auth screens to dark tokens"`

---

### Task 4: Onboarding token migration

**Files:** Modify the 7 onboarding components + `src/app/onboarding/page.tsx`

- [ ] **Step 1: `Introduction.tsx`** — line 11 `text-gray-500` → `text-muted-foreground`; line 13 `text-gray-600` → `text-foreground/80`; line 16 `text-gray-500 bg-gray-50` → `text-muted-foreground bg-muted`; line 24 `text-gray-600 hover:text-gray-800` → `text-primary hover:text-primary/80`.

- [ ] **Step 2: `PersonalInfo.tsx`** — line 88 `text-gray-600` → `text-foreground/80`; all `border-red-500 bg-red-50` (lines 97,138,157,186,213,246) → `border-destructive bg-destructive/10`; all `text-red-500` error text (lines 126,142,172,201,233,250) → `text-destructive`.

- [ ] **Step 3: `MedicalRecords.tsx`** — line 55 `text-gray-600` → `text-foreground/80`; line 60 `border-blue-500 bg-blue-50` → `border-primary bg-primary/10`, `border-gray-300` → `border-border`; line 70 `text-gray-400` → `text-muted-foreground`; lines 85/103 `text-gray-500` → `text-muted-foreground`; line 116 `bg-gray-50` → `bg-muted`; line 123 `text-red-500 hover:text-red-700` → `text-destructive hover:text-destructive/80`.

- [ ] **Step 4: `HealthConcerns.tsx`** — line 18 `text-gray-600` → `text-foreground/80`; line 28 `border-red-500 bg-red-50` → `border-destructive bg-destructive/10`; line 32 `text-red-500` → `text-destructive`.

- [ ] **Step 5: `Analysis.tsx`** — line 10 `text-gray-600` → `text-foreground/80`; line 16 `border-gray-600` → `border-muted-foreground`.

- [ ] **Step 6: `PrivacyNotice.tsx`** — line 3 `bg-gray-50 text-gray-600` → `bg-muted text-muted-foreground`; line 13 `text-blue-600 hover:text-blue-800` → `text-primary hover:text-primary/80`.

- [ ] **Step 7: `ProgressBar.tsx`** — line 10 `bg-gray-100` → `bg-muted`; line 12 `bg-gray-600` → `bg-primary`.

- [ ] **Step 8: `src/app/onboarding/page.tsx`** — open the file; apply Migration Map to any `bg-white`/`bg-gray-*`/`text-gray-*`/`border-gray-*` found (the step/page wrapper background). If none are present, skip.

- [ ] **Step 9: Verify** — `npx tsc --noEmit`. Visual: every onboarding step is readable on dark; error states use rose.

- [ ] **Step 10: Commit (optional)** — `git add src/components/onboarding src/app/onboarding && git commit -m "feat(theme): migrate onboarding to dark tokens"`

---

### Task 5: Source, assistant-modes/add, and form components token migration

**Files:** Modify `src/components/source/source-add-screen.tsx`, `src/app/assistant-modes/add/page.tsx`, `src/components/form/text-input.tsx`, `src/components/form/json-editor.tsx`

- [ ] **Step 1: `source-add-screen.tsx`** — apply Migration Map to every instance: lines 247/272 `hover:bg-gray-50` → `hover:bg-muted`; lines 252/254/275 `text-gray-500` → `text-muted-foreground`; lines 258/278/816 `text-gray-500` → `text-muted-foreground`; line 353 `hover:bg-gray-50` → `hover:bg-muted`; line 622 `bg-white` → `bg-card`; line 645 `bg-gray-50` → `bg-muted`; line 666 `bg-white` → `bg-card`; lines 668/676 `bg-gray-300` → `bg-muted`; line 757 `bg-blue-500 text-white` → `bg-primary text-primary-foreground`; line 775 `bg-white` → `bg-card`; line 788 `bg-gray-50 font-mono` → `bg-muted font-mono` (keep `font-mono`); line 802 `bg-black bg-opacity-50` → `bg-black/50`; line 804 `bg-white` → `bg-card`; lines 820–822 `bg-blue-500 text-white`/`hover:bg-blue-600`/`focus:ring-blue-500` → `bg-primary text-primary-foreground`/`hover:bg-primary/90`/`focus:ring-ring`; lines 884–886 `bg-gray-300 text-black`/`hover:bg-gray-400`/`focus:ring-gray-500` → `bg-muted text-foreground`/`hover:bg-muted`/`focus:ring-ring`.

- [ ] **Step 2: `assistant-modes/add/page.tsx`** — line 66 `bg-white` → `bg-background`; line 71 `text-gray-600 hover:text-gray-900` → `text-muted-foreground hover:text-foreground`; line 80 `text-gray-600` → `text-muted-foreground`; labels lines 86/101/127/137/155 `text-gray-700` → `text-foreground`; help text lines 113/130/149/167 `text-gray-500` → `text-muted-foreground`.

- [ ] **Step 3: `text-input.tsx`** — line 31 `text-gray-700` → `text-foreground`; line 44 `border-gray-300 focus:border-indigo-500` → `border-border focus:border-primary`, keep `text-lg` etc.; line 46 `text-gray-500` → `text-muted-foreground`; line 54 `text-blue-500` → `text-primary`; line 63 `text-red-500` → `text-destructive`.

- [ ] **Step 4: `json-editor.tsx`** — lines 28/38 `text-gray-800` → `text-foreground`; if the editor body uses a light bg class, map `bg-white`→`bg-card`, `bg-gray-50`→`bg-muted`. (Inspect the surrounding JSX; apply Migration Map to any neutral color found.)

- [ ] **Step 5: Verify** — `npx tsc --noEmit`. Visual: source-add, assistant-modes/add render on dark with teal primary actions; JSON editor text is readable.

- [ ] **Step 6: Commit (optional)** — `git add src/components/source src/components/form src/app/assistant-modes && git commit -m "feat(theme): migrate source/forms/assistant-modes to dark tokens"`

---

### Task 6: Rewrite chat message component

**Files:** Modify `src/lib/dayjs.ts` (add relativeTime), rewrite `src/components/chat/chat-message.tsx`

**Interfaces:**
- Consumes: `ChatMessageType` from `@/app/api/chat-rooms/[id]/messages/route` (has `id`, `content`, `createdAt`, `role`).
- Produces: `ChatMessage` accepting new optional props `{ isStreaming?: boolean; isLastAssistant?: boolean }` — Task 7 passes these from `screen.tsx`.

- [ ] **Step 1: Add the relativeTime plugin in `src/lib/dayjs.ts`**

Full new file:

```ts
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import customParseFormat from "dayjs/plugin/customParseFormat";
import LocalizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)
dayjs.extend(LocalizedFormat)
dayjs.extend(relativeTime)

export default dayjs;
```

- [ ] **Step 2: Rewrite `src/components/chat/chat-message.tsx`**

Full new file:

```tsx
import React, {useState} from "react";
import type {ChatMessage as ChatMessageType} from "@/app/api/chat-rooms/[id]/messages/route";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import Image from 'next/image'
import {Check, Copy} from 'lucide-react'
import {cn} from "@/lib/utils";
import dayjs from "@/lib/dayjs";

interface ChatMessageProps {
    message: ChatMessageType
    isStreaming?: boolean
    isLastAssistant?: boolean
}

export default function ChatMessage({message, isStreaming, isLastAssistant}: ChatMessageProps) {
    const [copied, setCopied] = useState(false)
    const isAssistant = message.role === 'ASSISTANT'

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(message.content)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* clipboard unavailable — ignore */
        }
    }

    if (!isAssistant) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%]">
                    <div className="mb-1 text-right text-xs text-muted-foreground">You</div>
                    <div className="rounded-2xl rounded-tr-sm border border-primary/20 bg-user px-4 py-2.5">
                        <Markdown
                            className="prose prose-invert prose-sm max-w-none prose-p:my-0 prose-headings:my-1"
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                        >
                            {message.content}
                        </Markdown>
                    </div>
                </div>
            </div>
        )
    }

    const showCaret = isStreaming && isLastAssistant

    return (
        <div className="flex gap-3">
            <div className="mt-0.5 shrink-0">
                <Image src="/favicon.ico" alt="Assistant" width={28} height={28} className="rounded-full"/>
            </div>
            <div className="min-w-0 max-w-[85%] flex-1">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden="true"/>
                    <span className="font-medium text-foreground/80">Assistant</span>
                    {message.createdAt && (
                        <span className="hidden sm:inline">· {dayjs(message.createdAt).fromNow()}</span>
                    )}
                    {message.content && (
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="ml-auto inline-flex items-center gap-1 text-muted-foreground/70 transition-colors hover:text-foreground"
                            aria-label="Copy response"
                        >
                            {copied ? <Check className="h-3.5 w-3.5"/> : <Copy className="h-3.5 w-3.5"/>}
                            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                    )}
                </div>
                <div className="relative overflow-hidden rounded-2xl rounded-tl-sm border border-border/60 bg-card py-3 pl-4 pr-4">
                    <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden="true"/>
                    <Markdown
                        className={cn(
                            'prose prose-invert max-w-none',
                            'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground',
                            'prose-h2:mt-4 prose-h2:mb-2 prose-h2:text-base',
                            'prose-h3:mt-3 prose-h3:mb-1.5 prose-h3:text-sm',
                            'prose-p:leading-relaxed prose-p:text-foreground/90',
                            'prose-strong:text-foreground',
                            'prose-a:text-primary prose-a:underline-offset-2',
                            'prose-ul:my-2 prose-ol:my-2 prose-li:my-0',
                            'prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-mono prose-code:before:content-[""] prose-code:after:content-[""]',
                            'prose-pre:bg-muted prose-pre:text-foreground/90',
                            'prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground',
                            'prose-hr:border-border'
                        )}
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                    >
                        {message.content}
                    </Markdown>
                    {showCaret && (
                        <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle"/>
                    )}
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit`. (Visual check happens after Task 7 wires the new props.) Confirm `bg-user`, `bg-card`, `bg-primary` resolve (they will once Task 1 is in place).

- [ ] **Step 4: Commit (optional)** — `git add src/lib/dayjs.ts src/components/chat/chat-message.tsx && git commit -m "feat(chat): rewrite message — clean prose, role contrast, copy, streaming caret, mono chips"`

---

### Task 7: Redesign chat screen (readability, spacing, streaming flag, empty state, input)

**Files:** Modify `src/app/chat/[id]/screen.tsx`, `messages/en.json`

**Interfaces:**
- Consumes: `ChatMessage` from Task 6 with `{ isStreaming, isLastAssistant }`.
- Produces: the finished chat experience.

- [ ] **Step 1: Add i18n strings in `messages/en.json`**

Replace the `"Chat": { "inputPlaceholder": "Type your message..." }` block with:

```json
  "Chat": {
    "inputPlaceholder": "Type your message...  (Enter to send, Shift+Enter for newline)",
    "emptyState": {
      "greeting": "Hi — I'm your OpenHealth assistant.",
      "subtitle": "Ask me anything about your health data, or start with one of these:"
    },
    "suggestedPrompts": [
      "Summarize my latest blood test results",
      "What could be causing my fatigue?",
      "What questions should I ask my doctor next?",
      "Build me a simple weekly nutrition plan"
    ]
  },
```

- [ ] **Step 2: Add streaming state + textarea auto-grow in `screen.tsx`**

In the component, after `const [isRightSidebarOpen, ...] = useState(!isMobile);` add:

```tsx
    const [isStreaming, setIsStreaming] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
```

Import `Textarea` (add to existing imports): `import {Textarea} from "@/components/ui/textarea";`

In `handleSendMessage`, set streaming true at the start (after `setInputText('')`) and false on completion. Replace the existing function body from `setInputText('');` through the end of the `if (reader) {...}` block with:

```tsx
        setInputText('');
        setIsStreaming(true);

        const oldMessages = [...messages, {
            id: new Date().toISOString(),
            content: inputText,
            role: 'USER' as ChatRole,
            createdAt: new Date(),
        }];
        await mutate({chatMessages: oldMessages}, {revalidate: false});

        const response = await fetch(`/api/chat-rooms/${id}/messages`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content: inputText, role: 'USER'})
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const createdAt = new Date()
        try {
            if (reader) {
                let done = false;
                while (!done) {
                    const {value, done: isDone} = await reader.read();
                    done = isDone;
                    const content = decoder.decode(value, {stream: !done});
                    for (const data of content.split('\n').filter(Boolean)) {
                        const {content, error}: { content?: string, error?: string } = JSON.parse(data)
                        if (error) {
                            console.error('Error from LLM:', error);
                            continue;
                        }
                        if (content) {
                            await mutate({
                                chatMessages: [
                                    ...oldMessages,
                                    {id: new Date().toISOString(), content: content, role: 'ASSISTANT', createdAt}
                                ]
                            }, {revalidate: false});
                        }
                    }
                }
                await mutate();
            }
        } finally {
            setIsStreaming(false);
        }
```

Add auto-grow effect after the existing `useEffect` that scrolls:

```tsx
    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }, [inputText])
```

- [ ] **Step 3: Replace the messages list + empty state JSX**

Replace the block:
```tsx
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {messages.map((message, index) => (
                            <ChatMessage key={index} message={message}/>
                        ))}
                        <div ref={messagesEndRef}/>
                    </div>
```
with:
```tsx
                    <div className="flex-1 overflow-y-auto">
                        <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
                            {messages.length === 0 ? (
                                <div className="flex h-full flex-col items-center justify-center py-20 text-center">
                                    <h2 className="text-2xl font-semibold tracking-tight">
                                        {t('emptyState.greeting')}
                                    </h2>
                                    <p className="mt-2 text-muted-foreground">{t('emptyState.subtitle')}</p>
                                    <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                                        {(t.raw('suggestedPrompts') as string[]).map((prompt) => (
                                            <button
                                                key={prompt}
                                                type="button"
                                                onClick={() => setInputText(prompt)}
                                                className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:bg-muted"
                                            >
                                                {prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                messages.map((message, index) => {
                                    const isLast = index === messages.length - 1
                                    return (
                                        <ChatMessage
                                            key={index}
                                            message={message}
                                            isStreaming={isStreaming}
                                            isLastAssistant={isLast && message.role === 'ASSISTANT'}
                                        />
                                    )
                                })
                            )}
                            <div ref={messagesEndRef}/>
                        </div>
                    </div>
```

- [ ] **Step 4: Replace the input bar**

Replace the input `<div className="border-t p-4 z-10 md:static fixed bottom-0 left-0 w-full bg-white"> ... </div>` block (the one containing `<Input/>` + send `<Button/>`) with:

```tsx
                        <div className="border-t border-border p-4">
                            <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
                                <Textarea
                                    ref={textareaRef}
                                    rows={1}
                                    placeholder={t('inputPlaceholder')}
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    className="max-h-40 resize-none"
                                />
                                <Button onClick={handleSendMessage} disabled={isStreaming || !inputText.trim()}>
                                    <Send className="h-4 w-4"/>
                                </Button>
                            </div>
                        </div>
```

The now-unused `Input` import can be left or removed; remove it to keep `tsc` clean if it triggers an unused error (it won't under Next's default config, but removing is tidy): delete `import {Input} from "@/components/ui/input";`.

- [ ] **Step 5: Migrate the remaining hardcoded colors in `screen.tsx`**

Line 108 header `bg-white dark:bg-zinc-900` → `bg-background`; line 131 left sidebar `bg-gray-50` → `bg-card`; line 137 main `bg-white` → `bg-background`; line 146 `text-blue-800` → `text-primary`; lines 151/159 help buttons `text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800` → `text-muted-foreground border-border hover:bg-muted`; line 166 input bar `bg-white` → `bg-background` (if not already replaced); line 189 right sidebar `bg-gray-50` → `bg-card`; line 199 source JSON `<pre>` `bg-gray-50` → `bg-muted`.

- [ ] **Step 6: Verify** — `npx tsc --noEmit`. Visual: centered readable column, generous spacing, empty state with suggested prompts, textarea input, teal send button, streaming caret on the last assistant reply, clear contrast between user (teal tint) and assistant (card + teal rail) surfaces.

- [ ] **Step 7: Commit (optional)** — `git add src/app/chat/[id]/screen.tsx messages/en.json && git commit -m "feat(chat): readable column, empty state, textarea input, streaming flag"`

---

### Task 8: Chat sidebars token migration

**Files:** Modify `src/components/chat/chat-side-bar.tsx`, `src/components/chat/chat-setting-side-bar.tsx`

- [ ] **Step 1: `chat-side-bar.tsx`** — line 142 `bg-white` → `bg-card`; line 149 `text-gray-500` → `text-muted-foreground`; line 159 `hover:bg-gray-100` → `hover:bg-muted`; line 205–206 `hover:bg-gray-100` / `bg-gray-100` → `hover:bg-muted` / `bg-muted`; line 211 `text-gray-500` → `text-muted-foreground`; line 217 `text-gray-500 hover:text-red-500` → `text-muted-foreground hover:text-destructive`; line 277 `text-gray-500` → `text-muted-foreground`; line 290 `bg-gray-200 hover:bg-gray-300 text-gray-900` → `bg-muted hover:bg-muted text-foreground`.

- [ ] **Step 2: `chat-setting-side-bar.tsx`** — lines 195/206 `cn('bg-white')` → `cn('bg-popover')`; line 214 `text-gray-500` → `text-muted-foreground`; line 238 `text-gray-500 hover:text-gray-700` → `text-muted-foreground hover:text-foreground`; line 268 `text-blue-600 hover:text-blue-800` → `text-primary hover:text-primary/80`; line 278 `bg-white border-gray-300` → `bg-card border-border`; line 279 `hover:bg-gray-100` → `hover:bg-muted`; line 285 `text-gray-500` → `text-muted-foreground`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit`. Visual: both sidebars readable on dark; active chat + selected assistant highlight with `bg-muted`.

- [ ] **Step 4: Commit (optional)** — `git add src/components/chat/chat-side-bar.tsx src/components/chat/chat-setting-side-bar.tsx && git commit -m "feat(theme): migrate chat sidebars to dark tokens"`

---

### Task 9: Rewrite default assistant prompts + migration for existing users

**Files:** Create `prisma/data/assistant-mode.legacy.json`, modify `prisma/data/assistant-mode.json`, create `prisma/scripts/refresh-assistant-modes.ts`

- [ ] **Step 1: Snapshot the current prompts**

Copy the current file unchanged so the migration can match old text exactly:

```bash
cp prisma/data/assistant-mode.json prisma/data/assistant-mode.legacy.json
```

- [ ] **Step 2: Rewrite each prompt in `prisma/data/assistant-mode.json`**

For every `systemPrompt` in the file, append this exact block to the end of the string (the leading `\n\n` keeps it separated; the `---` and override clause neutralize earlier conflicting style guidance like the daveshap "avoid lists" rule):

```
\n\n---\n\nOUTPUT STYLE — these rules override any earlier style guidance in this prompt:\n- Be concise. Put the direct answer in the first sentence.\n- Use Markdown: **bold** for key terms, ## or ### headings to separate sections, and bulleted or numbered lists for any steps, options, or enumerations.\n- Keep paragraphs to 1–3 sentences. Prefer scannable structure over dense prose.\n- Put lab values, doses, and numbers in backticks, e.g. `Ferritin 12 ng/mL`, `Vitamin D 38 ng/mL`.\n- End with exactly one short clarifying question.
```

Then **remove the duplicate entry**: the file contains "Root Cause Analysis & Long Term Health." twice (index 0 and index 7, identical). Delete the second occurrence (the one at index 7) so the file has 8 entries.

- [ ] **Step 3: Create the idempotent migration `prisma/scripts/refresh-assistant-modes.ts`**

Full file:

```ts
import {PrismaClient} from '@prisma/client'
import legacy from '../data/assistant-mode.legacy.json'
import next from '../data/assistant-mode.json'

const prisma = new PrismaClient()

// Map old default systemPrompt text -> new systemPrompt text, paired by name.
// The duplicate "Root Cause Analysis" name appears twice in legacy (identical text)
// and once in next; both legacy rows map to the single new text.
const pairs: Record<string, string> = {}
for (const mode of legacy as Array<{ name: string; systemPrompt: string }>) {
    const rewritten = (next as Array<{ name: string; systemPrompt: string }>).find(m => m.name === mode.name)
    if (rewritten && mode.systemPrompt !== rewritten.systemPrompt) {
        pairs[mode.systemPrompt] = rewritten.systemPrompt
    }
}

async function main() {
    let total = 0
    for (const [oldPrompt, newPrompt] of Object.entries(pairs)) {
        const result = await prisma.assistantMode.updateMany({
            where: {systemPrompt: oldPrompt},
            data: {systemPrompt: newPrompt},
        })
        total += result.count
        console.log(`Updated ${result.count} row(s) for "${oldPrompt.slice(0, 40)}..."`)
    }
    console.log(`Done. ${total} assistant mode row(s) refreshed.`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
```

- [ ] **Step 4: Verify the migration**

Confirm the JSON is valid and the script is idempotent:

```bash
node -e "JSON.parse(require('fs').readFileSync('prisma/data/assistant-mode.json','utf8')); console.log('assistant-mode.json valid')"
node -e "JSON.parse(require('fs').readFileSync('prisma/data/assistant-mode.legacy.json','utf8')); console.log('legacy valid')"
```

Run the migration once (against the dev DB). Running it a second time must update 0 rows (because no row still holds the legacy text):

```bash
npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/scripts/refresh-assistant-modes.ts
```

Expected: prints a per-prompt count, then `Done. N row(s) refreshed.` A second run prints all `Updated 0 row(s)`.

- [ ] **Step 5: Commit (optional)** — `git add prisma/data/assistant-mode.json prisma/data/assistant-mode.legacy.json prisma/scripts/refresh-assistant-modes.ts && git commit -m "feat(prompts): concise + formatted default prompts; add idempotent refresh migration"`

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: completes successfully (`prisma generate` + `next build`), no type/lint errors.

- [ ] **Step 3: Dark-mode readability audit (manual)**

Walk every route and confirm readable contrast on the dark base:
1. `/login` — aurora hero, teal submit button, readable fields.
2. `/onboarding` — every step (Intro, Personal Info, Medical Records, Health Concerns, Analysis), including error states.
3. `/source` and add-source flow — file/symptom cards, parse-log mono panel, modals, teal primary actions.
4. `/assistant-modes/add` — labels, help text, inputs.
5. `/chat/<id>` — empty state + suggested prompts, streaming caret, copy button, user vs assistant contrast, long markdown answer, KaTeX/math, both sidebars, settings inputs.

- [ ] **Step 4: Responsive + a11y check**

Mobile viewport: chat column, sidebars collapse, input bar usable. Tab through chat input + buttons: visible teal focus ring. Enable OS reduced-motion: confirm the streaming caret `animate-pulse` and any framer-motion (login, aurora) settle.

- [ ] **Step 5: Commit any fixes (optional)** then report completion.

---

## Self-Review

**Spec coverage:** §4 palette → Task 1; §5 typography (Geist fix) → Task 1; §6.1 chat-message rewrite → Task 6; §6.2 screen (column, spacing, streaming flag, empty state, input) → Task 7; §6.3 sidebars → Task 8; §7 prompts + dedup + migration → Task 9; §8 audit (all 25 files) → Tasks 2–5 + 8; §9 i18n (en.json only, fallback) → Task 7 Step 1; §10 signature (teal rail + mono code chips, status coloring deferred) → Task 6; §11 out-of-scope respected (no toggle, no full locale translation, no provider-logic changes); §12 verification → Task 10. No gaps.

**Placeholder scan:** No TBD/TODO. Every mechanical change is line-referenced with explicit before→after. Every rewrite task contains full file code. The one inspection note (json-editor surrounding JSX, onboarding/page.tsx) is bounded with an explicit fallback rule ("apply Migration Map to any neutral color found").

**Type consistency:** `ChatMessage` props `{ isStreaming, isLastAssistant }` defined in Task 6 and consumed identically in Task 7. `bg-user`/`--user-surface` defined in Task 1 (globals + tailwind) and used in Task 6. `Textarea`/`textareaRef`/`isStreaming` introduced in Task 7 Step 2 and used in Steps 3–4. `relativeTime` added in Task 6 Step 1 and used in Task 6 Step 2. `assistant-mode.legacy.json` created in Task 9 Step 1 and imported in Step 3. All consistent.
