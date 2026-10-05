(function () {
    const SUPABASE_URL = "https://gzphouchibqjxwudncdz.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U";
  let supabaseClient = null;

  async function getSupabase() {
    if (supabaseClient) return supabaseClient;

    if (
      window.supabaseClient &&
      window.supabaseClient.auth
    ) {
      supabaseClient = window.supabaseClient;
      return supabaseClient;
    }

    if (
      window.aivaSupabase &&
      window.aivaSupabase.auth
    ) {
      supabaseClient = window.aivaSupabase;
      return supabaseClient;
    }

    if (
      window.sb &&
      window.sb.auth
    ) {
      supabaseClient = window.sb;
      return supabaseClient;
    }

    const module = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    supabaseClient = module.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    return supabaseClient;
  }

  function findPasswordInput() {
    const inputs = Array.from(
      document.querySelectorAll("input")
    );

    return inputs.find(function (input) {
      const type = String(input.type || "").toLowerCase();
      const placeholder = String(
        input.placeholder || ""
      ).toLowerCase();
      const name = String(
        input.name || ""
      ).toLowerCase();
      const id = String(
        input.id || ""
      ).toLowerCase();

      return (
        type === "password" ||
        placeholder.includes("пароль") ||
        placeholder.includes("password") ||
        name.includes("password") ||
        name.includes("pass") ||
        id.includes("password") ||
        id.includes("pass")
      );
    });
  }

  function addForgotButton() {
    if (
      document.getElementById(
        "aiva-forgot-password"
      )
    ) {
      return;
    }

    const passwordInput = findPasswordInput();

    if (!passwordInput) {
      return;
    }

    const button = document.createElement("button");

    button.id = "aiva-forgot-password";
    button.type = "button";
    button.textContent = "Забыли пароль?";

    button.style.cssText = `
      display:block;
      width:100%;
      margin-top:8px;
      padding:7px 0;
      border:0;
      background:transparent;
      color:#8b5cf6;
      font-size:14px;
      cursor:pointer;
      text-align:right;
    `;

    button.addEventListener(
      "click",
      async function () {
        const email = prompt(
          "Введите email вашего аккаунта Aiva:"
        );

        if (!email) {
          return;
        }

        try {
          button.disabled = true;
          button.textContent = "Отправляем...";

          const supabase =
            await getSupabase();

          const { error } =
            await supabase.auth.resetPasswordForEmail(
              email.trim(),
              {
                redirectTo:
                  window.location.origin +
                  "/reset-password"
              }
            );

          if (error) {
            throw error;
          }

          alert(
            "✅ Письмо отправлено на " +
              email.trim() +
              ". Проверь почту и папку «Спам»."
          );
        } catch (error) {
          console.error(
            "Aiva password reset:",
            error
          );

          alert(
            "❌ Ошибка:\n\n" +
              error.message
          );
        } finally {
          button.disabled = false;
          button.textContent =
            "Забыли пароль?";
        }
      }
    );

    const parent = passwordInput.parentElement;

    if (parent) {
      parent.appendChild(button);
    }
  }

  function createResetPage() {
    if (
      document.getElementById(
        "aiva-reset-page"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

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
            rgba(124,58,237,.35),
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
        border:1px solid rgba(255,255,255,.1);
        box-shadow:0 25px 80px rgba(0,0,0,.55);
        color:#fff;
      }

      #aiva-reset-card h1 {
        margin:0 0 10px;
        text-align:center;
        font-size:28px;
      }

      #aiva-reset-card p {
        margin:0 0 24px;
        text-align:center;
        color:#aaa;
        line-height:1.5;
      }

      #aiva-reset-card input {
        width:100%;
        padding:14px 16px;
        margin-bottom:12px;
        box-sizing:border-box;
        border-radius:12px;
        border:1px solid #333;
        outline:none;
        background:#0f0f1b;
        color:#fff;
        font-size:16px;
      }

      #aiva-reset-card input:focus {
        border-color:#8b5cf6;
      }

      #aiva-reset-card button {
        width:100%;
        padding:14px;
        border:0;
        border-radius:12px;
        background:linear-gradient(
          135deg,
          #8b5cf6,
          #6366f1
        );
        color:#fff;
        font-size:16px;
        font-weight:bold;
        cursor:pointer;
      }

      #aiva-reset-message {
        margin-top:15px;
        text-align:center;
        color:#aaa;
        font-size:14px;
      }
    `;

    document.head.appendChild(style);

    const page =
      document.createElement("div");

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

    const button =
      document.getElementById(
        "aiva-save-password"
      );

    const message =
      document.getElementById(
        "aiva-reset-message"
      );

    button.addEventListener(
      "click",
      async function () {
        const newPassword =
          password.value;

        const confirmPassword =
          confirm.value;

        if (newPassword.length < 6) {
          message.textContent =
            "Пароль должен содержать минимум 6 символов.";
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
          button.disabled = true;
          button.textContent =
            "Сохраняем...";

          const supabase =
            await getSupabase();

          const { error } =
            await supabase.auth.updateUser({
              password: newPassword
            });

          if (error) {
            throw error;
          }

          message.textContent =
            "✅ Пароль успешно изменён!";

          button.textContent =
            "Готово";

          setTimeout(function () {
            window.location.href = "/";
          }, 2000);

        } catch (error) {
          console.error(error);

          message.textContent =
            "❌ Ошибка: " +
            error.message;

          button.disabled = false;
          button.textContent =
            "Сохранить пароль";
        }
      }
    );
  }

  function start() {
    // Кнопку ищем независимо от Supabase
    addForgotButton();

    setInterval(function () {
      addForgotButton();
    }, 500);

    const isResetPage =
      window.location.pathname.includes(
        "reset-password"
      ) ||
      window.location.hash.includes(
        "type=recovery"
      );

    if (isResetPage) {
      createResetPage();
    }
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }
})();
