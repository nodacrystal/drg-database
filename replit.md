# 悪口データベース (Diss Database)

## Overview
A Japanese rap battle tool that uses Gemini AI to generate diss words targeting fictional characters based on real public figures. Goal: accumulate 10,000 diss words in a PostgreSQL database. Words are organized by vowel pattern for rhyme matching.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **Database**: PostgreSQL storing all favorited words (up to 10,000)
- **Gemini Safety Settings**: All harm categories set to OFF for unrestricted content generation

## File Structure
- `server/routes.ts` — API routes and AI generation logic (~350 lines)
- `server/targets.ts` — Hardcoded ~150 comedian target data (separated for build optimization)
- `server/storage.ts` — Database CRUD operations via Drizzle ORM
- `client/src/pages/home.tsx` — Single-page UI (~560 lines)
- `shared/schema.ts` — Drizzle schema definitions

## Data Model
- Words table: `{ id, word, reading, romaji, vowels, char_count, created_at }`
- NG Words table: `{ id, word, reading, romaji, created_at }` — user-rejected words excluded from future generation
- `reading` is the hiragana reading (e.g., "ごみくず")
- `romaji` is the romanized pronunciation (e.g., "gomikuzu")
- `vowels` is extracted from romaji (e.g., "oiuu")
- `char_count` is `reading.length` (hiragana character count)

## Key Features
- **Target selection**: Random from ~150 hardcoded Japanese comedians (no AI call). "やり直し" button re-rolls.
- **Batch generation** (100 words per batch): 2文字×5, 3文字×30, 4文字×30, 5文字×20, 6文字×10, 7文字×5
- **Parallel AI generation**: 2 simultaneous Gemini calls (short 2-4文字 + long 5-7文字)
- **RAG research**: AI gathers target info (catchphrases, scandals, weaknesses) in parallel with DB queries
- **Auto-retry**: Up to 5 retries for shortfall groups
- **Live timer**: Running timer from generation start to completion, displayed prominently in progress area
- Server-side suffix dedup: max 2 words with same reading suffix per batch
- NG words system: unchecked words saved to ng_words table, excluded from future generation
- Progress bar: shows count / 10,000 target
- Adjustable intensity level (1-10) with age confirmation for level 8+

## API Routes
- `GET /api/target` - Random target from hardcoded comedian list
- `POST /api/diss` - Generate ~100 diss words via SSE with progress
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

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- PostgreSQL via Drizzle ORM
- Dark mode by default
- `thinkingBudget: 0` for all Gemini calls (faster generation)

## Recent Changes
- 2026-03-09: Major code cleanup — routes.ts 786→352 lines, home.tsx 897→557 lines
- 2026-03-09: Extracted TARGETS array to separate `server/targets.ts` file
- 2026-03-09: Removed dead code: stepTimings, getReadingSuffix, complex ETA/pct system
- 2026-03-09: Added live timer — counts up from generation start, shows final time on completion
- 2026-03-09: Simplified SSE progress events (removed pct/eta fields, cleaner progress logs)
- 2026-03-09: Shared Zod schema for word array validation across favorites/ng-words routes
- 2026-03-09: Shared Gemini config object to avoid duplication
