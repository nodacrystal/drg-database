# Diss & Rhyme Generator

## Overview
A Japanese rap battle tool that uses Gemini AI to generate fictional targets based on real public figures and personalized diss words. Single-page application with a dark hip-hop themed aesthetic.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **No database** - stateless AI generation tool
- **Gemini Safety Settings**: All harm categories set to OFF for unrestricted content generation

## Data Model
- Words are stored as `{ word: string, romaji: string }` (WordEntry)
- Romaji includes full pronunciation with vowels for every character
- Vowels are extracted from romaji for rhyme matching

## Key Features
- **Name input field** (optional): User can type a specific person's name to generate a profile based on that person
  - If name is provided: searches for that person and generates profile based on their real traits (unknown info filled with fiction)
  - If name is empty: randomly picks a celebrity and generates profile
- Generate fictional target characters based on real celebrities (name slightly modified, detailed profile)
- Target profiles include: 職業, 見た目, 性格, 評判, 黒歴史
- Adjustable intensity level (1-10) with age confirmation for level 8+
- Generate 30 personalized diss words grouped by pronunciation count (音数):
  - 4音 × 10個
  - 3音 × 10個
  - 2音 × 10個
- Every word includes romaji reading with vowels displayed: `ワード(romaji)[vowels]`
- Level 8+ uses extra-aggressive prompt for harsher insults
- **History tracking**: All generated words tracked to prevent duplicates across generations
- **Reset history**: Clears generated history while preserving favorites
- **Favorites system**: Select diss words with checkboxes, add to favorites (あいうえお sorted), copy all as [word] format, clear all. Favorites preserve romaji data.
- **Rhyme generation**: Select a favorite word to generate 10 rhyming insults. Rhyme matching uses romaji vowel pattern for high vowel match rate. Same-word and same-meaning words excluded.
- Tab-based UI: "生成" (generation) tab and "お気に入り一覧" (favorites) tab

## API Routes
- `GET /api/target?name=` - Generate a fictional target based on a real public figure (modified name + detailed profile). Optional `name` query param for specific person lookup.
- `POST /api/diss` - Generate 30 personalized diss words grouped by pronunciation count (`{ target, level, history }`) → returns `{ groups: { four: WordEntry[], three: WordEntry[], two: WordEntry[] } }`
- `POST /api/rhyme` - Generate 10 rhyming insults for a given word (`{ word, romaji, target, level }`) → returns `{ words: WordEntry[] }`

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- Dark mode by default

## Recent Changes
- 2026-03-08: Words now include romaji reading with vowel display for all outputs
- 2026-03-08: Word grouping changed from character count to pronunciation count (音数)
- 2026-03-08: Favorites now store WordEntry (word + romaji) for rhyme vowel matching
- 2026-03-08: Rhyme generation uses romaji vowel pattern for matching, prioritizes high vowel match rate
- 2026-03-08: Added rhyme generation feature - select favorite word to generate vowel-matching insults
- 2026-03-03: Added optional name input field for targeted person search
- 2026-03-03: Target generation now based on real celebrities with modified names and detailed profiles
- 2026-03-03: Diss words now personalized to target's traits, appearance, reputation, and scandals
- 2026-03-03: Gemini API safety settings disabled (all HarmCategory set to OFF)
- 2026-02-23: Added history tracking and reset functionality
- 2026-02-23: Added favorites system with tab UI, checkbox selection, あいうえお sort, clipboard copy, clear
- 2026-02-23: Initial build with all core features
