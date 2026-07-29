/* eslint-disable */

import {ChatPromptTemplate} from "@langchain/core/prompts";
import {HealthCheckupSchema, HealthCheckupType, normalizeTestResult} from "@/lib/health-data/parser/schema";
import {fileTypeFromBuffer} from 'file-type';
import {getFileMd5, processBatchWithConcurrency} from "@/lib/health-data/parser/util";
import {getParsePrompt, MessagePayload} from "@/lib/health-data/parser/prompt";
import visions from "@/lib/health-data/parser/vision";
import documents from "@/lib/health-data/parser/document";
import {put} from "@vercel/blob";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";
import fs from "node:fs";
import {fromBuffer as pdf2picFromBuffer} from 'pdf2pic'
import {tasks} from "@trigger.dev/sdk/v3";
import type {pdfToImages} from "@/trigger/pdf-to-image";

// Local-only (Windows): pdf2pic shells out to `gm` (GraphicsMagick) and
// Ghostscript, resolving them from PATH at call time. If the dev server was
// launched without those dirs on PATH (e.g. started directly instead of via the
// desktop launcher), prepend them here so PDF parsing doesn't fail with
// "gm binaries can't be found". Runs once at module load, before any parse.
if (process.platform === 'win32') {
    const _extras = [
        process.env.GRAPHICSMAGICK_PATH,
        'C:\\Users\\trevo\\tools\\GraphicsMagick',
        'C:\\Program Files\\GraphicsMagick',
        process.env.GHOSTSCRIPT_PATH,
        'C:\\Users\\trevo\\tools\\Ghostscript\\bin',
    ].filter((p): p is string => Boolean(p) && fs.existsSync(p as string));
    if (_extras.length && process.env.PATH && !_extras.every(e => process.env.PATH!.includes(e))) {
        process.env.PATH = _extras.join(';') + ';' + process.env.PATH;
    }
}

interface VisionParserOptions {
    parser: string;
    model: string;
    apiKey: string;
    apiUrl?: string
}

interface DocumentParserOptions {
    parser: string;
    model: string;
    apiKey: string;
}

interface SourceParseOptions {
    file: string;
    visionParser?: VisionParserOptions
    documentParser?: DocumentParserOptions
}

interface InferenceOptions {
    imagePaths: string[],
    excludeImage: boolean,
    excludeText: boolean,
    visionParser: VisionParserOptions
    documentParser: DocumentParserOptions
}

async function documentOCR({document, documentParser}: { document: string, documentParser: DocumentParserOptions }) {

    // Get the document parser
    const parser = documents.find(e => e.name === documentParser.parser)
    if (!parser) throw new Error('Invalid document parser')

    // Get the ocr result
    const models = await parser.models()
    const model = models.find(e => e.id === documentParser.model)
    if (!model) throw new Error('Invalid document parser model')

    // Get the ocr result
    const {ocr} = await parser.ocr({input: document, model: model, apiKey: documentParser.apiKey})

    return ocr
}

async function documentParse({document, documentParser}: {
    document: string,
    documentParser: DocumentParserOptions
}): Promise<any> {

    // Get the document parser
    const parser = documents.find(e => e.name === documentParser.parser)
    if (!parser) throw new Error('Invalid document parser')

    // Get the ocr result
    const models = await parser.models()
    const model = models.find(e => e.id === documentParser.model)
    if (!model) throw new Error('Invalid document parser model')

    // Get the parse result
    const {document: result} = await parser.parse({input: document, model: model, apiKey: documentParser.apiKey})

    return result
}

async function inference(inferenceOptions: InferenceOptions) {
    const {
        imagePaths,
        excludeImage,
        excludeText,
        visionParser: visionParserOptions,
        documentParser: documentParserOptions
    } = inferenceOptions

    // Extract text data if not excluding text
    const pageDataList: { page_content: string }[] | undefined = !excludeText ? await processBatchWithConcurrency(
        imagePaths,
        async (path) => {
            const {content} = await documentParse({document: path, documentParser: documentParserOptions})
            const {markdown} = content
            return {page_content: markdown}
        },
        2
    ) : undefined

    // Extract image data if not excluding images
    const imageDataList: string[] = !excludeImage ? await processBatchWithConcurrency(
        imagePaths,
        async (path) => {
            const fileResponse = await fetch(path)
            const buffer = Buffer.from(await fileResponse.arrayBuffer())
            return `data:image/png;base64,${buffer.toString('base64')}`
        },
        4
    ) : []

    // Batch Inputs
    const numPages = pageDataList ? pageDataList.length : imageDataList.length
    const batchInputs: MessagePayload[] = new Array(numPages).fill(0).map((_, i) => ({
        ...(!excludeText && pageDataList ? {context: pageDataList[i].page_content} : {}),
        ...(!excludeImage && imageDataList ? {image_data: imageDataList[i]} : {})
    }))

    // Generate Messages
    const messages = ChatPromptTemplate.fromMessages(getParsePrompt({excludeImage, excludeText}));

    // Select Vision Parser
    const visionParser = visions.find(e => e.name === visionParserOptions.parser)
    if (!visionParser) throw new Error('Invalid vision parser')

    // Get models
    const visionParserModels = await visionParser.models({
        apiUrl: visionParserOptions.apiUrl,
    })
    const visionParserModel = visionParserModels.find(e => e.id === visionParserOptions.model)
    if (!visionParserModel) throw new Error('Invalid vision parser model')

    // Process the batch inputs
    const batchData = await processBatchWithConcurrency(
        batchInputs,
        async (input) => visionParser.parse({
            model: visionParserModel,
            messages: messages,
            input: input,
            apiKey: visionParserOptions.apiKey,
            apiUrl: visionParserOptions.apiUrl,
        }),
        4
    )

    // Merge the results
    const data: { [key: string]: HealthCheckupType } = batchData.reduce((acc, curr, i) => {
        acc[`page_${i}`] = curr;
        return acc;
    }, {} as { [key: string]: HealthCheckupType });

    // The model occasionally returns a test value as a bare string/number
    // (e.g. "ferritin": "27.4") despite the tool schema. Coerce those into
    // {value} objects per page BEFORE merging, so they are kept instead of
    // crashing HealthCheckupSchema.parse() ("Expected object, received string").
    for (const pageKey of Object.keys(data)) {
        data[pageKey] = normalizeTestResult(data[pageKey]) as HealthCheckupType;
    }

    // Merge Results — FREE-FORM. test_result is a keyed object of verbatim test
    // names, so iterate each page's actual keys (not a fixed catalog), dedupe by
    // lowercased name (first non-empty value wins), and track the source page.
    const mergedTestResult: { [key: string]: any } = {}
    const mergedTestResultPage: { [key: string]: { page: number } } = {}
    const seenLower = new Set<string>()

    for (let i = 0; i < numPages; i++) {
        const healthCheckup = data[`page_${i}`]
        // A page's vision parse can resolve empty/undefined; skip it gracefully
        // instead of crashing the whole parse ("Cannot read properties of undefined").
        if (!healthCheckup?.test_result) continue
        for (const [name, val] of Object.entries(healthCheckup.test_result as Record<string, any>)) {
            if (val == null) continue
            const lower = name.trim().toLowerCase()
            if (!lower || seenLower.has(lower)) continue
            mergedTestResult[name] = val
            mergedTestResultPage[name] = {page: i + 1}
            seenLower.add(lower)
        }
    }

    let mergeData: any = {}

    // Merge name and date
    for (let i = 0; i < numPages; i++) {
        const healthCheckup = data[`page_${i}`]
        if (!healthCheckup) continue
        mergeData = {
            ...mergeData,
            ...healthCheckup,
        }
    }

    // test_result + page map (free-form, deduped by name)
    mergeData['test_result'] = mergedTestResult
    delete mergeData['other_results'] // legacy field from the old hybrid schema

    // Create final HealthCheckup object
    const finalHealthCheckup = HealthCheckupSchema.parse(mergeData)

    return {
        finalHealthCheckup: finalHealthCheckup,
        mergedTestResultPage: mergedTestResultPage,
    }
}

/**
 * Convert a document to images
 * - pdf: convert to images
 * - image: nothing
 *
 * @param file
 *
 * @returns {Promise<string[]>} - List of image paths
 */
async function documentToImages({file: filePath}: Pick<SourceParseOptions, 'file'>): Promise<string[]> {
    const fileResponse = await fetch(filePath);
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer())
    const result = await fileTypeFromBuffer(fileBuffer)
    const fileHash = await getFileMd5(fileBuffer)
    if (!result) throw new Error('Invalid file type')
    const mime = result.mime

    // Convert pdf to images, or use the image as is
    const images: string[] = []
    if (mime === 'application/pdf') {
        if (currentDeploymentEnv === 'local') {
            const pdf2picConverter = pdf2picFromBuffer(fileBuffer, {preserveAspectRatio: true})
            // pdf2pic shells out to gm, which can fail transiently under load
            // ("gm binaries can't be found" is its generic error for any gm failure). Retry.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let bulkResult: any[] = []
            let lastErr: unknown
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    bulkResult = await pdf2picConverter.bulk(-1, {responseType: 'base64'})
                    lastErr = null
                    break
                } catch (e) {
                    lastErr = e
                    if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
                }
            }
            if (lastErr) throw lastErr
            for (const image of bulkResult) {
                if (image.base64) images.push(`data:image/png;base64,${image.base64}`)
            }
        } else {
            const result = await tasks.triggerAndPoll<typeof pdfToImages>(
                'pdf-to-image',
                {pdfUrl: filePath},
                {pollIntervalMs: 5000},
            )
            if (result.status === 'COMPLETED' && result.output) {
                images.push(...result.output.images.map((image) => `data:image/png;base64,${image}`))
            } else {
                throw new Error('Failed to convert the pdf to images')
            }
        }
    } else {
        images.push(`data:${mime};base64,${fileBuffer.toString('base64')}`)
    }

    // Write the image data to a file
    const imagePaths = []
    for (let i = 0; i < images.length; i++) {
        if (currentDeploymentEnv === 'local') {
            fs.writeFileSync(`./public/uploads/${fileHash}_${i}.png`, Buffer.from(images[i].split(',')[1], 'base64'))
            imagePaths.push(`${process.env.NEXT_PUBLIC_URL}/api/static/uploads/${fileHash}_${i}.png`)
        } else {
            const blob = await put(
                `/uploads/${fileHash}_${i}.png`,
                Buffer.from(images[i].split(',')[1], 'base64'),
                {access: 'public', contentType: 'image/png'}
            )
            imagePaths.push(blob.downloadUrl)
        }
    }

    return imagePaths
}

/**
 * Parse the health data
 *
 * @param options
 */
export async function parseHealthData(options: SourceParseOptions) {
    const {file: filePath} = options

    // VisionParser
    const visionParser = options.visionParser || {
        parser: 'OpenAI',
        model: 'gpt-4o',
        apiKey: process.env.OPENAI_API as string
    }

    // Document Parser
    const documentParser = options.documentParser || {
        parser: 'Upstage',
        model: 'document-parse',
        apiKey: process.env.UPSTAGE_API_KEY as string
    }

    // prepare images
    const imagePaths = await documentToImages({file: filePath})

    // prepare ocr results
    const ocrResults = await documentOCR({
        document: filePath,
        documentParser: documentParser
    })

    // prepare parse results
    await processBatchWithConcurrency(
        imagePaths,
        async (path) => documentParse({document: path, documentParser: documentParser}),
        3
    )

    // Merge the results
    const baseInferenceOptions = {imagePaths, visionParser, documentParser}
    const [
        {finalHealthCheckup: resultTotal, mergedTestResultPage: resultTotalPages},
        {finalHealthCheckup: resultText, mergedTestResultPage: resultTextPages},
        {finalHealthCheckup: resultImage, mergedTestResultPage: resultImagePages}
    ] = await Promise.all([
        inference({...baseInferenceOptions, excludeImage: false, excludeText: false}),
        inference({...baseInferenceOptions, excludeImage: false, excludeText: true}),
        inference({...baseInferenceOptions, excludeImage: true, excludeText: false}),
    ]);

    const resultDictTotal = resultTotal.test_result
    const resultDictText = resultText.test_result
    const resultDictImage = resultImage.test_result

    // Merge the three inference passes FREE-FORM by verbatim name
    // (case-insensitive dedupe). Prefer 'total', then text, then image; skip
    // null/empty values. No fixed key set is assumed.
    const mergedTestResult: { [key: string]: any } = {}
    const mergedPageResult: { [key: string]: { page: number } | null } = {}
    const seenLower = new Set<string>()

    const passes: Array<{dict: any, pages: Record<string, { page: number }>}> = [
        {dict: resultDictTotal, pages: resultTotalPages},
        {dict: resultDictText, pages: resultTextPages},
        {dict: resultDictImage, pages: resultImagePages},
    ]
    for (const {dict, pages} of passes) {
        if (!dict || typeof dict !== 'object') continue
        for (const [name, val] of Object.entries(dict as Record<string, any>)) {
            const lower = name.trim().toLowerCase()
            if (!lower || seenLower.has(lower)) continue
            const nonEmpty = val != null && (typeof val !== 'object' || String(val?.value ?? '').trim() !== '')
            if (!nonEmpty) continue
            mergedTestResult[name] = val
            mergedPageResult[name] = pages[name] ?? null
            seenLower.add(lower)
        }
    }

    const healthCheckup = HealthCheckupSchema.parse({
        ...resultTotal,
        test_result: mergedTestResult,
    })

    return {data: [healthCheckup], pages: [mergedPageResult], ocrResults: [ocrResults]}
}
