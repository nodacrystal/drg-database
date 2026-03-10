# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate lyrics (6-10 chars) ranging from pure respect/praise (Level 1) to extreme diss (Level 10). Goal: accumulate 10,000 lyrics in a PostgreSQL database. Lyrics are organized by vowel pattern (including 「ん」) for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited lyrics (up to 10,000)
- **Gemini**: `gemini-2.5-flash` model, all harm categories OFF, `thinkingBudget: 0`

## File Structure
- `server/routes.ts` — API routes, AI generation, 6-parallel lyric system (~600 lines)
- `server/targets.ts` — Hardcoded ~130 target data (comedians + athletes, 5-field: name/appearance/career/personality/evaluation)
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI (~700 lines)
- `shared/schema.ts` — Drizzle schema definitions

## Level System (1-10)
| Level | Label | Description |
|-------|-------|-------------|
| 1 | リスペクト | 最大限の褒め言葉、尊敬 |
| 2 | 称賛 | 称賛・応援 |
| 3 | 親しみ | 愛あるイジり |
| 4 | 軽口 | テレビ的イジり |
| 5 | 毒舌 | 有吉レベルの毒舌 |
| 6 | 辛辣 | 痛い所を突く |
| 7 | 攻撃 | 直接的な攻撃 |
| 8 | 過激 | 人格否定レベル (18+確認) |
| 9 | 暴言 | 限界突破 (18+確認) |
| 10 | 放禁 | 放送禁止、全制限撤廃 (18+確認) |

## Data Model
- Words table: `{ id, word UNIQUE, reading, romaji, vowels, char_count, created_at }`
- NG Words table: `{ id, word UNIQUE, reading, romaji, created_at }` — user-rejected words
- `reading` = hiragana reading, `romaji` = romanized, `vowels` = extracted vowels (includes 'n' for ん)
- `char_count` = `reading.length` (hiragana character count, 6-10 for lyrics)

## Vowel System
- `extractVowels()` extracts vowels + 'n' (when ん is not followed by a vowel)
  - e.g., "tennen" → "enen", "kansai" → "anai", "funben" → "unen"
- Favorites grouped by last 2 vowels (including n) as bucket key
- Within groups, words with 3+ matching vowel suffix sorted first

## Generation System (6-Parallel Lyric Generation by Vowel Pattern)
- **2-step lyric creation**: (1) Choose tail word (韻の核, ≤5 chars) from valid endings list, (2) Add furi (フリ/導入) prefix to make 6-10 char lyric
- **6 parallel AI calls**: One per vowel pattern (ae/oe/ua/an/ao/iu), each generates 20 lyrics
- **PATTERN_DATA constant**: Per-pattern `validEndings` (allowed tail words list) + `lyricExamples` (complete examples)
- **Valid endings approach**: AI is given explicit list of allowed tail words per pattern (not abstract vowel rules)
- **PUNCHLINE_REFERENCE constant**: Japanese rap punchlines as quality reference (compact)
- **Flexible parser**: `parseWordEntries()` handles 5 formats: word/reading(romaji), reading(romaji), word(romaji), reading/romaji, word/romaji
- **Mora counter**: `countMoraFromRomaji()` for length validation when reading has kanji
- **Per-pattern rejection logging**: Logs parsed/accepted/rejected counts + vowel mismatch examples per pattern
- **No ranking step**: All valid lyrics returned directly
- **Result format**: `{ type:"result", direct: WordEntry[], combined: [], total }`
- **Typical output**: ~80-90 lyrics per generation, ~15-45 seconds
- **Language**: 小学生でもわかる簡単な言葉のみ (elementary school level vocabulary)
- **Content types**: insults, criticism, provocation, taunting (挑発・煽り・批判) for levels 4+

## Key Features
- **Target selection**: Random from ~130 hardcoded targets (comedians + athletes) with 5-field data (name/appearance/career/personality/evaluation)
- **NG word analysis**: When 5+ NG words exist, AI analyzes rejection patterns and avoids similar words
- **Simple language**: All generated lyrics must be understandable by elementary school students
- **RAG research**: AI gathers target info (praise for Lv1-3, diss for Lv4-10)
- **Live timer**: Running timer with green=success, red=error states
- **Timing diagnostics**: Server logs timing for each phase
- NG words system: unchecked words saved to ng_words table
- **NG bulk copy**: Copy all NG words to clipboard
- **Manual paste-to-add**: Both DB and NG tabs have textarea to paste words in `word/reading(romaji)` format
- Progress bar: shows count / 10,000 target
- Age confirmation for level 8+
- SSE streaming with `res.flushHeaders()` + `X-Accel-Buffering: no` for proxy compatibility

## API Routes
- `GET /api/target` - Random target from hardcoded comedian list
- `POST /api/diss` - Generate lyrics via SSE. Body: `{ target, level }` (no count field)
- `GET /api/favorites` - Get all words grouped by last-2-vowel pattern
- `POST /api/favorites` - Add words to DB (bulk insert, skip duplicates)
- `POST /api/favorites/paste` - Parse and add words from pasted text (`word/reading(romaji)` format)
- `DELETE /api/favorites/:id` - Delete single word
- `DELETE /api/favorites` - Clear all words
- `GET /api/favorites/count` - Get total word count
- `GET /api/favorites/export` - Export all words as text
- `POST /api/ng-words` - Save rejected words as NG words
- `POST /api/ng-words/paste` - Parse and add NG words from pasted text
- `GET /api/ng-words` - Get all NG words
- `GET /api/ng-words/count` - Get NG word count
- `DELETE /api/ng-words` - Clear all NG words
- `POST /api/favorites/cleanup` - DB cleanup via SSE (rhyme dedup within groups only)

## Recent Changes
- 2026-03-10: Prompt restructured: valid endings list approach (not abstract vowel rules), ~80-90 lyrics/gen in 15-45s
- 2026-03-10: Flexible parser: handles 5 output formats (word/reading(romaji), reading(romaji), word(romaji), etc.)
- 2026-03-10: Mora counter from romaji for length validation when kanji in reading
- 2026-03-10: Per-pattern rejection logging (parsed/accepted/reject breakdown + vowel mismatch examples)
- 2026-03-10: Prompt noise reduced: history capped at 80, NG words at 50, NG analysis at 80 words
- 2026-03-10: Generation rebuilt: 6 parallel AI calls (one per vowel pattern ae/oe/ua/an/ao/iu), 2-step lyric creation
- 2026-03-10: Cleanup simplified: only rhyme dedup within groups
- 2026-03-10: Char range 6-10, elementary school vocabulary, anti-praise for level 4+
- 2026-03-10: Rich target data: ~130 targets (comedians + athletes) with 5-field data
- 2026-03-10: NG bulk copy, paste-to-add for both DB and NG tabs
