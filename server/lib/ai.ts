import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

// --- Gemini（ワード生成用） ---
export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

export const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

export const geminiConfig = { maxOutputTokens: 8192, safetySettings, thinkingConfig: { thinkingBudget: 0 } };

export async function aiGenerate(contents: string, config?: any, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: config || geminiConfig,
      });
    } catch (err: any) {
      if (err?.status === 429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000 + Math.random() * 1000;
        console.log(`[RATE_LIMIT] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// --- Claude Sonnet 4.6（ルール適用・整理・分類用） ---
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function claudeGenerate(contents: string, config?: { maxOutputTokens?: number }, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6-20250514",
        max_tokens: config?.maxOutputTokens || 8192,
        messages: [{ role: "user", content: contents }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      return { text };
    } catch (err: any) {
      if (err?.status === 429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000 + Math.random() * 1000;
        console.log(`[CLAUDE_RATE_LIMIT] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
