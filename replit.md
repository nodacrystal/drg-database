# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate diss words targeting fictional characters based on real public figures. Goal: accumulate 10,000 diss words in a PostgreSQL database. Words are organized by vowel pattern for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini Safety Settings**: All harm categories set to OFF for unrestricted content generation

## Data Model
- Words table: `{ id, word, reading, romaji, vowels, char_count, created_at }`
- NG Words table: `{ id, word, reading, romaji, created_at }` — user-rejected words excluded from future generation
- `reading` is the hiragana reading (e.g., "ごみくず")
- `romaji` is the romanized pronunciation (e.g., "gomikuzu")
- `vowels` is extracted from romaji (e.g., "oiuu")
- `char_count` is `reading.length` (hiragana character count)
- Favorites grouped by vowel pattern for rhyme organization

## Key Features
- **Target selection**: Random from ~150 hardcoded Japanese comedians (no AI call). "やり直し" button re-rolls.
- **Batch generation** (100 words per batch):
  - 2文字 × 5個
  - 3文字 × 30個
  - 4文字 × 30個
  - 5文字 × 20個
  - 6文字 × 10個
  - 7文字 × 5個
- AI generates buffer (extra per group); server-side validation by `reading.length`
- **Auto-retry**: If any group is short after initial generation, retries up to 5 times with focused prompts until exactly 100 words are filled
- Server-side suffix dedup: max 2 words with same reading suffix (2-4 chars) per batch
- Quality rules in prompt: meaningful words only, no repeated suffix words (やろう, がき, etc.)
- **Select All / Deselect All**: Per-group and global toggle
- Unchecked words are saved as NG words (excluded from future generation)
- Words already in DB are excluded from generation (passed as history)
- NG words also excluded from generation and passed to prompt as low-quality examples
- **Database (favorites)**: Persisted in PostgreSQL, grouped by suffix vowel pattern
  - Suffix matching: words grouped by trailing vowel similarity (longest match first, 5→2)
  - Groups with 2+ words formed; remainders grouped by last vowel
  - Each group shows `[*vowels]` header badge (e.g., `*ai`, `*oiu`)
  - Individual word deletion, bulk clear
  - Export to text format for AI consumption
- Progress bar: shows count / 10,000 target
- Adjustable intensity level (1-10) with age confirmation for level 8+

## API Routes
- `GET /api/target` - Random target from hardcoded comedian list (no AI, 3 fields: name/appearance/personality)
- `POST /api/diss` - Generate ~100 diss words via SSE (Server-Sent Events) with progress, quality check, NG word filtering
- `GET /api/favorites` - Get all words grouped by vowel pattern
- `POST /api/favorites` - Add words to DB (bulk insert, skip duplicates)
- `DELETE /api/favorites/:id` - Delete single word
- `DELETE /api/favorites` - Clear all words
- `GET /api/favorites/count` - Get total word count
- `GET /api/favorites/export` - Export all words as text
- `POST /api/ng-words` - Save rejected words as NG words
- `GET /api/ng-words/count` - Get NG word count
- `DELETE /api/ng-words` - Clear all NG words

## AI Output Format
- Words: `ワード/ひらがな読み(romaji)` format, split by `===N文字===` headers
- Groups ordered 2→7 in prompt (shorter first to avoid token limits)
- Parser extracts word, reading (hiragana), romaji from each entry

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- PostgreSQL via Drizzle ORM
- Dark mode by default

## Recent Changes
- 2026-03-09: Major rebuild - database-backed 10,000 word goal
- 2026-03-09: 6 word groups (2-7文字), 100 words per batch (2×5, 3×30, 4×30, 5×20, 6×10, 7×5)
- 2026-03-09: Target changed to hardcoded ~150 comedian list (no AI, instant)
- 2026-03-09: Name input removed, "やり直し" button for re-rolling target
- 2026-03-09: Favorites grouped by suffix vowel pattern (trailing vowel match)
- 2026-03-09: Select All/Deselect All per group and globally
- 2026-03-09: Progress bar towards 10,000 word goal
- 2026-03-09: Export feature for AI-readable format
- 2026-03-09: Removed 経歴 from target display (name/appearance/personality only)
- 2026-03-09: SSE-based progress logging during generation (real-time progress messages)
- 2026-03-09: Post-generation quality check via AI (validates words are real insults, replaces invalid ones)
- 2026-03-09: NG words system — unchecked words saved to ng_words table, excluded from future generation
- 2026-03-09: NG words referenced in generation prompt as low-quality examples to avoid
