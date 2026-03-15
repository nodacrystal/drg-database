import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import {
  getAllWords, getWordCount, getWordStrings, addWords, deleteWord, deleteWords,
  clearAllWords, exportWords, getAllNgWords, getNgWordStrings,
  addNgWords, getNgWordCount, clearNgWords, deleteNgWords, markWordsProtected, ensureProtectedColumn,
  getWordById, getWordsByIds, updateWord,
} from "./storage";
import { TARGETS } from "./targets";
import { SCRUTINY_REFERENCE } from "./scrutiny_reference";
import { aiGenerate, geminiConfig } from "./lib/ai";
import {
  extractVowels, countMoraVowels, quickCharCheck, parseWordEntries,
  countMoraFromRomaji, extractCommonSubstrings, formatElapsed, getEndingBase,
  type WordEntry,
} from "./lib/words";
import { computePerfectRhymeKey, CONSONANT_RHYME_GROUP } from "./lib/rhyme";
import { ALLOWED_VOWEL_SUFFIXES, DISS_ANGLES, LEVEL_CONFIGS } from "./lib/generate";

const dissRequestSchema = z.object({
  target: z.string().min(1),
  level: z.number().int().min(1).max(5),
});

const wordArraySchema = z.object({
  words: z.array(z.object({
    word: z.string().min(1),
    reading: z.string().min(1),
    romaji: z.string().min(1),
  })),
});

const batchDeleteSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await ensureProtectedColumn();

  app.get("/api/target", (_req, res) => {
    const t = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    res.json({ target: `名前：${t.name}\n見た目：${t.appearance}\n性格：${t.personality}` });
  });

  app.post("/api/diss", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });

    try {
      const parsed = dissRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "パラメータが不正です" });
      const { target, level } = parsed.data;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const startTime = Date.now();
      let currentStep = "";
      const timings: Record<string, number> = {};

      function send(step: string, detail: string) {
        if (disconnected) return;
        currentStep = step;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      function logTiming(label: string) {
        timings[label] = Date.now() - startTime;
        console.log(`[TIMING] ${label}: ${formatElapsed(timings[label])}`);
      }

      heartbeat = setInterval(() => {
        if (disconnected) { if (heartbeat) clearInterval(heartbeat); return; }
        res.write(`data: ${JSON.stringify({ type: "progress", step: currentStep, detail: "処理継続中...", elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }, 5000);

      const levelConfig = LEVEL_CONFIGS[level];
      send("init", `準備中... (Lv.${level} ${levelConfig.label})`);
      logTiming("start");

      const targetName = target.split("\n")[0]?.replace("名前：", "").trim() || "";

      const [existingWords, ngWordList] = await Promise.all([
        getWordStrings(),
        getNgWordStrings(),
      ]);
      logTiming("db");
      send("init", `準備完了 (DB: ${existingWords.length}語, NG: ${ngWordList.length}語)`);

      const shortHistory = existingWords.slice(-80).join(",") || "なし";
      const ngEndingNote = ngWordList.length > 0 ? `\n【禁止単語（含有禁止）】以下の単語を1文字でも含むワードは生成禁止（位置問わず）: ${ngWordList.join("、")}` : "";

      send("step1", `STEP1: ディスワード300個を生成中... (並列バッチ生成)`);

      const dupTailWords = new Set<string>();
      const accumulatedExclusions = new Set<string>();

      const runStep1Generation = async (targetCount: number, extraExclusions: string[] = []): Promise<WordEntry[]> => {
        const batchCount = Math.max(2, Math.ceil(targetCount / 50));
        const words: WordEntry[] = [];
        const batchSeen = new Set<string>();

        const makePrompt = (batchIndex: number, usedWordsList: string[]) => {
          const angle = DISS_ANGLES[batchIndex % DISS_ANGLES.length];
          const usedNote = usedWordsList.length > 0
            ? `\n【使用済み名詞・概念（絶対使用禁止）】以下の名詞・キーワードはすでに他のワードで使用済み。これらの名詞を含むワードは絶対に生成するな（全角・半角・ひらがな・漢字表記問わず）:\n${usedWordsList.slice(-200).join("、")}`
            : "";
          return `「${targetName}」をディスるワードを50個生成せよ。

【ターゲット情報】
${target}

【Lv.${level} ${levelConfig.label}】${levelConfig.instruction}

【このバッチの攻撃角度】
${angle}
この角度に特化したワードのみ生成せよ。他の角度のワードは生成するな。

【絶対ルール】
- 1ワード10文字以内、4文字以上（ひらがな換算）
- 【難しい言葉禁止】小学生でも即座に理解できる言葉のみ使用。漢語・専門用語・難読語は絶対禁止
- 【辛辣必須】どのワードも相手の急所を突く辛辣さを持つこと。当たり障りのない表現は削除せよ
- 【挑発性必須】相手が読んで苛立つ・カチンとくるような挑発的な言葉を選べ
- 【リズム重視】声に出したとき音のリズムが良いこと（語呂が悪いものは削除せよ）
- 同じ助詞・助動詞で終わるワードを重複させるな
- 関西弁・方言語尾は絶対禁止（やな/やわ/やろ/やで/やん/ねん/やんか/やんな/わな/じゃな/じゃろ/っちゃ等）→ 標準語のみ
- 【体言止め必須】名詞・名詞句で終わること。助詞・助動詞・形容詞語尾・動詞活用形で終わるワードは絶対禁止
- ターゲット「${targetName}」に特化した内容
- 造語OK（ただし意味が通じること）
- このバッチ内で同じ単語を使用するな
- 放送禁止用語・差別用語・商標名（IP）は削除せよ
- 生成後、全ルールを自己チェックし違反ワードを削除せよ${ngEndingNote}${usedNote}
既出DB（生成するな）: ${shortHistory}

【出力形式】
全ワードを出力した後、必ず末尾に「【使用名詞】」セクションを追加し、生成した全ワードに含まれる主要な名詞・キーワードを列挙せよ。

ワード出力（1行1個）:
ワード/よみ(romaji)
例: ポンコツ野郎/ぽんこつやろう(ponkotsuyarou)
※必ず「/」の後にひらがな読みを書き、(romaji)を付けること

【使用名詞】名詞1、名詞2、名詞3...（このバッチで使用した全ての主要名詞）`;
        };

        for (let pair = 0; pair < Math.ceil(batchCount / 2); pair++) {
          const i0 = pair * 2;
          const i1 = pair * 2 + 1;
          const indices = [i0, i1].filter(i => i < batchCount);

          const currentUsedWords = [...accumulatedExclusions, ...extraExclusions];

          const pairResults = await Promise.allSettled(
            indices.map(i => aiGenerate(makePrompt(i, currentUsedWords), { ...geminiConfig, maxOutputTokens: 4096 }))
          );

          const pairWords: WordEntry[] = [];
          for (let r = 0; r < pairResults.length; r++) {
            const result = pairResults[r];
            const batchNum = pair * 2 + r + 1;
            const angleLabel = DISS_ANGLES[(pair * 2 + r) % DISS_ANGLES.length].split("（")[0];
            if (result.status !== "fulfilled") {
              console.log(`[STEP1] Batch ${batchNum} (${angleLabel}) FAILED`);
              continue;
            }
            const text = result.value.text || "";

            // 【使用名詞】セクションを抽出してexclusionsに追加
            const nounMatch = text.match(/【使用名詞】([^\n]+)/);
            if (nounMatch) {
              const nouns = nounMatch[1].split(/[、,，\s]+/).map((n: string) => n.trim()).filter((n: string) => n.length >= 2 && n.length <= 10);
              for (const n of nouns) accumulatedExclusions.add(n);
              console.log(`[STEP1] Batch ${batchNum} 使用名詞: ${nouns.join("、")}`);
            }

            const entries = parseWordEntries(text);
            let batchAdded = 0;
            for (const e of entries) {
              if (batchSeen.has(e.word)) {
                const tail = e.reading.slice(-2);
                if (tail.length >= 2) dupTailWords.add(tail);
                continue;
              }
              // NG単語チェック: 含有判定（位置問わず）
              if (ngWordList.length > 0 && ngWordList.some(ng => e.word.includes(ng) || e.reading.includes(ng))) {
                console.log(`[STEP1] NG単語含有除外: "${e.word}"`);
                continue;
              }
              const isHiragana = /^[ぁ-ゟー]+$/.test(e.reading);
              const len = isHiragana ? e.reading.length : countMoraFromRomaji(e.romaji);
              if (len < 3 || len > 10) continue;
              if (!isHiragana) e.reading = e.word;
              batchSeen.add(e.word);
              pairWords.push(e);
              batchAdded++;
            }
            console.log(`[STEP1] Batch ${batchNum} [${angleLabel}]: parsed=${entries.length} added=${batchAdded}`);
          }

          words.push(...pairWords);

          // 文字列ベースのcommonSubsも引き続き追加
          for (const w of pairWords) {
            accumulatedExclusions.add(w.word);
          }
          const commonSubs = extractCommonSubstrings(pairWords);
          for (const s of commonSubs) accumulatedExclusions.add(s);
        }
        return words;
      };

      const TARGET_COUNT = 300;
      const RAW_TARGET = Math.ceil(TARGET_COUNT * 2.2);

      const runStep2Filter = async (words: WordEntry[], label = ""): Promise<WordEntry[]> => {
        if (words.length === 0) return [];
        const rawSet = new Set(words.map(w => w.word));
        const wordList = words.map(w => w.word).join("\n");
        const prompt = `以下のワード一覧が絶対ルールを守っているか検証し、合格ワードのみ出力せよ。

【絶対ルール（違反ワードは削除）】
- 1ワード10文字以内、4文字以上（ひらがな換算）
- 【難しい言葉禁止】小学生でも即座に理解できる言葉のみ。漢語・専門用語・難読語は削除
- 【辛辣必須】当たり障りのない・弱い表現は削除。相手の急所を突く辛辣さがあること
- 【挑発性必須】読んで苛立つ・カチンとくるような挑発的な言葉であること
- 【リズム必須】声に出したとき音のリズムが良いこと。語呂が悪いものは削除
- 同じ助詞・助動詞で終わるワードを重複させるな（例：〜だろ、〜だろ は禁止）
- 関西弁・方言語尾は絶対禁止（やな/やわ/やろ/やで/やん/ねん/やんか/やんな/わな/じゃな/じゃろ/っちゃ等）→ 標準語のみ使用
- 【体言止め必須】各ワードは必ず名詞・名詞句で終わらせること。助詞（〜な/〜だ/〜わ/〜よ/〜ね）、助動詞（〜てる/〜てた/〜です/〜ます）、形容詞語尾（〜い）、動詞活用形（〜する/〜いる）で終わるワードは絶対禁止
- 造語OK（ただし意味が通じること）
- 放送禁止用語、差別用語、商標名（IP）を使用している場合は削除せよ。

【ワード一覧】
${wordList}

【出力】合格ワードのみ、1行1個。元の表記そのまま出力。番号・説明不要:`;
        try {
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 8192 });
          const text = result.text || "";
          const passed = text.split("\n")
            .map((l: string) => l.trim().replace(/^\d+[\.\)）、]\s*/, "").replace(/^[・●▸►\-]\s*/, "").replace(/^「/, "").replace(/」$/, "").trim())
            .filter((l: string) => l.length > 0 && rawSet.has(l));
          const passedSet = new Set(passed);
          if (passedSet.size < words.length * 0.15) {
            console.log(`[STEP2${label}] Pass rate too low (${passedSet.size}/${words.length}), keeping all`);
            return words;
          }
          console.log(`[STEP2${label}] Filter: ${passedSet.size}/${words.length} passed`);
          return words.filter(w => passedSet.has(w.word));
        } catch (err) {
          console.log(`[STEP2${label}] Filter error, keeping all:`, err);
          return words;
        }
      };

      const clusterBySharedWordAI = async (words: WordEntry[], label = ""): Promise<WordEntry[]> => {
        if (words.length < 2) return words;
        const rawSet = new Set(words.map(w => w.word));
        const wordList = words.map(w => w.word).join("\n");
        const prompt = `以下の悪口ワードリストを精査せよ。

【作業手順】
STEP1: 全ワードを読み、各ワードに含まれる「名詞・固有名詞」をリストアップせよ。
STEP2: 同じ名詞（ひらがな・カタカナ・漢字問わず、読みが同じなら同一）が複数のワードに現れているグループを特定せよ。
STEP3: 各グループの中で最も辛辣・強烈・パンチラインのワードを1個だけ選び、他を削除せよ。
STEP4: 共通名詞グループに属さないワードは全て残せ。

【共通単語の例】
・「クソ顔」「汚い顔」「ブス顔」→「顔(かお)」共通 → 最強1個だけ残す
・「カス野郎」「ゴミ野郎」「クズ野郎」→「野郎(やろう)」共通 → 最強1個だけ残す
・「価値ゼロ」「価値なし」「存在価値ゼロ」→「価値(かち)」共通 → 最強1個だけ残す
・「脳ミソ腐れ」「脳なし野郎」→「脳(のう)」共通 → 最強1個だけ残す
・「ゴミ人間」「社会のゴミ」「生ゴミ」→「ゴミ(ごみ)」共通 → 最強1個だけ残す

【厳守事項】
・先頭・中間・末尾いずれの位置に名詞が現れても対象
・共通名詞を持たないワードは削除禁止
・出力は元の表記そのまま（変換・書き換え禁止）

ワードリスト:
${wordList}

残すワードのみ出力（1行1個、元の表記そのまま、番号・説明一切不要）:`;
        try {
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 8192 });
          const text = result?.text || "";
          const kept = text.split("\n")
            .map((l: string) => l.trim().replace(/^「/, "").replace(/」$/, "").replace(/^\d+[\.\)）、]\s*/, "").replace(/^[・●▸►\-]\s*/, "").trim())
            .filter((l: string) => l.length > 0 && rawSet.has(l));
          const keptSet = new Set(kept);
          if (keptSet.size < words.length * 0.4) {
            console.log(`[CLUSTER${label}] AI returned too few (${keptSet.size}/${words.length}), keeping all`);
            return words;
          }
          console.log(`[CLUSTER${label}] ${keptSet.size}/${words.length} kept after shared-word dedup`);
          return words.filter(w => keptSet.has(w.word));
        } catch (err) {
          console.log(`[CLUSTER${label}] AI failed, keeping all:`, err);
          return words;
        }
      };

      // ─── Phase 1: 大量生成 ───
      let rawPool: WordEntry[] = [];
      let rawIter = 0;
      while (rawPool.length < RAW_TARGET && rawIter < 5) {
        rawIter++;
        const needed = RAW_TARGET - rawPool.length;
        const batchTarget = Math.ceil(needed * 1.3);
        send("step1", `STEP1: [${rawIter}] ${batchTarget}個を生成中... (目標プール: ${rawPool.length}/${RAW_TARGET})`);

        const rawBatch = await runStep1Generation(batchTarget);
        logTiming(`step1-raw-${rawIter}`);

        const poolSet = new Set(rawPool.map(w => w.word));
        const endingMap = new Map<string, WordEntry>();
        for (const w of rawPool) {
          const base = getEndingBase(w.reading);
          if (base && !endingMap.has(base)) endingMap.set(base, w);
        }
        let addedCount = 0;
        for (const w of rawBatch) {
          if (poolSet.has(w.word)) continue;
          const base = getEndingBase(w.reading);
          if (base && endingMap.has(base)) continue;
          if (base) endingMap.set(base, w);
          poolSet.add(w.word);
          rawPool.push(w);
          addedCount++;
        }
        rawPool = quickCharCheck(rawPool);
        console.log(`[PHASE1:${rawIter}] raw=${rawBatch.length}, added=${addedCount}, pool=${rawPool.length}`);
        send("step1", `STEP1: [${rawIter}] プール${rawPool.length}個 (目標${RAW_TARGET}個)`);
      }

      logTiming("step1-generate");
      send("step1", `STEP1完了: ${rawPool.length}個の候補ワードを収集`);

      // ─── Phase 2: Step2品質フィルタ ───
      send("step2", `STEP2: 品質フィルタリング中... (${rawPool.length}個を一括評価)`);
      let qualityPool = await runStep2Filter(rawPool);
      qualityPool = quickCharCheck(qualityPool);
      logTiming("step2-filter");
      send("step2", `STEP2完了: ${qualityPool.length}/${rawPool.length}個が合格`);

      // ─── Phase 3: 共通単語クラスタリング ───
      send("step2b", `STEP2b: 共通単語クラスタリング中... (${qualityPool.length}個を一括評価)`);
      let clusteredPool = await clusterBySharedWordAI(qualityPool);
      logTiming("step2b-cluster");
      send("step2b", `STEP2b完了: ${clusteredPool.length}/${qualityPool.length}個残（${qualityPool.length - clusteredPool.length}個重複削除）`);

      // ─── Phase 4: 補充ループ ───
      let fillIter = 0;
      while (clusteredPool.length < TARGET_COUNT && fillIter < 3) {
        fillIter++;
        const deficit = TARGET_COUNT - clusteredPool.length;
        const extraRawTarget = Math.ceil(deficit * 2.5);
        send("step1", `[補充${fillIter}] あと${deficit}個必要 → ${extraRawTarget}個を追加生成中...`);

        const existingSet = new Set(clusteredPool.map(w => w.word));
        const existingEndingMap = new Map<string, WordEntry>();
        for (const w of clusteredPool) {
          const base = getEndingBase(w.reading);
          if (base && !existingEndingMap.has(base)) existingEndingMap.set(base, w);
        }

        const extraRaw = await runStep1Generation(extraRawTarget, [...dupTailWords]);
        const extraNew: WordEntry[] = [];
        for (const w of extraRaw) {
          if (existingSet.has(w.word)) continue;
          const base = getEndingBase(w.reading);
          if (base && existingEndingMap.has(base)) continue;
          if (base) existingEndingMap.set(base, w);
          existingSet.add(w.word);
          extraNew.push(w);
        }
        const extraChecked = quickCharCheck(extraNew);
        if (extraChecked.length === 0) { send("step1", `[補充${fillIter}] 新規ワードなし、終了`); break; }

        const extraFiltered = await runStep2Filter(extraChecked, `:fill${fillIter}`);
        logTiming(`step2-fill-${fillIter}`);

        const combined = [...clusteredPool, ...extraFiltered];
        send("step2b", `[補充${fillIter}] 合計${combined.length}個を再クラスタリング中...`);
        clusteredPool = await clusterBySharedWordAI(combined, `:fill${fillIter}`);
        logTiming(`step2b-fill-${fillIter}`);
        send("step1", `[補充${fillIter}完了] 合計${clusteredPool.length}個`);
      }

      let finalQualityWords = clusteredPool;
      if (finalQualityWords.length > TARGET_COUNT) {
        finalQualityWords = finalQualityWords.slice(0, TARGET_COUNT);
      }

      // ─── STEP2c: ローマ字全数検証・修正 ───
      send("step2c", `STEP2c: ローマ字全数検証中... (${finalQualityWords.length}個)`);
      const ROMAJI_BATCH = 80;
      const ROMAJI_PARALLEL = 4;
      const correctedWords: WordEntry[] = [];
      const romajiBatches: WordEntry[][] = [];
      for (let i = 0; i < finalQualityWords.length; i += ROMAJI_BATCH) {
        romajiBatches.push(finalQualityWords.slice(i, i + ROMAJI_BATCH));
      }
      let romajiFixCount = 0;
      for (let r = 0; r < Math.ceil(romajiBatches.length / ROMAJI_PARALLEL); r++) {
        if (disconnected) break;
        const chunk = romajiBatches.slice(r * ROMAJI_PARALLEL, (r + 1) * ROMAJI_PARALLEL);
        const results = await Promise.all(chunk.map(async (batch) => {
          const lines = batch.map((w, i) => `${i + 1}. ${w.word}/${w.reading}(${w.romaji})`).join("\n");
          const prompt = `以下のワードのヘボン式ローマ字を検証し、誤りがあれば修正せよ。

【ルール】
- 読みの各モーラを正確にヘボン式ローマ字で表す
- 「ん」→n、「っ」→次子音重複(tt/kk/ss等)、「ー」→前母音重複(aa/oo等)
- 半角小文字英字のみ（ハイフン・スペース不可）
- ん・っ以外の全モーラに母音(aeiou)が1つ対応すること

ワード一覧（番号.ワード/よみ（現在のローマ字））:
${lines}

修正が必要なもののみJSON配列で出力。不要なら[]のみ:
[{"idx":1,"romaji":"修正後ローマ字"}]
番号は1始まり。`;
          try {
            const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 1024 });
            const text = result?.text || "";
            const jsonMatch = text.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) return batch;
            type RC = { idx: number; romaji: string };
            const corrections = JSON.parse(jsonMatch[0]) as RC[];
            const corrBatch = [...batch];
            for (const c of corrections) {
              const idx = c.idx - 1;
              if (idx >= 0 && idx < corrBatch.length && c.romaji) {
                const newRomaji = c.romaji.toLowerCase().replace(/[^a-z]/g, "");
                if (newRomaji && newRomaji !== corrBatch[idx].romaji) {
                  console.log(`[STEP2c] "${corrBatch[idx].word}" ${corrBatch[idx].romaji}→${newRomaji}`);
                  corrBatch[idx] = { ...corrBatch[idx], romaji: newRomaji };
                  romajiFixCount++;
                }
              }
            }
            return corrBatch;
          } catch { return batch; }
        }));
        for (const batch of results) correctedWords.push(...batch);
        send("step2c", `STEP2c: ${Math.min((r + 1) * ROMAJI_PARALLEL, romajiBatches.length)}/${romajiBatches.length}バッチ完了...`);
      }
      const verifiedWords = quickCharCheck(correctedWords);
      const removedByVerify = correctedWords.length - verifiedWords.length;
      send("step2c", `STEP2c完了: ${romajiFixCount}個修正, ${removedByVerify}個除外 → 残${verifiedWords.length}語`);
      finalQualityWords = verifiedWords;
      logTiming("step2c-romaji");

      console.log(`[GEN] Final count before grouping: ${finalQualityWords.length}`);
      send("step3", `STEP3: 母音パターンでグルーピング中...`);

      const groups: Record<string, WordEntry[]> = {};
      for (const suffix of ALLOWED_VOWEL_SUFFIXES) groups[suffix] = [];
      const ungrouped: WordEntry[] = [];

      for (const w of finalQualityWords) {
        const vowels = extractVowels(w.romaji);
        const suffix = vowels.length >= 2 ? vowels.slice(-2) : "";
        if (suffix && ALLOWED_VOWEL_SUFFIXES.includes(suffix)) {
          groups[suffix].push(w);
        } else {
          ungrouped.push(w);
        }
      }

      const patternSummary = ALLOWED_VOWEL_SUFFIXES.map(p => `${p}:${groups[p].length}`).join(", ");
      const totalGrouped = ALLOWED_VOWEL_SUFFIXES.reduce((sum, p) => sum + groups[p].length, 0);
      console.log(`[STEP3] Grouped: ${totalGrouped} (${patternSummary}), ungrouped: ${ungrouped.length}`);
      logTiming("step3-group");

      send("step3", `STEP3完了: ${totalGrouped}個をグループ化 (${patternSummary})`);

      if (heartbeat) clearInterval(heartbeat);
      logTiming("total");
      const timingSummary = Object.entries(timings).map(([k, v]) => `${k}=${formatElapsed(v)}`).join(", ");
      send("done", `完了: ${totalGrouped + ungrouped.length}個 (グループ${totalGrouped} + 未分類${ungrouped.length}) [${timingSummary}]`);

      if (!disconnected) {
        res.write(`data: ${JSON.stringify({ type: "result", groups, ungrouped, total: totalGrouped + ungrouped.length, elapsedMs: Date.now() - startTime })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
        res.end();
      }
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      console.error("Generation error:", error);
      if (!disconnected) {
        try { res.write(`data: ${JSON.stringify({ type: "error", error: "ワード生成に失敗しました" })}\n\n`); res.end(); }
        catch { try { res.status(500).json({ error: "ワード生成に失敗しました" }); } catch {} }
      }
    }
  });

  app.get("/api/favorites", async (_req, res) => {
    try {
      const allWords = await getAllWords();
      const items = allWords.map(w => {
        const vowels = extractVowels(w.romaji);
        return { id: w.id, word: w.word, reading: w.reading, romaji: w.romaji, vowels, charCount: w.charCount };
      });

      const sortByRomaji = (arr: typeof items) => arr.sort((a, b) => a.romaji.length - b.romaji.length || a.romaji.localeCompare(b.romaji));

      const buckets: Record<string, typeof items> = {};
      for (const item of items) {
        const key = item.vowels.length >= 2 ? item.vowels.slice(-2) : item.vowels || "_";
        (buckets[key] ??= []).push(item);
      }

      type RhymeGroup = { suffix: string; words: typeof items; tier: "hard" | "super" | "legendary" | "perfect" };
      const groups: { vowels: string; words: typeof items; hardRhymes: RhymeGroup[] }[] = [];

      for (const [suffix, words] of Object.entries(buckets)) {
        if (words.length === 0) continue;

        const assigned = new Set<number>();
        const rhymeGroups: RhymeGroup[] = [];

        const buildTierBuckets = (minLen: number) => {
          const bkts: Record<string, typeof items> = {};
          for (const w of words) {
            if (assigned.has(w.id)) continue;
            if (w.vowels.length >= minLen) {
              const s = w.vowels.slice(-minLen);
              (bkts[s] ??= []).push(w);
            }
          }
          return bkts;
        };

        const perfectBuckets: Record<string, typeof items> = {};
        for (const w of words) {
          const key = computePerfectRhymeKey(w.romaji);
          if (key !== null) (perfectBuckets[key] ??= []).push(w);
        }
        const perfectEntries = Object.entries(perfectBuckets)
          .filter(([, g]) => [...new Set(g.map(w => w.id))].length >= 2)
          .sort((a, b) => b[0].length - a[0].length || b[1].length - a[1].length);
        for (const [ps, pWords] of perfectEntries) {
          const uniqueWords = [...new Map(pWords.map(w => [w.id, w])).values()]
            .filter(w => !assigned.has(w.id));
          if (uniqueWords.length >= 2) {
            const syllableCount = (ps.match(/[0-9]/g) || []).length;
            const readingSuffixes = uniqueWords.map(w => {
              const chars = [...w.reading];
              return chars.slice(Math.max(0, chars.length - syllableCount)).join("");
            });
            if (new Set(readingSuffixes).size === 1) continue;

            const displaySuffix = ps.replace(/[0-9]/g, "");
            rhymeGroups.push({ suffix: displaySuffix, words: sortByRomaji(uniqueWords), tier: "perfect" });
            for (const w of uniqueWords) assigned.add(w.id);
          }
        }

        for (const [s6, lWords] of Object.entries(buildTierBuckets(6))) {
          if (lWords.length >= 2) {
            rhymeGroups.push({ suffix: s6, words: sortByRomaji(lWords), tier: "legendary" });
            for (const w of lWords) assigned.add(w.id);
          }
        }

        for (const [s5, sWords] of Object.entries(buildTierBuckets(5))) {
          if (sWords.length >= 2) {
            rhymeGroups.push({ suffix: s5, words: sortByRomaji(sWords), tier: "super" });
            for (const w of sWords) assigned.add(w.id);
          }
        }

        for (const [s4, hWords] of Object.entries(buildTierBuckets(4))) {
          if (hWords.length >= 2) {
            rhymeGroups.push({ suffix: s4, words: sortByRomaji(hWords), tier: "hard" });
            for (const w of hWords) assigned.add(w.id);
          }
        }

        const tierOrder = { perfect: 0, legendary: 1, super: 2, hard: 3 };
        rhymeGroups.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.words.length - a.words.length);

        const remaining = sortByRomaji(words.filter(w => !assigned.has(w.id)));
        groups.push({ vowels: `*${suffix}`, words: remaining, hardRhymes: rhymeGroups });
      }

      const vowelOrder: Record<string, number> = { a: 0, i: 1, u: 2, e: 3, o: 4, n: 5 };
      groups.sort((a, b) => {
        const aLast = a.vowels.slice(-1);
        const bLast = b.vowels.slice(-1);
        const aOrd = vowelOrder[aLast] ?? 6;
        const bOrd = vowelOrder[bLast] ?? 6;
        if (aOrd !== bOrd) return aOrd - bOrd;
        const aTotal = a.words.length + a.hardRhymes.reduce((s, h) => s + h.words.length, 0);
        const bTotal = b.words.length + b.hardRhymes.reduce((s, h) => s + h.words.length, 0);
        return bTotal - aTotal;
      });

      res.json({ groups, total: allWords.length });
    } catch (error) { console.error("Favorites fetch error:", error); res.status(500).json({ error: "お気に入りの取得に失敗しました" }); }
  });

  app.post("/api/favorites", async (req, res) => {
    try {
      const parsed = wordArraySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
      const ngList = await getNgWordStrings();
      const ngFiltered = parsed.data.words.filter(w => !ngList.some(ng => w.word.endsWith(ng)));
      const filtered = quickCharCheck(ngFiltered);
      const added = await addWords(filtered.map(w => ({
        word: w.word,
        reading: w.reading,
        romaji: w.romaji,
        vowels: extractVowels(w.romaji),
        charCount: countMoraVowels(w.reading),
      })));
      res.json({ added, total: await getWordCount() });
    } catch (error) { res.status(500).json({ error: "お気に入りの追加に失敗しました" }); }
  });

  app.delete("/api/favorites/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "不正なIDです" });
      await deleteWord(id);
      res.json({ success: true, total: await getWordCount() });
    } catch { res.status(500).json({ error: "削除に失敗しました" }); }
  });

  app.post("/api/favorites/batch-delete", async (req, res) => {
    try {
      const parsed = batchDeleteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
      const { ids } = parsed.data;
      const deleted = await deleteWords(ids);
      res.json({ deleted, total: await getWordCount() });
    } catch { res.status(500).json({ error: "一括削除に失敗しました" }); }
  });

  app.post("/api/favorites/taigen-cleanup", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!disconnected) try { res.write(": heartbeat\n\n"); } catch {} }, 15000);
      const send = (data: any) => { if (!disconnected) try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

      const allWords = await getAllWords();
      send({ type: "progress", detail: `全${allWords.length}ワードを体言止めチェック開始...` });

      const deleteIds = new Set<number>();

      const PROG_ENDINGS = ["てる", "でる", "てた", "でた", "てく", "でく", "てない", "でない", "ている", "でいる", "てきた", "てしまう"];
      let progCount = 0;
      for (const w of allWords) {
        const r = w.reading;
        if (PROG_ENDINGS.some(e => r.endsWith(e))) {
          deleteIds.add(w.id);
          progCount++;
        }
      }
      send({ type: "progress", detail: `STEP1完了: 動詞形語尾 ${progCount}件を特定` });

      if (disconnected) { if (heartbeat) clearInterval(heartbeat); return; }
      const remaining = allWords.filter(w => !deleteIds.has(w.id));
      const BATCH = 50;
      const PARALLEL = 6;
      let aiViolations = 0;
      const batches: typeof allWords[] = [];
      for (let i = 0; i < remaining.length; i += BATCH) batches.push(remaining.slice(i, i + BATCH));
      send({ type: "progress", detail: `STEP2開始: 残${remaining.length}件をAIで体言チェック (${batches.length}バッチ)...` });

      for (let round = 0; round < Math.ceil(batches.length / PARALLEL); round++) {
        if (disconnected) break;
        const roundBatches = batches.slice(round * PARALLEL, (round + 1) * PARALLEL);
        const results = await Promise.allSettled(roundBatches.map(async (batch) => {
          const lines = batch.map(w => `${w.word}|${w.reading}`).join("\n");
          const prompt = `以下の日本語ラップ用悪口ワードリストの中で、末尾が「体言（名詞・名詞句）」でないものを全て洗い出せ。

【体言（名詞）で終わる → 合格例】
アホ面、ガラクタ、クズ野郎、ポンコツ、ゴミ人間、役立たず（名詞として定着）

【体言でない → 違反例】
・助詞で終わる: 〜だ、〜わ、〜な、〜よ、〜ね、〜ぞ、〜か
・助動詞で終わる: 〜てる、〜てた、〜ている、〜ます、〜です
・形容詞語尾: 〜い（うるさい、キモい、くさい 等）
・動詞活用形: 〜する、〜いる、〜くる
・方言語尾: 〜やな、〜やろ、〜ねん（既に削除済みのはずだが念のため）

【重要】「役立たず」「たわけ」「このやろう」など慣用句として名詞化したものはOK。
「〜ない」は「役に立たない」(形容詞的)はNG、「役立たず」(名詞)はOK。

以下のリスト（ワード|よみ）から違反ワードを抽出：
${lines}

回答形式（違反がある場合のみ）：
ワード|理由
例：
うるさいやつ|「やつ」で体言止めOK → これは合格
くさい|形容詞語尾「い」で終わり体言でない
腐ってる|動詞進行形「てる」で終わり体言でない

違反なしの場合:「違反なし」とだけ回答。`;
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 2048 });
          const text = (result?.text || "").trim();
          if (!text || text.includes("違反なし")) return [];
          const violated: number[] = [];
          for (const line of text.split("\n")) {
            const word = line.split("|")[0]?.trim();
            if (!word || word.length < 2) continue;
            const match = batch.find(w => w.word === word || w.reading === word);
            if (match) violated.push(match.id);
          }
          return violated;
        }));
        for (const r of results) {
          if (r.status === "fulfilled") {
            for (const id of r.value) { deleteIds.add(id); aiViolations++; }
          }
        }
        send({ type: "progress", detail: `STEP2進捗: ${Math.min((round + 1) * PARALLEL, batches.length)}/${batches.length}バッチ完了, AI違反累計${aiViolations}件` });
      }

      send({ type: "progress", detail: `STEP2完了: AI体言違反 ${aiViolations}件` });

      const idsToDelete = [...deleteIds];
      send({ type: "progress", detail: `STEP3: 合計${idsToDelete.length}件を削除中...` });
      let totalDeleted = 0;
      for (let i = 0; i < idsToDelete.length; i += 500) {
        const batch = idsToDelete.slice(i, i + 500);
        totalDeleted += await deleteWords(batch);
      }
      const finalCount = await getWordCount();
      send({ type: "done", detail: `体言止め整理完了: ${totalDeleted}件削除 → 残り${finalCount}語`, deleted: totalDeleted, remaining: finalCount });
      if (heartbeat) clearInterval(heartbeat);
      res.end();
    } catch (err) {
      console.error("[TAIGEN_CLEANUP]", err);
      if (heartbeat) clearInterval(heartbeat);
      if (!disconnected) try { res.write(`data: ${JSON.stringify({ type: "error", detail: String(err) })}\n\n`); res.end(); } catch {}
    }
  });

  app.post("/api/favorites/scrutinize", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!disconnected) try { res.write(": heartbeat\n\n"); } catch {} }, 15000);

      const send = (data: any) => { if (!disconnected) try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
      const startTime = Date.now();
      const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

      const allWords = await getAllWords();
      send({ type: "progress", detail: `全${allWords.length}ワードを精査中...`, elapsed: elapsed() });

      const flagged: { id: number; reasons: string[] }[] = [];
      const flagMap = new Map<number, string[]>();
      const addFlag = (id: number, reason: string) => {
        if (!flagMap.has(id)) flagMap.set(id, []);
        flagMap.get(id)!.push(reason);
      };

      send({ type: "progress", detail: "チェック1: 母音グループの整合性確認...", elapsed: elapsed() });
      for (const w of allWords) {
        const recalcVowels = extractVowels(w.romaji);
        const storedVowels = w.vowels || "";
        const recalcKey = recalcVowels.length >= 2 ? recalcVowels.slice(-2) : recalcVowels;
        const storedKey = storedVowels.length >= 2 ? storedVowels.slice(-2) : storedVowels;
        if (recalcKey !== storedKey) {
          addFlag(w.id, `母音不一致: stored=${storedKey}, calculated=${recalcKey}`);
        }
      }
      const vowelMismatchCount = [...flagMap.values()].filter(rs => rs.some(r => r.startsWith("母音不一致"))).length;
      send({ type: "progress", detail: `チェック1完了: ${vowelMismatchCount}件の母音不一致`, elapsed: elapsed() });

      send({ type: "progress", detail: "チェック2: 一致箇所の重複確認...", elapsed: elapsed() });
      const wordsByBucket: Record<string, typeof allWords> = {};
      for (const w of allWords) {
        const v = extractVowels(w.romaji);
        const key = v.length >= 2 ? v.slice(-2) : v || "_";
        (wordsByBucket[key] ??= []).push(w);
      }

      for (const [, bucket] of Object.entries(wordsByBucket)) {
        if (bucket.length < 2) continue;
        const suffixGroups: Record<string, typeof allWords> = {};
        for (const w of bucket) {
          const reading = w.reading;
          for (let len = 4; len <= Math.min(8, reading.length - 1); len++) {
            const suffix = reading.slice(-len);
            (suffixGroups[`r:${suffix}`] ??= []).push(w);
          }
          const word = w.word;
          for (let len = 2; len <= Math.min(6, word.length - 1); len++) {
            const suffix = word.slice(-len);
            if (/[\u4E00-\u9FFF\u30A0-\u30FF]/.test(suffix)) {
              (suffixGroups[`w:${suffix}`] ??= []).push(w);
            }
          }
        }
        const flaggedInBucket = new Set<number>();
        const bestSuffixes: { suffix: string; ids: number[] }[] = [];
        for (const [rawSuffix, group] of Object.entries(suffixGroups)) {
          const uniqueIds = [...new Set(group.map(w => w.id))];
          if (uniqueIds.length >= 2) {
            const suffix = rawSuffix.startsWith("w:") || rawSuffix.startsWith("r:") ? rawSuffix.slice(2) : rawSuffix;
            bestSuffixes.push({ suffix, ids: uniqueIds });
          }
        }
        bestSuffixes.sort((a, b) => b.suffix.length - a.suffix.length);
        for (const { suffix, ids } of bestSuffixes) {
          const unflagged = ids.filter(id => !flaggedInBucket.has(id));
          if (unflagged.length >= 2 || (unflagged.length >= 1 && ids.some(id => flaggedInBucket.has(id)))) {
            for (const id of ids) {
              if (!flaggedInBucket.has(id)) {
                flaggedInBucket.add(id);
                addFlag(id, `韻の一致箇所が同じ「${suffix}」(${ids.length}件)`);
              }
            }
          }
        }
      }
      const dupEndingCount = new Set([...flagMap.entries()].filter(([, rs]) => rs.some(r => r.startsWith("韻の一致箇所"))).map(([id]) => id)).size;
      send({ type: "progress", detail: `チェック2完了: ${dupEndingCount}件の一致箇所重複`, elapsed: elapsed() });

      if (disconnected) { if (heartbeat) clearInterval(heartbeat); return; }

      send({ type: "progress", detail: "チェック3: 放送禁止用語・差別用語・商標名のAIチェック...", elapsed: elapsed() });
      const batchSize = 100;
      const aiFlagged = new Set<string>();
      for (let i = 0; i < allWords.length; i += batchSize) {
        if (disconnected) break;
        const batch = allWords.slice(i, i + batchSize);
        const wordList = batch.map(w => w.word).join("\n");
        try {
          const knownGaps = SCRUTINY_REFERENCE.duplicateDetectionGaps.join("\n- ");
          const prompt = `以下の日本語ワードリストを精査してください。
次のカテゴリに該当するワードだけを抽出してください：

1. 放送禁止用語（テレビ・ラジオで使えない言葉）
2. 差別用語（人種・障害・性別・職業等への差別的表現）
3. 商標名・IP（企業名、ブランド名、キャラクター名、芸能人の実名）

重要ルール：
- 「悪口」「侮辱」「ディス」は本アプリの目的なので問題なし。単なる悪口は該当しない。
- 「バカ」「アホ」「クズ」「死ね」「ブス」「ハゲ」「デブ」等の一般的な悪口は対象外。
- 明確に上記3カテゴリに該当するもののみ抽出すること。
- 該当なしの場合は「該当なし」と回答。

過去の検出漏れパターン（参考）：
- ${knownGaps}

ワードリスト：
${wordList}

回答形式（該当ワードがある場合）：
ワード名|カテゴリ（放送禁止/差別/商標）
例：
ニガー|差別
コカコーラ野郎|商標`;

          const result = await aiGenerate(prompt);
          const text = (result?.text || "").trim();
          if (text && !text.includes("該当なし")) {
            for (const line of text.split("\n")) {
              const parts = line.split("|").map((s: string) => s.trim());
              if (parts.length >= 2 && parts[0]) {
                aiFlagged.add(parts[0]);
              }
            }
          }
        } catch (err) {
          console.error(`[SCRUTINY] AI check error batch ${i}:`, err);
          send({ type: "progress", detail: `AIチェックバッチ${Math.floor(i / batchSize) + 1}でエラー、スキップ`, elapsed: elapsed() });
        }
      }

      if (aiFlagged.size > 0) {
        for (const w of allWords) {
          if (aiFlagged.has(w.word)) {
            addFlag(w.id, "AI検出: 放送禁止/差別/商標の可能性");
          }
        }
      }
      send({ type: "progress", detail: `チェック3完了: ${aiFlagged.size}件のAI検出`, elapsed: elapsed() });

      for (const [id, reasons] of flagMap.entries()) {
        flagged.push({ id, reasons });
      }

      if (heartbeat) clearInterval(heartbeat);
      send({ type: "result", flagged, totalChecked: allWords.length, summary: {
        vowelMismatch: vowelMismatchCount,
        duplicateEndings: dupEndingCount,
        aiDetected: aiFlagged.size,
      }});
      res.end();
    } catch (error) {
      console.error("Scrutiny error:", error);
      if (heartbeat) clearInterval(heartbeat);
      try { res.write(`data: ${JSON.stringify({ type: "error", error: "精査に失敗しました" })}\n\n`); res.end(); }
      catch { try { res.status(500).json({ error: "精査に失敗しました" }); } catch {} }
    }
  });

  app.delete("/api/favorites", async (_req, res) => {
    try { await clearAllWords(); res.json({ success: true, total: 0 }); } catch { res.status(500).json({ error: "全削除に失敗しました" }); }
  });

  app.get("/api/favorites/count", async (_req, res) => {
    try { res.json({ total: await getWordCount() }); } catch { res.status(500).json({ error: "カウント取得に失敗しました" }); }
  });

  app.get("/api/favorites/export", async (_req, res) => {
    try { res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.send(await exportWords()); } catch { res.status(500).json({ error: "エクスポートに失敗しました" }); }
  });

  const ngTermsSchema = z.object({ terms: z.array(z.string().min(1)).min(1).max(500) });

  app.post("/api/ng-words", async (req, res) => {
    try {
      if (req.body.terms) {
        const parsed = ngTermsSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
        const added = await addNgWords(parsed.data.terms.map(t => ({ word: t, reading: "", romaji: "" })));
        res.json({ added, total: await getNgWordCount() });
      } else {
        const parsed = wordArraySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
        const added = await addNgWords(parsed.data.words.map(w => ({ word: w.word, reading: w.reading || "", romaji: w.romaji || "" })));
        res.json({ added, total: await getNgWordCount() });
      }
    } catch { res.status(500).json({ error: "NGワードの追加に失敗しました" }); }
  });

  app.get("/api/ng-words", async (_req, res) => {
    try { const words = await getAllNgWords(); res.json({ words, total: words.length }); } catch { res.status(500).json({ error: "NGワードの取得に失敗しました" }); }
  });

  app.get("/api/ng-words/count", async (_req, res) => {
    try { res.json({ total: await getNgWordCount() }); } catch { res.status(500).json({ error: "NGワード数の取得に失敗しました" }); }
  });

  app.delete("/api/ng-words", async (_req, res) => {
    try { await clearNgWords(); res.json({ success: true, total: 0 }); } catch { res.status(500).json({ error: "NGワードの全削除に失敗しました" }); }
  });

  app.post("/api/ng-words/batch-delete", async (req, res) => {
    try {
      const parsed = batchDeleteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "不正なデータです" });
      const deleted = await deleteNgWords(parsed.data.ids);
      res.json({ deleted, total: await getNgWordCount() });
    } catch { res.status(500).json({ error: "一括削除に失敗しました" }); }
  });

  app.post("/api/favorites/group-check", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });
    try {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      heartbeat = setInterval(() => { if (!disconnected) res.write(": heartbeat\n\n"); }, 15000);
      const startTime = Date.now();
      const send = (step: string, detail: string) => {
        if (disconnected) return;
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed })}\n\n`);
      };

      send("init", "グループ検査: 全ワードを取得中...");
      const allWords = await getAllWords();
      let vowelFixed = 0;

      const groupCounts: Record<string, number> = {};
      for (const w of allWords) {
        const key = w.vowels.length >= 2 ? w.vowels.slice(-2) : w.vowels || "_";
        groupCounts[key] = (groupCounts[key] || 0) + 1;
      }
      const groupSummary = Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ");
      send("check", `${allWords.length}語を${Object.keys(groupCounts).length}グループで検査中... (${groupSummary})`);

      const vowelFixUpdates: { id: number; word: string; reading: string; romaji: string; vowels: string; charCount: number }[] = [];

      for (const w of allWords) {
        const computedVowels = extractVowels(w.romaji);
        if (computedVowels !== w.vowels) {
          const oldGroup = w.vowels.length >= 2 ? `*${w.vowels.slice(-2)}` : w.vowels;
          const newGroup = computedVowels.length >= 2 ? `*${computedVowels.slice(-2)}` : computedVowels;
          const groupChange = oldGroup !== newGroup ? ` [${oldGroup}→${newGroup}]` : ` [母音フィールド更新]`;
          vowelFixUpdates.push({ id: w.id, word: w.word, reading: w.reading, romaji: w.romaji, vowels: computedVowels, charCount: w.charCount });
          send("vowel", `グループ再配属:「${w.word}」 ${w.vowels}→${computedVowels}${groupChange}`);
        }
      }

      for (const upd of vowelFixUpdates) {
        await updateWord(upd.id, { word: upd.word, reading: upd.reading, romaji: upd.romaji, vowels: upd.vowels, charCount: upd.charCount });
        vowelFixed++;
      }

      if (vowelFixed === 0) {
        send("done", `グループ検査完了: ${allWords.length}語すべて正常（母音不一致なし）`);
      } else {
        send("done", `グループ検査完了: ${allWords.length}語検査、グループ再配属${vowelFixed}語`);
      }
      const elapsedMs = Date.now() - startTime;
      if (!disconnected) res.write(`data: ${JSON.stringify({ type: "result", checked: allWords.length, vowelFixed, elapsedMs })}\n\n`);
    } catch (error) {
      console.error("Group check error:", error);
      if (!disconnected) res.write(`data: ${JSON.stringify({ type: "error", error: "グループ検査に失敗しました" })}\n\n`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (!disconnected) res.end();
    }
  });

  app.post("/api/favorites/char-check", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });
    try {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      heartbeat = setInterval(() => { if (!disconnected) res.write(": heartbeat\n\n"); }, 15000);
      const startTime = Date.now();
      const send = (step: string, detail: string) => {
        if (disconnected) return;
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed })}\n\n`);
      };

      send("init", "文字整理: 全ワードを取得中...");
      const allWords = await getAllWords();
      let fixed = 0;

      type CharFix = { id: number; reading: string; romaji: string; issues: string };
      const fixQueue: CharFix[] = [];

      const protectedWords = allWords.filter(w => w.protected);
      const unprotectedWords = allWords.filter(w => !w.protected);

      const suspiciousWords = unprotectedWords.filter(w => {
        const expected = countMoraVowels(w.reading);
        const actual = (w.romaji.toLowerCase().match(/[aeiou]/g) || []).length;
        if (expected > 0 && actual / expected < 0.7) return true;
        if (/[^a-z\-]/.test(w.romaji.toLowerCase())) return true;
        return false;
      });

      send("start", `文字整理開始: ${allWords.length}語中 確定済み${protectedWords.length}語スキップ, 未確定${unprotectedWords.length}語検査 (要注意${suspiciousWords.length}語をAI検査)`);

      const BATCH = 30;
      const PARALLEL = 8;
      let checked = 0;

      for (let b = 0; b < suspiciousWords.length; b += BATCH * PARALLEL) {
        if (disconnected) break;
        const superBatch = suspiciousWords.slice(b, b + BATCH * PARALLEL);
        const batches: typeof allWords[] = [];
        for (let i = 0; i < superBatch.length; i += BATCH) batches.push(superBatch.slice(i, i + BATCH));

        const results = await Promise.all(batches.map(async batch => {
          const wordList = batch.map(w => `ID:${w.id} 表記:${w.word} 読み:${w.reading} ローマ字:${w.romaji}`).join("\n");
          const prompt = `以下の日本語悪口ワードについて3点を厳密に検証せよ。

【検証ポイント】
1. 表記（漢字・カタカナ等）の読みが正しいか
2. 読みに対してヘボン式ローマ字が完全に正確か
3. 「ん」「っ」以外の全モーラに対応する母音がローマ字に含まれているか
   - 「か」→a, 「き」→i, 「く」→u, 「け」→e, 「こ」→o（全行共通）
   - 「っ」(促音): 子音重複のみ(kk/tt/ss等)、母音不要
   - 「ん」(撥音): n のみ、母音不要
   - 長音「ー」: 前の母音を繰り返す（こう→kou, こー→koo）
   - 小書き(ゃゅょ): 前の子音と合体(sha,chi,fu,kya等)
   - 注意: 母音の数はモーラ数と一致するはず（ん・っ除く）

ワード一覧:
${wordList}

問題がある場合のみJSON配列で出力（問題なければ空配列[]）:
[{"id":数字,"reading":"正しいひらがな","romaji":"正しいヘボン式ローマ字（英小文字+ハイフンのみ）","issues":"問題の簡潔な説明"}]
JSONのみ出力（説明文・コードブロック不要）。`;
          try {
            const result = await aiGenerate(prompt);
            const text = result.text || "";
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];
            return JSON.parse(jsonMatch[0]) as CharFix[];
          } catch { return []; }
        }));

        checked += superBatch.length;
        for (const fixes of results) {
          for (const fix of fixes) {
            const orig = allWords.find(w => w.id === fix.id);
            if (!orig) continue;
            const newRomaji = (fix.romaji || orig.romaji)
              .toLowerCase()
              .replace(/ā/g, "aa").replace(/ī/g, "ii").replace(/ū/g, "uu")
              .replace(/ē/g, "ee").replace(/ō/g, "oo")
              .replace(/[^a-z\-]/g, "");
            const newReading = fix.reading || orig.reading;
            if (newRomaji !== orig.romaji || newReading !== orig.reading) {
              fixQueue.push({ id: fix.id, reading: newReading, romaji: newRomaji, issues: fix.issues });
              send("fix", `問題検出:「${orig.word}」 [${fix.issues}] → ${orig.romaji}→${newRomaji}`);
            }
          }
        }
        if (suspiciousWords.length > 0) {
          send("progress", `${Math.min(checked, suspiciousWords.length)}/${suspiciousWords.length}語AI検査済み...`);
        }
      }

      send("apply", `${fixQueue.length}件の問題を修正中...`);
      for (const fix of fixQueue) {
        const orig = allWords.find(w => w.id === fix.id)!;
        const newVowels = extractVowels(fix.romaji);
        await updateWord(fix.id, {
          word: orig.word, reading: fix.reading, romaji: fix.romaji,
          vowels: newVowels, charCount: fix.reading.length,
        });
        fixed++;
      }

      const elapsedMs = Date.now() - startTime;
      send("done", `文字整理完了: ${allWords.length}語検査、${fixed}語修正`);
      if (!disconnected) {
        res.write(`data: ${JSON.stringify({ type: "result", checked: allWords.length, fixed, elapsedMs })}\n\n`);
      }
    } catch (error) {
      console.error("Char check error:", error);
      if (!disconnected) res.write(`data: ${JSON.stringify({ type: "error", error: "文字整理に失敗しました" })}\n\n`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (!disconnected) res.end();
    }
  });

  app.get("/api/favorites/integrity-check", async (req, res) => {
    try {
      const allWords = await getAllWords();

      function countVowelKana(reading: string): number {
        const skipSet = new Set(["ん","っ","ゃ","ゅ","ょ","ぁ","ぃ","ぅ","ぇ","ぉ","ャ","ュ","ョ","ァ","ィ","ゥ","ェ","ォ","ッ","ン","ー","・"," ","　"]);
        let count = 0;
        for (const ch of reading) {
          if (!skipSet.has(ch) && /[\u3040-\u30ff]/.test(ch)) count++;
        }
        return count;
      }

      function countVowelsInRomaji(romaji: string): number {
        return (romaji.toLowerCase().match(/[aeiou]/g) || []).length;
      }

      function reExtractVowels(romaji: string): string {
        const r = romaji.toLowerCase();
        let result = "";
        for (let i = 0; i < r.length; i++) {
          if ("aeiou".includes(r[i])) {
            result += r[i];
          } else if (r[i] === "n") {
            const next = r[i + 1];
            if (!next || !"aeiou".includes(next)) result += "n";
          }
        }
        return result;
      }

      function hasInvalidRomajiChars(romaji: string): boolean {
        return /[^a-z\-_']/.test(romaji.toLowerCase());
      }

      const vowelIssues: { id: number; word: string; reading: string; romaji: string; expectedVowels: number; actualVowels: number }[] = [];
      const romajiIssues: { id: number; word: string; romaji: string; storedVowels: string; computedVowels: string; hasInvalidChars: boolean }[] = [];

      for (const w of allWords) {
        const expectedVowelCount = countVowelKana(w.reading);
        const actualVowelCount = countVowelsInRomaji(w.romaji);
        if (actualVowelCount < expectedVowelCount) {
          vowelIssues.push({ id: w.id, word: w.word, reading: w.reading, romaji: w.romaji, expectedVowels: expectedVowelCount, actualVowels: actualVowelCount });
        }

        const computedVowels = reExtractVowels(w.romaji);
        const invalidChars = hasInvalidRomajiChars(w.romaji);
        if (computedVowels !== w.vowels || invalidChars) {
          romajiIssues.push({ id: w.id, word: w.word, romaji: w.romaji, storedVowels: w.vowels, computedVowels, hasInvalidChars: invalidChars });
        }
      }

      res.json({ total: allWords.length, vowelIssues, romajiIssues });
    } catch (error) {
      console.error("Integrity check error:", error);
      res.status(500).json({ error: "整合性チェックに失敗しました" });
    }
  });

  type TailDupItem = { id: number; word: string; reading: string; romaji: string; vowels: string; charCount: number; protected?: boolean };

  async function aiTailDedup(
    buckets: Record<string, TailDupItem[]>,
    toDelete: Set<number>,
    send: (step: string, detail: string) => void,
    protectNone: boolean
  ): Promise<{ deletedCount: number }> {
    let tailDupCount = 0;
    const PARALLEL = 8;

    // ===== 文字列切り取りによるサブストリングマッチングを廃止 =====
    // 代わりにAIが各ワードの「末尾/先頭の意味的単語」を直接特定するアプローチを採用。
    // これにより文字数に依存しない正確なグループ化が可能になる。

    const groupsToScan = Object.entries(buckets)
      .map(([key, words]) => ({ key, words: words.filter(w => !toDelete.has(w.id)) }))
      .filter(g => g.words.length >= 2 && (protectNone || g.words.some(w => !w.protected)));

    send("check4", `${groupsToScan.length}グループをAIで末尾/先頭単語分析中...`);

    type EndingGroup = { shared: string; reading?: string; position?: "suffix" | "prefix"; ending?: string; words: string[]; readingSuffix?: string };
    const aiEndingGroups: { key: string; endings: EndingGroup[]; srcWords: TailDupItem[] }[] = [];

    for (let b = 0; b < groupsToScan.length; b += PARALLEL) {
      const batch = groupsToScan.slice(b, b + PARALLEL);
      const results = await Promise.all(batch.map(async g => {
        const wordList = g.words.map(w => `${w.word}（${w.reading}）`).join("\n");
        const prompt = `以下の悪口ワードリストを分析し、「末尾または先頭に同じ意味的単語を持つ」グループを特定せよ。

【判定ルール】
ワード全体の文脈を理解し、「どこまでが一つの意味的単語か」を正確に判断せよ。
文字数に関係なく、意味のある単語のまとまりで判断すること。

【末尾単語の例】
・「友ゼロ人間」→ 末尾単語は「人間」（にんげん）
・「陰口専門」→ 末尾単語は「専門」（せんもん）
・「無能の王様」→ 末尾単語は「王様」（おうさま）
・「ゴミ溜め体」→ 末尾単語は「体」（からだ）
・「醜い肉の山」→ 末尾単語は「山」（やま）
・「役立たずの見本」→ 末尾単語は「見本」（みほん）
・「陰湿な魂胆」→ 末尾単語は「魂胆」（こんたん）

【グループ化の対象】
・末尾(suffix): 末尾の意味的単語が同じ（「体」「からだ」「身体」は読みが同じなので同一グループ）
・先頭(prefix): 先頭の意味的単語が同じ（「ゴミ顔」「ゴミ野郎」→ 先頭「ゴミ」共通）

【グループ化しないもの】
・末尾が助詞: の・が・を・は・に・で・と・や
・末尾が助動詞・活用語尾: ない・てる・する・いる・など
・完全に異なる末尾単語（例: 「体」と「頭」は別グループ）

ワード一覧（表記/読み）:
${wordList}

同じ末尾/先頭単語を持つグループのみJSON配列で出力。グループなしなら[]。
[{"shared":"共通単語の表記","reading":"共通単語の読み（ひらがな）","position":"suffix","words":["ワード1","ワード2"]}]`;
        try {
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 2048 });
          const text = result?.text || "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) return [];
          return (JSON.parse(jsonMatch[0]) as EndingGroup[]).map(e => ({
            ...e,
            ending: e.shared || e.ending || "",
            readingSuffix: e.reading || e.readingSuffix || ""
          }));
        } catch { return []; }
      }));
      for (let i = 0; i < batch.length; i++) {
        const endings = (results[i] || []).filter((e: EndingGroup) =>
          e.words && e.words.length >= 2 && (e.shared || e.ending) && [...(e.shared || e.ending || "")].length >= 1
        );
        if (endings.length > 0) {
          aiEndingGroups.push({ key: batch[i].key, endings, srcWords: batch[i].words });
        }
      }
      if (b + PARALLEL < groupsToScan.length) {
        send("check4", `末尾単語分析中... (${Math.min(b + PARALLEL, groupsToScan.length)}/${groupsToScan.length}グループ完了)`);
      }
    }

    type PickTask = { candidates: TailDupItem[]; ending: string };
    const pickTasks: PickTask[] = [];
    const processedGroupKeys = new Set<string>();

    for (const eg of aiEndingGroups) {
      for (const ending of eg.endings) {
        const sharedStr = ending.shared || ending.ending || "";
        const rsuffix = ending.readingSuffix || ending.reading || "";
        const isPrefix = ending.position === "prefix";
        const candidates = eg.srcWords.filter(w => {
          if (toDelete.has(w.id)) return false;
          if (ending.words.includes(w.word)) return true;
          if (rsuffix) {
            if (isPrefix ? w.reading.startsWith(rsuffix) : w.reading.endsWith(rsuffix)) return true;
          }
          return false;
        });
        if (candidates.length < 2) continue;
        const key = candidates.map(w => w.id).sort().join(",");
        if (processedGroupKeys.has(key)) continue;
        processedGroupKeys.add(key);
        const posLabel = isPrefix ? "先頭" : "末尾";
        send("check4", `「${sharedStr}」系(AI ${posLabel}検出) ${candidates.length}個検出`);
        pickTasks.push({ candidates, ending: sharedStr });
      }
    }

    // 長いサフィックス（より具体的）を優先処理
    pickTasks.sort((a, b) => b.ending.length - a.ending.length);

    // 勝者IDセット: 一度でも「残す」として選ばれたワードは他のグループで削除しない
    const tailKeptIds = new Set<number>();

    for (let p = 0; p < pickTasks.length; p += PARALLEL) {
      const pickBatch = pickTasks.slice(p, p + PARALLEL);
      const pickResults = await Promise.all(pickBatch.map(async t => {
        // 既に削除対象 or 既に勝者として確定済みのワードを除外した候補
        const liveCandidates = t.candidates.filter(w => !toDelete.has(w.id));
        if (liveCandidates.length < 2) return liveCandidates[0]?.id ?? t.candidates[0].id;
        const prompt = `以下のワードから最も辛辣・強烈なパンチラインのワードを1個だけ選べ。選んだワードだけを出力（説明不要）:\n${liveCandidates.map(w => w.word).join("\n")}`;
        try {
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 64 });
          const best = (result?.text || "").trim().replace(/^「/, "").replace(/」$/, "").trim();
          const match = liveCandidates.find(w => w.word === best);
          return match ? match.id : liveCandidates[0].id;
        } catch { return liveCandidates[0].id; }
      }));
      for (let j = 0; j < pickBatch.length; j++) {
        const keepId = pickResults[j];
        tailKeptIds.add(keepId);
        let anyDeleted = false;
        let deletedCount = 0;
        for (const w of pickBatch[j].candidates) {
          if (w.id === keepId) continue;
          if (tailKeptIds.has(w.id)) continue; // 別グループで既に勝者に選ばれている
          if (toDelete.has(w.id)) continue;
          const isProtected = protectNone ? false : w.protected;
          if (!isProtected) { toDelete.add(w.id); tailDupCount++; deletedCount++; anyDeleted = true; }
        }
        if (anyDeleted) {
          const kept = pickBatch[j].candidates.find(w => w.id === keepId);
          send("check4", `「${pickBatch[j].ending}」→「${kept?.word || "?"}」残し、${deletedCount}個削除`);
        }
      }
    }

    return { deletedCount: tailDupCount };
  }

  app.post("/api/favorites/dedup-cleanup", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });

    try {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      heartbeat = setInterval(() => { if (!disconnected) res.write(": heartbeat\n\n"); }, 15000);
      const startTime = Date.now();

      const send = (step: string, detail: string) => {
        if (disconnected) return;
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed })}\n\n`);
      };

      send("dedup", "重複整理: 全ワードを取得中...");
      const allWords = await getAllWords();
      send("dedup", `${allWords.length}件を分析中（ワード完全一致・よみ完全一致・ローマ字完全一致）...`);

      const toDelete = new Set<number>();

      // チェック1: ワード（表記）の完全一致
      const seenWord = new Map<string, number>(); // normWord → first id
      let wordDupCount = 0;
      for (const w of allWords) {
        const norm = w.word.replace(/[\s\u3000]/g, "").toLowerCase();
        if (seenWord.has(norm)) {
          toDelete.add(w.id);
          wordDupCount++;
          console.log(`[DEDUP:word] "${w.word}" (id:${w.id}) 重複 → id:${seenWord.get(norm)}`);
        } else {
          seenWord.set(norm, w.id);
        }
      }
      send("check1", `ワード表記一致: ${wordDupCount}件`);

      // チェック2: 読み（ひらがな）の完全一致
      function normReading(s: string): string {
        return s.replace(/[ー・\s\u3000]/g, "").replace(/っ/g, "").replace(/を/g, "お").toLowerCase();
      }
      const seenReading = new Map<string, number>();
      let readingDupCount = 0;
      for (const w of allWords) {
        if (toDelete.has(w.id)) continue;
        const norm = normReading(w.reading);
        if (norm.length === 0) continue;
        if (seenReading.has(norm)) {
          toDelete.add(w.id);
          readingDupCount++;
          console.log(`[DEDUP:reading] "${w.word}" (${w.reading}) 読み重複 → id:${seenReading.get(norm)}`);
        } else {
          seenReading.set(norm, w.id);
        }
      }
      send("check2", `読み一致: ${readingDupCount}件`);

      // チェック3: ローマ字（romaji）の完全一致
      const seenRomaji = new Map<string, number>();
      let romajiDupCount = 0;
      for (const w of allWords) {
        if (toDelete.has(w.id)) continue;
        const norm = w.romaji.replace(/[-\s]/g, "").toLowerCase();
        if (norm.length === 0) continue;
        if (seenRomaji.has(norm)) {
          toDelete.add(w.id);
          romajiDupCount++;
          console.log(`[DEDUP:romaji] "${w.word}" (${w.romaji}) ローマ字重複 → id:${seenRomaji.get(norm)}`);
        } else {
          seenRomaji.set(norm, w.id);
        }
      }
      send("check3", `ローマ字一致: ${romajiDupCount}件`);

      // --- check4: 末尾名詞重複（protected無視）---
      send("check4", "末尾名詞重複を検出中（protect無視）...");
      const dedupItems = allWords
        .filter(w => !toDelete.has(w.id))
        .map(w => ({
          id: w.id, word: w.word, reading: w.reading, romaji: w.romaji,
          vowels: w.vowels || "", charCount: w.charCount,
          protected: w.protected ?? false,
        }));
      const dedupBuckets: Record<string, typeof dedupItems> = {};
      for (const item of dedupItems) {
        const key = item.vowels.length >= 2 ? item.vowels.slice(-2) : item.vowels || "_";
        (dedupBuckets[key] ??= []).push(item);
      }
      const tailResult = await aiTailDedup(dedupBuckets, toDelete, send, true);

      const total = wordDupCount + readingDupCount + romajiDupCount + tailResult.deletedCount;
      if (total === 0) {
        send("done", "重複なし。データベースはクリーンな状態です。");
      } else {
        send("delete", `合計 ${total}件 (表記:${wordDupCount} + 読み:${readingDupCount} + ローマ字:${romajiDupCount} + 末尾名詞:${tailResult.deletedCount}) を削除中...`);
        await deleteWords([...toDelete]);
      }

      const remaining = await getWordCount();
      const elapsedMs = Date.now() - startTime;
      res.write(`data: ${JSON.stringify({ type: "result", deleted: total, total: remaining, elapsedMs })}\n\n`);
    } catch (error) {
      console.error("Dedup cleanup error:", error);
      if (!disconnected) res.write(`data: ${JSON.stringify({ type: "error", error: "重複整理に失敗しました" })}\n\n`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (!disconnected) res.end();
    }
  });

  app.post("/api/favorites/cleanup", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const startTime = Date.now();
      let currentStep = "";

      function send(step: string, detail: string) {
        if (disconnected) return;
        currentStep = step;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail, elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      heartbeat = setInterval(() => {
        if (disconnected) { if (heartbeat) clearInterval(heartbeat); return; }
        res.write(`data: ${JSON.stringify({ type: "progress", step: currentStep, detail: "処理継続中...", elapsed: formatElapsed(Date.now() - startTime) })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      }, 5000);

      send("init", "データベース分析中...");

      const allDbWords = await getAllWords();
      const items = allDbWords.map(w => {
        const computedVowels = extractVowels(w.romaji);
        return {
          id: w.id, word: w.word, reading: w.reading, romaji: w.romaji,
          vowels: computedVowels,
          dbVowels: w.vowels,
          charCount: w.charCount,
          protected: w.protected ?? false,
        };
      });

      const buckets: Record<string, typeof items> = {};
      for (const item of items) {
        const key = item.vowels.length >= 2 ? item.vowels.slice(-2) : item.vowels || "_";
        (buckets[key] ??= []).push(item);
      }

      send("init", `${Object.keys(buckets).length}グループ, ${items.length}語を分析`);

      const toDelete = new Set<number>();

      send("check1", "チェック1: DBのvowelsフィールドとromaji計算値の不一致を検出中...");
      let wrongVowelCount = 0;
      for (const item of items) {
        if (item.dbVowels !== item.vowels) {
          wrongVowelCount++;
          console.log(`[CLEANUP:vowel] "${item.word}" db_vowels=${item.dbVowels} computed=${item.vowels} — DB更新が必要`);
          await updateWord(item.id, { word: item.word, reading: item.reading, romaji: item.romaji, vowels: item.vowels, charCount: item.charCount });
        }
      }
      send("check1", `DBvowels不一致: ${wrongVowelCount}個（修正済み）`);

      send("check2", "チェック2: 表記違い重複を検出中...");
      let scriptDupCount = 0;

      function normalizeReading(s: string): string {
        return s
          .replace(/[ー・\s\-]/g, "")
          .replace(/っ/g, "")
          .replace(/を/g, "お")
          .replace(/[ぁぃぅぇぉ]/g, c => ({ "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お" }[c] || c))
          .toLowerCase();
      }

      for (const [groupKey, groupWords] of Object.entries(buckets)) {
        const alive = groupWords.filter(w => !toDelete.has(w.id));
        const readingMap = new Map<string, typeof alive[0]>();
        for (const w of alive) {
          const normalized = normalizeReading(w.reading);
          if (readingMap.has(normalized)) {
            toDelete.add(w.id);
            scriptDupCount++;
            console.log(`[CLEANUP:script] "${w.word}" ≈ "${readingMap.get(normalized)!.word}" (reading: ${normalized}) [${groupKey}]`);
          } else {
            readingMap.set(normalized, w);
          }
        }

        const aliveAfter = groupWords.filter(w => !toDelete.has(w.id));
        const romajiMap = new Map<string, typeof aliveAfter[0]>();
        for (const w of aliveAfter) {
          const normRomaji = w.romaji.replace(/[\-\s]/g, "").toLowerCase();
          if (romajiMap.has(normRomaji)) {
            toDelete.add(w.id);
            scriptDupCount++;
            console.log(`[CLEANUP:romaji] "${w.word}" ≈ "${romajiMap.get(normRomaji)!.word}" (romaji: ${normRomaji}) [${groupKey}]`);
          } else {
            romajiMap.set(normRomaji, w);
          }
        }

        const aliveAfterRomaji = groupWords.filter(w => !toDelete.has(w.id));
        for (let i = 0; i < aliveAfterRomaji.length; i++) {
          if (toDelete.has(aliveAfterRomaji[i].id)) continue;
          const w1wordNorm = normalizeReading(aliveAfterRomaji[i].word);
          const w1readNorm = normalizeReading(aliveAfterRomaji[i].reading);
          for (let j = i + 1; j < aliveAfterRomaji.length; j++) {
            if (toDelete.has(aliveAfterRomaji[j].id)) continue;
            const w2wordNorm = normalizeReading(aliveAfterRomaji[j].word);
            const w2readNorm = normalizeReading(aliveAfterRomaji[j].reading);
            if (w1wordNorm === w2readNorm || w1readNorm === w2wordNorm) {
              toDelete.add(aliveAfterRomaji[j].id);
              scriptDupCount++;
              console.log(`[CLEANUP:cross] "${aliveAfterRomaji[j].word}" ≈ "${aliveAfterRomaji[i].word}" [${groupKey}]`);
            }
          }
        }
      }
      send("check2", `表記違い重複: ${scriptDupCount}個`);

      send("check2b", "チェック2b: 語尾バリエーション重複を検出中...");
      let endingVarCount = 0;
      const endingBaseGlobal = new Map<string, typeof items[0]>();
      for (const [groupKey, groupWords] of Object.entries(buckets)) {
        const alive = groupWords.filter(w => !toDelete.has(w.id));
        for (const w of alive) {
          const base = getEndingBase(w.reading);
          if (!base) continue;
          if (endingBaseGlobal.has(base)) {
            const existing = endingBaseGlobal.get(base)!;
            if (w.protected && !existing.protected) {
              toDelete.add(existing.id);
              endingBaseGlobal.set(base, w);
              endingVarCount++;
              console.log(`[CLEANUP:ending-var] "${existing.word}" → "${w.word}" (語尾バリエーション、確定優先) [${groupKey}]`);
            } else {
              toDelete.add(w.id);
              endingVarCount++;
              console.log(`[CLEANUP:ending-var] "${w.word}" → "${existing.word}" (語尾バリエーション) [${groupKey}]`);
            }
          } else {
            endingBaseGlobal.set(base, w);
          }
        }
      }
      send("check2b", `語尾バリエーション重複: ${endingVarCount}個`);

      send("check3", "チェック3: ローマ字完全一致の重複を検出中...");
      let romajiDupCount = 0;
      const globalRomajiMap = new Map<string, typeof items[0]>();
      for (const item of items) {
        if (toDelete.has(item.id)) continue;
        const normRomaji = item.romaji.replace(/[-\s]/g, "").toLowerCase();
        if (normRomaji.length === 0) continue;
        if (globalRomajiMap.has(normRomaji)) {
          const existing = globalRomajiMap.get(normRomaji)!;
          if (item.protected && !existing.protected) {
            toDelete.add(existing.id);
            globalRomajiMap.set(normRomaji, item);
          } else {
            toDelete.add(item.id);
          }
          romajiDupCount++;
          console.log(`[CLEANUP:romaji-global] "${item.word}" ローマ字重複`);
        } else {
          globalRomajiMap.set(normRomaji, item);
        }
      }
      send("check3", `ローマ字完全一致重複: ${romajiDupCount}個`);

      // ─── チェック3b: バケツ内「意味のまとまり単語」重複をAI検出 ───
      send("check3b", "チェック3b: 意味単位（名詞）重複をAI検出中...");
      let meaningUnitDupCount = 0;
      const groupsForMU = Object.entries(buckets)
        .map(([key, bWords]) => ({ key, words: bWords.filter(w => !toDelete.has(w.id)) }))
        .filter(g => g.words.length >= 3);

      const MU_PARALLEL = 6;
      for (let mb = 0; mb < groupsForMU.length; mb += MU_PARALLEL) {
        if (disconnected) break;
        const muBatch = groupsForMU.slice(mb, mb + MU_PARALLEL);
        await Promise.all(muBatch.map(async (g) => {
          try {
            const rawSet = new Set(g.words.map(w => w.word));
            const wordList = g.words.map(w => w.word).join("\n");
            const muResult = await aiGenerate(`以下の悪口ワードリストを精査せよ。

【重要な前提】
これは「韻（ライム）のデータベース」である。
「同じ末尾の言葉」が並んでいるのは「同じ単語を繰り返しているだけ」であり、それは韻ではなく重複である。
例: 「友ゼロ人間」「価値ゼロ人間」「理解ゼロ人間」→ 全員「人間」で終わっている = 末尾が全く同じ単語 = 重複

【作業手順】
STEP1: 全ワードを読み、各ワードの「末尾の意味的単語」を特定せよ。
  ・「この身体」→ 末尾単語は「身体」
  ・「この体」→ 末尾単語は「体」（「身体」と「体」は同義 = 同一グループ）
  ・「友ゼロ人間」「価値ゼロ人間」→ 末尾単語はどちらも「人間」= 同一グループ
  ・先頭単語も同様に判定（「クソ顔」「クソ野郎」→ 先頭「クソ」共通）

STEP2: 末尾（または先頭）が同じ単語・同義語のグループを特定せよ。
STEP3: 各グループの中で最も辛辣・インパクトの強いパンチラインを1個だけ残し、他は削除。
STEP4: どのグループにも属さないワードは全て残せ。

【削除例】
入力: 友ゼロ人間 / 価値ゼロ人間 / 理解ゼロ人間 / 人望ゼロ人間 / 貢献ゼロ人間
全員「人間」で終わる → グループ化 → 最もパンチライン1個を残し4個削除

入力: 陰口専門 / 穀潰し専門 / 悪巧み専門 / 仕事放棄専門
全員「専門」で終わる → グループ化 → 最もパンチライン1個を残し3個削除

【厳守事項】
・出力は元の表記そのまま（変換・書き換え禁止）
・グループ内で最も印象的な1個のみ残す
・グループに属さないワードは残す

ワードリスト:
${wordList}

残すワードのみ出力（1行1個、元の表記そのまま、番号・説明一切不要）:`,
              { ...geminiConfig, maxOutputTokens: 4096 });
            const text = muResult?.text || "";
            const kept = text.split("\n")
              .map((l: string) => l.trim().replace(/^「/, "").replace(/」$/, "").replace(/^\d+[\.\)）、]\s*/, "").replace(/^[・●▸►\-]\s*/, "").replace(/\s*\[確定\]/, "").trim())
              .filter((l: string) => l.length > 0 && rawSet.has(l));
            const keptSet = new Set(kept);
            if (keptSet.size < g.words.length * 0.35) {
              console.log(`[CHECK3b:${g.key}] AI returned too few (${keptSet.size}/${g.words.length}), skipping`);
              return;
            }
            let deleted = 0;
            for (const w of g.words) {
              if (!keptSet.has(w.word) && !toDelete.has(w.id)) {
                toDelete.add(w.id);
                deleted++;
                meaningUnitDupCount++;
                console.log(`[CHECK3b:${g.key}] "${w.word}"${w.protected ? "(protected)" : ""} → 意味単位重複削除`);
              }
            }
            if (deleted > 0) send("check3b", `[${g.key}] ${deleted}個削除（意味単位重複）`);
          } catch (err) {
            console.log(`[CHECK3b] AI failed for group ${g.key}:`, err);
          }
        }));
        if (mb + MU_PARALLEL < groupsForMU.length) {
          send("check3b", `意味単位重複検出中... (${Math.min(mb + MU_PARALLEL, groupsForMU.length)}/${groupsForMU.length}グループ完了)`);
        }
      }
      send("check3b", `意味単位（名詞）重複: ${meaningUnitDupCount}個`);

      send("check4", "チェック4: 末尾単語一致をAI検出中...");
      const check4Result = await aiTailDedup(buckets, toDelete, send, true);
      send("check4", `末尾重複: ${check4Result.deletedCount}個`);

      send("check5", "チェック5: 意味的重複をAI検出中...");
      let semanticDupCount = 0;
      const groupsToCheck = Object.entries(buckets)
        .map(([key, words]) => ({ key, words: words.filter(w => !toDelete.has(w.id)) }))
        .filter(g => g.words.length >= 2);

      send("check5", `${groupsToCheck.length}グループを意味重複チェック`);

      const SEMANTIC_PARALLEL = 8;
      for (let b = 0; b < groupsToCheck.length; b += SEMANTIC_PARALLEL) {
        const batch = groupsToCheck.slice(b, b + SEMANTIC_PARALLEL);
        await Promise.all(batch.map(async (g) => {
          try {
            const wordList = g.words.map(w => w.word).join("\n");
            const semResult = await aiGenerate(`以下の日本語悪口ワード一覧から「意味がほぼ同じ」「表現違いだけの重複」ペアを全て見つけよ。
インパクトがある方を残し、弱い方を削除せよ。

検出すべき重複の例:
- 「うっせーよ」と「うるせえよ」→ 同じ意味の別表現→片方削除
- 「生きてる価値なし」と「生きる価値なし」→ 活用違いの同義語→片方削除
- 「存在価値なし」と「生きる価値なし」→ 同じ概念の別表現→片方削除
- 漢字とひらがなの表記違い→片方削除

重複が無ければ「なし」とだけ出力。重複があれば以下の形式で出力（1グループ1行）:
残す:ワード / 削除:ワード,ワード

ワード一覧:
${wordList}`);
            const text = (semResult.text || "").trim();
            if (text === "なし" || !text.includes("削除")) return;

            for (const line of text.split("\n")) {
              const deleteMatch = line.match(/削除[:：]\s*(.+)/);
              if (!deleteMatch) continue;
              const deleteWordsList = deleteMatch[1].split(/[,、，]/).map(w => w.trim().replace(/^「/, "").replace(/」$/, "").trim());
              for (const dw of deleteWordsList) {
                const match = g.words.find(w => w.word === dw);
                if (match && !toDelete.has(match.id)) {
                  toDelete.add(match.id);
                  semanticDupCount++;
                  console.log(`[CLEANUP:semantic] "${match.word}"${match.protected ? "(protected)" : ""} → 意味的重複削除 [${g.key}]`);
                }
              }
            }
          } catch (err) {
            console.log(`[CLEANUP:semantic] AI failed for group ${g.key}:`, err);
          }
        }));
        if (b + SEMANTIC_PARALLEL < groupsToCheck.length) {
          send("check5", `意味的重複検出中... (${Math.min(b + SEMANTIC_PARALLEL, groupsToCheck.length)}/${groupsToCheck.length}グループ完了)`);
        }
      }
      send("check5", `意味的重複: ${semanticDupCount}個`);

      const deleteArray = Array.from(toDelete);
      let totalDeleted = 0;
      if (deleteArray.length > 0) {
        totalDeleted = await deleteWords(deleteArray);
        send("delete", `合計${totalDeleted}個を削除`);
      }

      const survivingIds = items.filter(w => !toDelete.has(w.id)).map(w => w.id);
      if (survivingIds.length > 0) {
        await markWordsProtected(survivingIds);
        send("protect", `${survivingIds.length}語を確定済みにマーク`);
      }

      if (heartbeat) clearInterval(heartbeat);
      const finalCount = await getWordCount();
      const summary = `母音不一致${wrongVowelCount} + 表記重複${scriptDupCount} + 語尾バリエーション${endingVarCount} + ローマ字重複${romajiDupCount} + 意味単位重複${meaningUnitDupCount} + 末尾重複${check4Result.deletedCount} + 意味重複${semanticDupCount} = ${totalDeleted}個削除`;
      send("done", `整理完了: ${summary} (残り${finalCount}語, ${formatElapsed(Date.now() - startTime)})`);

      if (!disconnected) {
        res.write(`data: ${JSON.stringify({ type: "result", deleted: totalDeleted, merged: 0, total: finalCount, elapsedMs: Date.now() - startTime })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
        res.end();
      }
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      console.error("Cleanup error:", error);
      if (!disconnected) {
        try { res.write(`data: ${JSON.stringify({ type: "error", error: "整理に失敗しました" })}\n\n`); res.end(); }
        catch { try { res.status(500).json({ error: "整理に失敗しました" }); } catch {} }
      }
    }
  });

  app.post("/api/favorites/analyze-endings", async (req, res) => {
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnected = false;
    res.on("close", () => { disconnected = true; if (heartbeat) clearInterval(heartbeat); });

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      heartbeat = setInterval(() => { if (!disconnected) res.write(`: heartbeat\n\n`); }, 5000);

      const send = (step: string, detail: string) => {
        if (disconnected) return;
        res.write(`data: ${JSON.stringify({ type: "progress", step, detail })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      };

      send("init", "DB全ワードを取得中...");
      const allWords = await getAllWords();
      send("init", `${allWords.length}語の末尾名詞を分析中...`);

      const BATCH = 60;
      const PARALLEL = 10;
      const endingMap = new Map<string, number>();
      const batches: typeof allWords[] = [];
      for (let i = 0; i < allWords.length; i += BATCH) batches.push(allWords.slice(i, i + BATCH));

      for (let b = 0; b < batches.length; b += PARALLEL) {
        if (disconnected) break;
        const chunk = batches.slice(b, b + PARALLEL);
        send("analyze", `分析中... (${Math.min(b, batches.length)}/${batches.length}バッチ)`);
        await Promise.all(chunk.map(async (batch) => {
          const lines = batch.map(w => w.word).join("\n");
          const prompt = `以下の悪口ワードについて、それぞれの「末尾にある意味のまとまりとしての主要な名詞・単語」を1つ特定せよ。助詞・助動詞・活用語尾は除外し、名詞として成立する末尾単語のみ返せ。

例:
- 「ポンコツ野郎」→ 野郎
- 「無能な役立たず」→ 役立たず
- 「豆腐メンタル」→ メンタル
- 「顔面崩壊」→ 崩壊
- 「存在価値ゼロ」→ 価値ゼロ

ワード一覧:
${lines}

JSON配列で出力（全ワード分必須、名詞として成立しない場合は"t":""）:
[{"w":"元のワード","t":"末尾名詞"}]`;
          try {
            const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 4096 });
            const text = result?.text || "";
            const jsonMatch = text.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) return;
            type EP = { w: string; t: string };
            const pairs = JSON.parse(jsonMatch[0]) as EP[];
            for (const p of pairs) {
              const tail = (p.t || "").trim();
              if (tail.length >= 2) endingMap.set(tail, (endingMap.get(tail) ?? 0) + 1);
            }
          } catch { }
        }));
      }

      const top30 = [...endingMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([word, count]) => ({ word, count }));

      if (!disconnected) {
        res.write(`data: ${JSON.stringify({ type: "result", rankings: top30, total: allWords.length })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
        res.end();
      }
    } catch (error) {
      if (heartbeat) clearInterval(heartbeat);
      console.error("Analyze endings error:", error);
      if (!disconnected) { try { res.write(`data: ${JSON.stringify({ type: "error", error: "分析に失敗しました" })}\n\n`); res.end(); } catch {} }
    }
  });

  app.post("/api/favorites/paste", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") return res.status(400).json({ error: "テキストが必要です" });
      const entries = parseWordEntries(text);
      if (entries.length === 0) return res.status(400).json({ error: "有効なワードが見つかりません。形式: ワード/ひらがな(romaji)" });
      const ngList = await getNgWordStrings();
      const filtered = entries.filter(w => !ngList.some(ng => w.word.endsWith(ng)));
      const added = await addWords(filtered.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji, vowels: extractVowels(w.romaji), charCount: w.reading.length })));
      res.json({ added, total: await getWordCount() });
    } catch { res.status(500).json({ error: "追加に失敗しました" }); }
  });

  app.post("/api/ng-words/paste", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") return res.status(400).json({ error: "テキストが必要です" });
      const terms = text.split(/[\n,、，\s]+/).map(s => s.trim()).filter(s => s.length > 0);
      if (terms.length === 0) return res.status(400).json({ error: "有効な単語が見つかりません" });
      const added = await addNgWords(terms.map(w => ({ word: w, reading: "", romaji: "" })));
      res.json({ added, total: await getNgWordCount() });
    } catch { res.status(500).json({ error: "追加に失敗しました" }); }
  });

  app.get("/api/ng-words/export-json", async (_req, res) => {
    try {
      const words = await getAllNgWords();
      const data = { version: 1, exportedAt: new Date().toISOString(), words: words.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji })) };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ng-words-${new Date().toISOString().slice(0, 10)}.json"`);
      res.send(JSON.stringify(data, null, 2));
    } catch { res.status(500).json({ error: "エクスポートに失敗しました" }); }
  });

  app.post("/api/ng-words/import-json", async (req, res) => {
    try {
      const { words } = req.body;
      if (!Array.isArray(words) || words.length === 0) return res.status(400).json({ error: "有効なNG単語データが見つかりません" });
      const entries = words.map((w: any) => ({ word: String(w.word || w), reading: String(w.reading || ""), romaji: String(w.romaji || "") })).filter((w: any) => w.word.length > 0);
      if (entries.length === 0) return res.status(400).json({ error: "有効なNG単語が見つかりません" });
      const added = await addNgWords(entries);
      res.json({ added, total: await getNgWordCount() });
    } catch { res.status(500).json({ error: "インポートに失敗しました" }); }
  });

  app.post("/api/ng-words/cleanup", async (req, res) => {
    try {
      const allNgWords = await getAllNgWords();
      if (allNgWords.length === 0) return res.json({ deleted: 0, remaining: 0 });

      const BATCH = 80;
      const toDeleteIds: number[] = [];

      for (let i = 0; i < allNgWords.length; i += BATCH) {
        const chunk = allNgWords.slice(i, i + BATCH);
        const prompt = `以下の単語リストを判定せよ。「辞書に載っている独立した単語」であれば合格。

【合格（単独で意味が通る単語）】
名詞・固有表現: 顔、野郎、人間、ゴミ、脳みそ、アホ、バカ、クズ、豚、塊、者、面、玉 など
単独で意味が完結する言葉なら合格。

【不合格（それ単体では意味不明・断片）】
・助詞・助動詞: な、だ、わ、よ、ね、て、で、か、の、を、は、が、に
・意味のない断片: ぐん、ぶん、くりん、りん、のう（単体では脳だが文脈なければ断片）など
・活用形の末尾だけ: てる、てた、られ、する、いる

判定対象:
${chunk.map((w, idx) => `${idx + 1}. ${w.word}`).join("\n")}

合格のもの番号のみJSON配列で返せ（例: [1,3,5]）。全て不合格なら[]:`;

        try {
          const result = await aiGenerate(prompt, { ...geminiConfig, maxOutputTokens: 512 });
          const text = result?.text || "";
          const match = text.match(/\[[\s\S]*?\]/);
          if (match) {
            const validIdxs = JSON.parse(match[0]) as number[];
            const validIds = new Set(
              validIdxs.filter(idx => idx >= 1 && idx <= chunk.length).map(idx => chunk[idx - 1].id)
            );
            for (const w of chunk) {
              if (!validIds.has(w.id)) toDeleteIds.push(w.id);
            }
          }
        } catch { /* keep all on error */ }
      }

      if (toDeleteIds.length > 0) await deleteNgWords(toDeleteIds);
      const remaining = await getNgWordCount();
      res.json({ deleted: toDeleteIds.length, remaining });
    } catch { res.status(500).json({ error: "NG整理に失敗しました" }); }
  });

  app.get("/api/favorites/export-pdf", async (_req, res) => {
    try {
      const pdfLib = await import("pdf-lib");
      const { PDFDocument, StandardFonts, rgb } = pdfLib;
      const allWords = await getAllWords();
      const totalCount = allWords.length;

      const groups: Record<string, typeof allWords> = {};
      for (const w of allWords) {
        const v = w.vowels || "";
        if (!groups[v]) groups[v] = [];
        groups[v].push(w);
      }

      const jsonData = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        totalCount,
        words: allWords.map(w => ({ word: w.word, reading: w.reading, romaji: w.romaji, vowels: w.vowels, charCount: w.charCount })),
      });

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const addTextPages = (lines: string[]) => {
        let page = pdfDoc.addPage([595.28, 841.89]);
        let y = 800;
        for (let i = 0; i < lines.length; i++) {
          if (y < 40) {
            page = pdfDoc.addPage([595.28, 841.89]);
            y = 800;
          }
          const line = lines[i];
          if (line === "") { y -= 10; continue; }
          const fontSize = line.startsWith("##") ? 14 : line.startsWith("#") ? 18 : 10;
          const f = line.startsWith("#") ? fontBold : font;
          const text = line.replace(/^#+\s*/, "");
          try {
            page.drawText(text, { x: 40, y, size: fontSize, font: f, color: rgb(0.1, 0.1, 0.1) });
          } catch { /* skip non-encodable chars */ }
          y -= fontSize + 6;
        }
      };

      const statsLines = [
        "# DRG Database Export",
        `## Total Words: ${totalCount}`,
        "",
        `## Groups: ${Object.keys(groups).length}`,
        "",
      ];
      const groupKeys = Object.keys(groups).sort();
      for (const key of groupKeys) {
        const g = groups[key];
        statsLines.push(`[${key}] - ${g.length} words`);
        const romajiList = g.slice(0, 10).map(w => `  ${w.romaji}`);
        statsLines.push(...romajiList);
        if (g.length > 10) statsLines.push(`  ... and ${g.length - 10} more`);
        statsLines.push("");
      }
      addTextPages(statsLines);

      pdfDoc.setTitle("DRG Database Export");

      const pdfBytes = await pdfDoc.save();
      const dataMarker = "\n===DRG_DATA_START===\n";
      const dataEnd = "\n===DRG_DATA_END===\n";
      const jsonBuf = Buffer.from(dataMarker + jsonData + dataEnd, "utf-8");
      const combined = Buffer.concat([Buffer.from(pdfBytes), jsonBuf]);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="drg-database-${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(combined);
    } catch (err) {
      console.error("PDF export error:", err);
      res.status(500).json({ error: "PDFエクスポートに失敗しました" });
    }
  });

  app.post("/api/favorites/import-pdf", async (req, res) => {
    try {
      const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
      let totalSize = 0;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_UPLOAD_SIZE) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      await new Promise<void>((resolve, reject) => { req.on("end", resolve); req.on("error", reject); });

      if (totalSize > MAX_UPLOAD_SIZE) {
        return res.status(413).json({ error: "ファイルサイズが大きすぎます（最大50MB）" });
      }

      const pdfBuffer = Buffer.concat(chunks);
      const fileStr = pdfBuffer.toString("utf-8");
      const startMarker = "===DRG_DATA_START===";
      const endMarker = "===DRG_DATA_END===";
      const startIdx = fileStr.lastIndexOf(startMarker);
      if (startIdx === -1) {
        return res.status(400).json({ error: "DRGデータベースのPDFではありません" });
      }
      const endIdx = fileStr.indexOf(endMarker, startIdx);
      if (endIdx === -1) {
        return res.status(400).json({ error: "PDFデータが破損しています" });
      }

      const jsonStr = fileStr.slice(startIdx + startMarker.length, endIdx).trim();
      let data: any;
      try {
        data = JSON.parse(jsonStr);
      } catch {
        return res.status(400).json({ error: "PDFに含まれるデータが不正です" });
      }

      if (!data.words || !Array.isArray(data.words)) {
        return res.status(400).json({ error: "PDFに有効なワードデータが含まれていません" });
      }

      const ngList = await getNgWordStrings();
      const entries = data.words
        .filter((w: any) => w.word && w.reading && w.romaji)
        .filter((w: any) => !ngList.some((ng: string) => w.word.endsWith(ng)))
        .map((w: any) => ({
          word: w.word, reading: w.reading, romaji: w.romaji,
          vowels: w.vowels || extractVowels(w.romaji),
          charCount: w.charCount || w.reading.length,
        }));

      const added = await addWords(entries);
      res.json({ added, total: await getWordCount(), imported: entries.length });
    } catch (err) {
      console.error("PDF import error:", err);
      res.status(500).json({ error: "PDFインポートに失敗しました" });
    }
  });

  return httpServer;
}
