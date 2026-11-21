import { html, esc, pageShell, familyNav, originOf, TAGLINE, TAGLINE_SUPPORT } from "./http.js";
import { familyFromRequest } from "./family.js";
import { renderIdeasBody } from "./ideas.js";

const UPDATED = "November 20, 2026";
const SOURCE = "https://github.com/BGarofalo1/recurday";

function legalPage(request, family, { title, description, body }) {
  return html(pageShell({
    title: `${title} — Recurday`,
    description,
    ogTitle: `${title} — Recurday`,
    ogDescription: description,
    origin: originOf(request),
    nav: familyNav(family),
    body,
  }));
}

export async function privacyPage(request, env) {
  const family = await familyFromRequest(request, env);
  const body = `
    <article class="legal">
      <h1>Privacy</h1>
      <p class="hint">Last updated ${UPDATED}.</p>
      <p>This page says, in plain words, how Recurday treats your family's photos and notes. It matches what the app does today.</p>
      <h2>What we keep</h2>
      <p>We keep your family name, a hash of your passcode and of your backup code (never the passcode or code itself), the names and notes of your traditions, the photos you add, and the private links you share. We do not ask for an email, a phone number, or a personal account. Everyone at home uses the same family name and passcode.</p>
      <h2>Who can see a photo</h2>
      <p>Photos stay private to your family when you are logged in, and to people who have a link you sent. A family link can also add photos, so treat it like a house key. A pass-it-on invite hides photos until the other family accepts, and they cannot add photos to yours. Link previews use a generic picture, never your photos. There is no public list of families or traditions.</p>
      <h2>Shared ideas</h2>
      <p>If you use Share an idea, we keep only the words you send (a name, one line on how, and any tags you pick). We do not keep who sent it. It is not shown to anyone until a person reads it, and it may be added to Ideas in our own words, without your name.</p>
      <h2>No ads, no selling, no tracking</h2>
      <p>Recurday does not show ads, does not sell your data, and does not use analytics or tracking pixels. The only cookie is a sign-in cookie, so your family can stay logged in (about 180 days). It is httpOnly, which means other websites cannot read it.</p>
      <h2>Where it lives</h2>
      <p>Recurday runs on Cloudflare: a Worker serves the app, a D1 database holds names and notes, and private KV storage holds photos. To slow guessers, we may briefly store a record of an internet address after failed logins or too many uploads.</p>
      <h2>How to delete everything</h2>
      <p>Log in, open the calendar, and tap More. You can Save a copy first if you want to keep your photos. Then choose Delete our family, enter the passcode, and confirm. That removes your family's calendar, traditions, photos, and links. Those links will stop working. If you only want to stop one invite, use Pass it on and stop that share instead.</p>
      <p>Recurday is a small, free, open-source project. You can open an issue on <a href="${SOURCE}" rel="noopener noreferrer">GitHub</a>.</p>
    </article>`;
  return legalPage(request, family, {
    title: "Privacy",
    description: "How Recurday keeps family photos private. No ads, no selling data, no tracking.",
    body,
  });
}

export async function termsPage(request, env) {
  const family = await familyFromRequest(request, env);
  const body = `
    <article class="legal">
      <h1>Terms</h1>
      <p class="hint">Last updated ${UPDATED}.</p>
      <p>Recurday is a free app for family traditions. You do not have to pay or buy anything to use it. The software is offered as-is, under the MIT license, without a promise that it will always be up.</p>
      <p>You are responsible for what you add. Only upload photos your family has the right to keep here. Recurday is photos only.</p>
      <p>Photos are private to your family and to people you give a link to, as explained in <a href="/privacy">Privacy</a>. A family link works like a house key: anyone who has it can see and add photos. Keep your passcode and links to yourselves.</p>
      <p>If the photos matter to you, use Save a copy to keep a zip on your own device. Hosting may change or pause. We may slow or stop use that looks like abuse, including too many login tries or uploads.</p>
      <p>Privacy explains what we keep and how to delete it. The code is open source on <a href="${SOURCE}" rel="noopener noreferrer">GitHub</a>.</p>
    </article>`;
  return legalPage(request, family, {
    title: "Terms",
    description: "Plain terms for using Recurday, a free family-traditions app.",
    body,
  });
}

export async function aboutPage(request, env) {
  const family = await familyFromRequest(request, env);
  const body = `
    <article class="legal">
      <h1>About</h1>
      <p class="lead tagline">${esc(TAGLINE)}</p>
      <p class="support">${esc(TAGLINE_SUPPORT)}</p>
      <p>Recurday is a free app for the small days a family makes their own. Text a link, add photos of the day you keep, and come back next year to rewatch as the kids grow.</p>
      <p>Photos only — it's about staying in the moment. There is no app store, and there are no likes, rankings, or public lists.</p>
      <p>The code is open source at <a href="${SOURCE}" rel="noopener noreferrer">github.com/BGarofalo1/recurday</a>. Family photos and private links are not in that repository. They stay with the family who made them.</p>
      <p>Need a starting point? See <a href="/ideas">Ideas</a>. For how we keep data, see <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>.</p>
    </article>`;
  return legalPage(request, family, {
    title: "About",
    description: TAGLINE,
    body,
  });
}

export async function notFoundPage(request, env, message) {
  let family = null;
  try { family = env ? await familyFromRequest(request, env) : null; } catch {}
  const body = `
    <article class="legal">
      <h1>We couldn't find that page.</h1>
      <p class="lead">${esc(message || "The link may be typed wrong, or the page may have moved.")}</p>
      <p><a class="btn" href="/">Back to Recurday</a></p>
    </article>`;
  return html(pageShell({
    title: "Page not found — Recurday",
    description: "We couldn't find that page.",
    ogTitle: "Recurday",
    ogDescription: "We couldn't find that page.",
    origin: originOf(request),
    nav: familyNav(family),
    body,
  }), 404);
}

export async function ideasPage(request, env) {
  let family = null;
  try { family = env ? await familyFromRequest(request, env) : null; } catch {}
  return html(pageShell({
    title: "Ideas — Recurday",
    description: "Borrow a family tradition idea. Make it yours.",
    ogTitle: "Ideas — Recurday",
    ogDescription: "Borrow a family tradition idea. Make it yours.",
    origin: originOf(request),
    nav: familyNav(family),
    body: renderIdeasBody(),
  }));
}

/**
 * Shown when Cloudflare's free daily limits run out or the database is
 * overloaded. Nothing is lost: every save is all-or-nothing, so the family
 * can simply try again.
 */
export function busyPage(request) {
  const body = `
    <article class="legal">
      <h1>Recurday is very busy right now.</h1>
      <p class="lead">Lots of families are opening links at once. Please try again in a minute.</p>
      <p>Your photos and notes are safe. Nothing was lost.</p>
      <p><a class="btn" href="">Try again</a></p>
    </article>`;
  return html(pageShell({
    title: "Busy — Recurday",
    description: "Recurday is very busy right now. Please try again in a minute.",
    ogTitle: "Recurday",
    ogDescription: TAGLINE,
    origin: originOf(request),
    body,
  }), 503, { "retry-after": "60", "cache-control": "no-store" });
}
