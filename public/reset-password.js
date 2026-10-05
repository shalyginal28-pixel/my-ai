/* =========================================================
   AIVA — PASSWORD RESET
   Самостоятельный Supabase-клиент
========================================================= */

(() => {
  "use strict";

  const SUPABASE_URL =
    "https://gzphouchibqjxwudncdz.supabase.co";

  const SUPABASE_KEY =
    "sb_publishable_B_NiK_UGRWAjJfLlvOqc-w_4qaRIf0U";

  let supabasePromise = null;

  function getSupabase() {
    if (!supabasePromise) {
      supabasePromise = import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
      ).then((module) => {
        return module.createClient(
          SUPABASE_URL,
          SUPABASE_KEY
        );
      });
    }

    return supabasePromise;
  }

  function addStyles() {
    if (
      document.getElementById(
        "aiva-password-reset-styles"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.id = "aiva-password-reset-styles";

    style.textContent = `
      .aiva-forgot-password {
        width: 100%;
        height: 36px;
        margin-top: 4px;
        border: 0;
        background: transparent;
        color: #999ca7;
        font-size: 13px;
        cursor: pointer;
        transition: color .15s ease;
      }

      .aiva-forgot-password:hover {
        color: #aaa1ff;
      }

      .aiva-forgot-password:disabled {
        opacity: .55;
        cursor: wait;
      }

      #aiva-reset-modal {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;

        background: rgba(0,0,0,.72);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);

        opacity: 0;
        visibility: hidden;
        pointer-events: none;

        transition:
          opacity .18s ease,
          visibility .18s ease;
      }

      #aiva-reset-modal.open {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }

      .aiva-reset-card {
        position: relative;
        width: min(100%, 410px);
        padding: 28px;

        border: 1px solid rgba(255,255,255,.10);
        border-radius: 22px;

        background: linear-gradient(
          180deg,
          #191a22,
          #0f1015
        );

        box-shadow:
          0 30px 90px rgba(0,0,0,.55),
          0 8px 30px rgba(0,0,0,.30);

        color: #f5f5f7;

        transform: translateY(8px) scale(.98);
        transition: transform .18s ease;
      }

      #aiva-reset-modal.open .aiva-reset-card {
        transform: none;
      }

      .aiva-reset-close {
        position: absolute;
        top: 12px;
        right: 12px;

        width: 34px;
        height: 34px;

        border-radius: 10px;
        border: 1px solid rgba(255,255,255,.07);

        background: transparent;
        color: #999ca7;

        font-size: 24px;
        cursor: pointer;
      }

      .aiva-reset-close:hover {
        background: rgba(255,255,255,.05);
        color: #fff;
      }

      .aiva-reset-logo {
        width: 54px;
        height: 54px;
        margin-bottom: 18px;

        display: flex;
        align-items: center;
        justify-content: center;

        border-radius: 17px;

        background: linear-gradient(
          135deg,
          #7668ff,
          #5c8cff
        );

        color: #fff;
        font-size: 23px;
        font-weight: 800;
      }

      .aiva-reset-card h2 {
        margin: 0;
        font-size: 24px;
      }

      .aiva-reset-subtitle {
        margin: 9px 0 20px;
        color: #999ca7;
        font-size: 13px;
        line-height: 1.5;
      }

      .aiva-reset-card input {
        width: 100%;
        height: 48px;
        margin-top: 9px;
        padding: 0 14px;

        box-sizing: border-box;

        border: 1px solid rgba(255,255,255,.09);
        border-radius: 12px;
        outline: none;

        background: rgba(255,255,255,.035);
        color: #f5f5f7;

        font-size: 14px;
      }

      .aiva-reset-card input:focus {
        border-color: rgba(118,104,255,.48);
      }

      .aiva-reset-submit {
        width: 100%;
        height: 49px;
        margin-top: 14px;

        border: 0;
        border-radius: 12px;

        background: #f5f5f7;
        color: #0b0b0f;

        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
      }

      .aiva-reset-submit:disabled {
        opacity: .55;
        cursor: wait;
      }

      .aiva-reset-message {
        min-height: 20px;
        margin-top: 12px;

        color: #ff8585;
        font-size: 12px;
        line-height: 1.45;
        text-align: center;
      }

      .aiva-reset-message.success {
        color: #76e0a0;
      }

      .aiva-reset-back {
        width: 100%;
        height: 40px;
        margin-top: 6px;

        border: 0;
        background: transparent;
        color: #999ca7;

        font-size: 13px;
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
  }

  function createResetModal() {
    if (
      document.getElementById(
        "aiva-reset-modal"
      )
    ) {
      return;
    }

    const modal = document.createElement("div");

    modal.id = "aiva-reset-modal";

    modal.innerHTML = `
      <div class="aiva-reset-card">

        <button
          id="aiva-reset-close"
          class="aiva-reset-close"
          type="button"
        >
          ×
        </button>

        <div class="aiva-reset-logo">
          A
        </div>

        <h2>Новый пароль</h2>

        <p class="aiva-reset-subtitle">
          Придумай новый пароль для своего аккаунта Aiva.
        </p>

        <input
          id="aiva-new-password"
          type="password"
          placeholder="Новый пароль"
          autocomplete="new-password"
        >

        <input
          id="aiva-confirm-password"
          type="password"
          placeholder="Повтори новый пароль"
          autocomplete="new-password"
        >

        <button
          id="aiva-reset-submit"
          class="aiva-reset-submit"
          type="button"
        >
          Сохранить новый пароль
        </button>

        <div
          id="aiva-reset-message"
          class="aiva-reset-message"
        ></div>

        <button
          id="aiva-reset-back"
          class="aiva-reset-back"
          type="button"
        >
          Вернуться ко входу
        </button>

      </div>
    `;

    document.body.appendChild(modal);

    const closeButton =
      document.getElementById(
        "aiva-reset-close"
      );

    const backButton =
      document.getElementById(
        "aiva-reset-back"
      );

    closeButton.onclick = () => {
      modal.classList.remove("open");
    };

    backButton.onclick = () => {
      modal.classList.remove("open");
    };

    modal.onclick = (event) => {
      if (event.target === modal) {
        modal.classList.remove("open");
      }
    };
  }

  function openResetModal() {
    const modal =
      document.getElementById(
        "aiva-reset-modal"
      );

    if (!modal) {
      return;
    }

    modal.classList.add("open");

    const password =
      document.getElementById(
        "aiva-new-password"
      );

    setTimeout(() => {
      password?.focus();
    }, 50);
  }

  function createForgotButton() {
    if (
      document.getElementById(
        "aiva-forgot-password"
      )
    ) {
      return;
    }

    const authSwitch =
      document.getElementById(
        "authSwitch"
      );

    if (!authSwitch) {
      return;
    }

    const button =
      document.createElement("button");

    button.id =
      "aiva-forgot-password";

    button.type =
      "button";

    button.className =
      "aiva-forgot-password";

    button.textContent =
      "Забыли пароль?";

    authSwitch.insertAdjacentElement(
      "afterend",
      button
    );

    button.onclick =
      async function () {
        const authEmail =
          document.getElementById(
            "authEmail"
          );

        const authError =
          document.getElementById(
            "authError"
          );

        const email =
          String(
            authEmail?.value || ""
          ).trim();

        if (!email) {
          if (authError) {
            authError.textContent =
              "Сначала введи email.";
          }

          authEmail?.focus();
          return;
        }

        button.disabled = true;
        button.textContent =
          "Отправляем...";

        if (authError) {
          authError.textContent = "";
        }

        try {
          const supabase =
            await getSupabase();

          const { error } =
            await supabase.auth.resetPasswordForEmail(
              email,
              {
                redirectTo:
                  `${window.location.origin}/?reset=1`
              }
            );

          if (error) {
            throw error;
          }

          if (authError) {
            authError.textContent =
              "Письмо для сброса пароля отправлено. Проверь почту.";
            authError.classList.add(
              "success"
            );
          }

        } catch (error) {
          console.error(
            "Aiva password reset:",
            error
          );

          if (authError) {
            authError.textContent =
              "Не удалось отправить письмо: " +
              error.message;
            authError.classList.remove(
              "success"
            );
          } else {
            alert(
              "Ошибка отправки письма:\n\n" +
                error.message
            );
          }

        } finally {
          button.disabled = false;
          button.textContent =
            "Забыли пароль?";
        }
      };
  }

  async function setupRecovery() {
    try {
      const supabase =
        await getSupabase();

      supabase.auth.onAuthStateChange(
        (event) => {
          if (
            event ===
            "PASSWORD_RECOVERY"
          ) {
            openResetModal();
          }
        }
      );

      const {
        data
      } = await supabase.auth.getSession();

      const isRecovery =
        new URLSearchParams(
          window.location.search
        ).get("reset") === "1";

      if (
        isRecovery &&
        data?.session
      ) {
        openResetModal();
      }

    } catch (error) {
      console.error(
        "Aiva recovery:",
        error
      );
    }
  }

  function setupSavePassword() {
    const button =
      document.getElementById(
        "aiva-reset-submit"
      );

    if (!button) {
      return;
    }

    button.onclick =
      async function () {
        const password =
          document.getElementById(
            "aiva-new-password"
          )?.value || "";

        const confirmation =
          document.getElementById(
            "aiva-confirm-password"
          )?.value || "";

        const message =
          document.getElementById(
            "aiva-reset-message"
          );

        if (
          password.length < 6
        ) {
          message.textContent =
            "Пароль должен содержать минимум 6 символов.";
          return;
        }

        if (
          password !==
          confirmation
        ) {
          message.textContent =
            "Пароли не совпадают.";
          return;
        }

        button.disabled = true;
        button.textContent =
          "Сохраняем...";

        try {
          const supabase =
            await getSupabase();

          const { error } =
            await supabase.auth.updateUser({
              password
            });

          if (error) {
            throw error;
          }

          message.textContent =
            "Пароль успешно изменён.";
          message.classList.add(
            "success"
          );

          button.textContent =
            "Готово";

          setTimeout(() => {
            window.location.href =
              window.location.origin;
          }, 1500);

        } catch (error) {
          console.error(error);

          message.textContent =
            "Ошибка: " +
            error.message;

          button.disabled = false;
          button.textContent =
            "Сохранить новый пароль";
        }
      };
  }

  function start() {
    addStyles();
    createResetModal();
    setupSavePassword();

    createForgotButton();

    const observer =
      new MutationObserver(() => {
        createForgotButton();
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    setupRecovery();
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
