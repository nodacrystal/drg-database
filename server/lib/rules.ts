/**
 * DRGデータベース 共通ルール
 *
 * 生成時の重複審査、母音作成審査、DB送信時のグループ分け審査、
 * DB内での各種整理（グループ整理・重複整理・全て整理）全てで参照される。
 */

// ============================================================
// 悪口の6つのルール
// ============================================================
export const SIX_RULES = `[1] 小学生でもわかる言葉のみを使う。漢語・専門用語・難読語は一切禁止
[2] ターゲットの特徴から、悪口・指摘・挑発になる言葉を作成する
[3] 言葉は必ず「体言止め」にすること。名詞・名詞句で終わる。助詞・助動詞・形容詞語尾（〜い）・動詞活用形で終わるのは絶対禁止
[4] 商標権のある名前、有名人の名前などは使用しないこと
[5] 言葉のリズムが良いこと。声に出したとき語呂が良い
[6] 一度使われた単語は使用しないこと。同じ末尾の体言を持つワードを複数生成するな`;

// ============================================================
// 韻の定義
// ============================================================
export const RHYME_DEFINITION = `韻とは「末尾母音が一致しているが、母音一致箇所が意味の異なる言葉」である。
同じ言葉で母音が一致しているのは韻ではない。
したがって末尾の表現（〜の小ささ、〜そのもの、〜知らず、〜力なし、〜顔つき等）が
同じワードが複数存在してはならない。各末尾表現は1個だけ残すこと。`;

// ============================================================
// 体言止め違反の判定（プログラム的）
// ============================================================
export function isTaigenViolation(word: string, reading: string): boolean {
  const r = reading;
  // 〜い で終わる（ただし名詞として成立する末尾は除外）
  const validIEndings = [
    "あい", "かい", "がい", "ざい", "たい", "だい", "ない", "ばい", "まい", "らい", "わい",
    "ぜい", "けい", "せい", "ぐい", "るい", "つい", "すい", "くい", "ぬい", "ふい", "むい", "ゆい",
    "おい", "こい", "ごい", "そい", "とい", "どい", "のい", "ほい", "ぼい", "もい", "ろい",
  ];
  if (r.endsWith("い") && !validIEndings.some(e => r.endsWith(e))) return true;

  // 動詞・助動詞で終わる
  const verbEndings = ["しない", "できない", "されない", "てる", "する", "とる", "れる", "める", "ける", "せる", "ねる"];
  if (verbEndings.some(e => r.endsWith(e))) return true;

  // 助詞「な」で終わる（名詞「な」は短いので除外）
  if (word.endsWith("な") && word.length > 2) return true;

  return false;
}

// ============================================================
// 末尾単語の抽出（漢字/カタカナ末尾）
// ============================================================
export function extractEndingWord(word: string): string | null {
  const m = word.match(/[一-龯々ァ-ヶー]+$/);
  return m ? m[0] : null;
}

// ============================================================
// 修飾部の抽出（読みの前半4文字）
// ============================================================
export function extractModifierPrefix(reading: string): string | null {
  if (reading.length < 6) return null;
  return reading.slice(0, 4);
}

// ============================================================
// readingの正規化（スラッシュ混入・カタカナ混入の修正）
// ============================================================
export function sanitizeReading(word: string, reading: string, romaji: string): { word: string; reading: string; romaji: string; changed: boolean } {
  let newWord = word;
  let newReading = reading;
  let newRomaji = romaji;
  let changed = false;

  const kata2hira = (s: string) => s.replace(/[ァ-ヶ]/g, (c: string) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const hasSlash = (s: string) => s.includes("/") || s.includes("／");
  const isHiragana = (s: string) => /^[ぁ-ゟー]+$/.test(s);

  // スラッシュ混入の修正
  if (hasSlash(newWord) || hasSlash(newReading)) {
    const source = hasSlash(newWord) ? newWord : newReading;
    const parts = source.split(/[\/／]/);
    newWord = parts[0].trim();
    const readingCandidate = kata2hira(parts[parts.length - 1].trim());
    if (isHiragana(readingCandidate)) {
      newReading = readingCandidate;
    }
    changed = true;
  }

  // カタカナ→ひらがな変換
  if (!isHiragana(newReading)) {
    let converted = kata2hira(newReading);
    if (!isHiragana(converted)) converted = kata2hira(newWord);
    if (!isHiragana(converted)) converted = newWord;
    if (converted !== reading) { newReading = converted; changed = true; }
  }

  return { word: newWord, reading: newReading, romaji: newRomaji, changed };
}

// ============================================================
// 重複の定義（Claudeプロンプト用）
// ============================================================
export const DUPLICATE_DEFINITION = `【重複の定義（以下の全てが重複）】
1. 表記違いの同一語: 「独りよがり」「独り善がり」「一人よがり」→ 1個残す
2. 同じ前半部+似た末尾: 「自己評価甘」「自己評価高」→ 前半部同一→1個残す
3. 同じ末尾表現を共有: 「顔の小ささ」「気の小ささ」「目の小ささ」→ 末尾「の小ささ」同一→1個残す
4. 同じ末尾表現を共有: 「汚点そのもの」「公害そのもの」→ 末尾「そのもの」同一→1個残す
5. 同じ末尾表現を共有: 「能力なし」「実力なし」「行動力なし」→ 末尾「力なし」同一→1個残す
6. 同じ末尾表現を共有: 「恩知らず」「恥知らず」「世間知らず」→ 末尾「知らず」同一→1個残す
7. 同じ末尾表現を共有: 「不安な顔つき」「陰気な顔つき」→ 末尾「顔つき」同一→1個残す
8. 同じ概念の言い換え: 「社会不適応」「社会不適合」→ ほぼ同義→1個残す
9. 濁音/半濁音/活用の違いだけ: 「すぐ音を上げる」「すぐに音を上げる」→ 1個残す
10. ワード内に3文字以上の共通部分がある2つのワード→ 同じ言葉を共有→1個残す
11. 6つのルール違反: 「プライド高い」（形容詞語尾）「カビ生えとる」（方言）→ 削除

${RHYME_DEFINITION}`;

// ============================================================
// 2つの文字列の最長共通部分文字列の長さを返す
// ============================================================
export function longestCommonSubstring(s1: string, s2: string): number {
  let maxLen = 0;
  for (let i = 0; i < s1.length; i++) {
    for (let j = 0; j < s2.length; j++) {
      let k = 0;
      while (i + k < s1.length && j + k < s2.length && s1[i + k] === s2[j + k]) k++;
      if (k > maxLen) maxLen = k;
    }
  }
  return maxLen;
}

// ============================================================
// 有効な韻ペアかどうかの判定
// ============================================================
export function isValidRhymePairCheck(
  aWord: string, aReading: string, aVowels: string,
  bWord: string, bReading: string, bVowels: string,
  matchLen: number
): boolean {
  // 1. 読みの末尾部分が同じ → 韻ではない
  const aReadTail = aReading.slice(-matchLen);
  const bReadTail = bReading.slice(-matchLen);
  if (aReadTail === bReadTail) return false;

  // 2. ワード（表記）に3文字以上の共通部分文字列 → 韻ではない
  if (longestCommonSubstring(aWord, bWord) >= 3) return false;

  // 3. 読みに3文字以上の共通部分文字列 → 韻ではない
  if (longestCommonSubstring(aReading, bReading) >= 3) return false;

  // 4. 前半部が同じ → 韻ではない
  const aPrefix = aReading.slice(0, -Math.max(2, Math.ceil(matchLen * 0.4)));
  const bPrefix = bReading.slice(0, -Math.max(2, Math.ceil(matchLen * 0.4)));
  if (aPrefix.length >= 3 && aPrefix === bPrefix) return false;

  return true;
}
