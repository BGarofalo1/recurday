// Node-only checks for the Ideas library, its filters, and the share form.
import { IDEAS, SEASONS, AGES, TYPES, PLACES, ideaMatches, filterIdeas, renderIdeasBody, ideaBySlug } from "../src/ideas.js";
import { parseTiming, occurDate } from "../src/calendar.js";
import { shareIdea, IDEA_SHARE_IP_LIMIT } from "../src/submissions.js";

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failed += 1; console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
const keys = (list) => new Set(list.map(([k]) => k));
const count = (pred) => IDEAS.filter(pred).length;

check("ideas library has 100-150 ideas", IDEAS.length >= 100 && IDEAS.length <= 150, String(IDEAS.length));
check("idea slugs are unique", new Set(IDEAS.map((i) => i.slug)).size === IDEAS.length);
check("original idea slugs still work", ["grinch-movie-night", "first-snow-pancakes", "flashlight-walk", "backwards-dinner", "kids-cook-night", "porch-breakfast", "half-birthday-cake", "porch-campout", "stargaze-night", "library-saturday", "leaf-pile-day"].every((s) => ideaBySlug(s)));
check("Grinch Movie Night is kept", ideaBySlug("grinch-movie-night")?.timing === "Second Saturday in December");
check("every idea is short, with a name, a one-line how-to, and a date", IDEAS.every((i) => i.name && i.name.length <= 40 && i.practice && i.practice.length <= 120 && i.timing));
check("every idea date can be put on the calendar", IDEAS.every((i) => parseTiming(i.timing)), IDEAS.filter((i) => !parseTiming(i.timing)).map((i) => i.name).join(", "));
check("every idea has known tags", IDEAS.every((i) =>
  i.seasons.length && i.seasons.every((t) => keys(SEASONS).has(t)) &&
  i.ages.length && i.ages.every((t) => keys(AGES).has(t)) &&
  i.types.length && i.types.every((t) => keys(TYPES).has(t)) &&
  i.places.length && i.places.every((t) => keys(PLACES).has(t))));

// Never on the big days themselves.
const bigDays = ["12-24", "12-25", "12-31", "01-01", "07-04", "10-31", "02-14"];
const onBigDay = [];
for (const i of IDEAS) {
  const rule = parseTiming(i.timing);
  for (let y = 2026; y < 2046; y++) {
    const d = occurDate(rule, y);
    if (d && bigDays.includes(d.slice(5))) { onBigDay.push(`${i.name} ${d}`); break; }
  }
}
check("no idea ever lands on a big holiday (or Oct 31)", onBigDay.length === 0, onBigDay.join(", "));

const spooky = IDEAS.filter((i) => i.types.includes("spooky"));
check("at least 6 spooky-season ideas, all in October", spooky.length >= 6 && spooky.every((i) => parseTiming(i.timing).month === 10));
const faith = IDEAS.filter((i) => i.types.includes("faith"));
const faithText = faith.map((i) => `${i.name} ${i.practice}`).join(" ");
check("faith ideas span several traditions", faith.length >= 10 && /Bible|hymn/i.test(faithText) && /Shabbat|Havdalah|Tzedakah/.test(faithText) && /du'a|Sadaqah/.test(faithText) && /diya|bhajan|Seva/i.test(faithText) && /Mindful|Kindness/.test(faithText) && /Gratitude|thank/i.test(faithText));
for (const [tag, min] of [["adults", 8], ["grand", 8], ["teens", 8], ["little", 8]]) {
  check(`ideas for ${tag}`, count((i) => i.ages.includes(tag)) >= min);
}
for (const [tag, min] of [["breakfast", 6], ["lunch", 5], ["dinner", 8], ["restaurants", 6], ["movies", 6], ["games", 6], ["sports", 6], ["music", 6], ["outdoors", 10], ["crafts", 5], ["giving", 5]]) {
  check(`ideas of type ${tag}`, count((i) => i.types.includes(tag)) >= min);
}
for (const tag of ["snowy", "warm", "city", "country", "beach"]) {
  check(`ideas for ${tag} places`, count((i) => i.places.includes(tag)) >= 5);
}
for (const tag of ["winter", "spring", "summer", "fall"]) {
  check(`ideas in ${tag}`, count((i) => i.seasons.includes(tag)) >= 15);
}

// Filters.
check("no filters shows everything", filterIdeas({}).length === IDEAS.length);
check("season filter keeps that season and any-time ideas", filterIdeas({ season: "fall" }).every((i) => i.seasons.includes("fall") || i.seasons.includes("any")) && filterIdeas({ season: "fall" }).some((i) => i.slug === "leaf-pile-day") && !filterIdeas({ season: "fall" }).some((i) => i.slug === "grinch-movie-night"));
check("type filter is exact", filterIdeas({ type: "spooky" }).length === spooky.length);
check("whole-family ideas show for kid ages", ideaMatches(ideaBySlug("porch-breakfast"), { age: "little" }) && !ideaMatches(ideaBySlug("teen-picks-the-movie"), { age: "little" }));
check("adults filter doesn't show kid-only ideas", !filterIdeas({ age: "adults" }).some((i) => i.ages.every((a) => ["little", "big"].includes(a))));
check("anywhere ideas show for every place", ideaMatches(ideaBySlug("grinch-movie-night"), { place: "beach" }) && !ideaMatches(ideaBySlug("first-snow-pancakes"), { place: "beach" }));
check("filters combine", filterIdeas({ season: "winter", type: "breakfast", place: "snowy" }).every((i) => i.types.includes("breakfast")) && filterIdeas({ season: "winter", type: "breakfast", place: "snowy" }).some((i) => i.slug === "first-snow-pancakes"));

const body = renderIdeasBody();
check("ideas page lists every idea without JavaScript", (body.match(/class="card idea-card"/g) || []).length === IDEAS.length);
check("filter chips are hidden until JavaScript shows them", /<div class="idea-filters" id="idea-filters" hidden>/.test(body) && ["Season", "Age", "Type", "Place"].every((l) => body.includes(`aria-label="${l}"`)));
check("cards carry their tags for the filters", body.includes('data-type="movies"') && body.includes('data-place="snowy"'));
check("ideas page has a share form with a honeypot", body.includes('action="/api/ideas/share"') && body.includes('name="website"') && body.includes('maxlength="200"'));
check("ideas page has no likes, counts, or rankings", !/\blikes\b|like button|leaderboard|popular|ranked|\bvotes?\b/i.test(body));

// Share an idea (with a tiny fake D1).
function fakeDb() {
  const rows = [];
  const limits = new Map();
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          if (sql.includes("FROM login_attempts")) return limits.get(args[0]) || null;
          if (sql.includes("COUNT(*)")) return { n: rows.filter((r) => r.status === "pending").length };
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO idea_submissions")) {
            const [id, name, practice, timing, season, age, type, created_at] = args;
            rows.push({ id, name, practice, timing, season, age, type, status: "pending", created_at });
          } else if (sql.startsWith("INSERT INTO login_attempts")) {
            limits.set(args[0], { key: args[0], fail_count: args[1], locked_until: args[2] });
          } else if (sql.startsWith("UPDATE login_attempts")) {
            const key = args[args.length - 1];
            const row = limits.get(key);
            if (args.length === 3) row.fail_count = args[0];
            else { row.fail_count = args[0]; row.locked_until = args[1]; }
          }
          return {};
        },
      };
      return stmt;
    },
  };
}
const post = (data, ip = "203.0.113.5", json = true) => new Request("https://r.test/api/ideas/share", {
  method: "POST",
  headers: json ? { "content-type": "application/json", "cf-connecting-ip": ip } : { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip },
  body: json ? JSON.stringify(data) : new URLSearchParams(data).toString(),
});
const db = fakeDb();
const env = { DB: db };
let res = await shareIdea(post({ name: "Pancake Saturday", practice: "Everyone flips one pancake.", timing: "First Saturday in March", season: "spring", age: "family", type: "breakfast" }), env);
check("a shared idea is saved to the review queue", res.status === 200 && (await res.json()).ok === true && db.rows.length === 1 && db.rows[0].status === "pending" && db.rows[0].type === "breakfast");
res = await shareIdea(post({ name: "Spam", practice: "Buy things now please", website: "http://x" }), env);
check("honeypot gets a thank-you but saves nothing", res.status === 200 && db.rows.length === 1);
res = await shareIdea(post({ name: "x", practice: "ok" }), env);
check("too-short ideas are refused", res.status === 400 && db.rows.length === 1);
res = await shareIdea(post({ name: "Visit us", practice: "Go to https://example.com today" }), env);
check("links are refused", res.status === 400 && db.rows.length === 1);
res = await shareIdea(post({ name: "N".repeat(500), practice: "P".repeat(900), timing: "T".repeat(300), season: "nope", type: "<script>" }), env);
const long = db.rows[db.rows.length - 1];
check("long ideas are trimmed and unknown tags dropped", res.status === 200 && long.name.length === 80 && long.practice.length === 200 && long.timing.length === 80 && long.season === "" && long.type === "");
res = await shareIdea(post({ name: "Porch songs", practice: "Sing on the porch after dinner." }, "198.51.100.9", false), env);
const page = await res.text();
check("a plain form post gets a thank-you page", res.status === 200 && page.includes("Thank you!") && page.includes('href="/ideas"'));
let limited = 0;
for (let n = 0; n < IDEA_SHARE_IP_LIMIT + 2; n++) {
  const r = await shareIdea(post({ name: `Idea ${n}`, practice: "Something small and kind." }, "192.0.2.77"), env);
  if (r.status === 429) limited += 1;
}
check("sharing is rate-limited per address", limited >= 1);

if (failed) { console.error(`\n${failed} ideas check(s) failed`); process.exit(1); }
console.log("\nideas checks passed");
