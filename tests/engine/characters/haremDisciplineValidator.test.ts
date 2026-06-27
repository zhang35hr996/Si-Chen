/**
 * haremDisciplineValidator 单元测试（HDV 系列）
 */
import { expect, it, describe } from "vitest";
import { validateHaremDisciplineLinks } from "../../../src/engine/characters/haremDisciplineValidator";
import { makeGameTime } from "../../../src/engine/calendar/time";

const now = makeGameTime(1, 1, "early");
const actorId = "actor_001";
const targetId = "target_001";

function makeSlice() {
  return {
    haremDisciplineIncidents: [] as Parameters<typeof validateHaremDisciplineLinks>[0]["haremDisciplineIncidents"],
    chronicle: [] as Parameters<typeof validateHaremDisciplineLinks>[0]["chronicle"],
    standing: {
      [actorId]: {},
      [targetId]: {},
    } as Parameters<typeof validateHaremDisciplineLinks>[0]["standing"],
  };
}

function makeIncident(id: string, status: "pending_response" | "resolved" = "pending_response") {
  return {
    id,
    actorId,
    targetId,
    status,
    courtEventId: `evt_${id}`,
    ...(status === "resolved" ? { resolution: "upheld" as const, resolvedAt: now } : {}),
  };
}

describe("validateHaremDisciplineLinks", () => {
  it("HDV-01: empty incidents → no errors", () => {
    const s = makeSlice();
    expect(validateHaremDisciplineLinks(s)).toHaveLength(0);
  });

  it("HDV-02: valid pending + matching event → no errors", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    expect(validateHaremDisciplineLinks(s)).toHaveLength(0);
  });

  it("HDV-03: duplicate id → error", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" }, { id: "evt_hdi_1_01b" });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"), makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_DUPLICATE_ID")).toBe(true);
  });

  it("HDV-04: two pending_response for same target → error", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" }, { id: "evt_hdi_1_02" });
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"), makeIncident("hdi_1_02"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MULTI_PENDING")).toBe(true);
  });

  it("HDV-05: courtEventId not in chronicle → error", () => {
    const s = makeSlice();
    // no event added to chronicle
    s.haremDisciplineIncidents.push(makeIncident("hdi_1_01"));
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_EVENT")).toBe(true);
  });

  it("HDV-06: actorId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" });
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      actorId: "nonexistent_actor",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_ACTOR")).toBe(true);
  });

  it("HDV-07: targetId not in standing → error", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" });
    s.haremDisciplineIncidents.push({
      ...makeIncident("hdi_1_01"),
      targetId: "nonexistent_target",
    });
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.some((e) => e.code === "HDI_MISSING_TARGET")).toBe(true);
  });

  it("HDV-08: resolved + pending for same target → no multi-pending error", () => {
    const s = makeSlice();
    s.chronicle.push({ id: "evt_hdi_1_01" }, { id: "evt_hdi_1_02" });
    s.haremDisciplineIncidents.push(
      makeIncident("hdi_1_01", "resolved"),
      makeIncident("hdi_1_02", "pending_response"),
    );
    const errs = validateHaremDisciplineLinks(s);
    expect(errs.every((e) => e.code !== "HDI_MULTI_PENDING")).toBe(true);
  });
});
