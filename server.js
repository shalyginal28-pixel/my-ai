const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;

// ===== Настройки подключения =====
const API_KEY = process.env.AI_API_KEY  || '';
const API_URL = process.env.AI_API_URL  || 'https://openrouter.ai/api/v1/chat/completions';
let   MODEL   = process.env.AI_MODEL    || 'openrouter/free';
let   TEMP    = 0.7;
const PROXY   = process.env.AI_PROXY    || '';

const MAX_FILE_TEXT = 40000;
const MAX_IMAGES    = 4;
const HISTORY_KEEP  = 40;
const WEB_SEARCH_ENABLED = String(process.env.WEB_SEARCH_ENABLED || 'true').toLowerCase() !== 'false';
const FALLBACK_MODEL = process.env.AIVA_FALLBACK_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
const MAX_RETRIES = 1;

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

// ===== История =====
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
let history = [];
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) || []; } catch (e) {}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(HISTORY_FILE, JSON.stringify(history.slice(-200)), () => {}), 300);
}

let systemPrompt = `Ты — Aiva, полноценный AI-ассистент уровня современного ChatGPT/Claude/Kimi.


ТВОЯ ЗАДАЧА

Помогай пользователю не как простой чат-бот, а как умный универсальный помощник: понимай намерение, учитывай контекст разговора, анализируй сложные задачи по шагам и выдавай готовый полезный результат. Не показывай внутренние рассуждения или скрытые цепочки мыслей.

ПРАВИЛА МЫШЛЕНИЯ
- Сначала определи, что именно хочет пользователь и какой результат ему нужен.
- Сложные задачи мысленно разбивай на этапы, но пользователю показывай только полезный вывод, краткие объяснения и проверяемые результаты.
- Если данных не хватает, не выдумывай. Скажи, чего не хватает, или сделай разумное предположение и явно обозначь его.
- Проверяй числа, имена, даты, код и логические выводы перед ответом.
- Если задача требует актуальных данных, используй интернет-поиск.
- Если пользователь прислал файл, сначала изучи его содержимое и опирайся именно на него.
- Если пользователь просит выполнить действие, старайся дать готовый результат, а не длинную инструкцию о том, как его сделать.

ИНТЕРНЕТ
У тебя есть инструмент web search. Используй его автоматически, когда вопрос связан с новостями, текущими ценами, расписаниями, современными технологиями, документацией, компаниями, людьми, событиями, покупками или любыми данными, которые могли измениться. Не используй поиск без необходимости для обычного разговора. Если поиск дал источники, учитывай их и не выдавай догадки за факты.

ФАЙЛЫ
Если пользователь прислал PDF, DOCX, TXT, CSV, JSON, код или изображение — анализируй его. Не игнорируй содержимое файла. Если пользователь просит создать файл, используй формат <AIVA_FILE name=\"filename.ext\">содержимое</AIVA_FILE>. Не помещай этот тег внутрь markdown-кода.

СТИЛЬ
Отвечай естественно, уверенно и по-человечески. Русский — основной язык, но отвечай на языке пользователя. Не начинай каждый ответ с шаблонных фраз. Не повторяй вопрос пользователя. Используй Markdown, когда это улучшает читаемость. Для кода всегда используй fenced code blocks. Для простого вопроса отвечай коротко, для сложного — подробно. `;

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

function fileExtension(name) {
  return path.extname(name).toLowerCase().replace(/^\./, '');
}

function makeStoredFile(name, buffer) {
  const safeName = safeFileName(name);
  const ext = fileExtension(safeName);
  const id = crypto.randomBytes(12).toString('hex');
  const storedName = id + (ext ? '.' + ext : '');
  const filePath = path.join(GENERATED_DIR, storedName);
  fs.writeFileSync(filePath, buffer);
  return {
    id,
    name: safeName,
    size: buffer.length,
    url: '/api/files/' + encodeURIComponent(id + (ext ? '.' + ext : '')) + '?name=' + encodeURIComponent(safeName),
    filePath
  };
}

function extractGeneratedFiles(reply) {
  const files = [];
  const re = /<AIVA_FILE\s+name=(?:\"([^\"]+)\"|'([^']+)')>([\s\S]*?)<\/AIVA_FILE>/gi;
  let cleaned = String(reply || '');
  cleaned = cleaned.replace(re, (_, n1, n2, body) => {
    const originalName = safeFileName(n1 || n2 || 'aiva-file.txt');
    const ext = fileExtension(originalName);
    if (!FILE_EXTENSIONS.has(ext)) {
      return `\n\n⚠️ Файл «${originalName}» не создан: формат не поддерживается для автоматической выдачи.\n\n`;
    }
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

app.get('/api/config', (req, res) => {
  res.json({ model: MODEL, hasKey: !!API_KEY, systemPrompt, temperature: TEMP, webSearch: WEB_SEARCH_ENABLED, history: history.slice(-100) });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiva: 'core-v1', apiConfigured: !!API_KEY, apiUrl: API_URL, model: MODEL, fallbackModel: FALLBACK_MODEL, webSearch: WEB_SEARCH_ENABLED });
});

app.get('/api/files/:storedName', (req, res) => {
  const storedName = path.basename(String(req.params.storedName || ''));
  if (!storedName || storedName !== req.params.storedName) return res.status(400).send('Некорректное имя файла');
  const filePath = path.join(GENERATED_DIR, storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Файл не найден');
  const requestedName = safeFileName(req.query.name || 'aiva-file' + (path.extname(storedName) || ''));
  res.download(filePath, requestedName);
});

app.post('/api/prompt', (req, res) => {
  systemPrompt = String(req.body.systemPrompt || systemPrompt).slice(0, 4000);
  if (req.body.temperature != null) TEMP = Math.min(2, Math.max(0, parseFloat(req.body.temperature) || 0));
  res.json({ ok: true, temperature: TEMP });
});

app.post('/api/model', (req, res) => {
  MODEL = String(req.body.model || MODEL).slice(0, 120);
  console.log('🧠 Модель:', MODEL);
  res.json({ ok: true, model: MODEL });
});

// ===== Файлы =====
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
      } catch (storeError) {
        parsed.downloadUrl = null;
      }
      results.push(parsed);
    } catch (e) {
      results.push({ name: f.originalname, type: 'error', error: e.message });
    }
  }
  res.json({ ok: true, files: results });
});

app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.name === 'MulterError'))
    return res.json({ ok: false, error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 20 МБ' : 'Слишком много файлов (макс. 5)' });
  next(err);
});

// ===== Ядро чата =====
const apiHeaders = () => ({
  'Authorization': 'Bearer ' + API_KEY,
  'HTTP-Referer': process.env.APP_URL || 'http://localhost',
  'X-Title': 'Aiva'
});

function isOpenRouterUrl() {
  try { return new URL(API_URL).hostname.endsWith('openrouter.ai'); }
  catch (e) { return false; }
}

function aiRequestBody(messages, extra = {}, modelOverride = MODEL, allowTools = true) {
  const body = { model: modelOverride, temperature: TEMP, messages, ...extra };
  if (WEB_SEARCH_ENABLED && allowTools && isOpenRouterUrl()) {
    body.tools = [{ type: 'openrouter:web_search' }];
  }
  return body;
}

function resolveModel(requested) {
  const m = String(requested || MODEL).trim();
  if (!m || m === 'auto' || m === 'fast') return 'openrouter/free';
  if (m === 'smart' || m === 'max') return FALLBACK_MODEL;
  return m;
}

function extractReply(data) {
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('').trim();
  }
  return '';
}

function parseAPIError(body) {
  try {
    const j = JSON.parse(body);
    return (j && j.error && (j.error.message || j.error)) || body;
  } catch (e) {
    return body;
  }
}

function buildUserContent(text, attachments) {
  let fullText = text || 'Посмотри присланные файлы.';
  for (const a of attachments) if (a.type === 'text' && a.text)
    fullText += `\n\n--- Содержимое файла «${a.name}» ---\n${String(a.text).slice(0, MAX_FILE_TEXT)}`;
  const images = attachments.filter(a => a.type === 'image' && a.data).slice(0, MAX_IMAGES);
  const userContent = images.length
    ? [{ type: 'text', text: fullText }, ...images.map(a => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } }))]
    : fullText;
  let summary = text || '(файлы)';
  for (const a of attachments) summary += a.type === 'image' ? `\n[изображение: ${a.name}]` : `\n[файл: ${a.name}]`;
  return { userContent, summary, hasImages: images.length > 0 };
}

async function chatCore(res, userText, attachments, wantStream, skipUserPush, requestedModel) {
  const { userContent, summary, hasImages } = buildUserContent(userText, attachments);
  const selectedModel = resolveModel(requestedModel);
  const messagesBase = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-HISTORY_KEEP).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent }
  ];
  if (!skipUserPush) { history.push({ role: 'user', content: summary, time: Date.now() }); save(); }

  // Aiva intentionally uses a normal JSON response in the web app. This makes errors
  // visible and avoids the old situation where a 200 response could contain only {d:""}.
  if (!wantStream) {
    try {
      let currentModel = selectedModel;
      let lastStatus = 0;
      let lastBody = '';
      let reply = '';
      let data = null;
      let usedFallback = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const useImages = attempt === 0 && hasImages;
        const msgs = useImages
          ? messagesBase
          : messagesBase.map((m, i) => i === messagesBase.length - 1 ? { role: 'user', content: summary } : m);
        const allowTools = attempt === 0;
        const r = await curlPost(API_URL, apiHeaders(), aiRequestBody(msgs, {}, currentModel, allowTools));
        lastStatus = r.status;
        lastBody = r.body || '';

        let parsed = null;
        try { parsed = JSON.parse(r.body); } catch (e) {}
        data = parsed;

        if (r.status >= 200 && r.status < 300) {
          reply = extractReply(parsed);
          if (reply) break;
        }

        const msg = parseAPIError(r.body);
        const retryable = attempt < MAX_RETRIES && (
          !reply || /empty|content|tool|unsupported|model|timeout|temporar|rate|overload|capacity/i.test(String(msg))
        );
        if (!retryable) break;

        currentModel = FALLBACK_MODEL;
        usedFallback = true;
      }

      if (lastStatus < 200 || lastStatus >= 300) {
        const msg = String(parseAPIError(lastBody)).slice(0, 500);
        return res.json({ ok: false, error: 'API ' + lastStatus + ': ' + msg });
      }

      if (!reply) {
        return res.json({
          ok: false,
          error: usedFallback
            ? 'Модель не вернула текстовый ответ даже после автоматического повтора. Попробуй ещё раз.'
            : 'Модель вернула пустой ответ. Aiva автоматически повторит запрос при следующей попытке.'
        });
      }

      const rawReply = (usedFallback ? '⚡ Aiva автоматически переключилась на резервную модель.\n\n' : '') + reply;
      const processed = extractGeneratedFiles(rawReply);
      const finalReply = processed.reply;
      history.push({ role: 'assistant', content: finalReply, time: Date.now() }); save();
      return res.json({
        ok: true,
        reply: finalReply,
        model: (data && data.model) || currentModel,
        files: processed.files.map(f => ({ id: f.id, name: f.name, size: f.size, url: f.url }))
      });
    } catch (e) {
      if (/curl/.test(e.message) && /not recognized|не является|ENOENT/i.test(e.message))
        return res.json({ ok: false, error: 'curl не найден. Обнови Windows 10+ или поставь curl.' });
      return res.json({ ok: false, error: 'Сеть: ' + e.message });
    }
  }

  // Backward-compatible NDJSON streaming endpoint.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  let acc = '', model = selectedModel, dead = false, proc = null, tmpFile = null;
  const w = o => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) {} };

  function finalize(saveIt) {
    if (dead) return; dead = true;
    let finalText = acc;
    let createdFiles = [];
    if (acc) {
      const processed = extractGeneratedFiles(acc);
      finalText = processed.reply;
      createdFiles = processed.files.map(f => ({ id: f.id, name: f.name, size: f.size, url: f.url }));
    }
    if (saveIt && finalText) { history.push({ role: 'assistant', content: finalText, time: Date.now() }); save(); }
    if (!finalText && !createdFiles.length) w({ err: 'Модель вернула пустой ответ.' });
    if (createdFiles.length) w({ files: createdFiles });
    w({ d: '', done: true, model });
    try { res.end(); } catch (e) {}
  }
  function fail(msg) {
    if (dead) return; dead = true;
    w({ err: String(msg || 'Ошибка модели').slice(0, 500) });
    try { res.end(); } catch (e) {}
  }

  try {
    tmpFile = path.join(os.tmpdir(), 'myai-stream-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmpFile, JSON.stringify(aiRequestBody(messagesBase, { stream: true }, selectedModel, true)));
    const args = ['-sS', '-N', '--max-time', '300', '-X', 'POST', API_URL];
    if (PROXY) args.push('-x', PROXY);
    args.push('-H', 'Content-Type: application/json');
    for (const [k, v] of Object.entries(apiHeaders())) args.push('-H', `${k}: ${v}`);
    args.push('-d', '@' + tmpFile);
    proc = spawn('curl', args, { windowsHide: true });
    res.on('close', () => {
      if (dead) return;
      try { proc.kill(); } catch (e) {}
      finalize(true);
    });
    let buf = '';
    proc.stdout.on('data', c => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1).trim();
        if (!line.trim()) continue;
        const s = line.trim();
        if (s.startsWith('data:')) {
          const payload = s.slice(5).trim();
          if (payload === '[DONE]') continue;
          let j; try { j = JSON.parse(payload); } catch (e) { continue; }
          if (j.error) return fail(j.error.message || String(j.error));
          if (j.model) model = j.model;
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (typeof d === 'string' && d) { acc += d; w({ d }); }
        } else if (s.startsWith('{')) {
          try { const j = JSON.parse(s); if (j.error) fail(j.error.message || JSON.stringify(j.error)); } catch (e) {}
        }
        if (dead) return;
      }
    });
    proc.stderr.on('data', () => {});
    proc.on('error', e => fail('curl: ' + e.message));
    proc.on('close', () => {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      if (!dead) finalize(true);
    });
  } catch (e) {
    try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (x) {}
    fail(e.message);
  }
}

app.post('/api/chat', (req, res) => {
  const userText = String(req.body.text || '').trim().slice(0, 8000);
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];
  if (!userText && !attachments.length) return res.json({ ok: false, error: 'Пустое сообщение' });
  if (!API_KEY) return res.json({ ok: false, error: 'Не задан ключ API (перезапусти с AI_API_KEY=...)' });
  chatCore(res, userText, attachments, !!req.body.stream, false, req.body.mode || req.body.model);
});

app.post('/api/regenerate', (req, res) => {
  if (!API_KEY) return res.json({ ok: false, error: 'Не задан ключ API' });
  if (history.length && history[history.length - 1].role === 'assistant') { history.pop(); save(); }
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  if (!lastUser) return res.json({ ok: false, error: 'Нечего перегенерировать' });
  chatCore(res, lastUser.content.replace(/\n\[(файл|изображение):[^\]]+\]/g, ''), [], !!req.body.stream, true, req.body.mode || req.body.model);
});

app.post('/api/clear', (req, res) => {
  history = [];
  save();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🤖 MyAI запущен: http://localhost:${PORT}`);
  console.log(`   Модель: ${MODEL}`);
  console.log(`   Ключ:   ${API_KEY ? API_KEY.slice(0, 14) + '… (подхвачен)' : 'НЕ ЗАДАН! Запусти: set AI_API_KEY=sk-... && npm start'}`);
  console.log(`   Прокси: ${PROXY || '(нет — запросы напрямую)'}`);
});
