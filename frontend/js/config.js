/* =========================================================
   Quiz Builder – config.js
   Configurable API Base URL for separate frontend/backend deployments
   (e.g., Frontend on Vercel, Backend on Render)
   ========================================================= */

(function () {
  // Configured production backend Render Web Service URL
  const DEFAULT_REMOTE_BACKEND_URL = "https://quizbuilder-backend-504h.onrender.com";
  let detectedBaseUrl = "";
  if (typeof window !== "undefined") {
    const isFileProto = window.location.protocol === "file:";
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const isServerPort = window.location.port === "5000";

    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("API_BASE_URL") : "";
    const injected = window.__API_BASE_URL__;

    if (injected) {
      detectedBaseUrl = injected;
    } else if (stored) {
      detectedBaseUrl = stored;
    } else if (isLocalhost && isServerPort) {
      // Running directly on local Express backend server (http://localhost:5000)
      detectedBaseUrl = "";
    } else if (isFileProto || isLocalhost) {
      // Opened directly via file:/// or VS Code Live Server (port 5500, etc.)
      // Route automatically to remote Render backend so login & API calls succeed out of the box
      detectedBaseUrl = DEFAULT_REMOTE_BACKEND_URL;
    } else {
      // Hosted on Vercel or custom domain: route to the production Render backend
      detectedBaseUrl = DEFAULT_REMOTE_BACKEND_URL;
    }
  }

  window.API_BASE_URL = (detectedBaseUrl || "").replace(/\/+$/, "");

  window.apiUrl = function (endpoint) {
    if (!endpoint) return window.API_BASE_URL || "";
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
    return window.API_BASE_URL ? window.API_BASE_URL + cleanEndpoint : cleanEndpoint;
  };

  window.getApiUrl = window.apiUrl;

  // Pre-warm backend Web Service (wakes up sleeping Render instance immediately on page load)
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const pingUrl = window.apiUrl("/api/health");
      if (pingUrl && (pingUrl.startsWith("http") || pingUrl.startsWith("/"))) {
        fetch(pingUrl, { method: "GET", cache: "no-store", keepalive: true }).catch(function () {});
      }
    } catch (_) {}
  }
})();
