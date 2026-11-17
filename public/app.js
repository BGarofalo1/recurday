const PHOTO_MAX = 2 * 1024 * 1024;
const PHOTO_EDGE = 1600;
const PHOTO_THUMB = 256;

const $ = (sel, root = document) => root.querySelector(sel);

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
  if (file.type.startsWith("video/")) {
    throw new Error("Video coming soon.");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a photo.");
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
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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

const familyCreate = $("#family-create-form");
if (familyCreate) {
  familyCreate.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $("#family-create-error");
    showError(err, "");
    const btn = familyCreate.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    try {
      const res = await postJson("/api/family/create", {
        name: $("#create-family-name").value,
        passcode: $("#create-passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create that family login.");
      location.href = body.calendar_path || "/calendar";
    } catch (e) {
      showError(err, e.message);
      if (btn) btn.disabled = false;
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
    if (btn) btn.disabled = true;
    try {
      const res = await postJson("/api/family/login", {
        name: $("#login-family-name").value,
        passcode: $("#login-passcode").value,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "That family name or passcode didn't work.");
      location.href = body.calendar_path || "/calendar";
    } catch (e) {
      showError(err, e.message);
      if (btn) btn.disabled = false;
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
      location.href = body.calendar_path || "/calendar";
    } catch (e) {
      showError(err, e.message);
      if (btn) btn.disabled = false;
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
      location.href = body.tradition_path || "/calendar";
    } catch (e) {
      showError(err, e.message);
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
      showError(err, e.message);
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
      showError(err, e.message);
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
        showError(err, e.message);
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
        showError(err, e.message);
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
    } else if ((frame.mime || "").startsWith("video/")) {
      stage.innerHTML = `<p class="yp-year">${frame.year}</p><video controls playsinline autoplay src=""></video>`;
      stage.querySelector("video").src = frame.url;
    } else {
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
