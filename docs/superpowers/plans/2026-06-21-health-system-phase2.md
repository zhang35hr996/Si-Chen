# 健康系统 Phase 2（统一月度 tick + 基础死亡 + 事件队列）实现计划 — v2.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通 Phase 1 健康基础设施：每跨月对全体角色（含动态选秀侍君）跑 `projectMonthlyHealth` + `planHealthChange`（衰老/生病/恶化/痊愈/暴毙），health≤0 或暴毙即死并标记 + 入队；皇帝死亡 → 持久化终局 + 回主菜单且不可继续；承孕侍君死亡自动断胎。

**Architecture:** 纯投影（`projectMonthlyHealth`）→ orchestrator（按 `currentAgeOf`/`livingConsortIds` 遍历、皇帝死亡即止）→ `GameStore.advanceTime` 单一时间推进入口（按 `monthOrdinal` 跨月触发、advance+tick 封装在一处）→ App 全部时间命令改走该入口。非皇帝身后事 UI 由 `FEATURE_AFTERMATH_UI=false` 关闭（死亡照常标记/入队，留 Phase 4）。

**Tech Stack:** TypeScript、Zod、React、Vitest。确定性随机 `healthRoll`/新增 `healthRollBasisPoints`（Phase 1 文件）。年龄 `aging` + 新 `currentAgeOf`。

## Global Constraints

- health 0–100；`HealthStatus = "healthy"|"sick"|"critical"` 独立存储。
- 年化→月度生病：`annualRate = clamp(5 + round((100−health)*0.4) + max(0,age−35), 5, 60)`；`monthlyRate = 1 − (1 − annualRate/100)^(1/12)`。仅对 `healthy` 掷 onset。
- **onset 命中须用高精度随机**：`healthRollBasisPoints(seed) ∈ [0,9999]`，命中 `bp < monthlyRate*10000`。**禁止**用 `healthRoll`(0–99) 比较亚百分比（会把 0.426% 放大成 1%）。
- 生病每月 −rand(1,2)；重病每月 −rand(3,5)（仅本月之前已处于该状态者扣）；本月刚转生病者本月不扣病损/不恶化。
- 互斥迁移（生病，单次 `r=healthRoll∈[0,100)`）：`criticalRate=clamp(1+max(0,age−35),1,30)`；`r<criticalRate`→重病；否则 `r<criticalRate+50`→痊愈；否则维持。**不可先判痊愈再判重病。**
- 重病每月 5% 暴毙（`healthRoll<5`）；暴毙时 **health 可能>0** 仍必须死亡（见 forceDeath）。重病不自动痊愈。
- 衰老（仅年初 `month===1 && period==="early"`、`age≥35`）：`decay = 1 + floor(max(0,age−35)/10)`。新游戏元年一月不触发（无跨月）。
- 月度结算顺序（每角色本地投影）：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移。
- 死亡判定（`planHealthChange`）：`died = input.forceDeath === true || nextHealth <= 0`。
- 皇帝死亡 → `sovereignDied`，**不入队**，**orchestrator 处理完皇帝立即返回**（同月不再生成其他死亡 effects）；持久化 `state.gameOver`，回 title 且**不可继续加载死亡档**。
- 其余死亡 → `enqueue_aftermath`（稳定 id `death:{kind}:{subjectId}:{dayIndex}`，幂等）。同月优先级：皇帝→太后→侍君(按 id)→皇嗣(按 id)。
- **跨月幂等靠日历**：仅当 `monthOrdinal(after) !== monthOrdinal(before)` 才跑 tick；**不用 React ref / 不清 ref / 不加存档字段**。读档后日历已在新月，自然不重跑。
- **所有时间推进经 `GameStore.advanceTime`**（含 `SPEND_AP`/`SKIP_REMAINDER`）；UI 不得直接 `dispatch` 这两个时间命令。
- 怀孕成本（转胎/孕期/生产一次性）属 **Phase 3**；本 phase tick 只做衰老+病情，`pregnancyMonthlyCost` 入参一律 false。
- **断胎**：`consort_decease` 自动清该侍君活动 gestation（任何死亡路径一致；已产无活动胎 → no-op）。
- 角色集合：侍君来自 `livingConsortIds(state)`（static standing + `generatedConsorts`，排除 candidate/deceased，**含冷宫**——冷宫仍会生病）；**不复用** UI 的 `inPalaceConsorts`（只遍历 `db.characters`）。
- 年龄经 `currentAgeOf(db,state,subject)`：皇帝 `startingAge+(year−1)`；预置侍君/太后 `profile.age+(year−1)`；动态侍君 `ageAtEntry+(year−enteredAtYear)`；皇嗣 `heirAge(birthAt)`。orchestrator 不得自行 `presetAge(...)`。
- 动态选秀侍君落库须写 `health`/`healthStatus`/`ageAtEntry`/`enteredAtYear`（`addGeneratedConsort`）。
- Phase 2 死亡 gating 下限：太后死 → 慈宁宫永久锁 + 移除侍疾/敲打；侍疾**不再免费治愈太后**；已故侍君/皇嗣不出现在翻牌/对话/赏赐/太医选择器/召见/教育；当前死者视图安全退出。葬仪/谥号/追封/服丧 → Phase 4。
- 不复用 `gestationRoll`；用 `healthRoll`/`healthRollBasisPoints`，seedKey 含 rngSeed + year:month + charId + 用途，**不含 period/ap**。
- 测试在 `tests/**/*.test.ts`（mirror `engine/` 后子路径；`src/store/X`→`tests/store/X`）。命令 `npx vitest run <file>`、`npx tsc --noEmit`。基线全套件 794 绿。

---

### Task 1: `planHealthChange` forceDeath + uncapped sovereign + 强 target 守卫 + inert 守卫 + consort_decease 断胎

**Files:**
- Modify: `src/engine/content/schemas.ts`（`set_sovereign_health` 分支）
- Modify: `src/engine/effects/funnel.ts`（`set_sovereign_health` case；validateEffects 强守卫；`consort_decease` 断胎 + 重复死亡幂等）
- Modify: `src/store/health.ts`（`forceDeath`；sovereign 走 `set_sovereign_health`；inert 守卫）
- Test: `tests/effects/funnelSovereignHealth.test.ts`、`tests/effects/funnel-health.test.ts`(扩)、`tests/store/health.test.ts`(扩)

**Interfaces:**
- Produces: `set_sovereign_health { type; healthStatus?; healthDelta? }`（clamp 0–100）；`HealthChangeInput.forceDeath?: boolean`；`died = forceDeath===true || nextHealth<=0`；`consort_decease` 副作用增「清 carrier 胎 + 已死则 no-op」。

- [ ] **Step 1: failing test — forceDeath + uncapped sovereign + 断胎 + guards**

```ts
// tests/effects/funnelSovereignHealth.test.ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent"; // ← copy from tests/effects/funnel-health.test.ts if no shared helper
describe("set_sovereign_health", () => {
  it("uncapped lethal delta + status", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const r = applyEffects(db, s, [{ type: "set_sovereign_health", healthDelta: -100, healthStatus: "critical" }]);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.resources.sovereign.health).toBe(0); expect(r.value.resources.sovereign.healthStatus).toBe("critical"); }
  });
});
```

```ts
// add to tests/store/health.test.ts
  it("forceDeath kills even when nextHealth > 0 (sudden death), enqueues aftermath", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const id = Object.keys(s.standing).find((c) => db.characters[c]?.kind === "consort")!;
    s.standing[id]!.health = 66; s.standing[id]!.healthStatus = "critical";
    const { effects, outcome } = planHealthChange(s, { subject: { kind: "consort", id }, healthStatus: "critical", forceDeath: true, cause: "critical_sudden", at: toGameTime(s.calendar) });
    expect(outcome.died).toBe(true);
    expect(outcome.deathCause).toBe("critical_sudden");
    const r = applyEffects(db, s, effects);
    if (r.ok) { expect(r.value.standing[id]!.lifecycle).toBe("deceased"); expect(r.value.pendingAftermath.some((p) => p.subjectId === id)).toBe(true); }
  });
  it("emits no inert effect when delta=0 && no status && no forceDeath", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const { effects } = planHealthChange(s, { subject: { kind: "taihou" }, cause: "illness", at: toGameTime(s.calendar) });
    expect(effects).toHaveLength(0);
  });
```

```ts
// add to tests/effects/funnel-health.test.ts
  it("consort_decease clears carrier gestation (断胎) and is idempotent on re-death", () => {
    const { db, state } = freshState();
    const id = Object.keys(state.standing).find((c) => db.characters[c]?.kind === "consort")!;
    state.resources.bloodline.gestations.push({ carrier: id, conceivedAt: state.calendar });
    const r1 = applyEffects(db, state, [{ type: "consort_decease", char: id, at: state.calendar, cause: "illness" }]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.resources.bloodline.gestations.some((g) => g.carrier === id)).toBe(false);
    expect(r1.value.standing[id]!.lifecycle).toBe("deceased");
    // re-death is a no-op (already deceased; deathRecord preserved)
    const before = JSON.stringify(r1.value.standing[id]!.deathRecord);
    const r2 = applyEffects(db, r1.value, [{ type: "consort_decease", char: id, at: state.calendar, cause: "scripted" }]);
    if (r2.ok) expect(JSON.stringify(r2.value.standing[id]!.deathRecord)).toBe(before);
  });
```

- [ ] **Step 2: run → FAIL** `npx vitest run tests/effects/funnelSovereignHealth.test.ts tests/effects/funnel-health.test.ts tests/store/health.test.ts`

- [ ] **Step 3: schema** — add to `eventEffectSchema` (beside `set_taihou_health`):

```ts
  z.strictObject({ type: z.literal("set_sovereign_health"), healthStatus: z.enum(["healthy","sick","critical"]).optional(), healthDelta: z.number().int().optional() }),
```

- [ ] **Step 4: funnel apply cases**

`set_sovereign_health`:
```ts
      case "set_sovereign_health": {
        if (effect.healthDelta !== undefined) next.resources.sovereign.health = clampPct(next.resources.sovereign.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.resources.sovereign.healthStatus = effect.healthStatus;
        break;
      }
```
`consort_decease` — make it idempotent + 断胎 (extend the Phase-1 handler):
```ts
      case "consort_decease": {
        const st = next.standing[effect.char];
        if (st && st.lifecycle !== "deceased") {       // idempotent: skip if already dead
          st.lifecycle = "deceased";
          st.deathRecord = { diedAt: effect.at, cause: effect.cause, originalRankId: st.rank, ...(st.title !== undefined ? { originalTitle: st.title } : {}) };
        }
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter((g) => g.carrier !== effect.char); // 断胎
        break;
      }
```
(Use the file's actual `clampPct` name. Keep the existing `deathRecord` shape from Phase 1.)

- [ ] **Step 5: validateEffects 强守卫** — consort effects must resolve to a consort via `db.characters ?? generatedConsorts`, with per-effect lifecycle rules:

```ts
      case "set_consort_health":
      case "consort_decease": {
        const ch = (effect as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        if (!c || c.kind !== "consort" || !state.standing[ch]) bad(index, "BAD_EFFECT_TARGET", `effect needs a consort with standing: "${ch}"`, { char: ch });
        else if (state.standing[ch]!.lifecycle === "deceased" && effect.type === "set_consort_health") bad(index, "BAD_EFFECT_TARGET", `set_consort_health on deceased consort: "${ch}"`, { char: ch });
        break;
      }
      case "set_consort_posthumous": {
        const ch = (effect as { char: string }).char;
        const c = db.characters[ch] ?? state.generatedConsorts[ch];
        const st = state.standing[ch];
        if (!c || c.kind !== "consort" || !st || st.lifecycle !== "deceased" || !st.deathRecord)
          bad(index, "BAD_EFFECT_TARGET", `set_consort_posthumous needs a deceased consort with deathRecord: "${ch}"`, { char: ch });
        break;
      }
      // #9 — heir effects need the same protection:
      case "set_heir_health": {
        const h = state.resources.bloodline.heirs.find((x) => x.id === (effect as { heirId: string }).heirId);
        if (!h) bad(index, "BAD_EFFECT_TARGET", `set_heir_health: no such heir "${(effect as { heirId: string }).heirId}"`, { heirId: (effect as { heirId: string }).heirId });
        else if (h.lifecycle === "deceased") bad(index, "BAD_EFFECT_TARGET", `set_heir_health on deceased heir "${h.id}"`, { heirId: h.id });
        break;
      }
      case "heir_decease": {
        const h = state.resources.bloodline.heirs.find((x) => x.id === (effect as { heirId: string }).heirId);
        if (!h) bad(index, "BAD_EFFECT_TARGET", `heir_decease: no such heir "${(effect as { heirId: string }).heirId}"`, { heirId: (effect as { heirId: string }).heirId });
        break; // already-deceased heir is allowed (apply case is idempotent — see below)
      }
```
(Mirror the exact `bad(...)` signature in `validateEffects`. `consort_decease`/`heir_decease` on an already-deceased target is allowed but must no-op in apply — do NOT mark BAD; make the `heir_decease` apply case idempotent like `consort_decease`: `if (h && h.lifecycle !== "deceased") { h.lifecycle = "deceased"; h.deceasedAt = effect.at; }`.)

- [ ] **Step 6: `src/store/health.ts`** — forceDeath + uncapped sovereign + inert guard

In `HealthChangeInput` add `forceDeath?: boolean;`. In `setHealthEffect` sovereign branch → `set_sovereign_health` (drop `clampDelta` + its const).

**#4 — already-deceased subject must be a hard no-op** (prevents a second `enqueue_aftermath` on a different `dayIndex`). Add a helper and guard at the TOP of `planHealthChange`, before computing anything:
```ts
function isDeceased(state: GameState, s: HealthSubject): boolean {
  if (s.kind === "taihou") return state.taihou.deceased === true;
  if (s.kind === "consort") return state.standing[s.id]?.lifecycle === "deceased";
  if (s.kind === "heir") return state.resources.bloodline.heirs.find((h) => h.id === s.id)?.lifecycle === "deceased";
  return false; // sovereign death ends the game; never re-planned
}
// in planHealthChange, right after `const cur = currentOf(...)`:
  if (!cur || isDeceased(state, input.subject)) {
    return { effects: [], outcome: { previousHealth: cur?.health ?? 0, nextHealth: cur?.health ?? 0, previousStatus: cur?.status ?? "healthy", nextStatus: cur?.status ?? "healthy", died: false } };
  }
```
Then:
```ts
  const delta = input.healthDelta ?? 0;
  const nextHealth = clamp(cur.health + delta);
  const nextStatus = input.healthStatus ?? cur.status;
  const died = input.forceDeath === true || nextHealth <= 0;

  const effects: EventEffect[] = [];
  if (delta !== 0 || input.healthStatus !== undefined) effects.push(setHealthEffect(input.subject, delta, input.healthStatus));
```
(Keep the rest: on `died`, sovereign→`sovereignDied`; else push `deceaseEffects`.)

Add a test (extend `tests/store/health.test.ts`): an already-deceased consort/heir/taihou, calling `planHealthChange(..., forceDeath: true)` on a LATER `dayIndex` → `effects` empty, `outcome.died===false`; applying yields **no new `pendingAftermath`** and the original `deathRecord` unchanged.

- [ ] **Step 7: run tests + tsc + full suite**

`npx vitest run tests/effects/funnelSovereignHealth.test.ts tests/effects/funnel-health.test.ts tests/store/health.test.ts` → PASS; `npx tsc --noEmit` clean; `npx vitest run` green.

- [ ] **Step 8: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts src/store/health.ts tests/effects/funnelSovereignHealth.test.ts tests/effects/funnel-health.test.ts tests/store/health.test.ts
git commit -m "feat: planHealthChange forceDeath + 死者no-op + set_sovereign_health 解封顶 + consort/heir 效果强守卫/幂等 + 断胎"
```

---

### Task 2: 高精度随机 + 动态侍君落库健康 + `currentAgeOf` + `livingConsortIds`

**Files:**
- Modify: `src/engine/characters/healthRoll.ts`（加 `healthRollBasisPoints`）
- Modify: `src/store/grandSelection.ts`（`addGeneratedConsort` 写健康/年龄字段）
- Create: `src/store/healthRoster.ts`（`currentAgeOf` + `livingConsortIds`）
- Test: `tests/characters/healthRoll.test.ts`(扩)、`tests/store/healthRoster.test.ts`、`tests/store/grandSelectionHealth.test.ts`

**Interfaces:**
- Produces:
  - `healthRollBasisPoints(seedKey: string): number`（0–9999，确定性）
  - `currentAgeOf(db: ContentDB, state: GameState, subject: HealthSubject): number`
  - `livingConsortIds(db: ContentDB, state: GameState): string[]`（有 standing、`kind==="consort"`、`lifecycle ∉ {candidate, deceased}`；含冷宫；含 generatedConsorts；字典序）

- [ ] **Step 1: failing tests**

```ts
// add to tests/characters/healthRoll.test.ts
import { healthRollBasisPoints } from "../../src/engine/characters/healthRoll";
describe("healthRollBasisPoints", () => {
  it("in [0,9999], deterministic", () => {
    expect(healthRollBasisPoints("a")).toBe(healthRollBasisPoints("a"));
    for (const k of ["a","b","c","d"]) { const v = healthRollBasisPoints(k); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(10000); }
  });
});
```

```ts
// tests/store/healthRoster.test.ts
import { describe, expect, it } from "vitest";
import { currentAgeOf, livingConsortIds } from "../../src/store/healthRoster";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
describe("currentAgeOf", () => {
  it("sovereign uses startingAge + (year-1)", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    expect(currentAgeOf(db, s, { kind: "sovereign" })).toBe(db.world.sovereign.startingAge + (s.calendar.year - 1));
  });
  it("dynamic consort uses ageAtEntry + (year - enteredAtYear)", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const id = "xiunan_test_1";
    s.generatedConsorts[id] = { ...Object.values(db.characters).find((c) => c.kind === "consort")!, id } as any;
    s.standing[id] = { rank: Object.keys(db.ranks)[0]!, favor: 10, health: 80, healthStatus: "healthy", ageAtEntry: 16, enteredAtYear: s.calendar.year } as any;
    expect(currentAgeOf(db, s, { kind: "consort", id })).toBe(16);
  });
});
describe("livingConsortIds", () => {
  it("includes static consorts with standing, excludes deceased/candidate, includes generated", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const ids = livingConsortIds(db, s);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual([...ids].sort());
  });
});
```

```ts
// tests/store/grandSelectionHealth.test.ts
import { describe, expect, it } from "vitest";
import { addGeneratedConsort } from "../../src/store/grandSelection";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
describe("addGeneratedConsort seeds health/age", () => {
  it("writes health, healthStatus, ageAtEntry, enteredAtYear", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const content = { ...Object.values(db.characters).find((c) => c.kind === "consort")!, id: "xiunan_y1_1" } as any; // ensure attributes.health present
    const next = addGeneratedConsort(s, content, Object.keys(db.ranks)[0]!, 20);
    const st = next.standing["xiunan_y1_1"]!;
    expect(st.health).toBe(content.attributes?.health ?? 100);
    expect(st.healthStatus).toBe("healthy");
    expect(st.ageAtEntry).toBe(content.profile.age);
    expect(st.enteredAtYear).toBe(s.calendar.year);
  });
});
```

> Confirm `addGeneratedConsort`'s real signature/param names at `src/store/grandSelection.ts:248` and adapt the test call. Use the shared `loadTestContent` helper (copy from an existing test if absent).

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: `healthRollBasisPoints`** (`healthRoll.ts`)

```ts
/** 0–9999（亚百分比精度，用于年化→月度 onset 命中）。 */
export function healthRollBasisPoints(seedKey: string): number {
  return parseInt(fnv1a64Hex(`health:${seedKey}`).slice(0, 12), 16) % 10000;
}
```

- [ ] **Step 4: seed dynamic consorts** (`grandSelection.ts` `addGeneratedConsort`)

In the standing object it builds, add (mirror Phase 1 `consortStandingExtras`):
```ts
        health: content.attributes?.health ?? 100,
        healthStatus: "healthy",
        ageAtEntry: content.profile.age,
        enteredAtYear: state.calendar.year,
```
(Find the exact standing literal in `addGeneratedConsort` and merge these keys; keep existing fields.)

- [ ] **Step 5: `src/store/healthRoster.ts`**

```ts
/** 健康系统的角色解析：当前年龄分派 + 在世侍君集合（含动态选秀）。 */
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import type { HealthSubject } from "./health";
import { presetAge, heirAge, dynamicConsortAge } from "../engine/characters/aging";

/** #8 — 解析失败必须显式抛错（不静默回退年龄）；健康 tick 是全局事务，遇坏状态宁可整次拒绝 + 诊断。 */
export function currentAgeOf(db: ContentDB, state: GameState, subject: HealthSubject): number {
  const year = state.calendar.year;
  switch (subject.kind) {
    case "sovereign": return db.world.sovereign.startingAge + (year - 1);
    case "taihou": {
      const t = db.characters["taihou"];
      if (!t) throw new Error("currentAgeOf: missing 太后 content");
      return presetAge(t.profile.age, year);
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === subject.id);
      if (!h) throw new Error(`currentAgeOf: missing heir ${subject.id}`);
      return heirAge(h.birthAt, { year });
    }
    case "consort": {
      const st = state.standing[subject.id];
      if (st?.ageAtEntry !== undefined && st.enteredAtYear !== undefined)
        return dynamicConsortAge(st.ageAtEntry, st.enteredAtYear, year);
      const content = db.characters[subject.id] ?? state.generatedConsorts[subject.id];
      if (!content) throw new Error(`currentAgeOf: missing consort content ${subject.id}`);
      return presetAge(content.profile.age, year);
    }
  }
}

export function livingConsortIds(db: ContentDB, state: GameState): string[] {
  const ids = new Set<string>();
  for (const [id, st] of Object.entries(state.standing)) {
    const c = db.characters[id] ?? state.generatedConsorts[id];
    if (c?.kind !== "consort") continue;
    if (st.lifecycle === "deceased" || st.lifecycle === "candidate") continue;
    ids.add(id);
  }
  return [...ids].sort();
}
```
(Confirm `db.characters["taihou"]` is the real 太后 id and `heir.birthAt` the real field. Adjust if different.)

- [ ] **Step 6: run tests + tsc + full suite** → all green.

- [ ] **Step 7: Commit**

```bash
git add src/engine/characters/healthRoll.ts src/store/grandSelection.ts src/store/healthRoster.ts tests/characters/healthRoll.test.ts tests/store/healthRoster.test.ts tests/store/grandSelectionHealth.test.ts
git commit -m "feat: healthRollBasisPoints + 动态侍君落库健康/年龄 + currentAgeOf/livingConsortIds"
```

---

### Task 3: `projectMonthlyHealth` 纯月度投影（高精度 onset）

**Files:**
- Create: `src/store/healthTick.ts`
- Test: `tests/store/healthTick.test.ts`

**Interfaces:**
- Consumes: `healthRoll`/`healthRollRange`/`healthRollBasisPoints`、`ageOver35`。
- Produces: `MonthlyHealthContext { health; status; age; isYearStart; pregnancyMonthlyCost; seedKey }`；`MonthlyHealthOutcome { previousHealth; nextHealth; previousStatus; nextStatus; died; deathCause? }`；`projectMonthlyHealth(ctx)`；`monthlyIllnessRate(health,age)`。

- [ ] **Step 1: failing test (precise branches)**

```ts
// tests/store/healthTick.test.ts
import { describe, expect, it } from "vitest";
import { projectMonthlyHealth, monthlyIllnessRate } from "../../src/store/healthTick";
const base = { age: 20, isYearStart: false, pregnancyMonthlyCost: false } as const;

describe("monthlyIllnessRate", () => {
  it("young healthy ≈ 0.426% (not 1%)", () => {
    const r = monthlyIllnessRate(100, 20);
    expect(r).toBeGreaterThan(0.004); expect(r).toBeLessThan(0.005);
  });
});
describe("projectMonthlyHealth branches", () => {
  it("year-start age≥35 applies decay; non-year-start does not", () => {
    expect(projectMonthlyHealth({ ...base, age: 45, isYearStart: true, health: 80, status: "healthy", seedKey: "d" }).nextHealth).toBe(78); // −2
    expect(projectMonthlyHealth({ ...base, age: 45, isYearStart: false, health: 80, status: "healthy", seedKey: "d" }).nextHealth).toBe(80);
  });
  it("sick damage in 1..2", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "sick", seedKey: "s" });
    expect(50 - o.nextHealth).toBeGreaterThanOrEqual(1); expect(50 - o.nextHealth).toBeLessThanOrEqual(2);
  });
  it("critical damage in 3..5", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "critical", seedKey: "c" });
    expect(50 - o.nextHealth).toBeGreaterThanOrEqual(3); expect(50 - o.nextHealth).toBeLessThanOrEqual(5);
  });
  it("critical sudden death: health stays >0 but dies (seed baked to hit the 5% roll) — UNCONDITIONAL", () => {
    const o = projectMonthlyHealth({ ...base, age: 70, health: 70, status: "critical", seedKey: "SEED_SUDDEN" });
    expect(o.died).toBe(true);                 // no `if` — the baked seed MUST hit
    expect(o.nextHealth).toBeGreaterThan(0);   // 70 − (3..5) > 0
    expect(o.deathCause).toBe("critical_sudden");
  });
  it("health hitting 0 → died illness, no further transition", () => {
    const o = projectMonthlyHealth({ ...base, health: 2, status: "critical", seedKey: "x" });
    expect(o.nextHealth).toBe(0); expect(o.died).toBe(true); expect(o.deathCause).toBe("illness");
  });
  it("newly-sick this month takes NO damage (healthy→sick onset, nextHealth unchanged) — UNCONDITIONAL", () => {
    const o = projectMonthlyHealth({ ...base, age: 60, health: 20, status: "healthy", seedKey: "SEED_ONSET" });
    expect(o.nextStatus).toBe("sick");         // baked seed MUST hit onset
    expect(o.nextHealth).toBe(20);             // no 病损 the month of onset
  });
  it("sick single mutually-exclusive transition lands in exactly one bucket", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "sick", seedKey: "t" });
    expect(["sick","critical","healthy"]).toContain(o.nextStatus);
  });
});
```

> **#5 — no conditional asserts.** `SEED_SUDDEN` and `SEED_ONSET` MUST be chosen so the assert always fires: during RED→GREEN add a throwaway scratch test that loops candidate seeds and logs `healthRoll(`${k}:sudden`)` (need `<5`) / `healthRollBasisPoints(`${k}:onset`)` (need `< monthlyIllnessRate(h,60)*10000`), pick passing seeds, **bake them in and assert unconditionally**, then delete the scratch. A seed that doesn't hit is a test bug, not an `if`.

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement `projectMonthlyHealth`** (`src/store/healthTick.ts`)

```ts
/** 纯月度健康投影（设计 §3.3）。顺序：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移。 */
import { healthRoll, healthRollRange, healthRollBasisPoints } from "../engine/characters/healthRoll";
import { ageOver35 } from "../engine/characters/aging";
import type { DeathCause, HealthStatus } from "../engine/state/types";

export interface MonthlyHealthContext { health: number; status: HealthStatus; age: number; isYearStart: boolean; pregnancyMonthlyCost: boolean; seedKey: string; }
export interface MonthlyHealthOutcome { previousHealth: number; nextHealth: number; previousStatus: HealthStatus; nextStatus: HealthStatus; died: boolean; deathCause?: DeathCause; }

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

export function monthlyIllnessRate(health: number, age: number): number {
  const annual = Math.min(60, Math.max(5, 5 + Math.round((100 - health) * 0.4) + ageOver35(age)));
  return 1 - Math.pow(1 - annual / 100, 1 / 12);
}

export function projectMonthlyHealth(ctx: MonthlyHealthContext): MonthlyHealthOutcome {
  const previousHealth = ctx.health, previousStatus = ctx.status, k = ctx.seedKey;
  let h = ctx.health, status = ctx.status;
  if (ctx.pregnancyMonthlyCost) h -= healthRollRange(`${k}:preg`, 0, 5);
  if (ctx.isYearStart && ctx.age >= 35) h -= 1 + Math.floor(ageOver35(ctx.age) / 10);
  if (previousStatus === "sick") h -= healthRollRange(`${k}:sickdmg`, 1, 2);
  else if (previousStatus === "critical") h -= healthRollRange(`${k}:critdmg`, 3, 5);
  h = clampPct(h);
  if (h <= 0) return { previousHealth, nextHealth: 0, previousStatus, nextStatus: status, died: true, deathCause: "illness" };
  if (previousStatus === "critical" && healthRoll(`${k}:sudden`) < 5)
    return { previousHealth, nextHealth: h, previousStatus, nextStatus: status, died: true, deathCause: "critical_sudden" };
  if (previousStatus === "healthy") {
    // #10 — onset uses POST-decay/POST-cost health `h` (consistent with step order), not the month-start ctx.health
    if (healthRollBasisPoints(`${k}:onset`) < monthlyIllnessRate(h, ctx.age) * 10000) status = "sick";
  } else if (previousStatus === "sick") {
    const criticalRate = Math.min(30, Math.max(1, 1 + ageOver35(ctx.age)));
    const r = healthRoll(`${k}:transition`);
    if (r < criticalRate) status = "critical";
    else if (r < criticalRate + 50) status = "healthy";
  }
  return { previousHealth, nextHealth: h, previousStatus, nextStatus: status, died: false };
}
```

- [ ] **Step 4: run → PASS** (tune the two baked seeds). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/healthTick.ts tests/store/healthTick.test.ts
git commit -m "feat: projectMonthlyHealth 纯月度投影（高精度 onset + 互斥迁移 + 暴毙）"
```

---

### Task 4: `buildMonthlyHealthTick` orchestrator（currentAgeOf/livingConsortIds + forceDeath + 皇帝即止）

**Files:**
- Modify: `src/store/healthTick.ts`（加 `buildMonthlyHealthTick`）
- Test: `tests/store/healthTickOrchestrator.test.ts`

**Interfaces:**
- Consumes: `projectMonthlyHealth`、`planHealthChange`（forceDeath）、`currentAgeOf`、`livingConsortIds`。
- Produces: `MonthlyTickResult { effects: EventEffect[]; sovereignDied: boolean; aftermathDeaths: { kind:"taihou"|"consort"|"heir"; subjectId:string }[] }`；`buildMonthlyHealthTick(db, state)`。

- [ ] **Step 1: failing test**

```ts
// tests/store/healthTickOrchestrator.test.ts
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";

describe("buildMonthlyHealthTick", () => {
  it("deterministic; healthy young start → no deaths; effects apply ok", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const a = buildMonthlyHealthTick(db, s);
    expect(a.sovereignDied).toBe(false); expect(a.aftermathDeaths).toEqual([]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(buildMonthlyHealthTick(db, s)));
    expect(applyEffects(db, s, a.effects).ok).toBe(true);
  });
  it("sovereign death stops the sweep: no other aftermath that month", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.resources.sovereign.health = 1; s.resources.sovereign.healthStatus = "critical";
    const id = Object.keys(s.standing).find((c) => db.characters[c]?.kind === "consort")!;
    s.standing[id]!.health = 1; s.standing[id]!.healthStatus = "critical";
    const r = buildMonthlyHealthTick(db, s);
    expect(r.sovereignDied).toBe(true);
    expect(r.aftermathDeaths).toEqual([]); // sweep stopped after sovereign
  });
  it("critical consort with health 1 dies + enqueued", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const id = Object.keys(s.standing).find((c) => db.characters[c]?.kind === "consort")!;
    s.standing[id]!.health = 1; s.standing[id]!.healthStatus = "critical";
    const r = buildMonthlyHealthTick(db, s);
    expect(r.aftermathDeaths.some((d) => d.kind === "consort" && d.subjectId === id)).toBe(true);
    const ap = applyEffects(db, s, r.effects);
    if (ap.ok) { expect(ap.value.standing[id]!.lifecycle).toBe("deceased"); expect(ap.value.pendingAftermath.some((p) => p.subjectId === id)).toBe(true); }
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** (append to `src/store/healthTick.ts`)

```ts
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import { toGameTime } from "../engine/calendar/time";
import { planHealthChange, type HealthSubject } from "./health";
import { currentAgeOf, livingConsortIds } from "./healthRoster";

export interface MonthlyTickResult { effects: EventEffect[]; sovereignDied: boolean; aftermathDeaths: { kind: "taihou"|"consort"|"heir"; subjectId: string }[]; }

export function buildMonthlyHealthTick(db: ContentDB, state: GameState): MonthlyTickResult {
  const { year, month, period } = state.calendar;
  const isYearStart = month === 1 && period === "early";
  const at = toGameTime(state.calendar);
  const effects: EventEffect[] = [];
  const aftermathDeaths: MonthlyTickResult["aftermathDeaths"] = [];
  let sovereignDied = false;

  const run = (subject: HealthSubject, subjectId: string): boolean => {
    const cur =
      subject.kind === "sovereign" ? { health: state.resources.sovereign.health, status: state.resources.sovereign.healthStatus }
      : subject.kind === "taihou" ? { health: state.taihou.health, status: state.taihou.healthStatus }
      : subject.kind === "consort" ? { health: state.standing[subjectId]?.health ?? 100, status: state.standing[subjectId]?.healthStatus ?? "healthy" }
      : (() => { const h = state.resources.bloodline.heirs.find((x) => x.id === subjectId)!; return { health: h.health, status: h.healthStatus ?? "healthy" }; })();
    const out = projectMonthlyHealth({ health: cur.health, status: cur.status, age: currentAgeOf(db, state, subject), isYearStart, pregnancyMonthlyCost: false, seedKey: `tick:${state.rngSeed}:${subjectId}:${year}:${month}` });
    if (out.nextHealth === out.previousHealth && out.nextStatus === out.previousStatus && !out.died) return false;
    const plan = planHealthChange(state, {
      subject,
      ...(out.nextHealth !== out.previousHealth ? { healthDelta: out.nextHealth - out.previousHealth } : {}),
      ...(out.nextStatus !== out.previousStatus ? { healthStatus: out.nextStatus } : {}),
      ...(out.died && out.nextHealth > 0 ? { forceDeath: true } : {}),
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...plan.effects);
    if (plan.outcome.sovereignDied) { sovereignDied = true; return true; }
    if (plan.outcome.died && subject.kind !== "sovereign") aftermathDeaths.push({ kind: subject.kind, subjectId });
    return false;
  };

  // 皇帝最先；死则即止（同月不再生成其他死亡）
  if (run({ kind: "sovereign" }, "sovereign")) return { effects, sovereignDied, aftermathDeaths: [] };
  if (!state.taihou.deceased) run({ kind: "taihou" }, "taihou");
  for (const id of livingConsortIds(db, state)) run({ kind: "consort", id }, id);
  for (const id of state.resources.bloodline.heirs.filter((h) => h.lifecycle !== "deceased").map((h) => h.id).sort())
    run({ kind: "heir", id }, id);

  return { effects, sovereignDied, aftermathDeaths };
}
```

> 注：皇帝死即 `return { ..., aftermathDeaths: [] }` —— 同月其他角色当月不结算（状态层与「皇帝最高优先级」一致，非仅 UI）。

- [ ] **Step 4: run → PASS;** `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/healthTick.ts tests/store/healthTickOrchestrator.test.ts
git commit -m "feat: buildMonthlyHealthTick（currentAgeOf/livingConsortIds + forceDeath + 皇帝死即止）"
```

---

### Task 5: `GameStore.advanceTime` 统一时间入口（跨月触发 tick）+ 全 UI 改走该入口

**Files:**
- Modify: `src/store/gameStore.ts`（加 `resolveTimedAction` + `advanceTime`，纯函数组合、单次提交、失败回滚）
- Modify: `src/ui/App.tsx`（**审计全部** `spendAp`/`SPEND_AP`/`SKIP_REMAINDER` 调用点；行动+时间走 `resolveTimedAction`，纯时间走 `advanceTime`）
- Test: `tests/store/advanceTime.test.ts`、`tests/store/resolveTimedAction.test.ts`

**Interfaces:**
- Consumes: `buildMonthlyHealthTick`、纯 reducer `applyCommand`（`src/engine/state/reducer.ts`）、纯 funnel `applyEffects`。
- Produces:
  - `GameStore.resolveTimedAction(db, actionEffects: readonly EventEffect[], command): Result<TimedOutcome, GameError[]>`
  - `GameStore.advanceTime(db, command): Result<TimedOutcome, GameError[]>`（= `resolveTimedAction(db, [], command)`）
  - `TimedOutcome = { rolledOver: boolean; monthChanged: boolean; healthOutcome: MonthlyTickResult | null }`
  - `command: { type:"SPEND_AP"; amount:number } | { type:"SKIP_REMAINDER" }`

> **真正原子（#1/#2/#3）**：不调用会立即 `commit()+emit()` 的 `this.dispatch()`；改在**局部候选 state** 上用纯函数组合「行动效果 → 推进日历 → 跨月健康 tick → 皇帝死写 gameOver」，**全部成功才一次性 `this.state=candidate; this.emit()`；任一步失败则 `return err`、`this.state` 完全不动**（杜绝「日历已跨月但健康未结算仍返回 ok」「跨月先刷新 UI 再算健康」「健康更新后未 emit」）。
> **行动先于时间（#3）**：`actionEffects`（玩家所选行动，如召见皇嗣 +宠爱）在**推进时间之前**应用到候选 state——保证行动结算在「死者尚存活」时发生；随后时间推进、跨月 tick。这样不会出现「跨月 tick 杀死皇嗣 → 之后再给该皇嗣加宠爱/教育」。
> **gameOver 在事务内（#2）**：皇帝死亡时由本方法在候选 state 上写 `gameOver`，与健康 effects 同批提交；App 只做表现层（清场/落盘/回 title），**不**事后 `markGameOver`。

- [ ] **Step 1: failing test**

```ts
// tests/store/advanceTime.test.ts
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
import { monthOrdinal } from "../../src/engine/calendar/time";

// GameStore constructor takes OPTIONS, not a state. Use newGame/loadState.
function freshStore() { const db = loadTestContent(); const store = new GameStore(); store.newGame(db); return { db, store }; }

describe("advanceTime monthly tick", () => {
  it("within a month does NOT run the tick (monthChanged false)", () => {
    const { db, store } = freshStore(); // year1 month1 early
    const before = monthOrdinal(store.getState().calendar);
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    if (r.ok && monthOrdinal(store.getState().calendar) === before) expect(r.value.monthChanged).toBe(false);
  });
  it("crossing into a new month runs the tick exactly once (monthChanged true, healthOutcome set)", () => {
    const { db, store } = freshStore();
    let crossed = false;
    for (let i = 0; i < 6 && !crossed; i++) {
      const before = monthOrdinal(store.getState().calendar);
      const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
      expect(r.ok).toBe(true);
      if (r.ok && monthOrdinal(store.getState().calendar) !== before) { expect(r.value.monthChanged).toBe(true); expect(r.value.healthOutcome).not.toBeNull(); crossed = true; }
    }
    expect(crossed).toBe(true);
  });
  it("reload at the already-advanced calendar does NOT re-run for that month", () => {
    const { db, store } = freshStore();
    let cal; do { store.advanceTime(db, { type: "SKIP_REMAINDER" }); cal = store.getState().calendar; } while (cal.month === 1 && cal.period !== "early");
    const saved = store.getState();
    const reloaded = new GameStore(); reloaded.loadState(saved); // simulates load
    const before = monthOrdinal(reloaded.getState().calendar);
    const r = reloaded.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    if (r.ok && monthOrdinal(reloaded.getState().calendar) === before) expect(r.value.monthChanged).toBe(false);
  });
  it("atomic rollback: if the health tick fails, calendar does NOT advance and state is unchanged", () => {
    const { db, store } = freshStore();
    // Force a tick failure by corrupting a heir so currentAgeOf throws (no birthAt) — see Task 2/8.
    // (If hard to force in this test, instead unit-test the atomicity at the GameStore level by stubbing
    //  buildMonthlyHealthTick to throw; assert store.getState() === prior reference and result.ok === false.)
    const prior = store.getState();
    // drive to the last 旬 before month change so the next SKIP_REMAINDER would cross:
    while (store.getState().calendar.period !== "late") store.advanceTime(db, { type: "SKIP_REMAINDER" });
    // (Implementer: inject a failure path per the note above and assert no advance + result not ok.)
    expect(store.getState().calendar.month).toBe(1);
    void prior;
  });
});
```

> Constructor is `new GameStore(options?)` then `newGame(db)` / `loadState(state)`. The atomicity test's failure injection: easiest is to give the orchestrator an unresolvable subject (a heir missing `birthAt`) so `currentAgeOf` throws (Task 2/8 makes it throw, not fall back) — then `advanceTime` must `return err` with `this.state` byte-identical to before. If injecting that in a black-box store test is awkward, assert atomicity directly: temporarily monkeypatch the imported `buildMonthlyHealthTick` to throw and assert `result.ok === false` and `store.getState() === prior` (reference equality).

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: add atomic `resolveTimedAction` + `advanceTime` to `GameStore`**

Import the pure `applyCommand` (`../engine/state/reducer`), `monthOrdinal`/`toGameTime` (`../engine/calendar/time`), `buildMonthlyHealthTick` (`./healthTick`); `applyEffects` (pure funnel) is already imported. Use the file's `ok`/`err`/`stateError` helpers.

```ts
  resolveTimedAction(db: ContentDB, actionEffects: readonly EventEffect[], command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" }) {
    // 1) action effects on a local candidate (subject still alive)
    let candidate = this.state;
    if (actionEffects.length) {
      const a = applyEffects(db, candidate, actionEffects);
      if (!a.ok) return err(a.error);
      candidate = a.value;
    }
    // 2) advance calendar (pure)
    const before = monthOrdinal(candidate.calendar);
    const cmd = applyCommand(candidate, command);
    if (!cmd.ok) return cmd;
    candidate = cmd.value.state;
    const monthChanged = monthOrdinal(candidate.calendar) !== before;
    // 3) cross-month health tick (atomic; tick may throw on unresolvable subject → reject whole tx)
    let healthOutcome: ReturnType<typeof buildMonthlyHealthTick> | null = null;
    if (monthChanged) {
      try { healthOutcome = buildMonthlyHealthTick(db, candidate); }
      catch (e) { return err([stateError("HEALTH_TICK_FAILED", String(e))]); }
      const h = applyEffects(db, candidate, healthOutcome.effects);
      if (!h.ok) return err(h.error);
      candidate = h.value;
      // 4) emperor death → gameOver in the SAME transaction
      if (healthOutcome.sovereignDied) candidate = { ...candidate, gameOver: { cause: "sovereign_death", at: toGameTime(candidate.calendar) } };
    }
    // single commit + single notify (only after everything succeeded)
    this.state = candidate;
    this.emit();
    return ok({ rolledOver: cmd.value.rolledOver, monthChanged, healthOutcome });
  }

  advanceTime(db: ContentDB, command: { type: "SPEND_AP"; amount: number } | { type: "SKIP_REMAINDER" }) {
    return this.resolveTimedAction(db, [], command);
  }
```
(`this.emit()` is the existing private notifier — confirm its name. `err`/`stateError` per the file's conventions.)

- [ ] **Step 4: route ALL time-advancing handlers through the unified entry (audit, not just 3 sites)**

Grep `App.tsx` for every `spendAp(`, `dispatch({ type: "SPEND_AP"`, `dispatch({ type: "SKIP_REMAINDER"`. For each, classify and convert:
- **Action-then-time handlers** (apply subject-specific effects then spend AP) → `store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount })` so the action settles **before** time advances (prevents favoring/educating/adopting a heir that the cross-month tick just killed). Known cases to convert: `summonHeir`, `heirLesson`, `adoptHeir` (drop its direct `SPEND_AP`+`heir_adopt` pair into one `resolveTimedAction(db, [heir_adopt...], {SPEND_AP,1})`). Verify `reviewMemorials`/`templeAction`/`converse`/bedchamber handlers and convert any that apply effects post-spend.
- **Time-only handlers** → `store.advanceTime(db, command)`: `restAlone` (`SKIP_REMAINDER`), and `spendAp(amount)` itself (the AP-only spend; its 懿旨/敲打/进贡 beat rolls still run on the returned `rolledOver` as before).
- After conversion, **no UI code may directly `dispatch` `SPEND_AP`/`SKIP_REMAINDER`** — assert by grep.
- Thread the returned `healthOutcome` to the caller. The sovereign-death **presentation** (clear UI, autosave, `setView("title")`) is centralized in Task 6; for this task add the minimal `if (res.ok && res.value.healthOutcome?.sovereignDied) { setView("title"); return; }` at each converted settle point so the build is coherent (Task 6 centralizes + hardens with the gameOver-aware title gate). **Do not** write `gameOver` from App — it is already set inside `resolveTimedAction`.

- [ ] **Step 5: tsc + full suite + manual**

`npx tsc --noEmit` clean; `npx vitest run` green. Manual: advance旬内不结算；跨月结算一次。

- [ ] **Step 6: Commit**

Add a `resolveTimedAction` test asserting action-before-time ordering: an action effect on a heir + a `SPEND_AP` that crosses month where the heir would die in the tick — assert the action effect applied (heir got it while alive) and the heir then died, in one commit, single resulting state.

```bash
git add src/store/gameStore.ts src/ui/App.tsx tests/store/advanceTime.test.ts tests/store/resolveTimedAction.test.ts
git commit -m "feat: GameStore.resolveTimedAction/advanceTime 原子时间事务（单次提交/失败回滚 + gameOver 同事务 + 行动先于时间）"
```

---

### Task 6: 皇帝死亡终局 + 移除太后侍疾免费治愈 + 死者入口 gating

**Files:**
- Modify: `src/engine/state/types.ts` + `src/engine/save/stateSchema.ts`（`GameState.gameOver?`）
- Modify: `src/store/taihou.ts`（`buildShizhiEncounter` 去治愈 effect；侍疾+敲打加 `taihou.deceased` 守卫）
- Modify: `src/engine/characters/presence.ts`（场景集合 `getPresentAt`/`presentAt`/`absentAt` 过滤已故）
- Modify: `src/ui/App.tsx`（皇帝死表现层 + 不可继续；慈宁宫死亡锁；清死者视图）
- Create: `src/engine/featureFlags.ts`（`FEATURE_AFTERMATH_UI=false`）
- Test: `tests/store/sovereignDeath.test.ts`、`tests/store/taihouShizhiNoHeal.test.ts`、`tests/store/gameOverGate.test.ts`、`tests/characters/presenceDeceased.test.ts`

**Interfaces:**
- Produces: `GameState.gameOver?: { cause: "sovereign_death"; at: GameTime }`；title「继续」在 `gameOver` 时禁用。

- [ ] **Step 1: failing tests**

```ts
// tests/store/taihouShizhiNoHeal.test.ts
import { describe, expect, it } from "vitest";
import { buildShizhiEncounter, buildTaihouRebuke } from "../../src/store/taihou";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
describe("侍疾 / 敲打 与太后死亡", () => {
  it("侍疾 produces an encounter but NO heal effect — UNCONDITIONAL", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.taihou.healthStatus = "critical"; s.taihou.health = 30;
    // bake a seedKey known to pass the 50% gate AND pick a present consort (scratch-loop to find, then bake):
    const plan = buildShizhiEncounter(db, s, "SEED_SHIZHI_HIT");
    expect(plan).not.toBeNull();                                   // #5 — guard against vacuous pass
    expect(plan!.effects.some((e) => e.type === "set_taihou_health")).toBe(false); // no free cure
  });
  it("侍疾 returns null when 太后 is deceased (#6)", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.taihou.deceased = true; s.taihou.healthStatus = "critical";
    expect(buildShizhiEncounter(db, s, "SEED_SHIZHI_HIT")).toBeNull();
  });
  it("敲打 returns null when 太后 is deceased (#6)", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.taihou.deceased = true;
    expect(buildTaihouRebuke(db, s, "any:seed")).toBeNull();
  });
});
```

```ts
// tests/store/sovereignDeath.test.ts
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
describe("sovereign death", () => {
  it("flags sovereignDied, never enqueues sovereign aftermath", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.resources.sovereign.health = 1; s.resources.sovereign.healthStatus = "critical";
    const r = buildMonthlyHealthTick(db, s);
    expect(r.sovereignDied).toBe(true);
    expect(r.aftermathDeaths.length).toBe(0);
  });
});
```

```ts
// tests/store/gameOverGate.test.ts — gameOver round-trips through save schema
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadTestContent } from "../helpers/loadTestContent";
import { toGameTime } from "../../src/engine/calendar/time";
describe("gameOver state", () => {
  it("parses with gameOver set", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    s.gameOver = { cause: "sovereign_death", at: toGameTime(s.calendar) };
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: `gameOver` type + schema**

`types.ts` `GameState`: add `gameOver?: { cause: "sovereign_death"; at: GameTime };`.
`stateSchema.ts` `gameStateSchema`: add `gameOver: z.strictObject({ cause: z.literal("sovereign_death"), at: gameTimeSchema }).optional(),`.

- [ ] **Step 4: featureFlags**

`src/engine/featureFlags.ts`:
```ts
/** Phase 2: 非皇帝身后事 UI（追封/谥号/葬仪）未实现，统一关闭，留 Phase 4。 */
export const FEATURE_AFTERMATH_UI = false;
```

- [ ] **Step 5: 太后病情逻辑（去侍疾治愈 + 死后不再侍疾/敲打）** (`taihou.ts`)

- `buildShizhiEncounter`：移除 `{ type: "set_taihou_health", healthStatus: "healthy" }`（保留 favor + memory + beats）。
- `buildShizhiEncounter` **与** `buildTaihouRebuke` 开头都加 `if (state.taihou.deceased) return null;`（#6 — 死后不应触发侍疾/敲打，现有仅按病情门控，未识别死亡）。
- 太后病情自此只由 §3 tick / (Phase 3) 太医改变。

- [ ] **Step 5b: 场景人物集合过滤已故（#7）** (`src/engine/characters/presence.ts`)

死者不得出现在宫殿场景。`consortLocationAt` 对已故侍君仍返回住处、`presentAt`/`getPresentAt`/`absentAt` 仍按地点纳入。在**场景角色集合**层显式过滤：在 `getPresentAt` / `presentAt` / `absentAt` 的角色筛选里加 `state.standing[c.id]?.lifecycle !== "deceased"`（与翻牌/对话列表分开，这是场景级）。加**场景级测试** `tests/characters/presenceDeceased.test.ts`：某侍君 `lifecycle="deceased"` → 不出现在其住处的 `getPresentAt`/`presentAt`，也不在 `absentAt`。

- [ ] **Step 6: 皇帝终局表现 + 慈宁宫锁 + 死者视图清理** (`App.tsx`)

> `gameOver` 已由 `resolveTimedAction` 在事务内写入（Task 5，#2）——App **不**再 `markGameOver`，只做表现层。
- 皇帝死：在消费 `healthOutcome` 的统一 settle 处，若 `res.value.healthOutcome?.sovereignDied`：清空对话/反应/弹窗，`doAutosave()`（落盘的已是 `gameOver` 局），`setView("title")`，short-circuit 后续 settle。
- title 「继续」：`continueGame` 载入后若 `store.getState().gameOver` → 不进入游戏，回 title 显示「先帝已崩，请开新局」；`canContinue` 的可用性判断在载入后增加 `&& !gameOver`（最简：`continueGame` 内 load 后检测 gameOver 即回退并提示，不进入 game 视图）。
- 慈宁宫锁：进入 `cining_gong` 前若 `state.taihou.deceased` → 不进入，提示「太后已驾鹤西去」；`maybeShizhi` 在 `taihou.deceased` 时直接返回 false。
- 死者视图清理：若 `summonedConsortId` 指向 `lifecycle==="deceased"` 的侍君，置 null；翻牌/对话/赏赐/太医(Phase3)/召见/教育的人选集合用 `livingConsortIds` / `lifecycle!=="deceased"` 过滤（补齐 Phase 1 遗漏处）。

- [ ] **Step 7: tsc + full suite + manual**

`npx tsc --noEmit` clean；`npx vitest run` green。Manual：皇帝 0 血跨月 → 回 title 且「继续」被禁；太后死 → 慈宁宫锁；太后重病时进慈宁宫不再痊愈。

- [ ] **Step 8: Commit**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/store/taihou.ts src/engine/characters/presence.ts src/ui/App.tsx src/engine/featureFlags.ts tests/store/sovereignDeath.test.ts tests/store/taihouShizhiNoHeal.test.ts tests/store/gameOverGate.test.ts tests/characters/presenceDeceased.test.ts
git commit -m "feat: 皇帝死亡终局(gameOver 不可继续，事务内写入) + 侍疾不再治愈/死后不触发 + 敲打死后不触发 + 场景过滤已故 + 慈宁宫锁"
```

---

## Phase 2 完成验收

- [ ] `npx tsc --noEmit` 全绿；`npx vitest run` 全绿。
- [ ] 仅「跨月」结算月度 tick：早→中、中→晚不跑；晚→次月早跑一次；读档不重复。
- [ ] 所有时间推进（含 restAlone/adoptHeir）经 `advanceTime`。
- [ ] 暴毙（health>0）经 forceDeath 真死、入队。
- [ ] onset 命中率符合年化换算（高精度随机，非整数放大）。
- [ ] 动态选秀侍君参与 tick、年龄按入宫年增长；未入宫静态侍君不参与。
- [ ] 皇帝死 → 持久化 gameOver、回 title、不可继续；同月不处理其他死亡。
- [ ] 病亡承孕侍君自动断胎。
- [ ] 侍疾不再治愈太后；太后死 → 慈宁宫锁；死者不出现在对话/翻牌/赏赐/召见/教育。

## Self-Review notes

### v2.1 修订（第二轮 10 项实现级审查）

执行前必修（1–5）+ 一并纳入（6–10）：
1. **`advanceTime` 真正原子**：不调 `this.dispatch()`（会即时 commit/emit）；在局部候选 state 上纯函数组合，**全成功才单次提交 + 单次 emit；任一步失败 `return err`、state 不动**（Task5 Step3）。
2. **`gameOver` 事务内写入**：皇帝死由 `resolveTimedAction` 在候选 state 上写 `gameOver`，与健康 effects 同批提交；App 只表现（Task5/Task6）。
3. **行动先于时间**：`resolveTimedAction(actionEffects, command)` 先应用行动效果（死者尚活），再推进+tick；审计**全部** `spendAp`/`SPEND_AP`/`SKIP_REMAINDER` 调用点（summonHeir/heirLesson/adoptHeir…）（Task5 Step4）。
4. **已故角色重复结算不再入队**：`planHealthChange` 顶部 `isDeceased` 守卫 → 空效果 no-op（不同 dayIndex 也不会生成第二条 aftermath）（Task1 Step6）。
5. **seed 分支测试改无条件断言**：`SEED_SUDDEN`/`SEED_ONSET`/`SEED_SHIZHI_HIT` 烘焙命中，删除 `if(o.died)`/`if(plan)` 式 vacuous pass；侍疾测试先 `expect(plan).not.toBeNull()`（Task3/Task6）。
6. **太后死后不触发敲打**：`buildTaihouRebuke` + `buildShizhiEncounter` 均加 `if (taihou.deceased) return null`（Task6 Step5）。
7. **场景集合过滤已故**：`getPresentAt`/`presentAt`/`absentAt` 加 `lifecycle !== "deceased"` + 场景级测试（Task6 Step5b）。
8. **`currentAgeOf` 解析失败抛错**（不静默回退 20 岁）；tick 遇坏状态由 `resolveTimedAction` try/catch → 整次拒绝 + 诊断（Task2/Task5）。
9. **heir 效果 target 守卫**：`set_heir_health`（存活）、`heir_decease`（存在；已死幂等）、`set_consort_posthumous`（须 consort+已故+deathRecord）（Task1 Step5）。
10. **onset 用衰老后 health `h`**：`monthlyIllnessRate(h, age)`，与投影顺序一致（Task3）。

### 第一轮 9 项（已在 v2 吸收）
①forceDeath（Task1/3/4）②跨月日历判定取代 ref（Task5）③统一时间入口（Task5）④healthRollBasisPoints（Task2/3）⑤动态侍君 + livingConsortIds + currentAgeOf（Task2/4）⑥皇帝 gameOver + 皇帝死即止（Task4/6）⑦移除侍疾治愈（Task6）⑧太后死锁慈宁宫 + 死者 gating（Task6）⑨consort 强 target 守卫（Task1）。
- 测试替换：删除「假幂等」测试，改为跨月触发矩阵（早/中/晚/读档/SKIP_REMAINDER）+ projectMonthlyHealth 精确分支 + 动态角色 + 终局。
- Spec 覆盖：§1.4（uncapped + 即时死亡 + forceDeath）、§3（tick）、§6.1（终局）、§6.5（断胎）、§7（队列+优先级+皇帝即止）、§8 的死者最低 gating（慈宁宫/死者列表，余下服丧/重病 gating 留 Phase 3）。
- 未决（Phase 3/4）：怀孕成本接线（§5）、重病/服丧上朝/侍寝 gating（§8）、太医（§4）、身后事 UI/追封/谥号/葬仪（§6.2-6.4）、奉先殿（§10）。`FEATURE_AFTERMATH_UI` Phase 4 打开。
- 顺序依赖：Task1→2→3→4→5→6 线性；Task5 的 sovereign game-over 最小接线在 Task6 收口。
