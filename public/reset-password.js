(function () {
  const SUPABASE_URL =
    "https://gzphouchibqjxwudncdz.supabase.co";

  const SUPABASE_ANON_KEY =
    "sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U";

  let client = null;
  let recoveryPageShown = false;

  async function getClient() {
    if (client) return client;

    const supabaseModule = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    client = supabaseModule.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    client.auth.onAuthStateChange(function (event) {
      if (event === "PASSWORD_RECOVERY") {
        showResetPage();
      }
    });

    return client;
  }

 function addButton() {
  const oldButton = document.getElementById(
    "aiva-forgot-password"
  );

  // Ищем именно заголовок окна входа
  const heading = Array.from(
    document.querySelectorAll("*")
  ).find(function (el) {
    return (
      el.textContent.trim() === "Войти в Aiva" &&
      el.getBoundingClientRect().width > 0 &&
      el.getBoundingClientRect().height > 0
    );
  });

  // Если окно входа закрыто — убираем кнопку
  if (!heading) {
    if (oldButton) {
      oldButton.remove();
    }
    return;
  }

  if (oldButton) {
    return;
  }

  // Ищем контейнер окна входа
  let container = heading;

  for (let i = 0; i < 8; i++) {
    if (!container.parentElement) break;

    container = container.parentElement;

    const inputs =
      container.querySelectorAll("input");

    const buttons =
      container.querySelectorAll("button");

    if (
      inputs.length >= 2 &&
      buttons.length >= 2
    ) {
      break;
    }
  }

  // Ищем пароль
  const passwordInput =
    Array.from(
      container.querySelectorAll("input")
    ).find(function (input) {
      return (
        input.type === "password" ||
        String(input.placeholder || "")
          .toLowerCase()
          .includes("пароль")
      );
    });

  if (!passwordInput) {
    return;
  }

  const button =
    document.createElement("button");

  button.id =
    "aiva-forgot-password";

  button.type = "button";

  button.textContent =
    "Забыли пароль?";

  button.style.cssText = `
    display:block;
    width:100%;
    margin-top:8px;
    padding:8px 0;
    border:0;
    background:transparent;
    color:#8b5cf6;
    font-size:14px;
    font-weight:600;
    cursor:pointer;
  `;

  button.onclick = async function () {
    let email = "";

    const emailInput =
      Array.from(
        container.querySelectorAll("input")
      ).find(function (input) {
        return (
          input.type === "email" ||
          String(input.placeholder || "")
            .toLowerCase()
            .includes("email")
        );
      });

    if (emailInput) {
      email = emailInput.value.trim();
    }

    if (!email) {
      email = prompt(
        "Введите email вашего аккаунта Aiva:"
      );

      if (!email) return;

      email = email.trim();
    }

    try {
      button.disabled = true;
      button.textContent = "Отправляем...";

      const supabase =
        await getClient();

      const { error } =
        await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo:
              window.location.origin
          }
        );

      if (error) {
        throw error;
      }

      alert(
        "✅ Письмо отправлено на:\n\n" +
        email +
        "\n\nПроверь почту и папку «Спам»."
      );

    } catch (error) {
      console.error(error);

      alert(
        "❌ Ошибка:\n\n" +
        error.message
      );

    } finally {
      button.disabled = false;
      button.textContent =
        "Забыли пароль?";
    }
  };

  passwordInput.parentElement.appendChild(
    button
  );
}
}

    const wrap = document.createElement("div");

    wrap.id = "aiva-forgot-password";

    wrap.style.cssText = `
      position:fixed;
      left:50%;
      bottom:120px;
      transform:translateX(-50%);
      z-index:999999;
      text-align:center;
    `;

    const button = document.createElement("button");

    button.type = "button";
    button.textContent = "Забыли пароль?";

    button.style.cssText = `
      border:0;
      background:transparent;
      color:#8b5cf6;
      font-size:14px;
      font-weight:600;
      cursor:pointer;
      padding:10px 20px;
    `;

    button.onclick = async function () {
      let email = prompt(
        "Введите email вашего аккаунта Aiva:"
      );

      if (!email) return;

      email = email.trim();

      try {
        button.disabled = true;
        button.textContent = "Отправляем...";

        const supabase = await getClient();

        const result =
          await supabase.auth.resetPasswordForEmail(
            email,
            {
              redirectTo:
                window.location.origin
            }
          );

        if (result.error) {
          throw result.error;
        }

        alert(
          "✅ Письмо для сброса пароля отправлено на:\n\n" +
          email +
          "\n\nПроверь почту и папку «Спам»."
        );

      } catch (error) {
        alert(
          "❌ Ошибка:\n\n" +
          error.message
        );

        console.error(error);

      } finally {
        button.disabled = false;
        button.textContent = "Забыли пароль?";
      }
    };

    wrap.appendChild(button);
    document.body.appendChild(wrap);
  }

  function showResetPage() {
    if (recoveryPageShown) return;

    recoveryPageShown = true;

    if (
      document.getElementById(
        "aiva-reset-page"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.textContent = `
      #aiva-reset-page {
        position:fixed;
        inset:0;
        z-index:99999999;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
        box-sizing:border-box;
        background:
          radial-gradient(
            circle at top,
            rgba(124,58,237,.4),
            transparent 45%
          ),
          #080812;
        font-family:Arial,sans-serif;
      }

      #aiva-reset-card {
        width:100%;
        max-width:420px;
        padding:32px;
        box-sizing:border-box;
        border-radius:24px;
        background:#151525;
        color:white;
        border:1px solid rgba(255,255,255,.1);
        box-shadow:0 25px 80px rgba(0,0,0,.6);
      }

      #aiva-reset-card h1 {
        margin:0 0 10px;
        text-align:center;
        font-size:28px;
      }

      #aiva-reset-card p {
        margin:0 0 25px;
        text-align:center;
        color:#aaa;
      }

      #aiva-reset-card input {
        width:100%;
        padding:14px 16px;
        margin-bottom:12px;
        box-sizing:border-box;
        border-radius:12px;
        border:1px solid #333;
        background:#0f0f1b;
        color:white;
        font-size:16px;
        outline:none;
      }

      #aiva-reset-card input:focus {
        border-color:#8b5cf6;
      }

      #aiva-save-password {
        width:100%;
        padding:14px;
        border:0;
        border-radius:12px;
        background:linear-gradient(
          135deg,
          #8b5cf6,
          #6366f1
        );
        color:white;
        font-size:16px;
        font-weight:bold;
        cursor:pointer;
      }

      #aiva-save-password:disabled {
        opacity:.6;
      }

      #aiva-reset-message {
        margin-top:15px;
        text-align:center;
        color:#aaa;
        font-size:14px;
      }
    `;

    document.head.appendChild(style);

    const page = document.createElement("div");

    page.id = "aiva-reset-page";

    page.innerHTML = `
      <div id="aiva-reset-card">

        <h1>🔐 Новый пароль</h1>

        <p>
          Придумай новый пароль для аккаунта Aiva.
        </p>

        <input
          id="aiva-new-password"
          type="password"
          placeholder="Новый пароль"
          autocomplete="new-password"
        />

        <input
          id="aiva-confirm-password"
          type="password"
          placeholder="Повтори пароль"
          autocomplete="new-password"
        />

        <button id="aiva-save-password">
          Сохранить пароль
        </button>

        <div id="aiva-reset-message"></div>

      </div>
    `;

    document.body.appendChild(page);

    const password =
      document.getElementById(
        "aiva-new-password"
      );

    const confirm =
      document.getElementById(
        "aiva-confirm-password"
      );

    const save =
      document.getElementById(
        "aiva-save-password"
      );

    const message =
      document.getElementById(
        "aiva-reset-message"
      );

    save.onclick = async function () {
      const newPassword =
        password.value;

      const confirmPassword =
        confirm.value;

      if (newPassword.length < 6) {
        message.textContent =
          "Пароль должен быть минимум 6 символов.";
        return;
      }

      if (
        newPassword !==
        confirmPassword
      ) {
        message.textContent =
          "Пароли не совпадают.";
        return;
      }

      try {
        save.disabled = true;
        save.textContent = "Сохраняем...";

        const supabase =
          await getClient();

        const result =
          await supabase.auth.updateUser({
            password: newPassword
          });

        if (result.error) {
          throw result.error;
        }

        message.textContent =
          "✅ Пароль успешно изменён!";

        save.textContent = "Готово";

        setTimeout(function () {
          window.location.href = "/";
        }, 2000);

      } catch (error) {
        message.textContent =
          "❌ " + error.message;

        save.disabled = false;
        save.textContent =
          "Сохранить пароль";

        console.error(error);
      }
    };
  }

  async function start() {
    // Сразу запускаем Supabase,
    // чтобы поймать восстановление пароля
    try {
      await getClient();
    } catch (error) {
      console.error(
        "Supabase error:",
        error
      );
    }

    // Кнопка
    addButton();

    setInterval(
      addButton,
      500
    );

    // Если уже пришли по ссылке восстановления
    if (
      window.location.hash.includes(
        "type=recovery"
      ) ||
      window.location.hash.includes(
        "access_token="
      )
    ) {
      setTimeout(
        showResetPage,
        500
      );
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }
})();
(function () {
  function setupAivaTopMenu() {
    const buttons = Array.from(
      document.querySelectorAll("button")
    );

    const refreshBtn = buttons.find(
      (b) => b.textContent.trim() === "↻"
    );

    const downloadBtn = buttons.find(
      (b) => b.textContent.trim() === "↓"
    );

    const characterBtn = buttons.find(
      (b) => b.textContent.trim() === "🎭"
    );

    const clearBtn = buttons.find(
      (b) => b.textContent.trim() === "⌫"
    );

    if (!characterBtn) return;

    if (
      document.getElementById(
        "aiva-top-menu-button"
      )
    ) {
      return;
    }

    // Прячем старые технические кнопки
    [refreshBtn, downloadBtn, clearBtn].forEach(
      (btn) => {
        if (btn) {
          btn.style.display = "none";
        }
      }
    );

    // Контейнер
    const wrapper = document.createElement("div");

    wrapper.id = "aiva-top-menu-wrapper";

    wrapper.style.cssText = `
      position:relative;
      display:inline-flex;
      align-items:center;
      margin-left:8px;
    `;

    characterBtn.parentNode.insertBefore(
      wrapper,
      characterBtn
    );

    wrapper.appendChild(characterBtn);

    // Кнопка меню
    const menuButton =
      document.createElement("button");

    menuButton.id =
      "aiva-top-menu-button";

    menuButton.type = "button";

    menuButton.textContent = "⋮";

    menuButton.style.cssText = `
      width:40px;
      height:40px;
      margin-left:6px;
      border:1px solid rgba(255,255,255,.08);
      border-radius:12px;
      background:rgba(255,255,255,.04);
      color:#fff;
      font-size:24px;
      line-height:1;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      transition:.2s;
    `;

    menuButton.onmouseenter = function () {
      menuButton.style.background =
        "rgba(139,92,246,.18)";
    };

    menuButton.onmouseleave = function () {
      menuButton.style.background =
        "rgba(255,255,255,.04)";
    };

    wrapper.appendChild(menuButton);

    // Меню
    const menu = document.createElement("div");

    menu.id = "aiva-top-menu";

    menu.style.cssText = `
      position:absolute;
      top:48px;
      right:0;
      min-width:190px;
      padding:8px;
      border-radius:16px;
      background:#151525;
      border:1px solid rgba(255,255,255,.1);
      box-shadow:0 20px 50px rgba(0,0,0,.45);
      display:none;
      z-index:999999;
    `;

    function addMenuItem(
      title,
      icon,
      action
    ) {
      const item =
        document.createElement("button");

      item.type = "button";

      item.innerHTML =
        `<span style="margin-right:10px">${icon}</span>${title}`;

      item.style.cssText = `
        width:100%;
        padding:12px 14px;
        border:0;
        border-radius:10px;
        background:transparent;
        color:#fff;
        text-align:left;
        font-size:14px;
        cursor:pointer;
      `;

      item.onmouseenter = function () {
        item.style.background =
          "rgba(139,92,246,.15)";
      };

      item.onmouseleave = function () {
        item.style.background =
          "transparent";
      };

      item.onclick = function (event) {
        event.stopPropagation();

        menu.style.display = "none";

        action();
      };

      menu.appendChild(item);
    }

    if (refreshBtn) {
      addMenuItem(
        "Обновить",
        "↻",
        function () {
          refreshBtn.click();
        }
      );
    }

    if (downloadBtn) {
      addMenuItem(
        "Экспорт",
        "↓",
        function () {
          downloadBtn.click();
        }
      );
    }

    if (clearBtn) {
      addMenuItem(
        "Очистить чат",
        "⌫",
        function () {
          clearBtn.click();
        }
      );
    }

    addMenuItem(
      "Характер Aiva",
      "🎭",
      function () {
        characterBtn.click();
      }
    );

    wrapper.appendChild(menu);

    menuButton.onclick = function (event) {
      event.stopPropagation();

      menu.style.display =
        menu.style.display === "none"
          ? "block"
          : "none";
    };

    document.addEventListener(
      "click",
      function () {
        menu.style.display = "none";
      }
    );
  }

  function startAivaMenu() {
    setupAivaTopMenu();

    const observer =
      new MutationObserver(function () {
        setupAivaTopMenu();
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      startAivaMenu
    );
  } else {
    startAivaMenu();
  }
})();
