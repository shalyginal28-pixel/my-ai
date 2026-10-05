const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
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

let systemPrompt = 'Ты — умный русскоязычный AI-ассистент. Отвечай развёрнуто, структурированно и по делу. ' +
  'Разбирай вопросы глубоко, приводи примеры, замечай нетривиальные детали. Когда уместно — используй markdown ' +
  '(заголовки, списки, код). Если пользователь прислал файл — проанализируй его содержимое внимательно.';

app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', '.well-known', 'assetlinks.json'));
});

app.get('/api/config', (req, res) => {
  res.json({ model: MODEL, hasKey: !!API_KEY, systemPrompt, temperature: TEMP, history: history.slice(-100) });
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
    try { results.push(await extractFile(f)); }
    catch (e) { results.push({ name: f.originalname, type: 'error', error: e.message }); }
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
  'HTTP-Referer': 'http://localhost',
  'X-Title': 'MyAI'
});

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

function chatCore(res, userText, attachments, wantStream, skipUserPush) {
  const { userContent, summary, hasImages } = buildUserContent(userText, attachments);
  const messagesBase = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-HISTORY_KEEP).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent }
  ];
  if (!skipUserPush) { history.push({ role: 'user', content: summary, time: Date.now() }); save(); }

  if (!wantStream) {
    (async () => {
      try {
        let r = await curlPost(API_URL, apiHeaders(), { model: MODEL, temperature: TEMP, messages: messagesBase });
        let note = '';
        if (r.status < 200 || r.status >= 300) {
          let msg = '';
          try { msg = (JSON.parse(r.body).error || {}).message || r.body; } catch (e) { msg = r.body; }
          if (hasImages && /image|vision|multimodal|format|support/i.test(msg)) {
            r = await curlPost(API_URL, apiHeaders(), { model: MODEL, temperature: TEMP, messages: messagesBase.map((m, i) => i === messagesBase.length - 1 ? { role: 'user', content: summary } : m) });
            note = '⚠️ Текущая модель не поддерживает изображения — ответил по тексту файлов.\n\n';
          }
        }
        let data; try { data = JSON.parse(r.body); } catch (e) { data = null; }
        if (r.status < 200 || r.status >= 300) {
          const msg = (data && data.error && (data.error.message || data.error)) || r.body.slice(0, 300);
          return res.json({ ok: false, error: 'API ' + r.status + ': ' + msg });
        }
        const reply = note + data.choices[0].message.content;
        history.push({ role: 'assistant', content: reply, time: Date.now() }); save();
        res.json({ ok: true, reply, model: data.model || MODEL });
      } catch (e) {
        if (/curl/.test(e.message) && /not recognized|не является|ENOENT/i.test(e.message))
          return res.json({ ok: false, error: 'curl не найден. Обнови Windows 10+ или поставь curl.' });
        res.json({ ok: false, error: 'Сеть: ' + e.message });
      }
    })();
    return;
  }

  // ===== стриминг (NDJSON) =====
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  let acc = '', model = MODEL, dead = false, retried = false, proc = null, tmpFile = null;
  const w = o => { try { res.write(JSON.stringify(o) + '\n'); } catch (e) {} };

  function finalize(saveIt) {
    if (dead) return; dead = true;
    if (saveIt && acc) { history.push({ role: 'assistant', content: acc, time: Date.now() }); save(); }
    try { w({ done: true, model }); res.end(); } catch (e) {}
  }
  function fail(msg) {
    if (/image|vision|multimodal|format|support/i.test(msg) && hasImages && !retried) {
      retried = true;
      acc = '⚠️ Текущая модель не поддерживает изображения — ответил по тексту файлов.\n\n';
      start(false);
      return;
    }
    if (dead) return; dead = true;
    w({ err: msg.slice(0, 400) });
    try { res.end(); } catch (e) {}
  }

  function start(withImages) {
    tmpFile = path.join(os.tmpdir(), 'myai-stream-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
    const msgs = withImages ? messagesBase
      : messagesBase.map((m, i) => i === messagesBase.length - 1 ? { role: 'user', content: summary } : m);
    fs.writeFileSync(tmpFile, JSON.stringify({ model: MODEL, temperature: TEMP, stream: true, messages: msgs }));
    const args = ['-sS', '-N', '--max-time', '300', '-X', 'POST', API_URL];
    if (PROXY) args.push('-x', PROXY);
    args.push('-H', 'Content-Type: application/json');
    for (const [k, v] of Object.entries(apiHeaders())) args.push('-H', `${k}: ${v}`);
    args.push('-d', '@' + tmpFile);
    proc = spawn('curl', args, { windowsHide: true });
    res.on('close', () => {
      if (dead) return;
      try { proc.kill(); } catch (e) {}
      finalize(true); // пользователь остановил — сохраняем частичный ответ
    });

    let buf = '', sawData = false;
    proc.stdout.on('data', c => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        handleLine(line.trim());
        if (dead) return;
      }
      if (!sawData && buf.length > 65536) { try { proc.kill(); } catch (e) {} fail('Слишком большой или невалидный ответ API'); }
    });
    proc.stderr.on('data', () => {});
    proc.on('error', e => fail('curl: ' + e.message));
    proc.on('close', () => {
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      if (!dead) finalize(true);
    });

    function handleLine(s) {
      if (!s) return;
      if (s.startsWith('data:')) {
        sawData = true;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') return;
        let j; try { j = JSON.parse(payload); } catch (e) { return; }
        if (j.error) { fail((j.error.message || String(j.error)).slice(0, 300)); return; }
        if (j.model) model = j.model;
        const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (d) { acc += d; w({ d }); }
      } else if (s.startsWith('{')) {
        // тело ошибки (не SSE)
        try { const j = JSON.parse(s); if (j.error) fail((j.error.message || JSON.stringify(j.error)).slice(0, 300)); } catch (e) {}
      }
    }
  }
  start(hasImages);
}

app.post('/api/chat', (req, res) => {
  const userText = String(req.body.text || '').trim().slice(0, 8000);
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 5) : [];
  if (!userText && !attachments.length) return res.json({ ok: false, error: 'Пустое сообщение' });
  if (!API_KEY) return res.json({ ok: false, error: 'Не задан ключ API (перезапусти с AI_API_KEY=...)' });
  chatCore(res, userText, attachments, !!req.body.stream);
});

app.post('/api/regenerate', (req, res) => {
  if (!API_KEY) return res.json({ ok: false, error: 'Не задан ключ API' });
  if (history.length && history[history.length - 1].role === 'assistant') { history.pop(); save(); }
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  if (!lastUser) return res.json({ ok: false, error: 'Нечего перегенерировать' });
  chatCore(res, lastUser.content.replace(/\n\[(файл|изображение):[^\]]+\]/g, ''), [], !!req.body.stream, true);
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
