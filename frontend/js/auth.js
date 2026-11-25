/* =========================================================
   Quiz Builder – auth.js
   Handles: student registration, login, JWT session management,
   and password recovery powered by MongoDB Atlas REST APIs.
   ========================================================= */

/* ---------- Storage keys & URL helper ---------- */
const SS_EXAM_USER = "examUser";
const SS_AUTH_TOKEN = "authToken";
const getApiUrl = (ep) => (typeof window.apiUrl === 'function' ? window.apiUrl(ep) : ep);

/* ---------- Helpers ---------- */
function showAlert(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = "alert alert-" + type + " show";
}
function hideAlert(el) {
  if (el) el.classList.remove("show");
}

/* ---------- Tab switching & Forms ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });

  /* ---------- LOGIN ---------- */
  const loginForm = document.getElementById("login-form");
  const loginAlert = document.getElementById("login-alert");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(loginAlert);

    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    if (!username || !password) {
      showAlert(loginAlert, "Please provide both username and password.", "error");
      return;
    }

    let wakeTimer = null;
    let abortCtrl = null;
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in...";
      }

      wakeTimer = setTimeout(() => {
        if (submitBtn && submitBtn.disabled) {
          submitBtn.textContent = "Logging in... (Waking up server, please wait)";
        }
      }, 3000);

      abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 60000);

      const res = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: abortCtrl.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Invalid username or password.");
      }

      // Success – store JWT session token and redirect
      if (data.token) {
        sessionStorage.setItem(SS_AUTH_TOKEN, data.token);
        localStorage.setItem(SS_AUTH_TOKEN, data.token);
      }
      sessionStorage.setItem(
        SS_EXAM_USER,
        JSON.stringify({
          id: data.user.id,
          username: data.user.username,
          fullName: data.user.fullName,
          email: data.user.email
        })
      );

      window.location.href = "exam.html";
    } catch (err) {
      if (err.name === 'AbortError') {
        showAlert(loginAlert, "Server took too long to respond. The cloud service may be waking up — please click Login again.", "error");
      } else {
        showAlert(loginAlert, err.message || "Invalid username or password.", "error");
      }
    } finally {
      if (wakeTimer) clearTimeout(wakeTimer);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Login";
      }
    }
  });

  /* ---------- REGISTER ---------- */
  const registerForm = document.getElementById("register-form");
  const registerAlert = document.getElementById("register-alert");

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(registerAlert);

    const fullName = document.getElementById("reg-fullname").value.trim();
    const username = document.getElementById("reg-username").value.trim();
    const emailInput = document.getElementById("reg-email");
    const email = emailInput ? emailInput.value.trim() : "";
    const password = document.getElementById("reg-password").value;
    const confirm = document.getElementById("reg-confirm").value;

    if (!fullName || !username || !password || !confirm) {
      showAlert(registerAlert, "Please fill in all required fields.", "error");
      return;
    }
    if (password !== confirm) {
      showAlert(registerAlert, "Passwords do not match.", "error");
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      showAlert(registerAlert, "Password must be at least 8 characters long and contain both letters and numbers.", "error");
      return;
    }

    const submitBtn = registerForm.querySelector('button[type="submit"]');

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating Account...";
      }

      const res = await fetch(getApiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, username, email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Registration failed.");
      }

      showAlert(registerAlert, "Account created successfully! You can now login.", "success");
      registerForm.reset();

      // Switch to login tab automatically after 900ms
      setTimeout(() => {
        const loginTabBtn = document.querySelector('.tab-btn[data-tab="login-tab"]');
        if (loginTabBtn) loginTabBtn.click();
        const loginUserInput = document.getElementById("login-username");
        if (loginUserInput) loginUserInput.value = username;
      }, 900);
    } catch (err) {
      showAlert(registerAlert, err.message || "Failed to create account.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
    }
  });

  /* ---------- FORGOT & RESET PASSWORD ---------- */
  const forgotLink = document.getElementById("forgot-password-link");
  const forgotModal = document.getElementById("forgot-modal");
  const closeForgotModal = document.getElementById("close-forgot-modal");
  const forgotForm = document.getElementById("forgot-form");
  const forgotAlert = document.getElementById("forgot-alert");

  if (forgotLink && forgotModal) {
    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      hideAlert(forgotAlert);
      if (forgotForm) forgotForm.reset();
      forgotModal.classList.add("show");
    });
  }

  if (closeForgotModal && forgotModal) {
    closeForgotModal.addEventListener("click", () => {
      forgotModal.classList.remove("show");
    });
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert(forgotAlert);

      const username = document.getElementById("forgot-username").value.trim();
      const email = document.getElementById("forgot-email").value.trim();
      const newPassword = document.getElementById("new-password").value;
      const confirmPassword = document.getElementById("confirm-new-password").value;
      const submitBtn = document.getElementById("reset-password-submit-btn");

      if (!username || !email) {
        showAlert(forgotAlert, "Please enter both your registered username and email.", "error");
        return;
      }

      if (!newPassword || newPassword.length < 8) {
        showAlert(forgotAlert, "New password must be at least 8 characters long.", "error");
        return;
      }

      if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        showAlert(forgotAlert, "New password must contain both letters and numbers.", "error");
        return;
      }

      if (newPassword !== confirmPassword) {
        showAlert(forgotAlert, "Passwords do not match. Please re-enter identical passwords.", "error");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Updating Password...";
        }

        const res = await fetch(getApiUrl("/api/auth/reset-password"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, newPassword, confirmPassword })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || "Failed to update password. Please verify your username and email.");
        }

        showAlert(forgotAlert, "Password updated successfully! You can now log in with your new password.", "success");
        setTimeout(() => {
          forgotModal.classList.remove("show");
          // Pre-fill username on login form
          const loginUser = document.getElementById("login-username");
          if (loginUser) loginUser.value = username;
          // Switch to login tab
          const loginTab = document.querySelector('[data-tab="login"]');
          if (loginTab) loginTab.click();
        }, 1500);
      } catch (err) {
        showAlert(forgotAlert, err.message || "Failed to update password. Please check your credentials.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Update Password";
        }
      }
    });
  }
});
