/* =========================================================
   Quiz Builder – exam.js
   Handles: session guard, full-screen secure mode, anti-cheating
   monitoring, 2-second pacing cooldown, server session synchronization,
   countdown timer, question navigation, mark-for-review, and certified scoring.
   ========================================================= */

const SS_EXAM_USER_E = "examUser";

const MAX_WARNINGS = 3;
const EXAM_QUESTION_COUNT = 40;

let EXAM_SECONDS = 15 * 60; // Configured dynamically by MongoDB ExamSession

function getAuthToken() {
  return sessionStorage.getItem("authToken") || localStorage.getItem("authToken") || sessionStorage.getItem("token") || localStorage.getItem("token");
}

const getApiUrl = (ep) => (typeof window.apiUrl === 'function' ? window.apiUrl(ep) : ep);

function getAuthHeaders() {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {})
  };
}

/* ---------- Session guard: no valid session -> back to portal ---------- */
const rawUser = sessionStorage.getItem(SS_EXAM_USER_E);
const currentToken = getAuthToken();
if (!rawUser || !currentToken) {
  window.location.href = "index.html";
}
const currentUser = rawUser ? JSON.parse(rawUser) : { username: "guest", fullName: "Guest" };

/* ---------- State ---------- */
let activeSessionId = null;
let QUESTIONS = [];
let currentIndex = 0;
let answers = [];
let markedForReview = {};
let warningCount = 0;
let examStarted = false;
let isSubmitting = false;
let timeRemaining = EXAM_SECONDS;
let timerInterval = null;
let examStartTimestamp = null;
let lastViolationAt = 0;
let fiveMinuteWarningShown = false;
const VIOLATION_DEBOUNCE_MS = 700;

/* ---------- DOM references ---------- */
let els = {};

document.addEventListener("DOMContentLoaded", () => {
  els = {
    securityScreen: document.getElementById("security-screen"),
    examShell: document.getElementById("exam-shell"),
    startBtn: document.getElementById("start-exam-btn"),
    fsError: document.getElementById("fullscreen-error"),
    candidateName: document.getElementById("candidate-name-label"),
    warningStrip: document.getElementById("warning-strip"),
    warnCounter: document.getElementById("warn-counter"),
    timerBox: document.getElementById("timer-box"),
    qMeta: document.getElementById("q-meta"),
    qBody: document.getElementById("q-body"),
    optionsContainer: document.getElementById("options-container"),
    prevBtn: document.getElementById("prev-btn"),
    nextBtn: document.getElementById("next-btn"),
    finishBtn: document.getElementById("finish-btn"),
    reviewMarkBtn: document.getElementById("review-mark-btn"),
    qnavGrid: document.getElementById("qnav-grid"),
    submitExamBtn: document.getElementById("submit-exam-btn"),
    submitModal: document.getElementById("submit-modal"),
    cancelSubmitBtn: document.getElementById("cancel-submit-btn"),
    confirmSubmitBtn: document.getElementById("confirm-submit-btn"),
    autoSubmitModal: document.getElementById("auto-submit-modal"),
    ackAutoSubmitBtn: document.getElementById("ack-auto-submit-btn")
  };

  els.candidateName.textContent = currentUser.fullName || currentUser.username;

  els.startBtn.addEventListener("click", handleStartExam);
  els.prevBtn.addEventListener("click", () => navigateTo(currentIndex - 1));
  els.nextBtn.addEventListener("click", () => navigateTo(currentIndex + 1));
  els.finishBtn.addEventListener("click", () => openSubmitModal());
  els.submitExamBtn.addEventListener("click", () => openSubmitModal());
  els.cancelSubmitBtn.addEventListener("click", () => els.submitModal.classList.remove("show"));
  els.confirmSubmitBtn.addEventListener("click", () => {
    els.submitModal.classList.remove("show");
    finalizeExam();
  });
  els.ackAutoSubmitBtn.addEventListener("click", () => {
    els.autoSubmitModal.classList.remove("show");
    finalizeExam();
  });

  if (els.reviewMarkBtn) {
    els.reviewMarkBtn.addEventListener("click", toggleMarkForReview);
  }

  // Initialize session with backend
  initExamSession();
});

/* ---------- Session Error Handler ---------- */
function showSessionError(msg) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay show";
  modal.style.zIndex = "999999";
  modal.innerHTML = `
    <div class="modal-box danger" style="max-width:480px;">
      <div class="modal-icon">⚠️</div>
      <h3 style="color:#991b1b;">Connection Error</h3>
      <p style="margin:12px 0 20px; color:#475569; font-size:0.95rem;">${msg}</p>
      <div class="modal-actions" style="justify-content:center;">
        <button id="session-error-return-btn" class="btn btn-primary">Return to Student Portal</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("session-error-return-btn").addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

/* ---------- Initialize Backend 40-Question Session ---------- */
async function initExamSession() {
  try {
    const res = await fetch(getApiUrl("/api/exams/start-session"), {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        username: currentUser.username,
        fullName: currentUser.fullName
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showSessionError(data.message || "Unable to start examination session.");
      return;
    }

    if (data.session) {
      activeSessionId = data.session.sessionId;
      QUESTIONS = data.session.questions || [];
      answers = new Array(QUESTIONS.length).fill(null);
      markedForReview = {};

      if (data.session.remainingSeconds !== undefined) {
        timeRemaining = Math.max(0, data.session.remainingSeconds);
      }
      if (data.session.durationMinutes) {
        EXAM_SECONDS = data.session.durationMinutes * 60;
      }
      if (data.session.warnings) {
        warningCount = data.session.warnings;
        els.warnCounter.textContent = `Warnings: ${warningCount}/${MAX_WARNINGS}`;
      }

      // Restore saved answers if resuming active session
      if (data.session.savedAnswers) {
        Object.entries(data.session.savedAnswers).forEach(([qId, optIdx]) => {
          const qIdx = QUESTIONS.findIndex(q => String(q.questionId) === String(qId));
          if (qIdx !== -1) {
            answers[qIdx] = Number(optIdx);
          }
        });
      }

      // Restore marked for review state
      if (data.session.markedForReview) {
        Object.entries(data.session.markedForReview).forEach(([qId, isRev]) => {
          const qIdx = QUESTIONS.findIndex(q => String(q.questionId) === String(qId));
          if (qIdx !== -1) {
            markedForReview[qIdx] = Boolean(isRev);
          }
        });
      }

      buildQuestionNav();
      renderQuestion(0);
    }
  } catch (err) {
    console.error("Backend session initialization error:", err);
    showSessionError("Unable to establish a secure examination session with the backend database. Please verify your connection or contact your administrator.");
  }
}

/* ---------- Fullscreen helpers ---------- */
function requestFullscreenCompat() {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen API not supported"));
}
function exitFullscreenCompat() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) return document.exitFullscreen().catch(() => {});
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  }
  return Promise.resolve();
}
function isCurrentlyFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/* ---------- Start Secure Exam ---------- */
function handleStartExam() {
  els.fsError.classList.remove("show");

  requestFullscreenCompat()
    .then(() => {
      examStarted = true;
      examStartTimestamp = Date.now();
      els.securityScreen.style.display = "none";
      els.examShell.classList.add("active");
      attachSecurityListeners();
      startTimer();
      pushHistoryGuard();
    })
    .catch(() => {
      els.fsError.textContent = "Full-screen permission is required to start the secure exam.";
      els.fsError.classList.add("show");
    });
}

/* ---------- Security / Anti-cheat monitoring ---------- */
function attachSecurityListeners() {
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("contextmenu", blockEvent);
  document.addEventListener("copy", blockEvent);
  document.addEventListener("cut", blockEvent);
  document.addEventListener("paste", blockEvent);
  document.addEventListener("selectstart", blockEvent);
  document.addEventListener("dragstart", blockEvent);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", onBeforeUnload);
}

function detachSecurityListeners() {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("blur", onWindowBlur);
  document.removeEventListener("contextmenu", blockEvent);
  document.removeEventListener("copy", blockEvent);
  document.removeEventListener("cut", blockEvent);
  document.removeEventListener("paste", blockEvent);
  document.removeEventListener("selectstart", blockEvent);
  document.removeEventListener("dragstart", blockEvent);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

function blockEvent(e) {
  e.preventDefault();
  return false;
}

function onFullscreenChange() {
  if (!examStarted || isSubmitting) return;
  if (!isCurrentlyFullscreen()) {
    addViolation("Exited full-screen mode");
  }
}

function onVisibilityChange() {
  if (!examStarted || isSubmitting) return;
  if (document.hidden) {
    addViolation("Switched tab or minimized the window");
  }
}

function onWindowBlur() {
  if (!examStarted || isSubmitting) return;
  if (!document.hidden) {
    addViolation("Left the examination window");
  }
}

const BLOCKED_KEYS = ["c", "v", "x", "u", "s", "p", "a", "f", "r", "w", "t", "n"];
function onKeyDown(e) {
  if (!examStarted) return;
  const key = e.key ? e.key.toLowerCase() : "";

  if (e.key === "F12") {
    e.preventDefault();
    addViolation("Attempted to open developer tools (F12)");
    return;
  }
  if ((e.ctrlKey || e.metaKey) && BLOCKED_KEYS.includes(key)) {
    e.preventDefault();
    if (!isSubmitting) addViolation("Restricted keyboard shortcut attempt (Ctrl+" + key.toUpperCase() + ")");
  }
}

function onBeforeUnload(e) {
  if (examStarted && !isSubmitting) {
    e.preventDefault();
    e.returnValue = "";
    return "";
  }
}

function pushHistoryGuard() {
  history.pushState(null, "", window.location.href);
  window.addEventListener("popstate", onPopState);
}
function onPopState() {
  if (examStarted && !isSubmitting) {
    history.pushState(null, "", window.location.href);
    addViolation("Back navigation attempt");
  }
}

/* ---------- Violation handling ---------- */
function addViolation(reason) {
  const now = Date.now();
  if (now - lastViolationAt < VIOLATION_DEBOUNCE_MS) return;
  lastViolationAt = now;

  if (isSubmitting) return;

  warningCount++;
  els.warnCounter.textContent = "Warnings: " + warningCount + "/" + MAX_WARNINGS;

  if (activeSessionId) {
    fetch(getApiUrl("/api/exams/record-warning"), {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ sessionId: activeSessionId })
    }).catch(e => console.warn("Record warning API:", e));
  }

  if (warningCount < MAX_WARNINGS) {
    showWarningStrip("SECURITY WARNING " + warningCount + "/" + MAX_WARNINGS + " — " + reason);
  }

  if (warningCount >= MAX_WARNINGS) {
    triggerAutoSubmit();
  }
}

function showWarningStrip(message) {
  els.warningStrip.textContent = message;
  els.warningStrip.classList.add("show");
  clearTimeout(showWarningStrip._t);
  showWarningStrip._t = setTimeout(() => {
    els.warningStrip.classList.remove("show");
  }, 4000);
}

function triggerAutoSubmit() {
  if (isSubmitting) return;
  isSubmitting = true;
  clearInterval(timerInterval);
  els.autoSubmitModal.classList.add("show");
  setTimeout(() => {
    if (els.autoSubmitModal.classList.contains("show")) {
      els.autoSubmitModal.classList.remove("show");
      finalizeExam();
    }
  }, 3500);
}

/* ---------- Timer ---------- */
function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay();
    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      finalizeExam();
    }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.max(0, Math.floor(timeRemaining / 60));
  const s = Math.max(0, timeRemaining % 60);
  els.timerBox.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

  if (timeRemaining <= 300 && timeRemaining > 0) {
    els.timerBox.classList.add("warning-5min");
    if (!fiveMinuteWarningShown) {
      fiveMinuteWarningShown = true;
      showWarningStrip("⏰ 5 MINUTES REMAINING! Please finish your remaining questions and submit.");
    }
  }

  if (timeRemaining <= 60) {
    els.timerBox.classList.add("low-time");
  }
}

/* ---------- Pacing Cooldown & Toast (2-Second Gap) ---------- */
let questionOpenedTimestamp = Date.now();
let lastTrackedIndex = -1;
let cooldownInterval = null;
let toastTimeout = null;

function showPacingToast(msg) {
  let toast = document.getElementById("pacing-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "pacing-toast";
    toast.className = "pacing-toast";
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>⏳</span> <span>${msg}</span>`;
  toast.classList.add("show");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 1900);
}

function startQuestionCooldown() {
  if (cooldownInterval) clearInterval(cooldownInterval);
  questionOpenedTimestamp = Date.now();

  const isLast = currentIndex === QUESTIONS.length - 1;
  const targetBtn = isLast ? els.finishBtn : els.nextBtn;
  if (!targetBtn) return;

  targetBtn.classList.add("btn-locked");

  const updateBtn = () => {
    const elapsed = Date.now() - questionOpenedTimestamp;
    const remainingMs = 2000 - elapsed;
    if (remainingMs > 0) {
      const remainingSec = Math.ceil(remainingMs / 1000);
      targetBtn.textContent = isLast ? `Finish & Submit (${remainingSec}s) ⏳` : `Next (${remainingSec}s) ⏳`;
    } else {
      targetBtn.textContent = isLast ? "Finish & Submit Exam" : "Next →";
      targetBtn.classList.remove("btn-locked");
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  };

  updateBtn();
  cooldownInterval = setInterval(updateBtn, 200);
}

/* ---------- Mark for Review ---------- */
function toggleMarkForReview() {
  if (!QUESTIONS.length) return;
  const isReviewed = !markedForReview[currentIndex];
  markedForReview[currentIndex] = isReviewed;
  updateReviewMarkBtn();
  updateQuestionNav();

  const currentQ = QUESTIONS[currentIndex];
  if (activeSessionId && currentQ && currentQ.questionId) {
    fetch(getApiUrl("/api/exams/save-progress"), {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        sessionId: activeSessionId,
        questionId: currentQ.questionId,
        isMarkedForReview: isReviewed
      })
    }).catch(e => console.warn("Save review status error:", e));
  }
}

function updateReviewMarkBtn() {
  if (!els.reviewMarkBtn) return;
  const isRev = !!markedForReview[currentIndex];
  if (isRev) {
    els.reviewMarkBtn.textContent = "⭐ Marked for Review";
    els.reviewMarkBtn.style.background = "#fef3c7";
    els.reviewMarkBtn.style.borderColor = "#d97706";
  } else {
    els.reviewMarkBtn.textContent = "⭐ Mark for Review";
    els.reviewMarkBtn.style.background = "transparent";
    els.reviewMarkBtn.style.borderColor = "#f59e0b";
  }
}

/* ---------- Question rendering ---------- */
function renderQuestion(index) {
  if (!QUESTIONS.length) return;
  currentIndex = index;
  const q = QUESTIONS[index];
  els.qMeta.textContent = "Question " + (index + 1) + " of " + QUESTIONS.length;
  els.qBody.textContent = q.question;

  const opts = Array.isArray(q.options)
    ? q.options
    : [q.optionA, q.optionB, q.optionC, q.optionD];
  const labels = ["A", "B", "C", "D"];

  els.optionsContainer.innerHTML = opts
    .map((opt, i) => {
      const selected = answers[index] === i ? "selected" : "";
      return `
        <div class="option-choice ${selected}" data-option-index="${i}">
          <div class="radio-dot"></div>
          <span class="option-label">${labels[i]}.</span>
          <span class="option-text">${opt}</span>
        </div>
      `;
    })
    .join("");

  els.optionsContainer.querySelectorAll(".option-choice").forEach((node) => {
    node.addEventListener("click", () => {
      const i = parseInt(node.dataset.optionIndex, 10);
      answers[currentIndex] = i;
      renderQuestion(currentIndex);
      updateQuestionNav();

      // Progressive answer save to server
      if (activeSessionId && q.questionId) {
        fetch(getApiUrl("/api/exams/save-progress"), {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            sessionId: activeSessionId,
            questionId: q.questionId,
            selectedOption: i
          })
        }).catch(err => console.warn("Save answer error:", err));
      }
    });
  });

  els.prevBtn.disabled = index === 0;
  const isLast = index === QUESTIONS.length - 1;
  els.nextBtn.classList.toggle("hidden", isLast);
  els.finishBtn.classList.toggle("hidden", !isLast);

  updateReviewMarkBtn();

  // Trigger 2-second pacing countdown whenever a new question is opened
  if (lastTrackedIndex !== index) {
    lastTrackedIndex = index;
    startQuestionCooldown();
  }

  updateQuestionNav();
}

function navigateTo(index) {
  if (index < 0 || index >= QUESTIONS.length) return;

  // Enforce 2-second reading gap between different questions
  if (index !== currentIndex) {
    const elapsed = Date.now() - questionOpenedTimestamp;
    if (elapsed < 2000) {
      const waitSec = Math.ceil((2000 - elapsed) / 1000);
      showPacingToast(`Please wait ${waitSec} second${waitSec > 1 ? 's' : ''} before opening the next question.`);
      return;
    }
  }

  renderQuestion(index);
}

/* ---------- Question navigator panel ---------- */
function buildQuestionNav() {
  els.qnavGrid.innerHTML = QUESTIONS.map((_, i) => `<button class="qnav-btn" data-nav-index="${i}">${i + 1}</button>`).join("");
  els.qnavGrid.querySelectorAll(".qnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(parseInt(btn.dataset.navIndex, 10)));
  });
}
function updateQuestionNav() {
  els.qnavGrid.querySelectorAll(".qnav-btn").forEach((btn, i) => {
    btn.classList.toggle("current", i === currentIndex);
    const isAns = answers[i] !== null && answers[i] !== undefined;
    const isRev = !!markedForReview[i];
    btn.classList.toggle("answered", isAns && i !== currentIndex);
    btn.classList.toggle("review", isRev && i !== currentIndex);
  });
}

/* ---------- Submit flow ---------- */
function openSubmitModal() {
  els.submitModal.classList.add("show");
}

function formatDuration(totalSeconds) {
  const s = totalSeconds || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
}

let hasFinalized = false;
function finalizeExam() {
  if (isSubmitting) return;
  isSubmitting = true;
  clearInterval(timerInterval);
  detachSecurityListeners();

  const elapsedFromClock = examStartTimestamp ? Math.round((Date.now() - examStartTimestamp) / 1000) : EXAM_SECONDS - timeRemaining;
  const timeTakenSeconds = Math.min(EXAM_SECONDS, Math.max(0, elapsedFromClock));

  // Build answer mapping questionId -> selectedOption
  const answerMap = {};
  QUESTIONS.forEach((q, idx) => {
    if (q.questionId && answers[idx] !== null && answers[idx] !== undefined) {
      answerMap[q.questionId] = answers[idx];
    }
  });

  const payload = {
    sessionId: activeSessionId,
    answers: answerMap,
    warnings: warningCount,
    timeTakenSeconds: timeTakenSeconds,
    studentName: currentUser.fullName || currentUser.username,
    username: currentUser.username
  };

  fetch(getApiUrl("/api/results"), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  })
    .then(async (res) => {
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    })
    .then(({ ok, data }) => {
      if (!ok || !data.success || !data.result) {
        throw new Error(data.message || "Failed to record examination result.");
      }
      hasFinalized = true;
      sessionStorage.removeItem(SS_EXAM_USER_E);
      exitFullscreenCompat().finally(() => {
        window.location.href = `result.html?id=${data.result.id}`;
      });
    })
    .catch((err) => {
      console.error("Submission error:", err);
      isSubmitting = false;

      const errModal = document.getElementById("submit-error-modal");
      const errMsg = document.getElementById("submit-error-msg");
      const retryBtn = document.getElementById("retry-submit-btn");

      if (errModal) {
        if (errMsg) errMsg.textContent = err.message || "Could not submit your exam to the server. Your answers are saved securely. Please retry.";
        errModal.classList.add("show");

        if (retryBtn) {
          retryBtn.onclick = () => {
            errModal.classList.remove("show");
            finalizeExam();
          };
        }
      } else {
        alert(err.message || "Submission failed. Please click Submit again.");
      }
    });
}
