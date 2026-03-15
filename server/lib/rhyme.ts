export const CONSONANT_RHYME_GROUP: Record<string, number> = {};
for (const c of ["k","s","p","t","ch","ts","ky","sh","py","hy"]) CONSONANT_RHYME_GROUP[c] = 1;
for (const c of ["g","z","d","b","gy","zy","by"])               CONSONANT_RHYME_GROUP[c] = 2;
for (const c of ["n","m","ny"])                                  CONSONANT_RHYME_GROUP[c] = 3;
for (const c of ["y","r","w","ry"])                              CONSONANT_RHYME_GROUP[c] = 4;
for (const c of ["h","i"])                                       CONSONANT_RHYME_GROUP[c] = 5;

export interface RomajiSyllable { consonant: string; vowel: string; }

export function parseRomajiSyllables(romaji: string): RomajiSyllable[] {
  const s = romaji.toLowerCase().replace(/[^a-z]/g, "");
  const syllables: RomajiSyllable[] = [];
  const MULTI_CONS = ["ch","ts","sh","ky","gy","ny","ry","zy","by","py","hy","sy"];
  const VOWELS = new Set(["a","e","i","o","u"]);
  let idx = 0;
  while (idx < s.length) {
    if (s[idx] === "n" && (idx + 1 >= s.length || !VOWELS.has(s[idx + 1]))) {
      syllables.push({ consonant: "", vowel: "n" });
      idx++; continue;
    }
    let matched = false;
    for (const mc of MULTI_CONS) {
      if (s.startsWith(mc, idx) && idx + mc.length < s.length && VOWELS.has(s[idx + mc.length])) {
        syllables.push({ consonant: mc, vowel: s[idx + mc.length] });
        idx += mc.length + 1; matched = true; break;
      }
    }
    if (matched) continue;
    if (!VOWELS.has(s[idx]) && idx + 1 < s.length && VOWELS.has(s[idx + 1])) {
      syllables.push({ consonant: s[idx], vowel: s[idx + 1] });
      idx += 2; continue;
    }
    if (VOWELS.has(s[idx])) {
      syllables.push({ consonant: "", vowel: s[idx] });
      idx++; continue;
    }
    idx++;
  }
  return syllables;
}

export function computePerfectRhymeKey(romaji: string): string | null {
  const syllables = parseRomajiSyllables(romaji);
  let vowelCount = 0;
  let startIdx = syllables.length;
  for (let j = syllables.length - 1; j >= 0; j--) {
    if (syllables[j].vowel !== "n") vowelCount++;
    startIdx = j;
    if (vowelCount >= 4) break;
  }
  if (vowelCount < 4) return null;
  const suffix = syllables.slice(startIdx);
  return suffix.map(syl => {
    const g = syl.consonant ? (CONSONANT_RHYME_GROUP[syl.consonant] ?? 9) : 0;
    return `${g}${syl.vowel}`;
  }).join("");
}
