# 健康系统 Phase 2（统一月度 tick + 基础死亡 + 事件队列）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通 Phase 1 落地的健康基础设施：每月对全体角色跑 `projectMonthlyHealth` + `planHealthChange` 结算（衰老/生病/恶化/痊愈/暴毙），health≤0 或暴毙即死亡并标记 + 入身后事队列；皇帝死亡 → game-over 回主菜单；承孕侍君死亡时自动断胎（怀孕成本接线留 Phase 3）。

**Architecture:** 纯逻辑（`projectMonthlyHealth`）→ 月度 orchestrator（遍历角色产出 effects + 死亡）→ App rollover 接线（按 `year:month` 幂等）。所有健康变更经 Phase 1 的 `planHealthChange`。非皇帝身后事 UI 由 feature flag 关闭（死亡正常标记/入队，aftermath 保持未 resolved，留 Phase 4）。**避免 health=0 仍存活的中间版本。**

**Tech Stack:** TypeScript、Zod、React、Vitest。确定性随机 `healthRoll`（Phase 1）。年龄 `aging`（Phase 1）。

## Global Constraints

- 数值 health 0–100；`HealthStatus = "healthy"|"sick"|"critical"` 独立存储。
- 年化→月度生病：`annualRate = clamp(5 + round((100−health)*0.4) + max(0,age−35), 5, 60)`；`monthlyRate = 1 − (1 − annualRate/100)^(1/12)`。仅对 `healthy` 掷 onset。
- 生病每月 −rand(1,2)；重病每月 −rand(3,5)。**本月之前已处于**该状态者才扣病损；本月刚转生病者本月不扣病损/不恶化。
- 互斥迁移（生病，单次 r∈[0,100)）：`criticalRate = clamp(1 + max(0,age−35), 1, 30)`；`r<criticalRate`→重病；否则 `r<criticalRate+50`→痊愈；否则维持生病。**不可先判痊愈再判重病。**
- 重病每月 5% 暴毙；重病不自动痊愈。
- 年龄自然衰老（仅年初 `month===1` 上旬、`age≥35`）：`decay = 1 + floor(max(0,age−35)/10)`。新游戏元年一月初始化不扣衰老。
- **怀孕成本属 Phase 3**（spec §11）：本 Phase 2 的 tick 只做衰老 + 病情，**不施加怀孕成本**。`projectMonthlyHealth` 保留 `pregnancyMonthlyCost` 入参（单测覆盖），但 Phase 2 的 orchestrator 一律传 `false`；Phase 3 再接 carrier 检测与转胎/生产一次性成本。
- **断胎归因于死亡**（§6.5，Phase 2 必须）：`consort_decease` 效果应**自动清除该侍君正在承的 gestation**——这样任何死亡路径（本 phase 的病亡、Phase 3 的转胎/孕期/生产）都自动断胎；已生产者无活动 gestation，故「已产→皇嗣存活」天然成立。
- 月度结算顺序（每角色，本地投影）：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移；迁移放最后。
- 死亡：health≤0 或重病暴毙。皇帝死亡 → `sovereignDied`，**不入队**，最高优先 → game-over 回主菜单。其余 → `enqueue_aftermath`（稳定 id `death:{kind}:{subjectId}:{dayIndex}`，幂等）。
- 同月多死优先级：皇帝→太后→侍君(按 id 字典序)→皇嗣(按 id)。
- tick 幂等：按 `year:month` 去重，月初一次；读档/多次 rollover 不重复。
- 不复用 `gestationRoll`；用 `healthRoll`，seedKey 含 rngSeed + year:month + charId + 用途，**不含 period/ap**。
- 承养人死亡（§6.5）：转胎后未产→断胎（清 gestation）；已产→皇嗣存活。
- 非皇帝身后事 UI 由 feature flag `FEATURE_AFTERMATH_UI`（默认 false）关闭；本阶段死亡只标记 + 入队，不弹追封/谥号 UI（Phase 4）。
- 测试位于 `tests/**/*.test.ts`（mirror 源码 `engine/` 后子路径；`src/store/X` → `tests/store/X`）。
- 命令：`npx vitest run <file>`；`npx tsc --noEmit`。当前基线全套件 794 绿。

---

### Task 1: carry-forward funnel 修复（uncapped sovereign + target 守卫 + inert guard + consort_decease 断胎）

**Files:**
- Modify: `src/engine/content/schemas.ts`（`eventEffectSchema` 增 `set_sovereign_health`）
- Modify: `src/engine/effects/funnel.ts`（`set_sovereign_health` 处理 case；`validateEffects` 为 consort 三效果加 target 守卫；`consort_decease` 处理 case 内自动清该侍君 gestation）
- Modify: `src/store/health.ts`（sovereign 走 `set_sovereign_health`；去 `clampDelta`；inert-effect 守卫）
- Test: `tests/effects/funnelSovereignHealth.test.ts`、扩展 `tests/store/health.test.ts`、扩展 `tests/effects/funnel-health.test.ts`（断胎）

**Interfaces:**
- Produces: 效果 `set_sovereign_health { type:"set_sovereign_health"; healthStatus?: HealthStatus; healthDelta?: number }`（clamp 0–100，可设 `sovereign.healthStatus`）；`consort_decease` 副作用扩展：清除 `bloodline.gestations` 中 `carrier===char` 的胎（断胎）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/effects/funnelSovereignHealth.test.ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
// match the content-load helper used by tests/effects/funnel-health.test.ts:
import { loadTestContent } from "../helpers/loadTestContent"; // ← if no such helper, copy the loader from tests/effects/funnel-health.test.ts

describe("set_sovereign_health", () => {
  it("applies an uncapped lethal delta and sets status", () => {
    const db = loadTestContent();
    const state = createNewGameState(db); // sovereign.health starts 70
    const r = applyEffects(db, state, [
      { type: "set_sovereign_health", healthDelta: -100, healthStatus: "critical" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.resources.sovereign.health).toBe(0); // not capped at 60
      expect(r.value.resources.sovereign.healthStatus).toBe("critical");
    }
  });
});
```

> Copy the exact content-loading helper used by `tests/effects/funnel-health.test.ts` (Phase 1 added it). Use the same import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/effects/funnelSovereignHealth.test.ts`
Expected: FAIL（effect 未定义）。

- [ ] **Step 3: Add schema branch** (`content/schemas.ts`, in `eventEffectSchema` union, beside `set_taihou_health`)

```ts
  z.strictObject({
    type: z.literal("set_sovereign_health"),
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
```

- [ ] **Step 4: Add funnel handler** (`funnel.ts`, beside the `set_taihou_health` case)

```ts
      case "set_sovereign_health": {
        if (effect.healthDelta !== undefined)
          next.resources.sovereign.health = clampPct(next.resources.sovereign.health + effect.healthDelta);
        if (effect.healthStatus !== undefined)
          next.resources.sovereign.healthStatus = effect.healthStatus;
        break;
      }
```

(Use the file's existing `clampPct` helper — confirm its name.)

- [ ] **Step 5: Add validateEffects target guards** (`funnel.ts`, in the validation `switch` — find where `set_rank` validates `db.characters[e.char] && state.standing[e.char]`)

Replace the no-op `break` entries for `consort_decease` / `set_consort_health` / `set_consort_posthumous` with a guarded branch:

```ts
      case "set_consort_health":
      case "set_consort_posthumous":
      case "consort_decease": {
        if (!state.standing[(effect as { char: string }).char])
          bad(index, "BAD_EFFECT_TARGET", `effect needs a consort with standing: "${(effect as { char: string }).char}"`, { char: (effect as { char: string }).char });
        break;
      }
```

(Mirror the exact `bad(...)` signature already used in `validateEffects`.)

- [ ] **Step 5b: `consort_decease` 自动断胎** (`funnel.ts`, the `consort_decease` apply case added in Phase 1)

In the existing `consort_decease` handler (which sets `lifecycle="deceased"` + writes `deathRecord`), append a gestation clear so a pregnant consort's death terminates the pregnancy (§6.5; a delivered consort has no active gestation, so this is a no-op for them):

```ts
        // 断胎：清除该侍君正在承的胎（已生产者无活动 gestation，no-op）
        next.resources.bloodline.gestations = next.resources.bloodline.gestations.filter(
          (g) => g.carrier !== effect.char,
        );
```

Add a test to `tests/effects/funnel-health.test.ts`:

```ts
  it("consort_decease clears the carrier's active gestation (断胎)", () => {
    const { db, state } = freshState(); // helper already in this file
    const id = Object.keys(state.standing).find((c) => db.characters[c]?.kind === "consort")!;
    state.resources.bloodline.gestations.push({ carrier: id, conceivedAt: state.calendar });
    const r = applyEffects(db, state, [{ type: "consort_decease", char: id, at: state.calendar, cause: "illness" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === id)).toBe(false);
  });
```

- [ ] **Step 6: Update `src/store/health.ts`**

- In `setHealthEffect`, change the sovereign branch to the uncapped effect and drop `clampDelta`:

```ts
    case "sovereign":
      return {
        type: "set_sovereign_health",
        ...(rawDelta !== 0 ? { healthDelta: rawDelta } : {}),
        ...(status ? { healthStatus: status } : {}),
      };
```

  Remove the now-unused `clampDelta` const.
- In `planHealthChange`, guard the inert effect — replace the unconditional push with:

```ts
  const effects: EventEffect[] = [];
  if (delta !== 0 || input.healthStatus !== undefined) {
    effects.push(setHealthEffect(input.subject, delta, input.healthStatus));
  }
```

- [ ] **Step 7: Extend `tests/store/health.test.ts`**

Add a case asserting a lethal sovereign delta now realizes via effects:

```ts
  it("lethal sovereign delta realizes to 0 health when applied", () => {
    const db = /* same loader */;
    const state = createNewGameState(db);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "sovereign" }, healthDelta: -100, cause: "illness", at: toGameTime(state.calendar),
    });
    expect(outcome.sovereignDied).toBe(true);
    const r = applyEffects(db, state, effects);
    if (r.ok) expect(r.value.resources.sovereign.health).toBe(0);
  });
  it("emits no inert effect when delta=0 and no status", () => {
    const db = /* loader */; const state = createNewGameState(db);
    const { effects } = planHealthChange(state, {
      subject: { kind: "taihou" }, cause: "illness", at: toGameTime(state.calendar),
    });
    expect(effects).toHaveLength(0);
  });
```

- [ ] **Step 8: Run tests + tsc**

Run: `npx vitest run tests/effects/funnelSovereignHealth.test.ts tests/store/health.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit` → clean. Run `npx vitest run` → full suite green.

- [ ] **Step 9: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts src/store/health.ts tests/effects/funnelSovereignHealth.test.ts tests/effects/funnel-health.test.ts tests/store/health.test.ts
git commit -m "feat: set_sovereign_health 解封顶 + consort 效果 target 守卫 + inert 守卫 + consort_decease 断胎"
```

---

### Task 2: `projectMonthlyHealth` 纯月度投影

**Files:**
- Create: `src/store/healthTick.ts`
- Test: `tests/store/healthTick.test.ts`

**Interfaces:**
- Consumes: `healthRoll`/`healthRollRange`（`src/engine/characters/healthRoll`）、`ageOver35`（`src/engine/characters/aging`）、`HealthStatus`/`DeathCause`（types）。
- Produces:
  - `interface MonthlyHealthContext { health: number; status: HealthStatus; age: number; isYearStart: boolean; pregnancyMonthlyCost: boolean; seedKey: string }`
  - `interface MonthlyHealthOutcome { previousHealth: number; nextHealth: number; previousStatus: HealthStatus; nextStatus: HealthStatus; died: boolean; deathCause?: DeathCause }`
  - `projectMonthlyHealth(ctx: MonthlyHealthContext): MonthlyHealthOutcome`
  - `monthlyIllnessRate(health: number, age: number): number`（导出，供测试）

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/healthTick.test.ts
import { describe, expect, it } from "vitest";
import { projectMonthlyHealth, monthlyIllnessRate } from "../../src/store/healthTick";

const base = { age: 20, isYearStart: false, pregnancyMonthlyCost: false };

describe("monthlyIllnessRate", () => {
  it("healthy young → ~ floor of 5% annual converted monthly (small)", () => {
    const r = monthlyIllnessRate(100, 20); // annual 5% → monthly ≈ 0.426%
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.01);
  });
  it("low health + old → near 60% annual cap", () => {
    const r = monthlyIllnessRate(0, 60); // annual clamp 60 → monthly ≈ 7.2%
    expect(r).toBeGreaterThan(0.05);
    expect(r).toBeLessThan(0.1);
  });
});

describe("projectMonthlyHealth", () => {
  it("year start at 35+ applies aging decay; element year-1 month-1 (isYearStart false) does not", () => {
    const decayed = projectMonthlyHealth({ ...base, age: 45, isYearStart: true, health: 80, status: "healthy", pregnancyMonthlyCost: false, seedKey: "a" });
    expect(decayed.nextHealth).toBeLessThan(80); // −2 at 45..54, minus any onset damage (none: onset doesn't damage)
    const noDecay = projectMonthlyHealth({ ...base, age: 45, isYearStart: false, health: 80, status: "healthy", seedKey: "a" });
    expect(noDecay.nextHealth).toBe(80); // healthy, no onset hit (status flips at most; no health loss from onset)
  });

  it("sick: deducts 1-2 then a single mutually-exclusive transition (never both worsen and recover)", () => {
    const out = projectMonthlyHealth({ ...base, health: 50, status: "sick", seedKey: "sick:1" });
    expect(out.previousStatus).toBe("sick");
    expect(["sick", "critical", "healthy"]).toContain(out.nextStatus);
    expect(out.nextHealth).toBeLessThanOrEqual(50); // lost 1-2 病损 (deterministic for this seed)
  });

  it("critical: health -3..-5; may sudden-death (deterministic per seed)", () => {
    const out = projectMonthlyHealth({ ...base, age: 70, health: 4, status: "critical", seedKey: "crit:lethal" });
    // either died via 0-floor or 5% sudden death — both set died
    expect(typeof out.died).toBe("boolean");
  });

  it("0-floor death: critical with low health that drops to 0 → died", () => {
    const out = projectMonthlyHealth({ ...base, health: 2, status: "critical", seedKey: "x", age: 20 });
    expect(out.nextHealth).toBe(0);
    expect(out.died).toBe(true);
    expect(out.deathCause).toBe("illness");
  });

  it("pregnancy monthly cost subtracts 0-5 before other steps", () => {
    const out = projectMonthlyHealth({ ...base, health: 100, status: "healthy", pregnancyMonthlyCost: true, seedKey: "preg:1" });
    expect(out.nextHealth).toBeLessThanOrEqual(100);
    expect(out.nextHealth).toBeGreaterThanOrEqual(95);
  });
});
```

> Pick concrete `seedKey`s that make the deterministic asserts true: run the test once (RED→implement→GREEN), and if a probabilistic assert is brittle, choose a seedKey whose `healthRoll` lands in the needed bucket (compute via a scratch `console.log` then bake the seed in). Keep asserts on deterministic outcomes for the fixed seed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/healthTick.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement `src/store/healthTick.ts`**

```ts
/**
 * 纯月度健康投影（设计 §3.3）。每角色本地串行累加，最后一次结算。
 * 顺序：怀孕成本→衰老→病损→0死亡→暴毙→互斥迁移（迁移放最后）。
 */
import { healthRoll, healthRollRange } from "../engine/characters/healthRoll";
import { ageOver35 } from "../engine/characters/aging";
import type { DeathCause, HealthStatus } from "../engine/state/types";

export interface MonthlyHealthContext {
  health: number;
  status: HealthStatus;
  age: number;
  /** true 仅当本月为年初（month===1 上旬），用于年龄衰老。 */
  isYearStart: boolean;
  /** true 当该角色为承孕侍君（本月扣 0-5 孕期成本）。 */
  pregnancyMonthlyCost: boolean;
  /** 确定性 seedKey 前缀（含 rngSeed:charId:year:month）。 */
  seedKey: string;
}

export interface MonthlyHealthOutcome {
  previousHealth: number;
  nextHealth: number;
  previousStatus: HealthStatus;
  nextStatus: HealthStatus;
  died: boolean;
  deathCause?: DeathCause;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** 年化生病率（5–60%）→ 月度概率。 */
export function monthlyIllnessRate(health: number, age: number): number {
  const annual = Math.min(60, Math.max(5, 5 + Math.round((100 - health) * 0.4) + ageOver35(age)));
  return 1 - Math.pow(1 - annual / 100, 1 / 12);
}

export function projectMonthlyHealth(ctx: MonthlyHealthContext): MonthlyHealthOutcome {
  const previousHealth = ctx.health;
  const previousStatus = ctx.status;
  let h = ctx.health;
  let status = ctx.status;
  const k = ctx.seedKey;

  // 1. 怀孕成本
  if (ctx.pregnancyMonthlyCost) h -= healthRollRange(`${k}:preg`, 0, 5);
  // 2. 年龄自然衰老（仅年初、age≥35）
  if (ctx.isYearStart && ctx.age >= 35) h -= 1 + Math.floor(ageOver35(ctx.age) / 10);
  // 3. 病损（本月之前已处于该状态者）
  if (previousStatus === "sick") h -= healthRollRange(`${k}:sickdmg`, 1, 2);
  else if (previousStatus === "critical") h -= healthRollRange(`${k}:critdmg`, 3, 5);

  h = clampPct(h);

  // 4. 0 血死亡
  if (h <= 0) {
    return { previousHealth, nextHealth: 0, previousStatus, nextStatus: status, died: true, deathCause: "illness" };
  }
  // 5. 重病暴毙（仅本月之前已重病者）
  if (previousStatus === "critical" && healthRoll(`${k}:sudden`) < 5) {
    return { previousHealth, nextHealth: h, previousStatus, nextStatus: status, died: true, deathCause: "critical_sudden" };
  }
  // 6. 互斥状态迁移（单次）
  if (previousStatus === "healthy") {
    const onsetPct = monthlyIllnessRate(ctx.health, ctx.age) * 100;
    if (healthRoll(`${k}:onset`) < onsetPct) status = "sick"; // 本月到此为止，不扣病损
  } else if (previousStatus === "sick") {
    const criticalRate = Math.min(30, Math.max(1, 1 + ageOver35(ctx.age)));
    const r = healthRoll(`${k}:transition`); // 0..99
    if (r < criticalRate) status = "critical";
    else if (r < criticalRate + 50) status = "healthy";
    // else 维持 sick
  }
  // critical 不自动痊愈

  return { previousHealth, nextHealth: h, previousStatus, nextStatus: status, died: false };
}
```

- [ ] **Step 4: Run test to verify it passes** (tune brittle seeds as noted)

Run: `npx vitest run tests/store/healthTick.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/healthTick.ts tests/store/healthTick.test.ts
git commit -m "feat: projectMonthlyHealth 纯月度投影（衰老/onset/病损/迁移/暴毙）"
```

---

### Task 3: 月度 tick orchestrator（遍历角色 → effects + 死亡，确定性）

**Files:**
- Modify: `src/store/healthTick.ts`（加 `buildMonthlyHealthTick`）
- Test: `tests/store/healthTickOrchestrator.test.ts`

**Interfaces:**
- Consumes: `projectMonthlyHealth`（Task 2）、`planHealthChange`（`src/store/health`）、`currentAgeOf`/`presetAge`/`heirAge`（`aging`，见 Phase 1 `aging.ts` — 若 `currentAgeOf` 未实现则在此实现按角色分派）、`inPalaceConsorts`（`src/engine/characters/presence`）、`isIll`。
- Produces:
  - `interface MonthlyTickResult { effects: EventEffect[]; sovereignDied: boolean; aftermathDeaths: { kind: "taihou"|"consort"|"heir"; subjectId: string }[] }`
  - `buildMonthlyHealthTick(db: ContentDB, state: GameState): MonthlyTickResult`

> Iteration order (deterministic, for same-month priority §7): sovereign, then taihou, then alive consorts sorted by `id`, then alive heirs sorted by `id`. For each: build `MonthlyHealthContext` (current health/status from state; age via the per-type age helpers + `state.calendar.year`; `isYearStart = state.calendar.month === 1 && state.calendar.period === "early"`; `pregnancyMonthlyCost` = consort is a current gestation carrier; `seedKey = "tick:{rngSeed}:{subjectId}:{year}:{month}"`). Run `projectMonthlyHealth`, then feed its `nextHealth−previousHealth` delta + `nextStatus` + `deathCause` into `planHealthChange` to get the funnel effects (which already emit decease + enqueue_aftermath for non-sovereign deaths). Collect `sovereignDied` and the non-sovereign death subjects.

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/healthTickOrchestrator.test.ts
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
// content loader helper as in other store tests

describe("buildMonthlyHealthTick", () => {
  it("at game start (all healthy, young) produces no deaths and applying effects keeps suite consistent", () => {
    const db = /* loader */; const state = createNewGameState(db);
    const result = buildMonthlyHealthTick(db, state);
    expect(result.sovereignDied).toBe(false);
    expect(result.aftermathDeaths).toEqual([]);
    const r = applyEffects(db, state, result.effects);
    expect(r.ok).toBe(true);
  });

  it("is deterministic: same state → identical effects", () => {
    const db = /* loader */; const state = createNewGameState(db);
    const a = buildMonthlyHealthTick(db, state);
    const b = buildMonthlyHealthTick(db, state);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a critically ill consort with health 1 dies and is enqueued", () => {
    const db = /* loader */; const state = createNewGameState(db);
    // pick a real consort id present in standing; set them critical/low
    const id = Object.keys(state.standing).find((cid) => db.characters[cid]?.kind === "consort")!;
    state.standing[id]!.health = 1; state.standing[id]!.healthStatus = "critical";
    const result = buildMonthlyHealthTick(db, state);
    expect(result.aftermathDeaths.some((d) => d.kind === "consort" && d.subjectId === id)).toBe(true);
    const r = applyEffects(db, state, result.effects);
    if (r.ok) {
      expect(r.value.standing[id]!.lifecycle).toBe("deceased");
      expect(r.value.pendingAftermath.some((p) => p.subjectId === id)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/healthTickOrchestrator.test.ts` → FAIL (function missing).

- [ ] **Step 3: Implement `buildMonthlyHealthTick`** (append to `src/store/healthTick.ts`)

```ts
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import { toGameTime } from "../engine/calendar/time";
import { planHealthChange, type HealthSubject } from "./health";
import { presetAge, heirAge } from "../engine/characters/aging";

export interface MonthlyTickResult {
  effects: EventEffect[];
  sovereignDied: boolean;
  aftermathDeaths: { kind: "taihou" | "consort" | "heir"; subjectId: string }[];
}

export function buildMonthlyHealthTick(db: ContentDB, state: GameState): MonthlyTickResult {
  const { year, month, period } = state.calendar;
  const isYearStart = month === 1 && period === "early";
  const at = toGameTime(state.calendar);
  const seed = (subjectId: string) => `tick:${state.rngSeed}:${subjectId}:${year}:${month}`;
  const effects: EventEffect[] = [];
  const aftermathDeaths: MonthlyTickResult["aftermathDeaths"] = [];
  let sovereignDied = false;

  // Phase 2: 怀孕成本属 Phase 3 — 一律 pregnancyMonthlyCost=false。Phase 3 再加 carrier 检测。
  const run = (subject: HealthSubject, subjectId: string, age: number, pregnancyMonthlyCost: boolean) => {
    const cur =
      subject.kind === "sovereign" ? { health: state.resources.sovereign.health, status: state.resources.sovereign.healthStatus }
      : subject.kind === "taihou" ? { health: state.taihou.health, status: state.taihou.healthStatus }
      : subject.kind === "consort" ? { health: state.standing[subjectId]?.health ?? 100, status: state.standing[subjectId]?.healthStatus ?? "healthy" }
      : (() => { const h = state.resources.bloodline.heirs.find((x) => x.id === subjectId)!; return { health: h.health, status: h.healthStatus ?? "healthy" }; })();

    const out = projectMonthlyHealth({
      health: cur.health, status: cur.status, age, isYearStart, pregnancyMonthlyCost, seedKey: seed(subjectId),
    });
    if (out.nextHealth === out.previousHealth && out.nextStatus === out.previousStatus && !out.died) return;
    const plan = planHealthChange(state, {
      subject,
      healthDelta: out.nextHealth - out.previousHealth,
      healthStatus: out.nextStatus !== out.previousStatus ? out.nextStatus : undefined,
      cause: out.deathCause ?? "illness",
      at,
    });
    effects.push(...plan.effects);
    if (plan.outcome.sovereignDied) sovereignDied = true;
    else if (plan.outcome.died && subject.kind !== "sovereign")
      aftermathDeaths.push({ kind: subject.kind, subjectId });
  };

  // priority order: sovereign → taihou → consorts(by id) → heirs(by id)
  run({ kind: "sovereign" }, "sovereign", db.world.sovereign.startingAge + (year - 1), false);
  if (!state.taihou.deceased) run({ kind: "taihou" }, "taihou", presetAge(db.characters["taihou"]!.profile.age, year), false);

  const consortIds = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && state.standing[c.id]?.lifecycle !== "deceased")
    .map((c) => c.id)
    .sort();
  for (const id of consortIds) {
    run({ kind: "consort", id }, id, presetAge(db.characters[id]!.profile.age, year), false); // Phase 2: no pregnancy cost
  }

  const heirIds = state.resources.bloodline.heirs
    .filter((h) => h.lifecycle !== "deceased")
    .map((h) => h.id)
    .sort();
  for (const id of heirIds) {
    const heir = state.resources.bloodline.heirs.find((h) => h.id === id)!;
    run({ kind: "heir", id }, id, heirAge(heir.birthAt, { year }), false);
  }

  return { effects, sovereignDied, aftermathDeaths };
}
```

> Verify the real field/getter names before coding: `db.world.sovereign.startingAge`, `db.characters["taihou"].profile.age`, `heir.birthAt`, `heir.lifecycle`. Adjust to whatever the codebase actually exposes (the taihou character id and the heir birth-time field were set in Phase 1 / earlier work — grep to confirm). If 太后 already deceased, skip taihou. If sovereign already in a future game-over, the caller won't invoke the tick.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/healthTickOrchestrator.test.ts` → PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/healthTick.ts tests/store/healthTickOrchestrator.test.ts
git commit -m "feat: buildMonthlyHealthTick 月度遍历结算（确定性 + 同月死亡优先级）"
```

---

### Task 4: App 接线月度 tick（rollover 按 year:month 幂等）

**Files:**
- Modify: `src/ui/App.tsx`（加 `rollHealthTick`，接入 `spendAp`/rollover；月度去重 ref）
- Test: `tests/store/healthTickIdempotent.test.ts`（在 store 层验证幂等的纯函数包装；App 接线靠类型检查 + 手测）

**Interfaces:**
- Consumes: `buildMonthlyHealthTick`（Task 3）。
- Produces: `rollHealthTick(): { sovereignDied: boolean; aftermathDeaths: ... }`（App 内闭包；命中新月才结算，按 `health:tick:{rngSeed}:{year}:{month}` 去重）。

> 月度判定：tick 应在「跨入新月的首个 rollover」结算一次。复用 Phase 1 删掉 `rollTaihouIllness` 留下的模式：在 App 维护一个 `healthTicked = useRef<Set<string>>(new Set())`，key=`${rngSeed}:${year}:${month}`。在 `spendAp` 的 `rolledOver` 分支（旧 `rollTaihouIllness` 调用点）改调 `rollHealthTick()`。结算：若 key 已存在或当前 period 不是该月首结算则跳过——更稳妥用「month key 未见过」即结算（每月至多一次，因为 dedupe set 按 month key）。读档后 ref 清空由现有 `resetRollGuards` 负责（把 healthTicked 一并清空）。

- [ ] **Step 1: Write the idempotency test (store-level wrapper)**

```ts
// tests/store/healthTickIdempotent.test.ts
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
// loader helper

describe("monthly tick idempotency", () => {
  it("applying the same month's tick twice on the produced state does not double-apply (status already changed)", () => {
    const db = /* loader */; let state = createNewGameState(db);
    const id = Object.keys(state.standing).find((cid) => db.characters[cid]?.kind === "consort")!;
    state.standing[id]!.health = 50; state.standing[id]!.healthStatus = "sick";
    const t1 = buildMonthlyHealthTick(db, state);
    const r1 = applyEffects(db, state, t1.effects);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Re-running build on the SAME (pre-tick) calendar but POST-tick state: the dedupe is the App's job,
    // but verify the pure tick is a function of state (no hidden mutation) — building again on r1 state for the
    // SAME month yields a different (further-progressed) result, proving determinism-by-input not double-apply.
    const t2 = buildMonthlyHealthTick(db, r1.value);
    expect(JSON.stringify(t2)).toBe(JSON.stringify(buildMonthlyHealthTick(db, r1.value)));
  });
});
```

> The true dedupe lives in App (a `Set` keyed by `year:month`). The store function is a pure function of state; the App must NOT call it twice for the same month. This test pins determinism; the App dedupe is covered by manual verification + the type-checked wiring.

- [ ] **Step 2: Run → FAIL only if helper paths wrong; otherwise it should pass once Task 3 exists.** Confirm RED→GREEN around any new assertion.

- [ ] **Step 3: Wire into `App.tsx`**

Find the `spendAp` function and the spot where Phase 1 removed `rollTaihouIllness` (the `if (spend.ok && spend.value.rolledOver) …` area) and the `resetRollGuards` function.

Add a ref near the other tick refs:

```ts
  const healthTicked = useRef<Set<string>>(new Set());
```

Add the roller:

```ts
  /** 月度健康 tick：跨入新月首个 rollover 结算一次（按 year:month 幂等）。返回死亡结果。 */
  const rollHealthTick = (): { sovereignDied: boolean; aftermathDeaths: { kind: "taihou"|"consort"|"heir"; subjectId: string }[] } => {
    const cal = store.getState().calendar;
    const key = `${store.getState().rngSeed}:${cal.year}:${cal.month}`;
    if (healthTicked.current.has(key)) return { sovereignDied: false, aftermathDeaths: [] };
    healthTicked.current.add(key);
    const result = buildMonthlyHealthTick(db, store.getState());
    if (result.effects.length) {
      const applied = store.applyEffects(db, result.effects);
      if (applied.ok) doAutosave();
    }
    return { sovereignDied: result.sovereignDied, aftermathDeaths: result.aftermathDeaths };
  };
```

In `spendAp`, in the `rolledOver` branch, call it and stash the death result for the caller to act on (death handling is Task 5). For now wire the call and (temporarily) ignore the result if Task 5 not yet merged — but commit Task 4 and Task 5 together if the build needs the death handler. Simplest: have `spendAp` return the death result alongside `decreeBeats`:

```ts
    let healthDeaths: ReturnType<typeof rollHealthTick> | null = null;
    if (spend.ok && spend.value.rolledOver) healthDeaths = rollHealthTick();
    return { spend, decreeBeats, healthDeaths };
```

Update `spendAp`'s callers' destructuring (they currently take `{ spend, decreeBeats }`) — add `healthDeaths` where death handling is needed (Task 5). For Task 4 alone, callers may ignore it.

In `resetRollGuards`, add `healthTicked.current.clear();`.

Import `buildMonthlyHealthTick` from `../store/healthTick`.

- [ ] **Step 4: tsc + full suite**

Run: `npx tsc --noEmit` (clean — fix any caller destructuring), `npx vitest run` (green). Manually note: a tick now runs on month rollover.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx tests/store/healthTickIdempotent.test.ts
git commit -m "feat: App 接线月度健康 tick（year:month 幂等，转月结算）"
```

---

### Task 5: 死亡处理（皇帝 game-over + aftermath 队列 + 优先级）

**Files:**
- Modify: `src/ui/App.tsx`（皇帝死亡 → game-over 回 title；非皇帝死亡：已由 effects 标记 + 入队，本阶段不弹 UI）
- Modify: `src/engine/state/types.ts` / a small constants file（`FEATURE_AFTERMATH_UI = false`）
- Test: `tests/store/sovereignDeath.test.ts`

**Interfaces:**
- Consumes: `rollHealthTick().{ sovereignDied, aftermathDeaths }`（Task 4）。

> 皇帝死亡：tick 应用 effects 后 `sovereignDied===true` → 触发 game-over：`setView("title")`（回主菜单），并清空进行中的对话/反应/弹窗状态，避免残留。同月其它角色即使也死，游戏已结束，不展示身后事（优先级在 `buildMonthlyHealthTick` 的遍历顺序里已保证 sovereign 最先；App 一旦见 `sovereignDied` 即转 game-over，忽略 `aftermathDeaths`）。
>
> 非皇帝死亡：`buildMonthlyHealthTick` 的 effects 已 `*_decease`（置 lifecycle deceased / taihou deceased）+ `enqueue_aftermath`。本阶段 **不弹追封/谥号 UI**（`FEATURE_AFTERMATH_UI=false`）；pendingAftermath 条目保持 `resolved=false`，留 Phase 4。死者已从活人列表过滤（Phase 1 已实现 `inPalaceConsorts` 等）。无需额外 App 处理，除非确保已故被召见侍君/皇嗣的视图回退（若当前 `summonedConsortId` 指向已故者，清空它）。

- [ ] **Step 1: Write the failing test (sovereign death path is detectable in store)**

```ts
// tests/store/sovereignDeath.test.ts
import { describe, expect, it } from "vitest";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
// loader + createNewGameState

describe("sovereign death via monthly tick", () => {
  it("flags sovereignDied when sovereign health drops to 0", () => {
    const db = /* loader */; const state = createNewGameState(db);
    state.resources.sovereign.health = 1;
    state.resources.sovereign.healthStatus = "critical";
    const result = buildMonthlyHealthTick(db, state);
    expect(result.sovereignDied).toBe(true);
    // sovereign death never enqueues aftermath
    expect(result.aftermathDeaths.some((d) => (d as { kind: string }).kind === "sovereign")).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL/observe.** (If the deterministic critical-damage at health 1 doesn't reach 0 for the chosen seed, set `state.resources.sovereign.health = 1` and rely on 病损 −3..−5 → 0; that is deterministic ≤0. Confirm GREEN.)

- [ ] **Step 3: Add the feature flag**

Create `src/engine/featureFlags.ts`:

```ts
/** Phase 2: 非皇帝身后事 UI（追封/谥号/葬仪 UI）尚未实现，统一 flag 关闭，留 Phase 4。 */
export const FEATURE_AFTERMATH_UI = false;
```

- [ ] **Step 4: Wire sovereign game-over in App.tsx**

At each `spendAp` caller that can roll over (or centrally right after `rollHealthTick` in `spendAp`), if `healthDeaths?.sovereignDied`, route to game-over. Centralize: add a helper

```ts
  const handleHealthDeaths = (deaths: { sovereignDied: boolean } | null) => {
    if (deaths?.sovereignDied) {
      // 清场 → 回主菜单
      setReaction(null); setReactionQueue([]); setChildReaction(null);
      setView("title");
      return true; // game over
    }
    return false;
  };
```

Call `handleHealthDeaths(spend.healthDeaths)` in the rollover settle path BEFORE `runCheckpoints`/`playReactions`, and short-circuit if it returns true. Also: if `summonedConsortId` references a now-deceased consort after a tick, clear it (guard reads of `state.standing[summonedConsortId]?.lifecycle === "deceased"`).

(Exact insertion points: wherever `spendAp(...)` results drive `playReactions`/`runCheckpoints` — `reviewMemorials`, `templeAction`, `converse`, `enterShop`, the bedchamber/heir handlers, `restAlone`. Add the game-over short-circuit centrally in `playReactions` if `spend.healthDeaths` is threaded there; otherwise guard each rollover settle. Keep it DRY by threading `healthDeaths` into `playReactions`.)

- [ ] **Step 5: tsc + full suite + manual**

Run: `npx tsc --noEmit` clean; `npx vitest run` green. Manually: drive sovereign to 0 health → next month rollover → returns to title screen.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx src/engine/featureFlags.ts tests/store/sovereignDeath.test.ts
git commit -m "feat: 皇帝死亡 game-over 回主菜单 + 非皇帝身后事 flag 门控（Phase 2）"
```

---

## Phase 2 完成验收

- [ ] `npx tsc --noEmit` 全绿；`npx vitest run` 全绿。
- [ ] 月度跨月时全体角色按设计衰老/生病/恶化/痊愈/暴毙；health≤0 或暴毙即死。
- [ ] 皇帝死亡 → 回主菜单（title）。
- [ ] 侍君/太后/皇嗣死亡 → 移出活人列表 + pendingAftermath 入队（未 resolved，Phase 4 处理 UI）；无 health=0 仍存活。
- [ ] 病亡的承孕侍君自动断胎（`consort_decease` 清 gestation）。
- [ ] tick 按 year:month 幂等；读档 ref 清空。

## Self-Review notes

- **Phasing（已对齐 spec §11）**：Phase 2 = 统一 tick（衰老 + 病情）+ 基础死亡 + 事件队列 + 皇帝 game-over + 断胎-on-death。**怀孕成本（转胎-10/孕期-0~5/生产-5或-10）属 Phase 3**，本 plan 不含其接线；`projectMonthlyHealth` 保留 `pregnancyMonthlyCost` 入参但 orchestrator 一律传 false（Phase 3 再接 carrier 检测与转胎/生产）。
- Spec 覆盖：§1.4（uncapped sovereign 修复 + 即时死亡用效果）、§3（tick）、§6.1（皇帝 game-over）、§6.5（断胎/存嗣 via consort_decease 自动清胎）、§7（队列 + 同月优先级；非皇帝 UI 由 `FEATURE_AFTERMATH_UI` 关闭）。
- 携带的 Phase 1 carry-forwards（Task 1）：`set_sovereign_health` 解封顶、consort 效果 target 守卫、inert-effect 守卫。
- 已知未决（Phase 3/4）：怀孕成本接线（§5）、重病/服丧 gating（§8）、太医看诊（§4）、身后事 UI 与追封/谥号/葬仪（§6.2-6.4）、奉先殿缅怀（§10）。`FEATURE_AFTERMATH_UI` 在 Phase 4 打开。
- 顺序依赖：Task 1 必先（uncapped sovereign 死亡才能真死、断胎才能在死亡时触发）；Task 2→3→4→5 链式。
