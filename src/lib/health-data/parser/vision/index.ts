import {OpenAIVisionParser} from "@/lib/health-data/parser/vision/openai";
import {GoogleVisionParser} from "@/lib/health-data/parser/vision/google";
import {OllamaVisionParser} from "@/lib/health-data/parser/vision/ollama";
import {ZaiVisionParser} from "@/lib/health-data/parser/vision/zai";

const visions = [
    new OpenAIVisionParser(),
    new GoogleVisionParser(),
    new OllamaVisionParser(),
    new ZaiVisionParser(),
].filter(v => v.enabled)

export default visions
