export const SECURITY = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY, ...extraHeaders },
  });
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...SECURITY, ...extraHeaders },
  });
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pageShell({ title, description, ogTitle, ogDescription, origin, body, hue, nav = "" }) {
  const wrapClass = hue ? `wrap hue-${esc(hue)}` : "wrap";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(ogDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${esc(origin)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#ffffff">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Recurday">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="${wrapClass}">
    <header class="top">
      <a class="brand" href="/"><img class="logo-mark" src="/icons/mark.svg" width="36" height="22" alt="">Recurday</a>
      ${nav}
    </header>
    ${body}
  </div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export function familyNav(family) {
  if (!family) return "";
  return `<nav class="account">
    <a class="account-name" href="/calendar">${esc(family.name)}</a>
    <form method="post" action="/api/family/logout" class="logout-form">
      <button class="text-btn" type="submit">Log out</button>
    </form>
  </nav>`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clip(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

export function originOf(request) {
  return new URL(request.url).origin;
}

export function isSecureRequest(request) {
  return new URL(request.url).protocol === "https:";
}
