# Diss & Rhyme Generator

## Overview
A Japanese rap battle tool that uses Gemini AI to generate fictional targets and diss words. Single-page application with a dark hip-hop themed aesthetic.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS, shadcn/ui components, framer-motion animations
- **Backend**: Express.js with Gemini AI integration (via Replit AI Integrations)
- **No database** - stateless AI generation tool

## Key Features
- Generate fictional target characters via AI
- Adjustable intensity level (1-10) with age confirmation for level 8+
- Generate 30 diss words against the target (with checkbox selection)
- Level 8+ uses extra-aggressive prompt for harsher insults
- **Favorites system**: Select diss words with checkboxes, add to favorites (あいうえお sorted), copy all to clipboard, clear all
- Tab-based UI: "生成" (generation) tab and "お気に入り一覧" (favorites) tab

## API Routes
- `GET /api/target` - Generate a fictional target person
- `POST /api/diss` - Generate 30 diss words (`{ target, level }`)

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- Dark mode by default

## Recent Changes
- 2026-02-23: Removed rhyme APIs (/api/rhyme, /api/final_rhyme) and all rhyme-related frontend UI
- 2026-02-23: Updated /api/diss prompt with severity-based instructions and word combination encouragement
- 2026-02-23: Added favorites system with tab UI, checkbox selection, あいうえお sort, clipboard copy, clear
- 2026-02-23: Initial build with all core features
