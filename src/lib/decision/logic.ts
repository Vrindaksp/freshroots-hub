import { CHECKS, type CheckKey } from "./checks";

/** Pure, client-safe decision logic: no database, no server imports. */

export type Status = "pass" | "partial" | "fail" | "unassessed";
export type Outcome = "stop_build" | "pause" | "rebuild_smaller" | "continue";

export const STATUS_LABEL: Record<Status, string> = {
  pass: "Pass",
  partial: "Partial",
  fail: "Fail",
  unassessed: "Not assessed",
};

export const OUTCOMES: { id: Outcome; label: string; blurb: string }[] = [
  { id: "continue", label: "CONTINUE", blurb: "The checks hold up. Keep building and running as planned." },
  { id: "pause", label: "PAUSE", blurb: "Promising, but there are gaps to close first. Hold until they are." },
  { id: "rebuild_smaller", label: "REBUILD SMALLER", blurb: "The value or the data does not support the full scope. Shrink it to what is justified." },
  { id: "stop_build", label: "STOP BUILD", blurb: "The problem or the data is not there. Stop spending." },
];

export const OUTCOME_LABEL: Record<Outcome, string> = Object.fromEntries(OUTCOMES.map((o) => [o.id, o.label])) as Record<Outcome, string>;

export type Answers = Partial<Record<CheckKey, Status>>;

export interface Suggestion {
  /** null until every check has been assessed. */
  outcome: Outcome | null;
  why: string;
  passed: number;
  partial: number;
  failed: number;
  unassessed: number;
  total: number;
}

const FOUNDATION: CheckKey[] = ["problem_cost", "problem_people", "input_present"];

/**
 * Suggests an outcome from the nine answers. It only suggests: a person decides and must give a reason.
 * Precedence (strongest wins): STOP BUILD > REBUILD SMALLER > PAUSE > CONTINUE.
 *   - a failed foundation check (the problem is not real, or the inputs do not exist) -> STOP BUILD
 *   - any other failed check (including ROI)                                          -> REBUILD SMALLER
 *   - no failures but some partial                                                    -> PAUSE
 *   - everything passes                                                               -> CONTINUE
 */
export function suggestOutcome(answers: Answers): Suggestion {
  const status = (k: CheckKey): Status => answers[k] ?? "unassessed";
  const count = (s: Status) => CHECKS.filter((c) => status(c.key) === s).length;
  const base = { passed: count("pass"), partial: count("partial"), failed: count("fail"), unassessed: count("unassessed"), total: CHECKS.length };

  if (base.unassessed > 0) {
    return { ...base, outcome: null, why: `${base.unassessed} of ${base.total} checks are not assessed yet. Answer them all to get a suggestion.` };
  }
  const failedFoundation = CHECKS.filter((c) => FOUNDATION.includes(c.key) && status(c.key) === "fail");
  if (failedFoundation.length) {
    return { ...base, outcome: "stop_build", why: `A foundation check failed (${failedFoundation.map((c) => c.area.toLowerCase()).join(", ")}): without a real problem and real inputs there is nothing to build on.` };
  }
  if (base.failed > 0) {
    const roi = status("roi") === "fail";
    return { ...base, outcome: "rebuild_smaller", why: roi ? "The return does not justify the full scope. Shrink it to the part that pays." : `${base.failed} check${base.failed > 1 ? "s" : ""} failed. Rebuild a smaller version around what holds.` };
  }
  if (base.partial > 0) {
    return { ...base, outcome: "pause", why: `${base.partial} check${base.partial > 1 ? "s are" : " is"} only partly met. Close the gaps, then reassess.` };
  }
  return { ...base, outcome: "continue", why: "All nine checks pass." };
}

export const isStatus = (v: unknown): v is Status => v === "pass" || v === "partial" || v === "fail" || v === "unassessed";
export const isOutcome = (v: unknown): v is Outcome => v === "stop_build" || v === "pause" || v === "rebuild_smaller" || v === "continue";
