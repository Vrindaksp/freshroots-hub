import { query } from "../db";
import { CHECKS, type CheckKey } from "./checks";
import type { Outcome, Status } from "./logic";

export interface StoredAnswer {
  status: Status;
  note: string;
}

export interface SnapshotItem {
  key: CheckKey;
  area: string;
  question: string;
  status: Status;
  note: string;
}

export interface DecisionRecord {
  id: number;
  outcome: Outcome;
  suggested: Outcome | null;
  reason: string;
  scorePass: number;
  scoreTotal: number;
  snapshot: SnapshotItem[];
  alsoPaused: boolean;
  actor: string;
  createdAt: string;
}

/** Before migration 004 has run there are no tables; that should read as "nothing answered yet", not crash the page. */
function isMissingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /build_(checks|decisions)/.test(message) && /does not exist|no such table/i.test(message);
}

export async function getAnswers(): Promise<Record<CheckKey, StoredAnswer>> {
  const out = Object.fromEntries(CHECKS.map((c) => [c.key, { status: "unassessed" as Status, note: "" }])) as Record<CheckKey, StoredAnswer>;
  try {
    const rows = await query<{ check_key: CheckKey; status: Status; note: string | null }>("select check_key, status, note from build_checks");
    for (const r of rows) if (r.check_key in out) out[r.check_key] = { status: r.status, note: r.note ?? "" };
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return out;
}

export async function saveAnswer(key: CheckKey, status: Status, note: string, actor: string): Promise<void> {
  await query(
    `insert into build_checks (check_key, status, note, updated_by) values ($1, $2, $3, $4)
     on conflict (check_key) do update set status = excluded.status, note = excluded.note, updated_at = now(), updated_by = excluded.updated_by`,
    [key, status, note, actor],
  );
}

export async function insertDecision(d: {
  outcome: Outcome;
  suggested: Outcome | null;
  reason: string;
  scorePass: number;
  scoreTotal: number;
  snapshot: SnapshotItem[];
  alsoPaused: boolean;
  actor: string;
}): Promise<void> {
  await query(
    `insert into build_decisions (outcome, suggested, reason, score_pass, score_total, snapshot, also_paused, actor)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [d.outcome, d.suggested, d.reason, d.scorePass, d.scoreTotal, JSON.stringify(d.snapshot), d.alsoPaused, d.actor],
  );
}

export async function getDecisions(limit = 10): Promise<DecisionRecord[]> {
  try {
    const rows = await query<{
      id: number; outcome: Outcome; suggested: Outcome | null; reason: string; score_pass: number; score_total: number;
      snapshot: SnapshotItem[]; also_paused: boolean; actor: string; created_at: string;
    }>(
      `select id::int as id, outcome, suggested, reason, score_pass, score_total, snapshot, also_paused, actor,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from build_decisions order by id desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id, outcome: r.outcome, suggested: r.suggested, reason: r.reason, scorePass: r.score_pass, scoreTotal: r.score_total,
      snapshot: r.snapshot, alsoPaused: r.also_paused, actor: r.actor, createdAt: r.created_at,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}
