const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.AI_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const FALLBACK_MODEL =
  process.env.AIVA_FALLBACK_MODEL || "openrouter/free";

let MODEL =
  process.env.AI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b:free";

const WEB_SEARCH_ENABLED =
  String(process.env.WEB_SEARCH_ENABLED || "true").toLowerCase() !== "false";

const DATA_DIR = path.join(__dirname, "data");
const FILES_DIR = path.join(DATA_DIR, "files");

fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 5
  }
});

/* =========================================================
   HELPERS
========================================================= */

function safeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim();
}

function chooseModel(mode) {
  if (!mode || mode === "auto" || mode === "fast") {
    return FALLBACK_MODEL;
  }

  if (mode === "smart" || mode === "max") {
    return MODEL;
  }

  return mode;
}

function cleanModelText(text) {
  if (!text) return "";

  return String(text)
    .replace(/<AIVA_WEB_SEARCH[\s\S]*?<\/AIVA_WEB_SEARCH>/gi, "")
    .replace(/<AIVA_WEB_SEARCH[^>]*>/gi, "")
    .trim();
}

function needsWebSearch(text) {
  const q = safeText(text).toLowerCase();

  if (!q) return false;

  const patterns = [
    "погода",
    "погоду",
    "температур",
    "сейчас",
    "сегодня",
    "завтра",
    "последние новости",
    "последн",
    "новост",
    "актуаль",
    "найди в интернете",
    "поищи в интернете",
    "найди в сети",
    "поищи",
    "в интернете",
    "курс евро",
    "курс доллара",
    "цена",
    "стоимость",
    "latest",
    "today",
    "tomorrow",
    "current",
    "news",
    "search the web",
    "look up",
    "2026"
  ];

  return patterns.some((x) => q.includes(x));
}

/* =========================================================
   WEB SEARCH
========================================================= */

async function searchDuckDuckGo(query) {
  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTTP ${response.status}`);
  }

  const html = await response.text();

  const results = [];

  const regex =
    /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) && results.length < 8) {
    const url = match[1];

    const title = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .trim();

    if (!title || !url) continue;

    results.push({
      title,
      url
    });
  }

  return results;
}

async function searchGoogleNews(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=ru&gl=RU&ceid=RU:ru";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Aiva/4.3"
    }
  });

  if (!response.ok) {
    throw new Error(`Google News HTTP ${response.status}`);
  }

  const xml = await response.text();

  const results = [];

  const itemRegex =
    /<item>([\s\S]*?)<\/item>/gi;

  let item;

  while ((item = itemRegex.exec(xml)) && results.length < 8) {
    const block = item[1];

    const titleMatch =
      block.match(/<title>([\s\S]*?)<\/title>/i);

    const linkMatch =
      block.match(/<link>([\s\S]*?)<\/link>/i);

    const dateMatch =
      block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    if (!titleMatch || !linkMatch) continue;

    const title = titleMatch[1]
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();

    const url = linkMatch[1].trim();

    const date = dateMatch
      ? dateMatch[1].trim()
      : "";

    if (title && url) {
      results.push({
        title,
        url,
        date
      });
    }
  }

  return results;
}

async function searchWeb(query) {
  if (!WEB_SEARCH_ENABLED) {
    return [];
  }

  let cleanQuery = safeText(query);

  /* Убираем старый год, если пользователь случайно
     спросил "новости ИИ 2025", когда сейчас уже 2026 */
  cleanQuery = cleanQuery
    .replace(/\b2024\b/g, "")
    .replace(/\b2025\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const queries = [
    cleanQuery,
    `${cleanQuery} 2026`,
    `${cleanQuery} AI`,
    `искусственный интеллект последние новости 2026`
  ];

  const all = [];
  const seen = new Set();

  for (const q of queries) {
    if (!q) continue;

    try {
      const google = await searchGoogleNews(q);

      for (const item of google) {
        if (!item.url || seen.has(item.url)) continue;

        seen.add(item.url);
        all.push(item);

        if (all.length >= 10) {
          return all;
        }
      }
    } catch (err) {
      console.error("Google News error:", err.message);
    }

    try {
      const duck = await searchDuckDuckGo(q);

      for (const item of duck) {
        if (!item.url || seen.has(item.url)) continue;

        seen.add(item.url);
        all.push(item);

        if (all.length >= 10) {
          return all;
        }
      }
    } catch (err) {
      console.error("DuckDuckGo error:", err.message);
    }
  }

  return all;
}

/* =========================================================
   WEATHER
========================================================= */

async function getWeather(city) {
  const url =
    "https://wttr.in/" +
    encodeURIComponent(city) +
    "?format=j1";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Aiva/4.3"
    }
  });

  if (!response.ok) {
    throw new Error(`Weather HTTP ${response.status}`);
  }

  const data = await response.json();

  const current =
    data.current_condition &&
    data.current_condition[0];

  if (!current) {
    throw new Error("Weather data unavailable");
  }

  return {
    city,
    temperature: current.temp_C,
    feelsLike: current.FeelsLikeC,
    humidity: current.humidity,
    wind: current.windspeedKmph,
    pressure: current.pressure,
    description:
      current.weatherDesc &&
      current.weatherDesc[0]
        ? current.weatherDesc[0].value
        : ""
  };
}

function detectCity(text) {
  const q = safeText(text).toLowerCase();

  if (q.includes("риге") || q.includes("рига")) {
    return "Riga";
  }

  if (q.includes("таллине") || q.includes("таллин")) {
    return "Tallinn";
  }

  if (q.includes("вильнюсе") || q.includes("вильнюс")) {
    return "Vilnius";
  }

  if (q.includes("лондоне") || q.includes("лондон")) {
    return "London";
  }

  if (q.includes("берлине") || q.includes("берлин")) {
    return "Berlin";
  }

  if (q.includes("нью-йорке") || q.includes("нью йорке")) {
    return "New York";
  }

  return "Riga";
}

/* =========================================================
   OPENROUTER
========================================================= */

const CORE_SYSTEM_PROMPT = `
Ты — Aiva, современный AI-ассистент.

Отвечай на русском, если пользователь пишет по-русски.
Отвечай естественно, понятно и без лишней воды.

Не выдумывай факты.
Если сервер передал результаты веб-поиска, используй их.
Если веб-поиск дал ссылки, можешь указывать их обычным URL.

Не выводи служебные теги:
<AIVA_WEB_SEARCH>
</AIVA_WEB_SEARCH>

Если пользователь просит создать файл, используй формат:

<AIVA_FILE name="filename.txt">
содержимое файла
</AIVA_FILE>

Будь полезным, точным и дружелюбным.
`;

async function callOpenRouter({
  messages,
  model,
  temperature = 0.7
}) {
  if (!API_KEY) {
    throw new Error(
      "AI_API_KEY не установлен на сервере Render."
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        "https://my-aii.onrender.com",
      "X-Title": "Aiva"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: false
    })
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter вернул не JSON: ${raw.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`;

    throw new Error(message);
  }

  const content =
    data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
      "Модель не вернула текстовый ответ."
    );
  }

  return String(content);
}

/* =========================================================
   FILES
========================================================= */

function sanitizeFilename(name) {
  return String(name || "file.txt")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, "_")
    .slice(0, 150);
}

function saveGeneratedFile(filename, content) {
  const safeName = sanitizeFilename(filename);

  const storedName =
    crypto.randomBytes(18).toString("hex") +
    path.extname(safeName);

  const filePath =
    path.join(FILES_DIR, storedName);

  fs.writeFileSync(
    filePath,
    String(content || ""),
    "utf8"
  );

  return {
    name: safeName,
    storedName
  };
}

function processGeneratedFiles(text) {
  const files = [];

  const regex =
    /<AIVA_FILE\s+name=["']([^"']+)["']>([\s\S]*?)<\/AIVA_FILE>/gi;

  let match;

  while ((match = regex.exec(text))) {
    const file = saveGeneratedFile(
      match[1],
      match[2]
    );

    files.push(file);
  }

  const cleanText = text
    .replace(regex, "")
    .trim();

  return {
    text: cleanText,
    files
  };
}

/* =========================================================
   FILE UPLOAD
========================================================= */

async function extractFileText(file) {
  const ext =
    path.extname(file.originalname).toLowerCase();

  if (
    file.mimetype === "application/pdf" ||
    ext === ".pdf"
  ) {
    const result =
      await pdfParse(file.buffer);

    return result.text || "";
  }

  if (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const result =
      await mammoth.extractRawText({
        buffer: file.buffer
      });

    return result.value || "";
  }

  if (
    file.mimetype.startsWith("text/") ||
    [
      ".txt",
      ".js",
      ".json",
      ".html",
      ".css",
      ".md",
      ".csv",
      ".xml"
    ].includes(ext)
  ) {
    return file.buffer.toString("utf8");
  }

  return "";
}

app.post(
  "/api/upload",
  upload.array("files", 5),
  async (req, res) => {
    try {
      const result = [];

      for (const file of req.files || []) {
        const text =
          await extractFileText(file);

        result.push({
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
          text: text.slice(0, 40000)
        });
      }

      res.json({
        ok: true,
        files: result
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   DOWNLOAD GENERATED FILE
========================================================= */

app.get(
  "/api/files/:storedName",
  (req, res) => {
    const storedName =
      path.basename(req.params.storedName);

    const filePath =
      path.join(FILES_DIR, storedName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    const requestedName =
      req.query.name ||
      storedName;

    res.download(
      filePath,
      sanitizeFilename(requestedName)
    );
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "Aiva",
    version: "4.3.0",
    node: process.version,
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
    webSearch: WEB_SEARCH_ENABLED,
    hasKey: !!API_KEY
  });
});

/* =========================================================
   CONFIG
========================================================= */

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
    hasKey: !!API_KEY,
    webSearch: WEB_SEARCH_ENABLED,
    temperature: 0.7
  });
});

/* =========================================================
   CHAT
========================================================= */

async function handleChat(req, res) {
  try {
    const {
      messages = [],
      message = "",
      model,
      temperature = 0.7,
      systemPrompt = ""
    } = req.body || {};

    let history = Array.isArray(messages)
      ? messages
      : [];

    if (
      message &&
      !history.some(
        (m) =>
          m &&
          m.role === "user" &&
          m.content === message
      )
    ) {
      history = [
        ...history,
        {
          role: "user",
          content: message
        }
      ];
    }

    const lastUser =
      [...history]
        .reverse()
        .find((m) => m?.role === "user");

    const userText =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : message;

    let webContext = "";

    /* Погода */
    if (
      WEB_SEARCH_ENABLED &&
      /погод|температур|weather/i.test(userText)
    ) {
      try {
        const city =
          detectCity(userText);

        const weather =
          await getWeather(city);

        webContext = `
АКТУАЛЬНЫЕ ДАННЫЕ О ПОГОДЕ:

Город: ${weather.city}
Температура: ${weather.temperature}°C
Ощущается как: ${weather.feelsLike}°C
Влажность: ${weather.humidity}%
Ветер: ${weather.wind} км/ч
Давление: ${weather.pressure} hPa
Описание: ${weather.description}

Используй эти данные в ответе.
`;
      } catch (err) {
        console.error(
          "Weather error:",
          err.message
        );
      }
    }

    /* Общий веб-поиск */
    if (
      WEB_SEARCH_ENABLED &&
      needsWebSearch(userText) &&
      !/погод|температур|weather/i.test(userText)
    ) {
      try {
        const results =
          await searchWeb(userText);

        if (results.length) {
          webContext +=
            "\n\nАКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА:\n";

          results.forEach((r, i) => {
            webContext +=
              `\n${i + 1}. ${r.title}\n` +
              `URL: ${r.url}\n` +
              (r.date
                ? `Дата: ${r.date}\n`
                : "");
          });
        } else {
          webContext +=
            "\nВеб-поиск не вернул результатов. Не выдумывай новости.\n";
        }
      } catch (err) {
        console.error(
          "Web search error:",
          err.message
        );
      }
    }

    const system = [
      CORE_SYSTEM_PROMPT,
      systemPrompt
        ? `\nПользовательские настройки:\n${systemPrompt}`
        : "",
      webContext
    ]
      .filter(Boolean)
      .join("\n");

    const selectedModel =
      chooseModel(model);

    const finalMessages = [
      {
        role: "system",
        content: system
      },
      ...history.slice(-40)
    ];

    let answer;

    try {
      answer = await callOpenRouter({
        messages: finalMessages,
        model: selectedModel,
        temperature
      });
    } catch (primaryError) {
      console.error(
        "Primary model error:",
        primaryError.message
      );

      if (
        selectedModel !== FALLBACK_MODEL
      ) {
        answer = await callOpenRouter({
          messages: finalMessages,
          model: FALLBACK_MODEL,
          temperature
        });
      } else {
        throw primaryError;
      }
    }

    answer = cleanModelText(answer);

    const processed =
      processGeneratedFiles(answer);

    const files =
      processed.files.map((file) => ({
        ...file,
        url:
          `/api/files/${file.storedName}?name=` +
          encodeURIComponent(file.name)
      }));

    res.json({
      ok: true,
      text: processed.text,
      answer: processed.text,
      files,
      model: selectedModel,
      webSearch: !!webContext
    });
  } catch (err) {
    console.error(
      "CHAT ERROR:",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        err?.message ||
        "Ошибка Aiva"
    });
  }
}

app.post("/api/chat", handleChat);

/* =========================================================
   REGENERATE
========================================================= */

app.post(
  "/api/regenerate",
  async (req, res) => {
    try {
      const body = req.body || {};

      const messages =
        Array.isArray(body.messages)
          ? body.messages
          : [];

      const lastAssistantIndex =
        [...messages]
          .map((m, i) => ({
            ...m,
            index: i
          }))
          .reverse()
          .find(
            (m) =>
              m.role === "assistant"
          );

      let trimmed =
        lastAssistantIndex
          ? messages.slice(
              0,
              lastAssistantIndex.index
            )
          : messages;

      req.body = {
        ...body,
        messages: trimmed
      };

      return handleChat(req, res);
    } catch (err) {
      console.error(err);

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   MODEL
========================================================= */

app.post("/api/model", (req, res) => {
  try {
    const requested =
      safeText(req.body?.model);

    if (requested) {
      MODEL = requested;
    }

    res.json({
      ok: true,
      model: MODEL
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   PROMPT
========================================================= */

let CUSTOM_PROMPT = "";

app.post("/api/prompt", (req, res) => {
  CUSTOM_PROMPT =
    safeText(req.body?.prompt);

  res.json({
    ok: true,
    prompt: CUSTOM_PROMPT
  });
});

/* =========================================================
   CLEAR
========================================================= */

app.post("/api/clear", (req, res) => {
  res.json({
    ok: true
  });
});

/* =========================================================
   FALLBACK ROUTE
========================================================= */

app.get("*", (req, res) => {
  if (
    req.path.startsWith("/api/")
  ) {
    return res
      .status(404)
      .json({
        ok: false,
        error: "API endpoint not found"
      });
  }

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log(
    `Aiva 4.3 running on port ${PORT}`
  );

  console.log(
    `Model: ${MODEL}`
  );

  console.log(
    `Fallback: ${FALLBACK_MODEL}`
  );

  console.log(
    `Web search: ${WEB_SEARCH_ENABLED}`
  );

  console.log(
    `API key: ${API_KEY ? "YES" : "NO"}`
  );
});
