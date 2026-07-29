/**
 * One-off, idempotent migration: refresh EXISTING users' default assistant modes
 * to the rewritten (concise + formatted) prompts.
 *
 * - Pairs each legacy default prompt (prisma/data/assistant-mode.legacy.json)
 *   to its rewritten counterpart (prisma/data/assistant-mode.json) by NAME.
 * - Updates only rows whose systemPrompt EXACTLY matches a legacy default — so
 *   user-edited or custom modes are left untouched.
 * - Idempotent: a second run matches nothing (no row still holds the legacy text).
 *
 * Run when your DB is up:
 *   npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/scripts/refresh-assistant-modes.ts
 */
import {PrismaClient} from '@prisma/client'
import legacyPreV1 from '../data/assistant-mode.legacy.json'
import legacyV1 from '../data/assistant-mode.v1.json'
import next from '../data/assistant-mode.json'

const prisma = new PrismaClient()

type Mode = { name: string; systemPrompt: string }

// Map old default systemPrompt text -> new systemPrompt text, paired by name.
// Pairs are built from BOTH snapshots so users still on the original prompts
// (assistant-mode.legacy.json) OR on the v1 OUTPUT STYLE prompts
// (assistant-mode.v1.json) get upgraded to the latest (v2).
const pairs: Record<string, string> = {}
for (const snapshot of [legacyPreV1, legacyV1] as Mode[][]) {
    for (const mode of snapshot) {
        const rewritten = (next as Mode[]).find((m) => m.name === mode.name)
        if (rewritten && mode.systemPrompt !== rewritten.systemPrompt) {
            pairs[mode.systemPrompt] = rewritten.systemPrompt
        }
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
        console.log(`Updated ${result.count} row(s) matching "${oldPrompt.slice(0, 50)}..."`)
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
