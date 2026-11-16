const PHOTO_MAX = 2 * 1024 * 1024;
const PHOTO_EDGE = 1600;

const $ = (sel, root = document) => root.querySelector(sel);

async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  let { width: w, height: h } = bitmap;
  if (w > PHOTO_EDGE || h > PHOTO_EDGE) {
    const scale = PHOTO_EDGE / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return file;
  const smaller = blob.size < file.size || file.type !== "image/jpeg";
  if (!smaller && blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

async function prepareFile(file) {
  if (file.type.startsWith("video/")) {
    throw new Error("Video coming soon.");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a photo.");
  }
  const out = await shrinkImage(file);
  if (out.size > PHOTO_MAX) {
    throw new Error("That photo is still too large after shrinking. Try a smaller one.");
  }
  return out;
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
    const url = shareBtn.dataset.url;
    const name = shareBtn.dataset.name || "our tradition";
    const text = `We're keeping ${name} on Recurday. Open this link (no app needed):\n${url}`;
    const ok = await copyText(text);
    shareBtn.textContent = ok ? "Copied — ready to text" : "Copy failed, long-press the link instead";
    setTimeout(() => {
      shareBtn.textContent = "Send to our family";
    }, 2500);
  });
}

const copyInvite = $("#copy-invite");
if (copyInvite) {
  copyInvite.addEventListener("click", async () => {
    const url = copyInvite.dataset.url;
    const ok = await copyText(`We wanted to share one of our family traditions with you, on Recurday. Open this link (no app needed):\n${url}`);
    copyInvite.textContent = ok ? "Invite link copied" : "Copy failed — use the link below";
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
      fd.set("t", token);
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
    const token = inviteForm.dataset.token || tokenFromPath();
    try {
      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          t: token,
          label: $("#label").value,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make that invite.");
      const box = document.getElementById("invite-result");
      if (box) {
        box.innerHTML = `<div class="notice"><p class="ok">Text this invite to them now. We can't show it again later.</p>
          <div class="links"><p><a href="${body.invite_path}">${body.invite_url}</a></p></div>
          <button class="btn" type="button" id="copy-invite" data-url="${body.invite_url}">Copy the invite link</button></div>`;
        const copyInvite = document.getElementById("copy-invite");
        copyInvite?.addEventListener("click", async () => {
          const ok = await copyText(`We wanted to share one of our family traditions with you, on Recurday. Open this link (no app needed):\n${copyInvite.dataset.url}`);
          copyInvite.textContent = ok ? "Invite link copied" : "Copy failed — use the link above";
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
    const token = tokenFromPath();
    try {
      const res = await fetch("/api/shares/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token, share_id: btn.dataset.revoke }),
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
        body: JSON.stringify({
          t: tokenFromPath(),
          year: Number($("#year").value),
          observed_on: $("#observed_on")?.value || "",
          note: $("#day_note")?.value || "",
        }),
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
        body: JSON.stringify({ t: rotateBtn.dataset.token || tokenFromPath() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make a fresh family link.");
      if (box) {
        box.innerHTML = `<div class="notice"><p class="ok">Here is a fresh family link. The previous one no longer works.</p>
          <div class="links"><p><a href="${body.household_path}">${body.household_url}</a></p></div>
          <button class="btn" type="button" id="copy-household" data-url="${body.household_url}" data-name="${document.querySelector("h1")?.textContent || "our tradition"}">Send to our family</button></div>`;
        const btn = document.getElementById("copy-household");
        btn?.addEventListener("click", async () => {
          const text = `We're keeping ${btn.dataset.name} on Recurday. Open this link (no app needed):\n${btn.dataset.url}`;
          const ok = await copyText(text);
          btn.textContent = ok ? "Copied — ready to text" : "Copy failed, long-press the link instead";
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
