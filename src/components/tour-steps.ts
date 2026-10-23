import type { TourId } from "./events";

export interface TourStep {
  id: string;
  /** Short label shown above the title, e.g. the page this step is about. */
  section: string;
  title: string;
  body: string;
  /** Route to be on for this step; the tour navigates there. */
  path?: string;
  /** data-tour="…" value of the element to spotlight. Without one, the card is centred. */
  target?: string;
  /** Open (true) or close (false/omitted) the kill-switch panel for this step. */
  openKill?: boolean;
}

const welcome: TourStep = {
  id: "welcome",
  section: "Welcome",
  title: "Welcome to the Freshroots hub",
  body: "One platform, two jobs, one database. It works out what to reorder (Demand planner view) and shows how operations are doing (Executive view). It also manages your SKU catalogue and connects to Zoho Inventory. The database is loaded from your stock, sales, SKU, distributor and calendar files. This tour takes about four minutes and finishes with the kill switch.",
};

const roles: TourStep = {
  id: "roles",
  section: "Navigation",
  title: "Two views, one switch",
  target: "roles",
  body: "Executive view is the big picture: alerts, money at stake, twelve metrics and regions. Demand planner view is where purchase orders are reviewed and approved, SKU by SKU. Use these tabs to move between them.",
};

const alerts: TourStep = {
  id: "alerts",
  section: "Executive view",
  title: "Alerts, worst first",
  path: "/executive",
  target: "alerts",
  body: "Anything outside its normal range shows here: stock below its minimum cover, overstock, a metric moving sharply, or a region ordering more than 15% below its usual pace. Acknowledge a banner to dismiss it; it also clears by itself once the problem is gone.",
};

const impact: TourStep = {
  id: "impact",
  section: "Executive view",
  title: "The money at stake",
  path: "/executive",
  target: "impact",
  body: "Net projected savings adds the margin protected by purchase orders (approved, or still waiting as drafts) to the over-orders avoided by pausing overstocked SKUs. It is a model, not accounting, and it currently uses placeholder prices because your files contain no costs.",
};

const metrics: TourStep = {
  id: "metrics",
  section: "Executive view",
  title: "Twelve core metrics",
  path: "/executive",
  target: "metrics",
  body: "Cards are computed from your data and refresh as new data arrives. A “Sample” badge means the figure is illustrative: fulfillment, delivery, complaints and write-offs are not in your files. A coloured edge with a Watch or Action tag means a metric needs attention.",
};

const regions: TourStep = {
  id: "regions",
  section: "Executive view",
  title: "Orders by region",
  path: "/executive",
  target: "regions",
  body: "Each region's latest week against the average of the four weeks before it. A drop of more than 15% raises an alert. The chart indexes every region to its own average so small and large regions compare fairly.",
};

const brief: TourStep = {
  id: "brief",
  section: "Executive view",
  title: "Operations brief",
  path: "/executive",
  target: "brief",
  body: "Gemini writes a short brief from the numbers on this page. If Gemini is unavailable, or automation is paused, you get a plain rule-based summary instead.",
};

const plannerTiles: TourStep = {
  id: "planner-tiles",
  section: "Demand planner view",
  title: "Planner at a glance",
  path: "/planner",
  target: "planner-tiles",
  body: "How many draft purchase orders are waiting for you, how many SKUs are at stockout risk or overstocked, which have high demand, and how many need your review because the rules are least reliable there (edge cases).",
};

const grid: TourStep = {
  id: "grid",
  section: "Demand planner view",
  title: "One row per SKU",
  path: "/planner",
  target: "grid",
  body: "The cover bar shows weeks of stock against the healthy window (6–14 weeks, or 3–4 for perishables). Signals explain why a SKU is flagged, and Recommended is what the rules propose. Click a SKU name to open its rule trace, weekly sales, Gemini commentary and your notes.",
};

const decide: TourStep = {
  id: "decide",
  section: "Demand planner view",
  title: "Approve, override or reject",
  path: "/planner",
  target: "grid",
  body: "Edit Final qty if you disagree, then Approve. Changing the number requires a reason, and so does rejecting; both are saved on the purchase order. Approved orders are staged in Zoho Inventory format and can be exported from the top of the page.",
};

const runEngine: TourStep = {
  id: "run-engine",
  section: "Demand planner view",
  title: "Run planning engine",
  path: "/planner",
  target: "run-engine",
  body: "Recomputes everything from the latest data: rules, draft purchase orders, metrics, alerts, Gemini commentary and the brief. It also runs automatically every day at 06:00 IST. The kill switch stops both.",
};

const rules: TourStep = {
  id: "rules",
  section: "Demand planner view",
  title: "The rules in force",
  path: "/planner",
  target: "rules",
  body: "High demand is +20% over the 12-week average (order 1.5× the standard quantity), reorder below 6 weeks of cover, pause above 14, +25% demand in October, November and March, and a strict 3–4 week window for perishables. They all live in one config file.",
};

const skuAdd: TourStep = {
  id: "sku-add",
  section: "SKU catalogue",
  title: "Add a SKU by hand",
  path: "/skus",
  target: "sku-add",
  body: "Press + Add SKU and fill in the name, category, perishability, standard order quantity and distributor. Cost, price and opening stock are optional. A new SKU has no sales history, so after the next planning-engine run the engine treats it as a new launch and sends it to Gemini for review.",
};

const skuTable: TourStep = {
  id: "sku-table",
  section: "SKU catalogue",
  title: "Edit or remove",
  path: "/skus",
  target: "sku-table",
  body: "Remove hides a SKU from the planner, engine, alerts and dashboards and drops its open draft POs, but keeps its sales history and past POs, and you can restore it (tick Show removed). Only a removed SKU with no history can be deleted permanently.",
};

const zohoConnect: TourStep = {
  id: "zoho-connection",
  section: "Zoho",
  title: "The Zoho connection",
  path: "/zoho",
  target: "zoho-connection",
  body: "Zoho credentials live in server environment variables and never reach the browser. Test connection runs a read-only check that creates nothing. If it is not connected yet, the setup guide here walks through getting the credentials.",
};

const zohoPush: TourStep = {
  id: "zoho-push",
  section: "Zoho",
  title: "Send purchase orders to Zoho",
  path: "/zoho",
  target: "zoho-push",
  body: "Preview shows exactly what would be sent. Push creates each approved PO in Zoho Inventory as a draft (plus the item and vendor if they are missing). Repeating it never duplicates: a PO already in Zoho is linked instead, and a failed PO keeps its error so it can be retried.",
};

const zohoExport: TourStep = {
  id: "zoho-export",
  section: "Zoho",
  title: "Prefer files?",
  path: "/zoho",
  target: "zoho-export",
  body: "Download your items and approved purchase orders as CSV and bring them into Zoho with its import wizard. This works without any connection.",
};

const killIntro: TourStep = {
  id: "ks-intro",
  section: "Kill switch",
  title: "The kill switch",
  target: "killswitch",
  body: "This button stops all automation in one step. The dot shows the state: green means running, red means paused. Next we'll open it.",
};

const ksStatus: TourStep = {
  id: "ks-status",
  section: "Kill switch",
  title: "Status",
  target: "ks-status",
  openKill: true,
  body: "Shows whether automation is running or paused. When paused it also shows why, since when and by whom, and whether the pause came from this screen or from a server-level hard stop.",
};

const ksScope: TourStep = {
  id: "ks-scope",
  section: "Kill switch",
  title: "What it stops, and what it doesn't",
  target: "ks-scope",
  openKill: true,
  body: "Pausing stops engine runs (the button and the daily refresh), every Gemini call, purchase-order sign-off and Zoho pushes. Dashboards, file exports, data ingestion and alert acknowledgement keep working, so you can still look around while it is paused.",
};

const ksAction: TourStep = {
  id: "ks-action",
  section: "Kill switch",
  title: "Pausing and resuming",
  target: "ks-action",
  openKill: true,
  body: "To pause, type a reason (everyone will see it) and press Pause. It takes effect immediately for all users and a red banner appears on every page. To resume, press Resume and confirm once the cause is fixed.",
};

const ksHard: TourStep = {
  id: "ks-hard",
  section: "Kill switch",
  title: "The hard stop",
  target: "ks-hard",
  openKill: true,
  body: "For emergencies, set KILL_SWITCH=1 in Vercel and redeploy. It overrides this panel and cannot be switched off from inside the app, so nobody can resume by accident.",
};

const ksLog: TourStep = {
  id: "ks-log",
  section: "Kill switch",
  title: "Activity log",
  target: "ks-log",
  openKill: true,
  body: "Every pause and resume is recorded with when and why. “Who” shows the role, because the app has no individual user accounts yet.",
};

const doneKill: TourStep = {
  id: "done-kill",
  section: "Kill switch",
  title: "That's the kill switch",
  body: "Pause when numbers look wrong or something unexpected is happening, fix the cause, then resume. The full platform tour is always available from the Tour button in the header.",
};

const donePlatform: TourStep = {
  id: "done",
  section: "Done",
  title: "You're all set",
  body: "Reopen this tour any time with the Tour button in the header. Inside the kill switch panel, “Walk me through this” replays just that part.",
};

export const TOURS: Record<TourId, TourStep[]> = {
  platform: [welcome, roles, alerts, impact, metrics, regions, brief, plannerTiles, grid, decide, runEngine, rules, skuAdd, skuTable, zohoConnect, zohoPush, zohoExport, killIntro, ksStatus, ksScope, ksAction, ksHard, ksLog, donePlatform],
  killswitch: [killIntro, ksStatus, ksScope, ksAction, ksHard, ksLog, doneKill],
};
