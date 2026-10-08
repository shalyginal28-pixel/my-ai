const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { Document, Packer, Paragraph } = require("docx");
const PDFDocument = require("pdfkit");

const app = express();

const PORT = process.env.PORT || 4000;

const API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.AI_API_KEY ||
  "";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/* =========================================================
   MODELS
========================================================= */

const FALLBACK_MODEL =
  process.env.AIVA_FALLBACK_MODEL ||
  process.env.AI_MODEL ||
  "openrouter/free";

let MODEL =
  process.env.AI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b:free";

/*
  Vision модели.
  Первая — основная.
  Остальные используются автоматически,
  если провайдер первой модели вернул ошибку.
*/
const VISION_MODELS = [
  process.env.AIVA_VISION_MODEL ||
    "google/gemma-4-31b-it:free",

  "google/gemma-4-26b-a4b-it:free"
];

/* =========================================================
   SETTINGS
========================================================= */

const WEB_SEARCH_ENABLED =
  String(
    process.env.WEB_SEARCH_ENABLED || "true"
  ).toLowerCase() !== "false";

let CUSTOM_PROMPT = "";
let TEMPERATURE = 0.7;

const DATA_DIR =
  path.join(__dirname, "data");

const FILES_DIR =
  path.join(DATA_DIR, "files");

fs.mkdirSync(FILES_DIR, {
  recursive: true
});

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  express.json({
    limit: "60mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "60mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   MULTER
========================================================= */

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

function isImageFile(file) {
  if (!file) return false;

  const ext =
    path.extname(
      file.originalname || ""
    ).toLowerCase();

  return (
    String(file.mimetype || "")
      .toLowerCase()
      .startsWith("image/") ||

    [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif"
    ].includes(ext)
  );
}

function chooseModel(mode) {
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
    return MODEL;
  }

  return mode;
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
   WEB SEARCH
========================================================= */

function needsWebSearch(text) {
  const q =
    safeText(text).toLowerCase();

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
        .replace(
          /&quot;/g,
          '"'
        )
        .replace(
          /&amp;/g,
          "&"
        )
        .replace(
          /&#x27;/g,
          "'"
        )
        .trim();

    if (!title || !url) {
      continue;
    }

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

  const response =
    await fetch(url, {
      headers: {
        "User-Agent": "Aiva/5.3"
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

    if (
      !titleMatch ||
      !linkMatch
    ) {
      continue;
    }

    const title =
      titleMatch[1]
        .replace(
          /<!\[CDATA\[/g,
          ""
        )
        .replace(
          /\]\]>/g,
          ""
        )
        .replace(
          /&amp;/g,
          "&"
        )
        .replace(
          /&quot;/g,
          '"'
        )
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

  const cleanQuery =
    safeText(query)
      .replace(
        /\b2024\b/g,
        ""
      )
      .replace(
        /\b2025\b/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const queries = [
    cleanQuery,
    `${cleanQuery} 2026`
  ];

  const all = [];
  const seen = new Set();

  for (
    const q of queries
  ) {
    if (!q) continue;

    try {
      const google =
        await searchGoogleNews(q);

      for (
        const item of google
      ) {
        if (
          !item.url ||
          seen.has(item.url)
        ) {
          continue;
        }

        seen.add(item.url);
        all.push(item);

        if (
          all.length >= 10
        ) {
          return all;
        }
      }
    } catch (err) {
      console.error(
        "Google News error:",
        err.message
      );
    }

    try {
      const duck =
        await searchDuckDuckGo(q);

      for (
        const item of duck
      ) {
        if (
          !item.url ||
          seen.has(item.url)
        ) {
          continue;
        }

        seen.add(item.url);
        all.push(item);

        if (
          all.length >= 10
        ) {
          return all;
        }
      }
    } catch (err) {
      console.error(
        "DuckDuckGo error:",
        err.message
      );
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

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Aiva/5.3"
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
      current.weatherDesc?.[0]
        ?.value || ""
  };
}

function detectCity(text) {
  const q =
    safeText(text)
      .toLowerCase();

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

  if (
    q.includes("нью-йорке") ||
    q.includes("нью йорке")
  ) {
    return "New York";
  }

  return "Riga";
}

/* =========================================================
   SYSTEM PROMPT
========================================================= */

const CORE_SYSTEM_PROMPT = `
Ты — Aiva, современный AI-ассистент.

Отвечай на русском, если пользователь пишет по-русски.

Отвечай естественно, понятно и без лишней воды.

Не выдумывай факты.

Если пользователь прислал изображение:
- внимательно анализируй только то, что реально видно;
- не придумывай текст;
- если текст плохо читается, прямо скажи об этом;
- если часть изображения неразборчива, обозначь её как [неразборчиво];
- подробно описывай объекты, людей, фон, цвета, положение предметов и видимый текст;
- если пользователь просит распознать рукописный текст, не угадывай сомнительные слова.

Не выводи служебные теги:
<AIVA_WEB_SEARCH>
</AIVA_WEB_SEARCH>

Если пользователь просит создать файл:

<AIVA_FILE name="filename.txt">
содержимое файла
</AIVA_FILE>

Будь полезным, точным и дружелюбным.
`;

/* =========================================================
   OPENROUTER
========================================================= */

async function callOpenRouter({
  messages,
  model,
  temperature = 0.7
}) {
  if (!API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY не установлен на Render."
    );
  }

  const response =
    await fetch(
      OPENROUTER_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${API_KEY}`,

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
          temperature,
          stream: false
        })
      }
    );

  const raw =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter вернул не JSON: ${raw.slice(
        0,
        1000
      )}`
    );
  }

  if (!response.ok) {
    const provider =
      data?.error?.metadata
        ?.provider_name;

    const message =
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`;

    const code =
      data?.error?.code
        ? ` [code ${data.error.code}]`
        : "";

    const providerText =
      provider
        ? ` [provider: ${provider}]`
        : "";

    throw new Error(
      `${message}${code}${providerText}`
    );
  }

  const content =
    data?.choices?.[0]
      ?.message?.content;

  if (!content) {
    throw new Error(
      "Модель не вернула текстовый ответ."
    );
  }

  if (
    Array.isArray(content)
  ) {
    return content
      .map(part =>
        typeof part === "string"
          ? part
          : part?.text || ""
      )
      .join("");
  }

  return String(content);
}

/* =========================================================
   FILE GENERATION
========================================================= */

function sanitizeFilename(name) {
  return String(
    name || "file.txt"
  )
    .replace(
      /[^a-zA-Z0-9а-яА-ЯёЁ._-]/g,
      "_"
    )
    .slice(0, 150);
}

function saveGeneratedFile(
  filename,
  content
) {
  const safeName =
    sanitizeFilename(filename);

  const ext =
    path.extname(
      safeName
    ).toLowerCase();

  const storedName =
    crypto.randomBytes(18)
      .toString("hex") +
    (ext || ".txt");

  const filePath =
    path.join(
      FILES_DIR,
      storedName
    );

  const text =
    String(
      content ?? ""
    ).replace(
      /\r\n/g,
      "\n"
    );

  if (ext === ".docx") {
    return createDocxFile(
      filePath,
      text
    ).then(() => ({
      name: safeName,
      storedName
    }));
  }

  if (ext === ".pdf") {
    return createPdfFile(
      filePath,
      text
    ).then(() => ({
      name: safeName,
      storedName
    }));
  }

  fs.writeFileSync(
    filePath,
    text,
    "utf8"
  );

  return {
    name: safeName,
    storedName
  };
}

async function createDocxFile(
  filePath,
  text
) {
  const children =
    text
      .split("\n")
      .map(
        line =>
          new Paragraph({
            text: line
          })
      );

  const doc =
    new Document({
      sections: [
        {
          properties: {},
          children
        }
      ]
    });

  const buffer =
    await Packer.toBuffer(doc);

  fs.writeFileSync(
    filePath,
    buffer
  );
}

function createPdfFile(
  filePath,
  text
) {
  return new Promise(
    (resolve, reject) => {
      const doc =
        new PDFDocument({
          margin: 50
        });

      const out =
        fs.createWriteStream(
          filePath
        );

      out.on(
        "finish",
        resolve
      );

      out.on(
        "error",
        reject
      );

      doc.pipe(out);

      doc.fontSize(11);

      for (
        const line of
          text.split("\n")
      ) {
        doc.text(
          line || " "
        );
      }

      doc.end();
    }
  );
}

async function processGeneratedFiles(
  text
) {
  const files = [];

  const regex =
    /<AIVA_FILE\s+name=["']([^"']+)["']>([\s\S]*?)<\/AIVA_FILE>/gi;

  let match;

  while (
    (match = regex.exec(text))
  ) {
    const file =
      await saveGeneratedFile(
        match[1],
        match[2]
      );

    files.push(file);
  }

  return {
    text:
      text
        .replace(
          regex,
          ""
        )
        .trim(),

    files
  };
}

/* =========================================================
   FILE TEXT EXTRACTION
========================================================= */

async function extractFileText(
  file
) {
  const ext =
    path.extname(
      file.originalname || ""
    ).toLowerCase();

  if (
    isImageFile(file)
  ) {
    return "";
  }

  if (
    file.mimetype ===
      "application/pdf" ||
    ext === ".pdf"
  ) {
    const result =
      await pdfParse(
        file.buffer
      );

    return result.text || "";
  }

  if (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const result =
      await mammoth.extractRawText(
        {
          buffer:
            file.buffer
        }
      );

    return result.value || "";
  }

  if (
    file.mimetype.startsWith(
      "text/"
    ) ||
    [
      ".txt",
      ".js",
      ".json",
      ".html",
      ".css",
      ".md",
      ".csv",
      ".xml",
      ".ts",
      ".tsx",
      ".jsx",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".sql",
      ".yml",
      ".yaml"
    ].includes(ext)
  ) {
    return file.buffer.toString(
      "utf8"
    );
  }

  return "";
}

/* =========================================================
   UPLOAD
========================================================= */

app.post(
  "/api/upload",
  upload.array(
    "files",
    5
  ),
  async (
    req,
    res
  ) => {
    try {
      const result = [];

      for (
        const file of
          req.files || []
      ) {
        const image =
          isImageFile(file);

        const text =
          image
            ? ""
            : await extractFileText(
                file
              );

        let dataUrl = null;

        if (image) {
          dataUrl =
            `data:${file.mimetype};base64,` +
            file.buffer.toString(
              "base64"
            );
        }

        result.push({
          name:
            file.originalname,

          type:
            image
              ? "image"
              : "file",

          mimeType:
            file.mimetype,

          size:
            file.size,

          text:
            text.slice(
              0,
              60000
            ),

          dataUrl
        });
      }

      res.json({
        ok: true,
        files: result
      });

    } catch (err) {
      console.error(
        "UPLOAD ERROR:",
        err
      );

      res.status(500).json({
        ok: false,
        error:
          err.message ||
          "Ошибка загрузки файла"
      });
    }
  }
);

/* =========================================================
   DOWNLOAD GENERATED FILE
========================================================= */

app.get(
  "/api/files/:storedName",
  (
    req,
    res
  ) => {
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
      !fs.existsSync(
        filePath
      )
    ) {
      return res
        .status(404)
        .send(
          "File not found"
        );
    }

    const requestedName =
      req.query.name ||
      storedName;

    res.download(
      filePath,
      sanitizeFilename(
        requestedName
      )
    );
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (
    req,
    res
  ) => {
    res.json({
      ok: true,
      app: "Aiva",
      version: "5.4.0",
      node:
        process.version,

      model:
        MODEL,

      fallbackModel:
        FALLBACK_MODEL,

      visionModels:
        VISION_MODELS,

      webSearch:
        WEB_SEARCH_ENABLED,

      hasKey:
        !!API_KEY
    });
  }
);

/* =========================================================
   CONFIG
========================================================= */

app.get(
  "/api/config",
  (
    req,
    res
  ) => {
    res.json({
      ok: true,

      model:
        MODEL,

      fallbackModel:
        FALLBACK_MODEL,

      visionModel:
        VISION_MODELS[0],

      hasKey:
        !!API_KEY,

      webSearch:
        WEB_SEARCH_ENABLED,

      systemPrompt:
        CUSTOM_PROMPT,

      temperature:
        TEMPERATURE
    });
  }
);

/* =========================================================
   CHAT
========================================================= */

async function handleChat(
  req,
  res
) {
  try {
    const body =
      req.body || {};

    const messages =
      Array.isArray(
        body.messages
      )
        ? body.messages
        : [];

    const message =
      safeText(
        body.message ||
        body.text ||
        ""
      );

    const attachments =
      Array.isArray(
        body.attachments
      )
        ? body.attachments
            .slice(0, 5)
        : [];

    const requestedModel =
      safeText(
        body.model ||
        body.mode ||
        ""
      );

    const temperature =
      Number.isFinite(
        Number(
          body.temperature
        )
      )
        ? Number(
            body.temperature
          )
        : TEMPERATURE;

    const systemPrompt =
      safeText(
        body.systemPrompt ||
        ""
      );

    let history =
      messages.slice(-40);

    const lastUser =
      [...history]
        .reverse()
        .find(
          m =>
            m &&
            m.role ===
              "user"
        );

    const userText =
      message ||
      (
        typeof lastUser?.content ===
        "string"
          ? lastUser.content
          : ""
      );

    const imageAttachments =
      attachments.filter(
        a =>
          a &&
          (
            a.type ===
              "image" ||
            String(
              a.mimeType ||
              ""
            ).startsWith(
              "image/"
            )
          ) &&
          a.dataUrl
      );

    const fileAttachments =
      attachments.filter(
        a =>
          a &&
          a.type !==
            "image" &&
          a.text
      );

    if (
      !userText &&
      !attachments.length
    ) {
      return res.status(
        400
      ).json({
        ok: false,
        error:
          "Пустое сообщение."
      });
    }

    /* =====================================================
       WEB / WEATHER
    ===================================================== */

    let webContext = "";

    if (
      WEB_SEARCH_ENABLED &&
      /погод|температур|weather/i.test(
        userText
      )
    ) {
      try {
        const weather =
          await getWeather(
            detectCity(
              userText
            )
          );

        webContext =
          `
АКТУАЛЬНЫЕ ДАННЫЕ О ПОГОДЕ:

Город: ${weather.city}
Температура: ${weather.temperature}°C
Ощущается как: ${weather.feelsLike}°C
Влажность: ${weather.humidity}%
Ветер: ${weather.wind} км/ч
Давление: ${weather.pressure} hPa
Описание: ${weather.description}
`;

      } catch (err) {
        console.error(
          "Weather error:",
          err.message
        );
      }
    }

    if (
      WEB_SEARCH_ENABLED &&
      needsWebSearch(
        userText
      ) &&
      !/погод|температур|weather/i.test(
        userText
      )
    ) {
      try {
        const results =
          await searchWeb(
            userText
          );

        if (
          results.length
        ) {
          webContext +=
            "\nАКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА:\n";

          results.forEach(
            (
              item,
              index
            ) => {
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
      } catch (err) {
        console.error(
          "Web search error:",
          err.message
        );
      }
    }

    /* =====================================================
       FILE CONTEXT
    ===================================================== */

    const fileContext =
      fileAttachments
        .map(
          a =>
            `\nФАЙЛ: ${safeText(a.name) || "файл"}\n` +
            String(
              a.text || ""
            ).slice(
              0,
              60000
            )
        )
        .join("\n");

    const system =
      [
        CORE_SYSTEM_PROMPT,

        systemPrompt
          ? `\nПользовательские настройки:\n${systemPrompt}`
          : "",

        webContext,

        fileContext
          ? `\nДАННЫЕ ИЗ ПРИКРЕПЛЁННЫХ ФАЙЛОВ:\n${fileContext}`
          : ""
      ]
        .filter(Boolean)
        .join("\n");

    /* =====================================================
       IMAGE CONTENT
    ===================================================== */

    let currentUserContent =
      userText ||
      (
        imageAttachments.length
          ? "Подробно опиши, что изображено на фото."
          : "Посмотри прикреплённые файлы."
      );

    if (
      imageAttachments.length
    ) {
      currentUserContent =
        [
          {
            type: "text",
            text:
              currentUserContent
          },

          ...imageAttachments.map(
            a => ({
              type:
                "image_url",

              image_url: {
                url:
                  a.dataUrl
              }
            })
          )
        ];
    }

    /* =====================================================
       HISTORY
    ===================================================== */

    let finalMessages = [
      {
        role: "system",
        content: system
      }
    ];

    /*
      Если в истории есть массив content,
      оставляем его.
    */
    for (
      const item of
        history.slice(-40)
    ) {
      if (
        !item ||
        !item.role
      ) {
        continue;
      }

      finalMessages.push({
        role:
          item.role,

        content:
          item.content
      });
    }

    /*
      Не добавляем дубликат сообщения,
      если frontend уже передал
      текущего пользователя в messages.
    */
    const lastHistory =
      finalMessages[
        finalMessages.length - 1
      ];

    const alreadyHasCurrent =
      lastHistory &&
      lastHistory.role ===
        "user" &&
      (
        typeof lastHistory.content ===
          "string"
          ? lastHistory.content ===
            currentUserContent
          : false
      );

    if (
      !alreadyHasCurrent
    ) {
      finalMessages.push({
        role: "user",
        content:
          currentUserContent
      });
    }

    /* =====================================================
       MODEL SELECTION
    ===================================================== */

    const hasImages =
      imageAttachments.length >
      0;

    let selectedModel =
      chooseModel(
        requestedModel
      );

    /*
      КРИТИЧНО:
      Фото НИКОГДА не отправляем
      в обычную текстовую модель.
    */
    if (hasImages) {
      selectedModel =
        VISION_MODELS[0];
    }

    /* =====================================================
       CALL AI
    ===================================================== */

    let answer = "";
    let usedModel =
      selectedModel;

    if (hasImages) {

      let lastVisionError =
        null;

      for (
        const visionModel of
          VISION_MODELS
      ) {
        try {
          console.log(
            `VISION TRY: ${visionModel}`
          );

          answer =
            await callOpenRouter({
              messages:
                finalMessages,

              model:
                visionModel,

              temperature:
                Math.min(
                  0.3,
                  temperature
                )
            });

          usedModel =
            visionModel;

          console.log(
            `VISION SUCCESS: ${visionModel}`
          );

          break;

        } catch (err) {

          lastVisionError =
            err;

          console.error(
            `VISION ERROR [${visionModel}]:`,
            err.message
          );
        }
      }

      if (
        !answer
      ) {
        throw new Error(
          "Не удалось обработать изображение. " +
          (
            lastVisionError?.message ||
            "Vision provider error"
          )
        );
      }

    } else {

      try {

        answer =
          await callOpenRouter({
            messages:
              finalMessages,

            model:
              selectedModel,

            temperature
          });

      } catch (
        primaryError
      ) {

        console.error(
          "PRIMARY MODEL ERROR:",
          primaryError.message
        );

        if (
          selectedModel !==
          FALLBACK_MODEL
        ) {

          answer =
            await callOpenRouter({
              messages:
                finalMessages,

              model:
                FALLBACK_MODEL,

              temperature
            });

          usedModel =
            FALLBACK_MODEL;

        } else {
          throw primaryError;
        }
      }
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    answer =
      cleanModelText(
        answer
      );

    const processed =
      await processGeneratedFiles(
        answer
      );

    const files =
      processed.files.map(
        file => ({
          ...file,

          url:
            `/api/files/${file.storedName}?name=` +
            encodeURIComponent(
              file.name
            )
        })
      );

    let reply =
      processed.text;

    if (
      files.length
    ) {
      reply +=
        "\n\n" +
        files
          .map(
            f =>
              `📎 [Скачать ${f.name}](${f.url})`
          )
          .join("\n");
    }

    if (!reply) {
      reply =
        "Модель вернула пустой ответ.";
    }

    return res.json({
      ok: true,

      reply,

      text: reply,

      answer: reply,

      files,

      model:
        usedModel,

      vision:
        hasImages,

      webSearch:
        !!webContext
    });

  } catch (err) {

    console.error(
      "CHAT ERROR:",
      err
    );

    return res
      .status(500)
      .json({
        ok: false,

        error:
          err?.message ||
          "Ошибка Aiva"
      });
  }
}

app.post(
  "/api/chat",
  handleChat
);

/* =========================================================
   REGENERATE
========================================================= */

app.post(
  "/api/regenerate",
  async (
    req,
    res
  ) => {
    try {

      const body =
        req.body || {};

      const messages =
        Array.isArray(
          body.messages
        )
          ? body.messages
          : [];

      const lastAssistantIndex =
        [...messages]
          .map(
            (
              m,
              i
            ) => ({
              ...m,
              index: i
            })
          )
          .reverse()
          .find(
            m =>
              m.role ===
              "assistant"
          );

      const trimmed =
        lastAssistantIndex
          ? messages.slice(
              0,
              lastAssistantIndex.index
            )
          : messages;

      req.body = {
        ...body,
        messages:
          trimmed
      };

      return handleChat(
        req,
        res
      );

    } catch (err) {

      console.error(
        "REGENERATE ERROR:",
        err
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            err.message
        });
    }
  }
);

/* =========================================================
   MODEL
========================================================= */

app.post(
  "/api/model",
  (
    req,
    res
  ) => {
    try {

      const requested =
        safeText(
          req.body?.model
        );

      if (
        requested
      ) {
        MODEL =
          requested;
      }

      res.json({
        ok: true,
        model:
          MODEL
      });

    } catch (err) {

      res.status(500)
        .json({
          ok: false,
          error:
            err.message
        });
    }
  }
);

/* =========================================================
   PROMPT
========================================================= */

app.post(
  "/api/prompt",
  (
    req,
    res
  ) => {
    try {

      CUSTOM_PROMPT =
        safeText(
          req.body?.systemPrompt ??
          req.body?.prompt
        );

      if (
        req.body?.temperature !=
        null
      ) {
        const value =
          Number(
            req.body.temperature
          );

        if (
          Number.isFinite(
            value
          )
        ) {
          TEMPERATURE =
            Math.min(
              2,
              Math.max(
                0,
                value
              )
            );
        }
      }

      res.json({
        ok: true,

        systemPrompt:
          CUSTOM_PROMPT,

        temperature:
          TEMPERATURE
      });

    } catch (err) {

      res.status(500)
        .json({
          ok: false,
          error:
            err.message
        });
    }
  }
);

/* =========================================================
   CLEAR
========================================================= */

app.post(
  "/api/clear",
  (
    req,
    res
  ) => {
    res.json({
      ok: true
    });
  }
);

/* =========================================================
   FALLBACK ROUTE
========================================================= */

app.get(
  "*",
  (
    req,
    res
  ) => {

    if (
      req.path.startsWith(
        "/api/"
      )
    ) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            "API endpoint not found"
        });
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      `Aiva 5.4.0 running on port ${PORT}`
    );

    console.log(
      `Model: ${MODEL}`
    );

    console.log(
      `Fallback: ${FALLBACK_MODEL}`
    );

    console.log(
      `Vision: ${VISION_MODELS.join(", ")}`
    );

    console.log(
      `Web search: ${WEB_SEARCH_ENABLED}`
    );

    console.log(
      `API key: ${
        API_KEY
          ? "YES"
          : "NO"
      }`
    );

    console.log(
      "================================="
    );
  }
);
