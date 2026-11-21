# Recurday

Creating family traditions. It was always about the small things.

A free web app for the days a family makes their own — not the big holidays. The texted link is the heart of it. Add photos of the day you keep, and come back next year to rewatch as the kids grow.

Live: [https://recurday.bgarofalo1.workers.dev](https://recurday.bgarofalo1.workers.dev)

There is no app store. Recurday spreads by word of mouth when a family texts a link.

The code is open source. Family photos and private links are not. Those stay with the family who made them, and they are never part of this repository.

## Why Recurday

René Girard described a triangle of desire: we often want a thing because someone else wants it, and that can slide into rivalry. The Trinity, in Christian thought, is a picture of mutual love — each person giving, none competing for a place. Recurday is an attempt to redeem mimesis in a small, everyday way: a family can pass a practice on so another family can keep it as their own, without likes, rankings, referral counts, or a public list to climb.

That idea stays in this file. The app itself just talks about giving, keeping, and being together.

## What it does

- Keep a shared family calendar as the home of your traditions. Each one can fall on a fixed date or on something like the second Saturday in December (Grinch Movie Night), and it comes back every year. A short note might read: “Everyone brings something green. No green, no screen.”
- Browse **Ideas** — a quiet list of about 130 traditions a family can borrow and make their own, for little kids through grandparents: breakfasts, dinners, restaurants, movies, games, sports games, music, outdoors, crafts, giving, faith and gratitude, and a spooky October. Filter by season, age, type, and place (snowy, warm, city, country, beach). There are no likes, counts, rankings, or names. Tap **Make it ours** to start with that name, how-to, and date.
- **Share an idea** from the bottom of Ideas. It goes to a private review queue, never straight onto the page.
- One screen for log in and sign up: type the family name and passcode and tap **Continue**. If the family exists, you're in. If the name is new, Recurday asks “No family called X yet. Start a new one?” and has you type the passcode again, so a typo never makes a second family. Everyone in the house shares that one name and passcode. No email, and no individual accounts. You can claim an older private link into that login.
- Save a **backup code** when you start (copy it, download it, or take a screenshot). It is shown once. If anyone forgets the passcode, tap **Forgot passcode?**, enter the family name and backup code, and pick a new passcode — then you get a fresh code. A lost passcode never means a lost family history. Families made before this can make a code under the calendar (it asks for the passcode).
- **See an example** at `/sample` before signing up: a made-up family's calendar with drawings, not photos, and a **Start your own** button. No login, and nothing from real families.
- **Coming up** at the top of the calendar shows traditions in the next 30 days. **Add to calendar** downloads a small `.ics` file that repeats every year, so the phone's own calendar reminds you a week before and the day before. No push notifications, no servers sending anything. "Today" (Coming up, the highlighted day) follows the phone's own time zone: app.js saves just the zone name (like `America/Chicago`) in a small `recurday_tz` cookie, and without it Recurday uses New York time.
- Tap **Text this to family**. The message is short and human, like: “Grinch Movie Night is coming up. It was always about the small things. [link]”. Recurday uses the phone's share sheet when it can, or opens a text message if it cannot. The person who gets the link sees the tradition right away — the cover, the name, the date, a few photos, and the tagline — with no sign-in.
- Add photos for that year (shrunk on the phone, about 2 MB each). Photos only — it's about staying in the moment.
- Give a tradition a cover picture — upload one, or pick a photo already kept with that day. It appears at the top of the tradition page, as a small round thumbnail on the calendar, and as the opening card of Watch the years. If there's no cover, the tradition's rainbow hue stands in. Covers stay private like other photos; link previews stay the generic image.
- Rewatch **Watch the years**: a quiet slideshow, oldest year first, with the year named and then that year's photos.
- Optionally **Pass it on** — a revocable invite to another family. They can look, and they can tap **Start this tradition too**, which copies the practice, not the photos. When they open the link they also see a quiet **Start your own** at the bottom.
- Export a private zip of your traditions, photos, and a simple index, to keep and pass down. If the whole family archive is too large, you can export one tradition at a time.
- Add Recurday to your phone's home screen. There is no app store.
- Read **Privacy**, **Terms**, and **About** — short, honest pages for how the app works, including how to delete everything. A family can also choose **Delete our family** under More, after entering the passcode.

## Design

Recurday is built so families can share a practice without slipping into rivalry, envy, or a public scoreboard.

- There are no likes, counts, rankings, referral scores, or public lists of traditions
- Links are private and unguessable; `robots` is set to `noindex`
- Link previews use a generic image, never a family's photos
- A share is an invitation you can stop. Another family gets the practice, not your media
- The family passcode is stored as a slow hash (PBKDF2). Sessions are httpOnly cookies. Changing the passcode signs out other devices. Logins and uploads are rate-limited. Photos are limited to about 2 MB each.
- Backup codes are 16 random characters (80 bits). Only a salted SHA-256 hash is stored (migration `0007_backup_code.sql`), never the code. Each code works once, wrong tries share the login lockout plus hourly caps, and using one signs out other devices.
- There is no email recovery on purpose: Cloudflare's free plan can only send email to addresses verified in our own account, and sending to anyone else needs the paid Workers plan and an owned domain. Recurday stays free and asks for no email.

## Shared ideas

The **Share an idea** form on `/ideas` posts to `POST /api/ideas/share`, which saves a row in the D1 table `idea_submissions` (migration `0006_idea_submissions.sql`) with `status = 'pending'`. Nothing in that table is ever served publicly. The form has a hidden honeypot field, one-line length limits (name 80, how-to 200, when 80 characters), refuses links, is rate-limited per internet address (10 an hour, via the same `login_attempts` table as other limits), and stops accepting new ones when 2,000 are pending. No family, login, or internet address is stored with a submission.

To review the queue (needs your own Cloudflare login; nothing secret lives in this repo):

```sh
npx wrangler d1 execute recurday --remote --command \
  "SELECT id, created_at, name, practice, timing, season, age, type FROM idea_submissions WHERE status = 'pending' ORDER BY created_at"
```

To promote one, add it to `IDEAS` in `src/ideas.js` with the `idea(...)` helper (rewrite it in Recurday's voice if needed: short name, one-line how-to, a date like `Third Saturday in October`, and age, type, and place tags), run `npm run build && npm test`, and deploy. Then mark it so it doesn't come up again:

```sh
npx wrangler d1 execute recurday --remote --command \
  "UPDATE idea_submissions SET status = 'added' WHERE id = '<id>'"   # or 'declined'
```

## Add it to your home screen

Recurday is a Progressive Web App. It uses a small service worker that caches only the public app shell (the home page, styles, and the offline message) so it opens quickly. Family photos, tradition pages, the calendar, and family login routes are never cached on the device.

**On iPhone:** open a Recurday link in Safari, tap the Share button (the square with an arrow), then **Add to Home Screen**.

**On Android:** open Recurday in Chrome. When you see the prompt, tap **Add**. Or open the Chrome menu and choose **Add to Home screen**.

Icons and the share image are generated locally by `python3 scripts/generate-brand.py`. The home-screen icon shows a rainbow over the word Recurday, with a house at one end and a heart at the other. Tiny favicons stay a rainbow-only mark.

A family's own calendar can also be added to a phone or computer calendar app through a private `.ics` link. That link is unguessable; you can rotate it if it ever leaks.

## Run it locally

You need Node 22+ and a Cloudflare account only if you plan to deploy.

```bash
npm install
npm test          # unit tests, then local smoke tests (never hits production)
npm run dev       # http://127.0.0.1:8787
```

`npm run dev` uses a local D1 database and a local KV store. For family login to work locally, set `SESSION_SECRET` in `.dev.vars` (that file is gitignored). Tests pass the secret on the command line. Do not pass `--remote` to wrangler unless you mean to change the live app.

## Deploy

Hosting is on Cloudflare Workers, with D1 for metadata and a private Workers KV namespace for photos (R2 would be the longer-term store, but it needs a payment method). Media is never public: the Worker only serves a photo after a valid household, keeper, accepted-invite, or family-login session.

1. `npx wrangler login`
2. Create a D1 database named `recurday` (or reuse the one in `wrangler.toml`) and apply migrations: `npx wrangler d1 migrations apply recurday --remote`
3. Create a KV namespace named `recurday-media` and put its id in `wrangler.toml`. Do not reuse a namespace from another project.
4. Set a session secret once, and never commit it: `npx wrangler secret put SESSION_SECRET`
5. `npm run deploy` (builds the static pages, applies migrations, then deploys)

A custom domain is optional and is not included here. Do not commit `.dev.vars`, `.wrangler/`, or any secrets.

D1 Time Travel is always on and does not cost extra. On the Workers Free plan it can restore the database to a minute in the last 7 days (`wrangler d1 time-travel`). A paid Workers plan would keep 30 days; Recurday is not using a paid plan. Time Travel covers database rows (names, notes, dates, and link hashes), not the photo files in Workers KV. Families should use **Save a copy** if they want their own backup of photos.


## Built for a rush (Workers Free plan)

Recurday is designed to stay up when a texted link spreads, without a paid plan:

- **Static files run no code.** CSS, JS, icons, the offline page, and the prebuilt Ideas, About, Privacy, and Terms pages (`npm run build` writes them from `src/pages.js`) are served as static assets. Only the paths in `run_worker_first` in `wrangler.toml` start the Worker. Static asset requests are free and unlimited ([Cloudflare docs](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)).
- **Shared-link pages are cached at the edge** for visitors who aren't logged in (`src/edge.js`, Cloudflare Cache API). The cache key hides the link token and includes a `page_version` that database triggers bump on every edit (migration 0005), so edits show up at once. Logged-in and keeper pages are never cached.
- **Photos** are checked against the link or login on every request, then served from the edge cache when possible, so most views skip the Workers KV read. Browsers may keep a photo for a year because a saved photo never changes.
- **When a free daily limit runs out**, pages show a calm "very busy, try again in a minute" message (HTTP 503) instead of crashing. Saves are all-or-nothing, so nothing is half-written.

To move photos to a private R2 bucket later, follow the steps at the top of `src/storage.js`.

## License

MIT © 2026 William Garofalo
