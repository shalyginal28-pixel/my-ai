const SUPABASE_URL = "https://gzphouchibqjxwudncdz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U";

(function () {
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase) {
        resolve(window.supabase);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

      script.onload = () => {
        if (window.supabase) {
          resolve(window.supabase);
        } else {
          reject(new Error("Supabase не загрузился"));
        }
      };

      script.onerror = () => {
        reject(new Error("Ошибка загрузки Supabase"));
      };

      document.head.appendChild(script);
    });
  }

  async function init() {
    const supabaseLib = await loadSupabase();

    const supabase = supabaseLib.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    addForgotPassword(supabase);

    if (
      window.location.pathname.includes("reset-password") ||
      window.location.hash.includes("type=recovery")
    ) {
      showResetPassword(supabase);
    }
  }

  function addForgotPassword(supabase) {
    const observer = new MutationObserver(() => {
      const passwordInputs = document.querySelectorAll(
        'input[type="password"]'
      );

      passwordInputs.forEach((input) => {
        if (input.dataset.aivaForgotAdded) return;

        input.dataset.aivaForgotAdded = "true";

        const link = document.createElement("button");

        link.type = "button";
        link.textContent = "Забыли пароль?";

        link.style.cssText = `
          display:block;
          margin:8px auto 0;
          border:none;
          background:none;
          color:#8b5cf6;
          cursor:pointer;
          font-size:14px;
        `;

        link.onclick = async () => {
          const email = prompt(
            "Введите email вашего аккаунта:"
          );

          if (!email) return;

          try {
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
              alert("Ошибка: " + error.message);
              return;
            }

            alert(
              "Письмо для сброса пароля отправлено на " +
                email.trim() +
                ". Проверьте почту и папку «Спам»."
            );
          } catch (error) {
            console.error(error);
            alert("Не удалось отправить письмо.");
          }
        };

        if (input.parentElement) {
          input.parentElement.appendChild(link);
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function showResetPassword(supabase) {
    if (document.getElementById("aiva-reset-password")) {
      return;
    }

    const style = document.createElement("style");

    style.textContent = `
      #aiva-reset-password {
        position:fixed;
        inset:0;
        z-index:999999;
        display:flex;
        align-items:center;
        justify-content:center;
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

      #aiva-reset-password .card {
        width:100%;
        max-width:420px;
        padding:32px;
        border-radius:24px;
        background:rgba(20,20,35,.96);
        border:1px solid rgba(255,255,255,.1);
        box-shadow:0 25px 80px rgba(0,0,0,.5);
        color:white;
        box-sizing:border-box;
      }

      #aiva-reset-password h1 {
        margin:0 0 10px;
        text-align:center;
        font-size:28px;
      }

      #aiva-reset-password p {
        margin:0 0 24px;
        text-align:center;
        color:#a1a1aa;
        line-height:1.5;
      }

      #aiva-reset-password input {
        width:100%;
        box-sizing:border-box;
        padding:14px 16px;
        margin-bottom:12px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,.12);
        outline:none;
        background:#11111d;
        color:white;
        font-size:16px;
      }

      #aiva-reset-password input:focus {
        border-color:#8b5cf6;
      }

      #aiva-reset-password button {
        width:100%;
        padding:14px;
        border:0;
        border-radius:12px;
        background:linear-gradient(135deg,#8b5cf6,#6366f1);
        color:white;
        font-size:16px;
        font-weight:700;
        cursor:pointer;
      }

      #aiva-reset-password button:disabled {
        opacity:.6;
        cursor:not-allowed;
      }

      #aiva-reset-message {
        margin-top:16px;
        text-align:center;
        font-size:14px;
        color:#a1a1aa;
      }
    `;

    document.head.appendChild(style);

    const box = document.createElement("div");
    box.id = "aiva-reset-password";

    box.innerHTML = `
      <div class="card">
        <h1>🔐 Новый пароль</h1>

        <p>
          Придумайте новый пароль для вашего аккаунта Aiva.
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
          placeholder="Повторите пароль"
          autocomplete="new-password"
        />

        <button id="aiva-save-password">
          Сохранить пароль
        </button>

        <div id="aiva-reset-message"></div>
      </div>
    `;

    document.body.appendChild(box);

    const password =
      document.getElementById("aiva-new-password");

    const confirm =
      document.getElementById("aiva-confirm-password");

    const button =
      document.getElementById("aiva-save-password");

    const message =
      document.getElementById("aiva-reset-message");

    button.onclick = async () => {
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

      button.disabled = true;
      button.textContent = "Сохраняем...";
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

        button.textContent = "Готово";

        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      } catch (error) {
        console.error(error);

        message.textContent =
          "Ошибка: " + error.message;

        button.disabled = false;
        button.textContent =
          "Сохранить пароль";
      }
    };
  }

  init().catch((error) => {
    console.error("Aiva password reset:", error);
  });
})();
