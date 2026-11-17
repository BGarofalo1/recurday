import { parseTiming, occurDate } from "./calendar.js";
import { esc } from "./http.js";

/** Public tradition ideas a family can borrow and make their own. No photos, counts, or names. */
export const IDEAS = [
  {
    slug: "grinch-movie-night",
    name: "Grinch Movie Night",
    practice: "Everyone brings something green. No green, no screen.",
    timing: "Second Saturday in December",
  },
  {
    slug: "first-snow-pancakes",
    name: "First-snow pancakes",
    practice: "Make pancakes the first time it snows, or on this Saturday if the snow is late.",
    timing: "Second Saturday in January",
  },
  {
    slug: "flashlight-walk",
    name: "Flashlight walk",
    practice: "After dark, walk around the block with flashlights. Cocoa when you get home.",
    timing: "First Friday in February",
  },
  {
    slug: "backwards-dinner",
    name: "Backwards dinner",
    practice: "Dessert first, then dinner. Pajamas are welcome.",
    timing: "Second Friday in March",
  },
  {
    slug: "kids-cook-night",
    name: "Kids-cook night",
    practice: "The kids make dinner. Grown-ups set the table and wash up.",
    timing: "Second Sunday in April",
  },
  {
    slug: "porch-breakfast",
    name: "Porch breakfast",
    practice: "Eat breakfast outside, even if it's a little chilly.",
    timing: "First Saturday in May",
  },
  {
    slug: "half-birthday-cake",
    name: "Half-birthday cake",
    practice: "A little cake, halfway to a birthday. Candles are optional.",
    timing: "Second Saturday in June",
  },
  {
    slug: "porch-campout",
    name: "Porch campout",
    practice: "Sleep on the porch or in the yard. Flashlights and stories.",
    timing: "Second Saturday in July",
  },
  {
    slug: "stargaze-night",
    name: "Stargaze night",
    practice: "Lie on a blanket and look at the stars.",
    timing: "Second Friday in August",
  },
  {
    slug: "library-saturday",
    name: "Library Saturday",
    practice: "Everyone picks a book. Read a little together after.",
    timing: "Third Saturday in September",
  },
  {
    slug: "leaf-pile-day",
    name: "Leaf-pile day",
    practice: "Rake a big pile and jump in it.",
    timing: "Third Saturday in October",
  },
];

export function ideaBySlug(slug) {
  const key = String(slug || "").trim().toLowerCase();
  return IDEAS.find((idea) => idea.slug === key) || null;
}

export function ideaRecurType(idea) {
  const rule = idea ? parseTiming(idea.timing) : null;
  return rule?.type === "nth_weekday" ? "nth_weekday" : "fixed";
}

export function nextIdeaDate(idea, fromIso) {
  const from = String(fromIso || "").slice(0, 10);
  const rule = idea ? parseTiming(idea.timing) : null;
  if (!rule || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return from;
  const year = Number(from.slice(0, 4));
  for (let y = year; y <= year + 2; y++) {
    const date = occurDate(rule, y);
    if (date && date >= from) return date;
  }
  return from;
}

export function renderIdeasBody() {
  const cards = IDEAS.map((idea) => `
    <article class="card idea-card">
      <h2>${esc(idea.name)}</h2>
      <p class="idea-how">${esc(idea.practice)}</p>
      <p class="idea-when">${esc(idea.timing)}</p>
      <a class="btn" href="/calendar?idea=${esc(idea.slug)}">Make it ours</a>
    </article>`).join("");
  return `
    <h1>Ideas</h1>
    <p class="lead">Borrow one. Make it yours.</p>
    <p class="support">Not a contest. Just days a family can keep at home.</p>
    <div class="idea-list">
      ${cards}
    </div>
    <p class="start-own-quiet"><a href="/">Back</a></p>`;
}
