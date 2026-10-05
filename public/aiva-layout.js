(() => {
  "use strict";

  function initAivaLayout() {
    if (document.getElementById("aiva-left-sidebar")) {
      return;
    }

    const style = document.createElement("style");

    style.textContent = `
      body.aiva-layout-active {
        padding-left: 260px;
        padding-right: 300px;
      }

      body.aiva-layout-active > header {
        padding-left: 24px;
        padding-right: 24px;
      }

      #aiva-left-sidebar,
      #aiva-right-sidebar {
        position: fixed;
        top: 0;
        bottom: 0;
        z-index: 9000;
        background: rgba(15,16,21,.96);
        border-color: rgba(255,255,255,.08);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        color: #f5f5f7;
      }

      #aiva-left-sidebar {
        left: 0;
        width: 260px;
        border-right: 1px solid rgba(255,255,255,.08);
        padding: 14px;
        display: flex;
        flex-direction: column;
      }

      #aiva-right-sidebar {
        right: 0;
        width: 300px;
        border-left: 1px solid rgba(255,255,255,.08);
        padding: 18px;
        overflow-y: auto;
      }

      .aiva-side-logo {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 6px 18px;
        font-size: 19px;
        font-weight: 700;
      }

      .aiva-side-logo-mark {
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 11px;
        background: linear-gradient(135deg,#7668ff,#5c8cff);
        color: white;
        font-weight: 800;
      }

      .aiva-new-chat {
        width: 100%;
        height: 44px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.055);
        color: white;
        text-align: left;
        cursor: pointer;
        padding: 0 14px;
        font-size: 14px;
        margin-bottom: 18px;
        transition: .15s;
      }

      .aiva-new-chat:hover {
        background: rgba(118,104,255,.16);
        border-color: rgba(118,104,255,.3);
      }

      .aiva-section-title {
        padding: 0 6px 8px;
        color: #777b86;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .08em;
      }

      #aiva-history {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .aiva-history-item {
        width: 100%;
        padding: 10px 11px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #c9cbd1;
        text-align: left;
        cursor: pointer;
        font-size: 13px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .aiva-history-item:hover {
        background: rgba(255,255,255,.055);
        color: white;
      }

      .aiva-right-title {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 16px;
      }

      .aiva-card {
        padding: 13px;
        margin-bottom: 12px;
        border-radius: 14px;
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.07);
      }

      .aiva-card-title {
        color: #858995;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .07em;
        margin-bottom: 8px;
      }

      .aiva-card select {
        width: 100%;
        max-width: none !important;
        height: 42px;
      }

      #aiva-right-sidebar .ghost {
        width: 100%;
        margin-top: 7px;
        text-align: left;
      }

      #aiva-right-sidebar #model-select {
        display: block !important;
      }

      #aiva-right-sidebar #regen-btn,
      #aiva-right-sidebar #export-btn,
      #aiva-right-sidebar #prompt-btn,
      #aiva-right-sidebar #clear-btn {
        display: block !important;
      }

      /* Убираем старые кнопки из шапки,
         но сами элементы НЕ удаляем */
      header #model-select,
      header #regen-btn,
      header #export-btn,
      header #prompt-btn,
      header #clear-btn {
        display: none !important;
      }

      #aiva-left-sidebar::-webkit-scrollbar,
      #aiva-right-sidebar::-webkit-scrollbar,
      #aiva-history::-webkit-scrollbar {
        width: 6px;
      }

      #aiva-left-sidebar::-webkit-scrollbar-thumb,
      #aiva-right-sidebar::-webkit-scrollbar-thumb,
      #aiva-history::-webkit-scrollbar-thumb {
        background: #343640;
        border-radius: 10px;
      }

      @media (max-width: 1050px) {
        body.aiva-layout-active {
          padding-right: 0;
        }

        #aiva-right-sidebar {
          display: none;
        }

        header #prompt-btn {
          display: none !important;
        }
      }

      @media (max-width: 760px) {
        body.aiva-layout-active {
          padding-left: 0;
        }

        #aiva-left-sidebar {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);

    const left = document.createElement("aside");
    left.id = "aiva-left-sidebar";

    left.innerHTML = `
      <div class="aiva-side-logo">
        <div class="aiva-side-logo-mark">A</div>
        <span>Aiva</span>
      </div>

      <button
        type="button"
        class="aiva-new-chat"
        id="aiva-new-chat"
      >
        ＋ Новый чат
      </button>

      <div class="aiva-section-title">
        История
      </div>

      <div id="aiva-history"></div>
    `;

    document.body.appendChild(left);

    const right = document.createElement("aside");
    right.id = "aiva-right-sidebar";

    right.innerHTML = `
      <div class="aiva-right-title">
        Настройки Aiva
      </div>

      <div class="aiva-card">
        <div class="aiva-card-title">
          Модель
        </div>
        <div id="aiva-model-holder"></div>
      </div>

      <div class="aiva-card">
        <div class="aiva-card-title">
          Действия
        </div>

        <div id="aiva-actions"></div>
      </div>
    `;

    document.body.appendChild(right);

    bodyClass();

    // Переносим существующий select модели
    const modelSelect =
      document.getElementById("model-select");

    if (modelSelect) {
      document
        .getElementById("aiva-model-holder")
        .appendChild(modelSelect);
    }

    // Переносим существующие кнопки —
    // их функции сохраняются
    [
      "regen-btn",
      "export-btn",
      "prompt-btn",
      "clear-btn"
    ].forEach((id) => {
      const element =
        document.getElementById(id);

      if (element) {
        document
          .getElementById("aiva-actions")
          .appendChild(element);
      }
    });

    // Новый чат = существующая очистка
    const newChat =
      document.getElementById("aiva-new-chat");

    const clearButton =
      document.getElementById("clear-btn");

    newChat.onclick = () => {
      if (clearButton) {
        clearButton.click();
      } else {
        const chat =
          document.getElementById("chat");

        if (chat) {
          chat.innerHTML = "";
        }
      }
    };

    updateHistory();

    const chat =
      document.getElementById("chat");

    if (chat) {
      const observer =
        new MutationObserver(
          updateHistory
        );

      observer.observe(chat, {
        childList: true,
        subtree: true
      });
    }
  }

  function bodyClass() {
    const auth =
      document.getElementById(
        "authScreen"
      );

    if (!auth) {
      document.body.classList.add(
        "aiva-layout-active"
      );
      return;
    }

    const hidden =
      getComputedStyle(auth).display ===
        "none" ||
      getComputedStyle(auth).visibility ===
        "hidden" ||
      auth.hidden === true;

    if (hidden) {
      document.body.classList.add(
        "aiva-layout-active"
      );
    } else {
      document.body.classList.remove(
        "aiva-layout-active"
      );
    }

    setTimeout(bodyClass, 500);
  }

  function updateHistory() {
    const history =
      document.getElementById(
        "aiva-history"
      );

    const chat =
      document.getElementById("chat");

    if (!history || !chat) {
      return;
    }

    history.innerHTML = "";

    const messages = [
      ...chat.querySelectorAll(
        ".msg.me"
      )
    ];

    if (!messages.length) {
      const empty =
        document.createElement("div");

      empty.style.cssText = `
        padding:10px 6px;
        color:#666a75;
        font-size:12px;
      `;

      empty.textContent =
        "Пока нет сообщений";

      history.appendChild(empty);
      return;
    }

    messages
      .slice()
      .reverse()
      .slice(0, 20)
      .forEach((message) => {
        const content =
          message.querySelector(
            ".content"
          );

        if (!content) return;

        const text =
          content.innerText.trim();

        if (!text) return;

        const item =
          document.createElement("button");

        item.type = "button";
        item.className =
          "aiva-history-item";

        item.textContent =
          text.replace(/\s+/g, " ");

        item.title = text;

        item.onclick = () => {
          message.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        };

        history.appendChild(item);
      });
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initAivaLayout
    );
  } else {
    initAivaLayout();
  }
})();
