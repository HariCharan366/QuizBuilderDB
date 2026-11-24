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

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in...";
      }

      const res = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

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
      showAlert(loginAlert, err.message || "Invalid username or password.", "error");
    } finally {
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
  const resetForm = document.getElementById("reset-form");
  const forgotAlert = document.getElementById("forgot-alert");

  if (forgotLink && forgotModal) {
    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      hideAlert(forgotAlert);
      if (forgotForm) forgotForm.classList.remove("hidden");
      if (resetForm) resetForm.classList.add("hidden");
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
      const identifier = document.getElementById("forgot-identifier").value.trim();
      const submitBtn = forgotForm.querySelector('button[type="submit"]');

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Sending...";
        }

        const res = await fetch(getApiUrl("/api/auth/forgot-password"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier })
        });

        const data = await res.json();
        forgotForm.classList.add("hidden");
        if (resetForm) resetForm.classList.remove("hidden");
        showAlert(
          forgotAlert,
          data.message || "If an account exists, reset instructions have been dispatched. Enter the reset code and your new password below.",
          "success"
        );
      } catch (err) {
        showAlert(forgotAlert, "Failed to process reset request.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Send Reset Link";
        }
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert(forgotAlert);
      const resetToken = document.getElementById("reset-code").value.trim();
      const newPassword = document.getElementById("new-password").value;

      if (!resetToken || !newPassword) {
        showAlert(forgotAlert, "Please provide the reset code and your new password.", "error");
        return;
      }

      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        showAlert(forgotAlert, "New password must be at least 8 characters long and contain both letters and numbers.", "error");
        return;
      }

      try {
        const res = await fetch(getApiUrl("/api/auth/reset-password"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resetToken, newPassword })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || "Failed to reset password.");
        }

        showAlert(forgotAlert, "Password updated successfully! You can now log in.", "success");
        setTimeout(() => {
          forgotModal.classList.remove("show");
        }, 1500);
      } catch (err) {
        showAlert(forgotAlert, err.message || "Error updating password.", "error");
      }
    });
  }

  // Check URL query parameters for reset token (e.g. from email link ?token=XYZ)
  const urlParams = new URLSearchParams(window.location.search);
  const tokenParam = urlParams.get("token");
  if (tokenParam && forgotModal) {
    const resetCodeInput = document.getElementById("reset-code");
    if (resetCodeInput) resetCodeInput.value = tokenParam;
    if (forgotForm) forgotForm.classList.add("hidden");
    if (resetForm) resetForm.classList.remove("hidden");
    forgotModal.classList.add("show");
    showAlert(forgotAlert, "Reset token detected. Please enter your new password below.", "success");
  }
});
