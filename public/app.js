const PHOTO_MAX = 2 * 1024 * 1024;
const PHOTO_EDGE = 1600;
const PHOTO_THUMB = 256;

const $ = (sel, root = document) => root.querySelector(sel);

// Tell Recurday this phone's time zone, so "today", "Coming up", and the
// calendar's highlighted day match the family's own clock. Only the zone name
// (like America/Chicago) is sent; nothing else.
(function syncTimeZone() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  if (!tz) return;
  const want = `recurday_tz=${encodeURIComponent(tz)}`;
  if (!document.cookie.split("; ").includes(want)) {
    document.cookie = `${want}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  }
  // The calendar was drawn for another zone (first visit, or travel): redraw once.
  const page = document.body?.dataset || {};
  if (page.tz && page.tz !== tz && !new URLSearchParams(location.search).has("on")) {
    try {
      if (sessionStorage.getItem("recurday-tz-reload") === tz) return;
      sessionStorage.setItem("recurday-tz-reload", tz);
    } catch { return; }
    location.reload();
  }
})();

async function shrinkImageTo(file, edge, quality) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  let { width: w, height: h } = bitmap;
  if (w > edge || h > edge) {
    const scale = edge / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;
  const smaller = blob.size < file.size || file.type !== "image/jpeg";
  if (!smaller && blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

async function shrinkImage(file) {
  return shrinkImageTo(file, PHOTO_EDGE, 0.82);
}

async function prepareFile(file, edge = PHOTO_EDGE) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Photos only.");
  }
  const out = await shrinkImageTo(file, edge, edge <= PHOTO_THUMB ? 0.8 : 0.82);
  if (out.size > PHOTO_MAX) {
    throw new Error("That photo is still too large after shrinking. Try a smaller one.");
  }
  return out;
}

async function appendCoverFiles(fd, file) {
  const ready = await prepareFile(file);
  fd.set("file", ready, ready.name);
  const thumb = await prepareFile(file, PHOTO_THUMB);
  if (thumb && thumb.size) fd.set("thumb", thumb, thumb.name.replace(/(\.[^.]+)?$/, ".thumb.jpg"));
  return fd;
}

async function postCover({ traditionId, file, mediaId, clear }) {
  if (file) {
    const fd = new FormData();
    fd.set("tradition_id", traditionId);
    await appendCoverFiles(fd, file);
    return fetch("/api/family/cover", { method: "POST", body: fd, credentials: "same-origin" });
  }
  return fetch("/api/family/cover", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tradition_id: traditionId, media_id: mediaId || "", clear: clear ? "1" : "" }),
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function tokenFromPath() {
  const m = location.pathname.match(/^\/[tas]\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}

function traditionIdFrom(el) {
  return el?.dataset?.traditionId || (location.pathname.match(/^\/f\/([^/]+)/) || [])[1] || "";
}

function authPayload(el, extra = {}) {
  const t = el?.dataset?.token || tokenFromPath();
  const tradition_id = traditionIdFrom(el);
  return { ...(t ? { t } : {}), ...(tradition_id ? { tradition_id } : {}), ...extra };
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
}

function smsHref(text) {
  const body = encodeURIComponent(text);
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1)
    ? `sms:&body=${body}`
    : `sms:?body=${body}`;
}

function shareMessage(kind, name, url) {
  const title = name || "This tradition";
  return `${title} is coming up. It was always about the small things. ${url}`;
}

async function textToFamily({ url, name, kind = "family", button }) {
  const text = shareMessage(kind, name, url);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Recurday", text });
      if (button) button.textContent = "Sent — or ready to send";
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "aborted";
    }
  }
  if (isMobile()) {
    window.location.href = smsHref(text);
    if (button) button.textContent = "Opening your messages";
    return "sms";
  }
  const ok = await copyText(text);
  if (button) button.textContent = ok ? "Copied — ready to text" : "Copy failed, long-press the link instead";
  return ok ? "copied" : "failed";
}

function showError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("hidden", !message);
  if (message) node.setAttribute("role", "alert");
  else node.removeAttribute("role");
}

function friendlyError(err, fallback) {
  if (!err) return fallback || "That didn't work. Try again.";
  if (err.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(err.message || "")) {
    return "That didn't work. Check your connection and try again.";
  }
  return err.message || fallback || "That didn't work. Try again.";
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true;
    if (label) btn.textContent = label;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

const createForm = $("#create-form");
if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#create-error");
    showError(err, "");
    const data = Object.fromEntries(new FormData(createForm).entries());
    try {
      const res = await fetch("/api/traditions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create that tradition.");
      const family = (body.household_path || "").split("/t/")[1] || "";
      location.href = family ? `${body.admin_path}?new=${encodeURIComponent(family)}` : body.admin_path;
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
}

const shareBtn = $("#copy-household");
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    await textToFamily({
      url: shareBtn.dataset.url,
      name: shareBtn.dataset.name || "our tradition",
      button: shareBtn,
    });
    setTimeout(() => {
      shareBtn.textContent = "Text this to family";
    }, 2500);
  });
}

const copyInvite = $("#copy-invite");
if (copyInvite) {
  copyInvite.addEventListener("click", async () => {
    await textToFamily({ url: copyInvite.dataset.url, kind: "pass", button: copyInvite });
    setTimeout(() => { copyInvite.textContent = "Text this pass-it-on link"; }, 2500);
  });
}

const uploadForm = $("#upload-form");
if (uploadForm) {
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#upload-error");
    const status = $("#upload-status");
    showError(err, "");
    if (status) status.textContent = "Preparing…";
    const token = uploadForm.dataset.token || tokenFromPath();
    const traditionId = traditionIdFrom(uploadForm);
    const fileInput = $("#file");
    const file = fileInput?.files?.[0];
    if (!file) {
      showError(err, "Choose a photo first.");
      if (status) status.textContent = "";
      return;
    }
    const btn = uploadForm.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const prepared = await prepareFile(file);
      if (status) status.textContent = "Uploading…";
      const fd = new FormData();
      if (token) fd.set("t", token);
      if (traditionId) fd.set("tradition_id", traditionId);
      fd.set("year", $("#year").value);
      fd.set("observed_on", $("#observed_on")?.value || "");
      fd.set("note", $("#day_note")?.value || "");
      fd.set("file", prepared);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Upload failed.");
      location.search = `?year=${encodeURIComponent($("#year").value)}`;
    } catch (e) {
      showError(err, friendlyError(e));
      if (status) status.textContent = "";
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

const inviteForm = $("#invite-form");
if (inviteForm) {
  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#invite-error");
    showError(err, "");
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authPayload(inviteForm, { label: $("#label").value })),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make that invite.");
      const box = document.getElementById("invite-result");
      if (box) {
        box.innerHTML = `<div class="notice"><p class="ok">Text this invite to them now. We can't show it again later.</p>
          <div class="links"><p><a href="${body.invite_path}">${body.invite_url}</a></p></div>
          <button class="btn" type="button" id="copy-invite" data-url="${body.invite_url}">Text this pass-it-on link</button></div>`;
        const copyInvite = document.getElementById("copy-invite");
        copyInvite?.addEventListener("click", async () => {
          await textToFamily({ url: copyInvite.dataset.url, kind: "pass", button: copyInvite });
        });
      }
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
}

document.querySelectorAll("[data-revoke]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const err = $("#invite-error");
    showError(err, "");
    try {
      const res = await fetch("/api/shares/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authPayload(btn, { share_id: btn.dataset.revoke })),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not stop that share.");
      location.reload();
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
});

const acceptForm = $("#accept-form");
if (acceptForm) {
  acceptForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#accept-error");
    showError(err, "");
    try {
      const res = await fetch("/api/shares/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: tokenFromPath() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not accept that invite.");
      location.reload();
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
}

const copyForm = $("#copy-form");
if (copyForm) {
  copyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#copy-error");
    showError(err, "");
    const btn = copyForm.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/shares/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: tokenFromPath() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not start your copy.");
      const box = $("#copy-result");
      if (box) {
        box.classList.remove("hidden");
        box.innerHTML = `<p class="ok">This is now your tradition, with your own links.</p>
          <div class="links">
            <p><strong>Family link</strong> — text this one:<br><a href="${body.household_path}">${body.household_url}</a></p>
            <p><strong>Keeper link</strong> — keep this one safe:<br><a href="${body.admin_path}">${body.admin_url}</a></p>
          </div>
          <p class="hint">Their photos stay with them. You can fill this day with your own.</p>`;
      }
    } catch (e) {
      showError(err, friendlyError(e));
      if (btn) btn.disabled = false;
    }
  });
}

const yearNote = $("#year-note-form");
if (yearNote) {
  yearNote.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#year-note-error");
    showError(err, "");
    try {
      const res = await fetch("/api/days", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authPayload($("#year-note-form") || $("#upload-form"), {
          year: Number($("#year").value),
          observed_on: $("#observed_on")?.value || "",
          note: $("#day_note")?.value || "",
        })),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not save that note.");
      location.search = `?year=${encodeURIComponent($("#year").value)}`;
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
}


const rotateBtn = document.getElementById("rotate-household");
if (rotateBtn) {
  rotateBtn.addEventListener("click", async () => {
    const box = document.getElementById("rotate-result");
    try {
      const res = await fetch("/api/household/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authPayload(rotateBtn)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make a new family link.");
      if (box) {
        box.innerHTML = `<div class="notice"><p class="ok">Here is a new family link. The old one no longer works.</p>
          <div class="links"><p><a href="${body.household_path}">${body.household_url}</a></p></div>
          <button class="btn" type="button" id="copy-household" data-url="${body.household_url}" data-name="${document.querySelector("h1")?.textContent || "our tradition"}">Text this to family</button></div>`;
        const btn = document.getElementById("copy-household");
        btn?.addEventListener("click", async () => {
          await textToFamily({ url: btn.dataset.url, name: btn.dataset.name, button: btn });
        });
      }
    } catch (e) {
      if (box) box.innerHTML = `<p class="error">${e.message}</p>`;
    }
  });
}


const A2HS_KEY = "recurday-a2hs-dismissed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: minimal-ui)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || window.navigator.standalone === true;
}

function isIos() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
}

function dismissA2hs(bar) {
  try { localStorage.setItem(A2HS_KEY, "1"); } catch {}
  bar.remove();
}

function installBar(message, actions) {
  const bar = document.createElement("div");
  bar.className = "a2hs";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-label", "Add Recurday to your home screen");
  const p = document.createElement("p");
  p.textContent = message;
  const row = document.createElement("div");
  row.className = "a2hs-actions";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = action.primary ? "btn" : "btn secondary";
    btn.textContent = action.label;
    btn.addEventListener("click", () => action.onClick(bar));
    row.append(btn);
  }
  bar.append(p, row);
  document.body.append(bar);
  return bar;
}

function setupInstallHint() {
  if (isStandalone()) return;
  try { if (localStorage.getItem(A2HS_KEY)) return; } catch {}

  let deferredPrompt = null;
  let shown = false;

  function showIos() {
    if (shown) return;
    shown = true;
    installBar(
      "Add Recurday to your home screen. Tap the Share button (the square with an arrow), then Add to Home Screen.",
      [{ label: "Got it", primary: true, onClick: dismissA2hs }]
    );
  }

  function showInstall() {
    if (shown) return;
    shown = true;
    installBar(
      "Add Recurday to your home screen.",
      [
        {
          label: "Add",
          primary: true,
          onClick: async (bar) => {
            if (!deferredPrompt) { dismissA2hs(bar); return; }
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch {}
            deferredPrompt = null;
            dismissA2hs(bar);
          },
        },
        { label: "Not now", primary: false, onClick: dismissA2hs },
      ]
    );
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstall();
  });

  if (isIos()) {
    setTimeout(showIos, 1200);
  }
}

setupInstallHint();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}


function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}


const IDEA_KEY = "recurday-idea";

function ideaSlugFromPage() {
  const fromUrl = new URLSearchParams(location.search).get("idea");
  if (fromUrl) {
    try { sessionStorage.setItem(IDEA_KEY, fromUrl); } catch {}
    return fromUrl;
  }
  try { return sessionStorage.getItem(IDEA_KEY) || ""; } catch { return ""; }
}

function calendarPathWithIdea(base) {
  const slug = ideaSlugFromPage();
  const path = base || "/calendar";
  if (!slug) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}idea=${encodeURIComponent(slug)}`;
}

function clearStoredIdea() {
  try { sessionStorage.removeItem(IDEA_KEY); } catch {}
}

async function showPendingIdea() {
  const el = $("#idea-pending");
  const slug = ideaSlugFromPage();
  if (!el || !slug) return;
  try {
    const res = await fetch("/api/ideas");
    const body = await res.json();
    const idea = (body.ideas || []).find((item) => item.slug === slug);
    if (!idea) return;
    el.textContent = `After you get started, we'll add ${idea.name}.`;
    el.classList.remove("hidden");
  } catch {}
}

showPendingIdea();


// Backup code: shown once, right after it is made. Copy, download, or screenshot.
function showBackupCode(container, code, { next = "", label = "Open our calendar", familyName = "" } = {}) {
  if (!container) return;
  container.innerHTML = `
    <p>If anyone forgets the passcode, this code lets you set a new one, so your photos are never lost.</p>
    <p class="backup-code" aria-label="Backup code"></p>
    <p class="hint">We show it only this once. Write it down, save it to Notes, or take a screenshot.</p>
    <div class="backup-actions">
      <button class="btn secondary" type="button" data-act="copy">Copy</button>
      <button class="btn secondary" type="button" data-act="download">Download</button>
    </div>
    <label class="check-label"><input type="checkbox" data-act="saved"> I saved it somewhere safe.</label>
    <button class="btn btn-lg" type="button" data-act="done" disabled>${label}</button>`;
  container.querySelector(".backup-code").textContent = code;
  const done = container.querySelector("[data-act=done]");
  container.querySelector("[data-act=saved]").addEventListener("change", (e) => { done.disabled = !e.target.checked; });
  container.querySelector("[data-act=copy]").addEventListener("click", async (e) => {
    const ok = await copyText(code);
    e.target.textContent = ok ? "Copied" : "Copy failed — write it down";
  });
  container.querySelector("[data-act=download]").addEventListener("click", () => {
    const text = `Recurday backup code${familyName ? ` for ${familyName}` : ""}\n\n${code}\n\nIf you forget your passcode, open Recurday, tap Forgot passcode?, and enter your family name and this code.\n${location.origin}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "recurday-backup-code.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  done.addEventListener("click", () => {
    if (next) location.href = next;
    else location.reload();
  });
}

function showBackupScreen(code, next, familyName) {
  const card = $("#backup-shown");
  if (!card) {
    location.href = next;
    return;
  }
  document.querySelectorAll(".home > .card, .home > details.more, .home > .quiet-links, .home > .support").forEach((el) => {
    if (el !== card) el.classList.add("hidden");
  });
  card.classList.remove("hidden");
  showBackupCode(card.querySelector(".backup-slot"), code, { next, familyName });
  card.focus();
  card.scrollIntoView({ block: "start" });
}

const familyCreate = $("#family-create-form");
if (familyCreate) {
  familyCreate.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#family-create-error");
    showError(err, "");
    const btn = familyCreate.querySelector("button[type=submit]");
    setBusy(btn, true, "Please wait…");
    try {
      const res = await postJson("/api/family/create", {
        name: $("#create-family-name").value,
        passcode: $("#create-passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create that family login.");
      const next = calendarPathWithIdea(body.calendar_path || "/calendar");
      if (body.backup_code) showBackupScreen(body.backup_code, next, body.name);
      else location.href = next;
    } catch (e) {
      showError(err, friendlyError(e));
      setBusy(btn, false);
    }
  });
}

const familyLogin = $("#family-login-form");
if (familyLogin) {
  familyLogin.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#family-login-error");
    showError(err, "");
    const btn = familyLogin.querySelector("button[type=submit]");
    setBusy(btn, true, "Please wait…");
    try {
      const res = await postJson("/api/family/login", {
        name: $("#login-family-name").value,
        passcode: $("#login-passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "That family name or passcode didn't work.");
      location.href = calendarPathWithIdea(body.calendar_path || "/calendar");
    } catch (e) {
      showError(err, friendlyError(e));
      setBusy(btn, false);
    }
  });
}

const claimForm = $("#claim-form");
if (claimForm) {
  claimForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#claim-error");
    showError(err, "");
    const btn = claimForm.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const payload = { t: claimForm.dataset.token || tokenFromPath() };
      if (claimForm.dataset.loggedIn !== "1") {
        payload.name = $("#claim-name")?.value;
        payload.passcode = $("#claim-passcode")?.value;
      }
      const res = await postJson("/api/family/claim", payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not set up that family login.");
      const next = calendarPathWithIdea(body.calendar_path || "/calendar");
      if (body.backup_code) {
        const slot = document.createElement("div");
        slot.className = "notice";
        claimForm.replaceWith(slot);
        showBackupCode(slot, body.backup_code, { next });
        slot.scrollIntoView({ block: "start" });
      } else {
        location.href = next;
      }
    } catch (e) {
      showError(err, friendlyError(e));
      if (btn) btn.disabled = false;
    }
  });
}


const recoverForm = $("#family-recover-form");
if (recoverForm) {
  if (location.hash === "#forgot") $("#forgot")?.setAttribute("open", "");
  recoverForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#family-recover-error");
    showError(err, "");
    const btn = recoverForm.querySelector("button[type=submit]");
    setBusy(btn, true, "Please wait…");
    try {
      const res = await postJson("/api/family/recover", {
        name: $("#recover-family-name").value,
        backup_code: $("#recover-code").value,
        new_passcode: $("#recover-passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "That family name or backup code didn't work.");
      const next = body.calendar_path || "/calendar";
      const card = $("#backup-shown");
      if (card) card.querySelector("h2").textContent = "Passcode updated. Here is your new backup code.";
      showBackupScreen(body.backup_code, next, body.name);
    } catch (e) {
      showError(err, friendlyError(e));
      setBusy(btn, false);
    }
  });
}

document.querySelectorAll(".backup-form").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = form.querySelector("[data-role=error]");
    showError(err, "");
    const btn = form.querySelector("button[type=submit]");
    setBusy(btn, true, "Please wait…");
    try {
      const res = await postJson("/api/family/backup-code", { passcode: form.querySelector("[name=passcode]").value });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make a backup code.");
      const result = form.parentElement.querySelector(".backup-result");
      form.remove();
      showBackupCode(result, body.backup_code, { label: "Done" });
    } catch (e) {
      showError(err, friendlyError(e));
      setBusy(btn, false);
    }
  });
});

const deleteFamilyForm = $("#delete-family-form");
if (deleteFamilyForm) {
  deleteFamilyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#delete-family-error");
    showError(err, "");
    const btn = deleteFamilyForm.querySelector("button[type=submit]");
    const confirmed = $("#delete-confirm")?.checked;
    if (!confirmed) {
      showError(err, "Please confirm that you want to delete everything.");
      return;
    }
    if (!window.confirm("Delete our family? This cannot be undone.")) return;
    setBusy(btn, true, "Please wait…");
    try {
      const res = await postJson("/api/family/delete", {
        passcode: $("#delete-passcode")?.value,
        confirm: "1",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete our family.");
      location.href = "/";
    } catch (e) {
      showError(err, friendlyError(e));
      setBusy(btn, false);
    }
  });
}

const calCreate = $("#calendar-create-form");
if (calCreate) {
  calCreate.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#calendar-create-error");
    showError(err, "");
    const btn = calCreate.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const res = await postJson("/api/family/traditions", {
        name: $("#cal-name").value,
        practice_note: $("#cal-practice").value,
        date: calCreate.querySelector("[name=date]").value,
        recur_type: $("#cal-repeat").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create that tradition.");
      const coverFile = $("#cal-cover")?.files?.[0];
      if (coverFile && body.id) {
        const coverRes = await postCover({ traditionId: body.id, file: coverFile });
        const coverBody = await coverRes.json().catch(() => ({}));
        if (!coverRes.ok) throw new Error(coverBody.error || "The tradition was created, but the cover didn't upload.");
      }
      clearStoredIdea();
      location.href = body.tradition_path || "/calendar";
    } catch (e) {
      showError(err, friendlyError(e));
      if (btn) btn.disabled = false;
    }
  });
}

const passForm = $("#passcode-form");
if (passForm) {
  passForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#passcode-error");
    const ok = $("#passcode-ok");
    showError(err, "");
    ok?.classList.add("hidden");
    try {
      const res = await postJson("/api/family/passcode", {
        current_passcode: $("#current_passcode").value,
        new_passcode: $("#new_passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not change that passcode.");
      passForm.reset();
      ok?.classList.remove("hidden");
    } catch (e) {
      showError(err, friendlyError(e));
    }
  });
}

const copyIcs = $("#copy-ics");
if (copyIcs) {
  copyIcs.addEventListener("click", async () => {
    const ok = await copyText(copyIcs.dataset.url || "");
    copyIcs.textContent = ok ? "Subscribe link copied" : "Copy failed — use the link above";
  });
}

const rotateIcs = $("#rotate-ics");
if (rotateIcs) {
  rotateIcs.addEventListener("click", async () => {
    const box = $("#ics-result");
    try {
      const res = await postJson("/api/family/calendar-link", {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make that calendar link.");
      if (box) {
        box.innerHTML = `<div class="notice"><p class="ok">Here is a new calendar link. The old one no longer works.</p>
          <div class="links"><p><a href="${body.ics_path}">${body.ics_url}</a></p></div>
          <button class="btn" type="button" id="copy-ics" data-url="${body.ics_url}">Copy the calendar link</button></div>`;
        const btn = document.getElementById("copy-ics");
        btn?.addEventListener("click", async () => {
          const ok = await copyText(btn.dataset.url || "");
          btn.textContent = ok ? "Subscribe link copied" : "Copy failed — use the link above";
        });
      }
    } catch (e) {
      if (box) box.innerHTML = `<p class="error">${e.message}</p>`;
    }
  });
}


const coverForm = $("#cover-form");
if (coverForm) {
  const traditionId = coverForm.dataset.traditionId;
  const err = $("#cover-error");
  const status = $("#cover-status");
  coverForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError(err, "");
    if (status) status.textContent = "";
    const file = $("#cover-file")?.files?.[0];
    if (!file) {
      showError(err, "Choose a photo first.");
      return;
    }
    const btn = coverForm.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      if (status) status.textContent = "Shrinking the photo…";
      const res = await postCover({ traditionId, file });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not use that photo as the cover.");
      location.reload();
    } catch (e) {
      showError(err, friendlyError(e));
      if (status) status.textContent = "";
      if (btn) btn.disabled = false;
    }
  });
  document.querySelectorAll(".cover-pick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      showError(err, "");
      btn.disabled = true;
      try {
        const res = await postCover({ traditionId, mediaId: btn.dataset.mediaId });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not use that photo as the cover.");
        location.reload();
      } catch (e) {
        showError(err, friendlyError(e));
        btn.disabled = false;
      }
    });
  });
  const clearBtn = $("#cover-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      showError(err, "");
      clearBtn.disabled = true;
      try {
        const res = await postCover({ traditionId, clear: true });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not take the cover off.");
        location.reload();
      } catch (e) {
        showError(err, friendlyError(e));
        clearBtn.disabled = false;
      }
    });
  }
}

function setupYearsPlayer() {
  const btn = $("#play-years");
  const dataNode = $("#years-data");
  if (!btn || !dataNode) return;
  let payload;
  try { payload = JSON.parse(dataNode.textContent || "[]"); } catch { payload = []; }
  const years = Array.isArray(payload) ? payload : (payload.years || []);
  const cover = Array.isArray(payload) ? null : payload.cover;
  const hue = Array.isArray(payload) ? "" : (payload.hue || "");
  const tradName = Array.isArray(payload) ? "" : (payload.name || "");
  if ((!Array.isArray(years) || !years.length) && !cover) return;

  const frames = [];
  if (cover && cover.url) frames.push({ type: "cover", url: cover.url, name: tradName });
  else frames.push({ type: "cover-fallback", hue, name: tradName });
  for (const year of years) {
    frames.push({ type: "year", year: year.year, note: year.note || "" });
    for (const photo of year.photos || []) frames.push({ type: "photo", year: year.year, ...photo });
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const YEAR_MS = reduce ? 0 : 1400;
  const PHOTO_MS = reduce ? 0 : 3500;
  let index = 0;
  let timer = 0;
  let playing = !reduce;
  let overlay;

  function stopTimer() {
    if (timer) clearTimeout(timer);
    timer = 0;
  }

  function schedule() {
    stopTimer();
    if (!playing) return;
    const frame = frames[index];
    const wait = frame.type === "year" ? YEAR_MS : PHOTO_MS;
    if (!wait) return;
    timer = setTimeout(() => { show(index + 1); }, wait);
  }

  function show(i) {
    if (i < 0) i = 0;
    if (i >= frames.length) {
      playing = false;
      stopTimer();
      i = frames.length - 1;
    }
    index = i;
    const frame = frames[i];
    const stage = overlay.querySelector(".yp-stage");
    const playBtn = overlay.querySelector("[data-yp=play]");
    if (frame.type === "cover") {
      stage.innerHTML = `<img class="yp-cover" alt="" src=""><p class="yp-year"></p>`;
      stage.querySelector("img").src = frame.url;
      if (frame.name) stage.querySelector(".yp-year").textContent = frame.name;
    } else if (frame.type === "cover-fallback") {
      const hueClass = frame.hue ? ` hue-${frame.hue}` : "";
      stage.innerHTML = `<div class="yp-cover fallback${hueClass}" aria-hidden="true"></div><p class="yp-year"></p>`;
      if (frame.name) stage.querySelector(".yp-year").textContent = frame.name;
    } else if (frame.type === "year") {
      stage.innerHTML = `<h2 class="yp-year">${frame.year}</h2>${frame.note ? `<p class="yp-note"></p>` : ""}`;
      const note = stage.querySelector(".yp-note");
      if (note) note.textContent = frame.note;
    } else if ((frame.mime || "").startsWith("image/") || frame.url) {
      stage.innerHTML = `<p class="yp-year">${frame.year}</p><img alt="" src="">`;
      stage.querySelector("img").src = frame.url;
    }
    if (playBtn) playBtn.textContent = playing ? "Pause" : "Play";
    schedule();
  }

  function close() {
    stopTimer();
    overlay?.remove();
    overlay = null;
    document.body.style.overflow = "";
  }

  function open() {
    overlay = document.createElement("div");
    overlay.className = "years-player";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Watch the years");
    overlay.innerHTML = `<button class="yp-close" type="button" data-yp="close">Close</button>
      <div class="yp-stage"></div>
      <div class="yp-controls">
        <button class="btn secondary" type="button" data-yp="prev">Previous</button>
        <button class="btn" type="button" data-yp="play">Pause</button>
        <button class="btn secondary" type="button" data-yp="next">Next</button>
      </div>`;
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    overlay.addEventListener("click", (event) => {
      const act = event.target.closest("[data-yp]")?.dataset.yp;
      if (act === "close") close();
      if (act === "prev") { playing = false; show(index - 1); }
      if (act === "next") { playing = false; show(index + 1); }
      if (act === "play") {
        playing = !playing;
        if (playing) show(index + 1);
        else {
          stopTimer();
          const playBtn = overlay.querySelector("[data-yp=play]");
          if (playBtn) playBtn.textContent = "Play";
        }
      }
    });
    document.addEventListener("keydown", onKey);
    function onKey(event) {
      if (!overlay) return;
      if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
      if (event.key === "ArrowRight") { playing = false; show(index + 1); }
      if (event.key === "ArrowLeft") { playing = false; show(index - 1); }
    }
    index = 0;
    playing = !reduce;
    show(0);
  }

  btn.addEventListener("click", open);
}

setupYearsPlayer();

// Ideas: filter chips by season, age, type, and place. Without JavaScript the
// chips stay hidden and every idea shows. Matching mirrors ideaMatches() in
// src/ideas.js: "Whole family" fits every kid age, "Anywhere" fits every place,
// and "Any time" ideas fit every season.
function setupIdeaFilters() {
  const box = $("#idea-filters");
  const list = $("#idea-list");
  if (!box || !list) return;
  const cards = Array.from(list.querySelectorAll(".idea-card"));
  const empty = $("#idea-empty");
  const reset = $("#idea-reset");
  const picked = { season: "", age: "", type: "", place: "" };
  box.hidden = false;

  function has(card, key, value) {
    return (card.dataset[key] || "").split(" ").includes(value);
  }
  function matches(card) {
    const { season, age, type, place } = picked;
    if (season && !has(card, "season", season) && !has(card, "season", "any")) return false;
    if (age && !has(card, "age", age) && !(age !== "adults" && age !== "grand" && has(card, "age", "family"))) return false;
    if (type && !has(card, "type", type)) return false;
    if (place && !has(card, "place", place) && !has(card, "place", "anywhere")) return false;
    return true;
  }
  function apply() {
    let shown = 0;
    for (const card of cards) {
      const ok = matches(card);
      card.hidden = !ok;
      if (ok) shown += 1;
    }
    if (empty) empty.classList.toggle("hidden", shown > 0);
    const any = Object.values(picked).some(Boolean);
    if (reset) reset.classList.toggle("hidden", !any);
    for (const chip of box.querySelectorAll(".chip")) {
      chip.setAttribute("aria-pressed", String(picked[chip.dataset.filter] === chip.dataset.value));
    }
  }
  box.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (chip) {
      const key = chip.dataset.filter;
      const value = chip.dataset.value;
      picked[key] = picked[key] === value ? "" : value;
      apply();
      return;
    }
    if (event.target.closest("#idea-reset-btn")) {
      for (const key of Object.keys(picked)) picked[key] = "";
      apply();
    }
  });
  apply();
}

setupIdeaFilters();

const ideaShareForm = $("#idea-share-form");
if (ideaShareForm) {
  ideaShareForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#idea-share-error");
    const ok = $("#idea-share-ok");
    const btn = ideaShareForm.querySelector("button[type=submit]");
    showError(err, "");
    if (ok) ok.classList.add("hidden");
    setBusy(btn, true, "Sending…");
    try {
      const data = Object.fromEntries(new FormData(ideaShareForm).entries());
      const res = await fetch("/api/ideas/share", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That didn't work. Try again.");
      ideaShareForm.reset();
      if (ok) {
        ok.textContent = body.message || "Thank you! We'll read it soon.";
        ok.classList.remove("hidden");
      }
    } catch (e) {
      showError(err, friendlyError(e));
    } finally {
      setBusy(btn, false);
    }
  });
}

// /sample: draw the example family's month and "Coming up" in the visitor's
// own time zone. Read-only; everything comes from the page itself.
function setupSample() {
  const list = $("#sample-list");
  if (!list) return;
  const items = [...list.querySelectorAll(".sample-item")].map((el) => ({
    el,
    name: el.dataset.name,
    slug: el.dataset.slug,
    hue: [...el.classList].find((c) => c.startsWith("hue-")) || "hue-blue",
    type: el.dataset.type,
    month: Number(el.dataset.month),
    day: Number(el.dataset.day),
    nth: Number(el.dataset.nth),
    weekday: Number(el.dataset.weekday),
  }));
  const dim = (y, m) => new Date(y, m, 0).getDate();
  function dayIn(t, y) {
    if (t.type === "fixed") return t.day <= dim(y, t.month) ? t.day : null;
    if (t.nth === -1) {
      const last = dim(y, t.month);
      return last - ((new Date(y, t.month - 1, last).getDay() - t.weekday + 7) % 7);
    }
    const d = 1 + ((t.weekday - new Date(y, t.month - 1, 1).getDay() + 7) % 7) + (t.nth - 1) * 7;
    return d <= dim(y, t.month) ? d : null;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  function nextDate(t) {
    for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
      const d = dayIn(t, y);
      if (!d) continue;
      const date = new Date(y, t.month - 1, d);
      if (date >= today) return date;
    }
    return null;
  }
  const soon = items
    .map((t) => ({ ...t, date: nextDate(t) }))
    .filter((t) => t.date)
    .sort((a, b) => a.date - b.date);
  const within = soon.filter((t) => (t.date - today) / 86400000 <= 30);
  const show = within.length ? within.slice(0, 3) : soon.slice(0, 1);
  const words = (days) => days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 14 ? `In ${days} days` : days < 60 ? `In ${Math.round(days / 7)} weeks` : `In ${Math.round(days / 30)} months`;
  const fmt = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const soonBox = $("#sample-soon");
  if (soonBox && show.length) {
    const ul = soonBox.querySelector(".soon-list");
    for (const t of show) {
      const days = Math.round((t.date - today) / 86400000);
      const li = document.createElement("li");
      li.className = `soon-item ${t.hue}`;
      li.innerHTML = `<span class="soon-link"><img class="cal-thumb" alt="" src="/sample/art/${t.slug}.svg"><span class="soon-text"><strong></strong><span class="muted"></span></span></span><a class="soon-ics" href="/sample/${t.slug}.ics">Add to calendar</a>`;
      li.querySelector("strong").textContent = t.name;
      li.querySelector(".muted").textContent = `${words(days)} · ${fmt(t.date)}`;
      ul.appendChild(li);
    }
    soonBox.classList.remove("hidden");
  }

  const cal = $("#sample-cal");
  if (!cal) return;
  let year = (soon[0]?.date || today).getFullYear();
  let month = (soon[0]?.date || today).getMonth() + 1;
  function draw() {
    const title = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    cal.querySelector(".cal-title").textContent = title;
    const grid = cal.querySelector(".cal-grid");
    grid.setAttribute("aria-label", title);
    grid.innerHTML = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
    const first = new Date(year, month - 1, 1).getDay();
    const count = dim(year, month);
    const cells = Math.ceil((first + count) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const day = i - first + 1;
      const cell = document.createElement("div");
      if (day < 1 || day > count) {
        cell.className = "cal-day outside";
        cell.setAttribute("aria-hidden", "true");
      } else {
        const isToday = year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate();
        cell.className = `cal-day${isToday ? " today" : ""}`;
        const num = document.createElement("span");
        num.className = "cal-num";
        num.textContent = day;
        cell.appendChild(num);
        for (const t of items) {
          if (t.month !== month || dayIn(t, year) !== day) continue;
          const pill = document.createElement("span");
          pill.className = `cal-pill ${t.hue}`;
          pill.innerHTML = `<img class="cal-thumb" alt="" src="/sample/art/${t.slug}.svg"><span class="cal-pill-name"></span>`;
          pill.querySelector(".cal-pill-name").textContent = t.name;
          cell.appendChild(pill);
        }
      }
      grid.appendChild(cell);
    }
  }
  cal.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      month += Number(btn.dataset.step);
      if (month < 1) { month = 12; year -= 1; }
      if (month > 12) { month = 1; year += 1; }
      draw();
    });
  });
  draw();
  cal.classList.remove("hidden");
}

setupSample();
