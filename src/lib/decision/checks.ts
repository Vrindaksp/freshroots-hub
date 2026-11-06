/**
 * The nine pre-build checks. DRAFT WORDING: the case map names the five areas Deepa assesses (problem reality,
 * workflow repeatability, input availability, output value, ROI) and says "9 checks", but not the nine questions,
 * so these are derived from those five areas. Replace the text here with the case's exact checks if they differ;
 * nothing else needs to change as long as each `key` stays unique.
 */

export type CheckKey =
  | "problem_cost"
  | "problem_people"
  | "workflow_repeat"
  | "workflow_rules"
  | "input_present"
  | "input_quality"
  | "output_used"
  | "output_fit"
  | "roi";

export type Area = "Problem reality" | "Workflow repeatability" | "Input availability" | "Output value" | "ROI";

export interface CheckDef {
  key: CheckKey;
  area: Area;
  question: string;
  /** What a clear "Pass" looks like, shown under the question. */
  good: string;
}

export const AREAS: Area[] = ["Problem reality", "Workflow repeatability", "Input availability", "Output value", "ROI"];

export const CHECKS: CheckDef[] = [
  {
    key: "problem_cost",
    area: "Problem reality",
    question: "Is the cost of the problem documented in rupees?",
    good: "A baseline exists (the brief cites ₹28–34 L lost per quarter) and someone owns that number.",
  },
  {
    key: "problem_people",
    area: "Problem reality",
    question: "Do named people do this work by hand today?",
    good: "You can point to the people and the hours: Raghav's monthly forecast, Priya's four-hour Monday pull.",
  },
  {
    key: "workflow_repeat",
    area: "Workflow repeatability",
    question: "Does the work repeat on a fixed schedule?",
    good: "It happens monthly or weekly in the same shape, so automating it pays back every cycle.",
  },
  {
    key: "workflow_rules",
    area: "Workflow repeatability",
    question: "Can the decision logic be written down as rules?",
    good: "The thresholds can be stated and tested, and only a small share of cases need human judgment.",
  },
  {
    key: "input_present",
    area: "Input availability",
    question: "Do the inputs exist in digital form?",
    good: "Sales, stock, SKU and calendar data are available as files or feeds, not just in someone's head.",
  },
  {
    key: "input_quality",
    area: "Input availability",
    question: "Is the data complete and fresh enough to trust?",
    good: "Enough history for the averages, a recent stock snapshot, and no key metric without a real source.",
  },
  {
    key: "output_used",
    area: "Output value",
    question: "Will someone act on the output?",
    good: "Recommendations get approved or overridden and alerts get acknowledged, not ignored.",
  },
  {
    key: "output_fit",
    area: "Output value",
    question: "Does the output fit how the work already flows?",
    good: "Purchase orders reach Zoho and executives read the same twelve metrics they already expect.",
  },
  {
    key: "roi",
    area: "ROI",
    question: "Do the expected savings clearly beat the build and running cost?",
    good: "Modelled savings on real prices exceed the budget and the monthly running cost within the time horizon.",
  },
];

export const CHECK_BY_KEY = new Map(CHECKS.map((c) => [c.key, c]));
