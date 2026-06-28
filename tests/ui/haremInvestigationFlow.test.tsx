/**
 * Phase 5B-1B: HaremIntrigueReportModal 立案交互流程测试。
 * 验证：
 *  - 可立案 kind（anomaly/rumor/exposure）显示"命人查办"按钮
 *  - 不可立案 kind（investigation_update/investigation_final）不显示按钮
 *  - 点击调用 onInvestigate 一次
 *  - 立案失败时弹窗不关闭，显示 errorMessage
 *  - anomaly 不向玩家显示 actorLabel
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HaremIntrigueReportModal } from "../../src/ui/components/HaremIntrigueReportModal";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { HaremIntrigueReport, GameState, HaremIntrigueReportKind } from "../../src/engine/state/types";

const db = loadRealContent();
const state: GameState = createNewGameState(db);
const AT = makeGameTime(1, 3, "early");

function makeReport(kind: HaremIntrigueReportKind, summaryCode = "exposure_slander_success"): HaremIntrigueReport {
  return {
    id: "ireport_flow_001",
    source: { incidentId: "incident_flow_001" },
    reportKind: kind,
    createdAt: AT,
    status: "unread",
    knownTargetIds: ["lu_huaijin"],
    suspectedActorIds: kind === "anomaly" ? [] : ["lu_huaijin"],
    suspectedKinds: ["slander"],
    knownOutcome: "harm_observed",
    confidence: "confirmed",
    summaryCode,
  };
}

function mount(
  kind: HaremIntrigueReportKind,
  onInvestigate?: () => void,
  errorMessage?: string,
) {
  const onAcknowledge = vi.fn();
  render(
    <HaremIntrigueReportModal
      db={db}
      state={state}
      report={makeReport(kind)}
      onAcknowledge={onAcknowledge}
      onInvestigate={onInvestigate}
      errorMessage={errorMessage}
    />,
  );
  return { onAcknowledge };
}

describe("HaremIntrigueReportModal: 命人查办按钮可见性", () => {
  it.each(["anomaly", "rumor", "exposure"] as const)("reportKind=%s：有 onInvestigate 时显示按钮", (kind) => {
    mount(kind, vi.fn());
    expect(screen.getByRole("button", { name: "命人查办" })).toBeInTheDocument();
  });

  it.each(["investigation_update", "investigation_final"] as const)(
    "reportKind=%s：即使有 onInvestigate 也不显示按钮",
    (kind) => {
      mount(kind, vi.fn());
      expect(screen.queryByRole("button", { name: "命人查办" })).toBeNull();
    },
  );

  it("没有 onInvestigate 时不显示按钮（exposure）", () => {
    mount("exposure", undefined);
    expect(screen.queryByRole("button", { name: "命人查办" })).toBeNull();
  });
});

describe("HaremIntrigueReportModal: 命人查办交互", () => {
  it("点击调用 onInvestigate 一次", async () => {
    const onInvestigate = vi.fn();
    mount("exposure", onInvestigate);
    await userEvent.click(screen.getByRole("button", { name: "命人查办" }));
    expect(onInvestigate).toHaveBeenCalledTimes(1);
  });

  it("errorMessage 时显示错误文字", () => {
    mount("exposure", vi.fn(), "案件已存在，无需重复立案");
    expect(screen.getByRole("alert")).toHaveTextContent("案件已存在，无需重复立案");
    // 弹窗仍然存在（"命人查办"仍可点击）
    expect(screen.getByRole("button", { name: "命人查办" })).toBeInTheDocument();
  });

  it("无错误时不渲染 alert 区域", () => {
    mount("exposure", vi.fn(), undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("HaremIntrigueReportModal: 知道了", () => {
  it("点击调用 onAcknowledge", async () => {
    const { onAcknowledge } = mount("exposure", vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});

describe("HaremIntrigueReportModal: anomaly 不泄露 actor", () => {
  it("anomaly 报告不显示「涉事之人」字段", () => {
    mount("anomaly", vi.fn());
    // 若字段渲染，"涉事之人："会出现在 DOM 中
    expect(screen.queryByText(/涉事之人/)).toBeNull();
  });
});
