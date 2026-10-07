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
const API_KEY = process.env.AI_API_KEY || "";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/*
=========================================================
MODELS
=========================================================
*/

const FALLBACK_MODEL =
  process.env.AIVA_FALLBACK_MODEL || "openrouter/free";

const VISION_MODEL =
  process.env.AIVA_VISION_MODEL || "openrouter/free";

let MODEL =
  process.env.AI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b:free";

const WEB_SEARCH_ENABLED =
  String(process.env.WEB_SEARCH_ENABLED || "true").toLowerCase() !==
  "false";

/*
=========================================================
DIRECTORIES
=========================================================
*/

const DATA_DIR = path.join(__dirname, "data");
const FILES_DIR = path.join(DATA_DIR, "files");

fs.mkdirSync(FILES_DIR, {
  recursive: true
});

/*
=========================================================
EXPRESS
=========================================================
*/

app.use(
  express.json({
    limit: "50mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
=========================================================
UPLOAD
=========================================================
*/

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 5
  }
});

/*
=========================================================
HELPERS
=========================================================
*/

function safeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim();
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
  if (!text) {
    return "";
  }

  return String(text)
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

function needsWebSearch(text) {
  const q = safeText(text).toLowerCase();

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

  return patterns.some(function (x) {
    return q.includes(x);
  });
}

/*
=========================================================
WEB SEARCH
=========================================================
*/

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
    throw new Error(
      "DuckDuckGo HTTP " +
      response.status
    );
  }

  const html = await response.text();

  const results = [];

  const regex =
    /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) &&
    results.length < 8
  ) {
    const resultUrl = match[1];

    const title = match[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .trim();

    if (!title || !resultUrl) {
      continue;
    }

    results.push({
      title: title,
      url: resultUrl
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
      "User-Agent": "Aiva/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Google News HTTP " +
      response.status
    );
  }

  const xml = await response.text();

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

    const title = titleMatch[1]
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();

    const resultUrl =
      linkMatch[1].trim();

    const date =
      dateMatch
        ? dateMatch[1].trim()
        : "";

    if (title && resultUrl) {
      results.push({
        title: title,
        url: resultUrl,
        date: date
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

  cleanQuery = cleanQuery
    .replace(/\b2024\b/g, "")
    .replace(/\b2025\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const queries = [
    cleanQuery,
    cleanQuery + " 2026",
    cleanQuery + " AI",
    "искусственный интеллект последние новости 2026"
  ];

  const all = [];
  const seen = new Set();

  for (const q of queries) {
    if (!q) {
      continue;
    }

    try {
      const google =
        await searchGoogleNews(q);

      for (const item of google) {
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
    } catch (err) {
      console.error(
        "Google News error:",
        err.message
      );
    }

    try {
      const duck =
        await searchDuckDuckGo(q);

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
    } catch (err) {
      console.error(
        "DuckDuckGo error:",
        err.message
      );
    }
  }

  return all;
}

/*
=========================================================
WEATHER
=========================================================
*/

async function getWeather(city) {
  const url =
    "https://wttr.in/" +
    encodeURIComponent(city) +
    "?format=j1";

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Aiva/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Weather HTTP " +
      response.status
    );
  }

  const data = await response.json();

  const current =
    data.current_condition &&
    data.current_condition[0];

  if (!current) {
    throw new Error(
      "Weather data unavailable"
    );
  }

  return {
    city: city,
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

/*
=========================================================
OPENROUTER
=========================================================
*/

const CORE_SYSTEM_PROMPT = `
Ты — Aiva, современный AI-ассистент.

Отвечай на русском, если пользователь пишет по-русски.
Отвечай естественно, понятно и без лишней воды.

Не выдумывай факты.
Если сервер передал результаты веб-поиска, используй их.

Если пользователь прикрепил изображение:
- внимательно проанализируй изображение;
- отвечай именно по тому, что видно на изображении;
- если пользователь спрашивает «что на фото», опиши основные объекты, людей, текст, обстановку и важные детали;
- не говори, что не видишь изображение, если изображение действительно передано модели;
- не выдумывай детали, которых на изображении нет.

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
  temperature
}) {
  if (!API_KEY) {
    throw new Error(
      "AI_API_KEY не установлен на сервере Render."
    );
  }

  const response = await fetch(
    OPENROUTER_URL,
    {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + API_KEY,

        "Content-Type":
          "application/json",

        "HTTP-Referer":
          "https://my-aii.onrender.com",

        "X-Title":
          "Aiva"
      },

      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature:
          temperature === undefined
            ? 0.7
            : temperature,
        stream: false
      })
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      "OpenRouter вернул не JSON: " +
      raw.slice(0, 500)
    );
  }

  if (!response.ok) {
    const message =
      data &&
      data.error &&
      data.error.message
        ? data.error.message
        : data && data.message
          ? data.message
          : "OpenRouter HTTP " +
            response.status;

    throw new Error(message);
  }

  const content =
    data &&
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!content) {
    throw new Error(
      "Модель не вернула текстовый ответ."
    );
  }

  return String(content);
}

/*
=========================================================
FILES
=========================================================
*/

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

async function saveGeneratedFile(
  filename,
  content
) {
  const safeName =
    sanitizeFilename(filename);

  const ext =
    path.extname(safeName).toLowerCase();

  const storedName =
    crypto.randomBytes(18).toString("hex") +
    (ext || ".txt");

  const filePath =
    path.join(
      FILES_DIR,
      storedName
    );

  const text =
    String(content || "").replace(
      /\r\n/g,
      "\n"
    );

  if (ext === ".docx") {
    await createDocxFile(
      filePath,
      text
    );

    return {
      name: safeName,
      storedName: storedName
    };
  }

  if (ext === ".pdf") {
    await createPdfFile(
      filePath,
      text
    );

    return {
      name: safeName,
      storedName: storedName
    };
  }

  fs.writeFileSync(
    filePath,
    text,
    "utf8"
  );

  return {
    name: safeName,
    storedName: storedName
  };
}

async function createDocxFile(
  filePath,
  text
) {
  const children =
    text
      .split("\n")
      .map(function (line) {
        return new Paragraph({
          text: line
        });
      });

  const doc =
    new Document({
      sections: [
        {
          properties: {},
          children: children
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
    function (resolve, reject) {
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
        const line of text.split("\n")
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
    text: text
      .replace(regex, "")
      .trim(),

    files: files
  };
}

/*
=========================================================
FILE UPLOAD
=========================================================
*/

function isImageFile(file) {
  const ext =
    path.extname(
      file.originalname
    ).toLowerCase();

  return (
    file.mimetype.startsWith("image/") ||
    [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif"
    ].includes(ext)
  );
}

async function extractFileText(file) {
  const ext =
    path.extname(
      file.originalname
    ).toLowerCase();

  if (isImageFile(file)) {
    return "";
  }

  if (
    file.mimetype ===
      "application/pdf" ||
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

app.post(
  "/api/upload",
  upload.array("files", 5),
  async function (req, res) {
    try {
      const result = [];

      for (
        const file of req.files || []
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
            "data:" +
            file.mimetype +
            ";base64," +
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

          dataUrl:
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

/*
=========================================================
DOWNLOAD GENERATED FILE
=========================================================
*/

app.get(
  "/api/files/:storedName",
  function (req, res) {
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
      return res
        .status(404)
        .send("File not found");
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

/*
=========================================================
HEALTH
=========================================================
*/

app.get(
  "/api/health",
  function (req, res) {
    res.json({
      ok: true,
      app: "Aiva",
      version: "5.1.1",
      node: process.version,
      model: MODEL,
      fallbackModel:
        FALLBACK_MODEL,
      visionModel:
        VISION_MODEL,
      webSearch:
        WEB_SEARCH_ENABLED,
      hasKey:
        !!API_KEY
    });
  }
);

/*
=========================================================
CONFIG
=========================================================
*/

app.get(
  "/api/config",
  function (req, res) {
    res.json({
      ok: true,
      model: MODEL,
      fallbackModel:
        FALLBACK_MODEL,
      visionModel:
        VISION_MODEL,
      hasKey:
        !!API_KEY,
      webSearch:
        WEB_SEARCH_ENABLED,
      temperature: 0.7
    });
  }
);

/*
=========================================================
CHAT
=========================================================
*/

async function handleChat(req, res) {
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
        ? body.attachments.slice(
            0,
            5
          )
        : [];

    const model =
      body.model ||
      body.mode;

    const temperature =
      Number.isFinite(
        Number(
          body.temperature
        )
      )
        ? Number(
            body.temperature
          )
        : 0.7;

    const systemPrompt =
      safeText(
        body.systemPrompt ||
        ""
      );

    const history =
      messages.slice(-40);

    const userText =
      message ||
      [
        ...history
      ]
        .reverse()
        .find(function (m) {
          return (
            m &&
            m.role === "user"
          );
        })
        ?.content ||
      "";

    /*
    -------------------------------------------------------
    WEATHER
    -------------------------------------------------------
    */

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
            detectCity(userText)
          );

        webContext +=
          "\nАКТУАЛЬНЫЕ ДАННЫЕ О ПОГОДЕ:\n" +
          "Город: " +
          weather.city +
          "\n" +
          "Температура: " +
          weather.temperature +
          "°C\n" +
          "Ощущается как: " +
          weather.feelsLike +
          "°C\n" +
          "Влажность: " +
          weather.humidity +
          "%\n" +
          "Ветер: " +
          weather.wind +
          " км/ч\n" +
          "Давление: " +
          weather.pressure +
          " hPa\n" +
          "Описание: " +
          weather.description +
          "\n";
      } catch (err) {
        console.error(
          "Weather error:",
          err.message
        );
      }
    }

    /*
    -------------------------------------------------------
    WEB SEARCH
    -------------------------------------------------------
    */

    if (
      WEB_SEARCH_ENABLED &&
      needsWebSearch(userText) &&
      !/погод|температур|weather/i.test(
        userText
      )
    ) {
      try {
        const results =
          await searchWeb(
            userText
          );

        if (results.length) {
          webContext +=
            "\nАКТУАЛЬНЫЕ РЕЗУЛЬТАТЫ ВЕБ-ПОИСКА:\n\n";

          webContext +=
            results
              .map(function (r, i) {
                return (
                  "\n" +
                  (i + 1) +
                  ". " +
                  r.title +
                  "\nURL: " +
                  r.url +
                  "\n" +
                  (
                    r.date
                      ? "Дата: " +
                        r.date +
                        "\n"
                      : ""
                  )
                );
              })
              .join("");
        } else {
          webContext +=
            "\nВеб-поиск не вернул результатов.\n" +
            "Не выдумывай новости.\n";
        }
      } catch (err) {
        console.error(
          "Web search error:",
          err.message
        );
      }
    }

    /*
    -------------------------------------------------------
    FILE CONTEXT
    -------------------------------------------------------
    */

    const fileContext =
      attachments
        .filter(function (a) {
          return (
            a.type !== "image" &&
            a.text
          );
        })
        .map(function (a) {
          return (
            "\nФАЙЛ: " +
            a.name +
            "\n" +
            String(a.text).slice(
              0,
              60000
            )
          );
        })
        .join("\n");

    const system =
      [
        CORE_SYSTEM_PROMPT,

        systemPrompt
          ? "\nПользовательские настройки:\n" +
            systemPrompt
          : "",

        webContext,

        fileContext
          ? "\nДАННЫЕ ИЗ ПРИКРЕПЛЁННЫХ ФАЙЛОВ:\n" +
            fileContext
          : ""
      ]
        .filter(Boolean)
        .join("\n");

    /*
    -------------------------------------------------------
    IMAGES
    -------------------------------------------------------
    */

    const imageAttachments =
      attachments.filter(function (a) {
        return (
          a.type === "image" &&
          a.dataUrl
        );
      });

    const hasImages =
      imageAttachments.length > 0;

    let content =
      userText ||
      (
        hasImages
          ? "Проанализируй прикреплённое изображение."
          : "Посмотри прикреплённые файлы."
      );

    if (hasImages) {
      content = [
        {
          type: "text",
          text:
            content ||
            "Что изображено на этом фото?"
        }
      ];

      for (
        const attachment of imageAttachments
      ) {
        content.push({
          type: "image_url",

          image_url: {
            url:
              attachment.dataUrl
          }
        });
      }
    }

    /*
    -------------------------------------------------------
    HISTORY
    -------------------------------------------------------
    */

    const finalMessages = [
      {
        role: "system",
        content: system
      }
    ];

    for (
      const historyMessage of history.slice(-40)
    ) {
      finalMessages.push(
        historyMessage
      );
    }

    if (
      userText ||
      hasImages ||
      attachments.length
    ) {
      finalMessages.push({
        role: "user",
        content: content
      });
    }

    /*
    -------------------------------------------------------
    MODEL SELECTION
    -------------------------------------------------------
    */

    let selectedModel;

    if (hasImages) {
      selectedModel =
        VISION_MODEL;
    } else {
      selectedModel =
        chooseModel(model);
    }

    let answer;

    try {
      answer =
        await callOpenRouter({
          messages:
            finalMessages,

          model:
            selectedModel,

          temperature:
            temperature
        });
    } catch (primaryError) {
      console.error(
        "Primary model error:",
        primaryError.message
      );

      if (
        hasImages &&
        selectedModel !==
          FALLBACK_MODEL
      ) {
        try {
          answer =
            await callOpenRouter({
              messages:
                finalMessages,

              model:
                FALLBACK_MODEL,

              temperature:
                temperature
            });

          selectedModel =
            FALLBACK_MODEL;
        } catch (
          visionFallbackError
        ) {
          console.error(
            "Vision fallback error:",
            visionFallbackError.message
          );

          throw visionFallbackError;
        }
      } else if (
        !hasImages &&
        selectedModel !==
          FALLBACK_MODEL
      ) {
        answer =
          await callOpenRouter({
            messages:
              finalMessages,

            model:
              FALLBACK_MODEL,

            temperature:
              temperature
          });

        selectedModel =
          FALLBACK_MODEL;
      } else {
        throw primaryError;
      }
    }

    /*
    -------------------------------------------------------
    CLEAN ANSWER
    -------------------------------------------------------
    */

    answer =
      cleanModelText(answer);

    /*
    -------------------------------------------------------
    GENERATED FILES
    -------------------------------------------------------
    */

    const processed =
      await processGeneratedFiles(
        answer
      );

    const files =
      processed.files.map(
        function (file) {
          return {
            ...file,

            url:
              "/api/files/" +
              file.storedName +
              "?name=" +
              encodeURIComponent(
                file.name
              )
          };
        }
      );

    let reply =
      processed.text;

    if (files.length) {
      reply +=
        "\n\n" +
        files
          .map(function (f) {
            return (
              "📎 [Скачать " +
              f.name +
              "](" +
              f.url +
              ")"
            );
          })
          .join("\n");
    }

    /*
    -------------------------------------------------------
    RESPONSE
    -------------------------------------------------------
    */

    res.json({
      ok: true,

      reply: reply,

      text: reply,

      answer: reply,

      files: files,

      model:
        selectedModel,

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

    res.status(500).json({
      ok: false,

      error:
        err &&
        err.message
          ? err.message
          : "Ошибка Aiva"
    });
  }
}

app.post(
  "/api/chat",
  handleChat
);

/*
=========================================================
REGENERATE
=========================================================
*/

app.post(
  "/api/regenerate",
  async function (req, res) {
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
        [
          ...messages
        ]
          .map(function (m, i) {
            return {
              ...m,
              index: i
            };
          })
          .reverse()
          .find(function (m) {
            return (
              m.role ===
              "assistant"
            );
          });

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
      console.error(err);

      res.status(500).json({
        ok: false,

        error:
          err.message
      });
    }
  }
);

/*
=========================================================
MODEL
=========================================================
*/

app.post(
  "/api/model",
  function (req, res) {
    try {
      const requested =
        safeText(
          req.body &&
          req.body.model
        );

      if (requested) {
        MODEL =
          requested;
      }

      res.json({
        ok: true,

        model:
          MODEL
      });
    } catch (err) {
      res.status(500).json({
        ok: false,

        error:
          err.message
      });
    }
  }
);

/*
=========================================================
PROMPT
=========================================================
*/

let CUSTOM_PROMPT = "";

app.post(
  "/api/prompt",
  function (req, res) {
    CUSTOM_PROMPT =
      safeText(
        req.body &&
        req.body.prompt
      );

    res.json({
      ok: true,

      prompt:
        CUSTOM_PROMPT
    });
  }
);

/*
=========================================================
CLEAR
=========================================================
*/

app.post(
  "/api/clear",
  function (req, res) {
    res.json({
      ok: true
    });
  }
);

/*
=========================================================
FALLBACK ROUTE
=========================================================
*/

/*
Не используем app.get("*"),
потому что в новых версиях Express
такой wildcard может вызвать ошибку.
*/

app.use(
  function (req, res) {
    if (
      req.path &&
      req.path.startsWith("/api/")
    ) {
      return res
        .status(404)
        .json({
          ok: false,

          error:
            "API endpoint not found"
        });
    }

    const indexPath =
      path.join(
        __dirname,
        "public",
        "index.html"
      );

    if (
      fs.existsSync(indexPath)
    ) {
      return res.sendFile(
        indexPath
      );
    }

    return res
      .status(404)
      .send(
        "Aiva frontend not found"
      );
  }
);

/*
=========================================================
START
=========================================================
*/

app.listen(
  PORT,
  function () {
    console.log(
      "Aiva 5.1.1 running on port " +
      PORT
    );

    console.log(
      "Model: " +
      MODEL
    );

    console.log(
      "Vision model: " +
      VISION_MODEL
    );

    console.log(
      "Web search: " +
      WEB_SEARCH_ENABLED
    );
  }
);
