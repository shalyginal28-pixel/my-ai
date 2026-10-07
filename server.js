const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const app = express();

const PORT = process.env.PORT || 4000;

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.AI_API_KEY ||
  "";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const MODEL =
  process.env.AI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b:free";

const FALLBACK_MODEL =
  process.env.AIVA_FALLBACK_MODEL ||
  "openrouter/free";

const VISION_MODEL =
  process.env.AIVA_VISION_MODEL ||
  "google/gemma-4-31b-it:free";

const WEB_SEARCH_ENABLED =
  String(process.env.WEB_SEARCH_ENABLED || "true").toLowerCase() !== "false";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_FILE_TEXT = 40000;
const HISTORY_KEEP = 40;

const DATA_DIR = path.join(__dirname, "data");
const FILES_DIR = path.join(DATA_DIR, "files");

fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "50mb"
}));

app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});


/* =========================================================
   STATE
========================================================= */

let currentModel = MODEL;
let customPrompt = "";
let temperature = 0.7;

/*
  Последние сообщения пользователей.
  Нужно для /api/regenerate.
*/
let lastRequest = {
  text: "",
  attachments: [],
  mode: "auto",
  messages: []
};


/* =========================================================
   HELPERS
========================================================= */

function safeText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/\u0000/g, "")
    .trim();
}


function safeJsonParse(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}


function isImageMime(type) {
  return typeof type === "string" &&
    type.toLowerCase().startsWith("image/");
}


function isImageFile(file) {
  return !!file && isImageMime(file.mimetype);
}


function imageToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}


function sanitizeFilename(name) {
  return String(name || "file.txt")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, "_")
    .slice(0, 150);
}


function chooseModel(mode) {
  mode = safeText(mode).toLowerCase();

  if (
    !mode ||
    mode === "auto" ||
    mode === "fast"
  ) {
    return FALLBACK_MODEL;
  }

  if (
    mode === "smart" ||
    mode === "max"
  ) {
    return currentModel;
  }

  /*
    Если frontend передал конкретную модель.
  */
  if (
    mode.includes("/") ||
    mode.includes(":")
  ) {
    return mode;
  }

  return currentModel;
}


function cleanModelText(text) {
  return String(text || "")
    .replace(
      /<AIVA_WEB_SEARCH[\s\S]*?<\/AIVA_WEB_SEARCH>/gi,
      ""
    )
    .replace(
      /<AIVA_WEB_SEARCH[^>]*>/gi,
      ""
    )
    .trim();
}


/* =========================================================
   VISION PROMPT
========================================================= */

function createVisionPrompt(userText) {
  const request = safeText(userText);

  if (request) {
    return `
Ты анализируешь фотографию для пользователя Aiva.

Запрос пользователя:
${request}

Очень важно:

1. Смотри непосредственно на изображение.
2. Не придумывай текст, цифры, формулы или слова.
3. Если текст плохо виден, пиши [неразборчиво].
4. Не заменяй непонятные символы похожими словами.
5. Если это рукописный текст, переписывай только реально различимые символы.
6. Если есть таблица, не придумывай строки и значения.
7. Если фотография повернута, мысленно поверни её.
8. Если часть изображения закрыта или размыта, скажи об этом.
9. Не делай вид, что видишь то, чего на изображении нет.

Отвечай по существу.
`.trim();
  }

  return `
Внимательно изучи изображение.

Опиши только то, что действительно видно.

Если есть текст:
- перепиши его максимально точно;
- сохраняй порядок строк;
- не угадывай;
- при сомнении используй [неразборчиво].

Если есть таблица:
- не придумывай строки;
- не придумывай значения;
- передавай только видимые данные.

Если изображение повернуто — мысленно поверни его.

Ничего не выдумывай.
`.trim();
}


/* =========================================================
   OPENROUTER
========================================================= */

async function callOpenRouter({
  model,
  messages,
  temperature: temp = 0.7
}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY не настроен на Render."
    );
  }

  const response = await fetch(
    OPENROUTER_URL,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Bearer ${OPENROUTER_API_KEY}`,

        "Content-Type":
          "application/json",

        "HTTP-Referer":
          "https://my-aii.onrender.com",

        "X-Title":
          "Aiva"
      },

      body: JSON.stringify({
        model,
        messages,
        temperature: temp,
        stream: false
      })
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter вернул не JSON: ${raw.slice(0, 1000)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`
    );
  }

  let content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    "";

  if (Array.isArray(content)) {
    content = content
      .map(part => {
        if (typeof part === "string") {
          return part;
        }

        return part?.text || "";
      })
      .join("");
  }

  content = String(content || "");

  if (!content.trim()) {
    throw new Error(
      "Модель не вернула текстовый ответ."
    );
  }

  return content;
}


/* =========================================================
   FILE TEXT
========================================================= */

async function extractFileText(file) {
  if (!file) {
    return "";
  }

  const name =
    String(file.originalname || "").toLowerCase();

  const mime =
    String(file.mimetype || "").toLowerCase();

  /*
    Не пытаемся читать картинки как текст.
  */
  if (isImageFile(file)) {
    return "";
  }


  /*
    TXT / CSV / JSON / MD / HTML / CSS / JS / XML
  */

  if (
    mime.startsWith("text/") ||
    /\.(txt|csv|json|md|html|htm|xml|css|js)$/i.test(name)
  ) {
    return file.buffer
      .toString("utf8")
      .slice(0, MAX_FILE_TEXT);
  }


  /*
    DOCX
  */

  if (
    mime.includes("word") ||
    mime.includes("officedocument") ||
    name.endsWith(".docx")
  ) {
    try {
      const result =
        await mammoth.extractRawText({
          buffer: file.buffer
        });

      return String(result.value || "")
        .slice(0, MAX_FILE_TEXT);

    } catch (error) {
      return `[Не удалось прочитать DOCX: ${file.originalname}]`;
    }
  }


  /*
    PDF
  */

  if (
    mime === "application/pdf" ||
    name.endsWith(".pdf")
  ) {
    try {
      const result =
        await pdfParse(file.buffer);

      return String(result.text || "")
        .slice(0, MAX_FILE_TEXT);

    } catch (error) {
      return `[Не удалось прочитать PDF: ${file.originalname}]`;
    }
  }


  return "";
}


/* =========================================================
   WEB SEARCH
========================================================= */

function needsWebSearch(text) {
  const q =
    safeText(text).toLowerCase();

  if (!q) {
    return false;
  }

  const patterns = [
    "погода",
    "погоду",
    "температур",
    "сейчас",
    "сегодня",
    "завтра",
    "новости",
    "последние новости",
    "последн",
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
    "look up"
  ];

  return patterns.some(
    x => q.includes(x)
  );
}


async function searchDuckDuckGo(query) {
  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 Aiva"
      }
    });

  if (!response.ok) {
    throw new Error(
      `DuckDuckGo HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const results = [];

  const regex =
    /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < 8
  ) {
    const url = match[1];

    const title =
      match[2]
        .replace(/<[^>]+>/g, "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .trim();

    if (title && url) {
      results.push({
        title,
        url
      });
    }
  }

  return results;
}


async function searchGoogleNews(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=ru&gl=RU&ceid=RU:ru";

  const response =
    await fetch(url, {
      headers: {
        "User-Agent": "Aiva"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Google News HTTP ${response.status}`
    );
  }

  const xml =
    await response.text();

  const results = [];

  const itemRegex =
    /<item>([\s\S]*?)<\/item>/gi;

  let item;

  while (
    (item = itemRegex.exec(xml)) &&
    results.length < 8
  ) {
    const block = item[1];

    const titleMatch =
      block.match(
        /<title>([\s\S]*?)<\/title>/i
      );

    const linkMatch =
      block.match(
        /<link>([\s\S]*?)<\/link>/i
      );

    const dateMatch =
      block.match(
        /<pubDate>([\s\S]*?)<\/pubDate>/i
      );

    if (!titleMatch || !linkMatch) {
      continue;
    }

    const title =
      titleMatch[1]
        .replace(/<!\[CDATA\[/g, "")
        .replace(/\]\]>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .trim();

    const url =
      linkMatch[1].trim();

    const date =
      dateMatch
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

  const q =
    safeText(query);

  if (!q) {
    return [];
  }

  const all = [];
  const seen = new Set();

  const queries = [
    q,
    `${q} 2026`
  ];

  for (const currentQuery of queries) {

    try {
      const news =
        await searchGoogleNews(
          currentQuery
        );

      for (const item of news) {
        if (
          !item.url ||
          seen.has(item.url)
        ) {
          continue;
        }

        seen.add(item.url);
        all.push(item);

        if (all.length >= 10) {
          return all;
        }
      }

    } catch (error) {
      console.error(
        "Google News:",
        error.message
      );
    }


    try {
      const duck =
        await searchDuckDuckGo(
          currentQuery
        );

      for (const item of duck) {
        if (
          !item.url ||
          seen.has(item.url)
        ) {
          continue;
        }

        seen.add(item.url);
        all.push(item);

        if (all.length >= 10) {
          return all;
        }
      }

    } catch (error) {
      console.error(
        "DuckDuckGo:",
        error.message
      );
    }
  }

  return all;
}


/* =========================================================
   WEATHER
========================================================= */

function detectCity(text) {
  const q =
    safeText(text).toLowerCase();

  if (
    q.includes("риге") ||
    q.includes("рига")
  ) {
    return "Riga";
  }

  if (
    q.includes("таллине") ||
    q.includes("таллин")
  ) {
    return "Tallinn";
  }

  if (
    q.includes("вильнюсе") ||
    q.includes("вильнюс")
  ) {
    return "Vilnius";
  }

  if (
    q.includes("лондоне") ||
    q.includes("лондон")
  ) {
    return "London";
  }

  if (
    q.includes("берлине") ||
    q.includes("берлин")
  ) {
    return "Berlin";
  }

  return "Riga";
}


async function getWeather(city) {
  const url =
    "https://wttr.in/" +
    encodeURIComponent(city) +
    "?format=j1";

  const response =
    await fetch(url, {
      headers: {
        "User-Agent": "Aiva"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Weather HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  const current =
    data.current_condition?.[0];

  if (!current) {
    throw new Error(
      "Weather data unavailable"
    );
  }

  return {
    city,

    temperature:
      current.temp_C,

    feelsLike:
      current.FeelsLikeC,

    humidity:
      current.humidity,

    wind:
      current.windspeedKmph,

    pressure:
      current.pressure,

    description:
      current.weatherDesc?.[0]?.value ||
      ""
  };
}


/* =========================================================
   SYSTEM PROMPT
========================================================= */

const CORE_SYSTEM_PROMPT = `
Ты — Aiva, современный AI-ассистент.

Отвечай на русском, если пользователь пишет по-русски.

Отвечай естественно, понятно и без лишней воды.

Не выдумывай факты.

Если тебе переданы результаты веб-поиска,
используй их.

Если информация неизвестна,
честно скажи об этом.

Не выводи служебные теги:
<AIVA_WEB_SEARCH>
</AIVA_WEB_SEARCH>

Если пользователь просит создать файл,
используй:

<AIVA_FILE name="filename.txt">
содержимое файла
</AIVA_FILE>
`.trim();


/* =========================================================
   GENERATED FILES
========================================================= */

function saveGeneratedFile(
  filename,
  content
) {
  const safeName =
    sanitizeFilename(filename);

  const storedName =
    crypto
      .randomBytes(18)
      .toString("hex") +
    path.extname(safeName);

  const filePath =
    path.join(
      FILES_DIR,
      storedName
    );

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

  while (
    (match = regex.exec(text))
  ) {
    files.push(
      saveGeneratedFile(
        match[1],
        match[2]
      )
    );
  }

  return {
    text:
      String(text || "")
        .replace(regex, "")
        .trim(),

    files
  };
}


/* =========================================================
   BUILD ATTACHMENTS
========================================================= */

function normalizeAttachments(
  attachments
) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .slice(0, MAX_FILES)
    .filter(Boolean)
    .map(file => ({
      name:
        safeText(file.name) ||
        "файл",

      type:
        safeText(
          file.type ||
          file.mimetype
        ),

      size:
        Number(file.size) || 0,

      text:
        safeText(file.text),

      dataUrl:
        typeof file.dataUrl === "string"
          ? file.dataUrl
          : ""
    }));
}


/* =========================================================
   CREATE MESSAGES
========================================================= */

function createMessages({
  text,
  attachments,
  previousMessages = [],
  useVision = false
}) {
  const messages = [];

  /*
    Системное сообщение
  */

  messages.push({
    role: "system",
    content: [
      CORE_SYSTEM_PROMPT,

      customPrompt
        ? `\nДополнительные настройки пользователя:\n${customPrompt}`
        : ""
    ]
      .filter(Boolean)
      .join("\n")
  });


  /*
    История
  */

  if (Array.isArray(previousMessages)) {
    for (
      const message of previousMessages.slice(
        -HISTORY_KEEP
      )
    ) {

      if (!message) {
        continue;
      }

      const role =
        message.role === "assistant"
          ? "assistant"
          : "user";

      let content =
        message.content;

      if (
        typeof content !== "string" &&
        !Array.isArray(content)
      ) {
        content =
          String(content || "");
      }

      messages.push({
        role,
        content
      });
    }
  }


  /*
    Текст файлов
  */

  let finalText =
    safeText(text);

  const fileTexts = [];

  for (
    const attachment of attachments
  ) {

    if (
      attachment.text
    ) {
      fileTexts.push(
        `\n\n--- Файл: ${attachment.name} ---\n` +
        attachment.text.slice(
          0,
          MAX_FILE_TEXT
        ) +
        "\n--- Конец файла ---"
      );
    }
  }

  if (fileTexts.length) {
    finalText +=
      fileTexts.join("");
  }


  /*
    Если есть картинки,
    отправляем multimodal content.
  */

  const imageAttachments =
    attachments.filter(
      file =>
        file.dataUrl &&
        isImageMime(file.type)
    );

  if (
    useVision &&
    imageAttachments.length
  ) {

    const content = [];

    content.push({
      type: "text",
      text:
        createVisionPrompt(
          finalText
        )
    });


    for (
      const image of imageAttachments
    ) {

      content.push({
        type: "image_url",

        image_url: {
          url:
            image.dataUrl
        }
      });
    }

    messages.push({
      role: "user",
      content
    });

  } else {

    messages.push({
      role: "user",
      content:
        finalText ||
        "Продолжи разговор."
    });
  }

  return messages;
}


/* =========================================================
   MAIN CHAT
========================================================= */

async function runChat({
  text,
  attachments = [],
  mode = "auto",
  previousMessages = []
}) {
  const normalizedAttachments =
    normalizeAttachments(
      attachments
    );

  const hasImages =
    normalizedAttachments.some(
      file =>
        file.dataUrl &&
        isImageMime(file.type)
    );


  /*
    Если есть картинки,
    всегда используем vision model.
  */

  let selectedModel =
    hasImages
      ? VISION_MODEL
      : chooseModel(mode);

  let selectedTemperature =
    hasImages
      ? 0.1
      : temperature;


  /*
    Веб-контекст
  */

  let webContext = "";

  if (
    WEB_SEARCH_ENABLED &&
    needsWebSearch(text) &&
    !hasImages
  ) {

    /*
      Погода
    */

    if (
      /погод|температур|weather/i
        .test(text)
    ) {

      try {

        const city =
          detectCity(text);

        const weather =
          await getWeather(city);

        webContext += `
АКТУАЛЬНАЯ ПОГОДА:

Город: ${weather.city}
Температура: ${weather.temperature}°C
Ощущается как: ${weather.feelsLike}°C
Влажность: ${weather.humidity}%
Ветер: ${weather.wind} км/ч
Давление: ${weather.pressure} hPa
Описание: ${weather.description}

Используй эти данные.
`;

      } catch (error) {

        console.error(
          "Weather error:",
          error.message
        );
      }

    } else {

      /*
        Обычный веб-поиск
      */

      try {

        const results =
          await searchWeb(text);

        if (results.length) {

          webContext +=
            "\nАКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА:\n";

          results.forEach(
            (item, index) => {

              webContext +=
                `\n${index + 1}. ${item.title}\n` +
                `URL: ${item.url}\n` +
                (
                  item.date
                    ? `Дата: ${item.date}\n`
                    : ""
                );
            }
          );
        }

      } catch (error) {

        console.error(
          "Web search error:",
          error.message
        );
      }
    }
  }


  /*
    Добавляем веб-контекст
  */

  const messages =
    createMessages({
      text,
      attachments:
        normalizedAttachments,
      previousMessages,
      useVision:
        hasImages
    });

  if (webContext) {

    messages[0].content +=
      "\n\n" +
      webContext;
  }


  /*
    Запрос к основной модели
  */

  let answer = "";
  let usedModel =
    selectedModel;

  try {

    answer =
      await callOpenRouter({
        model:
          selectedModel,

        messages,

        temperature:
          selectedTemperature
      });

  } catch (firstError) {

    console.error(
      "Primary model error:",
      firstError.message
    );


    /*
      Для vision fallback
      тоже пытаемся использовать fallback.
    */

    if (
      FALLBACK_MODEL &&
      FALLBACK_MODEL !== selectedModel
    ) {

      usedModel =
        FALLBACK_MODEL;

      answer =
        await callOpenRouter({
          model:
            FALLBACK_MODEL,

          messages,

          temperature:
            selectedTemperature
        });

    } else {

      throw firstError;
    }
  }


  answer =
    cleanModelText(answer);


  if (!answer) {
    throw new Error(
      "AI вернул пустой ответ."
    );
  }


  /*
    Генерируемые файлы
  */

  const processed =
    processGeneratedFiles(
      answer
    );

  const files =
    processed.files.map(
      file => ({
        name:
          file.name,

        url:
          `/api/files/${file.storedName}?name=` +
          encodeURIComponent(
            file.name
          )
      })
    );


  return {
    reply:
      processed.text,

    answer:
      processed.text,

    text:
      processed.text,

    files,

    model:
      usedModel,

    vision:
      hasImages,

    webSearch:
      Boolean(webContext)
  };
}


/* =========================================================
   /api/chat
========================================================= */

app.post(
  "/api/chat",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      const text =
        safeText(body.text);

      const attachments =
        normalizeAttachments(
          body.attachments
        );

      const mode =
        safeText(
          body.mode
        ) || "auto";


      /*
        Важно:
        сохраняем последний запрос
        для regenerate.
      */

      lastRequest = {
        text,
        attachments,
        mode,
        messages: []
      };


      /*
        Выполняем AI.
      */

      const result =
        await runChat({
          text,
          attachments,
          mode,
          previousMessages:
            []
        });


      /*
        Запоминаем результат
        как историю для regenerate.
      */

      lastRequest.messages = [
        {
          role: "user",
          content:
            text || "Что на фото?"
        },

        {
          role: "assistant",
          content:
            result.reply
        }
      ];


      return res.json({
        ok: true,

        reply:
          result.reply,

        answer:
          result.answer,

        text:
          result.text,

        files:
          result.files,

        model:
          result.model,

        vision:
          result.vision,

        webSearch:
          result.webSearch
      });

    } catch (error) {

      console.error(
        "CHAT ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,

        error:
          error?.message ||
          "Ошибка Aiva"
      });
    }
  }
);


/* =========================================================
   /api/regenerate
========================================================= */

app.post(
  "/api/regenerate",
  async (req, res) => {

    try {

      if (
        !lastRequest.text &&
        !lastRequest.attachments.length
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Нет сообщения для повторной генерации."
        });
      }


      const mode =
        safeText(
          req.body?.mode
        ) ||
        lastRequest.mode ||
        "auto";


      /*
        Берём последнее сообщение
        и удаляем предыдущий ответ.
      */

      const previousMessages =
        Array.isArray(
          lastRequest.messages
        )
          ? lastRequest.messages.filter(
              message =>
                message.role !==
                "assistant"
            )
          : [];


      const result =
        await runChat({
          text:
            lastRequest.text,

          attachments:
            lastRequest.attachments,

          mode,

          previousMessages
        });


      /*
        Обновляем последний ответ.
      */

      lastRequest.messages = [
        {
          role: "user",

          content:
            lastRequest.text ||
            "Что на фото?"
        },

        {
          role: "assistant",

          content:
            result.reply
        }
      ];


      return res.json({
        ok: true,

        reply:
          result.reply,

        answer:
          result.answer,

        text:
          result.text,

        files:
          result.files,

        model:
          result.model,

        vision:
          result.vision,

        webSearch:
          result.webSearch
      });

    } catch (error) {

      console.error(
        "REGENERATE ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,

        error:
          error?.message ||
          "Ошибка повторной генерации"
      });
    }
  }
);


/* =========================================================
   /api/upload
========================================================= */

app.post(
  "/api/upload",
  upload.array(
    "files",
    MAX_FILES
  ),

  async (req, res) => {

    try {

      const files =
        Array.isArray(req.files)
          ? req.files
          : [];

      const result = [];

      for (
        const file of files
      ) {

        const item = {
          name:
            file.originalname,

          filename:
            file.originalname,

          type:
            file.mimetype,

          mimetype:
            file.mimetype,

          size:
            file.size,

          isImage:
            isImageFile(file)
        };


        /*
          Текстовые документы
        */

        if (
          !isImageFile(file)
        ) {

          item.text =
            await extractFileText(
              file
            );
        }


        /*
          Картинки:
          возвращаем data URL,
          чтобы frontend мог показать
          настоящий preview.
        */

        if (
          isImageFile(file)
        ) {

          item.dataUrl =
            imageToDataUrl(
              file
            );
        }

        result.push(item);
      }


      return res.json({
        ok: true,

        files:
          result,

        attachments:
          result
      });

    } catch (error) {

      console.error(
        "UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,

        error:
          error?.message ||
          "Ошибка загрузки файла"
      });
    }
  }
);


/* =========================================================
   GENERATED FILE DOWNLOAD
========================================================= */

app.get(
  "/api/files/:storedName",
  (req, res) => {

    const storedName =
      path.basename(
        req.params.storedName
      );

    const filePath =
      path.join(
        FILES_DIR,
        storedName
      );

    if (
      !fs.existsSync(filePath)
    ) {

      return res.status(404)
        .send("File not found");
    }


    const requestedName =
      req.query.name ||
      storedName;


    return res.download(
      filePath,
      sanitizeFilename(
        requestedName
      )
    );
  }
);


/* =========================================================
   /api/health
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,

      service:
        "Aiva",

      version:
        "5.3.3",

      model:
        currentModel,

      fallbackModel:
        FALLBACK_MODEL,

      visionModel:
        VISION_MODEL,

      webSearch:
        WEB_SEARCH_ENABLED,

      apiKey:
        Boolean(
          OPENROUTER_API_KEY
        )
    });
  }
);


/* =========================================================
   /api/config
========================================================= */

app.get(
  "/api/config",
  (req, res) => {

    res.json({
      ok: true,

      model:
        currentModel,

      fallbackModel:
        FALLBACK_MODEL,

      visionModel:
        VISION_MODEL,

      hasKey:
        Boolean(
          OPENROUTER_API_KEY
        ),

      webSearch:
        WEB_SEARCH_ENABLED,

      temperature,

      systemPrompt:
        customPrompt,

      features: {
        chat: true,
        regenerate: true,
        upload: true,
        images: true,
        vision: true,
        files: true,
        weather: true,
        webSearch:
          WEB_SEARCH_ENABLED
      }
    });
  }
);


/* =========================================================
   /api/model
========================================================= */

app.post(
  "/api/model",
  (req, res) => {

    try {

      const requested =
        safeText(
          req.body?.model
        );

      if (requested) {
        currentModel =
          requested;
      }

      return res.json({
        ok: true,

        model:
          currentModel
      });

    } catch (error) {

      return res.status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* =========================================================
   /api/prompt
========================================================= */

app.post(
  "/api/prompt",
  (req, res) => {

    try {

      customPrompt =
        safeText(
          req.body?.systemPrompt ??
          req.body?.prompt
        );


      if (
        req.body?.temperature !==
        undefined
      ) {

        const value =
          Number(
            req.body.temperature
          );

        if (
          Number.isFinite(value)
        ) {

          temperature =
            Math.min(
              2,
              Math.max(
                0,
                value
              )
            );
        }
      }


      return res.json({
        ok: true,

        systemPrompt:
          customPrompt,

        temperature
      });

    } catch (error) {

      return res.status(500)
        .json({
          ok: false,
          error:
            error.message
        });
    }
  }
);


/* =========================================================
   /api/clear
========================================================= */

app.post(
  "/api/clear",
  (req, res) => {

    lastRequest = {
      text: "",
      attachments: [],
      mode: "auto",
      messages: []
    };

    res.json({
      ok: true
    });
  }
);


/* =========================================================
   API 404
========================================================= */

app.use(
  (req, res, next) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res.status(404)
        .json({
          ok: false,

          error:
            "API endpoint not found",

          endpoint:
            req.path
        });
    }

    next();
  }
);


/* =========================================================
   FRONTEND
========================================================= */

app.get(
  "/",
  (req, res) => {

    const index =
      path.join(
        __dirname,
        "public",
        "index.html"
      );

    if (
      fs.existsSync(index)
    ) {

      return res.sendFile(
        index
      );
    }

    return res.status(404)
      .send(
        "Aiva frontend not found"
      );
  }
);


/* =========================================================
   SPA FALLBACK
========================================================= */

app.use(
  (req, res) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {

      return res.status(404)
        .json({
          ok: false,

          error:
            "API endpoint not found"
        });
    }


    const index =
      path.join(
        __dirname,
        "public",
        "index.html"
      );


    if (
      fs.existsSync(index)
    ) {

      return res.sendFile(
        index
      );
    }


    return res.status(404)
      .send(
        "Aiva frontend not found"
      );
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      error
    );


    if (
      error instanceof
      multer.MulterError
    ) {

      let message =
        error.message;


      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {

        message =
          "Файл слишком большой. Максимум 20 MB.";
      }


      if (
        error.code ===
        "LIMIT_FILE_COUNT"
      ) {

        message =
          "Можно прикрепить максимум 5 файлов.";
      }


      return res.status(400)
        .json({
          ok: false,
          error: message
        });
    }


    return res.status(500)
      .json({
        ok: false,

        error:
          error?.message ||
          "Ошибка сервера"
      });
  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Aiva 5.3.3 running on port ${PORT}`
    );

    console.log(
      `Model: ${currentModel}`
    );

    console.log(
      `Fallback model: ${FALLBACK_MODEL}`
    );

    console.log(
      `Vision model: ${VISION_MODEL}`
    );

    console.log(
      `Web search: ${
        WEB_SEARCH_ENABLED
          ? "YES"
          : "NO"
      }`
    );

    console.log(
      `API key: ${
        OPENROUTER_API_KEY
          ? "YES"
          : "NO"
      }`
    );
  }
);
