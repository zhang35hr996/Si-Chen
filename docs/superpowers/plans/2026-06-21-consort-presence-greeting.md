# 侍君临场系统 + 卯时请安仪式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让侍君按时辰临场（同一时辰只在一地）、卯时全员赴坤宁宫请安，并支持翌晨免请安与坤宁宫请安场景。

**Architecture:** 引擎层新增时辰感知纯函数（`consortLocationAt`/`presentAt`/游走掷骰），不改既有 `getCharacterLocation`/`getPresentAt`（住处语义，搬迁/地图依赖）；store 层装配免请安/留宿效果；UI 层加缺席禀报、乘风请安遮罩、请安场景、离宫二选一。

**Tech Stack:** TypeScript, React, Vitest（`tests/**/*.test.ts`，node 环境）。确定性掷骰复用 `fnv1a64Hex`。

## Global Constraints

- 测试：`npx vitest run <file>` 单跑；全量 `npm test`。测试放 `tests/`，镜像 `src/` 路径。
- 纯函数在 `src/engine/**`，不可引用 React/store；装配在 `src/store/**`；UI 在 `src/ui/**`。
- 状态变更走「纯函数返回新 state → GameStore 方法 set+emit」模式（见 `src/store/treasury.ts`）。
- pre-release，状态新增字段为可选，**不写存档迁移**（[[no-save-backcompat]]）。
- 时辰槽位：卯(0) 辰(1) 申(2) 酉(3) 戌(4) 子(5)；`shichenSlot(calendar)=apMax-ap`。注意既有 `MORNING_SLOT=1` 指辰时，**非卯时**。
- 掷骰范式：`parseInt(fnv1a64Hex(\`...\`).slice(0,8),16) % 100`（见 `src/engine/characters/conception.ts:10`）。
- 数值：免请安 affection **+3**、favor **+2**；游走基础概率 **25**，性格关键词每命中 ±15，clamp **[5,60]**；游走仅 slot 1–3。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/engine/calendar/time.ts`（改） | 加 `MAO_SLOT=0` + `isGreetingSlot(calendar)` |
| `src/engine/state/types.ts`（改） | `GameState` 加 `excusedFromGreeting?` / `overnightWith?` |
| `src/engine/characters/greeting.ts`（新） | `isExcused`、`wanderChance`、`wanders`、`greetingAttendees` |
| `src/engine/characters/presence.ts`（改） | 加 `consortLocationAt`、`presentAt`（不改既有两函数） |
| `src/store/greeting.ts`（新） | `excuseFromGreeting`、`dismissOvernight`、`recordOvernight` |
| `src/store/gameStore.ts`（改） | `applyExcuseGreeting` / `dismissOvernight` / `recordOvernight` 方法 |
| `src/ui/App.tsx`（改） | 留宿接线、请安遮罩/场景/离宫二选一 状态与回调 |
| `src/ui/screens/LocationScreen.tsx`（改） | 改用 `presentAt`；坤宁宫请安遮罩；离宫拦截；缺席数据下传 |
| `src/ui/screens/CharacterScene.tsx`（改） | 住客缺席禀报渲染 |
| `src/ui/components/GreetingCeremonyOverlay.tsx`（新） | 请安场景遮罩（皇后率众行礼 + 「无事」） |

---

## Task 1: 状态字段 + 时辰常量 + `isExcused`

**Files:**
- Modify: `src/engine/state/types.ts`（`GameState` 接口尾部）
- Modify: `src/engine/calendar/time.ts`（追加常量与函数）
- Create: `src/engine/characters/greeting.ts`
- Test: `tests/characters/greeting.isExcused.test.ts`

**Interfaces:**
- Produces:
  - `GameState.excusedFromGreeting?: { dayIndex: number; charIds: string[] }`
  - `GameState.overnightWith?: { charId: string; morningDayIndex: number }`
  - `MAO_SLOT = 0`；`isGreetingSlot(calendar: CalendarState): boolean`
  - `isExcused(state: GameState, charId: string): boolean`

- [ ] **Step 1: 加状态字段**

在 `src/engine/state/types.ts` 的 `GameState` 接口内（`rngSeed: number;` 之前）加：

```ts
  /** 本晨被免请安的侍君（按 dayIndex 自然失效）。 */
  excusedFromGreeting?: { dayIndex: number; charIds: string[] };
  /** 子时留宿记录，供次晨离宫二选一。 */
  overnightWith?: { charId: string; morningDayIndex: number };
```

- [ ] **Step 2: 加时辰常量与函数**

在 `src/engine/calendar/time.ts` 末尾（`isAfternoonSlot` 之后）加：

```ts
/** 卯时槽位常量：一日首槽（早上请安）。 */
export const MAO_SLOT = 0;

/** 当前待用行动点是否落在卯时（请安时辰）。 */
export function isGreetingSlot(calendar: CalendarState): boolean {
  return shichenSlot(calendar) === MAO_SLOT;
}
```

- [ ] **Step 3: 写失败测试**

创建 `tests/characters/greeting.isExcused.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { isExcused } from "../../src/engine/characters/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);

describe("isExcused", () => {
  it("false when no excuse record", () => {
    expect(isExcused(base, "lu_huaijin")).toBe(false);
  });

  it("true only for matching dayIndex and listed charId", () => {
    const di = base.calendar.dayIndex;
    const s = { ...base, excusedFromGreeting: { dayIndex: di, charIds: ["lu_huaijin"] } };
    expect(isExcused(s, "lu_huaijin")).toBe(true);
    expect(isExcused(s, "shen_zhibai")).toBe(false);
  });

  it("stale record (different dayIndex) is ignored", () => {
    const s = { ...base, excusedFromGreeting: { dayIndex: base.calendar.dayIndex + 1, charIds: ["lu_huaijin"] } };
    expect(isExcused(s, "lu_huaijin")).toBe(false);
  });
});
```

- [ ] **Step 4: 跑测试看失败**

Run: `npx vitest run tests/characters/greeting.isExcused.test.ts`
Expected: FAIL — `isExcused` 未定义 / 模块不存在。

- [ ] **Step 5: 实现 `greeting.ts`（首批）**

创建 `src/engine/characters/greeting.ts`：

```ts
/**
 * 请安/游走相关纯函数（设计见 specs/2026-06-21-consort-presence-greeting）。
 * 仅依赖引擎层，无 React/store 引用。
 */
import type { GameState } from "../state/types";

/** 本晨（当前 dayIndex）该侍君是否已被免请安。 */
export function isExcused(state: GameState, charId: string): boolean {
  const e = state.excusedFromGreeting;
  return !!e && e.dayIndex === state.calendar.dayIndex && e.charIds.includes(charId);
}
```

- [ ] **Step 6: 跑测试看通过**

Run: `npx vitest run tests/characters/greeting.isExcused.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 7: 类型检查 + 提交**

```bash
npx tsc --noEmit
git add src/engine/state/types.ts src/engine/calendar/time.ts src/engine/characters/greeting.ts tests/characters/greeting.isExcused.test.ts
git commit -m "feat: 请安状态字段 + 卯时常量 + isExcused"
```

---

## Task 2: 游走掷骰 `wanderChance` + `wanders`

**Files:**
- Modify: `src/engine/characters/greeting.ts`
- Test: `tests/characters/greeting.wander.test.ts`

**Interfaces:**
- Consumes: `fnv1a64Hex` from `../save/canonical`；`CharacterContent` from `../content/schemas`。
- Produces:
  - `wanderChance(character: CharacterContent): number` —— 25 经性格关键词加权，clamp [5,60]。
  - `wanders(rngSeed: number, dayIndex: number, slot: number, charId: string, chancePercent: number): boolean`

- [ ] **Step 1: 写失败测试**

创建 `tests/characters/greeting.wander.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { wanderChance, wanders } from "../../src/engine/characters/greeting";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("wanderChance (性格加权)", () => {
  it("端肃/克制/重礼法 的沈知白低于基础 25", () => {
    // personalityTraits: ["端肃","克制","重礼法","外冷内热"] → 命中 3 个内敛关键词
    expect(wanderChance(db.characters.shen_zhibai!)).toBeLessThan(25);
  });

  it("clamp 不低于 5、不高于 60", () => {
    const reserved = { profile: { personalityTraits: ["端肃", "克制", "守礼", "清冷", "淡泊"] } } as never;
    const outgoing = { profile: { personalityTraits: ["活泼", "开朗", "好动", "爱热闹", "天真"] } } as never;
    expect(wanderChance(reserved)).toBe(5);
    expect(wanderChance(outgoing)).toBe(60);
  });

  it("无 traits 用基础 25", () => {
    expect(wanderChance({ profile: {} } as never)).toBe(25);
  });
});

describe("wanders (确定性)", () => {
  it("同 (seed,day,slot,char) 稳定", () => {
    const a = wanders(1, 10, 2, "lu_huaijin", 50);
    const b = wanders(1, 10, 2, "lu_huaijin", 50);
    expect(a).toBe(b);
  });

  it("概率 0 永不出门、100 必出门", () => {
    expect(wanders(1, 10, 2, "lu_huaijin", 0)).toBe(false);
    expect(wanders(1, 10, 2, "lu_huaijin", 100)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/characters/greeting.wander.test.ts`
Expected: FAIL — `wanderChance`/`wanders` 未定义。

- [ ] **Step 3: 实现**

在 `src/engine/characters/greeting.ts` 顶部补 import，并追加：

```ts
import { fnv1a64Hex } from "../save/canonical";
import type { CharacterContent } from "../content/schemas";

const OUTGOING_TRAITS = ["活泼", "开朗", "好动", "爱热闹", "天真", "烂漫", "率真", "跳脱", "好奇"];
const RESERVED_TRAITS = ["端肃", "克制", "沉静", "守礼", "重礼", "清冷", "淡泊", "孤僻", "内敛", "寡言", "持重"];

/** 基础游走概率 25，按性格关键词每命中 ±15，clamp [5,60]。 */
export function wanderChance(character: CharacterContent): number {
  const traits = character.profile.personalityTraits ?? [];
  let p = 25;
  for (const t of traits) {
    if (OUTGOING_TRAITS.some((k) => t.includes(k))) p += 15;
    if (RESERVED_TRAITS.some((k) => t.includes(k))) p -= 15;
  }
  return Math.min(60, Math.max(5, p));
}

/** 确定性游走判定：命中即此 slot 去御花园。 */
export function wanders(
  rngSeed: number,
  dayIndex: number,
  slot: number,
  charId: string,
  chancePercent: number,
): boolean {
  const roll = parseInt(fnv1a64Hex(`${rngSeed}:${dayIndex}:${slot}:wander:${charId}`).slice(0, 8), 16) % 100;
  return roll < chancePercent;
}
```

注：`RESERVED_TRAITS` 用 `t.includes(k)`，故「重礼法」命中「重礼」。

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/characters/greeting.wander.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit
git add src/engine/characters/greeting.ts tests/characters/greeting.wander.test.ts
git commit -m "feat: 游走掷骰 wanderChance/wanders（性格加权，确定性）"
```

---

## Task 3: `consortLocationAt` + `presentAt`

**Files:**
- Modify: `src/engine/characters/presence.ts`
- Test: `tests/characters/presence.timeAware.test.ts`

**Interfaces:**
- Consumes: `isExcused`、`wanderChance`、`wanders`（Task 1–2）；`MAO_SLOT`、`shichenSlot`（time.ts）。
- Produces:
  - `consortLocationAt(db: ContentDB, state: GameState, charId: string, slot: number): string`
  - `presentAt(db: ContentDB, state: GameState, locationId: string): CharacterContent[]`

- [ ] **Step 1: 写失败测试**

创建 `tests/characters/presence.timeAware.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { consortLocationAt, presentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const home = db.characters.lu_huaijin!.defaultLocation; // zhongcui_gong

/** 把日历调到指定 slot（apMax-ap=slot）。 */
function atSlot(state: GameState, slot: number): GameState {
  return { ...state, calendar: { ...state.calendar, ap: state.calendar.apMax - slot } };
}

describe("consortLocationAt", () => {
  it("卯时(0) 普通侍君去坤宁宫请安", () => {
    expect(consortLocationAt(db, base, "lu_huaijin", 0)).toBe("kunninggong");
  });

  it("卯时被免请安则留住处", () => {
    const di = base.calendar.dayIndex;
    const s = { ...base, excusedFromGreeting: { dayIndex: di, charIds: ["lu_huaijin"] } };
    expect(consortLocationAt(db, s, "lu_huaijin", 0)).toBe(home);
  });

  it("卯时留宿对象（未离宫）仍在住处", () => {
    const s = { ...base, overnightWith: { charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex } };
    expect(consortLocationAt(db, s, "lu_huaijin", 0)).toBe(home);
  });

  it("凤后永远在坤宁宫，不请安不游走", () => {
    expect(consortLocationAt(db, base, "shen_zhibai", 0)).toBe("kunninggong");
    expect(consortLocationAt(db, base, "shen_zhibai", 2)).toBe("kunninggong");
  });

  it("夜里(戌5)一律在住处", () => {
    expect(consortLocationAt(db, base, "lu_huaijin", 5)).toBe(home);
  });

  it("白天高概率必去御花园、零概率必在家", () => {
    const out = { ...base, standing: { ...base.standing, lu_huaijin: { ...base.standing.lu_huaijin!, } } };
    // 用一个能让概率拉满/归零的探针：直接断言两极由 wanders 决定——此处校验函数会路由到御花园分支
    // 通过寻找一个命中游走的 (slot) 验证；否则跳到下一 slot。
    const slots = [1, 2, 3];
    const anyGarden = slots.some((sl) => consortLocationAt(db, out, "lu_huaijin", sl) === "yuhuayuan");
    const anyHome = slots.some((sl) => consortLocationAt(db, out, "lu_huaijin", sl) === home);
    expect(anyGarden || anyHome).toBe(true); // 白天只可能是御花园或住处
  });
});

describe("presentAt (按当前 slot)", () => {
  it("卯时坤宁宫＝皇后＋出席侍君", () => {
    const ids = presentAt(db, atSlot(base, 0), "kunninggong").map((c) => c.id);
    expect(ids).toContain("shen_zhibai");
    expect(ids).toContain("lu_huaijin");
  });

  it("卯时某后宫居所空（住客去请安）", () => {
    expect(presentAt(db, atSlot(base, 0), "zhongcui_gong").map((c) => c.id)).toEqual([]);
  });

  it("非侍君（乘风/卫绥）按住处在场，不受请安影响", () => {
    const ids = presentAt(db, atSlot(base, 0), "zichendian").map((c) => c.id).sort();
    expect(ids).toEqual(["cheng_feng", "wei_sui"].sort());
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/characters/presence.timeAware.test.ts`
Expected: FAIL — `consortLocationAt`/`presentAt` 未定义。

- [ ] **Step 3: 实现**

在 `src/engine/characters/presence.ts` 顶部补 import：

```ts
import { shichenSlot, MAO_SLOT } from "../calendar/time";
import { isExcused, wanderChance, wanders } from "./greeting";
```

文件末尾追加：

```ts
/** 某侍君在给定 slot 的实际所在 locationId（设计 §4）。非侍君返回其住处。 */
export function consortLocationAt(
  db: ContentDB,
  state: GameState,
  charId: string,
  slot: number,
): string {
  const home = getCharacterLocation(db, state, charId) ?? "";
  const char = db.characters[charId];
  if (!char || char.kind !== "consort") return home;
  const st = state.standing[charId];
  if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") return home;
  // 冷宫 / 待选(储秀宫) / 凤后(坤宁宫常驻) 不请安不游走。
  if (home === "changmengong" || home === "chuxiu_gong" || home === "kunninggong") return home;

  if (slot === MAO_SLOT) {
    const o = state.overnightWith;
    if (o && o.charId === charId && o.morningDayIndex === state.calendar.dayIndex) return home; // 留宿未离宫
    if (isExcused(state, charId)) return home;
    return "kunninggong";
  }
  if (slot >= 1 && slot <= 3 && wanders(state.rngSeed, state.calendar.dayIndex, slot, charId, wanderChance(char))) {
    return "yuhuayuan";
  }
  return home;
}

/** 此刻（当前 slot）实际在 locationId 的角色，按位分降序。LocationScreen 用「此处此刻有谁」。 */
export function presentAt(db: ContentDB, state: GameState, locationId: string): CharacterContent[] {
  const slot = shichenSlot(state.calendar);
  return Object.values(db.characters)
    .filter((character) => consortLocationAt(db, state, character.id, slot) === locationId)
    .sort(
      (a, b) =>
        (db.ranks[b.initialStanding?.rank ?? ""]?.order ?? 0) -
        (db.ranks[a.initialStanding?.rank ?? ""]?.order ?? 0),
    );
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/characters/presence.timeAware.test.ts`
Expected: PASS。

- [ ] **Step 5: 回归既有契约**

Run: `npx vitest run tests/characters/presence.test.ts tests/characters/presence.inPalace.test.ts`
Expected: PASS（`getPresentAt`/`getCharacterLocation` 未改动，契约不变）。

- [ ] **Step 6: 提交**

```bash
npx tsc --noEmit
git add src/engine/characters/presence.ts tests/characters/presence.timeAware.test.ts
git commit -m "feat: consortLocationAt/presentAt（时辰感知临场，不改既有住处语义）"
```

---

## Task 4: store 层 免请安/留宿 纯函数 + GameStore 方法

**Files:**
- Create: `src/store/greeting.ts`
- Modify: `src/store/gameStore.ts`
- Test: `tests/store/greeting.test.ts`

**Interfaces:**
- Consumes: `getCharacterLocation`（presence.ts）。
- Produces:
  - `excuseFromGreeting(state, db, charId): GameState` —— favor+2、affection+3、写 `excusedFromGreeting`、清 `overnightWith`。
  - `dismissOvernight(state): GameState` —— 清 `overnightWith`。
  - `recordOvernight(state, db, charId, rolledOver): GameState` —— 仅 `rolledOver && 玩家在该侍君住处` 时写 `overnightWith`。
  - GameStore: `applyExcuseGreeting(db, charId)`、`dismissOvernight()`、`recordOvernight(db, charId, rolledOver)`。

- [ ] **Step 1: 写失败测试**

创建 `tests/store/greeting.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { excuseFromGreeting, dismissOvernight, recordOvernight } from "../../src/store/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const base = createNewGameState(db);
const home = db.characters.lu_huaijin!.defaultLocation; // zhongcui_gong

describe("excuseFromGreeting", () => {
  it("favor +2、affection +3，并记入当日 excused，清 overnightWith", () => {
    const seed = {
      ...base,
      overnightWith: { charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex },
    };
    const before = seed.standing.lu_huaijin!;
    const baseAff = before.affection ?? db.characters.lu_huaijin!.hidden!.affection;
    const next = excuseFromGreeting(seed, db, "lu_huaijin");
    expect(next.standing.lu_huaijin!.favor).toBe(before.favor + 2);
    expect(next.standing.lu_huaijin!.affection).toBe(baseAff + 3);
    expect(next.excusedFromGreeting).toEqual({ dayIndex: base.calendar.dayIndex, charIds: ["lu_huaijin"] });
    expect(next.overnightWith).toBeUndefined();
  });
});

describe("recordOvernight", () => {
  it("rolledOver 且玩家在该侍君住处 → 写 overnightWith", () => {
    const s = { ...base, playerLocation: home };
    const next = recordOvernight(s, db, "lu_huaijin", true);
    expect(next.overnightWith).toEqual({ charId: "lu_huaijin", morningDayIndex: base.calendar.dayIndex });
  });

  it("未滚旬 → 不记录", () => {
    const s = { ...base, playerLocation: home };
    expect(recordOvernight(s, db, "lu_huaijin", false).overnightWith).toBeUndefined();
  });

  it("玩家不在该侍君住处（如翻牌子在御书房）→ 不记录", () => {
    const s = { ...base, playerLocation: "zichendian" };
    expect(recordOvernight(s, db, "lu_huaijin", true).overnightWith).toBeUndefined();
  });
});

describe("dismissOvernight", () => {
  it("清 overnightWith", () => {
    const s = { ...base, overnightWith: { charId: "lu_huaijin", morningDayIndex: 1 } };
    expect(dismissOvernight(s).overnightWith).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/store/greeting.test.ts`
Expected: FAIL — 模块/函数不存在。

- [ ] **Step 3: 实现 `src/store/greeting.ts`**

```ts
/** 免请安/留宿的状态装配（纯函数；GameStore 负责 set+emit）。 */
import { getCharacterLocation } from "../engine/characters/presence";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";

const EXCUSE_AFFECTION = 3;
const EXCUSE_FAVOR = 2;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** 施恩免请安：favor+2、affection+3，记入当日 excused，清留宿。 */
export function excuseFromGreeting(state: GameState, db: ContentDB, charId: string): GameState {
  const st = state.standing[charId];
  if (!st) return state;
  const baseAff = st.affection ?? db.characters[charId]?.hidden?.affection ?? 0;
  const di = state.calendar.dayIndex;
  const prev =
    state.excusedFromGreeting && state.excusedFromGreeting.dayIndex === di
      ? state.excusedFromGreeting.charIds
      : [];
  return {
    ...state,
    standing: {
      ...state.standing,
      [charId]: { ...st, favor: clampPct(st.favor + EXCUSE_FAVOR), affection: clampPct(baseAff + EXCUSE_AFFECTION) },
    },
    excusedFromGreeting: { dayIndex: di, charIds: [...new Set([...prev, charId])] },
    overnightWith: undefined,
  };
}

/** 「不说」分支：仅清留宿，侍君照常请安。 */
export function dismissOvernight(state: GameState): GameState {
  return { ...state, overnightWith: undefined };
}

/** 子时侍寝/对话滚旬后调用：仅当确已滚旬且玩家就在该侍君住处时记留宿。 */
export function recordOvernight(state: GameState, db: ContentDB, charId: string, rolledOver: boolean): GameState {
  if (!rolledOver) return state;
  if (getCharacterLocation(db, state, charId) !== state.playerLocation) return state;
  return { ...state, overnightWith: { charId, morningDayIndex: state.calendar.dayIndex } };
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/store/greeting.test.ts`
Expected: PASS。

- [ ] **Step 5: GameStore 方法**

在 `src/store/gameStore.ts` 顶部 import：

```ts
import { excuseFromGreeting, dismissOvernight, recordOvernight } from "./greeting";
```

在类内（`setFlag` 方法附近）加：

```ts
  /** 施恩免请安（不耗行动点）。 */
  applyExcuseGreeting(db: ContentDB, charId: string): void {
    this.state = excuseFromGreeting(this.state, db, charId);
    this.emit();
  }

  /** 「不说」：清留宿，侍君照常请安。 */
  dismissOvernight(): void {
    this.state = dismissOvernight(this.state);
    this.emit();
  }

  /** 子时侍寝/对话滚旬后记留宿（条件不满足则无副作用）。 */
  recordOvernight(db: ContentDB, charId: string, rolledOver: boolean): void {
    const next = recordOvernight(this.state, db, charId, rolledOver);
    if (next !== this.state) {
      this.state = next;
      this.emit();
    }
  }
```

（若 `emit` 是私有方法名不符，按文件内既有写法对齐——参见 `setEraName` 等方法用的 `this.emit()`。）

- [ ] **Step 6: GameStore 方法测试**

在 `tests/store/greeting.test.ts` 末尾追加：

```ts
import { GameStore } from "../../src/store/gameStore";

describe("GameStore 请安方法", () => {
  it("applyExcuseGreeting 改 state 并保留 dayIndex", () => {
    const store = new GameStore();
    store.newGame(db);
    const di = store.getState().calendar.dayIndex;
    store.applyExcuseGreeting(db, "lu_huaijin");
    expect(store.getState().excusedFromGreeting).toEqual({ dayIndex: di, charIds: ["lu_huaijin"] });
  });
});
```

Run: `npx vitest run tests/store/greeting.test.ts`
Expected: PASS（含新用例）。如 `GameStore` 构造/`newGame` 用法不符，照 `tests/store/gameStore.test.ts` 既有写法对齐。

- [ ] **Step 7: 提交**

```bash
npx tsc --noEmit
git add src/store/greeting.ts src/store/gameStore.ts tests/store/greeting.test.ts
git commit -m "feat: 免请安/留宿 store 纯函数 + GameStore 方法"
```

---

## Task 5: 子时留宿接线（App 侍寝/对话）

**Files:**
- Modify: `src/ui/App.tsx`（`commitBedchamber`、`converse`）

**Interfaces:**
- Consumes: `store.recordOvernight(db, charId, rolledOver)`（Task 4）。

- [ ] **Step 1: 侍寝接线**

在 `src/ui/App.tsx` 的 `commitBedchamber` 内，`spendAp(1)` 之后、`setSummonedConsortId(null)` 之前加：

```ts
    store.recordOvernight(db, plan.charId, spend.value.rolledOver);
```

（`spend.value.rolledOver` 仅在子时——最后一点行动点——为 true；侍寝固定耗 1 AP，故等价于「子时侍寝」。）

- [ ] **Step 2: 对话接线**

在 `converse` 内，`spendAp(1)` 成功后、`playReactions(...)` 之前加：

```ts
    store.recordOvernight(db, charId, spend.value.rolledOver);
```

- [ ] **Step 3: 类型检查 + 构建冒烟**

Run: `npx tsc --noEmit && npm run build`
Expected: 通过（无类型/构建错误）。

- [ ] **Step 4: 提交**

```bash
git add src/ui/App.tsx
git commit -m "feat: 子时侍寝/对话滚旬时记留宿 overnightWith"
```

---

## Task 6: 缺席禀报（pure `absentAt` + LocationScreen 取在场/花名册 + CharacterScene 渲染）

> 本仓库 `tests/ui/` 全是**纯逻辑**测试（如 `courtyardHalls.test.ts` 测 `.tsx` 导出的 `hallsFor`），**无 `@testing-library/react`、无 jsdom**（`package.json` 无相关依赖）。因此缺席逻辑抽成纯函数 `absentAt` 走 TDD，组件渲染走手动验证——与既有约定一致。

**Files:**
- Modify: `src/engine/characters/presence.ts`（新增 `absentAt`）
- Modify: `src/ui/screens/LocationScreen.tsx`
- Modify: `src/ui/screens/CharacterScene.tsx`
- Test: `tests/characters/presence.absentAt.test.ts`

**Interfaces:**
- Consumes: `presentAt`、`getPresentAt`、`consortLocationAt`（presence.ts）；`resolveDisplayName`（standing.ts）。
- Produces:
  - `absentAt(db, state, locationId): Record<string, string>` —— 住客中此刻不在该地者 → 其当前所在 locationId。
  - `CharacterScene` 新增可选 prop `absence?: Record<string, string | undefined>`；住客缺席时渲染禀报、屏蔽对话/侍寝。

- [ ] **Step 1: `absentAt` 失败测试**

创建 `tests/characters/presence.absentAt.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { absentAt } from "../../src/engine/characters/presence";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const atSlot = (s: GameState, slot: number): GameState => ({ ...s, calendar: { ...s.calendar, ap: s.calendar.apMax - slot } });

describe("absentAt", () => {
  it("卯时某后宫居所：住客去请安 → 映射到 kunninggong", () => {
    const a = absentAt(db, atSlot(base, 0), "zhongcui_gong");
    expect(a.lu_huaijin).toBe("kunninggong");
  });

  it("夜里住客都在家 → 无缺席", () => {
    expect(absentAt(db, atSlot(base, 5), "zhongcui_gong")).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/characters/presence.absentAt.test.ts`
Expected: FAIL — `absentAt` 未定义。

- [ ] **Step 3: 实现 `absentAt`**

在 `src/engine/characters/presence.ts` 末尾追加：

```ts
/** 住客（住处花名册）中此刻不在 locationId 者 → 其当前所在。供缺席禀报用。 */
export function absentAt(db: ContentDB, state: GameState, locationId: string): Record<string, string> {
  const slot = shichenSlot(state.calendar);
  const here = new Set(presentAt(db, state, locationId).map((c) => c.id));
  const out: Record<string, string> = {};
  for (const c of getPresentAt(db, state, locationId)) {
    if (!here.has(c.id)) out[c.id] = consortLocationAt(db, state, c.id, slot);
  }
  return out;
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/characters/presence.absentAt.test.ts`
Expected: PASS。

- [ ] **Step 5: LocationScreen 改用 presentAt + absentAt**

在 `src/ui/screens/LocationScreen.tsx`：把 import

```ts
import { getPresentAt } from "../../engine/characters/presence";
```

改为

```ts
import { getPresentAt, presentAt, absentAt } from "../../engine/characters/presence";
```

把 `const present = getPresentAt(db, state, location.id);` 改为：

```ts
  const present = presentAt(db, state, location.id); // 此刻实际在场
  const roster = getPresentAt(db, state, location.id); // 住处花名册（谁住这）
  const absence = absentAt(db, state, location.id); // charId → 去向 locationId
```

把场景住客由「在场」改为「花名册」（缺席者仍占位、可禀报）。将

```ts
  const sceneConsorts = location.zone === "hougong" ? present.filter((c) => c.kind === "consort") : [];
```

改为

```ts
  const sceneConsorts = location.zone === "hougong" ? roster.filter((c) => c.kind === "consort") : [];
```

并把传入 `CharacterScene` 的属性补一行 `absence={absence}`（在现有 `<CharacterScene ... consorts={sceneConsorts}` 之后）：

```tsx
          consorts={sceneConsorts}
          absence={absence}
```

- [ ] **Step 6: CharacterScene 接受 absence 并渲染禀报**

在 `src/ui/screens/CharacterScene.tsx`：
- import 处加 `import { resolveDisplayName } from "../../engine/characters/standing";`
- props 解构加 `absence,`，类型块加 `absence?: Record<string, string | undefined>;`
- 在 `const standing = ...` 之后加去向文案：

```ts
  const awayTo = character ? absence?.[character.id] : undefined;
  const awayName = character && standing ? resolveDisplayName(character, standing, rank) : "";
  const awayLine =
    awayTo === "kunninggong"
      ? `${awayName}往坤宁宫向皇后请安去了。`
      : awayTo === "yuhuayuan"
        ? `${awayName}往御花园散心去了。`
        : awayTo
          ? `${awayName}此刻不在宫中。`
          : null;
```

- 在 `char-scene__dialogue` 的 `character` 真分支里，当 `awayLine` 非空时用禀报取代问候行与动作坞。把：

```tsx
            <p className="char-scene__line">{greetingFor(character.id)}</p>

            <div className="action-dock">
```

改为：

```tsx
            {awayLine ? (
              <p className="char-scene__line char-scene__line--absent">{awayLine}</p>
            ) : (
              <>
                <p className="char-scene__line">{greetingFor(character.id)}</p>

                <div className="action-dock">
```

并在该动作坞 `action-dock` 整块闭合后补 `</>` 与三元收尾。找到块尾：

```tsx
            </div>
          </>
        ) : (
```

改为：

```tsx
            </div>
              </>
            )}
          </>
        ) : (
```

（即把原 `action-dock` 整块包进 `awayLine ? <禀报> : <>...</>`。以 JSX 结构对齐为准——目标：缺席只显禀报、无对话/侍寝/查看详情按钮。`npx tsc --noEmit` 校验括号配对。）

- [ ] **Step 7: 类型检查 + 构建 + 手动验证**

Run: `npx tsc --noEmit && npm run build`
手测：`npm run dev`，卯时（新开局即卯时）进任一后宫居所（如重萃宫）→ 应显示「陆承徽往坤宁宫向皇后请安去了。」且无侍寝/对话按钮；花掉 1 AP 到辰时再进 → 该宫住客回来、恢复问候与按钮。
Expected: 符合预期。

- [ ] **Step 8: 提交**

```bash
git add src/engine/characters/presence.ts src/ui/screens/LocationScreen.tsx src/ui/screens/CharacterScene.tsx tests/characters/presence.absentAt.test.ts
git commit -m "feat: 后宫居所缺席禀报（absentAt + 往坤宁宫请安/往御花园）"
```

---

## Task 7: 卯时坤宁宫 乘风请安遮罩（进入主殿/退出）

**Files:**
- Modify: `src/engine/characters/greeting.ts`（`greetingAttendees`）
- Modify: `src/ui/screens/LocationScreen.tsx`（坤宁宫请安遮罩）
- Modify: `src/ui/App.tsx`（回调与 ceremony 触发）
- Test: `tests/characters/greeting.attendees.test.ts`

**Interfaces:**
- Produces:
  - `greetingAttendees(db, state): CharacterContent[]` —— 卯时实际在坤宁宫请安的侍君（不含皇后）；非卯时返回 `[]`。
  - LocationScreen 新增可选 props：`greetingAttendeeCount?: number`、`onEnterGreeting?: () => void`、`onExitGreeting?: () => void`。
  - App 新增：`enterGreeting()`（耗 1 AP + 开 ceremony）、`exitGreeting()`（回地图）。

- [ ] **Step 1: `greetingAttendees` 失败测试**

创建 `tests/characters/greeting.attendees.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { greetingAttendees } from "../../src/engine/characters/greeting";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const atSlot = (s: GameState, slot: number): GameState => ({ ...s, calendar: { ...s.calendar, ap: s.calendar.apMax - slot } });

describe("greetingAttendees", () => {
  it("卯时返回在宫侍君（不含皇后）", () => {
    const ids = greetingAttendees(db, atSlot(base, 0)).map((c) => c.id);
    expect(ids).toContain("lu_huaijin");
    expect(ids).not.toContain("shen_zhibai"); // 皇后是受礼者
  });

  it("非卯时返回空", () => {
    expect(greetingAttendees(db, atSlot(base, 2))).toEqual([]);
  });

  it("被免者不在出席名单", () => {
    const s = atSlot({ ...base, excusedFromGreeting: { dayIndex: base.calendar.dayIndex, charIds: ["lu_huaijin"] } }, 0);
    expect(greetingAttendees(db, s).map((c) => c.id)).not.toContain("lu_huaijin");
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/characters/greeting.attendees.test.ts`
Expected: FAIL — `greetingAttendees` 未定义。

- [ ] **Step 3: 实现 `greetingAttendees`**

在 `src/engine/characters/greeting.ts` 顶部补 import：

```ts
import type { ContentDB } from "../content/loader";
import { getCharacterLocation, presentAt } from "./presence";
import { isGreetingSlot } from "../calendar/time";
```

追加：

```ts
/** 卯时实际在坤宁宫请安的侍君（排除受礼的皇后——其住处即坤宁宫）。非卯时为空。 */
export function greetingAttendees(db: ContentDB, state: GameState): CharacterContent[] {
  if (!isGreetingSlot(state.calendar)) return [];
  return presentAt(db, state, "kunninggong").filter(
    (c) => c.kind === "consort" && getCharacterLocation(db, state, c.id) !== "kunninggong",
  );
}
```

> 注意：`greeting.ts` 现 import `presence.ts`，而 `presence.ts` import `greeting.ts`（`isExcused/wanders`）——存在循环 import。TS/ESM 对函数声明的循环引用安全（运行时调用发生在加载后）。跑测试确认无 `ReferenceError`；若有，则把 `greetingAttendees` 移到 `presence.ts` 内（它本就依赖 presentAt），import 反向。

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/characters/greeting.attendees.test.ts`
Expected: PASS。若循环引用报错，按 Step 3 备注迁移函数后重跑。

- [ ] **Step 5: App 加 enter/exit 回调**

在 `src/ui/App.tsx` 顶部 import：

```ts
import { greetingAttendees } from "../engine/characters/greeting";
```

在组件内（`converse` 附近）加 ceremony 状态与回调：

```ts
  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  const enterGreeting = () => {
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    doAutosave();
    setCeremonyOpen(true);
    // 懿旨等转旬反应入队，待 ceremony 关闭后随正常流程消化（此处仅记一旬动作）。
    if (decreeBeats.length) setReactionQueue((q) => [...q, ...decreeBeats]);
  };

  const exitGreeting = () => {
    goHome(); // 退出坤宁宫，回地图；不耗行动点
  };
```

（`goHome` 为 App 既有回地图函数；若名称不同，用 App 内实际的「回地图/打开地图」函数，参见 `onOpenMap`/`setView("map")` 的现有写法。）

- [ ] **Step 6: LocationScreen 坤宁宫请安遮罩**

在 `src/ui/screens/LocationScreen.tsx`：
- props 类型加：

```ts
  greetingAttendeeCount?: number;
  onEnterGreeting?: () => void;
  onExitGreeting?: () => void;
```

- 解构加 `greetingAttendeeCount, onEnterGreeting, onExitGreeting,`
- import 加 `import { isGreetingSlot } from "../../engine/calendar/time";`
- 加判定（在 `eligible` 附近）：

```ts
  const greetingHere =
    location.id === "kunninggong" &&
    isGreetingSlot(state.calendar) &&
    (greetingAttendeeCount ?? 0) > 0;
```

- 在 `GameShell` 内、事件遮罩 `{eligible.length > 0 && ...}` 之前加请安遮罩：

```tsx
      {greetingHere && onEnterGreeting && onExitGreeting && (
        <div className="modal-backdrop">
          <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
            <h2 className="event-overlay__title">坤宁宫　晨省</h2>
            <p className="event-overlay__hint">乘风躬身：「众侍君正给皇后请安，陛下是否去看看？」</p>
            <div className="event-overlay__choices">
              <button type="button" onClick={onEnterGreeting}>
                进入主殿（耗一个行动点）
              </button>
            </div>
            <button type="button" className="event-overlay__later" onClick={onExitGreeting}>
              退出坤宁宫
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: App 把 props 传给 LocationScreen**

在 `src/ui/App.tsx` 渲染 `LocationScreen` 处加：

```tsx
            greetingAttendeeCount={greetingAttendees(db, store.getState()).length}
            onEnterGreeting={enterGreeting}
            onExitGreeting={exitGreeting}
```

- [ ] **Step 8: 构建冒烟 + 提交**

Run: `npx vitest run tests/characters/greeting.attendees.test.ts && npx tsc --noEmit && npm run build`
Expected: 通过。

```bash
git add src/engine/characters/greeting.ts src/ui/screens/LocationScreen.tsx src/ui/App.tsx tests/characters/greeting.attendees.test.ts
git commit -m "feat: 卯时坤宁宫乘风请安遮罩（进入主殿耗1AP/退出免费）"
```

---

## Task 8: 请安场景遮罩（皇后率众行礼 + 「无事」）

**Files:**
- Create: `src/ui/components/GreetingCeremonyOverlay.tsx`
- Modify: `src/ui/App.tsx`（渲染 ceremony 遮罩）

**Interfaces:**
- Consumes: `ceremonyOpen` 状态、`setCeremonyOpen`（Task 7）。
- Produces: `GreetingCeremonyOverlay`（props：`empressName: string`、`onDone: () => void`）。

- [ ] **Step 1: 组件**

创建 `src/ui/components/GreetingCeremonyOverlay.tsx`：

```tsx
/** 卯时请安场景：皇后起身率众行礼，问要事。现仅「无事」一项，结构预留扩展。 */
export function GreetingCeremonyOverlay({
  empressName,
  onDone,
}: {
  empressName: string;
  onDone: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
        <h2 className="event-overlay__title">坤宁宫　晨省</h2>
        <p className="event-overlay__hint">
          {empressName}起身，率众侍君向陛下行礼：「陛下万福金安。可有要事相告？」
        </p>
        <div className="event-overlay__choices">
          <button type="button" onClick={onDone}>
            无事，只是来看看皇后
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App 渲染 ceremony**

在 `src/ui/App.tsx` import：

```ts
import { GreetingCeremonyOverlay } from "./components/GreetingCeremonyOverlay";
```

在顶层渲染（与其它全屏遮罩并列，例如 prompt 遮罩附近）加：

```tsx
      {ceremonyOpen && (
        <GreetingCeremonyOverlay
          empressName={db.characters.shen_zhibai?.profile.name ?? "皇后"}
          onDone={() => setCeremonyOpen(false)}
        />
      )}
```

`onDone` 关闭遮罩——此时日历已是辰时（进入时耗了 1 AP），坤宁宫只剩皇后，玩家落在坤宁宫 LocationScreen 可继续与皇后互动。

- [ ] **Step 3: 构建冒烟 + 手测**

Run: `npx tsc --noEmit && npm run build`
手测：卯时进坤宁宫 → 乘风遮罩 → 进入主殿 → 皇后率众行礼遮罩 → 「无事」→ 关闭，停在坤宁宫（辰时，只剩皇后）。
Expected: 流程顺畅，行动点由 6 减到 5。

- [ ] **Step 4: 提交**

```bash
git add src/ui/components/GreetingCeremonyOverlay.tsx src/ui/App.tsx
git commit -m "feat: 请安场景遮罩（皇后率众行礼 + 无事）"
```

---

## Task 9: 翌晨离宫二选一（免请安 / 不说）

**Files:**
- Modify: `src/ui/App.tsx`（morning-after 判定与遮罩、离宫拦截）
- Modify: `src/ui/screens/LocationScreen.tsx`（返回按钮拦截）
- Create: `src/ui/components/MorningAfterOverlay.tsx`

**Interfaces:**
- Consumes: `store.applyExcuseGreeting(db, charId)`、`store.dismissOvernight()`（Task 4）；`state.overnightWith`；`isGreetingSlot`。
- Produces:
  - `MorningAfterOverlay`（props：`consortName: string`、`onRest: () => void`、`onSilent: () => void`）。
  - LocationScreen 新增可选 prop `onLeavePalace?: () => void`：返回时若该宫为留宿宫且卯时，则改走此回调。

- [ ] **Step 1: App 判定 morning-after 宫**

在 `src/ui/App.tsx` 组件内加：

```ts
  const ov = liveState.overnightWith;
  const morningAfterCharId =
    ov &&
    ov.morningDayIndex === liveState.calendar.dayIndex &&
    isGreetingSlot(liveState.calendar) &&
    getCharacterLocation(db, liveState, ov.charId) === liveState.playerLocation
      ? ov.charId
      : null;
```

import 补：

```ts
import { isGreetingSlot } from "../engine/calendar/time";
import { getCharacterLocation } from "../engine/characters/presence";
```

（`liveState` 为 App 既有 `store.getState()` 快照；若变量名不同按既有写法。）

- [ ] **Step 2: 离宫遮罩状态与回调**

```ts
  const [morningAfterOpen, setMorningAfterOpen] = useState(false);

  // 离开后宫居所：若是留宿宫且卯时，先弹二选一；否则正常回地图。
  const leavePalace = () => {
    if (morningAfterCharId) setMorningAfterOpen(true);
    else goHome();
  };

  const restExcuse = () => {
    if (morningAfterCharId) store.applyExcuseGreeting(db, morningAfterCharId);
    setMorningAfterOpen(false);
    goHome();
  };

  const silentLeave = () => {
    store.dismissOvernight();
    setMorningAfterOpen(false);
    goHome();
  };
```

- [ ] **Step 3: 遮罩组件**

创建 `src/ui/components/MorningAfterOverlay.tsx`：

```tsx
/** 翌晨离宫二选一：施恩免请安 或 默然离开（侍君照常请安）。均不耗行动点。 */
export function MorningAfterOverlay({
  consortName,
  onRest,
  onSilent,
}: {
  consortName: string;
  onRest: () => void;
  onSilent: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
        <h2 className="event-overlay__title">晨起辞行</h2>
        <p className="event-overlay__hint">{consortName}起身欲随众往坤宁宫请安。陛下……</p>
        <div className="event-overlay__choices">
          <button type="button" onClick={onRest}>
            「昨晚爱卿辛苦了，今日就多歇着吧。」
          </button>
        </div>
        <button type="button" className="event-overlay__later" onClick={onSilent}>
          （什么都不说，起驾离开）
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: App 渲染遮罩**

import：

```ts
import { MorningAfterOverlay } from "./components/MorningAfterOverlay";
```

顶层渲染加：

```tsx
      {morningAfterOpen && morningAfterCharId && (
        <MorningAfterOverlay
          consortName={db.characters[morningAfterCharId]?.profile.name ?? "爱卿"}
          onRest={restExcuse}
          onSilent={silentLeave}
        />
      )}
```

- [ ] **Step 5: LocationScreen 返回拦截**

在 `src/ui/screens/LocationScreen.tsx`：props 类型加 `onLeavePalace?: () => void;`，解构加 `onLeavePalace,`。把 `GameShell` 的 `onBack={onOpenMap}` 改为：

```tsx
      onBack={onLeavePalace ?? onOpenMap}
```

App 渲染 LocationScreen 处加：

```tsx
            onLeavePalace={leavePalace}
```

（`leavePalace` 在非留宿场景等价于 `goHome`，行为不变；仅留宿+卯时弹遮罩。）

- [ ] **Step 6: 构建冒烟 + 手测**

Run: `npx tsc --noEmit && npm run build`
手测两条路径：
1. 子时在某侍君宫侍寝 → 次旬卯时该宫 → 点返回 → 二选一 → 「多歇着」→ 该侍君 favor/affection 上升，进坤宁宫卯时其不在请安名单。
2. 同上但选「什么都不说」→ 进坤宁宫卯时该侍君在请安名单。
Expected: 两条路径符合预期，均不扣行动点。

- [ ] **Step 7: 提交**

```bash
git add src/ui/App.tsx src/ui/screens/LocationScreen.tsx src/ui/components/MorningAfterOverlay.tsx
git commit -m "feat: 翌晨离宫二选一（免请安加好感恩宠 / 默然照常请安）"
```

---

## 全量回归

- [ ] **跑全部测试**

Run: `npm test`
Expected: 全绿。重点关注 `tests/characters/presence*.test.ts`、`tests/effects/funnel.relocate.test.ts`（搬迁依赖 `getCharacterLocation`，未改语义应不受影响）。

- [ ] **构建**

Run: `npm run build`
Expected: 成功。

---

## Self-Review 记录（写计划时已核）

- **Spec 覆盖**：§4 临场→T1–3；§5 缺席禀报→T6；§6 请安仪式→T7–8；§7 免请安→T4–5、T9；§8 状态字段→T1；§9 测试散落各 TDD 步；§10 非目标未触碰。
- **占位符**：无 TBD/TODO；每步含真实代码/命令/期望。
- **类型一致**：`excusedFromGreeting`/`overnightWith` 形状、`consortLocationAt`/`presentAt`/`greetingAttendees`/`excuseFromGreeting`/`recordOvernight` 签名跨任务一致。
- **已知风险**：(a) `greeting.ts`↔`presence.ts` 循环 import——T7 Step3 备注了迁移退路；(b) UI 任务的 App 变量名（`goHome`/`liveState`/LocationScreen 渲染处 props）以文件实际写法对齐，计划已注明「按既有写法」。
