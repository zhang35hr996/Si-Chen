/**
 * The boot test (skeleton-plan §11): the SHIPPED content files are themselves
 * fixtures. If this fails, a content PR broke the game.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/engine/content/loader";
import { readContentDir } from "../../tools/validate-content";

describe("real content/ boots", () => {
  const { raw, parseErrors } = readContentDir(join(process.cwd(), "content"));
  const result = loadContent(raw);

  it("parses as strict JSON and passes the full loader with zero errors", () => {
    expect(parseErrors).toEqual([]);
    if (!result.ok) {
      throw new Error(result.error.map((e) => e.message).join("\n"));
    }
  });

  it("contains the planned slice + cold-palace pack: 8 characters, 23 locations, 17 events, 17 scenes, 22 ranks", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(Object.keys(db.characters).sort()).toEqual(
      ["xu_qinghuan", "shen_zhibai", "lu_huaijin", "wei_sui", "taihou", "wenya", "cheng_feng", "zhuchi"].sort(),
    );
    expect(Object.keys(db.locations).sort()).toEqual(
      [
        "xuanzhengdian", "cining_gong", "fengxiandian", "kunninggong", "changmengong",
        "wenzhaodian", "xianfugong", "zichendian", "yuhuayuan", "yuqing_gong",
        "zhaoning_gong", "chenghui_gong", "jingren_gong", "zhongcui_gong",
        "yanhe_gong", "jiyue_gong", "chengqian_gong", "yongshou_gong", "yikun_gong",
        "chuxiu_gong", "simiao", "wanbaolou", "zuixianlou",
      ].sort(),
    );
    expect(Object.keys(db.events).sort()).toEqual(
      [
        "arc_changmengong__ev_aftermath",
        "arc_changmengong__ev_visit",
        "ev_chaohui",
        "ev_fenghou_rules",
        "ev_menses_rite",
        "ev_shen_neglect",
        "ev_taihou_converse",
        // 宣政殿上朝：10 件随机朝政事务（每场抽 2–3 件，整场共 1 行动点）
        "ev_court_junxiang",
        "ev_court_jiafeng",
        "ev_court_jianfu",
        "ev_court_zhenzai",
        "ev_court_dashe",
        "ev_court_hegong",
        "ev_court_keju",
        "ev_court_hushi",
        "ev_court_yantie",
        "ev_court_fengjiang",
      ].sort(),
    );
    expect(Object.keys(db.scenes)).toHaveLength(17);
    expect(Object.keys(db.ranks)).toHaveLength(22);
  });

  it("wires the slice correctly: domains, start location, heavy rite event", () => {
    if (!result.ok) return;
    const db = result.value;
    expect(db.world.startingLocation).toBe("zichendian");
    expect(db.ranks[db.characters["shen_zhibai"]!.initialStanding!.rank]?.domain).toBe("harem");
    expect(db.ranks[db.characters["wei_sui"]!.initialStanding!.rank]?.domain).toBe("official");
    expect(db.events["ev_menses_rite"]?.apCost).toBe(1); // 召对是轻行动；真正的大祭（3+ AP 重行动）是未来单独的事件
    expect(db.characters["lu_huaijin"]?.defaultLocation).toBe("zhongcui_gong");
  });
});
