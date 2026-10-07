AIVA 4.0 — READY TO UPLOAD TO RENDER

THIS ZIP IS FLAT: server.js and package.json are in the ROOT.
public/ contains the web app, PWA manifest, service worker, icons and Android asset links.

RENDER
Build Command: npm install
Start Command: npm start
Runtime: Node

REQUIRED ENVIRONMENT VARIABLE
AI_API_KEY = your OpenRouter API key

OPTIONAL
AI_MODEL = nvidia/nemotron-3-ultra-550b-a55b:free
WEB_SEARCH_ENABLED = true
AIVA_FALLBACK_MODEL = openrouter/free

IMPORTANT
1. Never put the OpenRouter secret key into index.html.
2. Keep AI_API_KEY in Render Environment Variables.
3. Do not create another nested folder when uploading these files to your GitHub repository.
4. After deployment open /api/health.

EXPECTED HEALTH RESPONSE
{
  "ok": true,
  "app": "Aiva",
  "version": "4.0.0",
  "webSearch": true,
  "hasKey": true
}

WHAT CHANGED
- No curl dependency. The backend uses Node 18+ fetch, which works on Render Linux.
- Primary model: NVIDIA Nemotron 3 Ultra free.
- Automatic fallback: openrouter/free.
- Real web search for current questions. Weather uses live wttr.in data; general fresh queries use DuckDuckGo results.
- If a model prints <AIVA_WEB_SEARCH>, the server catches it and performs the search instead of showing the tag.
- Files: PDF, DOCX, images and text/code files.
- Generated files are downloadable from Aiva.
- Password reset UI remains in the frontend.
- PWA manifest, safe service worker and Digital Asset Links are included.
- The service worker has NO fetch handler, so /api/chat is not intercepted.
