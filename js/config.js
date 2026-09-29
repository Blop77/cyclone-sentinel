/*
 * Deployment configuration. Never put an API key in this file: public repos are
 * scanned and leaked Google keys are revoked automatically.
 *
 *   aiProxy   URL of the Cloud Run service from server/ (holds GEMINI_API_KEY server-side).
 *             When set, every visitor gets Gemini analysis without a key of their own.
 *             If the app is served *by* that service, it is detected automatically (/healthz).
 *   dispatch  defaults for the advisory-dispatch settings (overridable in the Settings dialog).
 */
window.CS_CONFIG = {
  aiProxy: "",
  dispatch: { webhook: "", minLevel: "orange", capStatus: "Exercise" },
};
