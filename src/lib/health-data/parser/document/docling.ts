import {
    BaseDocumentParser,
    DocumentModelOptions,
    DocumentOCROptions,
    DocumentParseOptions,
    DocumentParseResult,
    DocumentParserModel,
    OCRParseResult
} from "@/lib/health-data/parser/document/base-document";
import fetch from 'node-fetch'
import FormData from 'form-data'
import fs from 'node:fs'
import {currentDeploymentEnv} from "@/lib/current-deployment-env";

const DOCLING_CONVERT_URL = () => `${process.env.DOCLING_SERVE_URL || 'http://localhost:5001'}/v1alpha/convert/file`;

// options.input is a URL (e.g. http://localhost:3000/api/static/uploads/...) in local
// mode. fs.createReadStream on an http URL yields a stream that errors lazily, which
// makes node-fetch's request body hang forever. Fetch URLs to a buffer instead.
async function resolveInputBuffer(input: string): Promise<Buffer> {
    if (/^https?:\/\//i.test(input)) {
        const res = await fetch(input);
        if (!res.ok) throw new Error(`Failed to fetch parser input ${input}: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    }
    return fs.readFileSync(input);
}

// POST a Docling convert request with retry + a hard timeout. docling-serve transiently
// drops connections ("socket hang up" / "write EOF") under concurrent request bursts, so
// each attempt rebuilds the FormData (the input Buffer is reusable) and retries a few times.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doclingConvert(buildFormData: () => FormData, attempts = 3): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const res = await fetch(DOCLING_CONVERT_URL(), {
                method: 'POST',
                headers: {accept: 'application/json'},
                body: buildFormData(),
                timeout: 180000,
            });
            if (!res.ok) throw new Error(`Docling HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            lastErr = e;
            if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
    }
    throw lastErr;
}

export class DoclingDocumentParser extends BaseDocumentParser {
    get apiKeyRequired(): boolean {
        return false;
    }

    get enabled(): boolean {
        return currentDeploymentEnv === 'local';
    }

    get name(): string {
        return "Docling";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async models(options?: DocumentModelOptions): Promise<DocumentParserModel[]> {
        return [
            {id: 'document-parse', name: 'Document Parse'}
        ];
    }

    async ocr(options: DocumentOCROptions): Promise<OCRParseResult> {
        const buf = await resolveInputBuffer(options.input);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await doclingConvert(() => {
            const formData = new FormData();
            formData.append('ocr_engine', 'easyocr');
            formData.append('pdf_backend', 'dlparse_v2');
            formData.append('from_formats', 'pdf');
            formData.append('from_formats', 'docx');
            formData.append('from_formats', 'image');
            formData.append('force_ocr', 'false');
            formData.append('image_export_mode', 'placeholder');
            formData.append('ocr_lang', 'en');
            formData.append('table_mode', 'fast');
            formData.append('files', buf, {filename: 'file'});
            formData.append('abort_on_error', 'false');
            formData.append('to_formats', 'json');
            formData.append('return_as_file', 'false');
            formData.append('do_ocr', 'true');
            return formData;
        });
        const {document} = data;
        const {json_content} = document;
        const convertedJsonContent = this.convertJsonContent(json_content);
        return {ocr: convertedJsonContent};
    }

    async parse(options: DocumentParseOptions): Promise<DocumentParseResult> {
        const buf = await resolveInputBuffer(options.input);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await doclingConvert(() => {
            const formData = new FormData();
            formData.append('ocr_engine', 'easyocr');
            formData.append('pdf_backend', 'dlparse_v2');
            formData.append('from_formats', 'pdf');
            formData.append('from_formats', 'docx');
            formData.append('from_formats', 'image');
            formData.append('force_ocr', 'true');
            formData.append('image_export_mode', 'placeholder');
            formData.append('ocr_lang', 'en');
            formData.append('table_mode', 'fast');
            formData.append('files', buf, {filename: 'file'});
            formData.append('abort_on_error', 'false');
            formData.append('to_formats', 'md');
            formData.append('return_as_file', 'false');
            formData.append('do_ocr', 'true');
            return formData;
        });
        const {document} = data;
        const {md_content} = document;
        return {document: {content: {markdown: md_content}}};
    }

    private convertCoordinates(bbox: { l: number; t: number; r: number; b: number }, pageHeight: number) {
        if (!bbox) return null;

        return {
            vertices: [
                {
                    x: Math.round(bbox.l),
                    y: Math.round(pageHeight - bbox.t)
                },
                {
                    x: Math.round(bbox.r),
                    y: Math.round(pageHeight - bbox.t)
                },
                {
                    x: Math.round(bbox.r),
                    y: Math.round(pageHeight - bbox.b)
                },
                {
                    x: Math.round(bbox.l),
                    y: Math.round(pageHeight - bbox.b)
                }
            ]
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private convertJsonContent(data: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = {
            metadata: {pages: []},
            pages: [],
            stored: false
        };

        // Process each page
        for (const [pageNum, value] of Object.entries(data.pages)) {
            const pageInfo = value as { size: { width: number, height: number } }
            const pageHeight = pageInfo.size.height;
            const pageWidth = pageInfo.size.width;

            // Add page metadata
            result.metadata.pages.push({
                height: pageHeight,
                page: parseInt(pageNum),
                width: pageWidth
            });

            // Initialize page object
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pageObject: any = {
                height: pageHeight,
                id: parseInt(pageNum) - 1,
                text: "",
                width: pageWidth,
                words: []
            };

            // Process text elements and create full text content
            let wordId = 0;
            let fullText = "";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data.texts.forEach((text: any) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                text.prov.forEach((prov: any) => {
                    if (prov.page_no.toString() === pageNum) {
                        pageObject.words.push({
                            boundingBox: this.convertCoordinates(prov.bbox, pageHeight),
                            confidence: 0.98,
                            id: wordId++,
                            text: text.text
                        });
                        fullText += text.text + " ";
                    }
                });
            });

            // Set full text content
            pageObject.text = fullText.trim();
            result.pages.push(pageObject);

            // Set overall document text
            result.text = fullText.trim();
        }

        return result;
    }
}
