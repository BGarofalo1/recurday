export const SECURITY = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
};

export const TAGLINE = "Creating family traditions. It was always about the small things.";
export const TAGLINE_SUPPORT = "Not the big holidays. The ones your family makes your own.";

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

export const OG_IMAGE_ALT = "A house and a heart at the two ends of a rainbow over the word Recurday. Creating family traditions. It was always about the small things.";

/** Link-preview tags. Always the generic rainbow card, never a family photo. */
export function shareMeta({ ogTitle, ogDescription, origin }) {
  const image = `${origin}/og.png`;
  return `<meta property="og:site_name" content="Recurday">
  <meta property="og:title" content="${esc(ogTitle)}">
  <meta property="og:description" content="${esc(ogDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(ogTitle)}">
  <meta name="twitter:description" content="${esc(ogDescription)}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="twitter:image:alt" content="${esc(OG_IMAGE_ALT)}">`;
}

export function pageShell({ title, description, ogTitle, ogDescription, origin, body, hue, nav = "", brandHero = false }) {
  const wrapClass = ["wrap", hue ? `hue-${esc(hue)}` : "", brandHero ? "brand-hero" : ""].filter(Boolean).join(" ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${shareMeta({ ogTitle, ogDescription, origin })}
  <meta name="theme-color" content="#ffffff">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Recurday">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png">
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="${wrapClass}" id="content">
    <header class="top">
      <a class="brand" href="/"><img class="logo-mark" src="/icons/mark.svg" width="68" height="36" alt="">Recurday</a>
      ${nav}
    </header>
    ${body}
    ${siteFooter()}
  </div>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

export function siteFooter() {
  return `<footer class="site-foot">
    <a href="/about">About</a>
    <a href="/ideas">Ideas</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </footer>`;
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
