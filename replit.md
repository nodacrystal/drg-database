# Diss & Rhyme Generator

## Overview
A Japanese rap battle tool that uses Gemini AI to generate fictional targets, diss words, and rhyming phrases. Single-page application with a dark hip-hop themed aesthetic.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **No database** - stateless AI generation tool

## Key Features
- Generate fictional target characters via AI
- Adjustable intensity level (1-10) with age confirmation for level 8+
- Generate 30 diss words against the target (with checkbox selection)
- Find rhyming words using Japanese vowel matching logic (kana → vowel number conversion)
- Rhyme results shown in a dialog
- **Favorites system**: Select diss words with checkboxes, add to favorites (あいうえお sorted), copy all to clipboard, clear all
- Tab-based UI: "生成" (generation) tab and "お気に入り一覧" (favorites) tab

## API Routes
- `GET /api/target` - Generate a fictional target person
- `POST /api/diss` - Generate diss words (`{ target, level }`)
- `POST /api/rhyme` - Find rhyming words (`{ word, level }`)
- `POST /api/final_rhyme` - Score-ranked rhymes with vowel match count (`{ word }`) → `{ rhymes: [{ word, score, vowels }] }`

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- Dark mode by default

## Recent Changes
- 2026-02-23: Added favorites system with tab UI, checkbox selection, あいうえお sort, clipboard copy, clear
- 2026-02-23: Added final word input form and /api/final_rhyme endpoint with vowel scoring/ranking
- 2026-02-23: Initial build with all core features
