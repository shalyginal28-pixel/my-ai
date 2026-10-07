const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 4000;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const MODEL =
  process.env.AI_MODEL ||
  "nvidia/nemotron-3-ultra-550b-a55b:free";

const FALLBACK_MODEL =
  process.env.AIVA_FALLBACK_MODEL ||
  "openrouter/free";

const VISION_MODEL =
  process.env.AIVA_VISION_MODEL ||
  "google/gemma-4-31b-it:free";

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_FILE_TEXT = 40000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "50mb"
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

app.use(express.static(path.join(__dirname, "public")));


/* =========================================================
   HELPERS
========================================================= */

function isImage(file) {
  if (!file) return false;

  return (
    typeof file.mimetype === "string" &&
    file.mimetype.startsWith("image/")
  );
}


function imageToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}


function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}


function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}


function visionPrompt(userText) {
  const text = cleanText(userText);

  return text || `
Внимательно изучи изображение.

Опиши ТОЛЬКО то, что действительно видно на фотографии.

Если на изображении есть текст:
- перепиши его максимально точно;
- сохраняй порядок строк;
- не придумывай отсутствующие символы;
- если слово невозможно разобрать, напиши [неразборчиво].

Если есть таблица:
- не придумывай строки или столбцы;
- передавай только реально видимые данные.

Если фотография повернута:
- мысленно поверни её и прочитай текст.

Если часть изображения размыта или закрыта:
- прямо укажи это.

Не угадывай.
Не додумывай.
Не исправляй текст по своему предположению.
  `.trim();
}


/* =========================================================
   OPENROUTER
========================================================= */

async function callOpenRouter({
  model,
  messages,
  temperature = 0.7
}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY не настроен на Render");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",

    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://my-aii.onrender.com",
      "X-Title": "Aiva"
    },

    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter вернул неправильный ответ: ${raw.slice(0, 1000)}`
    );
  }

  if (!response.ok) {
    const errorText =
      data?.error?.message ||
      data?.message ||
      `OpenRouter HTTP ${response.status}`;

    throw new Error(errorText);
  }

  const answer =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    "";

  if (Array.isArray(answer)) {
    return answer
      .map(part => {
        if (typeof part === "string") return part;
        return part?.text || "";
      })
      .join("");
  }

  return String(answer || "");
}


/* =========================================================
   FILE TEXT EXTRACTION
========================================================= */

async function extractFileText(file) {
  if (!file || isImage(file)) {
    return "";
  }

  const name = (file.originalname || "").toLowerCase();
  const mime = file.mimetype || "";

  try {

    /*
      TXT / CSV / JSON / MD / HTML
    */

    if (
      mime.startsWith("text/") ||
      /\.(txt|csv|json|md|html|htm|xml)$/i.test(name)
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
        const mammoth = require("mammoth");

        const result = await mammoth.extractRawText({
          buffer: file.buffer
        });

        return String(result.value || "")
          .slice(0, MAX_FILE_TEXT);

      } catch {
        return `[Файл DOCX: ${file.originalname}. Не удалось извлечь текст автоматически.]`;
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
        let pdfParse;

        try {
          pdfParse = require("pdf-parse");
        } catch {
          try {
            pdfParse = require("pdf-parse/lib/pdf-parse");
          } catch {
            pdfParse = null;
          }
        }

        if (pdfParse) {
          const result = await pdfParse(file.buffer);

          return String(result.text || "")
            .slice(0, MAX_FILE_TEXT);
        }

      } catch {}

      return `[PDF-файл: ${file.originalname}. Текст PDF не удалось извлечь автоматически.]`;
    }


    /*
      Остальные файлы
    */

    return `[Прикреплён файл: ${file.originalname}]`;

  } catch (error) {
    return `[Не удалось прочитать файл: ${file.originalname}]`;
  }
}


/* =========================================================
   HISTORY
========================================================= */

function parseHistory(body) {
  let history =
    body?.history ??
    body?.messages ??
    [];

  history = safeJsonParse(history, history);

  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(item => item && typeof item === "object")
    .map(item => ({
      role:
        item.role === "assistant"
          ? "assistant"
          : item.role === "system"
          ? "system"
          : "user",

      content:
        typeof item.content === "string"
          ? item.content
          : Array.isArray(item.content)
          ? item.content
          : String(item.content || "")
    }))
    .slice(-40);
}


/* =========================================================
   MAIN CHAT HANDLER
========================================================= */

async function handleChat(req, res) {
  try {
    const body = req.body || {};

    let userText =
      cleanText(body.message) ||
      cleanText(body.prompt) ||
      cleanText(body.text) ||
      cleanText(body.content);

    const files = Array.isArray(req.files)
      ? req.files
      : [];

    const imageFiles = files.filter(isImage);
    const otherFiles = files.filter(file => !isImage(file));

    /*
      Если текста нет, но есть фотография
    */

    if (!userText && imageFiles.length) {
      userText = "Что на фото?";
    }

    if (!userText && !files.length) {
      return res.status(400).json({
        ok: false,
        error: "Пустое сообщение"
      });
    }


    /*
      История
    */

    const history = parseHistory(body);


    /*
      Текст прикреплённых документов
    */

    const fileTexts = [];

    for (const file of otherFiles) {
      const extracted = await extractFileText(file);

      if (extracted) {
        fileTexts.push(
          `\n\n--- ФАЙЛ: ${file.originalname} ---\n${extracted}`
        );
      }
    }


    /*
      Если есть обычные файлы,
      добавляем их содержимое в сообщение
    */

    if (fileTexts.length) {
      userText += fileTexts.join("\n");
    }


    /*
      Создаём сообщения
    */

    const messages = [];


    /*
      Передаём историю
    */

    for (const item of history) {
      /*
        Не передаём текущий пользовательский запрос второй раз,
        если frontend уже положил его в history.
      */

      messages.push({
        role: item.role,
        content: item.content
      });
    }


    /*
      Сообщение пользователя
    */

    if (imageFiles.length) {

      const content = [];

      content.push({
        type: "text",
        text: visionPrompt(userText)
      });


      /*
        Поддержка нескольких фотографий
      */

      for (const imageFile of imageFiles) {
        content.push({
          type: "image_url",
          image_url: {
            url: imageToDataUrl(imageFile)
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
        content: userText
      });

    }


    /*
      Выбираем модель
    */

    const hasImages = imageFiles.length > 0;

    const selectedModel = hasImages
      ? VISION_MODEL
      : MODEL;

    const temperature = hasImages
      ? 0.1
      : 0.7;


    /*
      Первый запрос
    */

    let answer = "";
    let usedModel = selectedModel;

    try {

      answer = await callOpenRouter({
        model: selectedModel,
        messages,
        temperature
      });

    } catch (firstError) {

      console.error(
        "Primary model error:",
        firstError.message
      );


      /*
        Если основная модель не ответила,
        пробуем fallback.
      */

      if (FALLBACK_MODEL && FALLBACK_MODEL !== selectedModel) {

        try {

          usedModel = FALLBACK_MODEL;

          answer = await callOpenRouter({
            model: FALLBACK_MODEL,
            messages,
            temperature
          });

        } catch (fallbackError) {

          console.error(
            "Fallback model error:",
            fallbackError.message
          );

          return res.status(502).json({
            ok: false,
            error:
              fallbackError.message ||
              firstError.message ||
              "Ошибка AI"
          });
        }

      } else {

        return res.status(502).json({
          ok: false,
          error:
            firstError.message ||
            "Ошибка AI"
        });
      }
    }


    /*
      Нормализуем ответ
    */

    answer = cleanText(answer);

    if (!answer) {
      answer = "Модель не вернула текстовый ответ.";
    }


    /*
      Ответ frontend
    */

    return res.json({
      ok: true,

      answer,

      text: answer,

      content: answer,

      model: usedModel,

      vision: hasImages,

      files: files.map(file => ({
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        isImage: isImage(file)
      }))
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
        "Внутренняя ошибка сервера"
    });
  }
}


/* =========================================================
   UPLOAD
========================================================= */

app.post(
  "/api/upload",
  upload.array("files", MAX_FILES),
  async (req, res) => {

    try {

      const files = Array.isArray(req.files)
        ? req.files
        : [];

      const result = [];

      for (const file of files) {

        const item = {
          name: file.originalname,
          filename: file.originalname,
          type: file.mimetype,
          mimetype: file.mimetype,
          size: file.size,
          isImage: isImage(file)
        };


        /*
          Для документов возвращаем текст
        */

        if (!isImage(file)) {
          item.text = await extractFileText(file);
        }


        /*
          Для изображений можно вернуть preview
        */

        if (isImage(file)) {
          item.dataUrl = imageToDataUrl(file);
        }

        result.push(item);
      }

      return res.json({
        ok: true,
        files: result,
        attachments: result
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
   CHAT
========================================================= */

app.post(
  "/api/chat",
  upload.array("files", MAX_FILES),
  handleChat
);


/* =========================================================
   REGENERATE
   ВАЖНО: ЭТОГО ENDPOINT НЕ ХВАТАЛО
========================================================= */

app.post(
  "/api/regenerate",
  upload.array("files", MAX_FILES),
  handleChat
);


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    service: "Aiva",
    version: "5.3.2",
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
    visionModel: VISION_MODEL,
    apiKey: Boolean(OPENROUTER_API_KEY)
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

    visionModel: VISION_MODEL,

    maxFiles: MAX_FILES,

    maxFileSize: MAX_FILE_SIZE,

    vision: true,

    features: {
      chat: true,
      regenerate: true,
      upload: true,
      images: true,
      vision: true
    }
  });

});


/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {

  const index = path.join(
    __dirname,
    "public",
    "index.html"
  );

  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }

  res.status(404).send("Aiva frontend not found");
});


/* =========================================================
   API 404
========================================================= */

app.use((req, res, next) => {

  if (req.path.startsWith("/api/")) {

    return res.status(404).json({
      ok: false,
      error: "API endpoint not found",
      endpoint: req.path,
      method: req.method
    });
  }

  next();
});


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {

  console.error(
    "SERVER ERROR:",
    error
  );

  if (
    error instanceof multer.MulterError
  ) {

    return res.status(400).json({
      ok: false,
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Файл слишком большой. Максимум 20 MB."
          : error.message
    });
  }

  return res.status(500).json({
    ok: false,
    error:
      error?.message ||
      "Ошибка сервера"
  });
});


/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {

  console.log(
    `Aiva 5.3.2 running on port ${PORT}`
  );

  console.log(
    `Model: ${MODEL}`
  );

  console.log(
    `Fallback model: ${FALLBACK_MODEL}`
  );

  console.log(
    `Vision model: ${VISION_MODEL}`
  );

  console.log(
    `API key: ${OPENROUTER_API_KEY ? "YES" : "NO"}`
  );

});
