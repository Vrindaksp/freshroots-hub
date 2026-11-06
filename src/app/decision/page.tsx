import { connection } from "next/server";
import { Suspense } from "react";
import { DecisionBoard } from "@/components/DecisionBoard";
import { PageTitle, Skeleton } from "@/components/ui";
import { getDecisionEvidence } from "@/lib/decision/evidence";
import { getAnswers, getDecisions } from "@/lib/decision/store";
import { getKillSwitch } from "@/lib/killswitch";

export const metadata = { title: "Pre-build decision · Freshroots Operations Hub" };

export default function DecisionPage() {
  return (
    <>
      <PageTitle
        title="Pre-build decision"
        subtitle="The go / no-go gate: nine checks across five areas, then a recorded decision. STOP BUILD, PAUSE, REBUILD SMALLER or CONTINUE."
      />
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <DecisionBody />
      </Suspense>
    </>
  );
}

async function DecisionBody() {
  await connection();
  const [answers, evidence, history, killSwitch] = await Promise.all([getAnswers(), getDecisionEvidence(), getDecisions(10), getKillSwitch()]);
  return <DecisionBoard initial={answers} evidence={evidence} history={history} paused={killSwitch.paused} />;
}
