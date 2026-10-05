const SUPABASE_URL = "https://gzphouchibqjxwudncdz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U";

(function () {
  let aivaSupabase = null;

  async function getSupabase() {
    if (aivaSupabase) return aivaSupabase;

    // Пытаемся использовать уже существующий Supabase-клиент Aiva
    const existingClients = [
      window.supabaseClient,
      window.aivaSupabase,
      window.sb
    ];

    for (const client of existingClients) {
      if (
        client &&
        client.auth &&
        typeof client.auth.resetPasswordForEmail === "function"
      ) {
        aivaSupabase = client;
        return client;
      }
    }

    // Загружаем Supabase отдельно, без конфликта с существующим кодом
    const module = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    aivaSupabase = module.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    return aivaSupabase;
  }

  function findPasswordInput() {
    const inputs = Array.from(
      document.querySelectorAll("input")
    );

    return inputs.find((input) => {
      const type = (input.type || "").toLowerCase();
      const placeholder = (
        input.placeholder || ""
      ).toLowerCase();
      const name = (input.name || "").toLowerCase();
      const id = (input.id || "").toLowerCase();
      const autocomplete = (
        input.autocomplete || ""
      ).toLowerCase();

      return (
        type === "password" ||
        autocomplete === "current-password" ||
        placeholder.includes("пароль") ||
        placeholder.includes("password") ||
        name.includes("password") ||
        name.includes("pass") ||
        id.includes("password") ||
        id.includes("pass")
      );
    });
  }

  function addForgotPasswordButton(supabase) {
    if (document.getElementById("aiva-forgot-password")) {
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
      padding:6px 0;
      border:0;
      background:transparent;
      color:#8b5cf6;
      font-size:14px;
      cursor:pointer;
      text-align:right;
    `;

    button.addEventListener("click", async function () {
      const email = prompt(
        "Введите email, на который зарегистрирован Aiva:"
      );

      if (!email) return;

      try {
        button.disabled = true;
        button.textContent = "Отправляем...";

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
          ". Проверяй почту и папку «Спам»."
        );
      } catch (error) {
        console.error("Aiva reset:", error);

        alert(
          "Ошибка отправки письма:\n\n" +
          error.message
        );
      } finally {
        button.disabled = false;
        button.textContent = "Забыли пароль?";
      }
    });

    const parent = passwordInput.parentElement;

    if (parent) {
      parent.appendChild(button);
    }
  }

  function createResetScreen(supabase) {
    if (
      document.getElementById(
        "aiva-reset-password-screen"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.textContent = `
      #aiva-reset-password-screen {
        position:fixed;
        inset:0;
        z-index:9999999;
        display:flex;
        justify-content:center;
        align-items:center;
        padding:20px;
        background:
          radial-gradient(
            circle at top,
            rgba(124,58,237,.35),
            transparent 45%
          ),
          #080812;
        font-family:Arial,sans-serif;
      }

      .aiva-reset-card {
        width:100%;
        max-width:420px;
        padding:32px;
        box-sizing:border-box;
        border-radius:24px;
        background:#151525;
        border:1px solid rgba(255,255,255,.1);
        box-shadow:0 25px 80px rgba(0,0,0,.55);
        color:white;
      }

      .aiva-reset-card h1 {
        margin:0 0 10px;
        text-align:center;
        font-size:28px;
      }

      .aiva-reset-card p {
        margin:0 0 25px;
        text-align:center;
        color:#a1a1aa;
        line-height:1.5;
      }

      .aiva-reset-card input {
        width:100%;
        box-sizing:border-box;
        padding:14px 16px;
        margin-bottom:12px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,.12);
        outline:none;
        background:#0f0f1b;
        color:white;
        font-size:16px;
      }

      .aiva-reset-card input:focus {
        border-color:#8b5cf6;
      }

      .aiva-reset-card button {
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

      .aiva-reset-card button:disabled {
        opacity:.6;
        cursor:not-allowed;
      }

      #aiva-reset-message {
        margin-top:15px;
        text-align:center;
        color:#a1a1aa;
        font-size:14px;
      }
    `;

    document.head.appendChild(style);

    const screen = document.createElement("div");

    screen.id = "aiva-reset-password-screen";

    screen.innerHTML = `
      <div class="aiva-reset-card">

        <h1>🔐 Новый пароль</h1>

        <p>
          Придумай новый пароль для своего аккаунта Aiva.
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

    document.body.appendChild(screen);

    const password = document.getElementById(
      "aiva-new-password"
    );

    const confirm = document.getElementById(
      "aiva-confirm-password"
    );

    const saveButton = document.getElementById(
      "aiva-save-password"
    );

    const message = document.getElementById(
      "aiva-reset-message"
    );

    saveButton.addEventListener("click", async function () {
      const newPassword = password.value;
      const confirmPassword = confirm.value;

      if (newPassword.length < 6) {
        message.textContent =
          "Пароль должен содержать минимум 6 символов.";
        return;
      }

      if (newPassword !== confirmPassword) {
        message.textContent =
          "Пароли не совпадают.";
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = "Сохраняем...";
      message.textContent = "";

      try {
        const { error } =
          await supabase.auth.updateUser({
            password: newPassword
          });

        if (error) {
          throw error;
        }

        message.textContent =
          "✅ Пароль успешно изменён!";

        saveButton.textContent = "Готово";

        setTimeout(function () {
          window.location.href = "/";
        }, 2000);

      } catch (error) {
        console.error(error);

        message.textContent =
          "Ошибка: " + error.message;

        saveButton.disabled = false;
        saveButton.textContent =
          "Сохранить пароль";
      }
    });
  }

  async function start() {
    try {
      const supabase = await getSupabase();

      // Проверяем кнопку каждые полсекунды,
      // чтобы поймать форму даже если Aiva создаёт её позже
      setInterval(function () {
        addForgotPasswordButton(supabase);
      }, 500);

      // Окно нового пароля
      const isReset =
        window.location.pathname.includes(
          "reset-password"
        ) ||
        window.location.hash.includes(
          "type=recovery"
        ) ||
        window.location.search.includes(
          "reset-password"
        );

      if (isReset) {
        createResetScreen(supabase);
      }

    } catch (error) {
      console.error(
        "Aiva password reset error:",
        error
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
