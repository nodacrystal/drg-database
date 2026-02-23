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
- Generate 20 diss words against the target
- Find rhyming words using Japanese vowel matching logic (kana → vowel number conversion)
- Rhyme results shown in a dialog

## API Routes
- `GET /api/target` - Generate a fictional target person
- `POST /api/diss` - Generate diss words (`{ target, level }`)
- `POST /api/rhyme` - Find rhyming words (`{ word, level }`)

## Tech Stack
- Frontend on port 5000 (served by Express + Vite)
- Gemini AI via `@google/genai` SDK with Replit AI Integrations
- Dark mode by default

## Recent Changes
- 2026-02-23: Initial build with all core features
