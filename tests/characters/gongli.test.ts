import { describe, expect, it } from "vitest";
import { attendantsOf, reportingAttendant } from "../../src/engine/characters/gongli";
import { MALE_ATTENDANT_RESERVED_CHARS } from "../../src/engine/characters/lilangNames";

describe("attendantsOf", () => {
  it("确定性：同 (seed,consortId) 稳定", () => {
    expect(attendantsOf(1, "lu_huaijin")).toEqual(attendantsOf(1, "lu_huaijin"));
  });

  it("2 名互不相同，名字落在池中，立绘 gongli1–6", () => {
    const [a, b] = attendantsOf(1, "lu_huaijin");
    expect(a.name).not.toBe(b.name);
    expect(MALE_ATTENDANT_RESERVED_CHARS).toContain(a.name);
    expect(MALE_ATTENDANT_RESERVED_CHARS).toContain(b.name);
    expect(a.portraitSet).toMatch(/^gongli[1-6]$/);
    expect(b.portraitSet).toMatch(/^gongli[1-6]$/);
  });
});

describe("reportingAttendant", () => {
  it("按 dayIndex 在 2 名间切换", () => {
    const [a, b] = attendantsOf(1, "lu_huaijin");
    expect(reportingAttendant(1, "lu_huaijin", 2)).toEqual(a); // 偶
    expect(reportingAttendant(1, "lu_huaijin", 3)).toEqual(b); // 奇
  });
});
