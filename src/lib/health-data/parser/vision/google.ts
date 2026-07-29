import {BaseVisionParser, VisionParseOptions, VisionParserModel} from "@/lib/health-data/parser/vision/base-vision";
import {ChatGoogleGenerativeAI} from "@langchain/google-genai";
import {HealthCheckupSchema} from "@/lib/health-data/parser/schema";
import {ChatPromptTemplate} from "@langchain/core/prompts";
import {z} from "zod";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";

type ZodTypeAny = z.ZodTypeAny;
type ZodRawShape = { [k: string]: ZodTypeAny };

export class GoogleVisionParser extends BaseVisionParser {

    get name(): string {
        return "Google";
    }

    get apiKeyRequired(): boolean {
        return currentDeploymentEnv === 'local'
    }

    get enabled(): boolean {
        return true
    }

    async models(): Promise<VisionParserModel[]> {
        return [
            {id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash'},
            {id: 'gemini-2.0-flash-lite-preview-02-05', name: 'Gemini 2.0 Flash-Lite'},
            {id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash'},
            {id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B'},
            {id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro'},
        ]
    }

    async parse(options: VisionParseOptions) {
        const llm = new ChatGoogleGenerativeAI({
            model: options.model.id,
            apiKey: currentDeploymentEnv === 'cloud' ? process.env.GOOGLE_API_KEY : options.apiKey,
        });
        const messages = options.messages || ChatPromptTemplate.fromMessages([]);

        // parse the date and name
        const DateNameSchema = this.removeNullable(z.object({
            date: HealthCheckupSchema.shape.date,
            name: HealthCheckupSchema.shape.name
        }));
        const {
            date,
            name
        } = await messages.pipe(llm.withStructuredOutput(DateNameSchema, {method: 'functionCalling'}).withConfig({
            runName: 'health-data-parser',
            metadata: {input: options.input}
        }))
            .withRetry({stopAfterAttempt: 3})
            .invoke(options.input)

        // parse the test results — FREE-FORM keyed object (no fixed key list, so
        // no more 33-key chunking). test_result is a ZodRecord of verbatim names.
        const TestResultSchema = this.removeNullable(
            z.object({test_result: HealthCheckupSchema.shape.test_result})
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: any = await messages.pipe(llm.withStructuredOutput(TestResultSchema, {method: 'functionCalling'}))
            .withRetry({stopAfterAttempt: 3})
            .invoke(options.input);

        // drop empty-value entries the model may emit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(out?.test_result ?? {})) {
            if (v && typeof v === 'object' && String((v as any).value ?? '').trim() !== '') {
                cleaned[k] = v;
            }
        }

        return HealthCheckupSchema.parse({date, name, test_result: cleaned});
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private removeNullable<T extends ZodTypeAny>(schema: T): any {
        // Handle nullable types
        if (schema instanceof z.ZodNullable) {
            return this.removeNullable(schema.unwrap());
        }

        // Handle object types
        if (schema instanceof z.ZodObject) {
            const shape = schema.shape as ZodRawShape;
            const newShape: ZodRawShape = {};

            for (const [key, value] of Object.entries(shape)) {
                newShape[key] = this.removeNullable(value);
            }

            return z.object(newShape) as z.ZodType<z.infer<T>>;
        }

        // Handle record types (free-form keyed object, e.g. test_result)
        if (schema instanceof z.ZodRecord) {
            return z.record(this.removeNullable(schema.valueSchema as ZodTypeAny)) as z.ZodType<z.infer<T>>;
        }

        // Handle array types
        if (schema instanceof z.ZodArray) {
            return z.array(this.removeNullable(schema.element)) as z.ZodType<z.infer<T>>;
        }

        // Handle optional types
        if (schema instanceof z.ZodOptional) {
            return z.optional(this.removeNullable(schema.unwrap())) as z.ZodType<z.infer<T>>;
        }

        // Handle union types
        if (schema instanceof z.ZodUnion) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return z.union(schema.options.map((option: any) =>
                this.removeNullable(option)
            )) as z.ZodType<z.infer<T>>;
        }

        // Handle intersection types
        if (schema instanceof z.ZodIntersection) {
            return z.intersection(
                this.removeNullable(schema._def.left),
                this.removeNullable(schema._def.right)
            ) as z.ZodType<z.infer<T>>;
        }

        // Return other types as is
        return schema as z.ZodType<z.infer<T>>;
    }
}
