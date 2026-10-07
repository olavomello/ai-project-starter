// Pure helpers for the "AI Dash" button: where the dashboard lives, how to tell that what
// answers there is this project's ai-dash, and how to open a URL on each OS. No `$` here, so
// the rules can be unit-tested without the engine.

export const DASH_PORT = 4173; // scripts/ai-dash.mjs's default
export const DASH_LABEL = '▦ AI Dash'; // ▦ AI Dash

export function dashUrl(port = DASH_PORT) {
  return `http://127.0.0.1:${port}/`;
}

/** The probe URL: ai-dash answers GET /api/config with `{ "mod": { ... } }`. */
export function dashProbeUrl(port = DASH_PORT) {
  return `${dashUrl(port)}api/config`;
}

/** True when `text` is ai-dash's /api/config answer, so another program on the port is not mistaken for it. */
export function isAiDash(text) {
  try {
    const body = JSON.parse(text);
    return body !== null && typeof body === 'object' && body.mod !== null && typeof body.mod === 'object';
  } catch {
    return false;
  }
}

/** The ways to open `url` in the default browser, tried in order until one exits 0. No shell is involved. */
export function openCommands(url) {
  return [
    ['cmd', '/c', 'start', '', url], // Windows
    ['open', url], // macOS
    ['xdg-open', url], // Linux
  ];
}

/** The command that starts the dashboard for the project at the shared root. */
export function startArgv(port = DASH_PORT) {
  return ['node', 'scripts/ai-dash.mjs', '--port', String(port)];
}
