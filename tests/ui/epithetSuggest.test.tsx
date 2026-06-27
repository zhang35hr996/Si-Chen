import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Epithet } from "../../src/engine/characters/epithetPool";
import { EpithetSuggest } from "../../src/ui/components/EpithetSuggest";

const candidate: Epithet = {
  char: "华",
  meaning: "光彩繁盛曰华",
  tags: ["祥瑞", "文雅"],
  suitableFor: ["consort"],
  rarity: "common",
};

describe("EpithetSuggest", () => {
  it("推荐卡只显示封号字与一行释义，不显示分类 tag", () => {
    render(<EpithetSuggest candidates={[candidate]} onSelect={() => {}} onCustom={() => {}} />);

    expect(screen.getByText("华")).toBeInTheDocument();
    expect(screen.getByText("光彩繁盛曰华")).toBeInTheDocument();
    expect(screen.queryByText("祥瑞")).toBeNull();
    expect(screen.queryByText("文雅")).toBeNull();
  });

  it("点击推荐封号仍提交对应单字", async () => {
    const onSelect = vi.fn();
    render(<EpithetSuggest candidates={[candidate]} onSelect={onSelect} onCustom={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /华.*光彩繁盛曰华/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("华");
  });
});
