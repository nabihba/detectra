import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });
const testImagePath = "c:/Users/nabih/OneDrive/Desktop/ai_test/dataset/test/FAKE/0 (2).jpg";
const imageBytes = fs.readFileSync(testImagePath);
const base64 = imageBytes.toString("base64");

const models = ["gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-001"];

for (const model of models) {
  try {
    console.log(`Testing ${model}...`);
    const r = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64 } },
            { text: 'Is this AI-generated? Respond ONLY with JSON: {"verdict":"FAKE","confidence":0.9,"analysis":"reason"}' },
          ],
        },
      ],
    });
    console.log(`✅ ${model} works! Response:`, r.text);
    break; // Stop at first success
  } catch (err) {
    console.log(`❌ ${model}: ${err.message.substring(0, 100)}`);
  }
}
