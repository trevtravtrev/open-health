// One-off dev tool: appends the concise/scannable OUTPUT STYLE mandate to every
// default assistant prompt and removes exact (name+prompt) duplicates.
// Idempotent: strips any previously-applied OUTPUT STYLE block, then re-applies
// the latest version — safe to re-run. Run with:  node prisma/scripts/rewrite-prompts.mjs
import {readFileSync, writeFileSync} from 'node:fs';

const path = 'prisma/data/assistant-mode.json';
const modes = JSON.parse(readFileSync(path, 'utf8'));

const STYLE_BULLETS = [
    'Open with a one-line **Bottom line** — the single most important takeaway in plain language. No preamble, no "great question", no leading disclaimers.',
    'Be concise. Every section earns its place; cut filler and repetition.',
    'Make it scannable: use **bold** for the key term or number in each bullet, use ## or ### headings to separate sections, and use bulleted or numbered lists for steps, options, causes, or recommendations. Keep lists to ~5 items; group or nest if longer.',
    'Use Markdown tables for lab panels, dosing schedules, or any structured comparison (e.g. columns Test / Your value / Range / Note). Put individual lab values, doses, and units in backticks, e.g. `Ferritin 12 ng/mL`, `Vitamin D 38 ng/mL`, `5000 IU daily`.',
    'Keep paragraphs to 1–3 sentences. Prefer tight bullets over dense prose.',
    'Rank recommendations by impact: lead with the highest-value, lowest-cost action first.',
    'Flag uncertainty honestly in a word or short tag (strong evidence / promising / experimental), not a paragraph.',
    'End with exactly one short clarifying question.',
];

const STYLE =
    '\n\n---\n\nOUTPUT STYLE — these rules override any earlier style guidance in this prompt:\n' +
    STYLE_BULLETS.map((b) => `- ${b}`).join('\n');

// Marker that begins any previously-applied OUTPUT STYLE block.
const STYLE_MARKER = '\n\n---\n\nOUTPUT STYLE';

// Remove exact duplicates (same name AND same systemPrompt).
const seen = new Set();
const deduped = [];
for (const m of modes) {
    const key = m.name + ' ' + m.systemPrompt;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
}

// Strip any existing OUTPUT STYLE block, then append the latest version.
let appended = 0;
for (const m of deduped) {
    const idx = m.systemPrompt.indexOf(STYLE_MARKER);
    const base = idx === -1 ? m.systemPrompt : m.systemPrompt.slice(0, idx);
    m.systemPrompt = base.replace(/\s+$/, '') + STYLE;
    appended++;
}

writeFileSync(path, JSON.stringify(deduped, null, 2) + '\n', 'utf8');
console.log(`Rewrote ${deduped.length} prompts (${appended} refreshed with latest OUTPUT STYLE).`);
