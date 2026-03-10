# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate words ranging from pure respect/praise (Level 1) to extreme diss (Level 10). Goal: accumulate 10,000 words in a PostgreSQL database. Words are organized by vowel pattern (including 「ん」) for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini**: `gemini-2.5-flash` model, all harm categories OFF, `thinkingBudget: 0`

## File Structure
- `server/routes.ts` — API routes, AI generation, 5-parallel batch system (~600 lines, suffix dedup)
- `server/targets.ts` — Hardcoded ~130 target data (comedians + athletes, 5-field: name/appearance/career/personality/evaluation)
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI (~640 lines)
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
- `char_count` = `reading.length` (hiragana character count)

## Vowel System
- `extractVowels()` extracts vowels + 'n' (when ん is not followed by a vowel)
  - e.g., "tennen" → "enen", "kansai" → "anai", "funben" → "unen"
- Favorites grouped by last 2 vowels (including n) as bucket key
- Within groups, words with 3+ matching vowel suffix sorted first

## Generation System (5-Parallel Batch, Target: 100 words)
- **No count selector** — fixed recipe, stops at 100 total words
- **5 parallel AI calls**: Each batch generates mixed 5/6/7/8文字 words (10 per char count = 40 per batch)
  - With suffix dedup filtering, ~100 words survive from 200 raw candidates
- **Supplement retries**: Up to 5 retries with 3 parallel calls each if initial batch < 100
- **Suffix dedup**: Max 2 words with same reading suffix (末尾2文字). Enforced server-side via `suffixCounts` map
- **Result format**: `{ type:"result", direct: WordEntry[], combined: [], total }`
- **Language**: 小学生でもわかる簡単な言葉のみ (elementary school level vocabulary)
- **Content types**: insults, criticism, provocation, taunting (挑発・煽り・批判) for levels 4+

## Key Features
- **Target selection**: Random from ~130 hardcoded targets (comedians + athletes) with 5-field data (name/appearance/career/personality/evaluation)
- **NG word analysis**: When 5+ NG words exist, AI analyzes rejection patterns and avoids similar words
- **Simple language**: All generated words must be understandable by elementary school students
- **Sentences allowed**: Words, phrases, and short sentences all accepted if natural
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
- `POST /api/diss` - Generate words via SSE. Body: `{ target, level }` (no count field)
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
- `POST /api/favorites/cleanup` - DB cleanup via SSE (cluster dedup + merge small clusters into large ones)

## Recent Changes
- 2026-03-10: Rich target data: 5 fields (name/appearance/career/personality/evaluation) for ~130 targets (comedians + athletes)
- 2026-03-10: Anti-praise enforcement: Level 4+ explicitly bans positive words; prompt categorizes attacks (appearance/personality/scandal/provocation/existential)
- 2026-03-10: Word quality: incomplete/cut-off phrases banned; research prompt enhanced for diss-relevant info
- 2026-03-10: Clickable word rows: tapping word text toggles selection (not just checkbox)
- 2026-03-10: 5-parallel batch system: 5 AI calls × 40 words each, filtered to 100 via suffix dedup
- 2026-03-10: Suffix dedup: max 2 words with same 末尾2文字, enforced server-side
- 2026-03-10: Elementary school level vocabulary only (小学生でもわかる言葉)
- 2026-03-10: Vowel extraction includes 「ん」(n) when not followed by a vowel
- 2026-03-10: Favorites grouped by last 2 vowels, sorted by 3+ vowel suffix match within groups
- 2026-03-10: NG bulk copy button, paste-to-add for both DB and NG tabs
- 2026-03-10: Post-generation AI validation: flags unnatural/forced/incomplete words and removes them before returning results
- 2026-03-10: DB cleanup button: cluster dedup (same reading or same base word with particle suffix) + small cluster merge (AI rewrites words to match large cluster vowel patterns)
