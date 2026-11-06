"use server";

import { revalidatePath } from "next/cache";
import { CHECKS, CHECK_BY_KEY, type CheckKey } from "@/lib/decision/checks";
import { isOutcome, isStatus, OUTCOME_LABEL, suggestOutcome, type Answers } from "@/lib/decision/logic";
import { getAnswers, insertDecision, saveAnswer, type SnapshotItem } from "@/lib/decision/store";
import { setAutomationPaused } from "@/lib/killswitch";
import type { ActionResult } from "./actions";

// No user accounts yet, so entries are attributed to the role that owns this gate.
const ACTOR = "head-of-ops";

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

/** Records one check's answer (status + evidence note). Saved immediately so nothing is lost on a refresh. */
export async function saveCheckAnswer(input: { key: string; status: string; note: string }): Promise<ActionResult> {
  try {
    if (!CHECK_BY_KEY.has(input.key as CheckKey)) return { ok: false, error: "Unknown check." };
    if (!isStatus(input.status)) return { ok: false, error: "Unknown status." };
    const note = input.note.trim().slice(0, 500);
    await saveAnswer(input.key as CheckKey, input.status, note, ACTOR);
    revalidatePath("/decision");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Records the go/no-go decision. The checklist only suggests an outcome; the person chooses and must say why.
 * For STOP BUILD or PAUSE they can also pause all automation in the same step (the runtime kill switch).
 */
export async function recordBuildDecision(input: { outcome: string; reason: string; alsoPause: boolean }): Promise<ActionResult> {
  try {
    if (!isOutcome(input.outcome)) return { ok: false, error: "Choose an outcome first." };
    const reason = input.reason.trim();
    if (reason.length < 10) return { ok: false, error: "Give a reason (at least 10 characters) so the decision can be understood later." };
    if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };

    const answers = await getAnswers();
    const statuses = Object.fromEntries(CHECKS.map((c) => [c.key, answers[c.key].status])) as Answers;
    const suggestion = suggestOutcome(statuses);
    const snapshot: SnapshotItem[] = CHECKS.map((c) => ({ key: c.key, area: c.area, question: c.question, status: answers[c.key].status, note: answers[c.key].note }));

    const pauseNow = input.alsoPause && (input.outcome === "stop_build" || input.outcome === "pause");
    if (pauseNow) await setAutomationPaused(true, `Build decision, ${OUTCOME_LABEL[input.outcome]}: ${reason}`.slice(0, 300), ACTOR);

    await insertDecision({
      outcome: input.outcome,
      suggested: suggestion.outcome,
      reason,
      scorePass: suggestion.passed,
      scoreTotal: suggestion.total,
      snapshot,
      alsoPaused: pauseNow,
      actor: ACTOR,
    });

    revalidatePath("/decision");
    if (pauseNow) revalidatePath("/", "layout"); // the pause banner lives in the root layout
    return {
      ok: true,
      message: `Recorded: ${OUTCOME_LABEL[input.outcome]} (${suggestion.passed}/${suggestion.total} checks passed).${pauseNow ? " Automation is now paused." : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}
