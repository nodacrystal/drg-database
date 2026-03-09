import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const words = pgTable("words", {
  id: serial("id").primaryKey(),
  word: text("word").notNull().unique(),
  reading: text("reading").notNull(),
  romaji: text("romaji").notNull(),
  vowels: text("vowels").notNull(),
  charCount: integer("char_count").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWordSchema = createInsertSchema(words).omit({
  id: true,
  createdAt: true,
});

export type InsertWord = z.infer<typeof insertWordSchema>;
export type Word = typeof words.$inferSelect;
