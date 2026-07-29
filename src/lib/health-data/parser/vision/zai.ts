import {BaseVisionParser, VisionParseOptions, VisionParserModel} from "@/lib/health-data/parser/vision/base-vision";
import {ChatOpenAI} from "@langchain/openai";
import {HealthCheckupSchema} from "@/lib/health-data/parser/schema";
import {ChatPromptTemplate} from "@langchain/core/prompts";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";

// ZAI (Zhipu AI) OpenAI-compatible endpoint. GLM-5.2 is text-only, so vision
// parsing uses glm-4.5v, ZAI's multimodal model (verified to accept images).
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4';

export class ZaiVisionParser extends BaseVisionParser {

    get name(): string {
        return "ZAI";
    }

    get apiKeyRequired(): boolean {
        // Local mode reads the key from .env (ZAI_API_KEY) automatically.
        if (currentDeploymentEnv === 'cloud') return false;
        return !process.env.ZAI_API_KEY;
    }

    get enabled(): boolean {
        return true
    }

    async models(): Promise<VisionParserModel[]> {
        // Z.AI vision models (https://docs.z.ai/guides/overview/overview).
        // glm-4.6v has native function-call support (best for structured output);
        // glm-4.5v is the flexible-reasoning VLM. Both accept images via chat completions.
        return [
            {id: 'glm-4.6v', name: 'GLM-4.6V (native function call)'},
            {id: 'glm-4.5v', name: 'GLM-4.5V'},
        ];
    }

    async parse(options: VisionParseOptions) {
        const apiKey = (process.env.ZAI_API_KEY || options.apiKey) as string;
        const llm = new ChatOpenAI({
            model: options.model.id,
            apiKey,
            configuration: {baseURL: ZAI_BASE_URL},
        })
        const messages = options.messages || ChatPromptTemplate.fromMessages([]);
        const chain = messages.pipe(llm.withStructuredOutput(HealthCheckupSchema, {
            method: 'functionCalling',
        }).withConfig({
            runName: 'health-data-parser',
            metadata: {input: options.input}
        }))
        return await chain.withRetry({stopAfterAttempt: 3}).invoke(options.input);
    }
}
