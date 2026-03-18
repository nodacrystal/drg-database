export interface WordEntry { word: string; reading: string; romaji: string; }
export interface FavWord { id: number; word: string; reading: string; romaji: string; vowels: string; charCount: number; }
export type RhymeTier = "perfect" | "legendary" | "super" | "hard" | "standard";
export interface HardRhymeGroup { suffix: string; words: FavWord[]; tier: RhymeTier; }
export interface FavGroup { vowels: string; words: FavWord[]; hardRhymes?: HardRhymeGroup[]; }
export interface NgWord { id: number; word: string; reading: string; romaji: string; }
export interface ProgressLog { time: string; detail: string; elapsed: string; }
export interface GenerationResult {
  groups: Record<string, WordEntry[]>;
  ungrouped: WordEntry[];
  total: number;
}
export type RhymeFilter = "all" | RhymeTier;
