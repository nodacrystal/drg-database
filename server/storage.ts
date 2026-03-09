import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { words, ngWords, type Word, type InsertWord, type InsertNgWord } from "@shared/schema";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

export async function getAllWords(): Promise<Word[]> {
  return db.select().from(words).orderBy(words.vowels, words.charCount);
}

export async function getWordCount(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(words);
  return result[0]?.count || 0;
}

export async function getWordStrings(): Promise<string[]> {
  const result = await db.select({ word: words.word }).from(words);
  return result.map((r) => r.word);
}

export async function addWords(entries: InsertWord[]): Promise<number> {
  if (entries.length === 0) return 0;
  let added = 0;
  for (const entry of entries) {
    try {
      const result = await db.insert(words).values(entry).onConflictDoNothing().returning({ id: words.id });
      if (result.length > 0) added++;
    } catch {
    }
  }
  return added;
}

export async function deleteWord(id: number): Promise<void> {
  await db.delete(words).where(eq(words.id, id));
}

export async function clearAllWords(): Promise<void> {
  await db.delete(words);
}

export async function exportWords(): Promise<string> {
  const allWords = await getAllWords();
  const lines = allWords.map((w) => `${w.word}/${w.reading}(${w.romaji})[${w.vowels}]`);
  return lines.join("\n");
}

export async function getNgWordStrings(): Promise<string[]> {
  const result = await db.select({ word: ngWords.word }).from(ngWords);
  return result.map((r) => r.word);
}

export async function addNgWords(entries: InsertNgWord[]): Promise<number> {
  if (entries.length === 0) return 0;
  let added = 0;
  for (const entry of entries) {
    try {
      const result = await db.insert(ngWords).values(entry).onConflictDoNothing().returning({ id: ngWords.id });
      if (result.length > 0) added++;
    } catch {
    }
  }
  return added;
}

export async function getNgWordCount(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)::int` }).from(ngWords);
  return result[0]?.count || 0;
}

export async function clearNgWords(): Promise<void> {
  await db.delete(ngWords);
}
