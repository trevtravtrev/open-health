import prisma, {Prisma} from "@/lib/prisma";
import {NextRequest, NextResponse} from "next/server";
import {parseHealthData} from "@/lib/health-data/parser/pdf";
import crypto from "node:crypto";
import {fileTypeFromBuffer} from "file-type";
import sharp from 'sharp'
import {auth} from "@/auth";
import {put} from "@vercel/blob";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";
import fs from 'fs'

export interface HealthData extends Prisma.HealthDataGetPayload<{
    select: {
        id: true,
        type: true,
        data: true,
        metadata: true,
        status: true,
        fileType: true,
        filePath: true,
        createdAt: true,
        updatedAt: true,
    }
}> {
    id: string
}

export interface HealthDataCreateRequest {
    id?: string;
    type: string;
    data: Prisma.InputJsonValue;
    filePath?: string | null;
    fileType?: string | null;
}

export interface HealthDataListResponse {
    healthDataList: HealthData[]
}

export interface HealthDataCreateResponse extends HealthData {
    id: string;
}

// Background parse queue: parses run one at a time so heavy Docling + vision
// work doesn't overload the local Docling container or trip model rate limits.
// The POST handler returns the PARSING record immediately; the queue updates it
// to COMPLETED/ERROR when the (possibly multi-minute) parse finishes. This keeps
// the browser fetch from timing out ("Failed to fetch") on large PDFs.
let parseQueue: Promise<void> = Promise.resolve();
function enqueueParse(task: () => Promise<void>) {
    parseQueue = parseQueue.then(task).catch((err) => {
        console.error('Background parse task crashed:', err);
    });
}

interface ParseJob {
    id: string;
    filePath: string;
    baseData?: { fileName: string };
    visionParser: FormDataEntryValue | null;
    visionParserModel: FormDataEntryValue | null;
    visionParserApiKey: FormDataEntryValue | null;
    visionParserApiUrl: FormDataEntryValue | null;
    documentParser: FormDataEntryValue | null;
    documentParserModel: FormDataEntryValue | null;
    documentParserApiKey: FormDataEntryValue | null;
}

async function runParse(job: ParseJob) {
    // Whole-job retry. parseHealthData already retries each Docling/pdf2pic
    // operation individually (5 attempts), but under a 20+ file queue a
    // transient infra failure (Docling "write EOF", pdf2pic gm subprocess drop)
    // or a one-off bad model output can still slip through those inner retries.
    // Re-running the entire job a couple of times turns those into recoveries
    // instead of permanent ERROR records the user has to re-upload by hand.
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const {data, pages, ocrResults} = await parseHealthData({
                file: job.filePath,
                visionParser: job.visionParser ? {
                    parser: job.visionParser as string,
                    model: job.visionParserModel as string,
                    apiKey: job.visionParserApiKey as string,
                    apiUrl: job.visionParserApiUrl ? job.visionParserApiUrl as string : undefined
                } : undefined,
                documentParser: job.documentParser ? {
                    parser: job.documentParser as string,
                    model: job.documentParserModel as string,
                    apiKey: job.documentParserApiKey as string
                } : undefined
            });

            await prisma.healthData.update({
                where: {id: job.id},
                data: {
                    status: 'COMPLETED',
                    metadata: JSON.parse(JSON.stringify({ocr: ocrResults[0], dataPerPage: pages[0]})),
                    data: {...job.baseData, ...data[0]}
                }
            });
            return; // success — stop retrying
        } catch (error) {
            lastError = error;
            console.error(`Error processing file (attempt ${attempt + 1}/${MAX_ATTEMPTS}):`, error);
            // Back off (5s, 10s) before the next whole-job attempt so a transient
            // Docling/socket drop has time to clear.
            if (attempt < MAX_ATTEMPTS - 1) {
                await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
            }
        }
    }

    // All attempts failed — record the last error.
    const parsingLogs: string[] = [`Error: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`];
    await prisma.healthData.update({
        where: {id: job.id},
        data: {
            status: 'ERROR',
            data: {...job.baseData, parsingLogs},
        }
    }).catch(() => {});
}

export async function POST(
    req: NextRequest
) {
    const session = await auth()
    if (!session || !session.user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const contentType = req.headers.get('content-type')
    if (!contentType) {
        return NextResponse.json({error: 'Missing content-type header'}, {status: 400})
    }

    if (contentType === 'application/json') {
        const data: HealthDataCreateRequest = await req.json()
        const healthData = await prisma.healthData.create({
            data: {...data, authorId: session.user.id}
        })
        return NextResponse.json<HealthDataCreateResponse>(healthData)
    } else {
        const formData = await req.formData()
        const file = formData.get('file')
        const id = formData.get('id')

        // Vision Parser
        const visionParser = formData.get('visionParser')
        const visionParserModel = formData.get('visionParserModel')
        const visionParserApiKey = formData.get('visionParserApiKey')
        const visionParserApiUrl = formData.get('visionParserApiUrl')

        // Document Parser
        const documentParser = formData.get('documentParser')
        const documentParserModel = formData.get('documentParserModel')
        const documentParserApiKey = formData.get('documentParserApiKey')

        let filePath: string | undefined
        let fileType: string | undefined
        let baseData: { fileName: string } | undefined = undefined

        // Save files
        if (file instanceof File) {
            const fileBuffer = Buffer.from(await file.arrayBuffer())
            const result = await fileTypeFromBuffer(fileBuffer)
            if (!result) return NextResponse.json({error: 'Failed to determine file type'}, {status: 400})

            // Get file hash
            const hash = crypto.createHash('md5')
            hash.update(fileBuffer)
            const fileHash = hash.digest('hex')

            const {mime} = result
            if (mime.startsWith('image/')) {
                const outputBuffer = await sharp(fileBuffer).png().toBuffer()
                const filename = `${fileHash}.png`;
                if (currentDeploymentEnv === 'local') {
                    fs.writeFileSync(`./public/uploads/${filename}`, outputBuffer)
                    filePath = `${process.env.NEXT_PUBLIC_URL}/api/static/uploads/${filename}`
                } else {
                    const blob = await put(`/uploads/${filename}`, outputBuffer, {
                        access: 'public',
                        contentType: 'image/png'
                    })
                    filePath = blob.downloadUrl
                }
                fileType = 'image/png'
                baseData = {fileName: file.name}
            } else {
                if (currentDeploymentEnv === 'local') {
                    const extension = file.name.split('.').pop()
                    const filename = `${fileHash}.${extension}`;
                    fs.writeFileSync(`./public/uploads/${filename}`, fileBuffer)
                    filePath = `${process.env.NEXT_PUBLIC_URL}/api/static/uploads/${filename}`
                } else {
                    const extension = file.name.split('.').pop()
                    const filename = `${fileHash}.${extension}`;
                    const blob = await put(`/uploads/${filename}`, fileBuffer, {
                        access: 'public',
                        contentType: mime
                    })
                    filePath = blob.downloadUrl
                }
                fileType = mime
                baseData = {fileName: file.name}
            }
        }

        // Create the PARSING record immediately and return it. The actual
        // (slow) parse runs in the background queue and updates this record,
        // so the browser fetch returns instantly instead of timing out.
        let healthData;
        try {
            healthData = await prisma.healthData.create({
                data: {
                    id: id ? id as string : undefined,
                    type: 'FILE',
                    status: 'PARSING',
                    filePath: filePath,
                    fileType: fileType,
                    data: baseData ? {...baseData} : {},
                    authorId: session.user.id,
                },
            });
        } catch (error) {
            console.error('Error creating parsing record:', error);
            return NextResponse.json({error: 'Failed to create parsing record'}, {status: 500});
        }

        enqueueParse(() => runParse({
            id: healthData.id,
            filePath: filePath as string,
            baseData,
            visionParser,
            visionParserModel,
            visionParserApiKey,
            visionParserApiUrl,
            documentParser,
            documentParserModel,
            documentParserApiKey,
        }));

        return NextResponse.json(healthData);
    }
}

export async function GET() {
    const session = await auth()
    if (!session || !session.user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    // Auto-create the permanent, pinned sources once per user so they always
    // exist and sit at the top of the list. PERSONAL_INFO = structured profile;
    // PERSONAL_CONTEXT = free-text lifestyle notes the assistant can also edit.
    for (const type of ['PERSONAL_INFO', 'PERSONAL_CONTEXT'] as const) {
        const existing = await prisma.healthData.findFirst({where: {authorId: session.user.id, type}})
        if (existing === null) {
            await prisma.healthData.create({
                data: {
                    type,
                    authorId: session.user.id,
                    data: type === 'PERSONAL_CONTEXT' ? {content: ''} : {}
                }
            })
        }
    }

    let healthDataList = await prisma.healthData.findMany({
        where: {authorId: session.user.id},
        orderBy: {createdAt: 'asc'}
    })

    // Order by the extracted examination date (data.date, yyyy-mm-dd) ascending
    // so bloodwork reads chronologically regardless of upload order or file name.
    // Items with no usable date keep their upload order (stable sort) and land
    // after the dated ones.
    const examTime = (raw: unknown): number | null => {
        const s = (raw as { date?: unknown } | null)?.date;
        if (typeof s !== 'string' || !s) return null;
        const t = Date.parse(s.length >= 10 ? s.slice(0, 10) : s);
        return Number.isNaN(t) ? null : t;
    };
    // Permanent sources pin to the top in a fixed order (Personal Info, then
    // Personal Context); everything else sorts by most recent exam date.
    const PIN_ORDER: Record<string, number> = {'PERSONAL_INFO': 0, 'PERSONAL_CONTEXT': 1};
    const pinRank = (type: string) => PIN_ORDER[type] ?? Number.MAX_SAFE_INTEGER;
    healthDataList = [...healthDataList].sort((a, b) => {
        const pa = pinRank(a.type), pb = pinRank(b.type);
        if (pa !== pb) return pa - pb;

        // Everything else: most recent examination date first (descending).
        // Dated items come before undated ones; undated keep upload order.
        const ta = examTime(a.data);
        const tb = examTime(b.data);
        if (ta && tb) return tb - ta;
        if (ta) return -1;
        if (tb) return 1;
        return 0;
    });

    return NextResponse.json<HealthDataListResponse>({
        healthDataList: healthDataList
    })

}
