const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph } = require('docx');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free';
const FALLBACK_MODEL = process.env.AIVA_FALLBACK_MODEL || 'openrouter/free';
const VISION_MODELS = [
  process.env.AIVA_VISION_MODEL || 'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free'
];
const WEB_SEARCH_ENABLED = String(process.env.WEB_SEARCH_ENABLED || 'true').toLowerCase() !== 'false';
const DATA_DIR = path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(express.json({ limit: '55mb' }));
app.use(express.urlencoded({ extended: true, limit: '55mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 }
});

function safeText(v) { return String(v ?? '').replace(/\u0000/g, '').trim(); }
function sanitizeFilename(name) { return String(name || 'file.txt').replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_').slice(0, 150); }
function isImageMime(m) { return /^image\//i.test(String(m || '')); }
function isImageFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return isImageMime(file.mimetype) || ['.jpg','.jpeg','.png','.webp','.gif','.bmp'].includes(ext);
}
function chooseModel(mode) {
  if (!mode || mode === 'auto' || mode === 'fast') return FALLBACK_MODEL;
  if (mode === 'smart' || mode === 'max') return MODEL;
  return mode;
}
function cleanModelText(text) {
  return String(text || '').replace(/<AIVA_WEB_SEARCH[\s\S]*?<\/AIVA_WEB_SEARCH>/gi, '').replace(/<AIVA_WEB_SEARCH[^>]*>/gi, '').trim();
}
function needsWebSearch(text) {
  const q = safeText(text).toLowerCase();
  if (!q) return false;
  return ['погода','погоду','температур','сейчас','сегодня','завтра','новост','последние','актуаль','найди в интернете','поищи','в интернете','курс евро','курс доллара','цена','стоимость','latest','today','tomorrow','current','news','search the web','look up'].some(x => q.includes(x));
}

async function searchDuckDuckGo(query) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Aiva/5.6' } });
  if (!r.ok) throw new Error('Web search HTTP ' + r.status);
  const html = await r.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    const title = m[2].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").trim();
    let href = m[1];
    try { href = decodeURIComponent(href); } catch {}
    out.push({ title, url: href });
  }
  return out;
}

async function callOpenRouter({ model, messages, temperature = 0.7 }) {
  if (!API_KEY) throw new Error('На сервере не задан OPENROUTER_API_KEY / AI_API_KEY.');
  const r = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://my-ai-76c0.onrender.com',
      'X-Title': 'Aiva AI Assistant'
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 4096 })
  });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const e = data?.error || {};
    const provider = e?.metadata?.provider_name ? ` [provider: ${e.metadata.provider_name}]` : '';
    const code = e?.code ? ` [code ${e.code}]` : '';
    throw new Error(`${e?.message || data?.message || `OpenRouter HTTP ${r.status}`}${code}${provider}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    const text = content.map(x => x?.text || '').join('').trim();
    if (text) return text;
  }
  if (!content) throw new Error('Модель не вернула ответ.');
  return String(content);
}

async function extractFileText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (isImageFile(file)) return '';
  if (file.mimetype === 'application/pdf' || ext === '.pdf') return (await pdfParse(file.buffer)).text || '';
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') return (await mammoth.extractRawText({ buffer: file.buffer })).value || '';
  if (file.mimetype.startsWith('text/') || ['.txt','.js','.json','.html','.css','.md','.csv','.xml','.ts','.tsx','.jsx','.py','.java','.c','.cpp','.sql','.yml','.yaml'].includes(ext)) return file.buffer.toString('utf8');
  return '';
}

function saveGeneratedFile(filename, content) {
  const safe = sanitizeFilename(filename);
  const stored = crypto.randomBytes(18).toString('hex') + path.extname(safe);
  fs.writeFileSync(path.join(FILES_DIR, stored), String(content ?? ''), 'utf8');
  return { name: safe, storedName: stored };
}
function processGeneratedFiles(text) {
  const files = [];
  const re = /<AIVA_FILE\s+name=["']([^"']+)["']>([\s\S]*?)<\/AIVA_FILE>/gi;
  let m;
  while ((m = re.exec(text))) files.push(saveGeneratedFile(m[1], m[2]));
  return { text: text.replace(re, '').trim(), files };
}

app.get('/api/health', (req,res) => res.json({ ok:true, app:'Aiva', version:'5.6.0', model:MODEL, fallbackModel:FALLBACK_MODEL, visionModels:VISION_MODELS, webSearch:WEB_SEARCH_ENABLED, hasKey:!!API_KEY }));
app.get('/api/config', (req,res) => res.json({ ok:true, model:MODEL, fallbackModel:FALLBACK_MODEL, visionModels:VISION_MODELS, hasKey:!!API_KEY, webSearch:WEB_SEARCH_ENABLED, systemPrompt:CUSTOM_PROMPT, temperature:TEMPERATURE }));

app.post('/api/upload', upload.array('files',5), async (req,res) => {
  try {
    const files=[];
    for (const file of (req.files || [])) {
      const image=isImageFile(file);
      const text=image?'':await extractFileText(file);
      files.push({ name:file.originalname, type:image?'image':'file', mimeType:file.mimetype, size:file.size, text:text.slice(0,60000), dataUrl:image ? `data:${file.mimetype};base64,${file.buffer.toString('base64')}` : null });
    }
    res.json({ok:true,files});
  } catch(e) { console.error('UPLOAD ERROR',e); res.status(500).json({ok:false,error:e.message||'Ошибка загрузки'}); }
});

app.get('/api/files/:storedName', (req,res) => {
  const stored=path.basename(req.params.storedName), fp=path.join(FILES_DIR,stored);
  if(!fs.existsSync(fp)) return res.status(404).send('File not found');
  res.download(fp,sanitizeFilename(req.query.name || stored));
});

let CUSTOM_PROMPT='';
let TEMPERATURE=0.7;
app.post('/api/prompt',(req,res)=>{ CUSTOM_PROMPT=safeText(req.body?.systemPrompt ?? req.body?.prompt); if(req.body?.temperature!=null){const n=Number(req.body.temperature);if(Number.isFinite(n))TEMPERATURE=Math.min(2,Math.max(0,n));} res.json({ok:true,systemPrompt:CUSTOM_PROMPT,temperature:TEMPERATURE}); });
app.post('/api/model',(req,res)=>res.json({ok:true,model:chooseModel(req.body?.model)}));
app.post('/api/clear',(req,res)=>res.json({ok:true}));

app.post('/api/chat', async (req,res) => {
  try {
    const body=req.body||{};
    const text=safeText(body.text);
    const attachments=Array.isArray(body.attachments)?body.attachments.slice(0,5):[];
    if(!text && !attachments.length) return res.status(400).json({ok:false,error:'Пустое сообщение.'});

    const images=attachments.filter(a => a && (a.type==='image' || isImageMime(a.mimeType) || isImageMime(a.type)) && typeof a.dataUrl==='string' && a.dataUrl.startsWith('data:image/'));
    const files=attachments.filter(a => !images.includes(a));

    let webContext='';
    if(WEB_SEARCH_ENABLED && !images.length && needsWebSearch(text)) {
      try {
        const results=await searchDuckDuckGo(text);
        webContext=results.map((x,i)=>`${i+1}. ${x.title}\n${x.url}`).join('\n');
      } catch(e) { console.error('WEB SEARCH ERROR',e.message); }
    }

    const baseSystem = `Ты Aiva — полезный русскоязычный AI-ассистент. Отвечай точно и по делу. ${CUSTOM_PROMPT || ''}`;
    const visionSystem = `Ты Aiva, система анализа изображений. ВАЖНО: описывай только то, что реально видно на изображении. Не выдумывай текст, числа, таблицы, людей, предметы или детали. Если надпись неразборчива, прямо напиши «[неразборчиво]». Если изображение повернуто — мысленно учитывай ориентацию. Если пользователь просит прочитать текст, переписывай только уверенно различимые фрагменты. ${CUSTOM_PROMPT || ''}`;

    let userContent=text || 'Проанализируй изображение подробно.';
    if(files.length) {
      const parts=files.map(f=>`Файл: ${safeText(f.name)}\n${safeText(f.text).slice(0,40000)}`).filter(Boolean);
      if(parts.length) userContent += `\n\nВложения:\n${parts.join('\n\n')}`;
    }
    if(webContext) userContent += `\n\nРезультаты веб-поиска (используй как справочную информацию):\n${webContext}`;

    let messages;
    let usedModel;
    if(images.length) {
      const content=[{type:'text',text:userContent}];
      for(const a of images) content.push({type:'image_url',image_url:{url:a.dataUrl}});
      messages=[{role:'system',content:visionSystem},{role:'user',content}];
      let answer=''; let lastError=null;
      for(const model of VISION_MODELS) {
        try { answer=await callOpenRouter({model,messages,temperature:0.2}); usedModel=model; break; }
        catch(e){ lastError=e; console.error(`VISION ERROR [${model}]: ${e.message}`); }
      }
      if(!answer) throw new Error(`Не удалось обработать фото. ${lastError?.message || ''}`.trim());
      const processed=processGeneratedFiles(cleanModelText(answer));
      return res.json({ok:true,reply:processed.text,text:processed.text,answer:processed.text,files:processed.files,model:usedModel,vision:true});
    }

    messages=[{role:'system',content:baseSystem},{role:'user',content:userContent}];
    const selected=chooseModel(body.mode);
    let answer;
    try { answer=await callOpenRouter({model:selected,messages,temperature:TEMPERATURE}); usedModel=selected; }
    catch(e) { if(selected!==FALLBACK_MODEL){ console.error(`MODEL ERROR [${selected}]`,e.message); answer=await callOpenRouter({model:FALLBACK_MODEL,messages,temperature:TEMPERATURE}); usedModel=FALLBACK_MODEL; } else throw e; }
    const processed=processGeneratedFiles(cleanModelText(answer));
    res.json({ok:true,reply:processed.text,text:processed.text,answer:processed.text,files:processed.files,model:usedModel,webSearch:!!webContext});
  } catch(e) {
    console.error('CHAT ERROR:',e);
    res.status(500).json({ok:false,error:e?.message || 'Ошибка Aiva'});
  }
});

app.post('/api/regenerate',async(req,res)=>res.status(400).json({ok:false,error:'Для регенерации нужно передать исходное сообщение.'}));

app.get('/api/test-vision',(req,res)=>res.json({ok:true,visionModels:VISION_MODELS}));

app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({ok:false,error:'API endpoint not found'});
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.listen(PORT,()=>{
  console.log(`Aiva 5.6.0 running on port ${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Fallback: ${FALLBACK_MODEL}`);
  console.log(`Vision: ${VISION_MODELS.join(', ')}`);
  console.log(`Web search: ${WEB_SEARCH_ENABLED}`);
  console.log(`API key: ${API_KEY ? 'YES' : 'NO'}`);
});
