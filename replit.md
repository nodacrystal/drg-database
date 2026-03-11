# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate diss words (≤10 chars) ranging from pure respect/praise (Level 1) to extreme diss (Level 10). Goal: accumulate 10,000 words in a PostgreSQL database. Words are organized by vowel pattern (including 「ん」) for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini**: `gemini-2.5-flash` model, all harm categories OFF, `thinkingBudget: 0`

## File Structure
- `server/routes.ts` — API routes, 3-step AI generation pipeline
- `server/targets.ts` — Hardcoded ~130 target data (comedians + athletes, 3-field: name/appearance/personality)
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI with grouped results display
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
- **固い韻 (Hard Rhymes)**: Within each vowel group, words sharing the same last 3 vowels (2+ words) are sub-grouped as "固い韻" with distinct visual styling (primary-colored border/background)
- **Auto-cleanup**: Adding words via "選択ワードをデータベースに追加" automatically triggers the database "整理" cleanup process

## Generation System (3-Step Pipeline)
- **STEP 1: Bulk Generation** — 6 parallel AI calls, each generates 50 diss words (target: 300 total)
  - Word types: 悪口, 嫌なあだ名, 挑発, 弱点の指摘
  - Each batch uses different angle/切り口 to maximize diversity
  - Dedup against DB words, NG words, and cross-batch duplicates
  - Same suffix/助詞 restriction enforced
- **STEP 2: Quality Filter** — AI evaluates all generated words:
  - 子供でもわかる言葉か？ (kid-friendly vocabulary)
  - リリックとして成立するか？ (valid as rap lyrics)
  - 意味不明でないか？ (meaningful, not gibberish)
- **STEP 3: Vowel Grouping** — Group passing words by last 2 vowels:
  - 6 patterns: ae, oe, ua, an, ao, iu
  - Words not matching any pattern → ungrouped
- **Flexible parser**: `parseWordEntries()` handles 5 formats: word/reading(romaji), reading(romaji), word(romaji), reading/romaji, word/romaji
- **Mora counter**: `countMoraFromRomaji()` for length validation when reading has kanji
- **Result format**: `{ type:"result", groups: Record<string, WordEntry[]>, ungrouped: WordEntry[], total }`
- **Language**: 小学生でもわかる簡単な言葉のみ (elementary school level vocabulary)
- **Content types**: Level 1-3 = praise/friendly, Level 4+ = insults, criticism, provocation

## Key Features
- **Target selection**: Random from ~130 hardcoded targets (comedians + athletes) with 3-field data (name/appearance/personality)
- **NG word analysis**: When 5+ NG words exist, AI analyzes rejection patterns and avoids similar words
- **Grouped results UI**: Words displayed in color-coded vowel pattern groups with per-group select/deselect
- **Live timer**: Running timer with green=success, red=error states
- **Timing diagnostics**: Server logs timing for each phase
- NG words system: unchecked words saved to ng_words table
- **NG bulk copy**: Copy all NG words to clipboard
- **Manual paste-to-add**: Both DB and NG tabs have textarea to paste words in `word/reading(romaji)` format
- Progress bar: shows count / 10,000 target
- Age confirmation for level 8+
- **DB Cleanup (5-step)**: (1) Wrong vowel pattern removal, (2) Script-variant dedup with enhanced normalization (っ removal, ー removal, を→お, small kana, word↔reading cross-match), (3) Containment dedup (word A inside word B → delete B), (4) Tail-character dedup with AI selection of strongest word. Special handling for 顔(ao) and 野郎(ou), (5) AI semantic dedup — Gemini detects meaning-similar duplicates within each vowel group (e.g. うっせーよ↔うるせえよ, 生きてる価値なし↔存在価値なし, kanji↔hiragana variants). 5 groups processed in parallel.
- SSE streaming with `res.flushHeaders()` + `X-Accel-Buffering: no` for proxy compatibility

## API Routes
- `GET /api/target` - Random target (name/appearance/personality)
- `POST /api/diss` - Generate words via SSE (3-step pipeline). Body: `{ target, level }`
- `GET /api/favorites` - Get all words grouped by last-2-vowel pattern
- `POST /api/favorites` - Add words to DB (bulk insert, skip duplicates)
- `POST /api/favorites/paste` - Parse and add words from pasted text
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

## Full Auto Mode
- **完全オートモード**: Automated loop that runs continuously until user presses "停止"
- **Strict sequential flow** — each step fully completes before the next begins:
  1. ターゲット生成
  2. レベル設定（8〜10ランダム）
  3. 生成（完了まで待機）
  4. データベースに送信（完了まで待機）
  5. 整理（完了まで待機）
  6. 2秒クールダウン → 1に戻る
- Uses `autoModeRef` for cancellation, `addWordsDirect` for non-mutation favorites adding
- During auto mode, manual controls (slider, checkboxes, generate button) are disabled
- Empty result detection: 3 consecutive empty results → auto-stop with toast

## Cleanup Optimization
- Check4 (tail dedup) AI calls are parallelized in 2 phases:
  - Phase 1: All special tail tasks (顔, 野郎) run in parallel via Promise.all
  - Phase 2: All generic tail tasks run in parallel via Promise.all
- Previously sequential AI calls now run concurrently for significant speedup

## Recent Changes
- 2026-03-11: Full Auto Mode implemented with concurrent cleanup + generation
- 2026-03-11: Cleanup check4 AI calls parallelized for speed
- 2026-03-11: Code refactored: extracted getWordsFromResult, added isCleaningUpRef, removed unnecessary auto-trigger on add
- 2026-03-10: Generation rebuilt to 3-step pipeline (300 words → quality filter → vowel grouping)
- 2026-03-10: Target data simplified: removed career/evaluation, kept name/appearance/personality
- 2026-03-10: Results UI redesigned: color-coded vowel pattern groups with chip-style word display
- 2026-03-10: Code refactored: removed PATTERN_DATA, PUNCHLINE_REFERENCE, old 6-pattern generation
