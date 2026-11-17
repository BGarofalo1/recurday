import { occurDate, parseTiming, ruleFromDate, upcomingFor, buildIcs, nthWeekdayOfMonth, monthGrid, describeRule } from "../src/calendar.js";
import { hashPasscode, signSession, verifySession, validFamilyName, nameKey, seal, unseal, hexToBytes, timingSafeEqual } from "../src/auth.js";
import { ZipBuilder, crc32, slugPart } from "../src/zip.js";

let failed = 0;
let passed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const firstSat = parseTiming("First Saturday in June");
check("parses first Saturday in June", firstSat && firstSat.type === "nth_weekday" && firstSat.nth === 1 && firstSat.weekday === 6 && firstSat.month === 6, JSON.stringify(firstSat));
check("first Saturday in June 2026 is June 6", occurDate(firstSat, 2026) === "2026-06-06", occurDate(firstSat, 2026));
check("first Saturday in June 2027 is June 5", occurDate(firstSat, 2027) === "2027-06-05", occurDate(firstSat, 2027));

const secondSatDec = parseTiming("Second Saturday in December");
check("parses second Saturday in December", secondSatDec && secondSatDec.type === "nth_weekday" && secondSatDec.nth === 2 && secondSatDec.weekday === 6 && secondSatDec.month === 12, JSON.stringify(secondSatDec));
check("second Saturday in December 2026 is December 12", occurDate(secondSatDec, 2026) === "2026-12-12", occurDate(secondSatDec, 2026));
check("second Saturday in December 2027 is December 11", occurDate(secondSatDec, 2027) === "2027-12-11", occurDate(secondSatDec, 2027));

const lastFri = parseTiming("last Friday in May");
check("parses last Friday in May", lastFri && lastFri.nth === -1 && lastFri.weekday === 5 && lastFri.month === 5);
check("last Friday in May 2026 is May 29", occurDate(lastFri, 2026) === "2026-05-29", occurDate(lastFri, 2026));

const june6 = parseTiming("June 6");
check("parses June 6 as a fixed date", june6 && june6.type === "fixed" && june6.month === 6 && june6.day === 6);
check("June 6 repeats as 2026-06-06", occurDate(june6, 2026) === "2026-06-06");
check("parses 6th of June", parseTiming("6th of June")?.day === 6 && parseTiming("6th of June")?.month === 6);
check("parses ISO date", parseTiming("2024-11-28")?.month === 11 && parseTiming("2024-11-28")?.day === 28);
check("unknown wording has no rule", parseTiming("whenever it feels right") === null);

const fromDate = ruleFromDate("2026-06-06", "nth_weekday");
check("tapped June 6 2026 becomes first Saturday", fromDate && fromDate.nth === 1 && fromDate.weekday === 6 && fromDate.month === 6, JSON.stringify(fromDate));

check("nth weekday helper for 3rd Sunday in Nov 2026", nthWeekdayOfMonth(2026, 11, 3, 0) === 15);

const grid = monthGrid(2026, 6);
check("June 2026 grid starts on Monday (Mon=1, so 1 empty? June 1 2026 is Monday, Sunday start => 1 leading empty)", grid[0].day === null && grid[1].day === 1 && grid.filter((c) => c.day).length === 30);

const traditions = [
  { name: "Grinch Movie Night", timing_note: "Second Saturday in December" },
  { name: "Lantern Night", timing_note: "December 21" },
];
const soon = upcomingFor(traditions, "2026-01-15", 8);
check("upcoming finds Grinch Movie Night then lantern night", soon.length === 2 && soon[0].date === "2026-12-12" && soon[1].date === "2026-12-21", JSON.stringify(soon.map((s) => s.date)));
const later = upcomingFor(traditions, "2026-12-13", 8);
check("upcoming after December 12 skips to lantern then next year's Grinch Movie Night", later[0].date === "2026-12-21" && later[1].date === "2027-12-11", JSON.stringify(later.map((s) => s.date)));

const ics = buildIcs({
  familyName: "The Garofalos",
  origin: "https://example.com",
  events: [
    { id: "abc", name: "Grinch Movie Night", rule: secondSatDec, dtstart: "2026-12-12", timing: "Second Saturday in December", practice: "Everyone brings something green. No green, no screen." },
  ],
});
check("ics is a calendar with a yearly rule", ics.includes("BEGIN:VCALENDAR") && ics.includes("RRULE:FREQ=YEARLY;BYMONTH=12;BYDAY=2SA") && ics.includes("SUMMARY:Grinch Movie Night"));
check("ics uses all-day dates", ics.includes("DTSTART;VALUE=DATE:20261212"));
check("describeRule is readable", describeRule(secondSatDec) === "Second Saturday in December");

const name = validFamilyName("  The O'Briens  ");
check("family name trims and allows apostrophes", name === "The O'Briens" && nameKey(name) === "the o'briens");
check("rejects a tiny family name", validFamilyName("A") === null);
check("rejects junk family name", validFamilyName("we <3 you") === null);

const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = await hashPasscode("our-family-passcode", salt);
const hash2 = await hashPasscode("our-family-passcode", salt);
const hash3 = await hashPasscode("wrong-passcode-xx", salt);
check("pbkdf2 is stable for the same salt", hash === hash2 && hash.length === 64);
check("pbkdf2 differs for the wrong passcode", hash !== hash3);
check("timing-safe compare works", timingSafeEqual(hash, hash2) && !timingSafeEqual(hash, hash3));

const secret = "test-session-secret-not-for-production";
const token = await signSession(secret, { fid: "fam-1", v: 1, exp: Date.now() + 60000 });
const ok = await verifySession(secret, token);
check("signed session verifies", ok && ok.fid === "fam-1" && ok.v === 1);
check("tampered session is rejected", (await verifySession(secret, token.slice(0, -2) + "ab")) === null);
check("wrong secret is rejected", (await verifySession("other-secret-value-xxxxxxxx", token)) === null);
check("expired session is rejected", (await verifySession(secret, await signSession(secret, { fid: "fam-1", v: 1, exp: Date.now() - 1000 }))) === null);
check("version is carried", (await verifySession(secret, await signSession(secret, { fid: "fam-1", v: 3, exp: Date.now() + 60000 }))).v === 3);

const packed = await seal(secret, "cal-token-plain");
check("seal/unseal round-trips a calendar token", (await unseal(secret, packed)) === "cal-token-plain");
check("unseal fails with the wrong secret", (await unseal("other-secret-value-xxxxxxxx", packed)) === null);

const zip = new ZipBuilder();
zip.add("hello.txt", "hello");
zip.add("folder/photo.bin", new Uint8Array([1, 2, 3, 4]));
const bytes = zip.end();
check("zip starts with PK header", bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
check("zip contains both file names", new TextDecoder().decode(bytes).includes("hello.txt") && new TextDecoder().decode(bytes).includes("folder/photo.bin"));
check("crc32 of hello is well-known", crc32(new TextEncoder().encode("hello")) === 0x3610a686);
check("slug is filesystem-safe", slugPart("Grinch Movie Night!") === "grinch-movie-night");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
