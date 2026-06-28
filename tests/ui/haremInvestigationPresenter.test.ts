/**
 * Phase 5B-1B: haremInvestigationPresenter 单元测试。
 */
import { describe, expect, it } from "vitest";
import {
  presentHaremInvestigationCase,
  CASE_STATUS_LABELS,
} from "../../src/ui/haremInvestigationPresenter";
import type { IntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/types";
import type { GameTime } from "../../src/engine/calendar/time";
import { makeGameTime } from "../../src/engine/calendar/time";

const AT: GameTime = makeGameTime(1, 3, "early");

function makeCase(overrides: Partial<IntrigueInvestigationCase> = {}): IntrigueInvestigationCase {
  return {
    id: "icase_test_001",
    source: { reportId: "ireport_test_001", incidentId: "incident_001" },
    openedAt: AT,
    openedFromReportKind: "exposure",
    status: "open",
    knownTargetIds: ["lu_huaijin"],
    suspectIds: ["bai_zhuying"],
    suspectedKinds: ["slander"],
    confidence: "confirmed",
    leadIds: [],
    ...overrides,
  };
}

const resolveName = (id: string) => `name:${id}`;
const unknownResolve = (_id: string) => "身份不明之人";

// ── 标题生成 ───────────────────────────────────────────────────────────────────

describe("presentHaremInvestigationCase: title", () => {
  it("有嫌疑人与目标时：'嫌疑人涉嫌手段目标案'", () => {
    const pres = presentHaremInvestigationCase(makeCase(), resolveName);
    expect(pres.title).toBe("name:bai_zhuying涉嫌散布谣言name:lu_huaijin案");
  });

  it("有嫌疑人但无手段时：使用'构陷'", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectedKinds: [] }), resolveName);
    expect(pres.title).toBe("name:bai_zhuying涉嫌构陷name:lu_huaijin案");
  });

  it("无嫌疑人有目标时：'{目标}处异常'", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectIds: [] }), resolveName);
    expect(pres.title).toBe("name:lu_huaijin处异常");
  });

  it("无嫌疑人无目标时：'宫中异常案'", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectIds: [], knownTargetIds: [] }), resolveName);
    expect(pres.title).toBe("宫中异常案");
  });

  it("anomaly 案件无嫌疑人：'目标处异常'（不显示 actor）", () => {
    const pres = presentHaremInvestigationCase(
      makeCase({ openedFromReportKind: "anomaly", suspectIds: [] }),
      resolveName,
    );
    expect(pres.title).toBe("name:lu_huaijin处异常");
    expect(pres.suspectLabels).toEqual([]);
  });

  it("多个目标时标题只取第一个", () => {
    const pres = presentHaremInvestigationCase(
      makeCase({ knownTargetIds: ["lu_huaijin", "wei_sui"], suspectIds: [] }),
      resolveName,
    );
    expect(pres.title).toBe("name:lu_huaijin处异常");
  });
});

// ── 嫌疑人与手段 ───────────────────────────────────────────────────────────────

describe("presentHaremInvestigationCase: suspectLabels & kindLabels", () => {
  it("有嫌疑人时正确解析姓名", () => {
    const pres = presentHaremInvestigationCase(makeCase(), resolveName);
    expect(pres.suspectLabels).toEqual(["name:bai_zhuying"]);
  });

  it("无嫌疑人时 suspectLabels 为空数组，emptySuspectText 有值", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectIds: [] }), resolveName);
    expect(pres.suspectLabels).toEqual([]);
    expect(pres.emptySuspectText).toBe("目前尚无明确嫌疑人");
  });

  it("有手段时映射正确标签", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectedKinds: ["false_accusation"] }), resolveName);
    expect(pres.kindLabels).toEqual(["诬告陷害"]);
  });

  it("无手段时 kindLabels 为空数组，emptyKindText 有值", () => {
    const pres = presentHaremInvestigationCase(makeCase({ suspectedKinds: [] }), resolveName);
    expect(pres.kindLabels).toEqual([]);
    expect(pres.emptyKindText).toBe("作案手段尚未查明");
  });

  it("未知角色 ID 使用 fallback：不直接显示 raw id", () => {
    const pres = presentHaremInvestigationCase(makeCase(), unknownResolve);
    expect(pres.suspectLabels).toEqual(["身份不明之人"]);
    expect(pres.suspectLabels[0]).not.toBe("bai_zhuying");
  });
});

// ── 置信度标签 ─────────────────────────────────────────────────────────────────

describe("presentHaremInvestigationCase: confidenceLabel", () => {
  it.each([
    ["tenuous", "线索模糊"],
    ["plausible", "略有眉目"],
    ["strong", "线索较明"],
    ["confirmed", "已有确证"],
  ] as const)("confidence=%s → %s", (conf, label) => {
    const pres = presentHaremInvestigationCase(makeCase({ confidence: conf }), resolveName);
    expect(pres.confidenceLabel).toBe(label);
  });
});

// ── 状态标签 ──────────────────────────────────────────────────────────────────

describe("CASE_STATUS_LABELS: 所有状态都有中文标签", () => {
  it.each([
    ["open", "待查"],
    ["in_progress", "调查中"],
    ["ready_for_review", "待裁定"],
    ["closed_unresolved", "未能查明"],
    ["closed_confirmed", "已经查明"],
    ["cancelled", "已终止"],
  ] as const)("status=%s → %s", (status, label) => {
    expect(CASE_STATUS_LABELS[status]).toBe(label);
    const pres = presentHaremInvestigationCase(
      makeCase({ status, ...(status !== "open" && status !== "in_progress" && status !== "ready_for_review" ? { closedAt: AT, closureReason: "player_cancelled" as const } : {}) }),
      resolveName,
    );
    expect(pres.statusLabel).toBe(label);
  });
});

// ── openedAtLabel ─────────────────────────────────────────────────────────────

describe("presentHaremInvestigationCase: openedAtLabel", () => {
  it("元年三月上旬", () => {
    const pres = presentHaremInvestigationCase(makeCase(), resolveName);
    expect(pres.openedAtLabel).toBe("元年3月上旬");
  });

  it("非元年使用年份数字", () => {
    const pres = presentHaremInvestigationCase(makeCase({ openedAt: makeGameTime(3, 6, "late") }), resolveName);
    expect(pres.openedAtLabel).toBe("3年6月下旬");
  });
});

// ── targetLabels ──────────────────────────────────────────────────────────────

describe("presentHaremInvestigationCase: targetLabels", () => {
  it("正确解析目标姓名列表", () => {
    const pres = presentHaremInvestigationCase(makeCase({ knownTargetIds: ["lu_huaijin", "wei_sui"] }), resolveName);
    expect(pres.targetLabels).toEqual(["name:lu_huaijin", "name:wei_sui"]);
  });
});
