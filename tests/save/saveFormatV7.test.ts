import { describe, it, expect } from "vitest";
import { SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

describe("SAVE_FORMAT_VERSION = 7（Phase 3 字段引入，旧档隔离）", () => {
  it("常量已 bump 到 7", () => {
    expect(SAVE_FORMAT_VERSION).toBe(7);
  });
});
