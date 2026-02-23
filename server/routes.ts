import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
  history: z.array(z.string()).optional().default([]),
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
      const { target, level, history } = parsed.data;

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "【警告：極限まで過激に】18歳以上向けの、放送禁止用語に近い直接的で汚い罵倒語を使用してください。上品さは一切不要です。人間の尊厳を徹底的に踏みにじる、最も下劣で攻撃的な言葉を選んでください。";
      } else {
        severityInstruction = `レベル${level}/10に応じた、非常に直接的で容赦のない辛辣なダメ出しにしてください。`;
      }

      const historyList = history.length > 0 ? history.join(",") : "なし";

      const prompt = `ターゲット: ${target}
${severityInstruction}

【厳守ルール】
1. 悪口を30個、カンマ区切りで生成。
2. 文字数：ひらがな換算で「4文字以上、8文字以内」。
3. 性格：曖昧（あいまい）な表現は避け、「底辺」「クズ」等の直接的で汚い表現を積極的に使うこと。
4. 漢字：小学生が理解できる範囲。難しい漢字は禁止。
5. 重複禁止：以下の【既出リスト】にあるワードは、過去に生成済みのため「絶対に」出力しないでください。
【既出リスト】: ${historyList}`;

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
