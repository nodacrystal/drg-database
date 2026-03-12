# DRGデータベース (DRG Database)

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
- NG Words table: `{ id, word UNIQUE, reading, romaji, created_at }` — banned suffix/ending terms (e.g. 顔, 野郎, 存在)
- `reading` = hiragana reading, `romaji` = romanized, `vowels` = extracted vowels (includes 'n' for ん)
- `char_count` = `reading.length` (hiragana character count)

## Vowel System
- `extractVowels()` extracts vowels + 'n' (when ん is not followed by a vowel)
  - e.g., "tennen" → "enen", "kansai" → "anai", "funben" → "unen"
- Favorites grouped by last 2 vowels (including n) as bucket key
- Within groups, words sorted by romaji length (shortest first)
- **Tiered Rhyme System** (within each vowel group, words sharing vowel suffixes):
  - **Perfect Rhyme**: 4+ vowel suffix match AND at least one word's entire vowels == suffix (100% match), fuchsia/magenta styling
  - **伝説級硬い韻 (Legendary)**: 5+ vowel suffix match, yellow/gold styling
  - **超硬い韻 (Super Hard)**: 4 vowel suffix match, orange styling
  - **固い韻 (Hard)**: 3 vowel suffix match, primary/blue styling
  - Assignment: perfect first, then legendary, then super (unassigned only), then hard (unassigned only)
  - Sorted by tier (perfect → legendary → super → hard) then by word count within tier
  - **Filter buttons**: すべて / Perfect Rhyme / 伝説級 / 超硬い / 硬い to filter display
- **Romaji Display**: Each word shows romaji below in small font, with rhyme-matching portion highlighted in tier color
- **重複整理 (Dedup Cleanup)**: Dedicated button for tail-dedup-only cleanup using AI to detect same ending words across scripts (漢字/ひらがな/カタカナ). Keeps most impactful word, deletes rest, saves ending to NG
- **Auto-cleanup**: Adding words via "選択ワードをデータベースに追加" automatically triggers the database "整理" cleanup process
- **NG単語リスト (NG Word List)**: Stores banned suffix/ending terms. Words ending with any NG term are blocked from generation and addition. Cleanup saves only the shared suffix (not full word) to NG. Multi-select + batch delete supported.

## Generation System (3-Step Pipeline)
- **STEP 1: Bulk Generation** — 6 parallel AI calls, each generates 50 diss words (target: 300 total)
  - Word types: 悪口, 嫌なあだ名, 挑発, 弱点の指摘
  - Each batch uses different angle/切り口 to maximize diversity
  - Dedup only within current generation batch (NOT against DB words)
  - If count < 200 after dedup, regenerates `300 - current` more words, excluding duplicate tail words
  - NG words still block generation
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
- **Tap-to-select in DB tab**: Click words to select/deselect; action bar shows count + Copy/Delete buttons
- **Vocabulary diversity**: 6 batch-specific approach angles (外見/性格/能力/比喩/方言/造語); NG reference expanded to 100 words
- **Live timer**: Running timer with green=success, red=error states
- **Timing diagnostics**: Server logs timing for each phase
- **Manual paste-to-add**: DB tab uses `word/reading(romaji)` format; NG tab uses simple word list (改行/カンマ区切り)
- Progress bar: shows count / 10,000 target
- Age confirmation for level 8+
- **DB Cleanup (6-step)**: (1) Wrong vowel pattern removal, (2) Script-variant dedup with enhanced normalization (っ removal, ー removal, を→お, small kana, word↔reading cross-match), (2b) Ending-particle variant dedup — detects words with same base but different ending particles (だわ/やな/だな/わな/かな/じゃな/やんか, 〜奴だ/〜奴や etc.), keeps first/protected, (3) Containment dedup (word A inside word B → delete B), (4) Tail-character dedup with AI selection of strongest word. Special handling for 顔(ao) and 野郎(ou), (5) AI semantic dedup — Gemini detects meaning-similar duplicates within each vowel group. 5 groups processed in parallel.
- **DB精査 (Scrutiny)**: AI-powered quality scan of all DB words via SSE:
  - Check 1: Vowel group mismatch (stored vs recalculated from romaji)
  - Check 2: Duplicate rhyme endings (shared kanji/katakana word suffix 2+ chars, or shared reading suffix 4+ chars within same vowel bucket)
  - Check 3: AI detection of 放送禁止用語, 差別用語, 商標名(IP) via Gemini
  - Results auto-select flagged words for user review/deletion
- **Scrutiny Reference** (`server/scrutiny_reference.ts`): User feedback on past errors stored as reference for AI prompts
- SSE streaming with `res.flushHeaders()` + `X-Accel-Buffering: no` for proxy compatibility

## API Routes
- `GET /api/target` - Random target (name/appearance/personality)
- `POST /api/diss` - Generate words via SSE (3-step pipeline). Body: `{ target, level }`
- `GET /api/favorites` - Get all words grouped by last-2-vowel pattern
- `POST /api/favorites` - Add words to DB (bulk insert, skip duplicates)
- `POST /api/favorites/paste` - Parse and add words from pasted text
- `DELETE /api/favorites/:id` - Delete single word
- `POST /api/favorites/batch-delete` - Batch delete words by IDs
- `DELETE /api/favorites` - Clear all words
- `GET /api/favorites/count` - Get total word count
- `GET /api/favorites/export` - Export all words as text
- `POST /api/ng-words` - Add NG terms (accepts `{terms:[...]}` or `{words:[...]}`)
- `POST /api/ng-words/paste` - Parse and add NG terms from text (simple word list)
- `POST /api/ng-words/batch-delete` - Batch delete NG terms by IDs
- `GET /api/ng-words` - Get all NG terms
- `GET /api/ng-words/count` - Get NG term count
- `DELETE /api/ng-words` - Clear all NG terms
- `POST /api/favorites/cleanup` - DB cleanup via SSE (saves shared suffixes to NG)
- `POST /api/favorites/scrutinize` - DB精査 via SSE (vowel check, duplicate endings, AI content check)
- `GET /api/favorites/export-pdf` - Export DB as PDF with visual stats + embedded JSON data
- `POST /api/favorites/import-pdf` - Import DB from exported PDF (50MB max, marker-based extraction)
- `GET /api/ng-words/export-json` - Export NG words as JSON
- `POST /api/ng-words/import-json` - Import NG words from JSON

## Full Auto Mode
- **完全オートモード**: Automated loop that runs continuously until user presses "停止"
- **Strict sequential flow** — each step fully completes before the next begins:
  1. ターゲット生成
  2. レベル設定（5〜10ランダム）
  3. 生成（完了まで待機）
  4. データベースに送信（完了まで待機）
  5. サイクルカウンター+1; 5サイクルごとに全て整理→カウンターリセット
  6. 2秒クールダウン → 1に戻る
- Progress bar only visible during auto mode
- Uses `autoModeRef` for cancellation, `addWordsDirect` for non-mutation favorites adding
- During auto mode, manual controls (slider, checkboxes, generate button) are disabled
- Empty result detection: 3 consecutive empty results → auto-stop with toast

## Rate Limit Management
- `aiGenerate()` wrapper: All Gemini API calls go through this with exponential backoff retry (max 3 retries)
- Retry delays: 2s → 4s → 8s (with jitter) on 429 rate limit errors
- Reduced parallelism: STEP1 generation uses 3 sequential batches of 2 (instead of 6 parallel), check4 picks in batches of 3, check5 semantic in batches of 3
- Auto mode cooldown: 5 seconds between cycles for rate limit recovery

## Cleanup Optimization
- Check4 (tail dedup) AI calls run in batches of 3 with `aiGenerate` retry
- Check5 (semantic dedup) AI calls run in batches of 3 with `aiGenerate` retry
- Protected word system: `protected` boolean column; words surviving cleanup get marked protected; check4/check5 skip protected words

## Stale Closure Fix
- `generateDissSSERef`, `addWordsDirectRef`, `runCleanupRef`, `runAllCleanupRef` refs kept in sync via useEffect
- `startAutoMode` uses refs instead of direct function references to avoid stale closures
- Dependency array only includes `toast` (stable) — not the functions themselves

## Recent Changes
- 2026-03-12: Ending-particle dedup: `getEndingBase()` detects だわ/やな/だな/わな etc. variants; integrated in STEP1 generation post-processing AND cleanup check2b (語尾バリエーション重複)
- 2026-03-12: Generation dedup: only within current batch (not DB), regenerate if < 200, exclude dup tail words
- 2026-03-12: Group check: detailed group count logging, clearer result messages
- 2026-03-12: Auto mode: cleanup wrapped in try/catch for resilience, error logging added
- 2026-03-12: Title changed to "DRGデータベース", subtitle removed
- 2026-03-12: Auto mode: level range 5-10 (was 8-10), 5-cycle cleanup trigger with counter reset
- 2026-03-12: Progress bar only visible during auto mode
- 2026-03-12: PDF export/import: visual stats PDF with embedded JSON data (marker-based), 50MB upload limit
- 2026-03-12: NG words JSON export/import endpoints and UI buttons
- 2026-03-11: Perfect Rhyme tier: 4+ vowel match AND 100% match rate, fuchsia styling, filter buttons for all tiers
- 2026-03-11: Romaji display: each word shows romaji below with rhyme-matching portion highlighted
- 2026-03-11: 重複整理: dedicated AI tail-dedup button with cross-script detection (漢字/ひらがな/カタカナ)
- 2026-03-11: Check4 rewritten: AI-powered same-ending detection replacing hardcoded SPECIAL_TAILS
- 2026-03-11: UI cleanup: removed paste textarea from DB tab, "やり直し"→"ターゲット変更"
- 2026-03-11: Timer recording: generation and cleanup record elapsed time and compare with previous run (green = faster, red = slower)
- 2026-03-11: Cleanup optimization: check4 parallelism 3→5, check5 parallelism 3→5
- 2026-03-11: NG suffix fix: only meaningful words (顔, 野郎 etc.) go to NG, not generic 2-char hiragana reading tails
- 2026-03-11: NG system overhaul: renamed to "NG単語リスト", stores suffix/ending terms instead of full words, blocks generation/addition of words ending with NG terms, cleanup saves only shared suffixes to NG, multi-select + batch delete for NG tab
- 2026-03-11: 精査 (Scrutiny) feature: AI-powered DB scan for vowel mismatch, duplicate endings, prohibited/discriminatory/trademark words
- 2026-03-11: Fixed 8 words with wrong romaji, deleted 13 duplicate/incomplete words, saved user feedback as reference
- 2026-03-11: Tiered rhyme system: legendary (5+), super (4), hard (3) vowel match with distinct styling
- 2026-03-11: Tap-to-select in DB tab with action bar (bulk copy/delete)
- 2026-03-11: Batch delete endpoint with Zod validation (max 500 IDs)
- 2026-03-11: Vocabulary diversity: 6 approach angles per generation batch
- 2026-03-11: SQL injection fix: replaced raw SQL with Drizzle inArray
- 2026-03-11: Words sorted by romaji length within all groups
- 2026-03-11: Rate limit retry with exponential backoff added to all AI calls
- 2026-03-11: Reduced parallelism across generation and cleanup to prevent rate limit cascading
- 2026-03-11: Stale closure fix: auto mode uses refs for latest function versions
- 2026-03-11: Full Auto Mode implemented with strict sequential flow
- 2026-03-11: Cleanup check4/check5 AI calls batched for rate limit management
- 2026-03-11: Protected word system added to prevent DB shrinkage
- 2026-03-10: Generation rebuilt to 3-step pipeline (300 words → quality filter → vowel grouping)
- 2026-03-10: Target data simplified: removed career/evaluation, kept name/appearance/personality
- 2026-03-10: Results UI redesigned: color-coded vowel pattern groups with chip-style word display
