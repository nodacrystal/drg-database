import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
});

const rhymeRequestSchema = z.object({
  word: z.string().min(1),
  level: z.number().int().min(1).max(10),
});

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const KANA_MAP: Record<string, string> = {
  'あ':'1','い':'2','う':'3','え':'4','お':'5','か':'1','き':'2','く':'3','け':'4','こ':'5',
  'さ':'1','し':'2','す':'3','せ':'4','そ':'5','た':'1','ち':'2','つ':'3','て':'4','と':'5',
  'な':'1','に':'2','ぬ':'3','ね':'4','の':'5','は':'1','ひ':'2','ふ':'3','へ':'4','ほ':'5',
  'ま':'1','み':'2','む':'3','め':'4','も':'5','や':'1','ゆ':'3','よ':'5','ら':'1','り':'2',
  'る':'3','れ':'4','ろ':'5','わ':'1','を':'5','ん':'6','ー':'7','っ':'8','が':'1','ぎ':'2',
  'ぐ':'3','げ':'4','ご':'5','ざ':'1','じ':'2','ず':'3','ぜ':'4','ぞ':'5','だ':'1','ぢ':'2',
  'づ':'3','で':'4','ど':'5','ば':'1','び':'2','ぶ':'3','べ':'4','ぼ':'5','ぱ':'1','ぴ':'2',
  'ぷ':'3','ぺ':'4','ぽ':'5','ゃ':'1','ゅ':'3','ょ':'5',
  'ア':'1','イ':'2','ウ':'3','エ':'4','オ':'5','カ':'1','キ':'2','ク':'3','ケ':'4','コ':'5',
  'サ':'1','シ':'2','ス':'3','セ':'4','ソ':'5','タ':'1','チ':'2','ツ':'3','テ':'4','ト':'5',
  'ナ':'1','ニ':'2','ヌ':'3','ネ':'4','ノ':'5','ハ':'1','ヒ':'2','フ':'3','ヘ':'4','ホ':'5',
  'マ':'1','ミ':'2','ム':'3','メ':'4','モ':'5','ヤ':'1','ユ':'3','ヨ':'5','ラ':'1','リ':'2',
  'ル':'3','レ':'4','ロ':'5','ワ':'1','ヲ':'5','ン':'6','ガ':'1','ギ':'2',
  'グ':'3','ゲ':'4','ゴ':'5','ザ':'1','ジ':'2','ズ':'3','ゼ':'4','ゾ':'5','ダ':'1','ヂ':'2',
  'ヅ':'3','デ':'4','ド':'5','バ':'1','ビ':'2','ブ':'3','ベ':'4','ボ':'5','パ':'1','ピ':'2',
  'プ':'3','ペ':'4','ポ':'5','ャ':'1','ュ':'3','ョ':'5',
};

function toVowelNumbers(text: string): string {
  let res = "";
  for (const char of text) {
    if (KANA_MAP[char]) {
      res += KANA_MAP[char];
    }
  }
  return res;
}

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

      const prompt = `ターゲット: ${target}\nレベル: ${level}/10\nこの人物に対する一言の悪口（名詞、または短いフレーズ）を20個、カンマ区切りで作成してください。文章にせず、「バカ丸出し」のような単純な言葉を使ってください。レベルが高いほど酷い内容にしてください。カンマ区切りの言葉だけを出力し、番号や説明は不要です。`;

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
        .slice(0, 20);

      res.json({ words });
    } catch (error) {
      console.error("Diss generation error:", error);
      res.status(500).json({ error: "ワード生成に失敗しました" });
    }
  });

  app.post("/api/rhyme", async (req, res) => {
    try {
      const parsed = rhymeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ワードとレベル(1-10)が必要です" });
      }
      const { word, level } = parsed.data;

      const prompt = `「${word}」と韻を踏める悪口や皮肉を15個、カンマ区切りで挙げてください。条件：一言の短いフレーズ、母音が似ていること。「${word}」自体は含めないでください。番号や説明は不要です。`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const text = response.text || "";
      const candidates = text
        .replace(/、/g, ",")
        .replace(/\n/g, ",")
        .split(",")
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 0 && w.length < 30);

      const targetVowels = toVowelNumbers(word).slice(-3);
      const validRhymes: string[] = [];
      const allCandidates = candidates.filter((c: string) => c !== word);

      for (const cand of allCandidates) {
        const candVowels = toVowelNumbers(cand);
        if (candVowels.length >= 3 && candVowels.slice(-3) === targetVowels) {
          const lastTwo = word.slice(-2);
          if (!cand.includes(lastTwo)) {
            validRhymes.push(cand);
          }
        }
        if (validRhymes.length >= 10) break;
      }

      const results = validRhymes.length > 0 ? validRhymes : allCandidates.slice(0, 10);
      res.json({ rhymes: results.length > 0 ? results : ["韻を踏むワードが見つかりませんでした。もう一度試してください"] });
    } catch (error) {
      console.error("Rhyme generation error:", error);
      res.status(500).json({ error: "韻の生成に失敗しました" });
    }
  });

  return httpServer;
}
