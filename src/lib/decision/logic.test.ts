import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHECKS, AREAS } from "./checks";
import { isOutcome, isStatus, suggestOutcome, type Answers, type Status } from "./logic";

const all = (s: Status): Answers => Object.fromEntries(CHECKS.map((c) => [c.key, s])) as Answers;

describe("the nine checks", () => {
  it("has exactly nine unique checks covering the five areas", () => {
    assert.equal(CHECKS.length, 9);
    assert.equal(new Set(CHECKS.map((c) => c.key)).size, 9);
    assert.deepEqual([...new Set(CHECKS.map((c) => c.area))].sort(), [...AREAS].sort());
  });
});

describe("suggestOutcome", () => {
  it("gives no suggestion until every check is assessed", () => {
    const s = suggestOutcome({ roi: "pass" });
    assert.equal(s.outcome, null);
    assert.equal(s.unassessed, 8);
    assert.match(s.why, /8 of 9/);
    assert.equal(suggestOutcome({}).unassessed, 9);
  });

  it("suggests CONTINUE only when all nine pass", () => {
    const s = suggestOutcome(all("pass"));
    assert.equal(s.outcome, "continue");
    assert.equal(s.passed, 9);
  });

  it("suggests PAUSE when nothing fails but something is only partial", () => {
    const s = suggestOutcome({ ...all("pass"), input_quality: "partial", roi: "partial" });
    assert.equal(s.outcome, "pause");
    assert.equal(s.partial, 2);
    assert.equal(s.passed, 7);
  });

  it("suggests REBUILD SMALLER when ROI fails but the foundation holds", () => {
    const s = suggestOutcome({ ...all("pass"), roi: "fail" });
    assert.equal(s.outcome, "rebuild_smaller");
    assert.match(s.why, /return/i);
  });

  it("suggests REBUILD SMALLER for any other failed check", () => {
    assert.equal(suggestOutcome({ ...all("pass"), output_used: "fail" }).outcome, "rebuild_smaller");
    assert.equal(suggestOutcome({ ...all("pass"), workflow_rules: "fail", output_fit: "fail" }).outcome, "rebuild_smaller");
  });

  it("suggests STOP BUILD when the problem or the inputs are not there", () => {
    assert.equal(suggestOutcome({ ...all("pass"), problem_cost: "fail" }).outcome, "stop_build");
    assert.equal(suggestOutcome({ ...all("pass"), problem_people: "fail" }).outcome, "stop_build");
    assert.equal(suggestOutcome({ ...all("pass"), input_present: "fail" }).outcome, "stop_build");
  });

  it("lets the strongest outcome win when several things are wrong", () => {
    const s = suggestOutcome({ ...all("partial"), roi: "fail", input_present: "fail" });
    assert.equal(s.outcome, "stop_build");
    assert.equal(s.failed, 2);
  });

  it("treats a failed input_quality as REBUILD SMALLER, not STOP (bad data can be fixed, missing data cannot)", () => {
    assert.equal(suggestOutcome({ ...all("pass"), input_quality: "fail" }).outcome, "rebuild_smaller");
  });
});

describe("validators", () => {
  it("accept only known values", () => {
    for (const s of ["pass", "partial", "fail", "unassessed"]) assert.equal(isStatus(s), true);
    for (const s of ["PASS", "", "ok", null, 3]) assert.equal(isStatus(s), false);
    for (const o of ["stop_build", "pause", "rebuild_smaller", "continue"]) assert.equal(isOutcome(o), true);
    for (const o of ["stop", "STOP BUILD", undefined]) assert.equal(isOutcome(o), false);
  });
});
