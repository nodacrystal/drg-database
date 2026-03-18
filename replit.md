# DRGデータベース (DRG Database)

## Overview
The DRGデータベース is a Japanese rap battle tool that leverages Google's Gemini AI to generate "diss" words (insults or praise, limited to 10 characters). The project's core purpose is to build a comprehensive database of 10,000 such words, categorized by their vowel patterns for advanced rhyme matching. This tool aims to enhance the creative process for rap artists by providing a rich vocabulary of rhyming Japanese words, ranging from respectful praise (Level 1) to extreme insults (Level 10).

## User Preferences
The agent should prioritize the following:
- Generate diss words (≤10 chars) ranging from pure respect/praise (Level 1) to extreme diss (Level 10).
- Accumulate 10,000 words in a PostgreSQL database.
- Organize words by vowel pattern (including 「ん」) for rhyme matching.
- Generate words that are "小学生でもわかる簡単な言葉のみ" (elementary school level vocabulary).
- **体言止め必須 (Taigen-dome Rule):** Every word/phrase must end with a noun or noun phrase. Particles (〜な/〜だ/〜わ/〜よ/〜ね), auxiliary verbs (〜てる/〜てた/〜ている/〜ます/〜です), i-adjective endings (〜い), and verb conjugation forms are strictly prohibited. Rhyming by unnaturally extending word endings is also forbidden.
- **方言禁止 (No Dialect):** All Kansai/regional dialect endings (やな/やわ/やろ/やで/やん/ねん/やんか/わな/じゃな/じゃろ/っちゃ etc.) are prohibited. Standard Japanese only.

## System Architecture
The application follows a client-server architecture with a clear separation of concerns.

**UI/UX Decisions:**
- **Frontend Framework:** React with TypeScript for a dynamic and type-safe user interface.
- **Styling:** Tailwind CSS for utility-first styling, complemented by shadcn/ui components for pre-built, accessible UI elements.
- **Animations:** framer-motion is used for smooth and engaging UI animations.
- **Grouped Results Display:** Words are displayed in color-coded vowel pattern groups, with chip-style word presentation.
- **Rhyme Tier Styling:** Different color schemes (fuchsia/magenta, yellow/gold, orange, primary/blue) are used to visually distinguish rhyme tiers (Perfect, Legendary, Super Hard, Hard).
- **Romaji Display:** Romaji is shown below each word, with the rhyme-matching portion highlighted.
- **Progress Bar:** A progress bar indicates the current word count towards the 10,000-word target, visible during auto mode.
- **Age Confirmation:** For generation levels 8 and above, an age confirmation is required.

**Technical Implementations:**
- **Frontend:** Single-page application, primarily managed in `client/src/pages/home.tsx`.
- **Backend:** Express.js handles API routes and integrates with the Gemini AI.
- **Database:** PostgreSQL is used for storing generated words, NG words, and managing user data. Drizzle ORM facilitates database interactions.
- **AI Integration:** Google's Gemini AI (`gemini-2.5-flash` model) is used for word generation, quality filtering, and semantic analysis. All harm categories are turned OFF, and `thinkingBudget` is set to 0 to minimize latency.
- **Word Processing:**
    - `extractVowels()`: Extracts vowels and 'n' for rhyming.
    - `countMoraFromRomaji()`: Counts morae from Romaji for length validation.
    - `parseWordEntries()`: Flexibly parses various word input formats.
- **Generation System (4-Step Pipeline with 300-word guarantee loop):**
    1.  **Bulk Generation (STEP1):** Parallel AI calls generate batches of diss words. Ending-variant dedup applied against accumulating pool. Loops up to 4 times until 300 words achieved.
    2.  **Quality Filter (STEP2):** AI evaluates generated words for comprehensibility, lyrical validity, 体言止め compliance, and shared-word deduplication (keeps strongest punchline per shared-word group).
    3.  **Shared-Word Clustering (STEP2b):** Programmatic hiragana normalization (katakana→hiragana via `katakanaToHiragana()`). Groups words by common 3-5 hiragana substrings. AI picks strongest punchline per cluster. Removes duplicates before DB save.
    4.  **Vowel Grouping (STEP3):** Passing words are grouped by their last two vowels for rhyme matching.
- **DB Save:** `quickCharCheck()` + `countMoraVowels()` used for accurate mora-based charCount. All fields (word, reading, romaji, vowels, charCount) fully populated before save.
- **Rhyme System:** A tiered system with 4 tiers. Words are sorted by tier and then by Romaji length.
  - **Perfect Rhyme (体言母音100%一致):** Phrases share the same complete vowel sequence (`vowels` = 100% match), AND no two phrases in the group share a 体言 (noun) — **except** if the shared 体言 is at the 文頭 (start, `word.startsWith(taigen)`) of BOTH phrases (文頭同士例外: both start with same noun → allowed; synonym replacement is the intended fix). `extractTaigen()` extracts: ①2+ kanji sequences, ②kanji+bridge-kana+kanji compounds, ③single kanji before の/を/が, ④2+ katakana. Greedy subgrouping with 文頭例外 applied. Display label = shared vowel string (e.g. "uaaien").
  - **Legendary (伝説級):** Last 6 vowels match exactly.
  - **Super Hard (超硬い):** Last 5 vowels match exactly.
  - **Hard (硬い):** Last 4 vowels match exactly.
- **Deduplication and Cleanup:**
    - **`重複整理 (Dedup Cleanup)`:** AI-powered deduplication detects words sharing same prefix/suffix words within same vowel bucket. AI picks strongest punchline per group. **No automatic NG list addition** — NG list is manual only.
    - **`Auto-cleanup`:** Automatically triggers database cleanup upon adding new words.
    - **`DB Cleanup (6-step)`:** A comprehensive process including: (1) vowel pattern correction (parallel batch 16), (2) script-variant deduplication, (2b) ending-particle variant dedup, (3) containment dedup, (4) AI tail-dedup (PARALLEL=8), (5) AI semantic dedup (MU_PARALLEL=8). **No NG list auto-addition.** On server startup, vowel mismatches are auto-fixed in parallel batches of 16.
    - **`Protected Word System`:** Words surviving cleanup are marked as protected to prevent accidental deletion.
    - **`Pre-insert char check`:** `quickCharCheck()` validates romaji before every DB insert — rejects invalid characters, words with < 60% expected vowel count, and words violating taigen-dome.
- **NG Word Management:** Manual-only NG word list. Words ending with NG terms are blocked from generation and addition. NG words are NEVER auto-added by dedup/cleanup operations.
- **`DB精査 (Scrutiny)`:** An AI-powered quality scan checks for vowel group mismatches, duplicate rhyme endings, and identifies prohibited/discriminatory/trademarked words.
- **Full Auto Mode:** An automated loop for continuous word generation, addition, and cleanup, with strict sequential execution of steps and rate limit management.
- **Rate Limit Management:** All Gemini API calls are wrapped with exponential backoff retry logic and reduced parallelism to prevent rate limiting issues.
- **Stale Closure Fix:** Uses `useRef` for function references to avoid stale closures in React components, particularly for auto mode.

## External Dependencies
- **Google Gemini AI:** Used for all AI-powered functionalities (word generation, quality filtering, deduplication, scrutiny).
- **PostgreSQL:** The primary database for storing all word data and NG words.
- **React:** Frontend library for building the user interface.
- **TypeScript:** Adds static typing to the JavaScript codebase.
- **Tailwind CSS:** Utility-first CSS framework for styling.
- **shadcn/ui:** Component library for UI elements.
- **framer-motion:** Animation library for React.
- **Express.js:** Backend web application framework.
- **Drizzle ORM:** ORM for interacting with the PostgreSQL database.
- **Zod:** Schema declaration and validation library, used for API input validation.