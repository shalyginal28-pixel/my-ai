/* =========================================================
   AIVA — PASSWORD RESET
   Файл: public/reset-password.js
========================================================= */

(() => {
  "use strict";

 function waitForApp() {
  if (!document.body) {
    setTimeout(waitForApp, 100);
    return;
  }

  if (document.getElementById("aiva-reset-modal")) {
    return;
  }

  initPasswordReset();
}
  function initPasswordReset() {
    if (window.__aivaPasswordResetReady) {
      return;
    }

    window.__aivaPasswordResetReady = true;

    const supabase = window.supabaseClient;

    injectStyles();
    createForgotButton();
    createResetModal();

    const forgotButton =
      document.getElementById("aiva-forgot-password");

    const modal =
      document.getElementById("aiva-reset-modal");

    const closeButton =
      document.getElementById("aiva-reset-close");

    const resetButton =
      document.getElementById("aiva-reset-submit");

    const backButton =
      document.getElementById("aiva-reset-back");

    const newPassword =
      document.getElementById("aiva-new-password");

    const confirmPassword =
      document.getElementById("aiva-confirm-password");

    const resetMessage =
      document.getElementById("aiva-reset-message");

    const authEmail =
      document.getElementById("authEmail");

    function setMessage(text, success = false) {
      resetMessage.textContent = text || "";
      resetMessage.classList.toggle("success", success);
    }

    function openModal() {
      modal.classList.add("open");
      document.body.classList.add("aiva-reset-open");
      setMessage("");

      setTimeout(() => {
        newPassword.focus();
      }, 50);
    }

    function closeModal() {
      modal.classList.remove("open");
      document.body.classList.remove("aiva-reset-open");
    }

    function isValidPassword(password) {
      return typeof password === "string" && password.length >= 6;
    }

    async function sendResetEmail() {
      const email =
        String(authEmail?.value || "").trim();

      if (!email) {
        const existingError =
          document.getElementById("authError");

        if (existingError) {
          existingError.textContent =
            "Сначала введи email.";
        }

        authEmail?.focus();
        return;
      }

      forgotButton.disabled = true;

      const existingError =
        document.getElementById("authError");

      if (existingError) {
        existingError.textContent = "";
      }
const supabase = window.supabaseClient;

if (!supabase || !supabase.auth) {
  const existingError =
    document.getElementById("authError");

  if (existingError) {
    existingError.textContent =
      "Aiva ещё загружает авторизацию. Нажми ещё раз через секунду.";
  }

  forgotButton.disabled = false;
  return;
}
      try {
        const { error } =
          await supabase.auth.resetPasswordForEmail(
            email,
            {
              redirectTo:
                `${window.location.origin}/?reset=1`
            }
          );

        if (error) {
          console.error(
            "Aiva password reset:",
            error
          );

          if (existingError) {
            existingError.textContent =
              `Не удалось отправить письмо: ${error.message}`;
          }

          return;
        }

        if (existingError) {
          existingError.textContent =
            "Письмо для сброса пароля отправлено. Проверь почту.";
          existingError.classList.add("success");
        }

      } catch (error) {
        console.error(
          "Aiva password reset:",
          error
        );

        if (existingError) {
          existingError.textContent =
            "Ошибка отправки письма. Попробуй ещё раз.";
        }

      } finally {
        forgotButton.disabled = false;
      }
    }

    async function updatePassword() {
      const password =
        newPassword.value;

      const confirmation =
        confirmPassword.value;

      setMessage("");

      if (!password || !confirmation) {
        setMessage(
          "Заполни оба поля."
        );
        return;
      }

      if (!isValidPassword(password)) {
        setMessage(
          "Пароль должен содержать минимум 6 символов."
        );
        return;
      }

      if (password !== confirmation) {
        setMessage(
          "Пароли не совпадают."
        );
        return;
      }

      resetButton.disabled = true;

      try {
        const { error } =
          await supabase.auth.updateUser({
            password
          });

        if (error) {
          console.error(
            "Aiva update password:",
            error
          );

          setMessage(
            `Не удалось изменить пароль: ${error.message}`
          );

          return;
        }

        newPassword.value = "";
        confirmPassword.value = "";

        setMessage(
          "Пароль успешно изменён. Теперь можно войти с новым паролем.",
          true
        );

        setTimeout(() => {
          closeModal();

          try {
            history.replaceState(
              {},
              document.title,
              window.location.pathname
            );
          } catch (_) {}

          window.location.reload();
        }, 1000);

      } catch (error) {
        console.error(
          "Aiva update password:",
          error
        );

        setMessage(
          "Ошибка смены пароля. Попробуй ещё раз."
        );

      } finally {
        resetButton.disabled = false;
      }
    }

    forgotButton.addEventListener(
      "click",
      sendResetEmail
    );

    resetButton.addEventListener(
      "click",
      updatePassword
    );

    closeButton.addEventListener(
      "click",
      closeModal
    );

    backButton.addEventListener(
      "click",
      closeModal
    );

    modal.addEventListener(
      "click",
      (event) => {
        if (event.target === modal) {
          closeModal();
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          closeModal();
        }

        if (
          event.key === "Enter" &&
          modal.classList.contains("open") &&
          document.activeElement !== newPassword &&
          document.activeElement !== confirmPassword
        ) {
          event.preventDefault();
          updatePassword();
        }
      }
    );

    supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "PASSWORD_RECOVERY") {
          openModal();
        }
      }
    );

    setTimeout(() => {
      const hasRecoveryMarker =
        new URLSearchParams(window.location.search)
          .get("reset") === "1";

      if (hasRecoveryMarker) {
        openModal();
      }
    }, 300);
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
  }

  function createResetModal() {
    if (
      document.getElementById(
        "aiva-reset-modal"
      )
    ) {
      return;
    }

    const modal =
      document.createElement("div");

    modal.id =
      "aiva-reset-modal";

    modal.innerHTML = `
      <div class="aiva-reset-card">

        <button
          id="aiva-reset-close"
          class="aiva-reset-close"
          type="button"
          aria-label="Закрыть"
        >
          ×
        </button>

        <div class="aiva-reset-logo">
          A
        </div>

        <h2>
          Новый пароль
        </h2>

        <p class="aiva-reset-subtitle">
          Придумай новый пароль для своего аккаунта Aiva.
        </p>

        <input
          id="aiva-new-password"
          type="password"
          placeholder="Новый пароль"
          autocomplete="new-password"
          minlength="6"
        >

        <input
          id="aiva-confirm-password"
          type="password"
          placeholder="Повтори новый пароль"
          autocomplete="new-password"
          minlength="6"
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
  }

  function injectStyles() {
    if (
      document.getElementById(
        "aiva-password-reset-styles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "aiva-password-reset-styles";

    style.textContent = `
      .aiva-forgot-password {
        width: 100%;
        height: 36px;
        margin-top: 2px;
        border: 0;
        background: transparent;
        color: var(--muted, #999ca7);
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
        z-index: 10000;
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

        background:
          linear-gradient(
            180deg,
            rgba(25,26,34,.99),
            rgba(15,16,21,.99)
          );

        box-shadow:
          0 30px 90px rgba(0,0,0,.55),
          0 8px 30px rgba(0,0,0,.30);

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
        color: var(--muted, #999ca7);

        font-size: 24px;
        line-height: 1;
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

        background:
          linear-gradient(
            135deg,
            var(--accent, #7668ff),
            var(--accent2, #5c8cff)
          );

        color: #fff;
        font-size: 23px;
        font-weight: 800;

        box-shadow:
          0 12px 35px rgba(100,90,255,.28);
      }

      .aiva-reset-card h2 {
        margin: 0;
        color: var(--text, #f5f5f7);
        font-size: 24px;
        line-height: 1.2;
      }

      .aiva-reset-subtitle {
        margin: 9px 0 20px;
        color: var(--muted, #999ca7);
        font-size: 13px;
        line-height: 1.5;
      }

      .aiva-reset-card input {
        width: 100%;
        height: 48px;
        margin-top: 9px;
        padding: 0 14px;

        border: 1px solid rgba(255,255,255,.09);
        border-radius: 12px;
        outline: none;

        background: rgba(255,255,255,.035);
        color: var(--text, #f5f5f7);

        font-size: 14px;

        transition:
          border-color .15s ease,
          background .15s ease;
      }

      .aiva-reset-card input::placeholder {
        color: #696c76;
      }

      .aiva-reset-card input:focus {
        border-color: rgba(118,104,255,.48);
        background: rgba(255,255,255,.05);
      }

      .aiva-reset-submit {
        width: 100%;
        height: 49px;
        margin-top: 14px;

        border: 0;
        border-radius: 12px;

        background: var(--text, #f5f5f7);
        color: #0b0b0f;

        font-size: 14px;
        font-weight: 700;
        cursor: pointer;

        transition:
          transform .15s ease,
          opacity .15s ease;
      }

      .aiva-reset-submit:hover {
        transform: translateY(-1px);
      }

      .aiva-reset-submit:disabled {
        opacity: .55;
        cursor: wait;
        transform: none;
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
        color: var(--muted, #999ca7);

        font-size: 13px;
        cursor: pointer;
      }

      .aiva-reset-back:hover {
        color: var(--text, #f5f5f7);
      }

      @media (max-width: 520px) {
        #aiva-reset-modal {
          padding: 14px;
        }

        .aiva-reset-card {
          padding: 23px 18px 18px;
          border-radius: 19px;
        }

        .aiva-reset-logo {
          width: 48px;
          height: 48px;
          border-radius: 15px;
          font-size: 21px;
        }

        .aiva-reset-card h2 {
          font-size: 22px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      waitForApp
    );
  } else {
    waitForApp();
  }
})();
