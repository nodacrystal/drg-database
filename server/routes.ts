import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
  favorites: z.array(z.string()).optional().default([]),
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
      const { target, level, favorites } = parsed.data;

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "【最重要】18歳以上向けの極めて冷酷な罵倒語にしてください。人格や存在を根底から否定する鋭い単語を選んでください。";
      } else {
        severityInstruction = `レベル${level}/10に応じた強さのダメ出しにしてください。`;
      }

      const excludeList = favorites.length > 0 ? favorites.join(",") : "なし";

      const prompt = `ターゲット: ${target}

${severityInstruction}

【厳守ルール】
1. 悪口・ダメ出しワードを合計30個、カンマ区切りで生成してください。
2. 文字数制限：ひらがなにした際、各ワード「4文字以上、8文字以内」に必ず収めてください。
3. 内容：抽象的な悪口ではなく「役立たず」「口だけ野郎」のような、相手の欠点を突く「明確なダメ出し」にしてください。
4. 使用文字：難しい漢字は一切禁止。小学生が習う漢字、または、ひらがな・カタカナのみを使用してください。
5. 重複禁止：以下のリストに含まれる単語は、お気に入り登録済みのため「絶対に」出力しないでください：
   リスト：${excludeList}
6. 一般性：専門用語や造語は禁止。誰もが意味を理解できる一般的な単語の組み合わせにしてください。
7. 形式：出力はカンマ区切りの単語リストのみ。解説や前置きは不要です。`;

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
