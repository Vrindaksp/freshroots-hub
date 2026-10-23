import { query } from "../db";
import { ANALYST_SYSTEM, generateStructured, geminiConfigured } from "./gemini";

/**
 * Turns a planner's free-text note ("Pune distributor says Diwali scheme on mango drink, expect +30% for 3 weeks")
 * into structured signals. The result is ADVISORY: it is shown beside the SKU and never changes a PO quantity on its own.
 */

export type NoteSignalType = "demand_up" | "demand_down" | "supply_delay" | "promotion" | "quality_issue" | "price_change" | "other";

export interface NoteSignal {
  type: NoteSignalType;
  sku_id: string | null;
  region: string | null;
  magnitude_pct: number | null;
  duration_weeks: number | null;
  detail: string;
}

export interface ParsedNote {
  summary: string;
  signals: NoteSignal[];
  needs_followup: boolean;
}

export interface StoredNote {
  id: number;
  skuId: string | null;
  raw: string;
  parsed: ParsedNote | null;
  source: "gemini" | "rules";
  createdAt: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence." },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["demand_up", "demand_down", "supply_delay", "promotion", "quality_issue", "price_change", "other"] },
          sku_id: { type: ["string", "null"], description: "A SKU id from the provided list, or null." },
          region: { type: ["string", "null"] },
          magnitude_pct: { type: ["number", "null"], description: "Signed percentage change if stated, else null." },
          duration_weeks: { type: ["number", "null"] },
          detail: { type: "string" },
        },
        required: ["type", "sku_id", "region", "magnitude_pct", "duration_weeks", "detail"],
      },
    },
    needs_followup: { type: "boolean", description: "True when the note is too vague to act on." },
  },
  required: ["summary", "signals", "needs_followup"],
};

interface SkuRef {
  id: string;
  name: string;
}

/** Keyword/regex fallback used without an API key or when Gemini fails. */
export function parseNoteWithRules(text: string, skus: SkuRef[], defaultSku: string | null): ParsedNote {
  const lower = text.toLowerCase();
  const mentioned = skus.filter((s) => lower.includes(s.id.toLowerCase()) || lower.includes(s.name.replace(/^Freshroots /i, "").toLowerCase()));
  const skuId = mentioned[0]?.id ?? defaultSku;
  const pct = /([+-]?\d{1,3})\s?%/.exec(text);
  const magnitude = pct ? Number(pct[1]) : null;
  const weeks = /(\d{1,2})\s?(?:weeks?|wks?)/i.exec(text);
  const duration = weeks ? Number(weeks[1]) : null;

  const signals: NoteSignal[] = [];
  const push = (type: NoteSignalType, sign: 1 | -1 | 0) =>
    signals.push({
      type,
      sku_id: skuId,
      region: null,
      magnitude_pct: magnitude == null ? null : sign === 0 ? magnitude : Math.abs(magnitude) * sign,
      duration_weeks: duration,
      detail: text.trim().slice(0, 200),
    });

  if (/promo|scheme|offer|discount|campaign|launch/.test(lower)) push("promotion", 1);
  if (/delay|late|shortage|supplier|stuck|port|strike/.test(lower)) push("supply_delay", 0);
  if (/expir|spoil|damage|quality|recall|complain/.test(lower)) push("quality_issue", 0);
  if (/price (hike|rise|increase|cut|drop)/.test(lower)) push("price_change", 0);
  if (!signals.length && /(increase|rise|rising|higher|more|surge|spike|up)\b/.test(lower)) push("demand_up", 1);
  if (!signals.length && /(decrease|drop|falling|lower|less|slow|down)\b/.test(lower)) push("demand_down", -1);
  if (!signals.length) push("other", 0);

  return {
    summary: `Rule-based parse: ${signals.map((s) => s.type.replace("_", " ")).join(", ")}${magnitude != null ? ` (${magnitude > 0 ? "+" : ""}${magnitude}%)` : ""}.`,
    signals,
    needs_followup: signals.length === 1 && signals[0].type === "other",
  };
}

export async function addPlannerNote(text: string, skuId: string | null, author: string): Promise<StoredNote> {
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error("Note is empty");

  const skus = await query<SkuRef>("select id, name from skus where archived_at is null order by id");
  let parsed: ParsedNote;
  let source: "gemini" | "rules" = "rules";
  if (geminiConfigured()) {
    try {
      const prompt = `Extract structured planning signals from the planner's note. Map SKU mentions to ids from this list; use the note's SKU context (${skuId ?? "none"}) when the note names none.\n\nSKUs: ${JSON.stringify(skus)}\n\n<planner_note>\n${clean}\n</planner_note>`;
      const result = await generateStructured<ParsedNote>({ system: ANALYST_SYSTEM, prompt, schema: SCHEMA, temperature: 0 });
      parsed = result.data;
      source = "gemini";
    } catch {
      parsed = parseNoteWithRules(clean, skus, skuId);
    }
  } else {
    parsed = parseNoteWithRules(clean, skus, skuId);
  }

  const known = new Set(skus.map((s) => s.id));
  parsed.signals = parsed.signals.map((s) => ({ ...s, sku_id: s.sku_id && known.has(s.sku_id) ? s.sku_id : null }));

  const rows = await query<{ id: number; created_at: string }>(
    `insert into planner_notes (sku_id, raw_text, parsed, source, created_by)
     values ($1, $2, $3::jsonb, $4, $5)
     returning id::int as id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`,
    [skuId, clean, JSON.stringify(parsed), source, author],
  );
  return { id: rows[0].id, skuId, raw: clean, parsed, source, createdAt: rows[0].created_at };
}

export async function getNotes(skuId: string, limit = 5): Promise<StoredNote[]> {
  const rows = await query<{ id: number; sku_id: string | null; raw_text: string; parsed: ParsedNote | null; source: "gemini" | "rules"; created_at: string }>(
    `select id::int as id, sku_id, raw_text, parsed, source,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
     from planner_notes where sku_id = $1 order by id desc limit $2`,
    [skuId, limit],
  );
  return rows.map((r) => ({ id: r.id, skuId: r.sku_id, raw: r.raw_text, parsed: r.parsed, source: r.source, createdAt: r.created_at }));
}

/** Latest few notes per SKU, for the planner drawer. */
export async function getNotesBySku(perSku = 3): Promise<Record<string, StoredNote[]>> {
  const rows = await query<{ id: number; sku_id: string | null; raw_text: string; parsed: ParsedNote | null; source: "gemini" | "rules"; created_at: string }>(
    `select id::int as id, sku_id, raw_text, parsed, source,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
     from planner_notes where sku_id is not null order by id desc limit 200`,
  );
  const out: Record<string, StoredNote[]> = {};
  for (const r of rows) {
    const list = (out[r.sku_id!] ??= []);
    if (list.length < perSku) list.push({ id: r.id, skuId: r.sku_id, raw: r.raw_text, parsed: r.parsed, source: r.source, createdAt: r.created_at });
  }
  return out;
}
