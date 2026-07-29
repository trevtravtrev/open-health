import {NextRequest, NextResponse} from "next/server";
import prisma, {Prisma} from "@/lib/prisma";
import {auth} from "@/auth";
import {decrypt} from "@/lib/encryption";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";
import {ChatOpenAI} from "@langchain/openai";
import {ChatAnthropic} from "@langchain/anthropic";
import {ChatGoogleGenerativeAI} from "@langchain/google-genai";
import {DynamicStructuredTool} from "@langchain/core/tools";
import {AIMessage, ToolMessage} from "@langchain/core/messages";
import {z} from "zod";

export interface ChatMessage extends Prisma.ChatMessageGetPayload<{
    select: {
        id: true,
        content: true,
        createdAt: true,
        role: true
    }
}> {
    id: string,
}

export interface ChatMessageListResponse {
    chatMessages: ChatMessage[]
}

export interface ChatMessageCreateRequest {
    content: string,
    role: 'USER' | 'ASSISTANT',
    settings?: {
        company: string,
        model: string,
        apiEndpoint: string,
        apiKey: string
    }
}

// --- Personal Context tool (assistant-editable lifestyle notes) ---
// One durable markdown note per user (HealthData type 'PERSONAL_CONTEXT'), shared
// across all chats. The assistant reads it every turn and can write to it via a
// function-call tool. By default the tool is APPEND-ONLY: it adds a new
// timestamped line and never touches existing content. The ONLY way to change an
// existing entry is action="update", reserved for when the user EXPLICITLY asks
// to correct a specific entry — it replaces exactly the one line whose text
// matches `target`, refuses if nothing matches, and can never delete the note or
// alter unrelated lines. Total size is capped.
const PERSONAL_CONTEXT_MAX_CHARS = 20000;

const updatePersonalContextTool = new DynamicStructuredTool({
    name: "update_personal_context",
    description: `Write a durable lifestyle fact to the user's Personal Context — a long-term note shared across ALL their chats. DEFAULT to action="append": add ONE new timestamped line for a durable fact the user states that is NOT already recorded (devices, therapies, daily routines, supplements, habits, occupation). Use action="update" ONLY when the user EXPLICITLY asks you to change or correct a SPECIFIC existing entry (e.g. "update my sauna entry to daily", "change my creatine dose to 3g", "actually I meant X not Y") — never use update on your own initiative or to "improve" a fact. For update you MUST provide target=an exact quote from the existing line, and content=the new value; only that one matching line is changed, every other line is left untouched, and if no existing line matches target you must NOT invent one (append instead, or ask the user). NEVER delete the note, NEVER overwrite the whole file, and NEVER remove unrelated lines. Record ONLY what the user actually stated — never infer or invent details (no guessed temperatures, frequencies, durations, doses, or brands the user did not give). Never use this for transient symptoms, one-off questions, or anything already recorded. YOU MUST ACTUALLY CALL THIS TOOL to save — do NOT merely say "I'll save it" or "let me update your profile", because narrating without calling the tool saves nothing.`,
    schema: z.object({
        action: z.enum(["append", "update"]).describe('"append" adds a new fact (default). "update" only when the user explicitly asks to change a specific existing entry — requires target.'),
        content: z.string().min(1).max(2000).describe("The fact. For append: the new fact to add. For update: the new value for the targeted entry."),
        target: z.string().optional().describe('REQUIRED for update: an exact quote from the existing line you are changing, so the correct line is matched. Ignored for append.')
    })
});

// Execute a tool call against the user's single PERSONAL_CONTEXT record. Scoped:
// it can ONLY touch this note. "append" adds a new timestamped line. "update"
// replaces exactly the ONE line whose text contains `target` (refuses if nothing
// matches) — it never deletes the note or alters any other line. Returns a short
// status string fed back to the model so it can confirm to the user.
async function applyPersonalContextUpdate({userId, action, content, target}: {
    userId: string; action?: string; content?: string; target?: string
}): Promise<string> {
    // Strip any leading list-marker / timestamp the model may have copied from an
    // existing line, so we never produce "- [date] - [date] fact" double prefixes.
    const fact = (content ?? "").toString().trim().replace(/^\s*[-*]\s*(\[\d{4}-\d{2}-\d{2}\]\s*)?/, "").trim();
    if (!fact) return "Refused: empty content.";
    const rec = await prisma.healthData.findFirst({where: {authorId: userId, type: "PERSONAL_CONTEXT"}});
    if (!rec) return "No Personal Context record exists for this user.";
    const curObj = (rec.data && typeof rec.data === "object") ? (rec.data as { content?: unknown }) : {};
    const cur = typeof curObj.content === "string" ? curObj.content : "";
    const stamp = new Date().toISOString().slice(0, 10);

    if (action === "update") {
        const needle = (target ?? "").toString().trim().toLowerCase();
        if (!needle) return "Refused: action=update requires 'target' — a quote from the existing line to change. Re-issue with action=append to add a new fact instead.";
        const lines = cur.split("\n");
        const idx = lines.findIndex((l) => l.toLowerCase().includes(needle));
        if (idx === -1) return `Refused: no existing entry matches "${target}". Nothing was changed. Use action=append to add it as a new line.`;
        lines[idx] = `- [${stamp}] ${fact}`;
        let next = lines.join("\n");
        if (next.length > PERSONAL_CONTEXT_MAX_CHARS) {
            next = next.slice(next.length - PERSONAL_CONTEXT_MAX_CHARS);
        }
        await prisma.healthData.update({where: {id: rec.id}, data: {data: {content: next}}});
        return `Updated 1 matching entry on ${stamp}.`;
    }

    // default: append
    let next = `${cur}\n- [${stamp}] ${fact}`.replace(/^\n+/, "");
    if (next.length > PERSONAL_CONTEXT_MAX_CHARS) {
        // Keep the most recent content if it overflows the cap.
        next = next.slice(next.length - PERSONAL_CONTEXT_MAX_CHARS);
    }
    await prisma.healthData.update({where: {id: rec.id}, data: {data: {content: next}}});
    return `Appended to Personal Context on ${stamp}.`;
}

// Build the LangChain chat model for a provider. IMPORTANT: return the RAW
// model — do NOT wrap it in .withConfig(). A RunnableBinding (what withConfig
// returns) has NO bindTools(), so wrapping silently disables tool-calling and
// the model only ever narrates. Run-config (tracing) is passed at stream time.
function buildLLM(providerId: string, apiURL: string, apiKey: string, model: string | null) {
    if (!model) throw new Error("No LLM model ID provided");
    switch (providerId) {
        case "anthropic":
            return new ChatAnthropic({apiKey, anthropicApiUrl: apiURL, model, maxTokens: 4096});
        case "google":
            return new ChatGoogleGenerativeAI({apiKey, model});
        case "openai":
        case "zai":
        default:
            return new ChatOpenAI({apiKey, model, configuration: {baseURL: apiURL}, streaming: true});
    }
}

// Cheap heuristic: does the user's latest message look like it states a durable
// lifestyle fact worth recording? Used to gate the focused-extraction fallback so
// we don't add a second LLM call to every casual question.
const SAVE_INTENT_RE = /\b(remember|save|saved|note that|for my records|keep in mind|update my (profile|context)|i (use|have|take|do|own|started|bought|wear)|my (routine|device|therapy|supplement|sauna|cold plunge|red light|pemf|oura|whoop))\b/i;

// Focused second pass: a tight, tool-only prompt that reliably triggers the
// function call (the model often just *narrates* saving in the main chat turn).
// Extracts genuinely new durable facts and writes them. Not streamed — if it
// saves anything, a short confirmation is appended to the visible reply.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runFocusedExtraction({llm, userId, userMessage, chatRoomId}: { llm: any; userId: string; userMessage: string; chatRoomId: string }): Promise<string[]> {
    const pc = await prisma.healthData.findFirst({where: {authorId: userId, type: "PERSONAL_CONTEXT"}});
    const cur = (pc?.data && typeof pc.data === "object" && "content" in (pc.data as object))
        ? String((pc.data as { content?: unknown }).content || "") : "";
    const focusedSystem = `You are a fact-extraction agent for the user's Personal Context. Read the user's latest message and extract any NEW durable lifestyle facts (devices they own/use, therapies, daily routines, supplements, habits, occupation) that are NOT already in their Personal Context below. For each genuinely new durable fact, call update_personal_context with action="append" and content=<concise fact>. This pass only ADDS new facts — never update or rewrite existing lines, and never invent details (no guessed temperatures, frequencies, doses, or brands). Do NOT record transient symptoms, one-off questions, or anything already listed. If there is nothing new to record, do not call the tool.\n\nCurrent Personal Context:\n${cur.trim() || "(empty)"}`;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bound: any = llm.bindTools([updatePersonalContextTool]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let agg: any = null;
        const stream = await bound.stream([
            {role: "system", content: focusedSystem},
            {role: "user", content: userMessage}
        ], {metadata: {chatRoomId}, runName: "personal-context-extract"});
        for await (const part of stream) {
            agg = agg ? agg.concat(part) : part;
        }
        const tcs = (agg && (agg.tool_calls || (agg.additional_kwargs && agg.additional_kwargs.tool_calls))) || [];
        const saved: string[] = [];
        for (const tc of tcs) {
            const args = tc.args || tc.arguments || {};
            if (!args.content) continue;
            try {
                await applyPersonalContextUpdate({userId, action: "append", content: args.content});
                saved.push(String(args.content));
            } catch {
                /* ignore a single bad call */
            }
        }
        return saved;
    } catch {
        return [];
    }
}

// Stream a chat with optional tool-calling. If the model calls
// update_personal_context, execute it (scoped to the user's note) and continue
// streaming the model's final answer. Because models sometimes *narrate* saving
// instead of calling the tool, a focused extraction pass runs as a fallback when
// the user's message looks like a save intent. Falls back to plain streaming if a
// provider can't bind tools.
async function streamWithTools({llm, messages, controller, userId, userMessage, chatRoomId}: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llm: any; messages: any[]; controller: ReadableStreamDefaultController; userId: string; userMessage: string; chatRoomId: string
}): Promise<string> {
    let out = "";
    let convo = [...messages];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bound: any = llm;
    try {
        if (typeof llm.bindTools === "function") bound = llm.bindTools([updatePersonalContextTool]);
    } catch {
        bound = llm; // provider can't bind tools — plain stream
    }

    let executedAnyTool = false;
    for (let round = 0; round < 2; round++) {
        const chatStream = await bound.stream(convo, {metadata: {chatRoomId}, runName: "chat"});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let agg: any = null;
        for await (const part of chatStream) {
            const delta = part && part.content ? part.content.toString() : "";
            if (delta) {
                out += delta;
                controller.enqueue(`${JSON.stringify({content: out})}\n`);
            }
            agg = agg ? agg.concat(part) : part;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls = (agg && (agg.tool_calls || (agg.additional_kwargs && agg.additional_kwargs.tool_calls))) || [];
        if (!rawToolCalls.length) break; // final answer streamed

        // Normalize ids so the assistant tool-call turn and the tool results match
        // (some providers omit the id on streamed chunks).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCalls = rawToolCalls.map((tc: any, i: number) => ({...tc, id: tc.id || `personal_context_${i}`}));

        convo = [...convo, new AIMessage({
            content: agg && agg.content ? agg.content.toString() : "",
            tool_calls: toolCalls
        })];
        for (const tc of toolCalls) {
            const args = tc.args || tc.arguments || {};
            let result: string;
            try {
                result = await applyPersonalContextUpdate({userId, action: args.action, content: args.content, target: args.target});
                executedAnyTool = true;
            } catch (e) {
                result = `Error saving to Personal Context: ${e instanceof Error ? e.message : String(e)}`;
            }
            convo.push(new ToolMessage({content: result, tool_call_id: tc.id}));
        }
        // A tool was called mid-turn. The text streamed so far is filler ("Saving
        // that now…") — drop it so the final round's answer stands alone, not
        // doubled under two preambles.
        if (round === 0) {
            out = "";
            controller.enqueue(`${JSON.stringify({content: out})}\n`);
        }
        // loop → stream the model's continuation (its final answer to the user)
    }

    // Fallback: the model narrated saving without actually calling the tool. If the
    // user's message looks like a durable-fact statement, run a focused extraction
    // pass that reliably triggers the tool, and confirm what was saved.
    if (!executedAnyTool && userMessage && SAVE_INTENT_RE.test(userMessage)) {
        const saved = await runFocusedExtraction({llm, userId, userMessage, chatRoomId});
        if (saved.length) {
            const confirm = `${out && !out.endsWith("\n") ? "\n\n" : ""}_Saved to Personal Context: ${saved.map(s => s.replace(/\s+/g, " ").trim()).join("; ")}._`;
            out += confirm;
            controller.enqueue(`${JSON.stringify({content: out})}\n`);
        }
    }

    return out;
}

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const {id} = await params
    const chatMessages = await prisma.chatMessage.findMany({
        where: {chatRoomId: id},
        orderBy: {createdAt: 'asc'}
    });

    return NextResponse.json<ChatMessageListResponse>({chatMessages})
}

export async function POST(
    req: NextRequest,
    {params}: {
        params: Promise<{ id: string }>,
    }
) {
    const session = await auth()
    const user = session?.user
    if (!session || !user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const {id} = await params
    const body: ChatMessageCreateRequest = await req.json()

    const {
        chatRoom,
        assistantMode,
        chatMessages,
        healthDataList,
        llmProvider
    } = await prisma.$transaction(async (prisma) => {
        await prisma.chatMessage.create({data: {content: body.content, role: body.role, chatRoomId: id}});
        const {assistantMode} = await prisma.chatRoom.update({
            where: {id},
            data: {lastActivityAt: new Date()},
            select: {assistantMode: {select: {systemPrompt: true}}}
        })
        const chatMessages = await prisma.chatMessage.findMany({
            where: {chatRoomId: id},
            orderBy: {createdAt: 'asc'}
        })
        const healthDataList = await prisma.healthData.findMany({where: {authorId: user.id}})
        const chatRoom = await prisma.chatRoom.findUniqueOrThrow({where: {id}})
        const llmProvider = await prisma.lLMProvider.findUniqueOrThrow({where: {id: chatRoom.llmProviderId}});
        return {
            chatRoom,
            chatMessages,
            assistantMode,
            healthDataList,
            llmProvider
        }
    })

    let apiKey = ''
    if (currentDeploymentEnv === 'local') {
        try { apiKey = decrypt(llmProvider.apiKey) } catch { apiKey = '' }
    } else if (currentDeploymentEnv === 'cloud') {
        switch (llmProvider.providerId) {
            case 'openai':
                apiKey = process.env.OPENAI_API_KEY as string
                break;
            case 'anthropic':
                apiKey = process.env.ANTHROPIC_API_KEY as string
                break;
            case 'google':
                apiKey = process.env.GOOGLE_API_KEY as string
                break;
            case 'zai':
                apiKey = process.env.ZAI_API_KEY as string
                break;
            default:
                throw new Error('Unsupported LLM provider');
        }
    }
    // ZAI: prefer the API key from .env so it does not have to be entered in-app.
    if (llmProvider.providerId === 'zai' && process.env.ZAI_API_KEY) {
        apiKey = process.env.ZAI_API_KEY as string
    }

    // Inject the user's Personal Context (durable lifestyle notes) so every
    // assistant sees it each turn, and (for tool-capable providers) instruct the
    // model on how/when to record new facts via update_personal_context.
    const personalContext = healthDataList.find((h) => h.type === 'PERSONAL_CONTEXT')
    const pcContent = personalContext && personalContext.data && typeof personalContext.data === 'object'
        && 'content' in (personalContext.data as object)
        ? String((personalContext.data as { content?: unknown }).content || '').trim()
        : ''
    const useTools = llmProvider.providerId !== 'ollama'
    const personalContextBlock = pcContent
        ? `PERSONAL CONTEXT (the user's durable lifestyle facts — devices, therapies, routines, supplements, habits; long-term and shared across all chats). This is the COMPLETE and AUTHORITATIVE record: if a fact is NOT listed below, it is NOT on file — even if it was mentioned earlier in this conversation, do not claim it is recorded.\n${pcContent}`
        : `PERSONAL CONTEXT: (currently empty — no durable lifestyle facts recorded yet). Nothing is on file; do not claim any lifestyle fact is recorded.`
    const toolRule = useTools
        ? `\n\nIMPORTANT — PERSONAL CONTEXT TOOL: You have a tool, update_personal_context(action, content, target), that writes to the user's Personal Context (shared across all their chats). DEFAULT is action="append": when the user STATES a durable lifestyle fact NOT already recorded there — sauna, red light therapy, cold plunge, a device they own/use, a daily supplement, sleep/exercise routine, diet pattern, occupation — you MUST CALL the tool with action="append" and content=the fact. Use action="update" ONLY when the user EXPLICITLY asks you to change or correct a SPECIFIC existing entry (e.g. "update my sauna entry to daily", "change my creatine dose to 3g", "actually, not X — Y"). For an update you MUST provide target=an exact quote from the existing line and content=the new value; only that one line is changed. NEVER use update on your own initiative, and NEVER delete the note, overwrite the whole file, or alter unrelated lines — if nothing matches the target, append or ask instead. Record ONLY exactly what the user stated; never infer or invent details (no guessed temperatures, frequencies, durations, doses, or brands). DO NOT merely say "I'll save it", "I'll remember that", or "let me update your profile": if you narrate instead of calling the tool, NOTHING is saved. Do not record transient symptoms or one-off questions. After the tool returns, briefly tell the user exactly what you appended or changed. When summarizing what lifestyle facts are "on file" or "recorded", list ONLY the facts actually present in the PERSONAL CONTEXT section above — never assume or invent that other facts are recorded. This record is critical to their long-term care — be accurate and conservative.`
        : `\n\nIf the user mentions a durable lifestyle fact, suggest they add it to Personal Context on the Sources page.`

    const messages = [
        {"role": "system" as const, "content": `${assistantMode.systemPrompt}\n\n${personalContextBlock}${toolRule}`},
        {
            "role": "user" as const,
            "content": `Health data sources: ${healthDataList.map((healthData) => `${healthData.type}: ${JSON.stringify(healthData.data)}`).join('\n')}`
        },
        ...chatMessages.map((message) => ({
            role: message.role.toLowerCase() as 'user' | 'assistant',
            content: message.content
        }))
    ]

    const responseStream = new ReadableStream({
        async start(controller) {
            let messageContent = '';

            try {
                if (llmProvider.providerId === 'ollama') {
                    const response = await fetch(`${llmProvider.apiURL}/api/chat`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            model: chatRoom.llmProviderModelId,
                            messages: messages,
                            stream: true,
                        }),
                    });

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error('No reader available');

                    while (true) {
                        const {done, value} = await reader.read();
                        if (done) break;

                        const chunk = new TextDecoder().decode(value);
                        const lines = chunk.split('\n').filter(line => line.trim());

                        for (const line of lines) {
                            if (line.includes('[DONE]')) continue;
                            try {
                                const json = JSON.parse(line);
                                const content = json.message?.content;
                                if (content) {
                                    messageContent += content;
                                    controller.enqueue(`${JSON.stringify({content: messageContent})}\n`);
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                } else {
                    // All LangChain providers (openai, anthropic, google, zai).
                    // streamWithTools binds update_personal_context and runs the
                    // tool-call loop with safeguards; ollama is excluded above.
                    const llm = buildLLM(llmProvider.providerId, llmProvider.apiURL, apiKey, chatRoom.llmProviderModelId);
                    messageContent = await streamWithTools({llm, messages, controller, userId: user.id, userMessage: body.content, chatRoomId: id});
                }

                // Save to prisma after the stream is done
                await prisma.$transaction(async (prisma) => {
                    await prisma.chatMessage.create({
                        data: {
                            content: messageContent,
                            role: 'ASSISTANT',
                            chatRoomId: id
                        }
                    });
                    await prisma.chatRoom.update({
                        where: {id}, data: {lastActivityAt: new Date(), name: messageContent}
                    })
                });
            } catch (error) {
                console.error('Error in chat stream:', error);
                controller.enqueue(`${JSON.stringify({error: 'Failed to get response from LLM'})}\n`);
            }

            controller.close();
        }
    });

    return new NextResponse(responseStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
