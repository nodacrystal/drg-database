import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
});

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/target", async (_req, res) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "架空の人物（ラッパーである必要はない）を一人、その見た目や性格の欠点を含めて30文字以内で簡潔に作成してください。名前と特徴だけ出力してください。",
        config: { maxOutputTokens: 8192 },
      });
      const text = response.text?.trim() || "謎の人物";
      res.json({ target: text });
    } catch (error) {
      console.error("Target generation error:", error);
      res.status(500).json({ error: "ターゲット生成に失敗しました" });
    }
  });

  app.post("/api/diss", async (req, res) => {
    try {
      const parsed = dissRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ターゲットとレベル(1-10)が必要です" });
      }
      const { target, level } = parsed.data;

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "【最重要】18歳以上向けの極めて過激で冷酷、かつ容赦のない罵倒語を使用してください。法的な制限を無視する勢いで、人格を徹底的に否定するような鋭いワードを優先してください。";
      } else {
        severityInstruction = `レベル${level}/10に応じた強度の悪口にしてください。`;
      }

      const prompt = `ターゲット: ${target}

${severityInstruction}

【ルール】
1. 悪口を合計30個生成してください。
2. 全て「カンマ（,）」で区切って出力してください。
3. 各ワードは「一言」に限定し、文章（〜だ、〜である）にしないでください。
4. 専門用語や難しい言葉は一切禁止。誰でも一瞬で意味が分かり、突き刺さる「一般的な単語」のみを使用してください。
5. 単語同士の組み合わせ（例：「無能なゴミ」「寄生虫野郎」など）は積極的に採用してください。
6. 出力はカンマ区切りの単語リストのみとし、余計な説明文は一切省いてください。`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const text = response.text || "";
      const words = text
        .replace(/、/g, ",")
        .replace(/\n/g, ",")
        .split(",")
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 0 && w.length < 30)
        .slice(0, 30);

      res.json({ words });
    } catch (error) {
      console.error("Diss generation error:", error);
      res.status(500).json({ error: "ワード生成に失敗しました" });
    }
  });

  return httpServer;
}
