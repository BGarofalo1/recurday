/**
 * /sample: a read-only example calendar anyone can open before signing up.
 * Everything here is made up and bundled with the app (drawings, not photos).
 * Nothing is read from or written to family data. The page is prebuilt into
 * public/sample.html by scripts/build-static.mjs, so it is served as a free
 * static file; a tiny bit of app.js draws the month and "Coming up" in the
 * visitor's own time zone.
 */
import { html, esc, pageShell, originOf } from "./http.js";
import { describeRule, singleIcs } from "./calendar.js";

export const SAMPLE_FAMILY = "The Example Family";

// Days families make their own, away from the big holidays.
export const SAMPLE_TRADITIONS = [
  { slug: "pajama-pancakes", name: "Pajama Pancake Breakfast", hue: "yellow", art: "pancakes",
    rule: { type: "nth_weekday", month: 1, nth: 3, weekday: 6 },
    practice: "Nobody gets dressed. Whoever wakes up last flips the first pancake." },
  { slug: "kite-day", name: "Kite Day", hue: "blue", art: "kite",
    rule: { type: "nth_weekday", month: 3, nth: 2, weekday: 0 },
    practice: "First windy Sunday of spring. Everyone decorates a tail ribbon." },
  { slug: "backyard-picnic", name: "Backyard Picnic Supper", hue: "green", art: "picnic",
    rule: { type: "nth_weekday", month: 5, nth: 1, weekday: 6 },
    practice: "Dinner on a blanket. Each kid packs one surprise snack." },
  { slug: "first-swim", name: "First Swim of Summer", hue: "blue", art: "swim",
    rule: { type: "fixed", month: 6, day: 21 },
    practice: "Longest day of the year. Cannonball contest, judged by Grandpa." },
  { slug: "backyard-campout", name: "Backyard Campout", hue: "indigo", art: "tent",
    rule: { type: "nth_weekday", month: 8, nth: 2, weekday: 6 },
    practice: "Tent in the yard, flashlight stories, pancakes in the morning." },
  { slug: "stargazing", name: "Stargazing Night", hue: "indigo", art: "stars",
    rule: { type: "nth_weekday", month: 9, nth: 3, weekday: 5 },
    practice: "Blankets on the grass. Everyone names one star." },
  { slug: "apple-picking", name: "Apple Picking Day", hue: "red", art: "apple",
    rule: { type: "nth_weekday", month: 10, nth: 1, weekday: 0 },
    practice: "Pick a bag, then bake one pie together that night." },
  { slug: "leaf-pile", name: "Leaf-Pile Day", hue: "orange", art: "leaves",
    rule: { type: "nth_weekday", month: 11, nth: 2, weekday: 6 },
    practice: "Rake the biggest pile of the year. Then everyone jumps in." },
  { slug: "cocoa-lights", name: "Cocoa and Lights Walk", hue: "violet", art: "cocoa",
    rule: { type: "nth_weekday", month: 12, nth: 1, weekday: 5 },
    practice: "Cocoa in travel mugs, a slow walk to see the first lights." },
];

const HUES = {
  red: ["#fde4e0", "#e4452e"], orange: ["#fdebd9", "#f07812"], yellow: ["#fdf3cf", "#e0a800"],
  green: ["#dff1e3", "#2fa24c"], blue: ["#dde9fb", "#2b7de1"], indigo: ["#e3e0f6", "#4b3cb8"],
  violet: ["#efe0f6", "#8d2db5"],
};

const ICONS = {
  pancakes: `<ellipse cx="80" cy="74" rx="34" ry="8"/><ellipse cx="80" cy="64" rx="30" ry="8"/><ellipse cx="80" cy="54" rx="26" ry="8"/><rect x="72" y="42" width="16" height="8" rx="2"/>`,
  kite: `<path d="M80 18 104 46 80 74 56 46Z"/><path d="M80 74c-6 8 6 12 0 20" fill="none" stroke="#fff" stroke-width="3"/>`,
  picnic: `<circle cx="120" cy="28" r="12"/><path d="M34 82h92l-12-26H46Z"/><rect x="66" y="40" width="28" height="18" rx="4"/>`,
  swim: `<circle cx="116" cy="30" r="13"/><path d="M28 62q13-10 26 0t26 0 26 0 26 0M28 80q13-10 26 0t26 0 26 0 26 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  tent: `<path d="M118 22a12 12 0 1 0 8 20 14 14 0 0 1-8-20Z"/><path d="M80 30 116 84H44Z"/><path d="M80 52 92 84H68Z" opacity=".55"/>`,
  stars: `<path d="M50 30l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Z"/><path d="M104 22l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z"/><path d="M92 58l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Z"/><circle cx="128" cy="60" r="3"/><circle cx="36" cy="70" r="3"/>`,
  apple: `<circle cx="80" cy="58" r="24"/><path d="M80 34c0-8 4-12 10-14" fill="none" stroke="#fff" stroke-width="4"/><path d="M84 30c8-8 18-6 20-2-6 6-14 6-20 2Z"/>`,
  leaves: `<path d="M48 70c-6-22 10-36 30-34-2 20-12 34-30 34Z"/><path d="M84 78c4-22 22-30 40-22-8 18-22 26-40 22Z"/><path d="M70 46c-2-14 8-24 20-24 0 14-8 22-20 24Z" opacity=".7"/>`,
  cocoa: `<rect x="58" y="44" width="40" height="38" rx="6"/><path d="M98 52h6a10 10 0 0 1 0 20h-6" fill="none" stroke="#fff" stroke-width="5"/><path d="M68 36c-4-6 4-8 0-14M80 36c-4-6 4-8 0-14M92 36c-4-6 4-8 0-14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
};

/** A small drawing for one example tradition (about 0.5 KB each). */
export function sampleArt(t) {
  const [wash, hue] = HUES[t.hue] || HUES.blue;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" width="160" height="100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wash}"/><stop offset="1" stop-color="${hue}"/></linearGradient></defs>` +
    `<rect width="160" height="100" fill="url(#g)"/><g fill="#fff">${ICONS[t.art] || ""}</g></svg>\n`;
}

/** Fixed start date so the prebuilt files never change unless the data does. */
export function sampleIcs(t, origin) {
  return singleIcs({
    id: `sample-${t.slug}`,
    name: t.name,
    rule: t.rule,
    timing: describeRule(t.rule),
    practice: `${t.practice} (An example from Recurday.)`,
    fromIso: "2026-01-01",
    url: `${origin}/sample`,
  }).replace(/^DTSTAMP:.*$/m, "DTSTAMP:20260101T000000Z");
}

function ruleAttrs(rule) {
  if (rule.type === "fixed") return `data-type="fixed" data-month="${rule.month}" data-day="${rule.day}"`;
  return `data-type="nth_weekday" data-month="${rule.month}" data-nth="${rule.nth}" data-weekday="${rule.weekday}"`;
}

export function renderSampleBody() {
  const cards = SAMPLE_TRADITIONS.map((t) => `
      <li class="sample-item hue-${esc(t.hue)}" ${ruleAttrs(t.rule)} data-name="${esc(t.name)}" data-slug="${esc(t.slug)}">
        <img class="sample-art" src="/sample/art/${esc(t.slug)}.svg" width="160" height="100" alt="" loading="lazy">
        <div class="sample-text">
          <h3>${esc(t.name)}</h3>
          <p class="muted">${esc(describeRule(t.rule))}</p>
          <p class="practice">${esc(t.practice)}</p>
          <a class="soon-ics" href="/sample/${esc(t.slug)}.ics">Add to calendar</a>
        </div>
      </li>`).join("");
  return `
    <p class="eyebrow">An example · ${esc(SAMPLE_FAMILY)}</p>
    <h1>See how it works</h1>
    <p class="notice sample-note">This is a made-up family to show you around. The pictures are drawings, not real photos. Nothing here is anyone's real data.</p>
    <div class="actions-primary">
      <a class="btn btn-lg" href="/#start">Start your own</a>
    </div>
    <section class="soon hidden" id="sample-soon" aria-label="Coming up">
      <h2>Coming up</h2>
      <ul class="soon-list"></ul>
      <p class="hint">In your own calendar, Recurday shows what's coming up, and Add to calendar puts it on your phone with a reminder a week before and the day before.</p>
    </section>
    <div class="card cal-card hidden" id="sample-cal">
      <div class="cal-nav">
        <button class="btn secondary cal-nav-btn" type="button" data-step="-1">Previous</button>
        <h2 class="cal-title" aria-live="polite"></h2>
        <button class="btn secondary cal-nav-btn" type="button" data-step="1">Next</button>
      </div>
      <div class="cal-grid"></div>
    </div>
    <div class="card">
      <h2>Their year</h2>
      <p class="hint">Each one comes back every year. A family adds photos of the day, then rewatches the years as the kids grow.</p>
      <ul class="sample-list" id="sample-list">${cards}
      </ul>
    </div>
    <div class="card">
      <h2>Make it yours</h2>
      <p>Name your family, pick a passcode, and add your first tradition. It's free. No email needed.</p>
      <a class="btn btn-lg" href="/#start">Start your own</a>
      <p class="hint"><a href="/ideas">Or borrow an idea</a></p>
    </div>`;
}

export function samplePage(request) {
  return html(pageShell({
    title: "An example family — Recurday",
    description: "See an example Recurday family calendar before you start your own.",
    ogTitle: "See an example — Recurday",
    ogDescription: "A made-up family's traditions, to show how Recurday works.",
    origin: originOf(request),
    body: renderSampleBody(),
  }));
}
