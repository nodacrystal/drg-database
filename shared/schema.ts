import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const words = pgTable("words", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  reading: text("reading").notNull(),
  romaji: text("romaji").notNull(),
  vowels: text("vowels").notNull(),
  charCount: integer("char_count").notNull(),
  protected: boolean("protected").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ngWords = pgTable("ng_words", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  reading: text("reading").notNull(),
  romaji: text("romaji").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWordSchema = createInsertSchema(words).omit({
  id: true,
  createdAt: true,
});

export const insertNgWordSchema = createInsertSchema(ngWords).omit({
  id: true,
  createdAt: true,
});

export type InsertWord = z.infer<typeof insertWordSchema>;
export type Word = typeof words.$inferSelect;
export type InsertNgWord = z.infer<typeof insertNgWordSchema>;
export type NgWord = typeof ngWords.$inferSelect;
