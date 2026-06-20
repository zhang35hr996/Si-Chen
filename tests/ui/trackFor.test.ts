import { describe, it, expect } from "vitest";
import { trackFor } from "../../src/ui/audio/trackFor";

describe("trackFor", () => {
  it("标题用 main", () => expect(trackFor({ view: "title" })).toBe("main"));
  it("院子用 hougong", () => expect(trackFor({ view: "courtyard" })).toBe("hougong"));
  it("地图在后宫板用 hougong", () => expect(trackFor({ view: "map", board: "hougong" })).toBe("hougong"));
  it("地图在京城板用 market", () => expect(trackFor({ view: "map", board: "jingcheng" })).toBe("market"));
  it("地图在郊外板用 jiaowai", () => expect(trackFor({ view: "map", board: "jingjiao" })).toBe("jiaowai"));
  it("后宫居所(zone=hougong)用 hougong", () => expect(trackFor({ view: "location", zone: "hougong" })).toBe("hougong"));
  it("京城地点(zone=jingcheng)用 market", () => expect(trackFor({ view: "location", zone: "jingcheng" })).toBe("market"));
  it("其余用 wenqing", () => expect(trackFor({ view: "location", zone: "palace" })).toBe("wenqing"));
});
