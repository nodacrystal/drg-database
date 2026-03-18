export interface WordEntry { word: string; reading: string; romaji: string; }

export const ENDING_PARTICLE_GROUPS: string[][] = [
  ["だわな", "だわ", "やわ", "やな", "だな", "わな", "かな", "じゃな", "やんか", "やんな", "やんや", "だなあ", "やなあ"],
  ["だろな", "だろ", "やろな", "やろ", "じゃろ"],
  ["だぜ", "やで", "じゃで", "だぞ"],
  ["だよな", "だよ", "やん"],
  ["です", "っす"],
  ["だ", "や", "じゃ"],
];

export const ENDING_SUFFIX_GROUPS: string[][] = [
  ["奴だ", "奴や", "奴じゃ", "奴だわ", "奴やな", "奴だな", "奴だろ", "奴やろ", "奴だぜ", "奴やで"],
  ["男だ", "男や", "男だわ", "男やな", "男だな", "男だろ", "男やろ"],
  ["女だ", "女や", "女だわ", "女やな", "女だな"],
];

/**
 * 文章内の体言（名詞・名詞句）を抽出してソートした文字列を返す。
 * 動詞活用形（腐った→腐、歪んだ→歪）を除外し、真の名詞のみを対象とする。
 *
 * 抽出対象:
 *   1) 2文字以上の漢字連続（思考、威厳、愛情、偽善…）
 *   2) 漢字+体言橋渡し仮名(ち/き/り/み/し)+漢字 の複合名詞（持ち主、生き様…）
 *   3) 2文字以上のカタカナ語（外来語・固有名詞）
 *
 * 除外: 単独漢字（動詞語幹の腐/歪など）
 */
export function extractTaigen(word: string): string {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  // 1) 2文字以上の漢字連続（々含む）例: 思考, 段々, 無駄, 偽善
  const multiKanjiRe = /[\u4e00-\u9fff][\u4e00-\u9fff\u3005]+/g;
  while ((m = multiKanjiRe.exec(word)) !== null) found.push(m[0]);
  // 2) 漢字+橋渡し仮名+漢字の複合名詞（持ち主、生き様等）橋渡しは ち/き/り/み/し のみ
  const compoundRe = /[\u4e00-\u9fff][ちきりみし][\u4e00-\u9fff]+/g;
  while ((m = compoundRe.exec(word)) !== null) found.push(m[0]);
  // 3) 単独漢字の後に「の/を/が」が続く場合 → 明確な名詞（例: 肉の→肉）
  const singleKanjiBeforeParticleRe = /[\u4e00-\u9fff](?=[のをが])/g;
  while ((m = singleKanjiBeforeParticleRe.exec(word)) !== null) found.push(m[0]);
  // 4) 2文字以上のカタカナ語
  const katakanaRe = /[\u30a1-\u30f6ー]{2,}/g;
  while ((m = katakanaRe.exec(word)) !== null) found.push(m[0]);
  return [...new Set(found)].sort().join("|");
}

export function getEndingBase(reading: string): string | null {
  for (const group of ENDING_SUFFIX_GROUPS) {
    for (const ending of group) {
      if (reading.endsWith(ending)) {
        return reading.slice(0, -ending.length) + "@@" + ENDING_SUFFIX_GROUPS.indexOf(group);
      }
    }
  }
  for (const group of ENDING_PARTICLE_GROUPS) {
    for (const ending of group) {
      if (reading.endsWith(ending) && reading.length > ending.length + 1) {
        return reading.slice(0, -ending.length) + "##" + ENDING_PARTICLE_GROUPS.indexOf(group);
      }
    }
  }
  return null;
}

export function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function extractVowels(romaji: string): string {
  const r = romaji.toLowerCase();
  let result = "";
  for (let i = 0; i < r.length; i++) {
    if ("aeiou".includes(r[i])) {
      result += r[i];
    } else if (r[i] === "n") {
      const next = r[i + 1];
      if (!next || !"aeiou".includes(next)) {
        result += "n";
      }
    }
  }
  return result;
}

export function countMoraVowels(reading: string): number {
  const skipSet = new Set(["ん","っ","ゃ","ゅ","ょ","ぁ","ぃ","ぅ","ぇ","ぉ","ャ","ュ","ョ","ァ","ィ","ゥ","ェ","ォ","ッ","ン","ー","・"," ","　"]);
  let count = 0;
  for (const ch of reading) {
    if (!skipSet.has(ch) && /[\u3040-\u30ff]/.test(ch)) count++;
  }
  return count;
}

export const TAIGEN_VIOLATION_ENDINGS = [
  "てる", "でる", "てた", "でた", "てく", "でく", "てない", "でない",
  "ている", "でいる", "てきた", "てしまう", "てしまった",
  "する", "した", "れる", "せる", "られる", "させる",
  "だろ", "やろ", "やな", "やわ", "やで", "やん", "ねん", "やんか",
  "やんな", "わな", "じゃな", "じゃろ", "っちゃ", "やわ", "わい",
  "だわ", "だよ", "だね", "だぞ", "だか", "だぜ", "だな",
  "ます", "です", "でした", "ました",
];

export function quickCharCheck(words: WordEntry[]): WordEntry[] {
  return words.filter(w => {
    if (!w.reading || !w.romaji) return false;
    const reading = w.reading;
    const moraLen = countMoraVowels(reading);
    if (moraLen < 4) {
      console.log(`[CHAR-CHECK] 除外: "${w.word}" 4文字未満 (${moraLen}文字)`);
      return false;
    }
    if (moraLen > 10) {
      console.log(`[CHAR-CHECK] 除外: "${w.word}" 10文字超 (${moraLen}文字)`);
      return false;
    }
    if (TAIGEN_VIOLATION_ENDINGS.some(e => reading.endsWith(e))) {
      console.log(`[CHAR-CHECK] 除外: "${w.word}" 体言止め違反 (語尾: ${reading})`);
      return false;
    }
    const normalizedRomaji = w.romaji
      .toLowerCase()
      .replace(/ā/g, "aa").replace(/ī/g, "ii").replace(/ū/g, "uu")
      .replace(/ē/g, "ee").replace(/ō/g, "oo")
      .replace(/'/g, "");
    if (/[^a-z\-]/.test(normalizedRomaji)) {
      console.log(`[CHAR-CHECK] 除外: "${w.word}" ローマ字に不正文字: ${w.romaji}`);
      return false;
    }
    const expectedVowels = countMoraVowels(w.reading);
    if (expectedVowels === 0) return true;
    const actualVowels = (normalizedRomaji.match(/[aeiou]/g) || []).length;
    const ratio = actualVowels / expectedVowels;
    if (ratio < 0.6) {
      console.log(`[CHAR-CHECK] 除外: "${w.word}" 読み:${w.reading} ローマ字:${w.romaji} 期待母音:${expectedVowels} 実際:${actualVowels}`);
      return false;
    }
    return true;
  });
}

export function parseWordEntries(section: string): WordEntry[] {
  const lines = section.replace(/\r\n/g, "\n").split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const entries: WordEntry[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\.\)）、]\s*/, "").replace(/^[\[【][^\]】]*[\]】]\s*/, "").replace(/^[・●▸►\-]\s*/, "").replace(/^韻の核「[^」]*」→\s*/, "").trim();
    if (!cleaned) continue;

    let match: RegExpMatchArray | null;

    match = cleaned.match(/^(.+?)\s*[\/／]\s*([ぁ-ゟー]+)\s*[\(（]\s*([a-zA-Z\s\-']+)\s*[\)）]/);
    if (match) {
      entries.push({ word: match[1].trim(), reading: match[2].trim(), romaji: match[3].trim().toLowerCase().replace(/\s+/g, "") });
      continue;
    }

    match = cleaned.match(/^([ぁ-ゟー]{3,})\s*[\(（]\s*([a-zA-Z\s\-']+)\s*[\)）]/);
    if (match) {
      entries.push({ word: match[1].trim(), reading: match[1].trim(), romaji: match[2].trim().toLowerCase().replace(/\s+/g, "") });
      continue;
    }

    match = cleaned.match(/^(.+?)\s*[\(（]\s*([a-zA-Z\s\-']+)\s*[\)）]/);
    if (match && match[1].length >= 3) {
      const word = match[1].trim();
      entries.push({ word, reading: word, romaji: match[2].trim().toLowerCase().replace(/\s+/g, "") });
      continue;
    }

    match = cleaned.match(/^([ぁ-ゟー]{3,})\s*[\/／]\s*([a-zA-Z\s\-']+)$/);
    if (match) {
      entries.push({ word: match[1].trim(), reading: match[1].trim(), romaji: match[2].trim().toLowerCase().replace(/\s+/g, "") });
      continue;
    }

    match = cleaned.match(/^(.+?)\s*[\/／]\s*([a-zA-Z\s\-']+)$/);
    if (match && match[1].length >= 3) {
      const word = match[1].trim();
      entries.push({ word, reading: word, romaji: match[2].trim().toLowerCase().replace(/\s+/g, "") });
      continue;
    }
  }
  return entries;
}

export function countMoraFromRomaji(romaji: string): number {
  const clean = romaji.toLowerCase().replace(/[^a-z]/g, "");
  let count = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if ("aiueo".includes(c)) {
      count++;
    } else if (c === "n" && (i === clean.length - 1 || !"aiueo".includes(clean[i + 1]))) {
      count++;
    } else if (i > 0 && c === clean[i - 1] && !"aiueo".includes(c) && c !== "n") {
      count++;
    }
  }
  return count;
}

export function extractCommonSubstrings(words: WordEntry[]): string[] {
  const subCount = new Map<string, number>();
  for (const w of words) {
    const hira = katakanaToHiragana(w.reading);
    const seen = new Set<string>();
    for (let len = 2; len <= 4; len++) {
      for (let start = 0; start <= hira.length - len; start++) {
        const sub = hira.slice(start, start + len);
        if (!/^[ぁ-ゟ]+$/.test(sub)) continue;
        if (seen.has(sub)) continue;
        seen.add(sub);
        subCount.set(sub, (subCount.get(sub) ?? 0) + 1);
      }
    }
  }
  return [...subCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 60)
    .map(([sub]) => sub);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}
