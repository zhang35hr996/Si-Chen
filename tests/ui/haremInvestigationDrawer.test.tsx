/**
 * Phase 5B-1B / 5B-3: HaremInvestigationDrawer 排序 + 交互行为测试。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HaremInvestigationDrawer, type HaremInvestigationCaseView, type HaremInvestigationDrawerCallbacks, type InvestigationReviewDecision } from "../../src/ui/components/HaremInvestigationDrawer";
import type { InvestigationDetailPresentation } from "../../src/ui/haremInvestigationPresenter";
import { makeGameTime } from "../../src/engine/calendar/time";

const NO_OP_CALLBACKS: HaremInvestigationDrawerCallbacks = {
  onStartTask: vi.fn().mockResolvedValue(null),
  onCancelCase: vi.fn().mockResolvedValue(null),
  onReviewCase: vi.fn().mockResolvedValue(null) as HaremInvestigationDrawerCallbacks["onReviewCase"],
};

function makeView(
  id: string,
  year: number,
  month: number,
  period: "early" | "mid" | "late",
  status: "open" | "closed_confirmed" = "open",
): HaremInvestigationCaseView {
  const openedAt = makeGameTime(year, month, period);
  const openedAtLabel = `${year === 1 ? "元年" : `${year}年`}${month}月${period === "early" ? "上旬" : period === "mid" ? "中旬" : "下旬"}`;
  return {
    id,
    openedAt,
    status,
    presentation: {
      title: id,
      openedAtLabel,
      statusLabel: status === "open" ? "待查" : "已经查明",
      targetLabels: [],
      suspectLabels: [],
      emptySuspectText: "目前尚无明确嫌疑人",
      kindLabels: [],
      emptyKindText: "作案手段尚未查明",
      confidenceLabel: "线索模糊",
      leadViews: [],
      availableActionViews: [],
      canConfirmCulprit: false,
      suspectViews: [],
      verdictOptions: { canConfirmCulprit: false, confirmableSuspects: [], canConfirmBenignCause: false },
    },
  };
}

function renderedTitles(): string[] {
  return Array.from(document.querySelectorAll(".investigation-case-list__title"))
    .map((el) => el.textContent ?? "")
    .filter(Boolean);
}

describe("HaremInvestigationDrawer: 排序", () => {
  it("active 优先于 closed，不论时间", () => {
    const cases = [
      makeView("old-active", 1, 1, "early", "open"),
      makeView("new-closed", 1, 9, "late", "closed_confirmed"),
    ];
    render(<HaremInvestigationDrawer cases={cases} playerAp={3} onClose={() => {}} callbacks={NO_OP_CALLBACKS} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("old-active");
    expect(titles[1]).toBe("new-closed");
  });

  it("同组内 9月 < 10月（跨月）", () => {
    const cases = [
      makeView("sep", 1, 9, "late", "open"),
      makeView("oct", 1, 10, "early", "open"),
    ];
    render(<HaremInvestigationDrawer cases={cases} playerAp={3} onClose={() => {}} callbacks={NO_OP_CALLBACKS} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("oct");
    expect(titles[1]).toBe("sep");
  });

  it("同组内 9年12月 < 10年1月（跨年）", () => {
    const cases = [
      makeView("prev-year", 9, 12, "late", "closed_confirmed"),
      makeView("next-year", 10, 1, "early", "closed_confirmed"),
    ];
    render(<HaremInvestigationDrawer cases={cases} playerAp={3} onClose={() => {}} callbacks={NO_OP_CALLBACKS} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("next-year");
    expect(titles[1]).toBe("prev-year");
  });

  it("同月下旬 > 中旬 > 上旬", () => {
    const cases = [
      makeView("early", 2, 5, "early", "open"),
      makeView("mid", 2, 5, "mid", "open"),
      makeView("late", 2, 5, "late", "open"),
    ];
    render(<HaremInvestigationDrawer cases={cases} playerAp={3} onClose={() => {}} callbacks={NO_OP_CALLBACKS} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("late");
    expect(titles[1]).toBe("mid");
    expect(titles[2]).toBe("early");
  });

  it("active 组内新案优先，closed 组内亦然", () => {
    const cases = [
      makeView("active-old", 1, 3, "early", "open"),
      makeView("active-new", 2, 1, "late", "open"),
      makeView("closed-old", 1, 1, "early", "closed_confirmed"),
      makeView("closed-new", 1, 8, "mid", "closed_confirmed"),
    ];
    render(<HaremInvestigationDrawer cases={cases} playerAp={3} onClose={() => {}} callbacks={NO_OP_CALLBACKS} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("active-new");
    expect(titles[1]).toBe("active-old");
    expect(titles[2]).toBe("closed-new");
    expect(titles[3]).toBe("closed-old");
  });
});

// ── 交互行为测试 ───────────────────────────────────────────────────────

function makeDetailPresentation(overrides: Partial<InvestigationDetailPresentation> = {}): InvestigationDetailPresentation {
  return {
    title: "测试案件",
    openedAtLabel: "元年3月上旬",
    statusLabel: "待查",
    targetLabels: ["受害者甲"],
    suspectLabels: ["嫌疑人乙"],
    emptySuspectText: "目前尚无明确嫌疑人",
    emptyKindText: "作案手段尚未查明",
    kindLabels: [],
    confidenceLabel: "线索模糊",
    leadViews: [],
    availableActionViews: [],
    canConfirmCulprit: false,
    suspectViews: [],
    verdictOptions: { canConfirmCulprit: false, confirmableSuspects: [], canConfirmBenignCause: false },
    ...overrides,
  };
}

function makeInteractiveCase(
  status: HaremInvestigationCaseView["status"],
  presentation?: Partial<InvestigationDetailPresentation>,
): HaremInvestigationCaseView {
  return {
    id: "icase_test",
    openedAt: makeGameTime(1, 3, "early"),
    status,
    presentation: makeDetailPresentation(presentation),
  };
}

describe("HaremInvestigationDrawer: 交互", () => {
  let callbacks: HaremInvestigationDrawerCallbacks;

  beforeEach(() => {
    callbacks = {
      onStartTask: vi.fn().mockResolvedValue(null),
      onCancelCase: vi.fn().mockResolvedValue(null),
      onReviewCase: vi.fn().mockResolvedValue(null) as HaremInvestigationDrawerCallbacks["onReviewCase"],
    };
  });

  it("点击案件 → 进入详情", () => {
    const c = makeInteractiveCase("open");
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    expect(screen.getByText("← 返回列表")).toBeDefined();
  });

  it("继续调查 → onReviewCase({type:'continue'})，不调用 onCancelCase", async () => {
    const c = makeInteractiveCase("ready_for_review");
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    const continueBtn = screen.getByText("继续调查");
    fireEvent.click(continueBtn);
    await vi.waitFor(() => expect(callbacks.onReviewCase).toHaveBeenCalledTimes(1));
    const call = (callbacks.onReviewCase as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("icase_test");
    expect((call[1] as InvestigationReviewDecision).type).toBe("continue");
    expect(callbacks.onCancelCase).not.toHaveBeenCalled();
  });

  it("无可确认主谋（verdictOptions.canConfirmCulprit=false）→ 不渲染确认主谋按钮", () => {
    const c = makeInteractiveCase("ready_for_review", {
      verdictOptions: { canConfirmCulprit: false, confirmableSuspects: [], canConfirmBenignCause: false },
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    expect(screen.queryByText("确认主谋")).toBeNull();
    // 但「证据不足，结案」仍可用
    expect(screen.getByText("证据不足，结案")).toBeTruthy();
  });

  it("culprit_ready + 嫌疑人已选 → 确认主谋按钮可点击，派发 confirm", async () => {
    const c = makeInteractiveCase("ready_for_review", {
      verdictOptions: {
        canConfirmCulprit: true,
        confirmableSuspects: [{ id: "suspect_x", label: "嫌疑人乙" }],
        canConfirmBenignCause: false,
      },
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "suspect_x" } });
    const confirmBtn = screen.getByText("确认主谋");
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmBtn);
    await vi.waitFor(() => expect(callbacks.onReviewCase).toHaveBeenCalledTimes(1));
    const call = (callbacks.onReviewCase as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as InvestigationReviewDecision).type).toBe("confirm");
    expect((call[1] as Extract<InvestigationReviewDecision, {type:"confirm"}>).suspectId).toBe("suspect_x");
  });

  it("benign_ready → 显示「确认并非人为加害」，不显示主谋选择器，派发 confirm_benign_cause", async () => {
    const c = makeInteractiveCase("ready_for_review", {
      verdictOptions: { canConfirmCulprit: false, confirmableSuspects: [], canConfirmBenignCause: true, benignCauseLabel: "皇嗣自身旧疾发作" },
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("确认主谋")).toBeNull();
    const benignBtn = screen.getByText("确认并非人为加害");
    fireEvent.click(benignBtn);
    await vi.waitFor(() => expect(callbacks.onReviewCase).toHaveBeenCalledTimes(1));
    const call = (callbacks.onReviewCase as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1] as InvestigationReviewDecision).type).toBe("confirm_benign_cause");
  });

  it("调查候选下拉显示姓名，不显示 raw ID", () => {
    const c = makeInteractiveCase("open", {
      availableActionViews: [{
        method: "question_suspect",
        label: "传问嫌疑人",
        apCost: 1,
        durationDays: 3,
        subjects: [
          { id: "lu_huaijin", label: "陆怀瑾" },
          { id: "xu_qinghuan", label: "徐青环" },
        ],
      }],
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    expect(screen.queryByText("lu_huaijin")).toBeNull();
    expect(screen.queryByText("xu_qinghuan")).toBeNull();
    expect(screen.getByText("陆怀瑾")).toBeDefined();
    expect(screen.getByText("徐青环")).toBeDefined();
  });

  it("两个行动的 subject 选择互不干扰", async () => {
    const c = makeInteractiveCase("open", {
      availableActionViews: [
        {
          method: "question_target",
          label: "询问受害者",
          apCost: 1,
          durationDays: 3,
          subjects: [{ id: "target_a", label: "受害者甲" }],
        },
        {
          method: "question_suspect",
          label: "传问嫌疑人",
          apCost: 1,
          durationDays: 3,
          subjects: [{ id: "suspect_x", label: "嫌疑人乙" }],
        },
      ],
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Select subject for first action only
    fireEvent.change(selects[0]!, { target: { value: "target_a" } });
    // Second select should remain empty
    expect(selects[1]!.value).toBe("");
  });

  it("AP 不足 → 调查按钮禁用", () => {
    const c = makeInteractiveCase("open", {
      availableActionViews: [{
        method: "quiet_inquiry",
        label: "暗中查访",
        apCost: 3,
        durationDays: 6,
      }],
    });
    render(<HaremInvestigationDrawer cases={[c]} playerAp={2} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    // Use getAllByRole since button text spans multiple text nodes
    const actionBtns = screen.getAllByRole("button").filter(
      (b) => b.textContent?.includes("暗中查访"),
    );
    expect(actionBtns.length).toBeGreaterThan(0);
    expect((actionBtns[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("pending 中防双击：按钮不可重复触发", async () => {
    let resolveCb!: () => void;
    (callbacks.onReviewCase as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<string | null>((r) => { resolveCb = () => r(null); }),
    );
    const c = makeInteractiveCase("ready_for_review");
    render(<HaremInvestigationDrawer cases={[c]} playerAp={3} onClose={() => {}} callbacks={callbacks} />);
    fireEvent.click(screen.getByText("测试案件"));
    const continueBtn = screen.getByText("继续调查");
    fireEvent.click(continueBtn);
    // Button should be disabled while pending
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
    resolveCb();
    await vi.waitFor(() => expect((continueBtn as HTMLButtonElement).disabled).toBe(false));
    expect(callbacks.onReviewCase).toHaveBeenCalledTimes(1);
  });
});
