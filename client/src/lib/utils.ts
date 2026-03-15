import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { VOWEL_PATTERNS } from "./constants";
import type { WordEntry, GenerationResult } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractVowels(romaji: string): string {
  const r = romaji.toLowerCase();
  let result = "";
  for (let i = 0; i < r.length; i++) {
    if ("aeiou".includes(r[i])) result += r[i];
    else if (r[i] === "n" && (!r[i + 1] || !"aeiou".includes(r[i + 1]))) result += "n";
  }
  return result;
}

export function getRomajiHighlightIndex(romaji: string, suffixLen: number): number {
  const r = romaji.toLowerCase();
  const vowelPositions: number[] = [];
  for (let i = 0; i < r.length; i++) {
    if ("aeiou".includes(r[i])) vowelPositions.push(i);
    else if (r[i] === "n" && (!r[i + 1] || !"aeiou".includes(r[i + 1]))) vowelPositions.push(i);
  }
  if (vowelPositions.length < suffixLen) return 0;
  return vowelPositions[vowelPositions.length - suffixLen];
}

export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}秒`;
}

export function getWordsFromResult(result: GenerationResult): WordEntry[] {
  const all: WordEntry[] = [];
  for (const p of VOWEL_PATTERNS) { if (result.groups[p]) all.push(...result.groups[p]); }
  all.push(...result.ungrouped);
  return all;
}
