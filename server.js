const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

const PORT = process.env.PORT || 4000;

const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY;

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

const MAX_FILE_SIZE =
  20 * 1024 * 1024;

const MAX_FILES = 5;
const MAX_FILE_TEXT = 40000;

/* =========================================================
   MIDDLEWARE
========================================================= */

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

/* =========================================================
   UPLOAD
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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

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
  return (
    `data:${file.mimetype};base64,` +
    file.buffer.toString("base64")
  );
}

function cleanText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

/* =========================================================
   VISION PROMPT
========================================================= */

function visionPrompt(userText) {
  const question =
    cleanText(userText);

  return `
Ты — система компьютерного зрения Aiva.

Тебе передано реальное изображение пользователя.

КРИТИЧЕСКОЕ ПРАВИЛО:

НИКОГДА НЕ ВЫДУМЫВАЙ ТО,
ЧЕГО НЕТ НА ИЗОБРАЖЕНИИ.

Если ты не уверен в объекте,
слове, цифре или символе —
скажи, что не уверен.

НЕ УГАДЫВАЙ.

========================================
ЕСЛИ НА ФОТО ЕСТЬ ТЕКСТ
========================================

Работай в режиме точной расшифровки.

1. Сначала внимательно изучи всё изображение.

2. Определи ориентацию текста.

3. Если текст находится боком,
мысленно поверни изображение
и прочитай его.

4. Сохраняй порядок строк.

5. Сохраняй видимые слова
максимально близко к оригиналу.

6. НЕ исправляй ошибки автора.

7. НЕ исправляй почерк.

8. НЕ заменяй непонятные слова
похожими словами.

9. НЕ додумывай отсутствующие буквы.

10. НЕ додумывай цифры.

11. НЕ создавай таблицу,
если настоящей таблицы
на изображении не видно.

12. НЕ придумывай заголовки.

13. НЕ добавляй строки,
которых нет.

14. НЕ восстанавливай текст
по смыслу.

15. Если слово невозможно
уверенно прочитать:

[неразборчиво]

16. Если цифра неразборчива:

[неразборчиво]

17. Если часть строки не читается:

[неразборчиво]

18. Если изображение слишком
маленькое или размытое —
честно сообщи об этом.

========================================
ВАЖНО
========================================

Не превращай похожий текст
в знакомое тебе слово.

Например:

если ты видишь:

МТЗ-8?

и не уверен в последней цифре,

НЕ ПИШИ:

МТЗ-82

Напиши:

МТЗ-8[неразборчиво]

Не угадывай смысл документа.

Не придумывай названия организаций.

Не придумывай фамилии.

Не придумывай номера.

Не придумывай даты.

Не придумывай технические характеристики.

========================================
ЕСЛИ ПОЛЬЗОВАТЕЛЬ СПРАШИВАЕТ
"ЧТО НА ФОТО?"
========================================

Сначала коротко опиши
реально видимые объекты.

Затем, если присутствует текст:

Текст на изображении:

и ниже максимально точная
расшифровка.

Если текста нет,
скажи:

"Видимого текста на изображении нет."

========================================
ВОПРОС ПОЛЬЗОВАТЕЛЯ
========================================

${question || "Что на фото?"}
`;
}

/* =========================================================
   OPENROUTER
========================================================= */

async function callOpenRouter({
  model,
  messages,
  temperature
}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY не настроен."
    );
  }

  const response =
    await fetch(
      OPENROUTER_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${OPENROUTER_API_KEY}`,

          "HTTP-Referer":
            process.env.PUBLIC_APP_URL ||
            "https://my-aii.onrender.com",

          "X-Title":
            "Aiva AI Assistant"
        },

        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: 4000
        })
      }
    );

  const raw =
    await response.text();

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
    throw new Error(
      data?.error?.message ||
        data?.error ||
        `HTTP ${response.status}`
    );
  }

  const answer =
    data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error(
      "Модель не вернула ответ."
    );
  }

  return answer;
}

/* =========================================================
   FILE TEXT
========================================================= */

async function extractFileText(file) {
  if (!file) {
    return "";
  }

  const mime =
    file.mimetype || "";

  if (
    mime.startsWith("text/") ||
    mime ===
      "application/json" ||
    mime ===
      "application/javascript"
  ) {
    return file.buffer
      .toString("utf8")
      .slice(
        0,
        MAX_FILE_TEXT
      );
  }

  if (
    mime ===
    "application/pdf"
  ) {
    try {
      const pdfParse =
        require("pdf-parse");

      const result =
        await pdfParse(
          file.buffer
        );

      return String(
        result.text || ""
      ).slice(
        0,
        MAX_FILE_TEXT
      );
    } catch (error) {
      return `[Не удалось прочитать PDF: ${error.message}]`;
    }
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime ===
      "application/msword"
  ) {
    try {
      const mammoth =
        require("mammoth");

      const result =
        await mammoth.extractRawText(
          {
            buffer:
              file.buffer
          }
        );

      return String(
        result.value || ""
      ).slice(
        0,
        MAX_FILE_TEXT
      );
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
  upload.array(
    "files",
    MAX_FILES
  ),
  async (req, res) => {
    try {
      const files =
        req.files || [];

      const result = [];

      for (const file of files) {
        const item = {
          name:
            file.originalname,

          type:
            file.mimetype,

          size:
            file.size
        };

        if (
          isImage(file)
        ) {
          item.isImage = true;

          item.dataUrl =
            imageToDataUrl(
              file
            );
        } else {
          item.isImage = false;

          item.text =
            await extractFileText(
              file
            );
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
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   CHAT
========================================================= */

app.post(
  "/api/chat",
  upload.array(
    "files",
    MAX_FILES
  ),
  async (req, res) => {
    try {
      const userText =
        cleanText(
          req.body.message ||
          req.body.prompt ||
          req.body.text
        );

      let history = [];

      if (
        req.body.history
      ) {
        try {
          history =
            JSON.parse(
              req.body.history
            );

          if (
            !Array.isArray(
              history
            )
          ) {
            history = [];
          }
        } catch {
          history = [];
        }
      }

      const files =
        req.files || [];

      const imageFiles =
        files.filter(
          isImage
        );

      const documentFiles =
        files.filter(
          file =>
            !isImage(file)
        );

      const hasImages =
        imageFiles.length > 0;

      /* SYSTEM */

      const systemPrompt =
        hasImages
          ? visionPrompt(
              userText
            )
          : `
Ты — Aiva, современный AI-ассистент.

Отвечай понятно,
естественно и по делу.

Не выдумывай факты.

Если чего-то не знаешь —
скажи об этом.

Используй содержимое
прикреплённых документов.

Пользовательский запрос:

${userText}
`;

      const messages = [
        {
          role: "system",
          content:
            systemPrompt
        }
      ];

      /* HISTORY */

      if (
        Array.isArray(
          history
        )
      ) {
        for (
          const message of
            history.slice(-30)
        ) {
          if (
            !message ||
            !message.role
          ) {
            continue;
          }

          if (
            message.role !==
              "user" &&
            message.role !==
              "assistant"
          ) {
            continue;
          }

          if (
            typeof message.content ===
            "string"
          ) {
            messages.push({
              role:
                message.role,

              content:
                message.content.slice(
                  0,
                  20000
                )
            });
          }
        }
      }

      /* USER CONTENT */

      let content;

      if (
        hasImages
      ) {
        content = [
          {
            type: "text",

            text:
              userText ||
              "Что на фото? Внимательно изучи изображение. Опиши только то, что реально видно. Если есть текст — прочитай его максимально точно. Ничего не угадывай."
          }
        ];

        for (
          const imageFile of
            imageFiles
        ) {
          content.push({
            type:
              "image_url",

            image_url: {
              url:
                imageToDataUrl(
                  imageFile
                )
            }
          });
        }

        for (
          const file of
            documentFiles
        ) {
          const extracted =
            await extractFileText(
              file
            );

          if (
            extracted
          ) {
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
          const file of
            documentFiles
        ) {
          const extracted =
            await extractFileText(
              file
            );

          if (
            extracted
          ) {
            fullText +=
              `\n\n--- ${file.originalname} ---\n${extracted}`;
          }
        }

        content =
          fullText;
      }

      messages.push({
        role: "user",
        content
      });

      /* MODEL */

      const selectedModel =
        hasImages
          ? VISION_MODEL
          : MODEL;

      const temperature =
        hasImages
          ? 0.1
          : 0.7;

      console.log(
        `REQUEST → ${selectedModel}`
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
      } catch (
        firstError
      ) {
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
          `FALLBACK → ${FALLBACK_MODEL}`
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

      /* RESPONSE */

      res.json({
        ok: true,

        answer,

        model:
          selectedModel,

        vision:
          hasImages,

        attachments:
          files.map(
            file => ({
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
    } catch (
      error
    ) {
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
        "5.3.1",

      model:
        MODEL,

      fallbackModel:
        FALLBACK_MODEL,

      visionModel:
        VISION_MODEL,

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
   404
========================================================= */

app.use(
  (req, res) => {
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

    res
      .status(404)
      .send(
        "Aiva frontend not found"
      );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "SERVER ERROR:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

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
      `Aiva 5.3.1 running on port ${PORT}`
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
