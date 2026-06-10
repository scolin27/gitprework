# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Copper roofing company inventory management system. Python/FastAPI backend with a React/Vite frontend. The AI assistant uses Google Gemini with function calling to allow natural-language stock queries and quote approval that automatically deducts inventory.

## Running the project

**Backend** (from project root):
```bash
pip install -r requirements.txt
$env:GEMINI_API_KEY="your_key_here"   # PowerShell
uvicorn main:app --reload
```
API runs at `http://127.0.0.1:8000`. Interactive docs at `/docs`.

**Frontend** (from `frontend/`):
```bash
npm install
npm run dev
```
Dev server runs at `http://localhost:5173`. The frontend hardcodes the API base URL as `http://127.0.0.1:8000` in `App.jsx:10`.

## Architecture

### Backend (`main.py`)

Single-file FastAPI app. Key sections:

- **Database** — SQLite via SQLAlchemy. `MaterialDB` is the only model. DB file is `inventory.db` (created automatically on startup via `Base.metadata.create_all`).
- **Gemini AI** — Two model instances: `gemini_model` (no tools) for proactive analysis; `gemini_model_with_tools` (with `reservar_material` function) for the chat endpoint. Both are `None` if `GEMINI_API_KEY` is unset; the endpoints that require them return 503.
- **Function calling** — `reservar_material` is a schema stub; the real execution is `_ejecutar_reservar_material`. When Gemini returns a function call part, the backend executes it and sends the result back to Gemini for a final text reply.
- **Chat sessions** — Conversation history stored in-memory dict `chat_sessions` keyed by `session_id`. The inventory snapshot is prepended fresh on every call (not persisted in history) so stock data is always current.
- **Import helpers** — `_row_to_material` handles both CSV and Excel rows, accepting flexible column aliases (`price`/`unit_price`/`price_per_unit`, `threshold`/`min_qty`/`low_stock_threshold`).
- **Valid units** — `VALID_UNITS` list is authoritative; both the API and frontend share the same set of 12 US-imperial units.

API tag groups: `Root`, `Catalog`, `Materials`, `Import / Export`, `AI Assistant`, `Budget / Quotes`.

### Frontend (`frontend/src/`)

- **`App.jsx`** — All UI components in one file. Tab-based navigation (Dashboard, Inventory, Quotes, AI Assistant, Analysis). State flows down through props; shared state (materials list, alerts, chat history) lives in Zustand.
- **`store.js`** — Zustand store. Holds materials, alerts, AI chat messages (`aiMessages`), and quotes chat messages (`quotesMessages`). Each chat has its own `sessionId` (timestamp-based). `clearQuotesMessages` generates a new `quotesSessionId` so the backend creates a fresh session.
- Chat history is capped at 30 messages per session (`MAX_MESSAGES`).

### AI endpoints

| Endpoint | Description |
|---|---|
| `POST /chat` | General inventory assistant with function calling |
| `POST /budget/ai` | Step-by-step guided quote builder |
| `GET /analyze` | One-shot proactive analysis (no session) |
| `GET /alerts` | Low-stock items (no Gemini needed) |
| `POST /budget/approve` | Deduct materials from a confirmed structured quote |