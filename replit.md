# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate words ranging from pure respect/praise (Level 1) to extreme diss (Level 10). Goal: accumulate 10,000 words in a PostgreSQL database. Words are organized by vowel pattern for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini**: `gemini-2.5-flash` model, all harm categories OFF, `thinkingBudget: 0`

## File Structure
- `server/routes.ts` — API routes, AI generation, 10-level system (~350 lines)
- `server/targets.ts` — Hardcoded ~150 comedian target data
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI (~600 lines)
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
- Words table: `{ id, word, reading, romaji, vowels, char_count, created_at }`
- NG Words table: `{ id, word, reading, romaji, created_at }` — user-rejected words
- `reading` = hiragana reading, `romaji` = romanized, `vowels` = extracted vowels
- `char_count` = `reading.length` (hiragana character count)

## Key Features
- **Target selection**: Random from ~150 hardcoded Japanese comedians
- **Generation count**: Selectable 10, 50, or 100 words per batch
- **Character count ratio** (preserved across all counts): 2文字=5%, 3文字=30%, 4文字=30%, 5文字=20%, 6文字=10%, 7文字=5%
- **Parallel AI generation**: 2 simultaneous Gemini calls for 50+ words (single call for 10)
- **RAG research**: AI gathers target info in parallel with DB queries (praise-focused for Lv1-3, diss-focused for Lv4-10)
- **Auto-retry**: Up to 5 retries (2 for 10-word batches)
- **Live timer**: Running timer from generation start to completion
- **Timing diagnostics**: Server logs `[TIMING]` for each phase (db+research, generation, retries, total)
- Server-side suffix dedup: max 2 words with same reading suffix per batch
- NG words system: unchecked words saved to ng_words table, excluded from future generation
- Progress bar: shows count / 10,000 target
- Age confirmation for level 8+

## API Routes
- `GET /api/target` - Random target from hardcoded comedian list
- `POST /api/diss` - Generate words via SSE. Body: `{ target, level, count }`
- `GET /api/favorites` - Get all words grouped by vowel pattern
- `POST /api/favorites` - Add words to DB (bulk insert, skip duplicates)
- `DELETE /api/favorites/:id` - Delete single word
- `DELETE /api/favorites` - Clear all words
- `GET /api/favorites/count` - Get total word count
- `GET /api/favorites/export` - Export all words as text
- `POST /api/ng-words` - Save rejected words as NG words
- `GET /api/ng-words` - Get all NG words
- `GET /api/ng-words/count` - Get NG word count
- `DELETE /api/ng-words` - Clear all NG words

## Recent Changes
- 2026-03-09: 10-level system (Lv1 リスペクト → Lv10 放禁) with distinct prompts per level
- 2026-03-09: Generation count selector (10/50/100) with proportional character count scaling
- 2026-03-09: Server-side timing diagnostics (`[TIMING]` logs) to identify bottlenecks
- 2026-03-09: Level-aware RAG research (praise for Lv1-3, diss for Lv4-10)
- 2026-03-09: Single Gemini call for 10-word batches (faster), parallel for 50+
