import {z} from "zod";

/**
 * HealthCheckup
 * - date, name are optional
 * - test_result is a FREE-FORM keyed object: each key is a test's EXACT printed
 *   name, each value is {value, unit?, reference_range?, abnormal?}. There is NO
 *   fixed field catalog, so every result on a report is captured by its verbatim
 *   name — nothing is forced into a wrong bucket (e.g. QuantiFERON-TB -> hiv) and
 *   nothing is dropped for being "unknown".
 */
const TestValueSchema = z.object({
    value: z.string().describe("The patient's result as a string"),
    unit: z.string().nullable().optional().describe("Unit as printed, or null"),
    reference_range: z.string().nullable().optional().describe("Reference/normal range as printed, or null"),
    abnormal: z.boolean().nullable().optional().describe("True if flagged abnormal/H/L on the report, else false/null"),
});

export const HealthCheckupSchema = z.object({
    date: z.string().optional().nullable().describe("Examination date (yyyy-mm-dd)"),
    name: z.string().optional().nullable().describe("Name"),
    test_result: z
        .record(TestValueSchema)
        .describe(
            "Map each test's EXACT printed name -> {value, unit?, reference_range?, abnormal?}. " +
            "Keys are arbitrary verbatim printed test names (e.g. \"WBC\", \"QuantiFERON-TB Gold\", \"Hemoglobin A1c\", \"비타민 D\"). " +
            "Capture EVERY result on the page."
        ),
});

export type HealthCheckupType = z.infer<typeof HealthCheckupSchema>;

/**
 * Coerce a model's raw test_result into the {value, unit, ...} object shape the
 * strict schema expects. GLM-4.6V occasionally emits a value as a bare string or
 * number, and some function-calling models return the whole thing as an array of
 * {name, value, ...}. Normalizing each page's raw output before the strict parse
 * prevents HealthCheckupSchema.parse() from throwing on shape and loses nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTestResult(raw: any): any {
    if (!raw || typeof raw !== 'object') return raw;
    const out: any = {...raw};
    let tr: any = out.test_result;

    // Some models prefer an array of {name, value, ...} over a keyed object.
    // Coerce it to the keyed form the schema expects.
    if (Array.isArray(tr)) {
        const asObj: any = {};
        for (const item of tr) {
            if (!item || typeof item !== 'object') continue;
            const nm = String(item.name ?? '').trim();
            if (!nm) continue;
            const {name: _name, ...rest} = item;
            asObj[nm] = rest;
        }
        tr = asObj;
    }

    if (tr && typeof tr === 'object') {
        const fixed: any = {};
        for (const [key, value] of Object.entries(tr)) {
            let coerced: any;
            if (value === null || value === undefined) {
                continue;
            } else if (typeof value === 'boolean' || typeof value === 'number') {
                coerced = {value: String(value)};
            } else if (typeof value === 'string') {
                coerced = {value};
            } else if (typeof value === 'object') {
                const obj = value as any;
                if ('value' in obj || 'unit' in obj || 'reference_range' in obj || 'abnormal' in obj) {
                    coerced = {
                        value: obj.value == null ? null : String(obj.value),
                        unit: obj.unit == null ? null : String(obj.unit),
                        reference_range: obj.reference_range == null ? null : String(obj.reference_range),
                        abnormal: obj.abnormal ?? null,
                    };
                } else {
                    const objKeys = Object.keys(obj);
                    coerced = objKeys.length === 1 ? {value: String(obj[objKeys[0]])} : obj;
                }
            } else {
                coerced = value;
            }
            // The schema requires a non-null value string; drop empty entries.
            const v = coerced && typeof coerced === 'object' ? coerced.value : undefined;
            if (v === null || v === undefined || String(v).trim() === '') continue;
            fixed[key] = coerced;
        }
        out.test_result = fixed;
    }
    return out;
}
