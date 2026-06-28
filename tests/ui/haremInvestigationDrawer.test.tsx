/**
 * Phase 5B-1B: HaremInvestigationDrawer 排序测试。
 * 重点验证 active 优先 + GameTime 数值排序（跨月、跨年、同月旬次）。
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HaremInvestigationDrawer, type HaremInvestigationCaseView } from "../../src/ui/components/HaremInvestigationDrawer";
import { makeGameTime } from "../../src/engine/calendar/time";

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
    render(<HaremInvestigationDrawer cases={cases} onClose={() => {}} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("old-active");
    expect(titles[1]).toBe("new-closed");
  });

  it("同组内 9月 < 10月（跨月）", () => {
    const cases = [
      makeView("sep", 1, 9, "late", "open"),
      makeView("oct", 1, 10, "early", "open"),
    ];
    render(<HaremInvestigationDrawer cases={cases} onClose={() => {}} />);
    const titles = renderedTitles();
    expect(titles[0]).toBe("oct");
    expect(titles[1]).toBe("sep");
  });

  it("同组内 9年12月 < 10年1月（跨年）", () => {
    const cases = [
      makeView("prev-year", 9, 12, "late", "closed_confirmed"),
      makeView("next-year", 10, 1, "early", "closed_confirmed"),
    ];
    render(<HaremInvestigationDrawer cases={cases} onClose={() => {}} />);
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
    render(<HaremInvestigationDrawer cases={cases} onClose={() => {}} />);
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
    render(<HaremInvestigationDrawer cases={cases} onClose={() => {}} />);
    const titles = renderedTitles();
    // active first: newest first
    expect(titles[0]).toBe("active-new");
    expect(titles[1]).toBe("active-old");
    // then closed: newest first
    expect(titles[2]).toBe("closed-new");
    expect(titles[3]).toBe("closed-old");
  });
});
