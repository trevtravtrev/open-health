import {BaseMessagePromptTemplateLike} from "@langchain/core/prompts";

export interface MessagePayload {
    context?: string;
    image_data?: string;
}

// Free-form extraction contract. There is NO fixed list of allowed test names —
// the model records every result under its EXACT printed name. This replaces the
// old fixed-catalog design which mis-mapped unknown tests (e.g. "QuantiFERON-TB"
// -> hiv) and dropped anything not in the catalog. Literal JSON braces are
// escaped as {{ }} so ChatPromptTemplate treats them as text, not variables.
const OUTPUT_CONTRACT = `You are a meticulous clinical laboratory analyst. Read the health examination report and extract EVERY patient test result into the structured function call described by the tool schema.

=== OUTPUT SHAPE (MANDATORY) ===
Return a JSON object with these top-level fields:
- "date": examination date as a string "yyyy-mm-dd" (null if unknown)
- "name": patient name exactly as printed (null if unknown)
- "test_result": a FREE-FORM keyed object. EACH key is a test name EXACTLY as printed on the report. EACH value is an object: {{"value": "<result string>", "unit": "<unit or null>", "reference_range": "<range or null>", "abnormal": <true|false|null>}}.

There is NO fixed list of allowed keys. Use the verbatim printed name as the key for every single result. Capture EVERY result on the page — a typical page has 15-40 results. Do not drop anything.

A test value MUST ALWAYS be an object, NEVER a bare string or number.
  CORRECT: "Ferritin": {{"value": "27.4", "unit": "ng/mL", "reference_range": "30-400", "abnormal": false}}
  WRONG:   "Ferritin": "27.4"

=== KEY RULE: USE THE EXACT PRINTED NAME ===
Do NOT translate, normalize, abbreviate, or "correct" test names. Do NOT map a test to a different but similar-sounding name. Use the key exactly as the report prints it.
  Printed "QuantiFERON-TB Gold"   -> key "QuantiFERON-TB Gold"   (it is a tuberculosis test; NOT "HIV", NOT "hiv", NOT "TB test")
  Printed "TSH Receptor Antibody" -> key "TSH Receptor Antibody"
  Printed "WBC"                   -> key "WBC"
  Printed "Hemoglobin A1c"        -> key "Hemoglobin A1c"
  Printed "비타민 D"               -> key "비타민 D" (use the printed form; if bilingual, prefer the English line)

=== WORKED EXAMPLE ===
Report (image/text): "WBC 6.5 x10^3/uL | Hemoglobin 14.1 g/dL | Triglycerides 219 mg/dL | HBsAg: Non-Reactive | QuantiFERON-TB Gold: Negative | Vitamin B12 312 pg/mL"
Correct tool-call arguments:
{{
  "date": "2024-03-15",
  "name": "Hong Gildong",
  "test_result": {{
    "WBC": {{"value": "6.5", "unit": "x10^3/uL", "reference_range": "4.0-10.0", "abnormal": false}},
    "Hemoglobin": {{"value": "14.1", "unit": "g/dL", "reference_range": "13.0-17.0", "abnormal": false}},
    "Triglycerides": {{"value": "219", "unit": "mg/dL", "reference_range": "0-150", "abnormal": true}},
    "HBsAg": {{"value": "Non-Reactive", "unit": null, "reference_range": null, "abnormal": false}},
    "QuantiFERON-TB Gold": {{"value": "Negative", "unit": null, "reference_range": null, "abnormal": false}},
    "Vitamin B12": {{"value": "312", "unit": "pg/mL", "reference_range": "200-900", "abnormal": false}}
  }}
}}

=== EXTRACTION RULES ===
1. EXTRACT EVERY result on the page. Do not stop early and do not drop anything. Each result becomes its own key.
2. Each key = the exact printed test name. Each value MUST be the object above (value is always a string).
3. "value" is ALWAYS a string: numbers -> "6.5", "219"; below-detection -> "<0.5"; qualitative -> "Negative", "Positive"; blood type -> "A".
4. "unit": copy exactly (e.g. "mg/dL", "%", "x10^3/uL", "U/L", "ng/mL"). If none, null.
5. "reference_range": copy the printed normal/reference range verbatim if present, else null. NEVER put the reference range in "value".
6. "abnormal": true if the report flags the row (H/L/* / ↑ / ↓ / "abnormal"), false if explicitly normal, null if unknown.
7. Multi-component values: blood pressure "118/65" -> two keys "Systolic Blood Pressure" {{"value":"118"}} and "Diastolic Blood Pressure" {{"value":"65"}}. Left/right (좌/우) -> include the side in the printed name, e.g. "Right Vision".
8. Ignore page numbers, header dates, and unit-only table rows.
9. If the page genuinely has no results, set "test_result" to {{}}.`;

const prompts: {
    [key: string]: BaseMessagePromptTemplateLike[]
} = {
    both: [
        [
            "human",
            OUTPUT_CONTRACT + `\n\nYou are given BOTH the report image and the machine-parsed text for the SAME page. They describe one report, so reconcile them:
- If the parsed text is garbled (backslashes, broken numbers, stray characters), trust the IMAGE.
- If the image is unclear or cut off, trust the TEXT.
- When both agree, use that value.
Apply the output shape and rules above, then return the tool call.`,
        ],
        ["human", 'This is the parsed text:\n{context}'],
        ["human", [{type: "image_url", image_url: {url: '{image_data}'}}]],
    ],
    onlyText: [
        [
            "human",
            OUTPUT_CONTRACT + `\n\nExtract results ONLY from the parsed text below. Ignore any numbers that are reference ranges, page numbers, or unit-only rows. Apply the output shape and rules above, then return the tool call.`,
        ],
        ["human", 'This is the parsed text:\n{context}']
    ],
    onlyImage: [
        [
            "human",
            OUTPUT_CONTRACT + `\n\nExtract results ONLY from the report image below. Read every table cell carefully, watching row/column alignment. Anything labeled 참고기준치 / 정상참고치 is a reference range, not a result. Apply the output shape and rules above, then return the tool call.`,
        ],
        ["human", [{type: "image_url", image_url: {url: '{image_data}'}}]],
    ]
}

/**
 * Get the appropriate prompt based on the input type
 *
 * @param excludeImage
 * @param excludeText
 */
export function getParsePrompt({excludeImage, excludeText}: {
    excludeImage: boolean,
    excludeText: boolean
}): BaseMessagePromptTemplateLike[] {
    if (!excludeImage && !excludeText) {
        return prompts.both
    } else if (excludeImage && !excludeText) {
        return prompts.onlyText
    } else if (!excludeImage && excludeText) {
        return prompts.onlyImage
    } else {
        throw new Error('Invalid prompt type')
    }
}
