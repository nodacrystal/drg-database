import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { z } from "zod";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
  history: z.array(z.string()).optional().default([]),
});

const rhymeRequestSchema = z.object({
  word: z.string().min(1),
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

  app.get("/api/target", async (req, res) => {
    try {
      const nameQuery = typeof req.query.name === "string" ? req.query.name.trim() : "";

      let prompt: string;
      if (nameQuery) {
        prompt = `あなたは架空のキャラクター生成AIです。
ユーザーが「${nameQuery}」という名前を入力しました。
この名前に該当する実在の有名人・著名人を特定し、その人物を元にした架空キャラクターを生成してください。

【ルール】
1. 名前：「${nameQuery}」の名前を少しだけもじった偽名にすること（例：松本人志→松元仁志、ヒカキン→ピカキンなど）
2. 元ネタ：「${nameQuery}」の実際の情報をできるだけ正確に反映すること
3. プロフィール：以下の情報を含めること。知っている情報はできるだけ正確に、わからない情報は架空で補完すること。
   - 職業・肩書き
   - 見た目の特徴（体型、顔立ち、服装など）
   - 性格の特徴（長所と短所）
   - 世間からの評判やイメージ
   - 過去のスキャンダルや問題行動（実際の話をベースに脚色。見つからなければ架空で作成）
4. 出力フォーマット：
   名前：〇〇〇〇
   職業：〇〇
   見た目：〇〇
   性格：〇〇
   評判：〇〇
   黒歴史：〇〇

必ず上記フォーマットで出力してください。余計な前置きや説明は不要です。`;
      } else {
        prompt = `あなたは架空のキャラクター生成AIです。
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

必ず上記フォーマットで出力してください。余計な前置きや説明は不要です。`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
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

【厳守ルール - 必ず守ること】
1. 以下の3グループに分けて生成すること。各グループの見出しも出力すること。
2. 30個すべて異なるワードにすること。同じ言葉は絶対に使わない。
3. 内容：このターゲットの見た目・性格・評判・黒歴史に基づいた、相手が最も傷つく個人攻撃にすること。
4. 表現：曖昧な表現は避け、直接的で汚い表現を積極的に使うこと。
5. 漢字：小学生が理解できる範囲。難しい漢字は禁止。
6. 重複禁止：以下の【既出リスト】にあるワードは絶対に出力しないこと。
【既出リスト】: ${historyList}

【出力フォーマット】必ずこの形式で出力してください：
===4文字===
ワード1,ワード2,ワード3,ワード4,ワード5,ワード6,ワード7,ワード8,ワード9,ワード10
===3文字===
ワード1,ワード2,ワード3,ワード4,ワード5,ワード6,ワード7,ワード8,ワード9,ワード10
===2文字===
ワード1,ワード2,ワード3,ワード4,ワード5,ワード6,ワード7,ワード8,ワード9,ワード10

【文字数の数え方】
- ひらがな・カタカナ・漢字はすべて1文字としてカウント
- 例：「クズ」=2文字、「役立たず」=4文字、「デブ」=2文字、「ゴミ虫」=3文字
- 各グループの文字数を厳密に守ること`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
      });

      const text = response.text || "";

      const groups: { four: string[]; three: string[]; two: string[] } = {
        four: [],
        three: [],
        two: [],
      };

      const sections = text.split(/===\s*[234]文字\s*===/);

      const parseWords = (section: string): string[] => {
        return section
          .replace(/、/g, ",")
          .replace(/\n/g, ",")
          .split(",")
          .map((w) => w.trim())
          .filter((w) => w.length > 0 && w.length < 20);
      };

      const seen = new Set<string>();
      const dedupeFilter = (words: string[]): string[] => {
        return words.filter((w) => {
          if (seen.has(w)) return false;
          seen.add(w);
          return true;
        });
      };

      if (sections.length >= 4) {
        groups.four = dedupeFilter(parseWords(sections[1])).slice(0, 10);
        groups.three = dedupeFilter(parseWords(sections[2])).slice(0, 10);
        groups.two = dedupeFilter(parseWords(sections[3])).slice(0, 10);
      } else {
        const allWords = dedupeFilter(parseWords(text));
        groups.four = allWords.filter((w) => w.length === 4).slice(0, 10);
        groups.three = allWords.filter((w) => w.length === 3).slice(0, 10);
        groups.two = allWords.filter((w) => w.length === 2).slice(0, 10);
      }

      res.json({ groups });
    } catch (error) {
      console.error("Diss generation error:", error);
      res.status(500).json({ error: "ワード生成に失敗しました" });
    }
  });

  app.post("/api/rhyme", async (req, res) => {
    try {
      const parsed = rhymeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ワード、ターゲット、レベルが必要です" });
      }
      const { word, target, level } = parsed.data;

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "放送禁止用語に近い、最も下劣で攻撃的な悪口にすること。";
      } else {
        severityInstruction = `レベル${level}/10に応じた辛辣な悪口にすること。`;
      }

      const prompt = `あなたは日本語ラップの韻（ライム）の専門家です。
以下のワードと「韻を踏んだ」悪口を10個生成してください。

【元ワード】${word}

【ターゲット情報】
${target}

${severityInstruction}

【韻の定義 - 最重要ルール】
・「韻を踏む」とは、母音の並びが一致することです。
・まず「${word}」をひらがなに変換し、各文字の母音を抽出してください。
・生成するワードもその母音の並びに一致させてください。
・母音の一致率は高いほど良い。完全一致が理想。最低でも半分以上の母音が一致すること。
・文字数は元ワード「${word}」と同じ文字数にすること。

【絶対禁止 - 同一語の排除】
・元ワード「${word}」と同じ言葉、同じ意味の言葉は韻を踏んだことにならない。
・表記違い（ひらがな/カタカナ/漢字の変換）も同一語とみなし排除する。
・例：「ヤロウ」と「野郎」は同じ言葉なので禁止。「バカ」と「馬鹿」も禁止。

【出力 - 厳守】
カンマ区切りで10個のワードだけを1行で出力せよ。説明、注釈、前置き、思考プロセスは一切書くな。`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
      });

      const text = response.text || "";
      const rhymeSeen = new Set<string>();
      rhymeSeen.add(word);
      const words = text
        .replace(/、/g, ",")
        .replace(/\n/g, ",")
        .split(",")
        .map((w: string) => w.trim())
        .filter((w: string) => {
          if (w.length === 0 || w.length >= 20) return false;
          if (rhymeSeen.has(w)) return false;
          rhymeSeen.add(w);
          return true;
        })
        .slice(0, 10);

      res.json({ words });
    } catch (error) {
      console.error("Rhyme generation error:", error);
      res.status(500).json({ error: "韻生成に失敗しました" });
    }
  });

  return httpServer;
}
