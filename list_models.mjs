import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pager = await ai.models.list();
for (const model of pager.page) {
  if (model.supportedActions?.includes('generateContent')) {
    console.log(model.name);
  }
}
