/** Pure date-rule helpers for Recurday. No Cloudflare APIs. */

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const NTH_NAMES = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };

export function hueOf(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ["red", "orange", "yellow", "green", "blue", "indigo", "violet"][h % 7];
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseIsoDate(value) {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function nthWeekdayOfMonth(year, month, nth, weekday) {
  const lastDay = daysInMonth(year, month);
  if (nth === -1) {
    const last = new Date(Date.UTC(year, month - 1, lastDay));
    const back = (last.getUTCDay() - weekday + 7) % 7;
    return lastDay - back;
  }
  if (nth < 1 || nth > 4) return null;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  if (day > lastDay) return null;
  return day;
}

function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nthOfDate(year, month, day) {
  const weekday = weekdayOf(year, month, day);
  const last = nthWeekdayOfMonth(year, month, -1, weekday);
  if (day === last) return -1;
  return Math.floor((day - 1) / 7) + 1;
}

export function ruleFromDate(iso, mode = "fixed") {
  const d = parseIsoDate(iso);
  if (!d) return null;
  if (mode === "nth_weekday") {
    const weekday = weekdayOf(d.year, d.month, d.day);
    const nth = nthOfDate(d.year, d.month, d.day);
    return { type: "nth_weekday", month: d.month, weekday, nth };
  }
  return { type: "fixed", month: d.month, day: d.day };
}

export function parseTiming(note) {
  const raw = String(note || "").trim();
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();

  const iso = parseIsoDate(s);
  if (iso) return { type: "fixed", month: iso.month, day: iso.day };

  const nthRe = new RegExp(
    `^(?:the\\s+)?(${Object.keys(NTH_NAMES).join("|")})\\s+(${WEEKDAYS.join("|")})\\s+(?:in|of)\\s+(${MONTHS.join("|")})$`
  );
  let m = s.match(nthRe);
  if (m) {
    return {
      type: "nth_weekday",
      nth: NTH_NAMES[m[1]],
      weekday: WEEKDAYS.indexOf(m[2]),
      month: MONTHS.indexOf(m[3]) + 1,
    };
  }

  const monthDay = s.match(new RegExp(`^(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?$`));
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1]) + 1;
    const day = Number(monthDay[2]);
    if (day >= 1 && day <= 31) return { type: "fixed", month, day };
  }

  const dayMonth = s.match(new RegExp(`^(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join("|")})$`));
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS.indexOf(dayMonth[2]) + 1;
    if (day >= 1 && day <= 31) return { type: "fixed", month, day };
  }

  return null;
}

export function ruleFromRow(row) {
  if (row?.recur_type === "fixed" && row.recur_month && row.recur_day) {
    return { type: "fixed", month: Number(row.recur_month), day: Number(row.recur_day) };
  }
  if (row?.recur_type === "nth_weekday" && row.recur_month && row.recur_weekday != null && row.recur_nth) {
    return {
      type: "nth_weekday",
      month: Number(row.recur_month),
      weekday: Number(row.recur_weekday),
      nth: Number(row.recur_nth),
    };
  }
  return parseTiming(row?.timing_note);
}

export function occurDate(rule, year) {
  if (!rule) return null;
  if (rule.type === "fixed") {
    if (rule.day > daysInMonth(year, rule.month)) return null;
    return isoDate(year, rule.month, rule.day);
  }
  if (rule.type === "nth_weekday") {
    const day = nthWeekdayOfMonth(year, rule.month, rule.nth, rule.weekday);
    if (!day) return null;
    return isoDate(year, rule.month, day);
  }
  return null;
}

export function occurInMonth(rule, year, month) {
  const date = occurDate(rule, year);
  if (!date) return null;
  const parsed = parseIsoDate(date);
  if (!parsed || parsed.month !== month) return null;
  return parsed.day;
}

export function describeRule(rule) {
  if (!rule) return "";
  if (rule.type === "fixed") {
    return `${capitalize(MONTHS[rule.month - 1])} ${rule.day}`;
  }
  if (rule.type === "nth_weekday") {
    const nth = rule.nth === -1 ? "last" : ["", "first", "second", "third", "fourth"][rule.nth];
    return `${capitalize(nth)} ${capitalize(WEEKDAYS[rule.weekday])} in ${capitalize(MONTHS[rule.month - 1])}`;
  }
  return "";
}

function capitalize(s) {
  return String(s || "").replace(/^\w/, (c) => c.toUpperCase());
}

export function upcomingFor(traditions, fromIso, limit = 8, horizonYears = 2) {
  const from = parseIsoDate(fromIso);
  if (!from) return [];
  const items = [];
  for (const tradition of traditions) {
    const rule = ruleFromRow(tradition);
    if (!rule) continue;
    for (let y = from.year; y <= from.year + horizonYears; y++) {
      const date = occurDate(rule, y);
      if (!date || date < fromIso) continue;
      items.push({ tradition, date, year: y });
      break;
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return items.slice(0, limit);
}

export function monthGrid(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = daysInMonth(year, month);
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, iso: null, outside: true });
  for (let day = 1; day <= count; day++) {
    cells.push({ day, iso: isoDate(year, month, day), outside: false });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, iso: null, outside: true });
  return cells;
}

export function ruleToRrule(rule) {
  if (!rule) return null;
  if (rule.type === "fixed") return `FREQ=YEARLY;BYMONTH=${rule.month};BYMONTHDAY=${rule.day}`;
  if (rule.type === "nth_weekday") {
    const day = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][rule.weekday];
    const n = rule.nth === -1 ? "-1" : String(rule.nth);
    return `FREQ=YEARLY;BYMONTH=${rule.month};BYDAY=${n}${day}`;
  }
  return null;
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsFold(line) {
  // RFC 5545: lines are at most 75 octets; continuation lines start with a space.
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const max = parts.length ? 74 : 75;
    if (size + n > max) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs({ familyName, events, origin }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Recurday//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(familyName || "Recurday")}`,
  ];
  for (const event of events) {
    const rrule = ruleToRrule(event.rule);
    if (!rrule || !event.dtstart) continue;
    const desc = [event.timing, event.practice].filter(Boolean).join(" — ");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@recurday`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${event.dtstart.replace(/-/g, "")}`);
    lines.push(`RRULE:${rrule}`);
    lines.push(icsFold(`SUMMARY:${icsEscape(event.name)}`));
    if (desc) lines.push(icsFold(`DESCRIPTION:${icsEscape(desc)}`));
    if (event.url || origin) lines.push(icsFold(`URL:${event.url || origin}`));
    lines.push("TRANSP:TRANSPARENT");
    for (const alarm of event.alarms || []) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(icsFold(`DESCRIPTION:${icsEscape(alarm.text || event.name)}`));
      lines.push(`TRIGGER:${alarm.trigger}`);
      lines.push("END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function bindRule(rule) {
  if (!rule) {
    return { recur_type: "", recur_month: null, recur_day: null, recur_nth: null, recur_weekday: null };
  }
  if (rule.type === "fixed") {
    return { recur_type: "fixed", recur_month: rule.month, recur_day: rule.day, recur_nth: null, recur_weekday: null };
  }
  return {
    recur_type: "nth_weekday",
    recur_month: rule.month,
    recur_day: null,
    recur_nth: rule.nth,
    recur_weekday: rule.weekday,
  };
}

/**
 * Phone-calendar reminders for one tradition. All-day events start at
 * midnight, so "-PT15H" means 9 AM the day before and "-P6DT15H" means
 * 9 AM a week before. The phone's own calendar does the reminding:
 * no push server, nothing running on our side.
 */
export function reminderAlarms(name) {
  return [
    { trigger: "-P6DT15H", text: `${name} is one week away` },
    { trigger: "-PT15H", text: `${name} is tomorrow` },
  ];
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(fromIso, toIso) {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

export function whenWords(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  const weeks = Math.round(days / 7);
  return `In ${weeks} weeks`;
}

/** One tradition as a downloadable .ics, repeating yearly, with reminders. */
export function singleIcs({ id, name, rule, timing, practice, fromIso, url }) {
  const from = parseIsoDate(fromIso) || parseIsoDate(localDate(DEFAULT_TZ));
  const dtstart = occurDate(rule, from.year) || occurDate(rule, from.year + 1) || occurDate(rule, from.year + 4);
  if (!dtstart) return null;
  return buildIcs({
    familyName: name,
    events: [{ id, name, rule, dtstart, timing, practice, url, alarms: reminderAlarms(name) }],
  });
}

// "Today" in the family's own time zone. The phone tells us its time zone in
// a small cookie (recurday_tz, set by app.js); without it we use New York.
// Pure Intl, no Cloudflare APIs, so it runs the same in tests.
export const DEFAULT_TZ = "America/New_York";
export const TZ_COOKIE = "recurday_tz";

export function validTimeZone(tz) {
  const s = String(tz || "");
  if (!s || s.length > 64 || !/^[A-Za-z0-9_+\-\/]+$/.test(s)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return s;
  } catch {
    return null;
  }
}

export function timeZoneFrom(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)recurday_tz=([^;]*)/);
  if (!m) return DEFAULT_TZ;
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch {}
  return validTimeZone(raw) || DEFAULT_TZ;
}

/** YYYY-MM-DD for an instant in a time zone. */
export function localDate(timeZone, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone) || DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today for this request: the visitor's time zone, else New York. */
export function todayFor(request, nowMs = Date.now()) {
  const header = request?.headers?.get ? request.headers.get("cookie") : "";
  return localDate(timeZoneFrom(header), nowMs);
}
