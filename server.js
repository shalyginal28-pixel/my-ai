const express = require("express");
const multer = require("multer");
const cors = require("cors");
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

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* =========================================================
   FILE UPLOAD
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

/* =========================================================
   PUBLIC
========================================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   HELPERS
========================================================= */

function isImage(file) {
  return (
    file &&
    typeof file.mimetype === "string" &&
    file.mimetype.startsWith("image/")
  );
}

function imageToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString(
    "base64"
  )}`;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function visionPrompt(userText) {
  const question = cleanText(userText);

  return `
Ты — система компьютерного зрения Aiva.

Тебе передано реальное изображение пользователя.

Главное правило:
НИКОГДА НЕ ВЫДУМЫВАЙ то, чего нет на изображении.

Если пользователь спрашивает, что на фото:
- описывай только реально видимые объекты;
- не додумывай назначение предметов;
- не придумывай бренды, надписи, модели и числа.

ЕСЛИ НА ИЗОБРАЖЕНИИ ЕСТЬ ТЕКСТ:

Работай в режиме ТОЧНОЙ РАСШИФРОВКИ.

1. Сначала внимательно посмотри на изображение целиком.
2. Определи фактическую ориентацию изображения.
3. Если текст расположен боком или вверх ногами, мысленно поверни изображение для чтения.
4. Переписывай текст в том порядке, в котором он визуально расположен.
5. НЕ исправляй орфографию.
6. НЕ исправляй почерк.
7. НЕ заменяй непонятное слово похожим настоящим словом.
8. НЕ составляй таблицу из текста, если на фотографии фактически не видно таблицы.
9. НЕ придумывай заголовки таблиц.
10. НЕ добавляй отсутствующие строки.
11. НЕ додумывай цифры.
12. НЕ превращай неразборчивые символы в реальные слова.
13. Если слово невозможно уверенно прочитать, напиши:
[неразборчиво]
14. Если видна только часть слова:
[неразборчиво]
15. Если цифра сомнительная:
[неразборчиво]
16. Если целая строка не читается:
[неразборчиво]
17. Если текст очень плохого качества, прямо скажи, что изображение недостаточно чёткое.

Очень важно:
НЕ ПЫТАЙСЯ УГАДАТЬ СМЫСЛ ТЕКСТА.

Например, если на фотографии написано что-то похожее на:
"МТЗ-8?"
но последняя цифра плохо видна,
нельзя самостоятельно превращать это в "МТЗ-82".

Нужно написать:
"МТЗ-8[неразборчиво]"

Если пользователь просит "что на фото", сначала коротко опиши изображение.
Если на нём есть текст, отдельно покажи блок:

Текст на изображении:
...

Если текста нет — так и скажи.

Вопрос пользователя:
${question || "Что на фото?"}
`;
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
    throw new Error(
      "OPENROUTER_API_KEY не настроен на сервере."
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,

      "HTTP-Referer":
        process.env.PUBLIC_APP_URL ||
        "https://my-aii.onrender.com",

      "X-Title": "Aiva AI Assistant"
    },

    body: JSON.stringify({
      model,
      messages,

      temperature,

      max_tokens: 4000
    })
  });

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `OpenRouter вернул неправильный ответ: ${raw.slice(
        0,
        1000
      )}`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      `HTTP ${response.status}`;

    throw new Error(message);
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "Модель не вернула текстовый ответ."
    );
  }

  return answer;
}

/* =========================================================
   EXTRACT TEXT
========================================================= */

async function extractFileText(file) {
  if (!file) {
    return "";
  }

  const mime = file.mimetype || "";

  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript"
  ) {
    return file.buffer
      .toString("utf8")
      .slice(0, MAX_FILE_TEXT);
  }

  if (
    mime ===
    "application/pdf"
  ) {
    try {
      const pdfParse =
        require("pdf-parse");

      const result =
        await pdfParse(file.buffer);

      return String(
        result.text || ""
      ).slice(0, MAX_FILE_TEXT);
    } catch (error) {
      return `[Не удалось прочитать PDF: ${error.message}]`;
    }
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword"
  ) {
    try {
      const mammoth =
        require("mammoth");

      const result =
        await mammoth.extractRawText({
          buffer: file.buffer
        });

      return String(
        result.value || ""
      ).slice(0, MAX_FILE_TEXT);
    } catch (error) {
      return `[Не удалось прочитать DOCX: ${error.message}]`;
    }
  }

  return "";
}

/* =========================================================
   UPLOAD API
========================================================= */

app.post(
  "/api/upload",
  upload.array("files", MAX_FILES),
  async (req, res) => {
    try {
      const files = req.files || [];

      const result = [];

      for (const file of files) {
        const item = {
          name: file.originalname,
          type: file.mimetype,
          size: file.size
        };

        if (isImage(file)) {
          item.isImage = true;
          item.dataUrl = imageToDataUrl(file);
        } else {
          item.isImage = false;

          const text =
            await extractFileText(file);

          item.text = text;
        }

        result.push(item);
      }

      res.json({
        ok: true,
        files: result
      });
    } catch (error) {
      console.error(
        "UPLOAD ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
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
  async (req, res) => {
    try {
      const userText =
        cleanText(
          req.body.message ||
          req.body.prompt ||
          req.body.text
        );

      let history = [];

      if (req.body.history) {
        try {
          history =
            JSON.parse(req.body.history);

          if (!Array.isArray(history)) {
            history = [];
          }
        } catch {
          history = [];
        }
      }

      const files =
        req.files || [];

      const imageFiles =
        files.filter(isImage);

      const documentFiles =
        files.filter(
          (file) => !isImage(file)
        );

      const hasImages =
        imageFiles.length > 0;

      /* -----------------------------------------
         BASE SYSTEM PROMPT
      ----------------------------------------- */

      const systemPrompt = hasImages
        ? visionPrompt(userText)
        : `
Ты — Aiva, современный AI-ассистент.

Отвечай понятно, естественно и по делу.

Не выдумывай факты.
Если чего-то не знаешь — скажи об этом.

Если пользователь прикрепил документы,
используй их содержимое.

Пользовательский запрос:
${userText}
`;

      /* -----------------------------------------
         HISTORY
      ----------------------------------------- */

      const messages = [
        {
          role: "system",
          content: systemPrompt
        }
      ];

      if (Array.isArray(history)) {
        for (
          const message of history.slice(-30)
        ) {
          if (
            !message ||
            !message.role
          ) {
            continue;
          }

          if (
            message.role !== "user" &&
            message.role !== "assistant"
          ) {
            continue;
          }

          if (
            typeof message.content ===
            "string"
          ) {
            messages.push({
              role: message.role,
              content:
                message.content.slice(
                  0,
                  20000
                )
            });
          }
        }
      }

      /* -----------------------------------------
         USER CONTENT
      ----------------------------------------- */

      let content;

      if (hasImages) {
        content = [
          {
            type: "text",
            text:
              userText ||
              "Что на фото? Очень внимательно опиши изображение и максимально точно прочитай видимый текст."
          }
        ];

        for (
          const imageFile of imageFiles
        ) {
          content.push({
            type: "image_url",

            image_url: {
              url:
                imageToDataUrl(
                  imageFile
                )
            }
          });
        }

        /*
         Добавляем документы после изображения.
        */

        for (
          const file of documentFiles
        ) {
          const extracted =
            await extractFileText(
              file
            );

          if (extracted) {
            content.push({
              type: "text",

              text:
                `\n\nФайл "${file.originalname}":\n${extracted}`
            });
          }
        }
      } else {
        let fullText =
          userText;

        for (
          const file of documentFiles
        ) {
          const extracted =
            await extractFileText(
              file
            );

          if (extracted) {
            fullText +=
              `\n\n--- ${file.originalname} ---\n${extracted}`;
          }
        }

        content = fullText;
      }

      messages.push({
        role: "user",
        content
      });

      /* -----------------------------------------
         MODEL
      ----------------------------------------- */

      const selectedModel =
        hasImages
          ? VISION_MODEL
          : MODEL;

      const temperature =
        hasImages
          ? 0.1
          : 0.7;

      console.log(
        hasImages
          ? `VISION REQUEST → ${selectedModel}`
          : `CHAT REQUEST → ${selectedModel}`
      );

      let answer;

      try {
        answer =
          await callOpenRouter({
            model:
              selectedModel,

            messages,

            temperature
          });
      } catch (firstError) {
        console.error(
          "PRIMARY MODEL ERROR:",
          firstError.message
        );

        if (
          selectedModel ===
          FALLBACK_MODEL
        ) {
          throw firstError;
        }

        console.log(
          `Trying fallback → ${FALLBACK_MODEL}`
        );

        answer =
          await callOpenRouter({
            model:
              FALLBACK_MODEL,

            messages,

            temperature:
              hasImages
                ? 0.1
                : 0.7
          });
      }

      res.json({
        ok: true,
        answer,

        model:
          selectedModel,

        vision:
          hasImages,

        attachments:
          files.map(
            (file) => ({
              name:
                file.originalname,

              type:
                file.mimetype,

              size:
                file.size,

              isImage:
                isImage(file)
            })
          )
      });
    } catch (error) {
      console.error(
        "CHAT ERROR:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message ||
          "Ошибка Aiva"
      });
    }
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,

      version:
        "5.3.0",

      model:
        MODEL,

      fallbackModel:
        FALLBACK_MODEL,

      visionModel:
        VISION_MODEL,

      webSearch:
        true,

      apiKey:
        !!OPENROUTER_API_KEY
    });
  }
);

/* =========================================================
   CONFIG
========================================================= */

app.get(
  "/api/config",
  (req, res) => {
    res.json({
      ok: true,

      model:
        MODEL,

      visionModel:
        VISION_MODEL
    });
  }
);

/* =========================================================
   ROOT FALLBACK
========================================================= */

app.get(
  "*",
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
      res.sendFile(index);
    } else {
      res.status(404).send(
        "Aiva frontend not found"
      );
    }
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

    res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Internal server error"
    });
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Aiva 5.3.0 running on port ${PORT}`
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
      `API key: ${
        OPENROUTER_API_KEY
          ? "YES"
          : "NO"
      }`
    );
  }
);
