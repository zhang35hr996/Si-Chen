# 朝局小改（国情面板 · 上朝限时 · 凤后下旨）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三项朝局小改——只读国情面板、上朝限首个行动点、凤后按恩宠概率自行升降「贵人及以下」侍君位分。

**Architecture:** 位分变更复用现有 `set_rank` 漏斗效果；凤后下旨为纯函数 + 种子化掷骰（每行动点 3%），经集中化 `spendAp` 包装触发，台词走泛化后的 `reactionQueue` 串播。国情面板只读 `state.resources`。

**Tech Stack:** TypeScript, React, Zod, Vitest。测试 `npx vitest run <file>`；类型 `npm run typecheck`；构建 `npm run build`。

参考 spec：`docs/superpowers/specs/2026-06-17-court-tweaks-design.md`

---

## File Structure
- Create `src/ui/components/ResourcePanel.tsx` — 只读国情面板（A）
- Modify `src/ui/App.tsx` — 面板状态/渲染（A）；spendAp/decree 接线（C）
- Modify `src/ui/screens/LocationScreen.tsx`、`src/ui/screens/MapScreen.tsx` — HUD「国情」按钮（A）
- Modify `src/engine/content/schemas.ts` — `actionFirstSlotOnly`（B）
- Modify `content/locations/chaotang.json` — 设标记（B）
- Modify `src/ui/screens/FreeViewScreen.tsx` — 上朝门控（B）
- Create `src/store/empressDecree.ts` — 凤后下旨纯逻辑（C）
- Tests: `tests/content/chaotang.test.ts`、`tests/store/empressDecree.test.ts`

---

# PART A — 国情面板

### Task A1: 只读国情面板 + HUD 入口

**Files:**
- Create: `src/ui/components/ResourcePanel.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/screens/LocationScreen.tsx`, `src/ui/screens/MapScreen.tsx`

UI 任务（无单测），以 `npm run typecheck` + `npm run build` 验证。

- [ ] **Step 1: 面板组件**

Create `src/ui/components/ResourcePanel.tsx`:
```tsx
/** 只读国情面板：展示朝局/后宫/血脉资源，纯展示无写入。 */
import type { GameState } from "../../engine/state/types";

export function ResourcePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const { court, harem, bloodline } = state.resources;
  const row = (label: string, value: number) => (
    <li className="resource-panel__row">
      <span>{label}</span>
      <span className="resource-panel__val">{value}</span>
    </li>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="resource-panel" onClick={(e) => e.stopPropagation()}>
        <h2>国情</h2>
        <section>
          <h3>朝局</h3>
          <ul>
            {row("圣威", court.authority)}
            {row("民心", court.publicSupport)}
            {row("派系压力", court.factionPressure)}
          </ul>
        </section>
        <section>
          <h3>后宫</h3>
          <ul>
            {row("和睦", harem.harmony)}
            {row("妒意", harem.jealousy)}
          </ul>
        </section>
        <section>
          <h3>血脉</h3>
          <ul>{row("宗嗣合法性", bloodline.legitimacy)}</ul>
        </section>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App 状态 + 渲染 + 回调**

In `src/ui/App.tsx`:
import：`import { ResourcePanel } from "./components/ResourcePanel";`
state（与其它 useState 同处）：`const [resourcePanelOpen, setResourcePanelOpen] = useState(false);`
给 `LocationScreen` 渲染处加 prop：`onOpenResources={() => setResourcePanelOpen(true)}`
给 `MapScreen` 渲染处加 prop：`onOpenResources={() => setResourcePanelOpen(true)}`
在 JSX 末尾（`<DebugPanel ... />` 之前）渲染：
```tsx
      {resourcePanelOpen && (
        <ResourcePanel state={liveState} onClose={() => setResourcePanelOpen(false)} />
      )}
```

- [ ] **Step 3: HUD 按钮（LocationScreen）**

In `src/ui/screens/LocationScreen.tsx`:
给 props 类型与解构加 `onOpenResources?: () => void;`。在表头 `hud__group`（存档/宫城图按钮所在 span）内、`存档` 按钮之前加：
```tsx
            {onOpenResources && (
              <button type="button" className="hud__button" onClick={onOpenResources}>
                国情
              </button>
            )}
```

- [ ] **Step 4: HUD 按钮（MapScreen）**

In `src/ui/screens/MapScreen.tsx`:
给 props 类型与解构加 `onOpenResources?: () => void;`。在表头 `hud__group` 内、`存档` 按钮之前加同样的按钮块（如上 Step 3 代码）。

- [ ] **Step 5: 样式（最小）**

Append to `src/ui/styles.css`:
```css
.resource-panel { background: #1c1611; border: 1px solid #5c4d3a; padding: 1rem 1.5rem; max-width: 22rem; }
.resource-panel__row { display: flex; justify-content: space-between; gap: 2rem; }
.resource-panel__val { color: #d8c7a8; }
```

- [ ] **Step 6: 验证 + 提交**

Run: `npm run typecheck && npm run build`
Expected: PASS（构建通过）。
```bash
git add src/ui/components/ResourcePanel.tsx src/ui/App.tsx src/ui/screens/LocationScreen.tsx src/ui/screens/MapScreen.tsx src/ui/styles.css
git commit -m "feat: 只读国情面板 + HUD 入口"
```

---

# PART B — 上朝限首个行动点

### Task B1: location schema `actionFirstSlotOnly` + chaotang 标记

**Files:**
- Modify: `src/engine/content/schemas.ts`（`locationSchema`）
- Modify: `content/locations/chaotang.json`
- Test: `tests/content/chaotang.test.ts`

- [ ] **Step 1: 失败测试**

Create `tests/content/chaotang.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("朝堂 上朝限时", () => {
  it("chaotang carries actionFirstSlotOnly = true", () => {
    expect(db.locations["chaotang"]!.actionFirstSlotOnly).toBe(true);
  });
});
```
Run `npx vitest run tests/content/chaotang.test.ts` — expect FAIL（字段未知或为 undefined）。

- [ ] **Step 2: schema 加字段**

In `src/engine/content/schemas.ts`, `locationSchema` 的 `strictObject` 内（`actionEventId` 旁）加：
```ts
    actionFirstSlotOnly: z.boolean().optional(),
```
（strict object 必须显式声明该键，否则 chaotang.json 加了会被拒。）

- [ ] **Step 3: chaotang.json 设标记**

In `content/locations/chaotang.json`, 在 `"actionEventId": "ev_chaohui"` 之后加：
```json
  "actionFirstSlotOnly": true
```
（注意逗号：`actionEventId` 行末加逗号，新行作为最后一个键不带尾逗号。）

- [ ] **Step 4: 验证 + 提交**

Run: `npx vitest run tests/content/chaotang.test.ts && npx vitest run && npm run typecheck`
Expected: PASS（全套绿；schema 接受新字段）。
```bash
git add src/engine/content/schemas.ts content/locations/chaotang.json tests/content/chaotang.test.ts
git commit -m "feat: location actionFirstSlotOnly + chaotang 上朝限时标记"
```

### Task B2: FreeViewScreen 上朝门控

**Files:**
- Modify: `src/ui/screens/FreeViewScreen.tsx`

- [ ] **Step 1: 门控逻辑 + 提示**

In `src/ui/screens/FreeViewScreen.tsx`，当前有：
```tsx
  const action = location.actionEventId ? db.events[location.actionEventId] : undefined;
  const affordable = action ? state.calendar.ap >= action.apCost : false;
```
在其后加首个行动点门控：
```tsx
  // actionFirstSlotOnly：仅每日首个行动点（卯时早朝，ap===apMax）可行动。
  const slotBlocked = location.actionFirstSlotOnly === true && state.calendar.ap !== state.calendar.apMax;
```
把 action 按钮渲染块改为：
```tsx
        {action ? (
          <>
            <button
              type="button"
              className="location-screen__event"
              disabled={!affordable || slotBlocked}
              onClick={() => onStartEvent(action.id)}
            >
              {action.title}
            </button>
            {slotBlocked && (
              <p className="location-screen__empty">朝时已过，请明日卯时早朝。</p>
            )}
          </>
        ) : (
          <p className="location-screen__empty">此处无人，亦无可为之事。</p>
        )}
```

- [ ] **Step 2: 验证 + 提交**

Run: `npm run typecheck && npm run build`
Expected: PASS。手动：进朝堂，首个行动点可上朝；花掉一点后再进，按钮禁用且显示「朝时已过」。
```bash
git add src/ui/screens/FreeViewScreen.tsx
git commit -m "feat: 上朝仅限首个行动点（过时提示）"
```

---

# PART C — 凤后自行下旨升降

### Task C1: `empressDecree.ts` 纯逻辑 + 测试

**Files:**
- Create: `src/store/empressDecree.ts`
- Test: `tests/store/empressDecree.test.ts`

参考既有：`gestationRoll(seedString): number`（`src/engine/characters/gestation.ts`）；`resolveDisplayName(ch, st, rank)`（`src/engine/characters/standing.ts`）；`db.ranks` 是 `Record<string, CharacterRank>`，每个有 `order:number`、`domain:"harem"|"official"`、`name`；`db.characters[id]` 有 `kind`、`defaultLocation`；`state.standing[id]` 有 `rank`、`favor`、`lifecycle?`。`EventEffect` 来自 `../engine/content/schemas`。内容里贵人及以下后宫位分：`guiren`(100)、`meiren`(90)、`cairen`(80)、`changzai`(70)、`daying`(60)、`gengyi`(50)、`guannanzi`(40)。`feng_hou` 为凤后，`wenya_shijun` 在冷宫，`sili_nvguan` 为官员。

- [ ] **Step 1: 失败测试**

Create `tests/store/empressDecree.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { decideDecree, adjacentHaremRank } from "../../src/store/empressDecree";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** Put a single consort at a given rank+favor, everyone else out of band. */
function oneConsortAt(rank: string, favor: number): GameState {
  const s = createNewGameState(db);
  // park feng_hou (凤后, out of band) as-is; move shen_chenghui into the band
  s.standing.shen_chenghui!.rank = rank;
  s.standing.shen_chenghui!.favor = favor;
  // ensure other in-band consorts don't interfere: push chu_jun above the band
  if (s.standing.chu_jun) s.standing.chu_jun.rank = "shichen"; // order 110 > 100, excluded
  return s;
}

describe("adjacentHaremRank", () => {
  it("promote = next higher band rank; demote = next lower; edges null", () => {
    expect(adjacentHaremRank(db, "meiren", "promote")).toBe("guiren"); // 90 → 100
    expect(adjacentHaremRank(db, "meiren", "demote")).toBe("cairen"); // 90 → 80
    expect(adjacentHaremRank(db, "guiren", "promote")).toBeNull(); // 100 ceiling
    expect(adjacentHaremRank(db, "guannanzi", "demote")).toBeNull(); // 40 floor
  });
});

describe("decideDecree", () => {
  it("high favor → promote one step", () => {
    const s = oneConsortAt("meiren", 80); // 90 → promote → guiren(100)
    const plan = decideDecree(db, s, "seed-A");
    expect(plan).not.toBeNull();
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; char: string; rank: string };
    expect(setRank.char).toBe("shen_chenghui");
    expect(setRank.rank).toBe("guiren");
    expect(plan!.reactions[0]!.speakerId).toBe("sili_nvguan");
    expect(plan!.reactions[1]!.speakerId).toBe("shen_chenghui");
  });

  it("low favor → demote one step", () => {
    const s = oneConsortAt("meiren", 20); // 90 → demote → cairen(80)
    const plan = decideDecree(db, s, "seed-A");
    const setRank = plan!.effects.find((e) => e.type === "set_rank") as { type: "set_rank"; rank: string };
    expect(setRank.rank).toBe("cairen");
  });

  it("mid favor → no decree", () => {
    expect(decideDecree(db, oneConsortAt("meiren", 50), "seed-A")).toBeNull();
  });

  it("ceiling: 贵人 + high favor → no promote (null)", () => {
    expect(decideDecree(db, oneConsortAt("guiren", 90), "seed-A")).toBeNull();
  });

  it("floor: 官男子 + low favor → no demote (null)", () => {
    expect(decideDecree(db, oneConsortAt("guannanzi", 10), "seed-A")).toBeNull();
  });

  it("excludes 冷宫 / deceased / official / 凤后 / above-贵人", () => {
    const s = createNewGameState(db);
    // move every in-band consort out: only wenya_shijun (冷宫) left in a low rank
    s.standing.shen_chenghui!.rank = "shichen"; // 110, excluded
    if (s.standing.chu_jun) s.standing.chu_jun.rank = "shichen";
    s.standing.wenya_shijun!.rank = "meiren"; // in band BUT in 冷宫 → excluded
    s.standing.wenya_shijun!.favor = 90;
    expect(decideDecree(db, s, "seed-A")).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const s = oneConsortAt("meiren", 80);
    expect(decideDecree(db, s, "k")).toEqual(decideDecree(db, s, "k"));
  });
});
```
Run `npx vitest run tests/store/empressDecree.test.ts` — expect FAIL (module missing).

- [ ] **Step 2: 实现**

Create `src/store/empressDecree.ts`:
```ts
/** 凤后自行下旨升降「贵人及以下」侍君（纯逻辑，种子化确定性）。 */
import { gestationRoll } from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export const DECREE_CHANCE = 3; // 每行动点 3%
export const PROMOTE_FAVOR = 65;
export const DEMOTE_FAVOR = 35;
export const DECREE_RANK_CEILING = 100; // 贵人
export const DECREE_RANK_FLOOR = 40; // 官男子

export interface DecreeReaction {
  speakerId: string;
  lines: string[];
}
export interface DecreePlan {
  effects: EventEffect[];
  reactions: DecreeReaction[];
}

type Dir = "promote" | "demote";

/** 后宫位分（带内）按 order 升序。 */
function bandRanks(db: ContentDB): { id: string; order: number }[] {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.order >= DECREE_RANK_FLOOR && r.order <= DECREE_RANK_CEILING)
    .map((r) => ({ id: r.id, order: r.order }))
    .sort((a, b) => a.order - b.order);
}

/** 相邻一级位分 id（promote=order 更高的最近一级；demote=更低）。触边返回 null。 */
export function adjacentHaremRank(db: ContentDB, currentRankId: string, dir: Dir): string | null {
  const band = bandRanks(db);
  const cur = db.ranks[currentRankId];
  if (!cur) return null;
  if (dir === "promote") {
    const up = band.filter((r) => r.order > cur.order);
    return up.length ? up[0]!.id : null; // 最近的更高一级
  }
  const down = band.filter((r) => r.order < cur.order);
  return down.length ? down[down.length - 1]!.id : null; // 最近的更低一级
}

/** 选人 + 方向 + 相邻位分（不含概率门）。无合法懿旨返回 null。 */
export function decideDecree(db: ContentDB, state: GameState, seedKey: string): DecreePlan | null {
  const candidates = Object.values(db.characters).filter((c) => {
    if (c.kind !== "consort" || c.id === "feng_hou") return false;
    if (c.defaultLocation === "lenggong") return false;
    const st = state.standing[c.id];
    if (!st || st.lifecycle === "deceased") return false;
    const rank = db.ranks[st.rank];
    return !!rank && rank.domain === "harem" && rank.order >= DECREE_RANK_FLOOR && rank.order <= DECREE_RANK_CEILING;
  });
  if (candidates.length === 0) return null;

  const pick = candidates[gestationRoll(`empress:pick:${seedKey}`) % candidates.length]!;
  const st = state.standing[pick.id]!;
  const dir: Dir | null = st.favor >= PROMOTE_FAVOR ? "promote" : st.favor < DEMOTE_FAVOR ? "demote" : null;
  if (dir === null) return null;

  const targetId = adjacentHaremRank(db, st.rank, dir);
  if (targetId === null) return null;

  const name = resolveDisplayName(pick, st, db.ranks[st.rank]);
  const targetName = db.ranks[targetId]!.name;
  const summary = dir === "promote" ? `凤后下旨晋我为${targetName}` : `凤后下旨贬我为${targetName}`;

  const effects: EventEffect[] = [
    { type: "set_rank", char: pick.id, rank: targetId },
    {
      type: "memory",
      char: pick.id,
      entry: {
        kind: "event",
        summary,
        salience: dir === "demote" ? 70 : 55,
        tags: ["empress", dir],
        participants: ["feng_hou", pick.id],
      },
    },
  ];
  const verb = dir === "promote" ? "晋" : "贬";
  const reactions: DecreeReaction[] = [
    { speakerId: "sili_nvguan", lines: [`司礼官启奏：凤后娘娘懿旨——${verb}${name}为${targetName}。`] },
    {
      speakerId: pick.id,
      lines: dir === "promote" ? [`${name}叩谢凤后娘娘恩典。`] : [`${name}默然领旨，不敢有怨。`],
    },
  ];
  return { effects, reactions };
}

/** 含 3% 概率门：每行动点调用一次，命中且有合法懿旨才返回 plan。 */
export function buildEmpressDecree(db: ContentDB, state: GameState, seedKey: string): DecreePlan | null {
  if (gestationRoll(`empress:gate:${seedKey}`) % 100 >= DECREE_CHANCE) return null;
  return decideDecree(db, state, seedKey);
}
```

- [ ] **Step 3: 验证 + 提交**

Run: `npx vitest run tests/store/empressDecree.test.ts && npm run typecheck`
Expected: PASS。
```bash
git add src/store/empressDecree.ts tests/store/empressDecree.test.ts
git commit -m "feat: empressDecree pure logic (candidate/direction/adjacency)"
```

### Task C2: App 接线（spendAp + reactionQueue + decree）

**Files:**
- Modify: `src/ui/App.tsx`

集成任务。READ `src/ui/App.tsx` 全文，理解现有 `adoptionQueue`、各 `SPEND_AP` 处、`commitBedchamber`、`onTravelled`、`ReactionScreen` 的 `onDone`。以 `npm run typecheck`、`npm run build`、`npx vitest run`（全套）验证。

- [ ] **Step 1: imports + refs/state**

import 加：
```tsx
import { buildEmpressDecree, type DecreeReaction } from "../store/empressDecree";
```
（`useRef` 已 import；若没有则补 `import { useMemo, useRef, useState } from "react";` 的 useRef。）
在组件内、其它 useState 旁加一个 ref（记录已掷骰的行动点，防重复应用）：
```tsx
  const rolledSlots = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: 泛化 adoptionQueue → reactionQueue**

把 `adoptionQueue`/`setAdoptionQueue` 全部重命名为 `reactionQueue`/`setReactionQueue`（声明处、`adoptHeir` 内的 `setAdoptionQueue(rest)`、`ReactionScreen` 的 `onDone` 内排空逻辑）。类型不变：`useState<{ speakerId: string; lines: string[] }[]>([])`。

- [ ] **Step 3: decree 掷骰 + spendAp + playReactions 助手**

在 `runCheckpoints` 附近加三个助手：
```tsx
  /** 为本次行动消耗的每个行动点掷骰凤后懿旨（命中即应用，至多一道/次）。返回台词节拍。 */
  const rollDecree = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): DecreeReaction[] => {
    const beats: DecreeReaction[] = [];
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      rolledSlots.current.add(key);
      const plan = buildEmpressDecree(db, store.getState(), key);
      if (plan) {
        const applied = store.applyEffects(db, plan.effects);
        if (applied.ok) {
          beats.push(...plan.reactions);
          break; // 单次行动至多一道懿旨
        }
      }
    }
    return beats;
  };

  /** 集中化行动点消耗：扣点 + 凤后懿旨掷骰。返回扣点结果与懿旨台词。 */
  const spendAp = (amount: number) => {
    const before = store.getState().calendar;
    const spend = store.dispatch({ type: "SPEND_AP", amount });
    const decreeBeats = spend.ok ? rollDecree(before, amount) : [];
    return { spend, decreeBeats };
  };

  /** 串播一组反应节拍（行动自身台词 + 凤后懿旨），空则按需补跑转旬 checkpoint。 */
  const playReactions = (beats: DecreeReaction[], rolledOver: boolean) => {
    if (beats.length === 0) {
      if (rolledOver) runCheckpoints(true);
      return;
    }
    setReaction(beats[0]!);
    setReactionQueue(beats.slice(1));
    if (rolledOver) setReactionRollover(true);
  };
```

- [ ] **Step 4: 改写 converse / summonHeir / heirLesson / tutorReport**

把这四个处理函数改为走 `spendAp` + `playReactions`（保留各自的 plan/lines 计算与 `setHeirListOpen(false)` 等）：
```tsx
  const converse = (charId: string) => {
    const lines = buildConversation(db, store.getState(), charId);
    if (!lines) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    doAutosave();
    playReactions([{ speakerId: charId, lines }, ...decreeBeats], spend.value.rolledOver);
  };

  const summonHeir = (heirId: string) => {
    const plan = buildHeirSummon(db, store.getState(), heirId);
    if (!plan) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    setHeirListOpen(false);
    // 召见用 ChildReactionScreen 播子嗣台词；懿旨随后经 reactionQueue 串播。
    if (decreeBeats.length) setReactionQueue(decreeBeats);
    if (spend.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  const heirLesson = (heirId: string) => {
    const plan = buildHeirLesson(db, store.getState(), heirId);
    if (!plan) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    if (decreeBeats.length) setReactionQueue(decreeBeats);
    if (spend.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };

  const tutorReport = (heirId: string) => {
    const lines = buildTutorReport(db, store.getState(), heirId);
    if (!lines) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    doAutosave();
    playReactions([{ speakerId: "sili_nvguan", lines }, ...decreeBeats], spend.value.rolledOver);
  };
```
注：`summonHeir`/`heirLesson` 用 `ChildReactionScreen`（非 `ReactionScreen`），故懿旨节拍先放入 `reactionQueue`；需让 `ChildReactionScreen` 的 `onDone` 在结束后排空 `reactionQueue`（见 Step 7）。

- [ ] **Step 5: 改写 reviewMemorials**

```tsx
  const reviewMemorials = () => {
    if (store.getState().calendar.ap < 2) return;
    const applied = store.applyEffects(db, [
      { type: "resource", pillar: "court", field: "authority", delta: 5 },
      { type: "resource", pillar: "court", field: "publicSupport", delta: 3 },
      { type: "resource", pillar: "court", field: "factionPressure", delta: -3 },
    ]);
    if (!applied.ok) return;
    const { spend, decreeBeats } = spendAp(2);
    if (!spend.ok) return;
    doAutosave();
    const own: DecreeReaction[] = spend.value.rolledOver
      ? []
      : [{ speakerId: "sili_nvguan", lines: ["奏折已批阅毕。陛下勤政忧国，朝野称颂，圣威日隆。"] }];
    playReactions([...own, ...decreeBeats], spend.value.rolledOver);
  };
```

- [ ] **Step 6: 改写 commitBedchamber 与 onTravelled 的扣点**

`commitBedchamber`：把 `const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });` 改为 `const { spend, decreeBeats } = spendAp(1);`，并在其原有 firstNight/rollover 分支之后追加懿旨串播：原逻辑保持；在函数末尾（所有分支后）加：
```tsx
    if (decreeBeats.length) {
      // 侍寝自身经 BedchamberScene 已播；懿旨经 reactionQueue 随后串播。
      if (reaction === null) playReactions(decreeBeats, false);
      else setReactionQueue((q) => [...q, ...decreeBeats]);
    }
```
（若 firstNight 弹窗在显示，懿旨入队，待其后续反应排空时播。）

`onTravelled`（MapScreen 的回调）：travel 的扣点在 MapScreen 内完成，故此处单独为「这次移动」掷一骰：
```tsx
          onTravelled={(rolledOver) => {
            doAutosave();
            const cal = store.getState().calendar;
            const key = `${store.getState().rngSeed}:${cal.dayIndex}:travel:${cal.ap}`;
            let beats: DecreeReaction[] = [];
            if (!rolledSlots.current.has(key)) {
              rolledSlots.current.add(key);
              const plan = buildEmpressDecree(db, store.getState(), key);
              if (plan) {
                const applied = store.applyEffects(db, plan.effects);
                if (applied.ok) beats = plan.reactions;
              }
            }
            if (beats.length) playReactions(beats, rolledOver);
            else runCheckpoints(rolledOver);
          }}
```

- [ ] **Step 7: ChildReactionScreen onDone 排空 reactionQueue**

在 `{childReaction && (<ChildReactionScreen ... onDone={...} />)}` 的 `onDone` 内，`setChildReaction(null);` 之后、`reactionRollover` 处理之前，加排空：
```tsx
            setChildReaction(null);
            if (reactionQueue.length > 0) {
              const [next, ...rest] = reactionQueue;
              setReactionQueue(rest);
              setReaction(next!);
              return;
            }
```
（与 `ReactionScreen.onDone` 的排空逻辑同构。）

- [ ] **Step 8: adoptHeir 改用 playReactions（DRY）**

`adoptHeir` 当前手动拆 `[first,...rest]`。保持其行为即可（已用 reactionQueue 命名）。无需改动，除非 Step 2 重命名后仍引用旧名——确保已改为 `setReactionQueue`。

- [ ] **Step 9: 验证 + 提交**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: 全套 PASS（无回归）。
```bash
git add src/ui/App.tsx
git commit -m "feat: 凤后下旨接线 — spendAp 每行动点掷骰 + reactionQueue 串播"
```

- [ ] **Step 10: 手动验证（可选）**

`npm run dev`：反复做耗行动点的动作（对话/批阅/召见/问功课），偶发司礼官奏报凤后懿旨升/降某位贵人及以下侍君；子嗣列表/名册位分相应变化；国情面板随时可开。

---

## Self-Review

**Spec 覆盖**：A 国情面板→A1；B schema+chaotang→B1、FreeViewScreen 门控→B2；C 纯逻辑（候选/方向/相邻/确定性/概率门）→C1，集中化 spendAp+reactionQueue+每行动点 3%+travel→C2。全覆盖。

**类型一致**：`DecreePlan{effects,reactions}`、`DecreeReaction{speakerId,lines}`、`buildEmpressDecree`/`decideDecree`/`adjacentHaremRank` 全程一致；`reactionQueue` 统一命名；`set_rank` 目标恒为后宫带内位分（候选过滤保证非凤后/非官员）。

**占位符**：无 TODO/TBD；每步含完整代码。C2 Step 7 的 ChildReactionScreen 排空与 ReactionScreen 既有排空同构。

**已知取舍**：travel 用独立 seed 命名空间（`:travel:`）单独掷骰；`SKIP_REMAINDER`（独自休息）不视为消耗行动点，故不掷骰；firstNight 与懿旨同时出现时懿旨入队后播（罕见）。
