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
  romaji: z.string().min(1),
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

interface WordEntry {
  word: string;
  romaji: string;
}

function parseWordEntries(section: string): WordEntry[] {
  const normalized = section
    .replace(/、/g, ",")
    .replace(/\r\n/g, "\n");
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const entries: WordEntry[] = [];
  for (const line of lines) {
    const items = line.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const item of items) {
      const match = item.match(/^(.+?)\s*[\(（]([a-zA-Z\s\-']+)[\)）]$/);
      if (match) {
        entries.push({ word: match[1].trim(), romaji: match[2].trim().toLowerCase() });
      }
    }
  }
  return entries;
}

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

【文字数ルール - 読み（発音）でカウント】
- 文字数は「読み方」の音数でカウントする。書いた文字数ではない。
- 例：「東京」→読み「とうきょう」→4音、「無能」→読み「むのう」→3音、「クズ」→読み「くず」→2音
- 拗音（きょ、しゃ等）は1音としてカウント
- 長音（ー）も1音としてカウント

【出力フォーマット - 厳守】各ワードの後ろに半角括弧()でローマ字読みを付けること。全ての文字にローマ字で母音を含めた読みを記載すること。
===4音===
ワード1(romaji),ワード2(romaji),ワード3(romaji),ワード4(romaji),ワード5(romaji),ワード6(romaji),ワード7(romaji),ワード8(romaji),ワード9(romaji),ワード10(romaji)
===3音===
ワード1(romaji),ワード2(romaji),ワード3(romaji),ワード4(romaji),ワード5(romaji),ワード6(romaji),ワード7(romaji),ワード8(romaji),ワード9(romaji),ワード10(romaji)
===2音===
ワード1(romaji),ワード2(romaji),ワード3(romaji),ワード4(romaji),ワード5(romaji),ワード6(romaji),ワード7(romaji),ワード8(romaji),ワード9(romaji),ワード10(romaji)

【例】
===4音===
役立たず(yakutatazu),面の皮(menno kawa),出しゃばり(deshabari)...
===3音===
ゴミ虫(gomimushi),無能(munou),臆病(okubyou)...
===2音===
クズ(kuzu),カス(kasu),ブタ(buta)...`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
      });

      const text = response.text || "";

      const groups: { four: WordEntry[]; three: WordEntry[]; two: WordEntry[] } = {
        four: [],
        three: [],
        two: [],
      };

      const sections = text.split(/===\s*[234]音\s*===/);

      const seen = new Set<string>();
      const dedupeEntries = (entries: WordEntry[]): WordEntry[] => {
        return entries.filter((e) => {
          if (seen.has(e.word)) return false;
          seen.add(e.word);
          return true;
        });
      };

      if (sections.length >= 4) {
        groups.four = dedupeEntries(parseWordEntries(sections[1])).slice(0, 10);
        groups.three = dedupeEntries(parseWordEntries(sections[2])).slice(0, 10);
        groups.two = dedupeEntries(parseWordEntries(sections[3])).slice(0, 10);
      } else {
        const allEntries = dedupeEntries(parseWordEntries(text));
        const countVowels = (r: string) => r.replace(/[^aeiou]/gi, "").length;
        groups.four = allEntries.filter((e) => countVowels(e.romaji) >= 4).slice(0, 10);
        groups.three = allEntries.filter((e) => countVowels(e.romaji) === 3).slice(0, 10);
        groups.two = allEntries.filter((e) => countVowels(e.romaji) <= 2).slice(0, 10);
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
        return res.status(400).json({ error: "ワード、ローマ字、ターゲット、レベルが必要です" });
      }
      const { word, romaji, target, level } = parsed.data;

      const vowels = romaji.replace(/[^aeiou]/gi, "").toLowerCase();

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "放送禁止用語に近い、最も下劣で攻撃的な悪口にすること。";
      } else {
        severityInstruction = `レベル${level}/10に応じた辛辣な悪口にすること。`;
      }

      const prompt = `あなたは日本語ラップの韻（ライム）の専門家です。
以下のワードと「韻を踏んだ」悪口を10個生成してください。

【元ワード】${word}
【ローマ字読み】${romaji}
【母音パターン】${vowels}

【ターゲット情報】
${target}

${severityInstruction}

【韻の定義 - 最重要ルール】
・「韻を踏む」とは、ローマ字にした時の母音の並びが一致することです。
・元ワードの母音パターンは「${vowels}」です。
・生成するワードのローマ字の母音パターンが「${vowels}」に最大限一致するようにしてください。
・母音の一致率が高いワードを優先的に採用すること。完全一致が理想。
・その上で、悪口・汚い言葉・攻撃的な表現を選ぶこと。

【絶対禁止 - 同一語の排除】
・元ワード「${word}」と同じ言葉、同じ意味の言葉は韻を踏んだことにならない。
・表記違い（ひらがな/カタカナ/漢字の変換）も同一語とみなし排除する。
・例：「ヤロウ」と「野郎」は同じ言葉なので禁止。「バカ」と「馬鹿」も禁止。

【出力 - 厳守】
各ワードの後ろに半角括弧()でローマ字読みを付けること。カンマ区切りで10個だけ1行で出力せよ。説明、注釈、前置きは一切書くな。
例：死にかけ(shinikake),腐りかけ(kusarikake),...`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 8192,
          safetySettings,
        },
      });

      const text = response.text || "";
      const entries = parseWordEntries(text);

      const rhymeSeen = new Set<string>();
      rhymeSeen.add(word);
      const filtered = entries.filter((e) => {
        if (rhymeSeen.has(e.word)) return false;
        rhymeSeen.add(e.word);
        return true;
      }).slice(0, 10);

      res.json({ words: filtered });
    } catch (error) {
      console.error("Rhyme generation error:", error);
      res.status(500).json({ error: "韻生成に失敗しました" });
    }
  });

  return httpServer;
}
