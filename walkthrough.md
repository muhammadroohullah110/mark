# Mark AI — Shopping Companion

AI-powered 3D robot shopping companion. Voice-first, multilingual (English + Urdu), friend-first salesman.

## Architecture

```
WordPress Plugin (mark-ai-chatbot/)  ←→  FastAPI Backend (backend/)
    - Admin dashboard                      - Chat AI (Groq API)
    - Store management                     - Voice TTS (Edge TTS - FREE)
    - Conversation tracking                - RAG navigation (TF-IDF)
    - Widget injection                     - STT (Whisper via Groq)
```

## Quick Start (Local Dev)

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Backend runs at `http://localhost:8000`

## Deploy Backend (Render.com)

1. Push to GitHub
2. Render > New Web Service > Connect repo
3. Root Directory: `backend`
4. Build: `pip install -r requirements.txt`
5. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Add env var: `GROQ_API_KEY=your_key`

## WordPress Plugin

1. ZIP the `mark-ai-chatbot/` folder
2. WordPress > Plugins > Upload > Activate
3. Mark AI > Settings > Enter backend URL + Groq API key
4. Mark AI > Dashboard > Add Store

## Created by Muhammad Roohullah
