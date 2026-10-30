/* =========================================================
   Quiz Builder – config.js
   Configurable API Base URL for separate frontend/backend deployments
   (e.g., Frontend on Vercel, Backend on Render)
   ========================================================= */

(function () {
  // Configured production backend Render Web Service URL
  const DEFAULT_REMOTE_BACKEND_URL = "https://quizbuilder-backend.onrender.com";

  let detectedBaseUrl = "";
  if (typeof window !== "undefined") {
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "";

    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("API_BASE_URL") : "";
    const injected = window.__API_BASE_URL__;

    if (injected) {
      detectedBaseUrl = injected;
    } else if (stored) {
      detectedBaseUrl = stored;
    } else if (!isLocalhost) {
      // Hosted on Vercel or cloud: route to the production Render backend
      detectedBaseUrl = DEFAULT_REMOTE_BACKEND_URL;
    } else {
      // Local development on same server: use relative paths
      detectedBaseUrl = "";
    }
  }

  window.API_BASE_URL = (detectedBaseUrl || "").replace(/\/+$/, "");

  window.apiUrl = function (endpoint) {
    if (!endpoint) return window.API_BASE_URL || "";
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
    return window.API_BASE_URL ? window.API_BASE_URL + cleanEndpoint : cleanEndpoint;
  };

  window.getApiUrl = window.apiUrl;
})();
