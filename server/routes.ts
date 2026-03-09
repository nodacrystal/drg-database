import type { Express } from "express";
import { createServer, type Server } from "http";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { z } from "zod";
import {
  getAllWords,
  getWordCount,
  getWordStrings,
  addWords,
  deleteWord,
  clearAllWords,
  exportWords,
} from "./storage";

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

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
];

interface WordEntry {
  word: string;
  reading: string;
  romaji: string;
}

function extractVowels(romaji: string): string {
  return romaji.replace(/[^aeiou]/gi, "").toLowerCase();
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
      const match = item.match(/^(.+?)\s*[\/／]\s*([ぁ-ゟ]+)\s*[\(（]([a-zA-Z\s\-']+)[\)）]$/);
      if (match) {
        entries.push({
          word: match[1].trim(),
          reading: match[2].trim(),
          romaji: match[3].trim().toLowerCase(),
        });
      }
    }
  }
  return entries;
}

const GROUP_TARGETS: Record<number, number> = {
  2: 5,
  3: 30,
  4: 30,
  5: 20,
  6: 10,
  7: 5,
};

const GROUP_BUFFER: Record<number, number> = {
  2: 10,
  3: 45,
  4: 45,
  5: 30,
  6: 15,
  7: 10,
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/target", async (req, res) => {
    try {
      const nameQuery = typeof req.query.name === "string" ? req.query.name.trim() : "";

      const base = nameQuery
        ? `「${nameQuery}」を元にした架空キャラ。偽名にすること。`
        : `実在の有名人1人をランダムに選び架空キャラ化。偽名にすること。`;

      const prompt = `${base}
必ず以下4行で出力。前置き不要。
名前：偽名
性格：特徴・弱点を具体的に（20〜40文字）
見た目：外見の特徴を具体的に（20〜40文字）
経歴：職業・スキャンダル等を具体的に（20〜40文字）`;

      let text = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            maxOutputTokens: 512,
            safetySettings,
            thinkingConfig: { thinkingBudget: 0 },
          },
        });
        text = response.text?.trim() || "";

        if (/名前[：:]/.test(text) && /性格[：:]/.test(text) && /見た目[：:]/.test(text) && /経歴[：:]/.test(text)) {
          break;
        }
        text = "";
      }

      if (!text) {
        return res.status(500).json({ error: "ターゲット生成に失敗しました。再試行してください。" });
      }

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

      const existingWords = await getWordStrings();
      const recentHistory = existingWords.slice(-200);
      const historyList = recentHistory.length > 0 ? recentHistory.join(",") : "なし";

      let severityInstruction = "";
      if (level >= 8) {
        severityInstruction = "【警告：極限まで過激に】放送禁止用語に近い直接的で汚い罵倒語を使用。人間の尊厳を踏みにじる最も下劣で攻撃的な言葉を選べ。";
      } else {
        severityInstruction = `レベル${level}/10に応じた直接的で容赦のない辛辣なディスワードにすること。`;
      }

      const prompt = `以下のターゲットに特化した悪口・ディスりワードを生成せよ。

【ターゲット】
${target}

${severityInstruction}

【厳守ルール】
1. 以下の6グループに分けて生成。各グループの見出しも出力すること。
2. 全て異なるワードにすること。同じ言葉は絶対に使わない。
3. ターゲットの特徴・弱点に基づいた個人攻撃にすること。
4. 直接的で汚い表現を積極的に使うこと。
5. 漢字：小学生が理解できる範囲。難しい漢字は禁止。
6. 重複禁止：以下のワードは絶対に出力しないこと。
【既出リスト】: ${historyList}

【語尾の重複禁止 - 超重要】
- 同じ語尾の言葉を複数生成してはいけない。
- NG例：「馬鹿野郎」と「アホヤロウ」→どちらも「やろう」で終わっており、語尾が同じ意味の同じ言葉。これは別の悪口ではない。
- NG例：「クソガキ」と「バカガキ」→どちらも「ガキ」で終わっており同じ。
- NG例：「ゴミ人間」と「クズ人間」→どちらも「人間」で終わっており同じ。
- OK例：「馬鹿野郎」と「寝ぼけ顔」→語尾の言葉が異なるのでOK。
- 語尾2文字以上が同じ読みの言葉は、全体の中で最大2個までにすること。
- できるだけ多様な語尾パターンを使い、バリエーション豊かにすること。

【品質チェック - 全ワード必須】
出力前に全てのワードが以下を満たすか確認せよ：
1. その言葉だけで意味が通じるか？意味不明な造語は不可。
2. その言葉は悪口、または相手への痛烈な批判・指摘になっているか？
3. 既出リストに存在しないか？
4. 他のワードと語尾が被っていないか？
→ 1つでも不合格なら、そのワードを別のワードに差し替えること。

【文字数ルール - 超重要・厳守】
- 文字数は「全てひらがなに変換したときの文字数」でカウントする。
- 拗音（しゃ、きょ等の小さい文字）も1文字。促音（っ）も1文字。撥音（ん）も1文字。
- 具体例：
  2文字：クズ→くず、カス→かす、ゴミ→ごみ
  3文字：ダサい→ださい、無能→むのう、ヘタレ→へたれ
  4文字：うそつき→うそつき、ゴミクズ→ごみくず
  5文字：できそこない→できそこない、はらぐろい→はらぐろい
  6文字：おちぶれやろう→おちぶれやろう
  7文字：のうたりんやろう→のうたりんやろう
- 必ず出力前にひらがなに変換して文字数を指折り確認すること！

【出力フォーマット - 厳守】
各ワードは「ワード/ひらがな読み(romaji)」形式。スラッシュの後にひらがな読み、括弧内にローマ字（全ての文字に母音を含めた読み）。
===2文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[2]}個 ※目標${GROUP_TARGETS[2]}個)
===3文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[3]}個 ※目標${GROUP_TARGETS[3]}個)
===4文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[4]}個 ※目標${GROUP_TARGETS[4]}個)
===5文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[5]}個 ※目標${GROUP_TARGETS[5]}個)
===6文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[6]}個 ※目標${GROUP_TARGETS[6]}個)
===7文字===
ワード/ひらがな(romaji),...(${GROUP_BUFFER[7]}個 ※目標${GROUP_TARGETS[7]}個)

【例】
===2文字===
クズ/くず(kuzu),カス/かす(kasu),ブタ/ぶた(buta)...
===3文字===
ダサい/ださい(dasai),無能/むのう(munou),ヘタレ/へたれ(hetare)...
===4文字===
嘘つき/うそつき(usotsuki),ゴミクズ/ごみくず(gomikuzu)...`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          maxOutputTokens: 16384,
          safetySettings,
        },
      });

      const text = response.text || "";

      const groups: Record<string, WordEntry[]> = {
        seven: [],
        six: [],
        five: [],
        four: [],
        three: [],
        two: [],
      };

      const charCountToKey: Record<number, string> = {
        7: "seven",
        6: "six",
        5: "five",
        4: "four",
        3: "three",
        2: "two",
      };

      const seen = new Set<string>(existingWords);
      const allEntries = parseWordEntries(text);

      const suffixCounts: Record<string, number> = {};

      for (const entry of allEntries) {
        if (seen.has(entry.word)) continue;
        seen.add(entry.word);

        const reading = entry.reading;
        let skipDueSuffix = false;
        for (let sLen = 2; sLen <= Math.min(reading.length - 1, 4); sLen++) {
          const readingSuffix = reading.slice(-sLen);
          const key2 = `${sLen}:${readingSuffix}`;
          const count = suffixCounts[key2] || 0;
          if (count >= 2) {
            skipDueSuffix = true;
            break;
          }
        }
        if (skipDueSuffix) continue;

        const charCount = entry.reading.length;
        const key = charCountToKey[charCount];
        const target = GROUP_TARGETS[charCount];

        if (key && target && groups[key].length < target) {
          groups[key].push(entry);
          for (let sLen = 2; sLen <= Math.min(reading.length - 1, 4); sLen++) {
            const readingSuffix = reading.slice(-sLen);
            const key2 = `${sLen}:${readingSuffix}`;
            suffixCounts[key2] = (suffixCounts[key2] || 0) + 1;
          }
        }
      }

      res.json({ groups });
    } catch (error) {
      console.error("Diss generation error:", error);
      res.status(500).json({ error: "ワード生成に失敗しました" });
    }
  });

  app.get("/api/favorites", async (_req, res) => {
    try {
      const allWords = await getAllWords();

      type WordItem = {
        id: number;
        word: string;
        reading: string;
        romaji: string;
        vowels: string;
        charCount: number;
      };

      const items: WordItem[] = allWords.map((w) => ({
        id: w.id,
        word: w.word,
        reading: w.reading,
        romaji: w.romaji,
        vowels: w.vowels,
        charCount: w.charCount,
      }));

      function getSuffixVowels(vowels: string, len: number): string {
        return vowels.slice(-len);
      }

      const grouped: Record<string, WordItem[]> = {};
      const assigned = new Set<number>();

      function getReadingSuffix(reading: string, len: number): string {
        return reading.slice(-len);
      }

      function filterSameReadingSuffix(words: WordItem[]): WordItem[] {
        if (words.length < 2) return words;
        const readingSuffixCounts: Record<string, number> = {};
        const result: WordItem[] = [];
        for (const w of words) {
          const minSuffix = Math.min(2, w.reading.length);
          const rSuffix = w.reading.slice(-minSuffix);
          const count = readingSuffixCounts[rSuffix] || 0;
          if (count < 2) {
            readingSuffixCounts[rSuffix] = count + 1;
            result.push(w);
          }
        }
        return result;
      }

      for (let suffixLen = 5; suffixLen >= 2; suffixLen--) {
        const buckets: Record<string, WordItem[]> = {};
        for (const item of items) {
          if (assigned.has(item.id)) continue;
          if (item.vowels.length < suffixLen) continue;
          const suffix = getSuffixVowels(item.vowels, suffixLen);
          if (!buckets[suffix]) buckets[suffix] = [];
          buckets[suffix].push(item);
        }
        for (const [suffix, words] of Object.entries(buckets)) {
          const filtered = filterSameReadingSuffix(words);
          if (filtered.length >= 2) {
            const key = `*${suffix}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(...filtered);
            for (const w of filtered) assigned.add(w.id);
          }
        }
      }

      for (const item of items) {
        if (assigned.has(item.id)) continue;
        const suffix = item.vowels.length >= 1 ? `*${item.vowels.slice(-1)}` : "*";
        if (!grouped[suffix]) grouped[suffix] = [];
        grouped[suffix].push(item);
        assigned.add(item.id);
      }

      const sortedGroups = Object.entries(grouped)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([vowels, words]) => ({ vowels, words }));

      res.json({ groups: sortedGroups, total: allWords.length });
    } catch (error) {
      console.error("Favorites fetch error:", error);
      res.status(500).json({ error: "お気に入りの取得に失敗しました" });
    }
  });

  app.post("/api/favorites", async (req, res) => {
    try {
      const schema = z.object({
        words: z.array(z.object({
          word: z.string().min(1),
          reading: z.string().min(1),
          romaji: z.string().min(1),
        })),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "不正なデータです" });
      }

      const entries = parsed.data.words.map((w) => ({
        word: w.word,
        reading: w.reading,
        romaji: w.romaji,
        vowels: extractVowels(w.romaji),
        charCount: w.reading.length,
      }));

      const added = await addWords(entries);
      const total = await getWordCount();
      res.json({ added, total });
    } catch (error) {
      console.error("Favorites add error:", error);
      res.status(500).json({ error: "お気に入りの追加に失敗しました" });
    }
  });

  app.delete("/api/favorites/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "不正なIDです" });
      await deleteWord(id);
      const total = await getWordCount();
      res.json({ success: true, total });
    } catch (error) {
      console.error("Favorites delete error:", error);
      res.status(500).json({ error: "削除に失敗しました" });
    }
  });

  app.delete("/api/favorites", async (_req, res) => {
    try {
      await clearAllWords();
      res.json({ success: true, total: 0 });
    } catch (error) {
      console.error("Favorites clear error:", error);
      res.status(500).json({ error: "全削除に失敗しました" });
    }
  });

  app.get("/api/favorites/count", async (_req, res) => {
    try {
      const total = await getWordCount();
      res.json({ total });
    } catch (error) {
      res.status(500).json({ error: "カウント取得に失敗しました" });
    }
  });

  app.get("/api/favorites/export", async (_req, res) => {
    try {
      const data = await exportWords();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(data);
    } catch (error) {
      res.status(500).json({ error: "エクスポートに失敗しました" });
    }
  });

  return httpServer;
}
