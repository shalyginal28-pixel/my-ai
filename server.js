const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { execFile, spawn } = require('child_process');
const multer = require('multer');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4000;

// ===== Провайдеры моделей =====
// OpenRouter (как раньше)
const API_KEY = process.env.AI_API_KEY || '';
const API_URL = process.env.AI_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
let   MODEL   = process.env.AI_MODEL   || 'nvidia/nemotron-3-super-120b-a12b:free';
let   TEMP    = 0.7;
const PROXY   = process.env.AI_PROXY   || '';
// Gemini (бесплатный ключ: aistudio.google.com)
const GEMINI_KEY   = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL   || 'gemini-2.5-flash';
const GEMINI_URL   = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
// Groq (бесплатный ключ: console.groq.com)
const GROQ_KEY   = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
// Запасные модели OpenRouter, если основная промолчала
const FALLBACKS = (process.env.FALLBACK_MODELS ||
  'nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-oss-120b:free,google/gemma-4-31b-it:free')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_TOKENS    = parseInt(process.env.MAX_TOKENS || '4096', 10);
const MAX_FILE_TEXT = 40000;
const MAX_IMAGES    = 4;
const HISTORY_KEEP  = 40;
const RATE_PER_MIN  = parseInt(process.env.RATE_PER_MIN || '20', 10);
const WEB_SEARCH_ENABLED = String(process.env.WEB_SEARCH_ENABLED || 'true').toLowerCase() !== 'false';

// ===== Проверка входа через Supabase =====
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gzphouchibqjxwudncdz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U';
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || 'true').toLowerCase() !== 'false';
const authCache = new Map();

function verifyToken(token) {
  return new Promise(resolve => {
    const hit = authCache.get(token);
    if (hit && hit.exp > Date.now()) return resolve(hit.user);
    let u;
    try { u = new URL(SUPABASE_URL + '/auth/v1/user'); } catch (e) { return resolve(null); }
    const rq = https.request({
      hostname: u.hostname, path: u.pathname, method: 'GET', timeout: 8000,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token }
    }, r => {
      let b = '';
      r.on('data', d => b += d);
      r.on('end', () => {
        if (r.statusCode === 200) {
          try {
            const user = JSON.parse(b);
            if (authCache.size > 500) authCache.clear();
            authCache.set(token, { user, exp: Date.now() + 60000 });
            return resolve(user);
          } catch (e) {}
        }
        resolve(null);
      });
    });
    rq.on('error', () => resolve(null));
    rq.on('timeout', () => { rq.destroy(); resolve(null); });
    rq.end();
  });
}

async function requireUser(req, res, next) {
  if (!REQUIRE_AUTH) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
  const user = await verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Сессия недействительна, войди заново' });
  req.user = user;
  next();
}

const rate = new Map();
function rateOk(id) {
  const n = Date.now();
  const a = (rate.get(id) || []).filter(t => n - t < 60000);
  if (a.length >= RATE_PER_MIN) { rate.set(id, a); return false; }
  a.push(n); rate.set(id, a);
  return true;
}

// ===== Файлы и папки =====
const GENERATED_DIR = path.join(__dirname, 'data', 'files');
fs.mkdirSync(GENERATED_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 5 } });

// ===== curl =====
function curlPost(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), 'myai-req-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmp, JSON.stringify(bodyObj));
    const args = ['-sS', '--max-time', '180', '-X', 'POST', url];
    if (PROXY) args.push('-x', PROXY);
    args.push('-H', 'Content-Type: application/json');
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    args.push('-d', '@' + tmp, '-w', '\n%{http_code}');
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      if (err) return reject(new Error((stderr || err.message).trim()));
      const idx = stdout.lastIndexOf('\n');
      resolve({ status: parseInt(stdout.slice(idx + 1), 10) || 0, body: stdout.slice(0, idx) });
    });
  });
}

let systemPrompt =
  'Ты — Aiva, умный и дружелюбный русскоязычный AI-ассистент. Отвечай на языке пользователя. ' +
  'Сначала давай ответ, потом детали. На простые сообщения (например, приветствие) отвечай коротко и по-человечески. ' +
  'Не задавай встречных вопросов без необходимости и не используй эмодзи, если пользователь сам их не использует. ' +
  'Не выдумывай факты: если не знаешь или не уверена, скажи об этом прямо. ' +
  'Когда уместно, используй markdown (списки, код в блоках с указанием языка). ' +
  'Если пользователь прислал файл — внимательно проанализируй его содержимое. ' +
  'Если пользователь просит создать файл, подготовь содержимое без лишних пояснений и используй формат <AIVA_FILE name="filename.ext">содержимое</AIVA_FILE>. ' +
  'Поддерживай текстовые форматы: txt, md, json, csv, html, css, js, ts, py, java, c, cpp, h, sh, xml, yaml, yml. ' +
  'Не помещай AIVA_FILE внутрь markdown-кода и не используй этот формат для обычного текста.';

const FILE_EXTENSIONS = new Set([
  'txt','md','markdown','json','csv','tsv','html','htm','css','js','mjs','cjs','ts','tsx','jsx',
  'py','pyw','java','c','h','hpp','cpp','cc','cxx','cs','go','rs','php','rb','swift','kt','kts',
  'sh','bash','zsh','bat','ps1','sql','xml','yaml','yml','ini','toml','env','log'
]);

function safeFileName(name) {
  let n = String(name || 'aiva-file.txt')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!n) n = 'aiva-file.txt';
  if (n.length > 120) {
    const ext = path.extname(n);
    n = n.slice(0, Math.max(1, 120 - ext.length)) + ext;
  }
  return n;
}
const fileExtension = name => path.extname(name).toLowerCase().replace(/^\./, '');

function makeStoredFile(name, buffer) {
  const safeName = safeFileName(name);
  const ext = fileExtension(safeName);
  const id = crypto.randomBytes(12).toString('hex');
  const storedName = id + (ext ? '.' + ext : '');
  fs.writeFileSync(path.join(GENERATED_DIR, storedName), buffer);
  return {
    id, name: safeName, size: buffer.length,
    url: '/api/files/' + encodeURIComponent(storedName) + '?name=' + encodeURIComponent(safeName)
  };
}

function extractGeneratedFiles(reply) {
  const files = [];
  const re = /<AIVA_FILE\s+name=(?:"([^"]+)"|'([^']+)')>([\s\S]*?)<\/AIVA_FILE>/gi;
  const cleaned = String(reply || '').replace(re, (_, n1, n2, body) => {
    const originalName = safeFileName(n1 || n2 || 'aiva-file.txt');
    if (!FILE_EXTENSIONS.has(fileExtension(originalName)))
      return `\n\n⚠️ Файл «${originalName}» не создан: формат не поддерживается для автоматической выдачи.\n\n`;
    const normalized = String(body || '').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    if (!normalized) return '';
    try {
      const stored = makeStoredFile(originalName, Buffer.from(normalized, 'utf8'));
      files.push(stored);
      return `\n\n📎 [Скачать ${stored.name}](${stored.url})\n\n`;
    } catch (e) {
      return `\n\n⚠️ Не удалось подготовить файл «${originalName}».\n\n`;
    }
  });
  return { reply: cleaned.trim(), files };
}

app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// всё в /api, кроме скачивания файлов, требует вход
app.use('/api', (req, res, next) => req.path.startsWith('/files/') ? next() : requireUser(req, res, next));

app.get('/api/config', (req, res) => {
  res.json({
    model: MODEL,
    hasKey: !!(API_KEY || GEMINI_KEY || GROQ_KEY),
    providers: { openrouter: !!API_KEY, gemini: !!GEMINI_KEY, groq: !!GROQ_KEY },
    systemPrompt, temperature: TEMP, webSearch: WEB_SEARCH_ENABLED, history: []
  });
});

app.get('/api/files/:storedName', (req, res) => {
  const storedName = path.basename(String(req.params.storedName || ''));
  if (!storedName || storedName !== req.params.storedName) return res.status(400).send('Некорректное имя файла');
  const filePath = path.join(GENERATED_DIR, storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Файл не найден');
  res.download(filePath, safeFileName(req.query.name || 'aiva-file' + (path.extname(storedName) || '')));
});

app.post('/api/prompt', (req, res) => {
  systemPrompt = String(req.body.systemPrompt || systemPrompt).slice(0, 4000);
  if (req.body.temperature != null) TEMP = Math.min(2, Math.max(0, parseFloat(req.body.temperature) || 0));
  res.json({ ok: true, temperature: TEMP });
});

app.post('/api/model', (req, res) => {
  MODEL = String(req.body.model || MODEL).slice(0, 120);
  console.log('🧠 Модель по умолчанию:', MODEL);
  res.json({ ok: true, model: MODEL });
});

// ===== Загрузка файлов =====
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function isBinaryText(s) {
  const sample = s.slice(0, 8000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0 || (c < 9 && c !== 0) || (c > 13 && c < 32)) bad++;
  }
  return bad / Math.max(sample.length, 1) > 0.02;
}
function trunc(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  return t.length > MAX_FILE_TEXT ? t.slice(0, MAX_FILE_TEXT) + '\n…(файл обрезан, показано ' + MAX_FILE_TEXT + ' символов)' : t;
}

async function extractFile(file) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (IMAGE_MIME[ext])
    return { name: file.originalname, type: 'image', mime: IMAGE_MIME[ext], data: file.buffer.toString('base64'), size: file.buffer.length };
  if (ext === 'pdf') {
    let pdfParse;
    try { pdfParse = require('pdf-parse/lib/pdf-parse.js'); } catch (e) { throw new Error('нет модуля pdf-parse — выполни: npm install'); }
    const d = await pdfParse(file.buffer);
    const text = trunc(d.text);
    if (!text) throw new Error('не удалось извлечь текст из PDF (возможно скан)');
    return { name: file.originalname, type: 'text', text, size: text.length };
  }
  if (ext === 'docx') {
    let mammoth;
    try { mammoth = require('mammoth'); } catch (e) { throw new Error('нет модуля mammoth — выполни: npm install'); }
    const d = await mammoth.extractRawText({ buffer: file.buffer });
    const text = trunc(d.value);
    if (!text) throw new Error('не удалось извлечь текст из DOCX');
    return { name: file.originalname, type: 'text', text, size: text.length };
  }
  const text = file.buffer.toString('utf8');
  if (isBinaryText(text)) throw new Error('бинарный файл не поддерживается (можно: txt, md, код, csv, json, pdf, docx, картинки)');
  const t = trunc(text);
  if (!t) throw new Error('файл пустой');
  return { name: file.originalname, type: 'text', text: t, size: t.length };
}

app.post('/api/upload', upload.array('files', 5), async (req, res) => {
  const results = [];
  for (const f of (req.files || [])) {
    try {
      const parsed = await extractFile(f);
      try {
        const stored = makeStoredFile(f.originalname, f.buffer);
        parsed.downloadUrl = stored.url;
        parsed.fileId = stored.id;
      } catch (e) { parsed.downloadUrl = null; }
      results.push(parsed);
    } catch (e) {
      results.push({ name: f.originalname, type: 'error', error: e.message });
    }
  }
  res.json({ ok: true, files: results });
});

app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.name === 'MulterError'))
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 20 МБ' : 'Слишком много файлов (макс. 5)' });
  next(err);
});

// ===== Выбор модели и запрос =====
// Порядок: выбранная модель -> Gemini -> Groq -> запасные модели OpenRouter.
function orTarget(model) { return { name: 'OpenRouter', url: API_URL, key: API_KEY, model, openrouter: true }; }

function buildChain(requested) {
  const chain = [];
  const add = t => { if (t && !chain.some(x => x.url === t.url && x.model === t.model)) chain.push(t); };
  const gem = GEMINI_KEY ? { name: 'Gemini', url: GEMINI_URL, key: GEMINI_KEY, model: GEMINI_MODEL } : null;
  const grq = GROQ_KEY ? { name: 'Groq', url: GROQ_URL, key: GROQ_KEY, model: GROQ_MODEL } : null;
  if (requested === 'gemini') add(gem);
  else if (requested === 'groq') add(grq);
  else if (API_KEY) add(orTarget(requested || MODEL));
  add(gem); add(grq);
  if (API_KEY) FALLBACKS.forEach(m => add(orTarget(m)));
  return chain;
}

function tgHeaders(t) {
  const h = { Authorization: 'Bearer ' + t.key };
  if (t.openrouter) { h['HTTP-Referer'] = process.env.APP_URL || 'http://localhost'; h['X-Title'] = 'Aiva'; }
  return h;
}

function reqBody(t, messages, stream) {
  const body = { model: t.model, temperature: TEMP, messages, max_tokens: MAX_TOKENS, stream: !!stream };
  // веб-поиск только для платных моделей: бесплатные его обычно не поддерживают
  if (t.openrouter && WEB_SEARCH_ENABLED && !/:free$|^openrouter\/free$/.test(t.model))
    body.tools = [{ type: 'openrouter:web_search' }];
  return body;
}

function buildUserContent(text, attachments) {
  let fullText = text || 'Посмотри присланные файлы.';
  for (const a of attachments) if (a.type === 'text' && a.text)
    fullText += `\n\n--- Содержимое файла «${a.name}» ---\n${String(a.text).slice(0, MAX_FILE_TEXT)}`;
  const images = attachments.filter(a => a.type === 'image' && a.data).slice(0, MAX_IMAGES);
  const userContent = images.length
    ? [{ type: 'text', text: fullText }, ...images.map(a => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } }))]
    : fullText;
  return { userContent, textOnly: fullText, hasImages: images.length > 0 };
}

const IMG_ERR = /image|vision|multimodal/i;
const IMG_NOTE = '⚠️ Текущая модель не поддерживает изображения — ответил по тексту файлов.\n\n';
const errMsg = (data, body) =>
  (data && data.error && (data.error.message || JSON.stringify(data.error))) || String(body || '').slice(0, 300);

function parseHistory(h) {
  if (!Array.isArray(h)) return [];
  return h
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY_KEEP)
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
}

function chatCore(res, userText, attachments, wantStream, prior, requested) {
  const chain = buildChain(requested);
  if (!chain.length)
    return res.status(400).json({ error: 'Не задан ни один ключ API (AI_API_KEY, GEMINI_API_KEY или GROQ_API_KEY)' });

  const { userContent, textOnly, hasImages } = buildUserContent(userText, attachments);
  const head = [{ role: 'system', content: systemPrompt }, ...prior];
  const msgsFull = [...head, { role: 'user', content: userContent }];
  const msgsText = [...head, { role: 'user', content: textOnly }];

  // ---- без стриминга ----
  if (!wantStream) {
    (async () => {
      let lastErr = '';
      for (const tg of chain) {
        for (const withImg of hasImages ? [true, false] : [false]) {
          try {
            const r = await curlPost(tg.url, tgHeaders(tg), reqBody(tg, withImg ? msgsFull : msgsText, false));
            let data = null; try { data = JSON.parse(r.body); } catch (e) {}
            const m = data && data.choices && data.choices[0] && data.choices[0].message;
            const text = m && m.content;
            if (r.status >= 200 && r.status < 300 && typeof text === 'string' && text.trim()) {
              const processed = extractGeneratedFiles((hasImages && !withImg ? IMG_NOTE : '') + text);
              return res.json({
                ok: true, reply: processed.reply, model: (data && data.model) || tg.model,
                files: processed.files.map(f => ({ id: f.id, name: f.name, size: f.size, url: f.url }))
              });
            }
            lastErr = errMsg(data, r.body) || 'пустой ответ';
            if (!(withImg && hasImages && IMG_ERR.test(lastErr))) break;
          } catch (e) { lastErr = e.message; break; }
        }
      }
      res.status(502).json({ error: 'Модель не ответила: ' + (lastErr || 'неизвестная ошибка') });
    })();
    return;
  }

  // ---- стриминг (NDJSON) ----
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  let acc = '', got = false, model = '', dead = false, proc = null, tmpFile = null,
      idx = 0, withImages = hasImages, lastErr = '', timer = null;
  const w = o => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) {} };

  function cleanup() {
    clearTimeout(timer);
    const p = proc; proc = null;
    try { if (p) p.kill(); } catch (e) {}
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (e) {} tmpFile = null; }
  }
  function finalize() {
    if (dead) return; dead = true; cleanup();
    if (acc) {
      const processed = extractGeneratedFiles(acc);
      if (processed.reply !== acc) w({ replace: processed.reply });
      if (processed.files.length) w({ files: processed.files.map(f => ({ id: f.id, name: f.name, size: f.size, url: f.url })) });
    }
    w({ d: '', done: true, model });
    try { res.end(); } catch (e) {}
  }
  function failFinal(msg) {
    if (dead) return; dead = true; cleanup();
    w({ err: String(msg || 'Модель не ответила').slice(0, 400) });
    try { res.end(); } catch (e) {}
  }
  // переход к следующей модели (или завершение, если текст уже пошёл)
  function retry(reason) {
    if (dead) return;
    lastErr = reason || lastErr;
    cleanup();
    if (got) return finalize();
    if (withImages && IMG_ERR.test(lastErr)) {
      withImages = false;
      if (!acc) { acc = IMG_NOTE; w({ d: IMG_NOTE }); }
      return start();
    }
    idx++;
    if (idx >= chain.length) return failFinal('Модель не ответила: ' + (lastErr || 'пустой ответ'));
    console.log('↪ переключаюсь на', chain[idx].name, chain[idx].model, '— причина:', String(lastErr).slice(0, 120));
    start();
  }
  res.on('close', () => { if (!dead) { dead = true; cleanup(); } });

  function start() {
    const tg = chain[idx];
    tmpFile = path.join(os.tmpdir(), 'myai-stream-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmpFile, JSON.stringify(reqBody(tg, withImages ? msgsFull : msgsText, true)));
    const args = ['-sS', '-N', '--max-time', '300', '-X', 'POST', tg.url];
    if (PROXY) args.push('-x', PROXY);
    args.push('-H', 'Content-Type: application/json');
    for (const [k, v] of Object.entries(tgHeaders(tg))) args.push('-H', `${k}: ${v}`);
    args.push('-d', '@' + tmpFile);
    proc = spawn('curl', args, { windowsHide: true });
    const p = proc;
    let buf = '', errBody = '';
    timer = setTimeout(() => { if (proc === p && !got) retry('Модель долго не отвечает'); }, 60000);

    function handleLine(s) {
      if (!s || s[0] === ':') return;
      if (s.startsWith('data:')) {
        const pl = s.slice(5).trim();
        if (pl === '[DONE]') return;
        let j; try { j = JSON.parse(pl); } catch (e) { return; }
        if (j.error) { retry((j.error.message || JSON.stringify(j.error)).slice(0, 300)); return; }
        if (j.model) model = j.model;
        const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (typeof d === 'string' && d) { got = true; clearTimeout(timer); acc += d; w({ d }); }
      } else {
        errBody += s;
      }
    }

    p.stdout.on('data', c => {
      if (proc !== p || dead) return;
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        handleLine(line.trim());
        if (proc !== p || dead) return;
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', e => { if (proc === p) retry('curl: ' + e.message); });
    p.on('close', () => {
      if (proc !== p || dead) return;
      if (buf.trim()) handleLine(buf.trim());
      if (proc !== p || dead) return;
      if (got) return finalize();
      let m = '';
      try { const j = JSON.parse(errBody); if (j.error) m = j.error.message || JSON.stringify(j.error); }
      catch (e) { m = errBody.slice(0, 300); }
      retry(m || 'пустой ответ от модели');
    });
  }
  start();
}

const NOTE_RE = /\n?\[(?:🖼️|📄|файл:|изображение:)[^\]]*\]/g;

app.post('/api/chat', (req, res) => {
  const userText = String(req.body.text || '').trim().slice(0, 8000);
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];
  if (!userText && !attachments.length) return res.status(400).json({ error: 'Пустое сообщение' });
  if (!rateOk(req.user ? req.user.id : req.ip)) return res.status(429).json({ error: 'Слишком много запросов. Подожди минуту.' });
  chatCore(res, userText, attachments, !!req.body.stream, parseHistory(req.body.history), String(req.body.model || '').slice(0, 120));
});

app.post('/api/regenerate', (req, res) => {
  const h = parseHistory(req.body.history);
  const last = h[h.length - 1];
  if (!last || last.role !== 'user') return res.status(400).json({ error: 'Нечего перегенерировать' });
  if (!rateOk(req.user ? req.user.id : req.ip)) return res.status(429).json({ error: 'Слишком много запросов. Подожди минуту.' });
  chatCore(res, last.content.replace(NOTE_RE, ''), [], !!req.body.stream, h.slice(0, -1), String(req.body.model || '').slice(0, 120));
});

// история теперь хранится в браузере, на сервере её нет
app.post('/api/clear', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🤖 Aiva запущена: http://localhost:${PORT}`);
  console.log(`   OpenRouter: ${API_KEY ? 'ключ есть' : 'нет ключа'} · модель по умолчанию: ${MODEL}`);
  console.log(`   Gemini: ${GEMINI_KEY ? 'ключ есть (' + GEMINI_MODEL + ')' : 'нет ключа'}`);
  console.log(`   Groq:   ${GROQ_KEY ? 'ключ есть (' + GROQ_MODEL + ')' : 'нет ключа'}`);
  console.log(`   Проверка входа: ${REQUIRE_AUTH ? 'включена' : 'ВЫКЛЮЧЕНА'}`);
});
