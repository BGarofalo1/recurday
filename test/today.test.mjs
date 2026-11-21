// "Today" follows the family's time zone, not the server's (UTC).
import { localDate, todayFor, timeZoneFrom, validTimeZone, DEFAULT_TZ, upcomingFor, daysBetween, whenWords } from "../src/calendar.js";

let failed = 0;
let passed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}
const req = (cookie) => new Request("https://example.test/calendar", { headers: cookie ? { cookie } : {} });

// 10 PM Eastern on Friday Nov 20, 2026 is already 3 AM Nov 21 in UTC.
const tenPmEt = Date.parse("2026-11-21T03:00:00Z");
check("10 PM ET is still Nov 20 for a New York family", todayFor(req("recurday_tz=America%2FNew_York"), tenPmEt) === "2026-11-20");
check("with no time zone cookie, fall back to New York (not UTC)", todayFor(req(""), tenPmEt) === "2026-11-20");
check("the same moment is Nov 20 in Los Angeles", todayFor(req("a=1; recurday_tz=America/Los_Angeles"), tenPmEt) === "2026-11-20");
check("the same moment is Nov 21 in Tokyo", todayFor(req("recurday_tz=Asia%2FTokyo; recurday_session=x"), tenPmEt) === "2026-11-21");
check("the same moment is Nov 21 in London", todayFor(req("recurday_tz=Europe%2FLondon"), tenPmEt) === "2026-11-21");
check("a made-up time zone falls back to New York", todayFor(req("recurday_tz=Mars%2FOlympus"), tenPmEt) === "2026-11-20");
check("a hostile cookie value falls back to New York", timeZoneFrom('recurday_tz="><script>') === DEFAULT_TZ && validTimeZone("../../etc") === null);
check("daylight saving: 11:30 PM EDT on July 4 is still July 4", localDate("America/New_York", Date.parse("2026-07-05T03:30:00Z")) === "2026-07-04");
check("New Year's Eve at 10 PM ET is still the old year", localDate("America/New_York", Date.parse("2027-01-01T03:00:00Z")) === "2026-12-31");

// Coming up counts days from the family's own today.
const trad = { id: "x", name: "Lantern Walk", recur_type: "fixed", recur_month: 11, recur_day: 29 };
const today = todayFor(req(""), tenPmEt);
const [item] = upcomingFor([trad], today, 4);
check("Coming up at 10 PM ET says In 9 days for Nov 29 (UTC would say 8)", item && whenWords(daysBetween(today, item.date)) === "In 9 days", JSON.stringify(item));
const todayItem = upcomingFor([{ ...trad, recur_day: 20 }], today, 4)[0];
check("a tradition on Nov 20 still shows Today at 10 PM ET", todayItem && whenWords(daysBetween(today, todayItem.date)) === "Today");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
