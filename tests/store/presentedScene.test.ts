/**
 * 呈现场景 zone 推导与宫内门控。核心：free-view（慈恩寺）不迁移 playerLocation，
 * 故必须按呈现态（freeViewId）推导，不能盲读 playerLocation——否则慈恩寺被误判为旧的宫内地点。
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import {
  derivePresentedZone,
  isImperialInteriorZone,
  isPresentedSceneImperialInterior,
} from "../../src/store/presentedScene";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();
const zoneOf = (id: string) => db.locations[id]?.zone;

describe("isImperialInteriorZone", () => {
  it("宫城(palace)与后宫(hougong)为宫内", () => {
    expect(isImperialInteriorZone("palace")).toBe(true);
    expect(isImperialInteriorZone("hougong")).toBe(true);
  });
  it("京城(jingcheng)与郊外(jingjiao)非宫内", () => {
    expect(isImperialInteriorZone("jingcheng")).toBe(false);
    expect(isImperialInteriorZone("jingjiao")).toBe(false);
    expect(isImperialInteriorZone(undefined)).toBe(false);
  });
  it("不把宫内等同于仅 palace（后宫侍君宫殿不被错误排除）", () => {
    expect(isImperialInteriorZone("hougong")).toBe(true);
    expect(zoneOf("kunninggong")).toBe("hougong"); // 坤宁宫在后宫
    expect(isImperialInteriorZone(zoneOf("kunninggong"))).toBe(true);
  });
});

describe("derivePresentedZone — free-view 不盲读 playerLocation", () => {
  it("慈恩寺 free-view：用 freeViewId(simiao→jingjiao)，即便 playerLocation 仍是慈宁宫(palace)", () => {
    const zone = derivePresentedZone({
      view: "freeview",
      freeViewId: "simiao",
      shopId: null,
      currentBoard: "jingjiao",
      playerLocation: "cining_gong", // 旧的宫内地点（free-view 未迁移）
      zoneOf,
    });
    expect(zone).toBe("jingjiao");
    expect(isImperialInteriorZone(zone)).toBe(false); // 慈恩寺不在宫内
  });

  it("证明不依赖 playerLocation：playerLocation 是 palace 但呈现 simiao → 非宫内", () => {
    expect(zoneOf("cining_gong")).toBe("palace"); // playerLocation 本身是宫内
    const interior = isPresentedSceneImperialInterior({
      view: "freeview", freeViewId: "simiao", shopId: null,
      currentBoard: "jingjiao", playerLocation: "cining_gong", zoneOf,
    });
    expect(interior).toBe(false); // 仍判为非宫内（按呈现态 simiao）
  });

  it("长门宫 free-view（冷宫，后宫 hougong）仍属宫内", () => {
    const zone = derivePresentedZone({
      view: "freeview", freeViewId: "changmengong", shopId: null,
      currentBoard: "hougong", playerLocation: "zichendian", zoneOf,
    });
    expect(zone).toBe("hougong");
    expect(isImperialInteriorZone(zone)).toBe(true);
  });
});

describe("derivePresentedZone — 商铺/地图/专用屏", () => {
  it("商铺(view=shop)：用 shopId(京城)", () => {
    expect(derivePresentedZone({
      view: "shop", freeViewId: null, shopId: "wanbaolou",
      currentBoard: "jingcheng", playerLocation: "cining_gong", zoneOf,
    })).toBe("jingcheng");
  });

  it("地图(view=map)：用 currentBoard（看板 id 即 zone）", () => {
    // 进京城商铺时 enterShop 在 view=map 掷骰，currentBoard=jingcheng → 非宫内
    expect(derivePresentedZone({
      view: "map", freeViewId: null, shopId: null,
      currentBoard: "jingcheng", playerLocation: "cining_gong", zoneOf,
    })).toBe("jingcheng");
    // 宫城看板 → 宫内
    expect(derivePresentedZone({
      view: "map", freeViewId: null, shopId: null,
      currentBoard: "palace", playerLocation: "cining_gong", zoneOf,
    })).toBe("palace");
  });

  it("专用宫殿屏 / 普通 location：用 playerLocation（已由 travel 正确置位）", () => {
    expect(derivePresentedZone({
      view: "zichendian", freeViewId: null, shopId: null,
      currentBoard: "palace", playerLocation: "zichendian", zoneOf,
    })).toBe("palace");
    expect(derivePresentedZone({
      view: "location", freeViewId: null, shopId: null,
      currentBoard: "hougong", playerLocation: "kunninggong", zoneOf,
    })).toBe("hougong");
  });
});
