# Carousell Deal Monitor - Frontend Handoff Document

## Project Context
This document serves as context for the AI assistant building the frontend. 
The backend is a fully automated Python script running locally via Windows Task Scheduler. It scrapes Carousell for PC parts, bypasses Cloudflare protections using `curl_cffi`, orchestrates a dynamic multi-provider LLM pipeline (Gemini, Groq, Qwen) to evaluate pc components, calculates intrinsic values, and writes the deal analysis directly into a **Cloudflare D1 Database**.

The goal for this new workspace is to build an **Astro** dashboard deployed on **Cloudflare Pages** that connects to this existing D1 database.

## Architecture / Tech Stack
- **Framework:** Astro (SSR mode)
- **Deployment:** Cloudflare Pages
- **Database:** Cloudflare D1 (Native binding via `@astrojs/cloudflare`)
- **Styling:** Tailwind CSS (recommended)

## Database Schema (Cloudflare D1)
The next bot needs to know the structure of the `carousell-bot` D1 database to write the SQL queries.

### 1. `monitored_searches`
Manages what the Python scraper looks for.
- `id` (INTEGER PRIMARY KEY)
- `query` (TEXT)
- `min_price` (REAL)
- `max_price` (REAL)
- `is_active` (INTEGER, 1 or 0)

### 2. `listings`
Raw data pulled from Carousell.
- `listing_id` (TEXT PRIMARY KEY)
- `title` (TEXT)
- `price_sgd` (REAL)
- `url` (TEXT)
- `image_url` (TEXT)
- `description` (TEXT)
- `seller_username` (TEXT)
- `condition` (TEXT)
- `created_at` (DATETIME)

### 3. `listing_analysis`
LLM evaluations and deal scores.
- `listing_id` (TEXT PRIMARY KEY) - Foreign key to `listings`
- `components` (TEXT) - Extracted PC parts
- `intrinsic_value_sgd` (REAL) - Estimated real-world value
- `deal_score` (REAL) - Percentage based score: `(intrinsic_value_sgd - price) / intrinsic_value_sgd * 100`
- `llm_reasoning` (TEXT)
- `evaluated_at` (DATETIME)

## Dashboard Requirements (Phase 5)

### 1. Deals Feed (Main Page)
- **Data:** Join `listings` and `listing_analysis`.
- **Logic:** Order descending by `deal_score`. Filter out scores < 0 (bad deals).
- **UI:** Display as a grid of cards showing the image, title, listing price (SGD), intrinsic value (SGD), deal score (display as +XX%), and the AI reasoning. Click should link out to the Carousell URL.

### 2. Monitored Searches CRUD
- **Data:** Read/Write to `monitored_searches`.
- **UI:** A simple admin table showing active queries. Needs a form to add new search queries (with min/max price limits) and a button to toggle `is_active` or delete them.

### 3. Setup Instructions for Next AI
1. Initialize the Astro project: `npm create astro@latest`
2. Add Cloudflare adapter: `npx astro add cloudflare`
3. Configure `wrangler.toml` to bind the correct D1 database (`database_name = "carousell-bot"`).
4. Create the Astro API endpoints or Server-Side rendered pages using `Astro.locals.runtime.env.DB.prepare(query)`.