# Recurday

A free web app for a family's own special traditions — away from the major holidays. Text a link, add photos of the day you keep, and come back next year to rewatch as the kids grow.

Live: [https://recurday.bgarofalo1.workers.dev](https://recurday.bgarofalo1.workers.dev)

The code is open source. Family photos, videos, and private links are not. Those stay with the family who made them, and they are never part of this repository.

## What it does

- Create a tradition (a name, when it happens, and how you do it)
- Text an unguessable family link — no account needed. You can also add Recurday to your phone's home screen
- Add photos for that year (shrunk on the phone, about 2 MB each). Video coming soon.
- Rewatch year by year
- Optionally invite one other family with a revocable link. They can look, and they can tap **Start this tradition too**, which copies the practice, not the photos.

## Design (René Girard)

Recurday is built so families can share a practice without slipping into rivalry, envy, or a public scoreboard.

- There are no likes, counts, rankings, or public lists of traditions
- Links are private and unguessable; `robots` is set to `noindex`
- Link previews use a generic image, never a family's photos
- A share is an invitation you can stop. Another family gets the practice, not your media


## Add it to your home screen

Recurday is a Progressive Web App. It uses a small service worker that caches only the public app shell (the home page, styles, and the offline message) so it opens quickly. Family photos, videos, and tradition pages are never cached on the device.

**On iPhone:** open [Recurday](https://recurday.bgarofalo1.workers.dev) in Safari, tap the Share button (the square with an arrow), then **Add to Home Screen**.

**On Android:** open Recurday in Chrome. When you see the prompt, tap **Add**. Or open the Chrome menu and choose **Add to Home screen**.

Icons and the share image are generated locally by `python3 scripts/generate-brand.py`.

## Run it locally

You need Node 22+ and a Cloudflare account only if you plan to deploy.

```bash
npm install
npm test          # local smoke tests (never hits production)
npm run dev       # http://127.0.0.1:8787
```

`npm run dev` uses a local D1 database and a local KV store. Do not pass `--remote` to wrangler unless you mean to change the live app.

## Deploy

Hosting is on Cloudflare Workers, with D1 for metadata and a private Workers KV namespace for photos (R2 would be the longer-term store, but it needs a payment method). Media is never public: the Worker only serves a photo after a valid household, keeper, or accepted-invite token.

1. `npx wrangler login`
2. Create a D1 database named `recurday` (or reuse the one in `wrangler.toml`) and apply migrations: `npx wrangler d1 migrations apply recurday --remote`
3. Create a KV namespace named `recurday-media` and put its id in `wrangler.toml`. Do not reuse a namespace from another project.
4. `npx wrangler deploy`

A custom domain is optional and is not included here. Do not commit `.dev.vars`, `.wrangler/`, or any secrets.

To move photos to a private R2 bucket later, follow the steps at the top of `src/storage.js`.

## License

MIT © 2026 William Garofalo
