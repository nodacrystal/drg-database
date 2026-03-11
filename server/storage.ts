import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql, inArray } from "drizzle-orm";
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

export async function getWordById(id: number): Promise<Word | null> {
  const result = await db.select().from(words).where(eq(words.id, id));
  return result[0] || null;
}

export async function getWordsByIds(ids: number[]): Promise<Word[]> {
  if (ids.length === 0) return [];
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return [];
  return db.select().from(words).where(inArray(words.id, validIds));
}

export async function deleteWord(id: number): Promise<void> {
  await db.delete(words).where(eq(words.id, id));
}

export async function deleteWords(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
  for (const id of ids) {
    const result = await db.delete(words).where(eq(words.id, id)).returning({ id: words.id });
    if (result.length > 0) deleted++;
  }
  return deleted;
}

export async function updateWord(id: number, data: { word: string; reading: string; romaji: string; vowels: string; charCount: number }): Promise<boolean> {
  const result = await db.update(words).set(data).where(eq(words.id, id)).returning({ id: words.id });
  return result.length > 0;
}

export async function clearAllWords(): Promise<void> {
  await db.delete(words);
}

export async function exportWords(): Promise<string> {
  const allWords = await getAllWords();
  const lines = allWords.map((w) => `${w.word}/${w.reading}(${w.romaji})[${w.vowels}]`);
  return lines.join("\n");
}

import type { NgWord } from "@shared/schema";

export async function getAllNgWords(): Promise<NgWord[]> {
  return db.select().from(ngWords).orderBy(ngWords.createdAt);
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

export async function deleteNgWord(id: number): Promise<void> {
  await db.delete(ngWords).where(eq(ngWords.id, id));
}

export async function deleteNgWords(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return 0;
  const result = await db.delete(ngWords).where(inArray(ngWords.id, validIds)).returning({ id: ngWords.id });
  return result.length;
}

export async function markWordsProtected(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return;
  await db.update(words).set({ protected: true }).where(inArray(words.id, validIds));
}

export async function ensureProtectedColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE words ADD COLUMN IF NOT EXISTS protected boolean DEFAULT false`);
  } catch {}
}
