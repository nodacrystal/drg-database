# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate words ranging from pure respect/praise (Level 1) to extreme diss (Level 10). Goal: accumulate 10,000 words in a PostgreSQL database. Words are organized by vowel pattern for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini**: `gemini-2.5-flash` model, all harm categories OFF, `thinkingBudget: 0`

## File Structure
- `server/routes.ts` — API routes, AI generation, multi-wave system (~460 lines)
- `server/targets.ts` — Hardcoded ~150 comedian target data
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI (~575 lines)
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
- **Generation count**: Selectable 10, 50, 100, or 1000 words per batch
- **Character count ratio**: 2文字=5%, 3文字=30%, 4文字=30%, 5文字=20%, 6文字=10%, 7文字=5%
- **Multi-wave generation**: Unified wave-based system for all counts
  - 10 words: 1 call/wave, max 3 waves
  - 50-100 words: 2 calls/wave, max 7 waves
  - 1000 words: 5 calls/wave, max 20 waves, 80 words/call cap
- **NG word analysis**: When 5+ NG words exist, AI analyzes rejection patterns and avoids similar words
- **Cross-character dedup**: Prevents reading overlap across character groups (e.g., "バカ" + "馬鹿野郎" blocked)
- **Sentences allowed**: Words, phrases, and short sentences all accepted if natural
- **RAG research**: AI gathers target info (praise for Lv1-3, diss for Lv4-10)
- **Live timer**: Running timer with green=success, red=error states
- **Timing diagnostics**: Server logs `[TIMING]` for each wave
- Server-side suffix dedup: max 2 words with same reading suffix
- NG words system: unchecked words saved to ng_words table
- Progress bar: shows count / 10,000 target
- Age confirmation for level 8+
- SSE streaming with `res.flushHeaders()` + `X-Accel-Buffering: no` for proxy compatibility

## API Routes
- `GET /api/target` - Random target from hardcoded comedian list
- `POST /api/diss` - Generate words via SSE. Body: `{ target, level, count }` (count: 10|50|100|1000)
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
- 2026-03-09: 1000-word generation with multi-wave parallel system (5 parallel calls/wave)
- 2026-03-09: NG word pattern analysis (AI analyzes rejection trends, feeds into prompts)
- 2026-03-09: Cross-character reading overlap dedup (prefix/suffix matching)
- 2026-03-09: Sentences/phrases allowed in prompts alongside single words
- 2026-03-09: SSE fix: `req.on("close")` → `res.on("close")` + `flushHeaders()` for reliable streaming
- 2026-03-09: 10-level system with distinct prompts per level
- 2026-03-09: Generation count selector (10/50/100/1000)
