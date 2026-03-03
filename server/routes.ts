import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
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

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/target", async (_req, res) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `あなたは架空のキャラクター生成AIです。
以下のルールに従って、実在する有名人（タレント、政治家、インフルエンサー、YouTuber、歌手、俳優、お笑い芸人など）を一人ランダムに選び、その人物を元にした架空キャラクターを生成してください。

【ルール】
1. 名前：元の有名人の名前を少しだけもじった偽名にすること（例：松本人志→松元仁志、ヒカキン→ピカキンなど）
2. 元ネタ：誰がモデルかわかる程度に特徴を残すこと
3. プロフィール：以下の情報を含めること
   - 職業・肩書き
   - 見た目の特徴（体型、顔立ち、服装など）
   - 性格の特徴（長所と短所）
   - 世間からの評判やイメージ
   - 過去のスキャンダルや問題行動（元ネタの人物の実際の話をベースに脚色）
4. 出力フォーマット：
   名前：〇〇〇〇
   職業：〇〇
   見た目：〇〇
   性格：〇〇
   評判：〇〇
   黒歴史：〇〇

必ず上記フォーマットで出力してください。余計な前置きや説明は不要です。`,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
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
        severityInstruction = "【警告：極限まで過激に】18歳以上向けの、放送禁止用語に近い直接的で汚い罵倒語を使用してください。上品さは一切不要です。人間の尊厳を徹底的に踏みにじる、最も下劣で攻撃的な言葉を選んでください。このキャラの弱点・欠点・スキャンダルを最大限えぐる言葉にすること。";
      } else {
        severityInstruction = `レベル${level}/10に応じた、非常に直接的で容赦のない辛辣なダメ出しにしてください。このキャラの弱点・欠点をピンポイントで突く言葉にすること。`;
      }

      const historyList = history.length > 0 ? history.join(",") : "なし";

      const prompt = `以下のターゲットのプロフィールを読み、この人物に特化した悪口・ディスりワードを生成してください。

【ターゲット情報】
${target}

${severityInstruction}

【厳守ルール】
1. 悪口を30個、カンマ区切りで生成。余計な説明は不要、ワードのみ出力。
2. 文字数：ひらがな換算で「4文字以上、8文字以内」。
3. 内容：このターゲットの見た目・性格・評判・黒歴史に基づいた、相手が最も傷つく個人攻撃にすること。一般的すぎる悪口（バカ、アホ等）ではなく、この人物だからこそ刺さる言葉を選ぶこと。
4. 表現：曖昧な表現は避け、「底辺」「クズ」「ゴミ」等の直接的で汚い表現を積極的に使うこと。
5. 漢字：小学生が理解できる範囲。難しい漢字は禁止。
6. 重複禁止：以下の【既出リスト】にあるワードは、過去に生成済みのため「絶対に」出力しないでください。
【既出リスト】: ${historyList}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
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
