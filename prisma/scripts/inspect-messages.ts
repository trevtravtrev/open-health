// Diagnostic: dump the raw content of recent ASSISTANT messages to see whether
// the model is emitting Markdown (bullets/bold/headings) or plain prose.
// Run: npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/scripts/inspect-messages.ts
import {PrismaClient} from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    const msgs = await prisma.chatMessage.findMany({
        where: {role: 'ASSISTANT'},
        orderBy: {createdAt: 'desc'},
        take: 4,
        select: {content: true, createdAt: true, chatRoomId: true}
    })
    if (msgs.length === 0) {
        console.log('NO ASSISTANT MESSAGES IN DB')
        return
    }
    for (const m of msgs) {
        const c = m.content || ''
        console.log('==================================================')
        console.log('ASSISTANT @', m.createdAt, '| room', m.chatRoomId, '| len', c.length)
        console.log('  has **bold**   :', /\*\*[^*]+\*\*/.test(c))
        console.log('  has -/* bullet :', /(^|\n)\s*[-*] /.test(c))
        console.log('  has ## heading :', /(^|\n)#{1,6} /.test(c))
        console.log('  has table |    :', /\|.*\|/.test(c))
        console.log('  newline count  :', (c.match(/\n/g) || []).length)
        console.log('--- RAW (first 1200 chars) ---')
        console.log(c.slice(0, 1200))
        console.log()
    }
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
