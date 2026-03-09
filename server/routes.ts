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
  getAllNgWords,
  getNgWordStrings,
  addNgWords,
  getNgWordCount,
  clearNgWords,
} from "./storage";
import { TARGETS } from "./targets";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(10),
});

const wordArraySchema = z.object({
  words: z.array(z.object({
    word: z.string().min(1),
    reading: z.string().min(1),
    romaji: z.string().min(1),
  })),
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

const geminiConfig = { maxOutputTokens: 8192, safetySettings, thinkingConfig: { thinkingBudget: 0 } };

interface WordEntry {
  word: string;
  reading: string;
  romaji: string;
}

function extractVowels(romaji: string): string {
  return romaji.replace(/[^aeiou]/gi, "").toLowerCase();
}

function parseWordEntries(section: string): WordEntry[] {
  const lines = section.replace(/、/g, ",").replace(/\r\n/g, "\n").split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const entries: WordEntry[] = [];
  for (const line of lines) {
    for (const item of line.split(",").map(s => s.trim()).filter(s => s.length > 0)) {
      const match = item.match(/^(.+?)\s*[\/／]\s*([ぁ-ゟ]+)\s*[\(（]([a-zA-Z\s\-']+)[\)）]$/);
      if (match) {
        entries.push({ word: match[1].trim(), reading: match[2].trim(), romaji: match[3].trim().toLowerCase() });
      }
    }
  }
  return entries;
}

const GROUP_TARGETS: Record<number, number> = { 2: 5, 3: 30, 4: 30, 5: 20, 6: 10, 7: 5 };
const GROUP_BUFFER: Record<number, number> = { 2: 10, 3: 45, 4: 45, 5: 30, 6: 15, 7: 10 };
const CHAR_TO_KEY: Record<number, string> = { 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two" };

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  app.get("/api/target", (_req, res) => {
    const entry = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    const parts = entry.split(",");
    res.json({ target: `名前：${parts[0]}\n見た目：${parts[1] || ""}\n性格：${parts[3] || parts[2] || ""}` });
  });

  app.post("/api/diss", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;

    req.on("close", () => {
      disconnected = true;
      if (heartbeat) clearInterval(heartbeat);
    });

    try {
      const parsed = dissRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "ターゲットとレベル(1-10)が必要です" });
      const { target, level } = parsed.data;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const startTime = Date.now();
      let currentStep = "";

      function send(step: string, detail: string) {
        if (disconnected) return;
        currentStep = step;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
      }

      heartbeat = setInterval(() => {
        if (disconnected) { if (heartbeat) clearInterval(heartbeat); return; }
        res.write(`data: ${JSON.stringify({ type: "progress", step: currentStep, detail: `処理継続中...`, elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
      }, 5000);

      send("init", "準備中...");

      const targetName = target.split("\n")[0]?.replace("名前：", "").trim() || "";

      const [existingWords, ngWordList, researchResult] = await Promise.all([
        getWordStrings(),
        getNgWordStrings(),
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `「${targetName}」（日本のお笑い芸人）について簡潔に箇条書き。前置き不要。
1. 代表的ギャグ・決めゼリフ 2. よく弄られるポイント 3. 有名なスキャンダル・失敗談
4. 身体的特徴 5. 性格的弱点 6. ネット上の悪口・あだ名 7. 他芸人からのイジり方
各3-5個。`,
          config: geminiConfig,
        }).then(r => r.text || "").catch(() => ""),
      ]);

      const historyList = existingWords.length > 0 ? existingWords.slice(-200).join(",") : "なし";
      const ngList = ngWordList.slice(-100).join(",");
      const severity = level >= 8
        ? "【極限まで過激に】放送禁止用語レベルの直接的で汚い罵倒語を使用せよ。"
        : `レベル${level}/10の辛辣なディスワード。`;
      const ngSection = ngList ? `\n【NGワード - 避けよ】\n${ngList}\n` : "";
      const research = researchResult ? `\n【リサーチ情報】\n${researchResult}\n` : "";

      send("init", `準備完了 (${formatElapsed(Date.now() - startTime)})`);

      const groups: Record<string, WordEntry[]> = { seven: [], six: [], five: [], four: [], three: [], two: [] };
      const seen = new Set<string>([...existingWords, ...ngWordList]);
      const suffixCounts: Record<string, number> = {};

      function addEntries(entries: WordEntry[]) {
        for (const e of entries) {
          if (seen.has(e.word)) continue;
          seen.add(e.word);
          let skip = false;
          for (let s = 2; s <= Math.min(e.reading.length - 1, 4); s++) {
            if ((suffixCounts[`${s}:${e.reading.slice(-s)}`] || 0) >= 2) { skip = true; break; }
          }
          if (skip) continue;
          const key = CHAR_TO_KEY[e.reading.length];
          const tgt = GROUP_TARGETS[e.reading.length];
          if (key && tgt && groups[key].length < tgt) {
            groups[key].push(e);
            for (let s = 2; s <= Math.min(e.reading.length - 1, 4); s++) {
              const k = `${s}:${e.reading.slice(-s)}`;
              suffixCounts[k] = (suffixCounts[k] || 0) + 1;
            }
          }
        }
      }

      function total() { return Object.values(groups).reduce((s, g) => s + g.length, 0); }

      const rules = `【厳守ルール】
全て異なるワード。ターゲット特化の個人攻撃。漢字は小学生レベル。意味の通じる悪口のみ。造語不可。一般形容詞不可。
語尾2文字以上同じ読みは最大2個まで。多様な語尾パターンを使え。
【既出リスト】: ${historyList}
【文字数ルール】ひらがな変換後の文字数。拗音・促音・撥音も各1文字。出力前に指折り確認！
【フォーマット】各ワード「ワード/ひらがな読み(romaji)」形式。前置き不要。即座に出力。`;

      const makePrompt = (groupDefs: string, examples: string) =>
        `悪口・ディスりワードを生成せよ。\n\n【ターゲット】\n${target}\n${research}${severity}\n${ngSection}${rules}\n\n${groupDefs}\n\n【例】\n${examples}`;

      const shortGroups = [2, 3, 4].map(n => `===${n}文字===\nワード/ひらがな(romaji),...(${GROUP_BUFFER[n]}個 ※目標${GROUP_TARGETS[n]}個)`).join("\n");
      const longGroups = [5, 6, 7].map(n => `===${n}文字===\nワード/ひらがな(romaji),...(${GROUP_BUFFER[n]}個 ※目標${GROUP_TARGETS[n]}個)`).join("\n");

      send("generate", "AI並列生成中...");

      const [rA, rB] = await Promise.allSettled([
        ai.models.generateContent({ model: "gemini-2.5-flash", contents: makePrompt(shortGroups, "===2文字===\nクズ/くず(kuzu),カス/かす(kasu)...\n===3文字===\nダサい/ださい(dasai),無能/むのう(munou)...\n===4文字===\n嘘つき/うそつき(usotsuki),ゴミクズ/ごみくず(gomikuzu)..."), config: geminiConfig }),
        ai.models.generateContent({ model: "gemini-2.5-flash", contents: makePrompt(longGroups, "===5文字===\nできそこない/できそこない(dekisokonai)...\n===6文字===\nおちぶれやろう/おちぶれやろう(ochibureyarou)...\n===7文字===\nのうたりんやろう/のうたりんやろう(noutarinyarou)..."), config: geminiConfig }),
      ]);

      if (rA.status === "fulfilled") addEntries(parseWordEntries(rA.value.text || ""));
      else send("generate", "短文字グループ生成失敗。リトライで補填。");
      if (rB.status === "fulfilled") addEntries(parseWordEntries(rB.value.text || ""));
      else send("generate", "長文字グループ生成失敗。リトライで補填。");
      send("generate", `並列生成完了: ${total()}/100個 (${formatElapsed(Date.now() - startTime)})`);

      for (let retry = 0; retry < 5; retry++) {
        const shortfalls = Object.entries(GROUP_TARGETS)
          .map(([cc, tgt]) => ({ charCount: Number(cc), need: tgt - groups[CHAR_TO_KEY[Number(cc)]].length }))
          .filter(s => s.need > 0);
        if (shortfalls.reduce((s, x) => s + x.need, 0) === 0) break;

        send("retry", `不足${shortfalls.reduce((s, x) => s + x.need, 0)}個を追加生成中 (リトライ${retry + 1})`);

        const used = Object.values(groups).flat().map(e => e.word);
        const retryGroups = shortfalls.map(s => `===${s.charCount}文字===\nワード/ひらがな(romaji),...(${Math.max(s.need * 4, s.need + 20)}個)`).join("\n");

        const rr = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `悪口・ディスりワードを追加生成せよ。\n\n【ターゲット】\n${target}\n${research}${severity}\n${ngSection}【厳守】全て異なるワード。意味の通じる悪口のみ。造語不可。\n【既出】: ${[...existingWords.slice(-200), ...used].join(",")}\n【文字数ルール】ひらがな変換後の文字数。拗音・促音・撥音も各1文字。\n【フォーマット】「ワード/ひらがな読み(romaji)」形式。前置き不要。\n\n${retryGroups}\n\n===4文字===\n嘘つき/うそつき(usotsuki),ゴミクズ/ごみくず(gomikuzu)...`,
          config: geminiConfig,
        });
        addEntries(parseWordEntries(rr.text || ""));
        send("retry", `リトライ${retry + 1}完了: ${total()}/100個`);
      }

      if (heartbeat) clearInterval(heartbeat);
      send("done", `完了: ${total()}/100個 (所要時間: ${formatElapsed(Date.now() - startTime)})`);

      if (!disconnected) {
        res.write(`data: ${JSON.stringify({ type: "result", groups, total: total() })}\n\n`);
        res.end();
      }
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      console.error("Diss generation error:", error);
      if (!disconnected) {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", error: "ワード生成に失敗しました" })}\n\n`);
          res.end();
        } catch { try { res.status(500).json({ error: "ワード生成に失敗しました" }); } catch {} }
      }
    }
  });

  app.get("/api/favorites", async (_req, res) => {
    try {
      const allWords = await getAllWords();
      const items = allWords.map(w => ({ id: w.id, word: w.word, reading: w.reading, romaji: w.romaji, vowels: w.vowels, charCount: w.charCount }));
      const grouped: Record<string, typeof items> = {};
      const assigned = new Set<number>();

      for (let suffixLen = 5; suffixLen >= 2; suffixLen--) {
        const buckets: Record<string, typeof items> = {};
        for (const item of items) {
          if (assigned.has(item.id) || item.vowels.length < suffixLen) continue;
          const suffix = item.vowels.slice(-suffixLen);
          (buckets[suffix] ??= []).push(item);
        }
        for (const [suffix, words] of Object.entries(buckets)) {
          const counts: Record<string, number> = {};
          const filtered = words.filter(w => {
            const rs = w.reading.slice(-Math.min(2, w.reading.length));
            return (counts[rs] = (counts[rs] || 0) + 1) <= 2;
          });
          if (filtered.length >= 2) {
            (grouped[`*${suffix}`] ??= []).push(...filtered);
            filtered.forEach(w => assigned.add(w.id));
          }
        }
      }

      for (const item of items) {
        if (assigned.has(item.id)) continue;
        const key = `*${item.vowels.slice(-1) || ""}`;
        (grouped[key] ??= []).push(item);
        assigned.add(item.id);
      }

      const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).map(([vowels, words]) => ({ vowels, words }));
      res.json({ groups: sortedGroups, total: allWords.length });
    } catch (error) {
      console.error("Favorites fetch error:", error);
      res.status(500).json({ error: "お気に入りの取得に失敗しました" });
    }
  });

  app.post("/api/favorites", async (req, res) => {
    try {
      const parsed = wordArraySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
      const entries = parsed.data.words.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji, vowels: extractVowels(w.romaji), charCount: w.reading.length }));
      const added = await addWords(entries);
      res.json({ added, total: await getWordCount() });
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
      res.json({ success: true, total: await getWordCount() });
    } catch (error) {
      res.status(500).json({ error: "削除に失敗しました" });
    }
  });

  app.delete("/api/favorites", async (_req, res) => {
    try { await clearAllWords(); res.json({ success: true, total: 0 }); }
    catch { res.status(500).json({ error: "全削除に失敗しました" }); }
  });

  app.get("/api/favorites/count", async (_req, res) => {
    try { res.json({ total: await getWordCount() }); }
    catch { res.status(500).json({ error: "カウント取得に失敗しました" }); }
  });

  app.get("/api/favorites/export", async (_req, res) => {
    try { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.send(await exportWords()); }
    catch { res.status(500).json({ error: "エクスポートに失敗しました" }); }
  });

  app.post("/api/ng-words", async (req, res) => {
    try {
      const parsed = wordArraySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
      const added = await addNgWords(parsed.data.words.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji })));
      res.json({ added, total: await getNgWordCount() });
    } catch (error) {
      res.status(500).json({ error: "NGワードの追加に失敗しました" });
    }
  });

  app.get("/api/ng-words", async (_req, res) => {
    try { const words = await getAllNgWords(); res.json({ words, total: words.length }); }
    catch { res.status(500).json({ error: "NGワードの取得に失敗しました" }); }
  });

  app.get("/api/ng-words/count", async (_req, res) => {
    try { res.json({ total: await getNgWordCount() }); }
    catch { res.status(500).json({ error: "NGワード数の取得に失敗しました" }); }
  });

  app.delete("/api/ng-words", async (_req, res) => {
    try { await clearNgWords(); res.json({ success: true, total: 0 }); }
    catch { res.status(500).json({ error: "NGワードの全削除に失敗しました" }); }
  });

  return httpServer;
}
