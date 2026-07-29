// Dev-only: create a throwaway "render_test" user (hasOnboarded=true) with a
// chat room pre-loaded with a REAL formatted assistant message, so the chat
// rendering can be inspected in the browser without waiting on the LLM.
// Run: npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/scripts/setup-render-test.ts
import {PrismaClient} from '@prisma/client'
import {hash} from 'bcryptjs'
import assistantModeSeed from '../data/assistant-mode.json'
import llmProviderSeed from '../data/llm-provider.json'

const prisma = new PrismaClient()

async function main() {
    const username = 'render_test'
    const password = await hash('test12345', 10)

    const old = await prisma.user.findFirst({where: {username}})
    if (old) {
        await prisma.chatMessage.deleteMany({where: {chatRoom: {authorId: old.id}}}).catch(() => {})
        await prisma.chatRoom.deleteMany({where: {authorId: old.id}}).catch(() => {})
        await prisma.assistantMode.deleteMany({where: {authorId: old.id}}).catch(() => {})
        await prisma.lLMProvider.deleteMany({where: {authorId: old.id}}).catch(() => {})
        await prisma.user.delete({where: {id: old.id}}).catch(() => {})
    }

    const user = await prisma.user.create({data: {username, password, hasOnboarded: true}})
    await prisma.assistantMode.createMany({data: (assistantModeSeed as any[]).map((m) => ({...m, authorId: user.id, visibility: 'PRIVATE'}))})
    await prisma.lLMProvider.createMany({data: (llmProviderSeed as any[]).map((p) => ({...p, authorId: user.id}))})
    const am = await prisma.assistantMode.findFirst({where: {authorId: user.id}})
    const llm = await prisma.lLMProvider.findFirst({where: {authorId: user.id}})
    const room = await prisma.chatRoom.create({data: {name: 'Render test', assistantModeId: am!.id, llmProviderId: llm!.id, authorId: user.id}})

    // Pull the most recent REAL formatted assistant message (the "Bottom line" one).
    const src = await prisma.chatMessage.findFirst({where: {role: 'ASSISTANT', content: {contains: 'Bottom line'}}, orderBy: {createdAt: 'desc'}})
    await prisma.chatMessage.create({data: {chatRoomId: room.id, role: 'USER', content: 'Summarize my latest blood test and give me a ranked action plan.'}})
    await prisma.chatMessage.create({data: {chatRoomId: room.id, role: 'ASSISTANT', content: src ? src.content : '(no source message found)'}})

    console.log('READY — login as render_test / test12345, chat room:', room.id)
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
