# Replenish

An intelligent shopping list and household purchasing manager. Replenish keeps your shopping list, lets you put purchases off until later, tracks the things you buy on a schedule, and learns from your purchase history to estimate when the essentials are due again.

It is a client-side React app. There is no backend, account or paid API: everything is stored in the browser on your device, and it can be installed to a phone's Home Screen and used offline.

## Features

- **Dashboard**: list progress, estimated spend against budget, upcoming recurring purchases, replenishment reminders and a plain-language summary built from your own data.
- **Shopping List**: add, edit, delete, tick off and undo; quantities and units; estimated prices; categories (including your own); notes; priorities; search, filter, sort and grouping.
- **Deferred**: defer until tomorrow, 3 days, 7 days, next week, a chosen date, or indefinitely, with an optional reason. Items return to the list automatically on their date and are never silently dropped.
- **Recurring**: daily to quarterly or a custom interval. Due purchases can be added to the list, deferred, skipped once, paused, edited or removed. Buying one works out the next date automatically, and a schedule never creates a duplicate list entry.
- **Suggestions**: replenishment estimates at three levels (due now, approaching, low priority), each with an explanation of the purchase dates and gaps it is based on. Accept, adjust or dismiss them. Also: frequently bought products, predictable purchase cycles, and items you keep postponing.
- **Purchase History**: every purchase with date, quantity, price, category and whether it was recurring. Filter by period and category, correct the price paid, or buy again.
- **Analytics**: weekly and monthly spending, top categories, most-bought products, deferred versus completed purchases. Every chart has a table view.
- **Shopping Mode**: a stripped-back, one-handed view for use in the shop with large checkboxes, category grouping, progress and quick add. Pick a store to see only what you buy there, in that store's aisle order.
- **Faster entry**: as you type, products you have bought before are suggested and fill in their usual quantity, category and price. **Add several** takes a typed or pasted list, one item per line (`2 kg tomatoes`, `milk 2L`, `eggs x12`).
- **Meals**: save a meal's ingredients once, then add whatever is missing to the list in one tap.
- **Barcode scanning**: scan a product with the camera to tick it off or add it. Replenish remembers each barcode after you name it once; looking names up online is optional and off by default.
- **Stock on hand**: tell Replenish how much of something you have at home and it estimates when that runs out, instead of going by purchase dates alone.
- **Price tracking**: a usual price per product, price history, and flags on purchases well above or below the usual price.
- **Spending budgets**: weekly or monthly limits, overall and per category, tracked against what you actually spend.
- **Stores**: assign items to stores and set each store's aisle order.
- **Installable and offline**: add it to your Home Screen and it opens like an app and works without a connection.
- **Settings**: currency (AUD by default), date format, 24-hour time, light and dark themes, budgets, stores, categories, notification preferences, JSON export and import, demo data, and clear all data.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the automated tests |
| `npm run typecheck` | Type-check without building |

## Deploying to GitHub Pages

The repository includes a workflow at `.github/workflows/deploy.yml` that tests, builds and publishes the app on every push to `main`.

1. Push this project to a GitHub repository named `Replenish`.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
4. The app is published at `https://<your-username>.github.io/Replenish/`.

### Hosting path

GitHub Pages serves a project site from `/<repository-name>/`, so `vite.config.ts` builds with the base path `/Replenish/` by default. The workflow sets this from the repository name automatically, so renaming the repository needs no code change.

To host somewhere else, set `BASE_PATH` when building:

```bash
BASE_PATH=/ npm run build      # a domain root (Netlify, Vercel, a custom domain)
BASE_PATH=./ npm run build     # any folder, using relative paths
```

The app uses hash-based navigation (`#/list`), so it needs no server rewrite rules.

## Installing on a phone

Once the site is deployed, open it on the phone:

- **iPhone or iPad**: in Safari, tap Share, then **Add to Home Screen**.
- **Android**: in Chrome, open the menu and choose **Install app** (or use the Install button under Settings).

The installed app opens full-screen and works offline. Camera scanning and device notifications need the site to be served over HTTPS, which GitHub Pages does.

**About notifications**: device notifications and the app-icon badge update when you open or return to the app. Alerts that arrive while the app is closed need a push server, which this serverless app does not have.

## Your data

- Data is saved automatically to the browser's LocalStorage under the key `replenish:data`, and survives refreshes and restarts.
- It stays on the device and browser you use. Use **Settings > Backup and data > Export JSON** to back it up or move it to another device, and **Import JSON** to restore it.
- Everything read from storage or an import file is validated. Invalid records are dropped and invalid fields fall back to sensible defaults.
- Saved data carries a version number, and `migrate()` in `src/lib/storage.ts` upgrades older shapes.
- Demo data is optional. Every demo record is flagged so **Remove demo data** deletes only those, never your own.

## How the suggestions work

There is no AI service involved. The rules are deliberately simple and visible:

- **Replenishment**: for each product bought on at least two different days, Replenish averages the gaps between purchases and estimates the next purchase as *last purchase + average gap*. It is "due now" once that date arrives, "approaching" in the last quarter of the gap (at least 2 days), and "low priority" otherwise. You can override the gap per product.
- **Predictable cycles**: products with at least three gaps whose variation is small (coefficient of variation of 0.35 or less).
- **Duplicates**: names are compared ignoring case, punctuation, simple plurals and word order, and allowing small typos in longer names.
- **Repeatedly postponed**: items deferred two or more times.
- **Stock on hand**: if you record a quantity at home, the run-out date is *that quantity / (usual quantity / usual gap)* from the day you recorded it. The record is used until your next purchase of that product.
- **Usual price**: the median price per unit across your purchases. A purchase is flagged when its unit price is 15% or more above or below that, once there are at least three priced purchases.

These are estimates. Unless you record stock on hand, Replenish does not know what is actually in your cupboard.

## Project structure

```
src/
  types.ts            Data model
  lib/                Pure logic: dates, recurrence, replenishment, duplicates,
                      analytics, insights, storage and validation, demo data,
                      list parsing, barcode scanning, device notifications
  state/
    actions.ts        Every data change as a pure function (data in, data out)
    store.tsx         React context: state, auto-save, navigation, modals, toasts
  components/         Shared UI: forms, dialogs, charts, navigation
  views/              One file per screen, plus Shopping Mode
  styles/index.css    Design tokens (light and dark) and all styles
  test/               Logic tests and app-level tests
```

### Adding a cloud database later

The UI never touches storage directly. All persistence goes through the `StorageAdapter` interface in `src/lib/storage.ts`, and all changes go through the pure functions in `src/state/actions.ts`. To add sync and sign-in, implement a second adapter (for example backed by Supabase or Firebase) and load and save through it in `src/state/store.tsx`; the screens do not need to change.

## Tech

React, TypeScript, Vite, plain CSS with custom properties, Lucide icons, Vitest and Testing Library. Barcode reading uses the browser's built-in detector where available and the ZXing library otherwise, loaded only when you scan. The heading typeface (Bricolage Grotesque) is bundled. The app makes no third-party requests unless you switch on online barcode lookup, which sends the barcode number to Open Food Facts.
