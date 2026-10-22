import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveKillSwitchState, isHardStop, type AutomationEvent } from "./killswitch-state";

const event = (action: "pause" | "resume", reason = "because"): AutomationEvent => ({
  id: 1,
  action,
  reason,
  actor: "demand-planner",
  createdAt: "2026-10-22T09:00:00Z",
});

describe("kill switch state", () => {
  it("is running when there are no events", () => {
    const s = deriveKillSwitchState(false, null);
    assert.equal(s.paused, false);
    assert.equal(s.source, "none");
  });

  it("is paused by the latest pause event, with who, when and why", () => {
    const s = deriveKillSwitchState(false, event("pause", "Supplier data looks wrong"));
    assert.equal(s.paused, true);
    assert.equal(s.source, "database");
    assert.equal(s.reason, "Supplier data looks wrong");
    assert.equal(s.actor, "demand-planner");
    assert.equal(s.since, "2026-10-22T09:00:00Z");
  });

  it("is running again after a resume event", () => {
    assert.equal(deriveKillSwitchState(false, event("resume")).paused, false);
  });

  it("the environment hard stop wins even after a resume", () => {
    const s = deriveKillSwitchState(true, event("resume"));
    assert.equal(s.paused, true);
    assert.equal(s.source, "environment");
  });

  it("parses the hard-stop variable strictly", () => {
    for (const on of ["1", "true", "TRUE", " on ", "paused", "yes"]) assert.equal(isHardStop(on), true, on);
    for (const off of [undefined, "", "0", "false", "off", "no", "maybe"]) assert.equal(isHardStop(off), false, String(off));
  });
});
