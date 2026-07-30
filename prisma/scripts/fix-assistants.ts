// One-off dev fix (2026-07-29). Two problems surfaced after a restart:
//   1. "Quality of Life Expert" was created under the throwaway render_test
//      account (during an earlier smoke test), so the real user — logged in as
//      their own account — never sees it. Clone it to every real user.
//   2. The real user ended up with duplicate AssistantMode rows of the same name
//      (e.g. two "Root Cause Analysis & Long Term Health."). Remove the extras,
//      but ONLY when another copy of the same name+owner already exists AND no
//      ChatRoom references the row being deleted — so nothing in use is touched.
// Idempotent: safe to run repeatedly.
// Run: npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/scripts/fix-assistants.ts
import {PrismaClient} from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const realUsers = await prisma.user.findMany({where: {username: {not: 'render_test'}}})
    if (realUsers.length === 0) {
        console.log('No real users found — nothing to do.')
        return
    }

    // --- 1. Clone "Quality of Life Expert" to each real user who lacks it ---
    const qolTemplate = await prisma.assistantMode.findFirst({
        where: {name: 'Quality of Life Expert'},
        include: {contexts: true},
    })
    if (!qolTemplate) {
        console.log('No "Quality of Life Expert" template found anywhere — skipping clone.')
    } else {
        for (const u of realUsers) {
            const exists = await prisma.assistantMode.findFirst({
                where: {name: qolTemplate.name, authorId: u.id},
            })
            if (exists) {
                console.log(`[${u.username}] already has QoL — skip.`)
                continue
            }
            const created = await prisma.assistantMode.create({
                data: {
                    name: qolTemplate.name,
                    description: qolTemplate.description,
                    systemPrompt: qolTemplate.systemPrompt,
                    visibility: qolTemplate.visibility,
                    authorId: u.id,
                    contexts: {create: qolTemplate.contexts.map((c) => ({data: c.data}))},
                },
            })
            console.log(`[${u.username}] created QoL -> ${created.id}`)
        }
    }

    // --- 2. Remove unreferenced duplicate modes per (name, owner) ---
    for (const u of realUsers) {
        const modes = await prisma.assistantMode.findMany({
            where: {authorId: u.id},
            orderBy: {createdAt: 'asc'},
        })
        const byName = new Map<string, typeof modes>()
        for (const m of modes) {
            if (!byName.has(m.name)) byName.set(m.name, [])
            byName.get(m.name)!.push(m)
        }
        for (const [name, group] of byName) {
            if (group.length < 2) continue
            const referenced = new Set<string>(
                (await prisma.chatRoom.findMany({
                    where: {assistantModeId: {in: group.map((m) => m.id)}},
                    select: {assistantModeId: true},
                }))
                    .map((r) => r.assistantModeId!)
                    .filter(Boolean),
            )
            // Keep a referenced one if any, else the oldest; delete the rest IF unreferenced.
            const keep = group.find((m) => referenced.has(m.id)) ?? group[0]
            const toDelete = group.filter((m) => m.id !== keep.id && !referenced.has(m.id))
            for (const d of toDelete) {
                await prisma.assistantModeContext.deleteMany({where: {assistantModeId: d.id}}).catch(() => {})
                await prisma.assistantMode.delete({where: {id: d.id}})
                console.log(`[${u.username}] deleted unreferenced duplicate "${name}" -> ${d.id}`)
            }
            const blocked = group.filter((m) => m.id !== keep.id && referenced.has(m.id))
            if (blocked.length) {
                console.log(`[${u.username}] kept referenced duplicate(s) of "${name}" (in use by a chat room): ${blocked.map((m) => m.id).join(', ')}`)
            }
        }
    }

    console.log('DONE')
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
