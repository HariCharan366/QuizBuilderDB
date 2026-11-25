/* =========================================================
   Quiz Builder – admin.js
   Centralized Admin Dashboard with Real-Time Multi-Device Activity,
   MongoDB Persistence, Dynamic Statistics, 10s Auto-Sync, and
   Strict Password Authentication On Every Session.
   ========================================================= */

const SS_ADMIN = "adminSession";
const SS_ADMIN_TOKEN = "adminAuthToken";
const getApiUrl = (ep) => (typeof window.apiUrl === "function" ? window.apiUrl(ep) : ep);

function getAdminToken() {
  return sessionStorage.getItem(SS_ADMIN_TOKEN) || localStorage.getItem(SS_ADMIN_TOKEN) || "";
}

function formatDuration(totalSeconds) {
  const s = totalSeconds || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
}
function formatDateTimeA(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

const OPTION_LABELS = ["A", "B", "C", "D"];
const OPTION_LABELS_R = ["A", "B", "C", "D"];
let pendingDeleteIndex = null;
let pendingDeleteStudentId = null;
let autoRefreshTimer = null;
let currentActivityList = [];
let currentStudentsList = [];

document.addEventListener("DOMContentLoaded", () => {
  /* ---------- Global 401 Auth Interceptor ---------- */
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (!url.includes('/login')) {
        const cloned = response.clone();
        const json = await cloned.json().catch(() => ({}));
        if (!json.requirePassword && getAdminToken()) {
          console.warn('Admin JWT expired or invalid (401)');
          sessionStorage.removeItem(SS_ADMIN_TOKEN);
          localStorage.removeItem(SS_ADMIN_TOKEN);
          sessionStorage.removeItem(SS_ADMIN);
          localStorage.removeItem(SS_ADMIN);
          alert('Administrative session has expired. Please sign in again.');
          showLogin();
        }
      }
    }
    return response;
  };

  /* ---------- Backend Connection Alert Helpers ---------- */
  function showConnectionError(msg) {
    const errBanner = document.getElementById("admin-connection-error");
    if (errBanner) {
      errBanner.textContent = msg || "?? Backend connection unavailable. Database statistics and activity could not be loaded.";
      errBanner.classList.remove("hidden");
    }
  }

  function hideConnectionError() {
    const errBanner = document.getElementById("admin-connection-error");
    if (errBanner) {
      errBanner.classList.add("hidden");
    }
  }

  const loginView = document.getElementById("admin-login-view");
  const dashboardView = document.getElementById("admin-dashboard-view");
  const logoutBtn = document.getElementById("admin-logout-btn");
  const adminForm = document.getElementById("admin-login-form");
  const adminAlert = document.getElementById("admin-login-alert");

  /* =========================================================
     STRICT AUTHENTICATION: Require Password on Every Page Load/Refresh
     ========================================================= */
  function showLogin() {
    loginView.classList.remove("hidden");
    dashboardView.classList.remove("active");
    logoutBtn.classList.add("hidden");
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  async function showDashboard() {
    loginView.classList.add("hidden");
    dashboardView.classList.add("active");
    logoutBtn.classList.remove("hidden");

    // Load fresh data directly from MongoDB Atlas backend
    await loadAdminStats();
    await loadExamActivity();
    await loadStudentsFromBackend();
    await loadQuestionsFromBackend();

    try { loadExamSettings(); } catch (e) { console.error(e); }
    try { renderQuestions(); } catch (e) { console.error(e); }
    try { renderLeaderboard(); } catch (e) { console.error(e); }
    try { loadAnalytics(); } catch (e) { console.error(e); }
    try { loadAuditLogs(); } catch (e) { console.error(e); }

    // Start 10-second automatic polling for centralized multi-device activity
    startAutoRefresh();
  }

  // Restore existing session across page reloads (do not log out on refresh)
  const existingToken = getAdminToken();
  const existingAdminFlag = sessionStorage.getItem(SS_ADMIN) || localStorage.getItem(SS_ADMIN);
  if (existingToken && existingAdminFlag === "true") {
    showDashboard();
  } else {
    showLogin();
  }

  /* ---------- Admin Login Form Submission ---------- */
  adminForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    adminAlert.classList.remove("show");

    const id = document.getElementById("admin-id").value.trim();
    const pass = document.getElementById("admin-password").value;
    const submitBtn = adminForm.querySelector('button[type="submit"]');

    if (!id || !pass) {
      adminAlert.textContent = "Please provide Admin ID and Password.";
      adminAlert.className = "alert alert-error show";
      return;
    }

    let wakeTimer = null;
    let abortCtrl = null;
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Authenticating...";
      }

      wakeTimer = setTimeout(() => {
        if (submitBtn && submitBtn.disabled) {
          submitBtn.textContent = "Authenticating... (Waking up server, please wait)";
        }
      }, 3000);

      abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 60000);

      const res = await fetch(getApiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: pass }),
        signal: abortCtrl.signal
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Invalid Admin ID or Password.");
      }

      if (data.token) {
        sessionStorage.setItem(SS_ADMIN_TOKEN, data.token);
        localStorage.setItem(SS_ADMIN_TOKEN, data.token);
      }
      sessionStorage.setItem(SS_ADMIN, "true");
      localStorage.setItem(SS_ADMIN, "true");
      adminForm.reset();
      showDashboard();
    } catch (err) {
      if (err.name === 'AbortError') {
        adminAlert.textContent = "Server took too long to respond. The cloud service may be waking up — please click Login to Dashboard again.";
      } else {
        adminAlert.textContent = err.message || "Invalid Admin ID or Password.";
      }
      adminAlert.className = "alert alert-error show";
    } finally {
      if (wakeTimer) clearTimeout(wakeTimer);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Login to Dashboard";
      }
    }
  });

  /* ---------- Logout ---------- */
  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(SS_ADMIN);
    localStorage.removeItem(SS_ADMIN);
    sessionStorage.removeItem(SS_ADMIN_TOKEN);
    localStorage.removeItem(SS_ADMIN_TOKEN);
    showLogin();
  });

  /* =========================================================
     DYNAMIC ADMIN DASHBOARD STATS (From MongoDB Atlas)
     ========================================================= */
  async function loadAdminStats() {
    try {
      const token = getAdminToken();
      const res = await fetch(getApiUrl("/api/admin/stats"), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const data = await res.json();
        const s = data.stats || data;

        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.textContent = val;
        };

        setVal("stat-total-students", s.totalStudents !== undefined ? s.totalStudents : 0);
        setVal("stat-total-exams", s.totalExams !== undefined ? s.totalExams : 1);
        setVal("stat-exams-started", s.totalExamsStarted !== undefined ? s.totalExamsStarted : (s.totalAttempts || 0));
        setVal("stat-exams-submitted", s.totalExamsSubmitted !== undefined ? s.totalExamsSubmitted : (s.completedExams || 0));
        setVal("stat-active-exams", s.currentlyActiveExams !== undefined ? s.currentlyActiveExams : 0);
        setVal("stat-avg-score", (s.averageScore !== undefined ? s.averageScore : (s.avgPercentage || 0)) + "%");
        setVal("stat-total-questions", s.totalQuestions !== undefined ? s.totalQuestions : 0);
        setVal("stat-pass-count", s.passedAttempts !== undefined ? s.passedAttempts : 0);
        setVal("stat-fail-count", s.failedAttempts !== undefined ? s.failedAttempts : 0);
        setVal("stat-total-attempts", s.totalAttempts !== undefined ? s.totalAttempts : 0);

        const summaryLine = document.getElementById("results-summary-line");
        if (summaryLine && s.totalAttempts !== undefined) {
          summaryLine.textContent = `${s.totalAttempts} total exam attempt(s) recorded across all devices ? Average score: ${s.avgPercentage || 0}%`;
        }
        hideConnectionError();
        return;
      } else {
        throw new Error("HTTP " + res.status);
      }
    } catch (err) {
      console.warn("Stats API error; database unreachable:", err);
      showConnectionError("?? Unable to connect to backend server. Live database statistics could not be loaded.");
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setVal("stat-total-students", "?");
      setVal("stat-total-exams", "?");
      setVal("stat-exams-started", "?");
      setVal("stat-exams-submitted", "?");
      setVal("stat-active-exams", "?");
      setVal("stat-avg-score", "?");
      setVal("stat-total-questions", "?");
      setVal("stat-pass-count", "?");
      setVal("stat-fail-count", "?");
    }
  }

  /* =========================================================
     CENTRALIZED STUDENT-WISE EXAM ACTIVITY (Real-Time from All Devices)
     ========================================================= */
  async function loadExamActivity() {
    try {
      const token = getAdminToken();
      const searchInput = document.getElementById("activity-search-input");
      const statusSelect = document.getElementById("activity-status-filter");

      const searchTerm = searchInput ? searchInput.value.trim() : "";
      const statusFilter = statusSelect ? statusSelect.value : "all";

      const queryParams = new URLSearchParams();
      if (searchTerm) queryParams.set("search", searchTerm);
      if (statusFilter && statusFilter !== "all") queryParams.set("status", statusFilter);

      const res = await fetch(getApiUrl(`/api/admin/exam-activity?${queryParams.toString()}`), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.activity)) {
          currentActivityList = data.activity;
          renderExamActivity(data.activity);
          hideConnectionError();
          return;
        }
      }
      throw new Error("Exam activity fetch error");
    } catch (err) {
      console.warn("Exam activity fetch error:", err);
      showConnectionError("?? Unable to retrieve live examination activity from MongoDB Atlas.");
      const list = document.getElementById("results-list");
      if (list) {
        list.innerHTML = '<div class="empty-state" style="color:var(--danger); padding:24px;">?? Connection Error: Unable to fetch exam activity from backend database.</div>';
      }
    }
  }

  /* =========================================================
     CANDIDATE DETAILED ANSWERS MODAL (Non-Disruptive Full View)
     ========================================================= */
  let currentCamRecord = null;
  let currentCamFilter = 'all';
  let currentCamSearch = '';
  const expandedActivityRows = new Set();

  function openCandidateAnswersModal(record) {
    if (!record) return;
    currentCamRecord = record;
    currentCamFilter = 'all';
    currentCamSearch = '';

    const modal = document.getElementById("candidate-answers-modal");
    const nameEl = document.getElementById("cam-candidate-name");
    const metaEl = document.getElementById("cam-meta-info");
    const searchInput = document.getElementById("cam-search-input");
    if (searchInput) searchInput.value = "";

    const candidateName = record.studentName || record.name || "Candidate";
    const username = record.username || "?";
    const examName = record.examName || record.examTitle || "Programming Fundamentals Examination";
    const dateFormatted = formatDateTimeA(record.dateTime || record.submittedAt);
    const duration = record.timeTaken || '0:00';
    const warnings = record.warnings || 0;

    if (nameEl) nameEl.textContent = `📝 ${candidateName} — Candidate Answer Sheet`;
    if (metaEl) {
      metaEl.textContent = `@${username} • ${examName} • Date: ${dateFormatted} • Duration: ${duration} • Warnings: ${warnings}/3`;
    }

    renderCamModalBody();
    if (modal) modal.classList.add("show");
  }

  function renderCamModalBody() {
    if (!currentCamRecord) return;
    const record = currentCamRecord;
    const answers = Array.isArray(record.answers) ? record.answers : [];
    const totalQ = record.totalQuestions || record.total || answers.length || 40;

    let answeredCount = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    answers.forEach(a => {
      const hasSel = a.selectedIndex !== null && a.selectedIndex !== undefined && a.selectedIndex !== '';
      if (hasSel) {
        answeredCount++;
        const selIdx = Number(a.selectedIndex);
        const corrIdx = a.correctIndex !== null && a.correctIndex !== undefined ? Number(a.correctIndex) : null;
        if (a.isCorrect === true || (corrIdx !== null && selIdx === corrIdx)) {
          correctCount++;
        } else {
          wrongCount++;
        }
      } else {
        unansweredCount++;
      }
    });

    if (record.rawScore !== null && record.rawScore !== undefined && typeof record.rawScore === 'number') {
      correctCount = record.rawScore;
    } else if (record.correct !== undefined && typeof record.correct === 'number') {
      correctCount = record.correct;
    }
    if (record.wrong !== undefined && typeof record.wrong === 'number') {
      wrongCount = record.wrong;
    }
    if (record.unanswered !== undefined && typeof record.unanswered === 'number') {
      unansweredCount = record.unanswered;
    }

    // Stats bar
    const statsBar = document.getElementById("cam-stats-bar");
    if (statsBar) {
      const isSession = record.isSession === true || record.isActive === true || record.status === 'In Progress';
      const statusBadge = isSession
        ? '<span style="background:#dbeafe; color:#1e40af; padding:3px 10px; border-radius:12px; font-weight:bold;">In Progress ⏳</span>'
        : record.percentage !== null && record.percentage !== undefined
          ? `<strong style="color:${record.percentage >= 50 ? '#166534' : '#991b1b'};">Score: ${record.score || (correctCount + '/' + totalQ)} (${record.percentage}%)</strong>`
          : `<strong>Score: ${record.score || (correctCount + '/' + totalQ)}</strong>`;

      statsBar.innerHTML = `
        <div style="margin-right:8px;">${statusBadge}</div>
        <span style="color:var(--gray-300);">|</span>
        <span style="font-weight:600; color:#2563eb;">Attempted: ${answeredCount}/${totalQ}</span>
        <span style="color:var(--gray-300);">|</span>
        <span style="font-weight:600; color:#166534;">✓ Correct: ${correctCount}</span>
        <span style="color:var(--gray-300);">|</span>
        <span style="font-weight:600; color:#991b1b;">✗ Incorrect: ${wrongCount}</span>
        <span style="color:var(--gray-300);">|</span>
        <span style="color:var(--gray-600);">⏳ Unanswered: ${unansweredCount}</span>
      `;
    }

    // Filter tabs
    const filterTabs = document.getElementById("cam-filter-tabs");
    if (filterTabs) {
      const filters = [
        { id: 'all', label: `All Questions (${answers.length})` },
        { id: 'answered', label: `Answered Only (${answeredCount})` },
        { id: 'correct', label: `✓ Correct (${correctCount})` },
        { id: 'wrong', label: `✗ Incorrect (${wrongCount})` },
        { id: 'unanswered', label: `Unanswered (${unansweredCount})` }
      ];

      filterTabs.innerHTML = filters.map(f => {
        const isActive = currentCamFilter === f.id;
        const activeStyle = isActive
          ? 'background:var(--primary); color:white; border-color:var(--primary); font-weight:600;'
          : 'background:white; color:var(--gray-700); border-color:var(--gray-300);';
        return `<button class="btn btn-sm cam-filter-btn" data-cam-filter="${f.id}" style="padding:4px 10px; font-size:0.8rem; border:1px solid; border-radius:6px; cursor:pointer; ${activeStyle}">${f.label}</button>`;
      }).join("");

      filterTabs.querySelectorAll(".cam-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          currentCamFilter = btn.dataset.camFilter;
          renderCamModalBody();
        });
      });
    }

    // Filter questions
    const container = document.getElementById("cam-questions-container");
    const footerCount = document.getElementById("cam-footer-count");
    if (!container) return;

    if (answers.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:24px;">No answer details recorded for this candidate attempt.</div>';
      if (footerCount) footerCount.textContent = '0 questions';
      return;
    }

    const searchLower = (currentCamSearch || "").toLowerCase().trim();

    const filtered = answers.map((a, origIdx) => ({ a, origIdx })).filter(({ a }) => {
      const hasSel = a.selectedIndex !== null && a.selectedIndex !== undefined && a.selectedIndex !== '';
      const selIdx = hasSel ? Number(a.selectedIndex) : null;
      const corrIdx = a.correctIndex !== null && a.correctIndex !== undefined ? Number(a.correctIndex) : null;
      const isCorr = a.isCorrect === true || (hasSel && corrIdx !== null && selIdx === corrIdx);

      if (currentCamFilter === 'answered' && !hasSel) return false;
      if (currentCamFilter === 'correct' && (!hasSel || !isCorr)) return false;
      if (currentCamFilter === 'wrong' && (!hasSel || isCorr)) return false;
      if (currentCamFilter === 'unanswered' && hasSel) return false;

      if (searchLower) {
        const qMatch = (a.question || "").toLowerCase().includes(searchLower);
        const optMatch = Array.isArray(a.options) && a.options.some(opt => (opt || "").toLowerCase().includes(searchLower));
        if (!qMatch && !optMatch) return false;
      }
      return true;
    });

    if (footerCount) {
      footerCount.textContent = `Showing ${filtered.length} of ${answers.length} questions` + (currentCamFilter !== 'all' ? ` (Filter: ${currentCamFilter})` : '');
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;">No questions found matching current filter (${currentCamFilter}) or search.</div>`;
      return;
    }

    const cardsHtml = filtered.map(({ a, origIdx }) => {
      const hasSel = a.selectedIndex !== null && a.selectedIndex !== undefined && a.selectedIndex !== '';
      const selIdx = hasSel ? Number(a.selectedIndex) : null;
      const corrIdx = a.correctIndex !== null && a.correctIndex !== undefined ? Number(a.correctIndex) : null;
      const isCorr = a.isCorrect === true || (hasSel && corrIdx !== null && selIdx === corrIdx);

      const statusLabel = !hasSel
        ? '<span style="background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">Not Answered</span>'
        : isCorr
          ? '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">✓ Correct</span>'
          : '<span style="background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">✗ Incorrect</span>';

      const borderCol = !hasSel ? '#cbd5e1' : isCorr ? '#22c55e' : '#ef4444';

      const optsHtml = Array.isArray(a.options)
        ? a.options.map((opt, oi) => {
          const isStudentChoice = selIdx !== null && oi === selIdx;
          const isCorrectChoice = corrIdx !== null && oi === corrIdx;

          let optStyle = 'padding:8px 12px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; border:1px solid #e2e8f0; background:white;';
          let tag = '';

          if (isStudentChoice && isCorrectChoice) {
            optStyle = 'padding:8px 12px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; border:2px solid #22c55e; background:#f0fdf4; font-weight:600;';
            tag = '<span style="margin-left:8px; color:#166534; font-size:0.75rem; background:#dcfce7; padding:2px 6px; border-radius:4px;">✓ Candidate\'s Choice (Correct)</span>';
          } else if (isStudentChoice && !isCorrectChoice) {
            optStyle = 'padding:8px 12px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; border:2px solid #ef4444; background:#fef2f2; font-weight:600;';
            tag = '<span style="margin-left:8px; color:#991b1b; font-size:0.75rem; background:#fee2e2; padding:2px 6px; border-radius:4px;">✗ Candidate\'s Choice (Wrong)</span>';
          } else if (isCorrectChoice) {
            optStyle = 'padding:8px 12px; border-radius:6px; margin-bottom:6px; font-size:0.85rem; border:1px solid #86efac; background:#f0fdf4;';
            tag = '<span style="margin-left:8px; color:#166534; font-size:0.75rem; background:#dcfce7; padding:2px 6px; border-radius:4px;">✓ Correct Answer</span>';
          }

          return `<li style="${optStyle} list-style:none;"><strong>${OPTION_LABELS_R[oi] || oi}.</strong> ${escapeHtml(opt || "")}${tag}</li>`;
        }).join("")
        : '';

      const qNum = (a.index !== null && a.index !== undefined) ? a.index : (origIdx + 1);

      return `
        <div style="border:1px solid ${borderCol}; border-left:4px solid ${borderCol}; border-radius:8px; padding:14px; margin-bottom:12px; background:white;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <span style="font-weight:700; font-size:0.9rem; color:#1e293b;">Question ${qNum} of ${totalQ}</span>
            <div>${statusLabel}</div>
          </div>
          <div style="font-size:0.92rem; color:#0f172a; margin-bottom:10px; font-weight:500;">
            ${escapeHtml(a.question || "")}
          </div>
          <ul style="padding:0; margin:0;">${optsHtml}</ul>
        </div>
      `;
    }).join("");

    container.innerHTML = cardsHtml;
  }

  function renderDetailedAnswers(answers) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return '<div class="empty-state" style="padding:10px;">No answer details recorded for this attempt.</div>';
    }

    return answers.map((a, i) => {
      const hasSel = a.selectedIndex !== null && a.selectedIndex !== undefined && a.selectedIndex !== '';
      const selIdx = hasSel ? Number(a.selectedIndex) : null;
      const corrIdx = a.correctIndex !== null && a.correctIndex !== undefined ? Number(a.correctIndex) : null;
      const isCorr = a.isCorrect === true || (hasSel && corrIdx !== null && selIdx === corrIdx);

      const statusClass = !hasSel ? "unanswered" : isCorr ? "correct" : "incorrect";
      const statusLabel = !hasSel ? "Not Answered" : isCorr ? "✓ Correct" : "✗ Incorrect";

      const optsHtml = Array.isArray(a.options)
        ? a.options.map((opt, oi) => {
          const isCorrectAns = oi === corrIdx;
          const isSelected = oi === selIdx;
          let cls = "";
          let tag = "";
          if (isCorrectAns) {
            cls += " is-correct-answer";
            tag += " ✓ Correct Answer";
          }
          if (isSelected && !isCorrectAns) {
            cls += " is-wrong-selected";
            tag += " ✗ Student's Answer";
          } else if (isSelected && isCorrectAns) {
            tag += " (Student's Answer)";
          }
          return `<li class="${cls.trim()}">${OPTION_LABELS_R[oi] || oi}. ${escapeHtml(opt || "")}${tag ? " —" + tag : ""}</li>`;
        }).join("")
        : "";

      const qNum = (a.index !== null && a.index !== undefined) ? a.index : (i + 1);

      return `
        <div class="review-item ${statusClass}" style="margin-bottom:12px; background:white;">
          <div class="q-top">
            <div>
              <span class="q-number" style="font-weight:700; color:var(--navy-800, #1e293b); font-size:0.88rem; background:transparent !important; padding:0;">Question ${qNum}</span>
              <div class="q-text">${escapeHtml(a.question || "")}</div>
            </div>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
          </div>
          <ul class="option-list review-option-list">${optsHtml}</ul>
        </div>
      `;
    }).join("");
  }

  function renderExamActivity(activityList) {
    const list = document.getElementById("results-list");
    const countBadge = document.getElementById("results-count-badge");
    if (!list) return;

    const items = activityList || currentActivityList;
    if (countBadge) countBadge.textContent = items.length + (items.length === 1 ? " record" : " records");

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state">No examination activity matching your search or filter.</div>';
      return;
    }

    const rows = items.map((item, idx) => {
      const isPassed = item.submissionStatus === "Passed" || item.status === "Passed";
      const isActive = item.submissionStatus === "Active" || item.isSession === true;
      const statusBadge = isActive
        ? '<span style="background:#dbeafe; color:#1e40af; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:bold;">⏳ In Progress</span>'
        : isPassed
          ? '<span style="background:#dcfce7; color:#166534; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:bold;">✓ Passed</span>'
          : '<span style="background:#fee2e2; color:#991b1b; padding:3px 10px; border-radius:12px; font-size:0.75rem; font-weight:bold;">✗ Failed</span>';

      const hasAnswers = Array.isArray(item.answers) && item.answers.length > 0;
      const detailsBtn = hasAnswers
        ? `<button class="btn btn-primary btn-sm" data-view-cam="${idx}" style="font-size:0.8rem; padding:4px 10px; font-weight:600;">View Answers</button>`
        : '<span style="font-size:0.8rem; color:var(--gray-600);">—</span>';

      const totalQ = item.totalQuestions || 40;
      const attemptedCount = (item.correct !== undefined && item.wrong !== undefined)
        ? (item.correct + item.wrong)
        : (item.questionsAnswered !== undefined ? item.questionsAnswered : 0);
      const unansCount = item.unanswered !== undefined ? item.unanswered : Math.max(0, totalQ - attemptedCount);

      const answeredInfo = isActive
        ? `<br><small style="color:#2563eb; font-weight:600;">⏳ ${attemptedCount}/${totalQ} questions answered</small>`
        : `<br><small style="color:#2563eb; font-weight:600;">📝 Attempted: ${attemptedCount}/${totalQ}</small><br><small style="color:var(--gray-600);">${item.correct || 0} correct • ${item.wrong || 0} wrong • ${unansCount} unanswered</small>`;

      const timingInfo = isActive
        ? `<small>${formatDateTimeA(item.dateTime)}</small><br><small style="color:#b45309; font-weight:600;">⏳ Rem: ${escapeHtml(item.timeRemaining || '0:00')}</small>`
        : `<small>${formatDateTimeA(item.dateTime)}</small><br><small style="color:var(--gray-600);">⏱ Took: ${escapeHtml(item.timeTaken || '0:00')}</small>`;

      const warningBadge = item.warnings > 0 ? `<br><small style="color:#b91c1c; font-weight:bold;">⚠️ ${item.warnings}/3 warnings</small>` : '';

      const isExpanded = expandedActivityRows.has(String(idx));
      const rowHiddenClass = isExpanded ? "" : "hidden";
      const inlineToggleBtn = hasAnswers
        ? `<button class="btn btn-ghost btn-sm" data-toggle-activity="${idx}" style="font-size:0.75rem; padding:2px 6px; margin-left:4px;">${isExpanded ? 'Collapse' : 'Inline'}</button>`
        : '';

      const attemptBadge = `<br><small style="color:var(--gray-600); font-size:0.75rem;">Attempt #${item.attemptNumber || 1}</small>`;

      return `
        <tr>
          <td style="color:var(--gray-600);">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(item.studentName || "Unknown")}</strong><br>
            <small style="color:var(--gray-600);">@${escapeHtml(item.username || "—")}</small>
          </td>
          <td>${escapeHtml(item.email || "—")}</td>
          <td>
            <strong>${escapeHtml(item.examName || "Programming Fundamentals")}</strong>
            ${attemptBadge}
          </td>
          <td><strong>${escapeHtml(item.score || "—")}</strong>${answeredInfo}</td>
          <td>${statusBadge}${warningBadge}</td>
          <td>${timingInfo}</td>
          <td style="text-align:right; white-space:nowrap;">${detailsBtn}${inlineToggleBtn}</td>
        </tr>
        <tr id="activity-detail-row-${idx}" class="${rowHiddenClass}" style="background:#f8fafc;">
          <td colspan="8" style="padding:16px;">
            <div id="activity-detail-${idx}">
              ${hasAnswers ? renderDetailedAnswers(item.answers) : ''}
            </div>
          </td>
        </tr>
      `;
    }).join("");

    list.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="student-table" style="width:100%;">
          <thead>
            <tr>
              <th>#</th>
              <th>Student Name</th>
              <th>Email</th>
              <th>Exam Name</th>
              <th>Score</th>
              <th>Status</th>
              <th>Date & Time</th>
              <th style="text-align:right;">Answers</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // Attach answer modal listeners
    list.querySelectorAll("[data-view-cam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.viewCam, 10);
        const item = items[i];
        if (item) openCandidateAnswersModal(item);
      });
    });

    // Attach inline answer toggle listeners
    list.querySelectorAll("[data-toggle-activity]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = btn.dataset.toggleActivity;
        const detailRow = document.getElementById("activity-detail-row-" + i);
        if (detailRow) {
          const isHidden = detailRow.classList.toggle("hidden");
          btn.textContent = isHidden ? "Inline" : "Collapse";
          if (isHidden) {
            expandedActivityRows.delete(String(i));
          } else {
            expandedActivityRows.add(String(i));
          }
        }
      });
    });
  }

  /* ---------- Search & Filter Event Handlers for Activity Table ---------- */
  const activitySearchInput = document.getElementById("activity-search-input");
  if (activitySearchInput) {
    let actDebounce = null;
    activitySearchInput.addEventListener("input", () => {
      clearTimeout(actDebounce);
      actDebounce = setTimeout(loadExamActivity, 250);
    });
  }

  const activityStatusFilter = document.getElementById("activity-status-filter");
  if (activityStatusFilter) {
    activityStatusFilter.addEventListener("change", loadExamActivity);
  }

  const manualRefreshBtn = document.getElementById("manual-refresh-btn");
  if (manualRefreshBtn) {
    manualRefreshBtn.addEventListener("click", async () => {
      manualRefreshBtn.disabled = true;
      manualRefreshBtn.textContent = "Syncing...";
      await Promise.all([loadAdminStats(), loadExamActivity(), loadStudentsFromBackend()]);
      manualRefreshBtn.textContent = "🔄 Refresh";
      manualRefreshBtn.disabled = false;
    });
  }

  const refreshActivityBtn = document.getElementById("refresh-activity-btn");
  if (refreshActivityBtn) {
    refreshActivityBtn.addEventListener("click", async () => {
      const icon = document.getElementById("refresh-activity-icon");
      if (icon) icon.style.transform = "rotate(360deg)";
      refreshActivityBtn.disabled = true;
      await Promise.all([loadAdminStats(), loadExamActivity(), loadStudentsFromBackend()]);
      setTimeout(() => {
        if (icon) icon.style.transform = "rotate(0deg)";
        refreshActivityBtn.disabled = false;
      }, 400);
    });
  }

  /* =========================================================
     AUTOMATIC BACKGROUND REFRESH (Every 3 Seconds)
     ========================================================= */
  function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(async () => {
      const token = getAdminToken();
      if (!token) {
        clearInterval(autoRefreshTimer);
        return;
      }
      await loadAdminStats();
      await loadExamActivity();
      await loadStudentsFromBackend();
    }, 3000);
  }

  /* =========================================================
     REGISTERED STUDENTS (Search, Block/Unblock, Delete)
     ========================================================= */
  async function loadStudentsFromBackend(searchTerm = "") {
    try {
      const token = getAdminToken();
      const url = "/api/admin/students" + (searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : "");
      const res = await fetch(getApiUrl(url), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.students)) {
          currentStudentsList = data.students;
          renderStudents(data.students);
          return data.students;
        }
      }
      throw new Error("Student fetch error");
    } catch (err) {
      console.warn("Backend students not reachable:", err);
      const list = document.getElementById("students-list");
      if (list) {
        list.innerHTML = '<div class="empty-state" style="color:var(--danger); padding:24px;">⚠️ Connection Error: Unable to fetch registered students from backend database.</div>';
      }
    }
    return [];
  }

  function renderStudents(customList) {
    const students = customList || currentStudentsList || [];
    const list = document.getElementById("students-list");
    const countBadge = document.getElementById("students-count-badge");
    if (!list) return;

    if (countBadge) {
      countBadge.textContent = students.length + (students.length === 1 ? " student" : " students");
    }

    if (students.length === 0) {
      list.innerHTML = '<div class="empty-state">No registered students found matching your search.</div>';
      return;
    }

    const rows = students.map((s) => {
      const isBlocked = !!s.isBlocked;
      const statusBadge = isBlocked
        ? '<span style="background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">Blocked</span>'
        : '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">Active</span>';
      const toggleActionText = isBlocked ? "Unblock" : "Block";
      const toggleBtnClass = isBlocked ? "btn-outline" : "btn-ghost";

      const attemptsUsed = s.totalAttempts || 0;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(s.fullName || "?")}</strong><br>
            <small style="color:var(--gray-600);">@${escapeHtml(s.username || "?")}</small>
          </td>
          <td>${escapeHtml(s.email || "?")}</td>
          <td><small>${formatDateTimeA(s.createdAt)}</small></td>
          <td style="text-align:center;"><strong>${attemptsUsed}</strong></td>
          <td style="text-align:center;"><strong>${s.completedExams || 0}</strong></td>
          <td>${statusBadge}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn btn-sm btn-ghost view-history-btn" data-student-id="${s._id || s.username}" data-student-name="${escapeHtml(s.fullName || s.username)}" data-student-username="${escapeHtml(s.username || '')}">📜 History</button>
            <button class="btn btn-sm ${toggleBtnClass} toggle-block-btn" data-student-id="${s._id || s.username}">${toggleActionText}</button>
            <button class="btn btn-sm btn-danger delete-student-btn" data-student-id="${s._id || s.username}" data-student-name="${escapeHtml(s.fullName || s.username)}">Delete</button>
          </td>
        </tr>`;
    }).join("");

    list.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="student-table" style="width:100%;">
          <thead>
            <tr>
              <th>Student Name</th>
              <th>Email</th>
              <th>Registered</th>
              <th style="text-align:center;">Total Attempts</th>
              <th style="text-align:center;">Completed</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // History Modal Listeners
    list.querySelectorAll(".view-history-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const studentId = btn.dataset.studentId;
        const name = btn.dataset.studentName;
        const username = btn.dataset.studentUsername;
        const token = getAdminToken();

        const modal = document.getElementById("student-history-modal");
        const nameEl = document.getElementById("sh-student-name");
        const metaEl = document.getElementById("sh-student-meta");
        const contentEl = document.getElementById("sh-history-content");

        if (nameEl) nameEl.textContent = `${name}'s Exam History`;
        if (metaEl) metaEl.textContent = `@${username} ? Student ID: ${studentId}`;
        if (contentEl) contentEl.innerHTML = '<div class="empty-state">Loading examination history...</div>';
        if (modal) modal.classList.add("show");

        try {
          const res = await fetch(getApiUrl(`/api/admin/students/${studentId}`), {
            headers: token ? { "Authorization": `Bearer ${token}` } : {}
          });
          const data = await res.json();
          if (res.ok && data.examHistory) {
            if (data.examHistory.length === 0) {
              contentEl.innerHTML = '<div class="empty-state">No examination attempts found for this candidate.</div>';
            } else {
              const hRows = data.examHistory.map((h, hi) => {
                const isPass = h.status === 'Passed';
                const isActive = h.status === 'In Progress' || h.isActive === true;
                const statusBadge = isActive
                  ? '<span style="background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">In Progress</span>'
                  : isPass
                    ? '<span style="background:#dcfce7; color:#166534; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">Passed</span>'
                    : '<span style="background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">Failed</span>';

                const totalQ = h.total || h.totalQuestions || 40;
                const attempted = h.questionsAttempted !== undefined
                  ? h.questionsAttempted
                  : ((h.correct || 0) + (h.wrong || 0));
                const correctCount = h.score !== undefined && typeof h.score === 'number' ? h.score : (h.correct || 0);
                const wrongCount = h.wrong || 0;
                const unansCount = h.unanswered !== undefined ? h.unanswered : Math.max(0, totalQ - attempted);

                const hasAnswers = Array.isArray(h.answers) && h.answers.length > 0;
                const viewAnswersBtn = hasAnswers
                  ? `<button class="btn btn-primary btn-sm" data-view-sh-cam="${hi}" style="font-size:0.78rem; padding:3px 8px; font-weight:600;">View Answers</button>`
                  : '<span style="color:var(--gray-400);">—</span>';

                return `
                  <tr>
                    <td>${hi + 1}</td>
                    <td>
                      <strong>${escapeHtml(h.examTitle || 'Programming Fundamentals')}</strong>
                      <br><small style="color:#64748b; font-size:0.75rem;">Attempt #${h.attemptNumber || 1}</small>
                    </td>
                    <td><strong>${statusBadge}</strong></td>
                    <td style="text-align:center;"><strong style="color:#2563eb;">${attempted}</strong> / ${totalQ}</td>
                    <td style="text-align:center;"><strong style="color:#166534;">${isActive ? '—' : correctCount}</strong></td>
                    <td style="text-align:center;"><span style="color:#991b1b;">${isActive ? '—' : wrongCount}</span></td>
                    <td style="text-align:center;"><span style="color:var(--gray-600);">${unansCount}</span></td>
                    <td style="text-align:center;"><strong>${isActive ? '—' : (h.percentage + '%')}</strong></td>
                    <td><small>${formatDateTimeA(h.dateTime || h.submittedAt)}</small></td>
                    <td style="text-align:center;">${escapeHtml(h.timeTaken || '0:00')}</td>
                    <td style="text-align:center;">${h.warnings || 0}/3</td>
                    <td style="text-align:right;">${viewAnswersBtn}</td>
                  </tr>
                `;
              }).join('');

              contentEl.innerHTML = `
                <div style="overflow-x:auto;">
                  <table class="student-table" style="width:100%; font-size:0.83rem;">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Exam Name</th>
                        <th>Status</th>
                        <th style="text-align:center;">Attempted</th>
                        <th style="text-align:center;">Correct</th>
                        <th style="text-align:center;">Wrong</th>
                        <th style="text-align:center;">Unanswered</th>
                        <th style="text-align:center;">Score %</th>
                        <th>Date & Time</th>
                        <th style="text-align:center;">Duration</th>
                        <th style="text-align:center;">Warnings</th>
                        <th style="text-align:right;">Answers</th>
                      </tr>
                    </thead>
                    <tbody>${hRows}</tbody>
                  </table>
                </div>
              `;

              contentEl.querySelectorAll("[data-view-sh-cam]").forEach(btn => {
                btn.addEventListener("click", () => {
                  const idx = parseInt(btn.dataset.viewShCam, 10);
                  const h = data.examHistory[idx];
                  if (h) {
                    openCandidateAnswersModal({
                      ...h,
                      studentName: name,
                      username: username
                    });
                  }
                });
              });
            }
          } else {
            contentEl.innerHTML = `<div class="empty-state" style="color:var(--danger);">${data.message || 'Failed to load history.'}</div>`;
          }
        } catch (err) {
          contentEl.innerHTML = '<div class="empty-state" style="color:var(--danger);">Error loading student history.</div>';
        }
      });
    });

    // Toggle Block listeners
    list.querySelectorAll(".toggle-block-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const studentId = btn.dataset.studentId;
        const token = getAdminToken();
        try {
          const res = await fetch(getApiUrl(`/api/admin/students/${studentId}/toggle-block`), {
            method: "PUT",
            headers: token ? { "Authorization": `Bearer ${token}` } : {}
          });
          if (res.ok) {
            await loadStudentsFromBackend();
            await loadAdminStats();
          }
        } catch (e) {
          console.warn("Toggle block error:", e);
        }
      });
    });

    // Delete Student listeners
    list.querySelectorAll(".delete-student-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingDeleteStudentId = btn.dataset.studentId;
        const name = btn.dataset.studentName;
        const msg = document.getElementById("delete-student-msg");
        if (msg) msg.textContent = `Are you sure you want to permanently delete student account: "${name}"?`;
        document.getElementById("delete-student-modal").classList.add("show");
      });
    });
  }

  // Student Search listener with debounce
  const studentSearchInput = document.getElementById("student-search-input");
  if (studentSearchInput) {
    let sDebounce = null;
    studentSearchInput.addEventListener("input", (e) => {
      clearTimeout(sDebounce);
      sDebounce = setTimeout(() => {
        loadStudentsFromBackend(e.target.value.trim());
      }, 250);
    });
  }

  // Delete student modal event listeners
  const cancelDeleteStudentBtn = document.getElementById("cancel-delete-student-btn");
  if (cancelDeleteStudentBtn) {
    cancelDeleteStudentBtn.addEventListener("click", () => {
      pendingDeleteStudentId = null;
      document.getElementById("delete-student-modal").classList.remove("show");
    });
  }

  const confirmDeleteStudentBtn = document.getElementById("confirm-delete-student-btn");
  if (confirmDeleteStudentBtn) {
    confirmDeleteStudentBtn.addEventListener("click", async () => {
      if (pendingDeleteStudentId) {
        const adminPassword = prompt("SECURITY CONFIRMATION\n\nPlease enter your Admin Password to confirm student deletion:");
        if (!adminPassword) {
          pendingDeleteStudentId = null;
          document.getElementById("delete-student-modal").classList.remove("show");
          return;
        }

        const token = getAdminToken();
        try {
          const res = await fetch(getApiUrl(`/api/admin/students/${pendingDeleteStudentId}`), {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ adminPassword })
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            await loadStudentsFromBackend();
            await loadAdminStats();
            if (typeof loadAuditLogs === 'function') loadAuditLogs();
          } else {
            alert(data.message || "Failed to delete student account.");
          }
        } catch (e) {
          console.warn("Delete student error:", e);
        }
        pendingDeleteStudentId = null;
      }
      document.getElementById("delete-student-modal").classList.remove("show");
    });
  }

  /* =========================================================
     QUESTION BANK MANAGEMENT (CRUD & Reset)
     ========================================================= */
  let currentRenderedQuestions = [];
  let pendingDeleteQuestionId = null;

  async function loadQuestionsFromBackend(searchTerm = "") {
    try {
      const token = getAdminToken();
      const url = "/api/admin/questions" + (searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : "");
      const res = await fetch(getApiUrl(url), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const serverQs = await res.json();
        const qList = Array.isArray(serverQs) ? serverQs : (serverQs && serverQs.questions ? serverQs.questions : []);
        renderQuestions(qList);
        return;
      }
    } catch (err) {
      console.warn("Backend questions not reachable:", err);
    }
    renderQuestions([]);
  }

  const closeShBtn = document.getElementById("close-sh-btn");
  const closeShFooterBtn = document.getElementById("close-sh-footer-btn");
  const shModal = document.getElementById("student-history-modal");
  if (closeShBtn && shModal) {
    closeShBtn.addEventListener("click", () => shModal.classList.remove("show"));
  }
  if (closeShFooterBtn && shModal) {
    closeShFooterBtn.addEventListener("click", () => shModal.classList.remove("show"));
  }

  // Candidate Detailed Answers Modal controls
  const closeCamBtn = document.getElementById("close-cam-btn");
  const closeCamFooterBtn = document.getElementById("close-cam-footer-btn");
  const camModal = document.getElementById("candidate-answers-modal");
  if (closeCamBtn && camModal) {
    closeCamBtn.addEventListener("click", () => camModal.classList.remove("show"));
  }
  if (closeCamFooterBtn && camModal) {
    closeCamFooterBtn.addEventListener("click", () => camModal.classList.remove("show"));
  }

  const camSearchInput = document.getElementById("cam-search-input");
  if (camSearchInput) {
    camSearchInput.addEventListener("input", (e) => {
      currentCamSearch = e.target.value;
      renderCamModalBody();
    });
  }

  function renderQuestions(serverQuestions) {
    let questions = [];
    if (Array.isArray(serverQuestions)) {
      questions = serverQuestions;
      currentRenderedQuestions = serverQuestions;
    } else if (Array.isArray(currentRenderedQuestions) && currentRenderedQuestions.length > 0) {
      questions = currentRenderedQuestions;
    } else {
      questions = [];
    }

    const list = document.getElementById("questions-list");
    const countBadge = document.getElementById("questions-count-badge");
    if (!list) return;

    if (countBadge) {
      countBadge.textContent = questions.length + (questions.length === 1 ? " question" : " questions");
    }

    if (questions.length === 0) {
      list.innerHTML = '<div class="empty-state">No questions found matching your search. Add questions or reset defaults.</div>';
      return;
    }

    list.innerHTML = questions.map((q, index) => {
      const qId = q._id || q.id || index;
      const opts = [q.optionA, q.optionB, q.optionC, q.optionD];
      const optionsHtml = opts.map((opt, i) => {
        const isCorrect = i === q.correct;
        return `<li class="${isCorrect ? "correct-option" : ""}">${OPTION_LABELS[i]}. ${escapeHtml(opt)}${isCorrect ? " ✓" : ""}</li>`;
      }).join("");

      return `
        <div class="question-card" style="margin-bottom:12px; padding:14px; border:1px solid #e2e8f0; border-radius:8px; background:white;">
          <div class="q-top" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <div style="flex:1;">
              <span class="q-number" style="font-weight:700; color:var(--navy-800, #1e293b); font-size:0.88rem; background:transparent !important; padding:0;">Question ${index + 1}</span>
              <div class="q-text" style="font-size:0.95rem; font-weight:500; margin-top:4px; line-height:1.4;">${escapeHtml(q.question)}</div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button class="btn btn-outline btn-sm edit-q-btn" data-edit-id="${qId}" data-edit-index="${index}">Edit</button>
              <button class="btn btn-danger btn-sm delete-q-btn" data-delete-id="${qId}" data-delete-index="${index}">Delete</button>
            </div>
          </div>
          <ul class="option-list" style="margin-top:10px; margin-bottom:8px;">${optionsHtml}</ul>
          <div style="font-size:0.82rem; color: var(--gray-600); margin-top:4px;">
            Correct Answer: <strong style="color:var(--success, #166534);">Option ${OPTION_LABELS[q.correct]} (${escapeHtml(opts[q.correct] || "")})</strong>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".edit-q-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.editIndex, 10);
        const qId = btn.dataset.editId;
        const q = currentRenderedQuestions[idx];
        if (!q) return;

        document.getElementById("edit-q-id").value = q._id || q.id || qId;
        document.getElementById("edit-q-text").value = q.question || "";
        document.getElementById("edit-opt-a").value = q.optionA || "";
        document.getElementById("edit-opt-b").value = q.optionB || "";
        document.getElementById("edit-opt-c").value = q.optionC || "";
        document.getElementById("edit-opt-d").value = q.optionD || "";
        document.getElementById("edit-correct-answer").value = q.correct !== undefined ? q.correct : "0";

        document.getElementById("edit-question-modal").classList.add("show");
      });
    });

    list.querySelectorAll(".delete-q-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingDeleteQuestionId = btn.dataset.deleteId;
        pendingDeleteIndex = parseInt(btn.dataset.deleteIndex, 10);
        document.getElementById("delete-modal").classList.add("show");
      });
    });
  }

  /* ---------- Total Saved Questions Panel Toggle ---------- */
  const savedQuestionsToggleHeader = document.getElementById("saved-questions-toggle-header");
  const toggleSavedQuestionsBtn = document.getElementById("toggle-saved-questions-btn");
  const savedQuestionsBody = document.getElementById("saved-questions-body");

  function toggleSavedQuestionsSection(e) {
    if (e && e.target && e.target.closest('#toggle-saved-questions-btn') && e.currentTarget === savedQuestionsToggleHeader) {
      return;
    }
    if (!savedQuestionsBody) return;
    const isHidden = savedQuestionsBody.classList.contains("hidden");
    const toggleIcon = document.getElementById("saved-questions-toggle-icon");
    const toggleText = document.getElementById("saved-questions-toggle-text");

    if (isHidden) {
      savedQuestionsBody.classList.remove("hidden");
      if (savedQuestionsToggleHeader) savedQuestionsToggleHeader.style.marginBottom = "16px";
      if (toggleSavedQuestionsBtn) {
        toggleSavedQuestionsBtn.innerHTML = '<span id="saved-questions-toggle-icon">✖</span> <span id="saved-questions-toggle-text">Close Questions</span> ▴';
        toggleSavedQuestionsBtn.style.background = "#f1f5f9";
        toggleSavedQuestionsBtn.style.color = "#0f172a";
        toggleSavedQuestionsBtn.style.border = "1.5px solid #64748b";
      }
    } else {
      savedQuestionsBody.classList.add("hidden");
      if (savedQuestionsToggleHeader) savedQuestionsToggleHeader.style.marginBottom = "0";
      if (toggleSavedQuestionsBtn) {
        toggleSavedQuestionsBtn.innerHTML = '<span id="saved-questions-toggle-icon">👁️</span> <span id="saved-questions-toggle-text">Click to View Questions</span> ▾';
        toggleSavedQuestionsBtn.style.background = "#2563eb";
        toggleSavedQuestionsBtn.style.color = "#ffffff";
        toggleSavedQuestionsBtn.style.border = "1px solid #1d4ed8";
      }
    }
  }

  if (savedQuestionsToggleHeader) {
    savedQuestionsToggleHeader.addEventListener("click", toggleSavedQuestionsSection);
  }
  if (toggleSavedQuestionsBtn) {
    toggleSavedQuestionsBtn.addEventListener("click", toggleSavedQuestionsSection);
  }

  const closeSavedQuestionsBottomBtn = document.getElementById("close-saved-questions-bottom-btn");
  if (closeSavedQuestionsBottomBtn) {
    closeSavedQuestionsBottomBtn.addEventListener("click", () => {
      if (savedQuestionsBody) savedQuestionsBody.classList.add("hidden");
      if (savedQuestionsToggleHeader) savedQuestionsToggleHeader.style.marginBottom = "0";
      if (toggleSavedQuestionsBtn) {
        toggleSavedQuestionsBtn.innerHTML = '<span id="saved-questions-toggle-icon">👁️</span> <span id="saved-questions-toggle-text">Click to View Questions</span> ▾';
        toggleSavedQuestionsBtn.style.background = "#2563eb";
        toggleSavedQuestionsBtn.style.color = "#ffffff";
        toggleSavedQuestionsBtn.style.border = "1px solid #1d4ed8";
      }
      const panel = document.getElementById("saved-questions-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const questionSearchInput = document.getElementById("question-search-input");
  if (questionSearchInput) {
    let qDebounce = null;
    questionSearchInput.addEventListener("input", (e) => {
      clearTimeout(qDebounce);
      qDebounce = setTimeout(() => {
        loadQuestionsFromBackend(e.target.value.trim());
      }, 250);
    });
  }

  // Add Question Form
  const questionForm = document.getElementById("question-form");
  const questionAlert = document.getElementById("question-alert");

  if (questionForm) {
    questionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      questionAlert.classList.remove("show");

      const questionText = document.getElementById("q-text").value.trim();
      const a = document.getElementById("opt-a").value.trim();
      const b = document.getElementById("opt-b").value.trim();
      const c = document.getElementById("opt-c").value.trim();
      const d = document.getElementById("opt-d").value.trim();
      const correct = parseInt(document.getElementById("correct-answer").value, 10);

      if (!questionText || !a || !b || !c || !d) {
        questionAlert.textContent = "Please fill in the question and all four options.";
        questionAlert.className = "alert alert-error show";
        return;
      }

      const newQ = {
        question: questionText,
        optionA: a,
        optionB: b,
        optionC: c,
        optionD: d,
        correct: correct
      };

      const token = getAdminToken();
      try {
        const res = await fetch(getApiUrl("/api/admin/questions"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify(newQ)
        });
        if (res.ok) {
          questionAlert.textContent = "Question saved successfully to MongoDB question bank.";
          questionAlert.className = "alert alert-success show";
          questionForm.reset();
          await loadQuestionsFromBackend();
          await loadAdminStats();
        } else {
          const errData = await res.json().catch(() => ({}));
          questionAlert.textContent = errData.message || "Failed to save question.";
          questionAlert.className = "alert alert-error show";
        }
      } catch (err) {
        questionAlert.textContent = "Server error while saving question: " + err.message;
        questionAlert.className = "alert alert-error show";
      }
    });
  }

  const editQForm = document.getElementById("edit-question-form");
  const editModal = document.getElementById("edit-question-modal");
  const cancelEditBtn = document.getElementById("cancel-edit-q-btn");
  const closeEditBtn = document.getElementById("close-edit-q-btn");

  if (cancelEditBtn && editModal) {
    cancelEditBtn.addEventListener("click", () => editModal.classList.remove("show"));
  }
  if (closeEditBtn && editModal) {
    closeEditBtn.addEventListener("click", () => editModal.classList.remove("show"));
  }

  if (editQForm) {
    editQForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const qId = document.getElementById("edit-q-id").value;
      const question = document.getElementById("edit-q-text").value.trim();
      const optionA = document.getElementById("edit-opt-a").value.trim();
      const optionB = document.getElementById("edit-opt-b").value.trim();
      const optionC = document.getElementById("edit-opt-c").value.trim();
      const optionD = document.getElementById("edit-opt-d").value.trim();
      const correct = parseInt(document.getElementById("edit-correct-answer").value, 10);

      const token = getAdminToken();
      try {
        const res = await fetch(getApiUrl(`/api/admin/questions/${qId}`), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ question, optionA, optionB, optionC, optionD, correct })
        });
        if (res.ok) {
          await loadQuestionsFromBackend();
          await loadAdminStats();
          editModal.classList.remove("show");
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.message || "Failed to update question.");
        }
      } catch (err) {
        alert("Error updating question: " + err.message);
      }
    });
  }

  // Delete Question Modal
  const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener("click", () => {
      pendingDeleteIndex = null;
      pendingDeleteQuestionId = null;
      document.getElementById("delete-modal").classList.remove("show");
    });
  }

  const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (pendingDeleteQuestionId) {
        const token = getAdminToken();
        try {
          const res = await fetch(getApiUrl("/api/admin/questions/" + pendingDeleteQuestionId), {
            method: "DELETE",
            headers: token ? { "Authorization": `Bearer ${token}` } : {}
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.warn("Delete question error:", errData.message);
          }
        } catch (e) {
          console.warn("Backend question delete:", e);
        }
        pendingDeleteQuestionId = null;
        pendingDeleteIndex = null;
        await loadQuestionsFromBackend();
        await loadAdminStats();
      }
      document.getElementById("delete-modal").classList.remove("show");
    });
  }

  // Reset Default Questions Modal
  const resetQuestionsBtn = document.getElementById("reset-questions-btn");
  if (resetQuestionsBtn) {
    resetQuestionsBtn.addEventListener("click", () => {
      document.getElementById("reset-modal").classList.add("show");
    });
  }

  const cancelResetBtn = document.getElementById("cancel-reset-btn");
  if (cancelResetBtn) {
    cancelResetBtn.addEventListener("click", () => {
      document.getElementById("reset-modal").classList.remove("show");
    });
  }

  const confirmResetBtn = document.getElementById("confirm-reset-btn");
  if (confirmResetBtn) {
    confirmResetBtn.addEventListener("click", async () => {
      const adminPassword = prompt("SECURITY CONFIRMATION\n\nPlease enter your Admin Password to confirm resetting default questions:");
      if (!adminPassword) {
        document.getElementById("reset-modal").classList.remove("show");
        return;
      }

      const token = getAdminToken();
      try {
        const res = await fetch(getApiUrl("/api/admin/reset-defaults"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ adminPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          alert(data.message || "Default questions reset successfully.");
          await loadQuestionsFromBackend();
          await loadAdminStats();
          if (typeof loadAuditLogs === 'function') loadAuditLogs();
        } else {
          alert(data.message || "Failed to reset questions.");
        }
      } catch (e) {
        console.warn("Backend reset questions error:", e);
      }
      document.getElementById("reset-modal").classList.remove("show");
    });
  }

  /* =========================================================
     EXAM DURATION SETTINGS
     ========================================================= */
  const examSettingsForm = document.getElementById("exam-settings-form");
  const examSettingsAlert = document.getElementById("exam-settings-alert");
  const examTimeInput = document.getElementById("exam-time-input");

  async function loadExamSettings() {
    try {
      const res = await fetch(getApiUrl("/api/exams"));
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.exams) && data.exams.length > 0 && examTimeInput) {
          examTimeInput.value = data.exams[0].durationMinutes || 15;
          return;
        }
      }
    } catch (e) {
      console.warn("Unable to fetch exam duration settings from backend:", e);
    }
    if (examTimeInput && !examTimeInput.value) {
      examTimeInput.value = 15;
    }
  }

  if (examSettingsForm) {
    examSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      examSettingsAlert.classList.remove("show");
      const minutes = parseInt(examTimeInput.value, 10);

      if (!minutes || minutes < 1 || minutes > 180) {
        examSettingsAlert.textContent = "Please enter a valid exam duration (1-180 minutes).";
        examSettingsAlert.className = "alert alert-error show";
        return;
      }

      const token = getAdminToken();
      try {
        const res = await fetch(getApiUrl("/api/exams/settings"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ minutes })
        });
        const data = await res.json();
        if (res.ok) {
          examSettingsAlert.textContent = data.message || `Exam duration updated to ${minutes} minutes in MongoDB.`;
          examSettingsAlert.className = "alert alert-success show";
        } else {
          throw new Error(data.message || "Failed to update duration.");
        }
      } catch (err) {
        examSettingsAlert.textContent = err.message || "Error saving exam duration to database.";
        examSettingsAlert.className = "alert alert-error show";
      }
    });
  }

  /* =========================================================
     EXPORTS (EXCEL & CSV) & CLEAR ALL RESULTS
     ========================================================= */
  async function exportResultsToExcel() {
    try {
      const token = getAdminToken();
      const res = await fetch(getApiUrl("/api/admin/export/excel"), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `QuizBuilder_Results_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
    } catch (err) {
      console.warn("Backend excel export error, falling back to local view:", err);
    }

    const records = currentActivityList;
    if (!records.length) {
      alert("No examination data available to export yet.");
      return;
    }

    let tableHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Calibri, Arial, sans-serif; }
        h2 { color: #0f172a; margin-bottom: 4px; }
        p { color: #475569; font-size: 11pt; margin-top: 0; }
        table { border-collapse: collapse; width: 100%; }
        th { background-color: #1e293b; color: #ffffff; font-weight: bold; text-align: center; border: 1px solid #94a3b8; padding: 8px; font-size: 11pt; }
        td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; font-size: 10pt; }
        .center { text-align: center; }
        .pass { background-color: #dcfce7; color: #166534; font-weight: bold; text-align: center; }
        .fail { background-color: #fee2e2; color: #991b1b; font-weight: bold; text-align: center; }
      </style>
      </head>
      <body>
        <h2>QUIZ BUILDER — MULTI-DEVICE EXAMINATION ACTIVITY REPORT</h2>
        <p>Report Generated: ${new Date().toLocaleString()} | Total Records: ${records.length}</p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Student Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Exam Name</th>
              <th>Score</th>
              <th>Status</th>
              <th>Date & Time</th>
              <th>Time Taken</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
    `;

    records.forEach((r, idx) => {
      const isPass = r.submissionStatus === "Passed" || r.status === "Passed";
      tableHtml += `
        <tr>
          <td class="center">${idx + 1}</td>
          <td><strong>${escapeHtml(r.studentName || "Unknown")}</strong></td>
          <td>${escapeHtml(r.username || "—")}</td>
          <td>${escapeHtml(r.email || "—")}</td>
          <td>${escapeHtml(r.examName || "Programming Fundamentals")}</td>
          <td class="center"><strong>${escapeHtml(r.score || "—")}</strong></td>
          <td class="${isPass ? "pass" : "fail"}">${escapeHtml(r.submissionStatus || r.status || "—")}</td>
          <td>${formatDateTimeA(r.dateTime)}</td>
          <td class="center">${escapeHtml(r.timeTaken || "0:00")}</td>
          <td class="center">${r.warnings || 0} / 3</td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `QuizBuilder_Exam_Activity_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportResultsToCsv() {
    const records = currentActivityList;
    if (!records.length) {
      alert("No examination data available to export yet.");
      return;
    }

    const headers = [
      "Student Name",
      "Username",
      "Email",
      "Exam Name",
      "Score",
      "Status",
      "Date & Time",
      "Time Taken",
      "Warnings"
    ];

    const rows = records.map((r) => [
      r.studentName || "",
      r.username || "",
      r.email || "",
      r.examName || "Programming Fundamentals",
      r.score || "",
      r.submissionStatus || r.status || "",
      formatDateTimeA(r.dateTime),
      r.timeTaken || "",
      `${r.warnings || 0}/3`
    ]);

    const sanitizeCell = (cell) => {
      let str = String(cell || "");
      // Neutralize formula injection
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const csv = "\uFEFF" + [headers, ...rows]
      .map((row) => row.map(sanitizeCell).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `QuizBuilder_Exam_Activity_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const excelExportBtn = document.getElementById("export-results-excel-btn");
  if (excelExportBtn) excelExportBtn.addEventListener("click", exportResultsToExcel);

  const csvExportBtn = document.getElementById("export-results-csv-btn");
  if (csvExportBtn) csvExportBtn.addEventListener("click", exportResultsToCsv);

  // Clear Results Modal
  const clearResultsBtn = document.getElementById("clear-results-btn");
  if (clearResultsBtn) {
    clearResultsBtn.addEventListener("click", () => {
      document.getElementById("clear-results-modal").classList.add("show");
    });
  }

  const cancelClearBtn = document.getElementById("cancel-clear-results-btn");
  if (cancelClearBtn) {
    cancelClearBtn.addEventListener("click", () => {
      document.getElementById("clear-results-modal").classList.remove("show");
    });
  }

  const confirmClearBtn = document.getElementById("confirm-clear-results-btn");
  if (confirmClearBtn) {
    confirmClearBtn.addEventListener("click", async () => {
      const adminPassword = prompt("SECURITY CONFIRMATION\n\nPlease enter your Admin Password to confirm clearing all exam results and sessions:");
      if (!adminPassword) {
        document.getElementById("clear-results-modal").classList.remove("show");
        return;
      }

      const token = getAdminToken();
      try {
        const res = await fetch(getApiUrl("/api/admin/results"), {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ adminPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          currentActivityList = [];
          alert(data.message || "All exam results cleared successfully.");
          await loadAdminStats();
          await loadExamActivity();
          if (typeof loadAuditLogs === 'function') loadAuditLogs();
        } else {
          alert(data.message || "Failed to clear results.");
        }
      } catch (e) {
        console.warn("Failed to clear backend results:", e);
      }

      document.getElementById("clear-results-modal").classList.remove("show");
      renderLeaderboard();
    });
  }

  /* =========================================================
     LEADERBOARD
     ========================================================= */
  async function renderLeaderboard() {
    const list = document.getElementById("leaderboard-list");
    if (!list) return;

    try {
      const token = getAdminToken();
      const res = await fetch(getApiUrl("/api/admin/leaderboard"), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (data.leaderboard && data.leaderboard.length) {
          list.innerHTML = data.leaderboard.slice(0, 10).map((r) => `
            <div class="leaderboard-item" style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #dfe3ee; border-radius:12px; padding:12px 14px; margin-bottom:8px;">
              <div>
                <strong>#${r.rank} ${escapeHtml(r.studentName || "Unknown")}</strong><br>
                <small style="color:var(--gray-600);">@${escapeHtml(r.username || "—")}</small>
              </div>
              <div style="text-align:right;">
                <div><strong>${escapeHtml(r.score)} / ${escapeHtml(r.total)} (${r.percentage}%)</strong></div>
                <small style="color:#059669; font-weight:600;">Time: ${escapeHtml(r.timeTaken || "—")}</small>
              </div>
            </div>
          `).join("");
          return;
        }
      }
    } catch (e) {
      console.warn("Leaderboard API error, using activity list:", e);
    }

    const results = currentActivityList
      .filter(r => r.submissionStatus !== "Active")
      .slice()
      .sort((a, b) => (b.rawScore || b.correct || 0) - (a.rawScore || a.correct || 0));

    if (!results.length) {
      list.innerHTML = '<div class="empty-state">No completed exam submissions recorded yet.</div>';
      return;
    }

    list.innerHTML = results.slice(0, 10).map((r, index) => {
      return `
        <div class="leaderboard-item" style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #dfe3ee; border-radius:12px; padding:12px 14px; margin-bottom:8px;">
          <div>
            <strong>#${index + 1} ${escapeHtml(r.studentName || "Unknown")}</strong><br>
            <small style="color:var(--gray-600);">@${escapeHtml(r.username || "—")} • ${escapeHtml(r.email || "")}</small>
          </div>
          <div style="text-align:right;">
            <div><strong>${escapeHtml(r.score || "")}</strong></div>
            <small style="color:#059669; font-weight:600;">${r.submissionStatus || r.status || "Passed"}</small>
          </div>
        </div>
      `;
    }).join("");
  }

  /* =========================================================
     EXAMINATION ANALYTICS & AUDIT TRAIL
     ========================================================= */
  async function loadAnalytics() {
    try {
      const token = getAdminToken();
      const res = await fetch(getApiUrl("/api/admin/analytics"), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const a = data.analytics;
      if (!a) return;

      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setEl("analytics-pass-rate-badge", `${a.passRate}% Pass Rate (${a.passedResults}/${a.totalResults})`);
      if (a.distribution) {
        setEl("analytics-bucket-fail", a.distribution.fail || 0);
        setEl("analytics-bucket-pass", a.distribution.pass || 0);
        setEl("analytics-bucket-good", a.distribution.good || 0);
        setEl("analytics-bucket-distinction", a.distribution.distinction || 0);
      }

      const hList = document.getElementById("analytics-hardest-list");
      if (hList) {
        if (!a.hardestQuestions || !a.hardestQuestions.length) {
          hList.innerHTML = '<div style="color:#64748b; font-style:italic;">No recorded question attempts yet.</div>';
        } else {
          hList.innerHTML = a.hardestQuestions.map((q, i) => `
            <div style="background:#fff; border:1px solid #fee2e2; border-radius:6px; padding:8px 10px; margin-bottom:6px;">
              <strong>${i + 1}. ${escapeHtml(q.question.slice(0, 85))}${q.question.length > 85 ? '...' : ''}</strong>
              <div style="color:#991b1b; font-weight:600; margin-top:2px;">Incorrect: ${q.wrongRate}% (${q.wrong}/${q.totalAttempts})</div>
            </div>
          `).join("");
        }
      }

      const eList = document.getElementById("analytics-easiest-list");
      if (eList) {
        if (!a.easiestQuestions || !a.easiestQuestions.length) {
          eList.innerHTML = '<div style="color:#64748b; font-style:italic;">No recorded question attempts yet.</div>';
        } else {
          eList.innerHTML = a.easiestQuestions.map((q, i) => `
            <div style="background:#fff; border:1px solid #dcfce7; border-radius:6px; padding:8px 10px; margin-bottom:6px;">
              <strong>${i + 1}. ${escapeHtml(q.question.slice(0, 85))}${q.question.length > 85 ? '...' : ''}</strong>
              <div style="color:#166534; font-weight:600; margin-top:2px;">Correct: ${q.correctRate}% (${q.correct}/${q.totalAttempts})</div>
            </div>
          `).join("");
        }
      }
    } catch (e) {
      console.warn("Load analytics error:", e);
    }
  }

  async function loadAuditLogs() {
    try {
      const token = getAdminToken();
      const res = await fetch(getApiUrl("/api/admin/audit-logs?limit=15"), {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = document.getElementById("audit-logs-list");
      if (!list) return;

      if (!data.logs || !data.logs.length) {
        list.innerHTML = '<div class="empty-state">No audit logs recorded yet.</div>';
        return;
      }

      list.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
            <thead>
              <tr style="background:#f1f5f9; text-align:left; border-bottom:2px solid #cbd5e1;">
                <th style="padding:8px 10px;">Timestamp</th>
                <th style="padding:8px 10px;">Admin</th>
                <th style="padding:8px 10px;">Action</th>
                <th style="padding:8px 10px;">Target</th>
                <th style="padding:8px 10px;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${data.logs.map(log => `
                <tr style="border-bottom:1px solid #e2e8f0;">
                  <td style="padding:6px 10px; white-space:nowrap; color:#64748b;">${formatDateTimeA(log.createdAt)}</td>
                  <td style="padding:6px 10px; font-weight:600;">${escapeHtml(log.adminUsername || 'admin')}</td>
                  <td style="padding:6px 10px;"><span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">${escapeHtml(log.action)}</span></td>
                  <td style="padding:6px 10px; color:#475569;">${escapeHtml(log.targetType || 'System')}</td>
                  <td style="padding:6px 10px; color:#64748b; font-family:monospace; font-size:0.78rem;">${escapeHtml(JSON.stringify(log.details || {}).slice(0, 90))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    } catch (e) {
      console.warn("Load audit logs error:", e);
    }
  }

  const refreshAuditBtn = document.getElementById("refresh-audit-logs-btn");
  if (refreshAuditBtn) {
    refreshAuditBtn.addEventListener("click", loadAuditLogs);
  }
});

/* ---------- Utility: escape HTML to avoid XSS ---------- */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}
