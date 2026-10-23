# Freshroots Operations & Demand Intelligence Hub

Internal dashboard and automation for Freshroots (FMCG distribution, Maharashtra · Karnataka · Gujarat). Two views, one database:

- **Demand planner view** (`/planner`) — replaces the monthly Excel forecast. A rule engine turns sales history and stock into draft purchase orders; Raghav approves, overrides (reason required) or rejects each one. Approved POs are staged in a Zoho-shaped payload.
- **Executive view** (`/executive`) — replaces the Monday SAP→Excel export. Twelve live metrics, regional order pace, anomaly banners, a modelled rupee-impact panel and a Gemini-written operations brief.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · Neon Postgres · Gemini API · Vercel.

## Run it

```bash
npm install
npm run db:setup      # migrate → load data/seed/*.csv → run the engine → metrics → alerts → commentary
npm run dev           # http://localhost:3000
```

With no `DATABASE_URL`, everything runs on an **embedded Postgres** in `.data/pglite` — no accounts needed. With no `GEMINI_API_KEY`, commentary, note parsing and the brief fall back to rule-based text (labelled as such).

### Connect Neon and Gemini

```bash
cp .env.example .env.local     # then fill in DATABASE_URL and GEMINI_API_KEY
npm run db:setup               # same command; now targets Neon
```

| Script | What it does |
|---|---|
| `npm run db:migrate` | Applies `db/migrations/*.sql` |
| `npm run db:seed` | Loads the CSVs (`-- --no-sample` skips illustrative metric series) |
| `npm run db:setup` | Migrate + seed + full refresh |
| `npm run db:reset -- --yes` | Drops every table (needs `--yes` on Neon) |
| `npm run dev:local` | Dev server on the embedded database with Gemini off, even if `.env.local` points at Neon — safe for trying the kill switch or approving POs. Seed it with `DATABASE_URL= GEMINI_API_KEY= npm run db:setup` |
| `npm test` | 63 unit tests: every rule threshold, alert detection, kill-switch state, SKU validation, Zoho client and push logic |
| `npm run typecheck` · `npm run lint` · `npm run build` | |

## The demand rules (`src/lib/engine/config.ts`)

| Rule | Behaviour |
|---|---|
| Rolling averages | 4-week vs 12-week mean of complete weeks |
| High demand | 4-wk avg > 12-wk avg **+20%** → flag, reorder **1.5×** standard quantity |
| Stockout risk | stock < **6 weeks** of demand → reorder now |
| Overstock | stock > **14 weeks** → pause orders (overrides high demand) |
| Seasonality | **+25%** demand uplift in Oct, Nov, Mar, applied *before* every threshold |
| Perishability | high-perishability SKUs use a strict **3–4 week** window; order size is capped so stock + open orders never overshoots it |

Judgement calls the brief left open (all in `config.ts`/`rules.ts`): a stockout order is one standard lot, plus more lots until cover is within 5% of the minimum; open POs within 5% of the minimum count as covering the shortfall (so trimming a lot by a few units doesn't trigger a duplicate order).

**Edge cases for Gemini** (the brief's 15–20%): new launches (<8 weeks), demand shifts >20%, volatile sales, rules that contradict the trend, and multi-lot shortfalls. On the supplied data that is 3 of 15 SKUs (20%).

## SKU catalogue (add and remove SKUs by hand)

Open **SKUs** in the header.

- **Add:** name, category, perishability, standard order quantity and distributor are required; cost, price, opening stock and warehouse are optional. The ID is auto-numbered (`SKU016`) unless you type one. The SKU joins the planner after the next planning-engine run, where — having no sales history yet — it is treated as a *new launch* and sent to Gemini for review. Build its history by pushing sales through `/api/ingest`.
- **Edit:** name, category, perishability, lot size, distributor, cost and price. Entering a cost or price marks it as *manual*, which removes the "Placeholder" tag and stops `db:seed` from overwriting it.
- **Remove = archive.** The SKU leaves the planner, the engine, alerts, dashboards and exports, and its open *draft* POs are dropped; its sales history and past POs are kept, so the numbers you already reported do not change. Restore it any time (**Show removed**).
- **Delete permanently** is offered only for a removed SKU with no sales history and no decided POs (e.g. one added by mistake), and needs its ID typed to confirm. Anything with history stays archived.
- Every change is recorded in `sku_events`. Removing a SKU does not change Zoho.

## Zoho Inventory

Open **Zoho** in the header.

- **Connection:** set `ZOHO_DC`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` and `ZOHO_ORGANIZATION_ID` (the page has a step-by-step guide; scopes needed: items, purchase orders and contacts create/read, plus settings read). **Test connection** is read-only.
- **Purchase orders → Zoho:** **Preview** shows exactly what would be sent (built from the database; works without credentials). **Push** creates each approved PO in Zoho as a *draft* purchase order, creating the item (matched by SKU code) and the vendor (matched by distributor name) first if missing. A PO is looked up by its reference (`FR-PO-000001`) before creating, so repeating a push links to what is already there instead of duplicating; a failed PO keeps its error and can be retried.
- **Items → Zoho:** **Sync to Zoho** per SKU, or **Sync all to Zoho**, creates or links Zoho items by SKU code.
- **Files instead:** `/api/zoho/export?type=items` and `?type=purchase-orders` return CSV for Zoho's import wizard (add `&format=json` for JSON); they need no credentials.
- Zoho pushes are stopped by the **kill switch**; every call is logged in `zoho_sync_log`.
- Live-tested against a real Zoho Inventory organisation (India data centre): connection test, item creation and idempotent re-sync. The purchase-order and vendor create calls follow Zoho's documented API and are covered by unit tests; use **Preview** and push one PO first.

## Kill switch

One control that stops all automation. Open it from the **Kill switch** button in the header (green dot = running, red = paused).

| | |
|---|---|
| **Stops** | Planning-engine runs (button, daily refresh, `/api/ingest?refresh=1`), every Gemini call (commentary, brief, note parsing) and purchase-order sign-off |
| **Keeps working** | All dashboards, the PO export, data ingestion, alert acknowledgement, and saving notes (parsed by rules) |
| **Pause** | Needs a reason (≥5 characters). Instant for every user; a red banner appears on every page; recorded in `automation_events` with when and why (who = the role, until there are user accounts) |
| **Resume** | Two clicks (Resume → Confirm); also logged |
| **Hard stop** | Set `KILL_SWITCH=1` in Vercel and redeploy. Overrides the in-app switch and cannot be resumed from the app — remove the variable and redeploy |

Enforcement is server-side, not just hidden buttons: `assertAutomationRunning()` guards the engine (`src/lib/intelligence.ts`), every Gemini call (`src/lib/ai/gemini.ts`) and the PO actions (`src/app/actions.ts`); the cron route returns a clean `{"skipped":true}`. State logic is in `src/lib/killswitch-state.ts` (unit-tested).

## Guided tour

The **Tour** button in the header runs a 24-step walkthrough of the whole platform (including SKUs and Zoho): it navigates between pages, spotlights the element being explained and opens the kill-switch panel. Inside that panel, **Walk me through this** replays just the kill-switch steps. First-time visitors get a one-time prompt. Steps live in `src/components/tour-steps.ts`; any element can be targeted with a `data-tour="…"` attribute.

## Where the pieces live

```
db/migrations/001_init.sql        schema (skus, distributors, sales_history, inventory_levels, operational_metrics,
                                  purchase_orders + calendar, engine_runs, demand_signals, ai_outputs, planner_notes, alerts)
data/seed/                        the five source CSVs + placeholder pricing — see data/seed/README.md
src/lib/engine/                   rules.ts (pure, tested) · data.ts (loaders) · run.ts (persist signals + draft POs)
src/lib/alerts/                   detect.ts (pure, tested) · run.ts (persist + auto-resolve)
src/lib/metrics/                  the 12-metric registry · derived snapshots · dashboard queries
src/lib/ai/                       Gemini client · edge-case commentary · note parsing · executive brief
src/lib/impact.ts                 rupee-impact model (assumptions in config.ts)
src/app/actions.ts                server actions: approve / reject / override, run engine, acknowledge, Gemini calls
src/app/api/                      ingest · cron/refresh · purchase-orders/export
```

## Integrations

- **Zoho Inventory (staging):** approving a PO stores a Zoho "Create Purchase Order"–shaped payload (`purchase_orders.zoho_payload`, status `staged`). `GET /api/purchase-orders/export` returns it as JSON, or `?format=csv` for manual import. Nothing calls Zoho yet; `ZI-…`/`ZV-…` IDs are placeholders until the item/vendor mapping exists.
- **SAP/Excel replacement:** `POST /api/ingest` (Bearer `INGEST_TOKEN`) accepts `metrics`, daily `sales` and `inventory` rows. Daily sales rows make the **regional-pace alert** work mid-week (a region >15% below its 4-week pace, pro-rated for the days elapsed). Add `?refresh=1` to re-run the engine.
- **Scheduled refresh:** `vercel.json` runs `/api/cron/refresh` daily (06:00 IST) with `CRON_SECRET`.

## Deployment

Live on Vercel: **https://freshroots-hub.vercel.app** (open, no sign-in). GitHub → Vercel auto-deploys every push to `main`.

Production environment variables (Vercel → Settings → Environment Variables): `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `INGEST_TOKEN`, `CRON_SECRET`. Secrets are stored as sensitive; values live only in Vercel and your local `.env.local`.

- **Access:** there is no sign-in — anyone with the URL can use every page, approve purchase orders and trigger Gemini calls. `/api/ingest` and `/api/cron` still require their own bearer tokens. Add Vercel Authentication or SSO before sharing the link widely.
- **Database:** Neon project `freshroots-hub`. Reload seed data any time with `npm run db:setup` (reads `.env.local`).
- **Scheduled refresh:** `vercel.json` runs `/api/cron/refresh` daily at 06:00 IST.
- **Rotating a secret:** change it in Vercel, then redeploy (`vercel deploy --prod`) — env changes apply to new deployments only.

## Not done yet — read before real use

- **No user accounts.** Decisions are logged as the role `demand-planner`, not a person. Add Vercel Authentication or SSO, then thread the user identity into `src/app/actions.ts`.
- **Placeholder prices** drive every ₹ figure (see `data/seed/README.md`).
- **Sample metrics:** fulfillment, on-time delivery, complaints and write-offs are illustrative until a feed is connected.
- **Rupee impact is a model**, not accounting. Assumptions (realisation 60%, write-off 50% perishable / 10% other) are in `IMPACT_ASSUMPTIONS`; tune them with finance's history.
- **Verified against real services:** migration, seeding, the engine, PO approval/export and Gemini commentary/brief were run against a live Neon database and the Gemini API (`gemini-3.8-flash`). Not exercised: the Vercel deployment, the cron job, and the push-side of the Zoho hand-off (nothing calls Zoho yet).
- Gemini commentary for a single SKU takes roughly 10–20 s (the model reasons before answering); the UI shows a "Thinking…" state.
