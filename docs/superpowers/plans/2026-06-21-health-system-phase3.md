# 健康 / 病情 / 生死 系统 Phase 3 Implementation Plan（太医 · 怀孕成本 · 重病/服丧 gating）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为既有健康系统接入「召见太医看诊（四类对象、每月每人一次、各 1 AP）」「怀孕健康成本（转胎 −10 / 承养每月 −rand(0–5) / 生产 −5/−10）」「皇帝重病 + 太后服丧 的上朝/侍寝 gating」。

**Architecture:** 全部健康变更继续经 §1.4 funnel（`planHealthChange`，`src/store/health.ts`）原子落地，满足「扣血致 0 即时死亡」不变量；看诊与孕期成本只是新的调用方。看诊用一个新底层 funnel 效果 `record_physician_visit` 记录「本月已请脉」月键；gating 抽为纯函数 `canHoldCourt` / `canBedchamber`，UI 与入口共用。太医本人 `courtPhysician(rngSeed)` 确定性派生、不落档（仿 `gongli.ts`）。

**Tech Stack:** TypeScript + React + Vitest（测试只放 `tests/**/*.test.ts`，不与源码同目录）。Zod schema 用 `satisfies z.ZodType<GameState>` 维持类型↔schema 一致；确定性随机走 `healthRoll`/`healthRollRange`（`fnv1a64Hex`）；时间事务走 `GameStore.resolveTimedAction` / `advanceTime`。

## Global Constraints

以下为本期全局约束，每个任务隐含适用（数值/字符串逐字照抄设计稿与本节）：

- **设计稿活文档**：`docs/superpowers/specs/2026-06-21-health-illness-mortality-design.md`（§4 太医、§5 怀孕成本、§8 gating、§11 分期、§12 测试要点）。实施以本 plan 与实际代码为准。
- **存档迁移**：pre-release，**不做向后兼容、不写 migration**。仅在 `stateSchema.ts` / `types.ts` / `content/schemas.ts` 增可选字段并赋初值；旧档不兼容即落 CORRUPT，符合项目惯例。**不得**新增 migration 代码或 migration 测试。
- **健康不变量**：任何使健康降至 0 的变更必须在同一事务内立即标记死亡并入身后事（经 `planHealthChange`，绝不调用方自拼「扣血+置死+入队」）。
- **看诊治疗数值**：加血 `+healthRollRange(key, 5, 10)`（clamp 100）；`sick` 50% / `critical` 30% 命中 → `healthStatus="healthy"`；`healthy` 仅加血、不改状态。
- **每月每人至多一次看诊**：月键 `monthKey = "{year}:{month}"`；字段 `lastPhysicianVisitMonthKey?: string`（皇帝→`resources.sovereign`、太后→`taihou`、侍君→`standing[id]`、皇嗣→`heir`）。当月已请脉者按钮禁用，提示「本月已请脉，太医嘱静养」。
- **每次看诊耗 1 AP**：经 `store.resolveTimedAction(db, effects, { type: "SPEND_AP", amount: 1 })`（转旬/跨月 tick 照常）。AP 不足时按钮禁用。
- **怀孕成本**（仅侍君承孕，皇帝自孕不计）：转胎落到侍君 `healthDelta = −10`（`cause: "pregnancy"`，一次性）；承养期间每月 `−rand(0–5)`（`cause: "pregnancy"`，已在 `projectMonthlyHealth` 步骤 1 实现，本期只接线 carrier 检测）；生产顺产 `−5`/难产 `−10`（`cause: "childbirth"`）。**生产顺序：先落库皇嗣（birth 效果），再对母方扣血**——已产则皇嗣存活仅母亡。
- **生产成本映射**（本期决策，照抄）：`bearerOutcome === "safe"` → 顺产 `−5`；`bearerOutcome === "child_dies"` → 难产 `−10`（母存活）；`bearer_dies` / `both` → **不追加健康成本**（母方已由 birth 效果置 `deceased`）。皇帝自孕（`bearer === "sovereign"`）不计成本。
- **太医姓名池**（§4.3 二选一，本期决策）：**复用官员姓名池** `pickSurname` + `pickGivenName`（`src/engine/officials/namePool.ts`），不新增 `FEMALE_OFFICIAL_NAME_POOL`，不使用宫女名池。
- **太医立绘**：`official1`–`official8`，对应 manifest `portrait.official1.neutral`–`portrait.official8.neutral`（文件已在 `public/assets/portraits/official/`）。
- **gating（本期含两项，叠加）**：`canHoldCourt(state)` / `canBedchamber(state)` 任一不通过即禁止——①皇帝重病 `resources.sovereign.healthStatus === "critical"`（文案「陛下凤体违和，太医请陛下静养」）；②太后服丧 `taihou.deceased === true && currentDayIndex < taihou.mourningUntilDayExclusive`（文案「国丧期间，不宜临朝/侍寝」）。两者同时成立按主因（重病优先）显示文案。Phase 4 仅补谥号输入 UI，不再改 gating。
- **确定性随机 seedKey**：看诊用 `physician:{rngSeed}:{subjectKey}:{year}:{month}:{用途}`（subjectKey：sovereign→`"sovereign"`、taihou→`"taihou"`、consort/heir→`id`），保证读档重算一致。
- **DeathCause** 枚举（`src/engine/state/types.ts`，已存在）：`"illness" | "critical_sudden" | "pregnancy" | "childbirth" | "scripted"`。
- **`planHealthChange`** 已实现（`src/store/health.ts`）：入参 `{ subject, healthDelta?, healthStatus?, forceDeath?, cause, at }`，返回 `{ effects, outcome }`；`HealthSubject = { kind: "sovereign" } | { kind: "taihou" } | { kind: "consort"; id } | { kind: "heir"; id }`；死者 no-op；`delta=0 && 无 status && 无 forceDeath` → 不发空效果。
- **测试命令**：单测 `npx vitest run tests/path/to/test.ts`；类型 `npx tsc --noEmit`；构建 `npx vite build`。提交信息用 `feat:`/`fix:`/`test:` 前缀，**不带 Co-Authored-By**（项目 attribution 全局关闭）。

---

## File Structure

新建：

- `src/engine/characters/taiyi.ts` — `courtPhysician(rngSeed) → { name, portraitSet }`（确定性派生，不落档；仿 `gongli.ts`）。
- `src/store/physician.ts` — 看诊纯逻辑：`physicianMonthKey`、`physicianVisitedThisMonth`、`planPhysicianVisit`。
- `src/store/gating.ts` — `canHoldCourt(state)` / `canBedchamber(state)` 纯函数（重病 + 服丧）。
- `src/store/pregnancyCost.ts` — `planPregnancyTransfer`（转胎 −10）；生产成本辅助 `childbirthCostDelta`。

修改：

- `src/engine/state/types.ts` — 各角色加 `lastPhysicianVisitMonthKey?: string`。
- `src/engine/save/stateSchema.ts` + `src/engine/content/schemas.ts` — 镜像上字段；`eventEffectSchema` 增 `record_physician_visit` 分支。
- `src/engine/effects/funnel.ts` — `record_physician_visit` 的 validate + apply case。
- `src/store/healthTick.ts` — `buildMonthlyHealthTick` 接线 `pregnancyMonthlyCost`（承孕侍君检测）。
- `src/store/gestation.ts` — `buildBirth` 追加生产健康成本效果。
- `src/ui/components/PhysicianModal.tsx` — 扩为四类看诊（保留流胎）。
- `src/ui/App.tsx` — 看诊 handler（reaction）；gating 接入 beginCourt/侍寝入口；转胎 −10 接线。
- `assets/manifest.json` — `portrait.official1.neutral`–`official8.neutral`。

测试（新增）：`tests/store/physician.test.ts`、`tests/characters/taiyi.test.ts`、`tests/store/gating.test.ts`、`tests/store/pregnancyCost.test.ts`、`tests/effects/recordPhysicianVisit.test.ts`、`tests/store/healthTickPregnancy.test.ts`、`tests/store/birthCost.test.ts`、`tests/state/physicianVisitParity.test.ts`（schema 字段 parity，若已有 parity 测试则扩充）。

依赖顺序（线性）：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10。

---

### Task 1: schema/type 字段 + `record_physician_visit` funnel 效果

**Files:**
- Modify: `src/engine/state/types.ts`（`SovereignState`、`TaihouState`、`CharacterStanding`、`Heir` 各加 `lastPhysicianVisitMonthKey?: string`）
- Modify: `src/engine/save/stateSchema.ts`（sovereign/taihou 对象、heir 对象加字段；`characterStandingSchema` 来自 content/schemas）
- Modify: `src/engine/content/schemas.ts`（`characterStandingSchema` 加字段；`eventEffectSchema` 增 `record_physician_visit` 分支）
- Modify: `src/engine/effects/funnel.ts`（validate + apply）
- Test: `tests/effects/recordPhysicianVisit.test.ts`

**Interfaces:**
- Produces: 效果 `{ type: "record_physician_visit"; subjectKind: "sovereign" | "taihou" | "consort" | "heir"; subjectId?: string; monthKey: string }`。apply 把 `monthKey` 写到对应角色的 `lastPhysicianVisitMonthKey`（consort/heir 用 `subjectId` 定位）。
- Produces: 类型字段 `lastPhysicianVisitMonthKey?: string` 在四个角色形状上。

- [ ] **Step 1: 写失败测试**

`tests/effects/recordPhysicianVisit.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";

const db = loadGameContent();

describe("record_physician_visit", () => {
  it("写皇帝/太后的本月已请脉月键", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subjectKind: "sovereign", monthKey: "1:1" },
      { type: "record_physician_visit", subjectKind: "taihou", monthKey: "1:1" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.lastPhysicianVisitMonthKey).toBe("1:1");
    expect(r.value.taihou.lastPhysicianVisitMonthKey).toBe("1:1");
  });

  it("写侍君的本月已请脉月键（按 subjectId 定位）", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased")!;
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subjectKind: "consort", subjectId: cid, monthKey: "2:3" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.lastPhysicianVisitMonthKey).toBe("2:3");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/effects/recordPhysicianVisit.test.ts`
Expected: FAIL（`record_physician_visit` 未在 schema/funnel 定义，effect 校验不过 → `r.ok === false`）

- [ ] **Step 3: 加类型字段**

`src/engine/state/types.ts`：在 `SovereignState`、`TaihouState`、`CharacterStanding`、`Heir` 各接口里加：

```ts
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
```

（四处都加同一字段；放在各接口现有 `healthStatus?` 字段附近即可。）

- [ ] **Step 4: 加 save schema 字段**

`src/engine/save/stateSchema.ts`：
- `resources.sovereign` 对象（约第 82–92 行）末尾加：`lastPhysicianVisitMonthKey: z.string().optional(),`
- `taihou` 对象（约第 188–195 行）加：`lastPhysicianVisitMonthKey: z.string().optional(),`
- heir 对象（约第 122–157 行 `z.strictObject({ ... })`）加：`lastPhysicianVisitMonthKey: z.string().optional(),`

`src/engine/content/schemas.ts`：`characterStandingSchema`（约第 48–62 行）加：`lastPhysicianVisitMonthKey: z.string().optional(),`

- [ ] **Step 5: 加 `record_physician_visit` 到 eventEffectSchema**

`src/engine/content/schemas.ts`：在 `eventEffectSchema` 的 `z.union([...])` 内（紧接 `enqueue_aftermath` 分支后，约第 269–276 行附近）加：

```ts
  z.strictObject({
    type: z.literal("record_physician_visit"),
    subjectKind: z.enum(["sovereign", "taihou", "consort", "heir"]),
    subjectId: idSchema.optional(),
    monthKey: z.string().min(1),
  }),
```

- [ ] **Step 6: funnel validate + apply**

`src/engine/effects/funnel.ts`：
- validate 段（约第 65–69 行那组 `break; // fully constrained by the schema`）把 `case "record_physician_visit":` 加进该组（schema 已充分约束，无额外 target 校验）。
- apply 段（`set_heir_health` case 之后，约第 564 行后）加：

```ts
      case "record_physician_visit": {
        const key = effect.monthKey;
        if (effect.subjectKind === "sovereign") next.resources.sovereign.lastPhysicianVisitMonthKey = key;
        else if (effect.subjectKind === "taihou") next.taihou.lastPhysicianVisitMonthKey = key;
        else if (effect.subjectKind === "consort") {
          const st = next.standing[effect.subjectId!];
          if (st) st.lastPhysicianVisitMonthKey = key;
        } else {
          const h = next.resources.bloodline.heirs.find((x) => x.id === effect.subjectId);
          if (h) h.lastPhysicianVisitMonthKey = key;
        }
        break;
      }
```

- [ ] **Step 7: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/effects/recordPhysicianVisit.test.ts && npx tsc --noEmit`
Expected: PASS（2 测试通过），tsc 无错。

- [ ] **Step 8: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/recordPhysicianVisit.test.ts
git commit -m "feat: lastPhysicianVisitMonthKey 字段 + record_physician_visit 漏斗效果"
```

---

### Task 2: `courtPhysician`（太医本人确定性派生）

**Files:**
- Create: `src/engine/characters/taiyi.ts`
- Test: `tests/characters/taiyi.test.ts`

**Interfaces:**
- Consumes: `fnv1a64Hex`（`src/engine/save/canonical.ts`）、`pickSurname`/`pickGivenName`（`src/engine/officials/namePool.ts`）。
- Produces: `courtPhysician(rngSeed: number): { name: string; portraitSet: string }`，`portraitSet ∈ {"official1".."official8"}`，`name = 姓+名`。

- [ ] **Step 1: 写失败测试**

`tests/characters/taiyi.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { courtPhysician } from "../../src/engine/characters/taiyi";

describe("courtPhysician", () => {
  it("确定性：同 seed 同结果", () => {
    expect(courtPhysician(42)).toEqual(courtPhysician(42));
  });
  it("portraitSet 在 official1..official8", () => {
    for (let seed = 0; seed < 50; seed++) {
      const m = /^official([1-8])$/.exec(courtPhysician(seed).portraitSet);
      expect(m).not.toBeNull();
    }
  });
  it("name 非空且为姓+名（≥2 字）", () => {
    const { name } = courtPhysician(7);
    expect(name.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/characters/taiyi.test.ts`
Expected: FAIL（`taiyi.ts` 不存在）

- [ ] **Step 3: 实现 `taiyi.ts`**

`src/engine/characters/taiyi.ts`：

```ts
/**
 * 太医院正（常驻女官，确定性派生，不落存档）。姓名取官员姓名池（姓+名），
 * 立绘取 official1–official8（设计 §4.3）。仿 gongli.ts 的派生方式。
 */
import { fnv1a64Hex } from "../save/canonical";
import { pickSurname, pickGivenName } from "../officials/namePool";

export interface CourtPhysician {
  name: string;
  /** 立绘集 id，如 "official3"；对应 manifest portrait.official3.neutral。 */
  portraitSet: string;
}

const OFFICIAL_PORTRAITS = 8;

function hashInt(s: string): number {
  return parseInt(fnv1a64Hex(s).slice(0, 8), 16);
}

/** 常驻太医院正（确定性，按 rngSeed 派生姓名 + 立绘）。 */
export function courtPhysician(rngSeed: number): CourtPhysician {
  const surname = pickSurname(`${rngSeed}:taiyi`, new Set());
  const given = pickGivenName(`${rngSeed}:taiyi`);
  const portraitSet = `official${1 + (hashInt(`${rngSeed}:taiyi:portrait`) % OFFICIAL_PORTRAITS)}`;
  return { name: `${surname}${given}`, portraitSet };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/characters/taiyi.test.ts`
Expected: PASS（3 测试通过）

- [ ] **Step 5: 提交**

```bash
git add src/engine/characters/taiyi.ts tests/characters/taiyi.test.ts
git commit -m "feat: courtPhysician 太医院正确定性派生（官员姓名池 + official1-8 立绘）"
```

---

### Task 3: 看诊纯逻辑 `planPhysicianVisit`

**Files:**
- Create: `src/store/physician.ts`
- Test: `tests/store/physician.test.ts`

**Interfaces:**
- Consumes: `planHealthChange`（`src/store/health.ts`，`HealthSubject`/`HealthChangeInput`）、`healthRoll`/`healthRollRange`（`src/engine/characters/healthRoll.ts`）、`GameTime`、`record_physician_visit` 效果（Task 1）。
- Produces:
  - `physicianMonthKey(cal: { year: number; month: number }): string` → `"{year}:{month}"`
  - `physicianVisitedThisMonth(state: GameState, subject: PhysicianSubject): boolean`
  - `planPhysicianVisit(state: GameState, subject: PhysicianSubject, at: GameTime): { effects: EventEffect[]; healed: number; cured: boolean }`
  - `type PhysicianSubject = { kind: "sovereign" } | { kind: "taihou" } | { kind: "consort"; id: string } | { kind: "heir"; id: string }`（= 复用 `HealthSubject`）

- [ ] **Step 1: 写失败测试**

`tests/store/physician.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { physicianMonthKey, physicianVisitedThisMonth, planPhysicianVisit } from "../../src/store/physician";
import type { GameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
const at: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

describe("physicianMonthKey / visitedThisMonth", () => {
  it("月键 = year:month", () => {
    expect(physicianMonthKey({ year: 3, month: 7 })).toBe("3:7");
  });
  it("未看诊 → false；记录后 → true", () => {
    const s0 = createNewGameState(db);
    expect(physicianVisitedThisMonth(s0, { kind: "sovereign" })).toBe(false);
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subjectKind: "sovereign", monthKey: "1:1" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(physicianVisitedThisMonth(r.value, { kind: "sovereign" })).toBe(true);
  });
});

describe("planPhysicianVisit", () => {
  it("healthy：加血 5–10、不改状态、记录月键", () => {
    const s0 = createNewGameState(db);
    // 把皇帝健康压到 50 以便观察加血
    const seeded = applyEffects(db, s0, [{ type: "set_sovereign_health", healthDelta: -20 }]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const before = seeded.value.resources.sovereign.health;
    const plan = planPhysicianVisit(seeded.value, { kind: "sovereign" }, at);
    expect(plan.healed).toBeGreaterThanOrEqual(5);
    expect(plan.healed).toBeLessThanOrEqual(10);
    expect(plan.cured).toBe(false);
    const r = applyEffects(db, seeded.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.health).toBe(Math.min(100, before + plan.healed));
    expect(r.value.resources.sovereign.healthStatus).toBe("healthy");
    expect(r.value.resources.sovereign.lastPhysicianVisitMonthKey).toBe("1:1");
  });

  it("sick：治愈与否随 seed 确定；治愈则状态转 healthy", () => {
    const s0 = createNewGameState(db);
    // 皇帝置 sick
    const sick = applyEffects(db, s0, [{ type: "set_sovereign_health", healthStatus: "sick" }]);
    expect(sick.ok).toBe(true);
    if (!sick.ok) return;
    const plan = planPhysicianVisit(sick.value, { kind: "sovereign" }, at);
    const r = applyEffects(db, sick.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // cured 字段与落地状态一致
    expect(r.value.resources.sovereign.healthStatus).toBe(plan.cured ? "healthy" : "sick");
  });
});
```

> 注：`set_sovereign_health` 是 uncapped 漏斗效果，已存在；测试用它造初态。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/physician.test.ts`
Expected: FAIL（`physician.ts` 不存在）

- [ ] **Step 3: 实现 `physician.ts`**

`src/store/physician.ts`：

```ts
/**
 * 召见太医·看诊纯逻辑（设计 §4）：加血 5–10、按概率治病、记录本月已请脉月键。
 * 全部健康变更经 planHealthChange（§1.4 funnel），看诊本身只追加月键记录效果。
 */
import { healthRoll, healthRollRange } from "../engine/characters/healthRoll";
import type { GameTime } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, HealthStatus } from "../engine/state/types";
import { planHealthChange, type HealthSubject } from "./health";

export type PhysicianSubject = HealthSubject;

export function physicianMonthKey(cal: { year: number; month: number }): string {
  return `${cal.year}:${cal.month}`;
}

function subjectKeyOf(s: PhysicianSubject): string {
  return s.kind === "sovereign" ? "sovereign" : s.kind === "taihou" ? "taihou" : s.id;
}

function currentStatusOf(state: GameState, s: PhysicianSubject): HealthStatus | null {
  switch (s.kind) {
    case "sovereign": return state.resources.sovereign.healthStatus;
    case "taihou": return state.taihou.healthStatus;
    case "consort": return state.standing[s.id]?.healthStatus ?? "healthy";
    case "heir": return state.resources.bloodline.heirs.find((h) => h.id === s.id)?.healthStatus ?? "healthy";
  }
}

export function physicianVisitedThisMonth(state: GameState, s: PhysicianSubject): boolean {
  const key = physicianMonthKey(state.calendar);
  switch (s.kind) {
    case "sovereign": return state.resources.sovereign.lastPhysicianVisitMonthKey === key;
    case "taihou": return state.taihou.lastPhysicianVisitMonthKey === key;
    case "consort": return state.standing[s.id]?.lastPhysicianVisitMonthKey === key;
    case "heir": return state.resources.bloodline.heirs.find((h) => h.id === s.id)?.lastPhysicianVisitMonthKey === key;
  }
}

/**
 * 一次看诊：加血 +healthRollRange(5,10)，sick 50% / critical 30% 命中治愈，
 * 末尾追加 record_physician_visit。effects 经 store.resolveTimedAction 落地。
 */
export function planPhysicianVisit(
  state: GameState,
  subject: PhysicianSubject,
  at: GameTime,
): { effects: EventEffect[]; healed: number; cured: boolean } {
  const seed = `physician:${state.rngSeed}:${subjectKeyOf(subject)}:${state.calendar.year}:${state.calendar.month}`;
  const status = currentStatusOf(state, subject) ?? "healthy";
  const healed = healthRollRange(`${seed}:heal`, 5, 10);
  let cured = false;
  if (status === "sick") cured = healthRoll(`${seed}:cure`) < 50;
  else if (status === "critical") cured = healthRoll(`${seed}:cure`) < 30;

  const { effects } = planHealthChange(state, {
    subject,
    healthDelta: healed,
    ...(cured ? { healthStatus: "healthy" as HealthStatus } : {}),
    cause: "scripted",
    at,
  });

  const monthKey = physicianMonthKey(state.calendar);
  effects.push({
    type: "record_physician_visit",
    subjectKind: subject.kind,
    ...(subject.kind === "consort" || subject.kind === "heir" ? { subjectId: subject.id } : {}),
    monthKey,
  });

  return { effects, healed, cured };
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/store/physician.test.ts && npx tsc --noEmit`
Expected: PASS（4 测试），tsc 无错。

- [ ] **Step 5: 提交**

```bash
git add src/store/physician.ts tests/store/physician.test.ts
git commit -m "feat: planPhysicianVisit 看诊纯逻辑（加血5-10 + 治愈概率 + 月键记录）"
```

---

### Task 4: manifest 太医立绘条目

**Files:**
- Modify: `assets/manifest.json`（增 `portrait.official1.neutral`–`official8.neutral`）
- Test: `tests/assets/officialPortraitManifest.test.ts`

**Interfaces:**
- Produces: manifest 中 `portrait.official{1..8}.neutral` 可被 `registry.portrait("officialN", "neutral")` 解析。

> 先读 `assets/manifest.json` 现有 `portrait.gongli*` / `portrait.official*` 条目，**逐字照搬其键格式与字段**（路径前缀、文件名规则）。official 立绘文件已存在于 `public/assets/portraits/official/official1.png`–`official8.png`。

- [ ] **Step 1: 写失败测试**

`tests/assets/officialPortraitManifest.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import manifest from "../../assets/manifest.json";

describe("official 立绘 manifest", () => {
  it("official1..official8 的 neutral 条目齐备", () => {
    const portraits = (manifest as { portrait?: Record<string, unknown> }).portrait ?? {};
    for (let i = 1; i <= 8; i++) {
      expect(portraits[`official${i}`], `official${i} 缺失`).toBeDefined();
      expect((portraits[`official${i}`] as Record<string, unknown>).neutral).toBeDefined();
    }
  });
});
```

> 若 manifest 顶层结构不是 `{ portrait: { officialN: { neutral } } }`，按 Step 0 读到的真实结构调整断言路径（保持「8 个 official 各有 neutral」语义）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/assets/officialPortraitManifest.test.ts`
Expected: FAIL（official 条目缺失）

- [ ] **Step 3: 补 manifest 条目**

按 `gongli*`/既有 `official*` 同格式，在 `assets/manifest.json` 增 `official1`–`official8` 的 `neutral` 条目（指向 `assets/portraits/official/officialN.png`，路径前缀照搬现有条目）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/assets/officialPortraitManifest.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add assets/manifest.json tests/assets/officialPortraitManifest.test.ts
git commit -m "feat: manifest 增太医立绘 official1-8 neutral 条目"
```

---

### Task 5: PhysicianModal 四类看诊 UI + App 接线

**Files:**
- Modify: `src/ui/components/PhysicianModal.tsx`（保留流胎；增看诊区）
- Modify: `src/ui/App.tsx`（看诊 handler + 太医 reaction + 传 props）
- Test: `tests/ui/physicianModal.test.tsx`（组件渲染/禁用态）

**Interfaces:**
- Consumes: `planPhysicianVisit`/`physicianVisitedThisMonth`（Task 3）、`courtPhysician`（Task 2）、`store.resolveTimedAction`、`livingConsortIds`（`src/store/healthRoster.ts`）、`CharacterReactionScreen`（已存在，props：`registry, portraitSet, speakerName, lines, onDone`）。
- Produces: 看诊耗 1 AP，落地后弹太医 reaction。

> **UI 任务测试现实**：完整交互难纯单测；本任务用 React Testing Library 测「按钮禁用态/标签」可达的部分，并附人工验证步骤。先读 `src/ui/components/HeirListModal.tsx` 与 `src/ui/components/ConsortListModal.tsx` 学习本项目 picker/modal 的写法（className、`registry.portrait`、列表项结构），保持一致。

- [ ] **Step 1: 写组件失败测试**

`tests/ui/physicianModal.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhysicianModal } from "../../src/ui/components/PhysicianModal";

// 看诊对象项：当月已请脉则禁用并显示静养提示
describe("PhysicianModal 看诊区", () => {
  const noop = () => {};
  it("AP 不足时四个看诊按钮禁用", () => {
    render(
      <PhysicianModal
        selfCarrying={false}
        consortCarrying={false}
        physicianName="林安"
        consults={[
          { key: "sovereign", label: "为陛下诊脉", disabled: true, disabledReason: "行动点不足" },
          { key: "taihou", label: "给太后请脉", disabled: true, disabledReason: "行动点不足" },
        ]}
        onConsult={noop}
        onPickConsort={noop}
        onPickHeir={noop}
        onAbort={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /为陛下诊脉/ })).toBeDisabled();
  });

  it("当月已请脉显示静养提示", () => {
    render(
      <PhysicianModal
        selfCarrying={false}
        consortCarrying={false}
        physicianName="林安"
        consults={[
          { key: "sovereign", label: "为陛下诊脉", disabled: true, disabledReason: "本月已请脉，太医嘱静养" },
        ]}
        onConsult={noop}
        onPickConsort={noop}
        onPickHeir={noop}
        onAbort={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText(/本月已请脉/)).toBeInTheDocument();
  });
});
```

> 检查项目是否已配 `@testing-library/react` + jsdom（看 `package.json` / `vitest.config`）。若未配置组件测试环境，则**改为**对一个纯函数 `buildConsultOptions(state, db, at)`（放 `src/store/physician.ts`）写单测——它返回 `{ key, label, disabled, disabledReason? }[]`，把禁用判定逻辑（AP/本月已请脉/对象存活）抽成可单测纯函数，UI 仅渲染该结果。**优先此纯函数路线**以保证可测性。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/ui/physicianModal.test.tsx`
Expected: FAIL

- [ ] **Step 3: 抽 `buildConsultOptions` 纯函数（保证可测）**

在 `src/store/physician.ts` 增：

```ts
import { livingConsortIds } from "./healthRoster";
import type { ContentDB } from "../engine/content/loader";

export interface ConsultOption {
  key: "sovereign" | "taihou" | "consort" | "heir";
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

/** 四类看诊入口的可用性（AP 充足 + 本月未请脉 + 对象存在/存活）。 */
export function buildConsultOptions(db: ContentDB, state: GameState): ConsultOption[] {
  const apOk = state.calendar.ap >= 1;
  const opt = (key: ConsultOption["key"], label: string, subject: PhysicianSubject | null): ConsultOption => {
    if (!apOk) return { key, label, disabled: true, disabledReason: "行动点不足" };
    if (subject && physicianVisitedThisMonth(state, subject)) return { key, label, disabled: true, disabledReason: "本月已请脉，太医嘱静养" };
    return { key, label, disabled: false };
  };
  const hasConsort = livingConsortIds(db, state).length > 0;
  const hasHeir = state.resources.bloodline.heirs.some((h) => h.lifecycle === "alive");
  return [
    opt("sovereign", "为陛下诊脉", { kind: "sovereign" }),
    opt("taihou", "给太后请脉", state.taihou.deceased === true ? { kind: "taihou" } : { kind: "taihou" }),
    hasConsort ? opt("consort", "给侍君请脉", null) : { key: "consort", label: "给侍君请脉", disabled: true, disabledReason: "宫中无在世侍君" },
    hasHeir ? opt("heir", "给皇嗣请脉", null) : { key: "heir", label: "给皇嗣请脉", disabled: true, disabledReason: "暂无在世皇嗣" },
  ];
}
```

> 太后已薨时其看诊项应禁用（文案「太后已驾鹤西去」）；上面占位，**实现时**对 `state.taihou.deceased === true` 返回 `{ disabled: true, disabledReason: "太后已驾鹤西去" }`。侍君/皇嗣项 disabled 仅判 AP（具体某人本月是否已请脉在 picker 内逐项判，见 Step 5）。

把 Step 1 测试改写为针对 `buildConsultOptions` 的单测（造 AP=0 / 已请脉 / 无侍君 等态，断言 `disabled` + `disabledReason`）。

- [ ] **Step 4: 扩 `PhysicianModal.tsx`**

保留现有流胎三分支；在「陛下凤体康健」分支位置改为渲染看诊区：太医名抬头、四个看诊按钮（`consults` 数组驱动，`disabled` + 悬停/副文案显示 `disabledReason`），侍君/皇嗣按钮点击触发 `onPickConsort`/`onPickHeir`（弹各自 picker），陛下/太后按钮点击触发 `onConsult("sovereign"|"taihou")`。Props 扩展：

```ts
export function PhysicianModal({
  selfCarrying, consortCarrying, physicianName, consults,
  onConsult, onPickConsort, onPickHeir, onAbort, onClose,
}: {
  selfCarrying: boolean; consortCarrying: boolean;
  physicianName: string;
  consults: { key: "sovereign" | "taihou" | "consort" | "heir"; label: string; disabled: boolean; disabledReason?: string }[];
  onConsult: (key: "sovereign" | "taihou") => void;
  onPickConsort: () => void; onPickHeir: () => void;
  onAbort: () => void; onClose: () => void;
}) { /* ... */ }
```

流胎逻辑优先级不变（`selfCarrying` 时仍只展示流胎；`consortCarrying` 不可弃；二者皆否时展示看诊区——**调整**：看诊区应在「非自孕」时常驻，流胎区与看诊区可共存。实现时把流胎入口收为看诊区内一个附加按钮/区块，避免「自孕时无法看诊」。保持文案现状。）

- [ ] **Step 5: App 接线看诊 handler**

`src/ui/App.tsx`：
- 引入 `import { courtPhysician } from "../engine/characters/taiyi";`、`import { planPhysicianVisit, buildConsultOptions, type PhysicianSubject } from "../store/physician";`
- 算 `const physician = courtPhysician(liveState.rngSeed);`
- 增 `physicianReaction` 状态（仿 `childReaction` 的渲染）：

```tsx
const [physicianReaction, setPhysicianReaction] = useState<{ portraitSet: string; speakerName: string; lines: string[] } | null>(null);
```

- 看诊执行：

```tsx
const doConsult = (subject: PhysicianSubject) => {
  const at = { ...liveState.calendar, dayIndex: liveState.calendar.dayIndex };
  const plan = planPhysicianVisit(liveState, subject, at);
  const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
  if (!settled.ok) return;
  if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
  setPhysicianOpen(false);
  doAutosave();
  const lines = plan.cured
    ? ["太医诊脉施治，药石见效，病气已退。"]
    : [`太医诊脉施治，调理一番，气色稍复（健康 +${plan.healed}）。`];
  setPhysicianReaction({ portraitSet: physician.portraitSet, speakerName: physician.name, lines });
  if (settled.value.rolledOver) setReactionRollover(true);
};
```

- `PhysicianModal` 传 `physicianName={physician.name}`、`consults={buildConsultOptions(db, liveState)}`、`onConsult={(k) => doConsult({ kind: k })}`、`onPickConsort`/`onPickHeir` 打开各自 picker（picker 选中后 `doConsult({ kind: "consort", id })` / `{ kind: "heir", id }`）。侍君 picker 复用 `ConsortListModal` 或新建轻量 picker（显示健康 chip，§9）；皇嗣 picker 复用 `HeirListModal` 思路。**picker 内逐项**用 `physicianVisitedThisMonth(liveState, subject)` 决定该人是否禁选。
- 渲染太医 reaction（仿 1473 `childReaction` 块新增一段）：

```tsx
{physicianReaction && (
  <CharacterReactionScreen
    db={db} store={store} registry={registry}
    portraitSet={physicianReaction.portraitSet}
    speakerName={physicianReaction.speakerName}
    lines={physicianReaction.lines}
    onDone={() => {
      setPhysicianReaction(null);
      if (reactionRollover) { setReactionRollover(false); /* 转旬提示照现有逻辑 */ }
    }}
  />
)}
```

> `onDone` 的转旬/队列衔接照 `childReaction` 现有 `onDone` 逻辑同款处理（读那段并对齐）。

- [ ] **Step 6: 跑组件/纯函数测试 + 类型检查 + 构建**

Run: `npx vitest run tests/ui/physicianModal.test.tsx && npx tsc --noEmit && npx vite build`
Expected: PASS，tsc 无错，build OK。

- [ ] **Step 7: 人工验证（记录于报告）**

- 御书房「召见太医」→ 弹四类看诊；为陛下/太后/侍君/皇嗣各请脉，AP −1，加血，弹太医立绘台词。
- 同月对同一对象再请脉 → 该项禁用、提示「本月已请脉」。
- 重病皇帝看诊 30% 治愈、生病 50% 治愈（多次试感受）。
- AP=0 时四项皆禁用。流胎流程仍可用。

- [ ] **Step 8: 提交**

```bash
git add src/ui/components/PhysicianModal.tsx src/ui/App.tsx src/store/physician.ts tests/ui/physicianModal.test.tsx
git commit -m "feat: 太医四类看诊 UI + 接线（每月每人一次/各1AP/加血治病/立绘台词）"
```

---

### Task 6: 月度承养健康成本接线（`pregnancyMonthlyCost`）

**Files:**
- Modify: `src/store/healthTick.ts`（侍君遍历传 `pregnancyMonthlyCost`）
- Test: `tests/store/healthTickPregnancy.test.ts`

**Interfaces:**
- Consumes: `state.resources.bloodline.gestations`（`carrier === consortId` 即承孕）。
- Produces: 承孕侍君月度 tick 多扣 `rand(0–5)`（`projectMonthlyHealth` 步骤 1，已实现，仅接线）。

- [ ] **Step 1: 写失败测试**

`tests/store/healthTickPregnancy.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildMonthlyHealthTick } from "../../src/store/healthTick";
import { projectMonthlyHealth } from "../../src/store/healthTick";

const db = loadGameContent();

describe("月度承养健康成本接线", () => {
  it("承孕侍君的 tick 投影 pregnancyMonthlyCost=true（比无孕多扣 0–5）", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased")!;
    // 造一条该侍君承养的胎息
    const s = structuredClone(s0);
    s.standing[cid]!.health = 80;
    s.standing[cid]!.healthStatus = "healthy";
    s.resources.bloodline.gestations.push({
      carrier: cid,
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      fatherId: cid,
      transferredAtMonth: 1,
    });
    // 跑一次 tick，验证该侍君对应 set_consort_health 的 delta ≤ 无孕情形
    const withPreg = projectMonthlyHealth({ health: 80, status: "healthy", age: 25, isYearStart: false, pregnancyMonthlyCost: true, seedKey: `tick:${s.rngSeed}:${cid}:1:1` });
    const withoutPreg = projectMonthlyHealth({ health: 80, status: "healthy", age: 25, isYearStart: false, pregnancyMonthlyCost: false, seedKey: `tick:${s.rngSeed}:${cid}:1:1` });
    expect(withPreg.nextHealth).toBeLessThanOrEqual(withoutPreg.nextHealth);
    // tick orchestrator 对该承孕侍君应传 pregnancyMonthlyCost=true（通过结果一致性间接验证）
    const tick = buildMonthlyHealthTick(db, s);
    const consortHealthFx = tick.effects.find(
      (e) => e.type === "set_consort_health" && (e as { char: string }).char === cid,
    ) as { healthDelta?: number } | undefined;
    // 承孕 + 可能病损，delta 应 ≤ 0（若有变更）
    if (consortHealthFx?.healthDelta !== undefined) expect(consortHealthFx.healthDelta).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/healthTickPregnancy.test.ts`
Expected: FAIL（orchestrator 仍硬编码 `pregnancyMonthlyCost: false`，承孕侍君未多扣 → 断言不稳/不符）

> 若该测试因随机性偶发通过，先临时把断言改为「`buildMonthlyHealthTick` 对承孕侍君的 seedKey `:preg` 掷骰被使用」更确定的形式；实现后恢复。

- [ ] **Step 3: 接线 carrier 检测**

`src/store/healthTick.ts` 侍君遍历（约第 109–128 行）改：

```ts
  for (const consortId of livingConsortIds(db, state)) {
    const seedKey = `tick:${rngSeed}:${consortId}:${year}:${month}`;
    const age = currentAgeOf(db, state, { kind: "consort", id: consortId });
    const st = state.standing[consortId];
    const health = st?.health ?? 100;
    const status = st?.healthStatus ?? "healthy";
    const carrying = state.resources.bloodline.gestations.some((g) => g.carrier === consortId);
    const out = projectMonthlyHealth({ health, status, age, isYearStart, pregnancyMonthlyCost: carrying, seedKey });
    /* ...其余不变... */
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/store/healthTickPregnancy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/healthTick.ts tests/store/healthTickPregnancy.test.ts
git commit -m "feat: 月度 tick 接线承养侍君怀孕成本（pregnancyMonthlyCost）"
```

---

### Task 7: 转胎健康成本 −10（`planPregnancyTransfer`）

**Files:**
- Create: `src/store/pregnancyCost.ts`
- Modify: `src/ui/App.tsx`（`transferTo` 用新组装）
- Test: `tests/store/pregnancyCost.test.ts`

**Interfaces:**
- Consumes: `planHealthChange`、现有 `pregnancy_transfer` 效果（`{ type: "pregnancy_transfer"; carrierId; atMonth }`）。
- Produces: `planPregnancyTransfer(state, carrierId: string, atMonth: number, at: GameTime): EventEffect[]` = `[pregnancy_transfer, ...planHealthChange(consort, −10, cause "pregnancy")]`（顺序：先转胎落库，再扣血）。

- [ ] **Step 1: 写失败测试**

`tests/store/pregnancyCost.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { planPregnancyTransfer } from "../../src/store/pregnancyCost";
import type { GameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
const at: GameTime = { year: 1, month: 5, period: "early", dayIndex: 120 };

function withSovereignGestation(carrierId: string) {
  const s = createNewGameState(db);
  s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [carrierId] };
  s.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt: { year: 1, month: 3, period: "early", dayIndex: 60 } }];
  s.standing[carrierId]!.health = 70;
  s.standing[carrierId]!.healthStatus = "healthy";
  return s;
}

describe("planPregnancyTransfer", () => {
  it("转胎落到侍君并扣 10 健康", () => {
    const s = withSovereignGestation(/* 取一个在世侍君 id */ Object.keys(createNewGameState(db).standing)[0]!);
    const carrierId = s.resources.bloodline.pregnancy.candidateIds[0]!;
    const effects = planPregnancyTransfer(s, carrierId, 3, at);
    const r = applyEffects(db, s, effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(true);
    expect(r.value.standing[carrierId]!.health).toBe(60); // 70 − 10
  });

  it("转胎扣血致 0 → 侍君立即死亡 + 断胎（无新皇嗣）", () => {
    const s = withSovereignGestation(Object.keys(createNewGameState(db).standing)[0]!);
    const carrierId = s.resources.bloodline.pregnancy.candidateIds[0]!;
    s.standing[carrierId]!.health = 6; // 6 − 10 → ≤ 0
    const effects = planPregnancyTransfer(s, carrierId, 3, at);
    const r = applyEffects(db, s, effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[carrierId]!.lifecycle).toBe("deceased");
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(false); // 断胎
    expect(r.value.pendingAftermath.some((a) => a.subjectId === carrierId)).toBe(true);
  });
});
```

> 实现 Step 1 前先读 `App.tsx` 现有 `transferTo`（约第 850–860 行）确认它当前如何 dispatch `pregnancy_transfer`（carrierId / atMonth 取值），照搬其参数来源。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/pregnancyCost.test.ts`
Expected: FAIL（`pregnancyCost.ts` 不存在）

- [ ] **Step 3: 实现 `pregnancyCost.ts`**

```ts
/** 怀孕健康成本（设计 §5）：转胎 −10、生产 −5/−10，全经 planHealthChange 即时死亡不变量。 */
import type { GameTime } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import { planHealthChange } from "./health";

/** 转胎落到侍君：先 pregnancy_transfer 落库，再对该侍君扣 10 健康（cause pregnancy）。 */
export function planPregnancyTransfer(
  state: GameState,
  carrierId: string,
  atMonth: number,
  at: GameTime,
): EventEffect[] {
  const { effects: costFx } = planHealthChange(state, {
    subject: { kind: "consort", id: carrierId },
    healthDelta: -10,
    cause: "pregnancy",
    at,
  });
  return [{ type: "pregnancy_transfer", carrierId, atMonth }, ...costFx];
}

/** 生产母方健康成本：safe → −5；child_dies → −10；bearer_dies/both → 0（已亡，不追加）。 */
export function childbirthCostDelta(bearerOutcome: "safe" | "child_dies" | "bearer_dies" | "both"): number {
  if (bearerOutcome === "safe") return -5;
  if (bearerOutcome === "child_dies") return -10;
  return 0;
}
```

> `pregnancy_transfer` 的字段名（`carrierId`/`atMonth`）以 `eventEffectSchema` 第 198–201 行为准；若不同则照实改。

- [ ] **Step 4: App `transferTo` 改用 `planPregnancyTransfer`**

`src/ui/App.tsx` 的 `transferTo`：把原本 dispatch `pregnancy_transfer` 单效果，改为 `store.applyEffects(db, planPregnancyTransfer(liveState, carrierId, atMonth, toGameTime(liveState.calendar)))`（atMonth/carrierId 取原值）。转胎若致死，落地后 `pendingAftermath` 增条，照现有身后事入队机制（Phase 2）流转——本期不弹 UI（`FEATURE_AFTERMATH_UI` 仍关闭），但状态正确。

- [ ] **Step 5: 跑测试确认通过 + 类型 + 构建**

Run: `npx vitest run tests/store/pregnancyCost.test.ts && npx tsc --noEmit && npx vite build`
Expected: PASS，tsc 无错，build OK。

- [ ] **Step 6: 提交**

```bash
git add src/store/pregnancyCost.ts src/ui/App.tsx tests/store/pregnancyCost.test.ts
git commit -m "feat: 转胎 −10 健康成本（致死即断胎）+ childbirthCostDelta 辅助"
```

---

### Task 8: 生产健康成本 −5/−10（接入 `buildBirth`）

**Files:**
- Modify: `src/store/gestation.ts`（`buildBirth` 追加成本效果）
- Test: `tests/store/birthCost.test.ts`

**Interfaces:**
- Consumes: `childbirthCostDelta`（Task 7）、`planHealthChange`。
- Produces: `buildBirth` 返回的 `effects` 在 `birth` 效果**之后**追加母方 `set_consort_health` 成本（仅非自孕、母方生还时）；扣血致死则 birth 已落库皇嗣，母方走身后事（已产存嗣，§6.5）。

- [ ] **Step 1: 写失败测试**

`tests/store/birthCost.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { buildBirth } from "../../src/store/gestation";

const db = loadGameContent();

/** 造一条「即将由侍君生产」的胎息（具体字段以 gestation/birth 现状为准，实现时对齐）。 */
function withConsortDueBirth(opts: { health: number }) {
  const s = createNewGameState(db);
  const cid = Object.keys(s.standing).find((id) => s.standing[id]!.lifecycle !== "deceased")!;
  s.standing[cid]!.health = opts.health;
  s.standing[cid]!.healthStatus = "healthy";
  s.standing[cid]!.lifecycle = "carrying";
  // conceivedAt 取足月前的月份，使 dueGestation 命中（实现时按 gestationConfig 校准月份/slot）
  s.resources.bloodline.gestations = [{ carrier: cid, conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, fatherId: cid, transferredAtMonth: 1 }];
  // 推进日历到生产月（实现时用 plannedBirthOf 求月并设置 calendar）
  return { s, cid };
}

describe("生产健康成本", () => {
  it("顺产(safe)：母方 −5，皇嗣存活", () => {
    const { s, cid } = withConsortDueBirth({ health: 80 });
    const plan = buildBirth(db, s)!;
    expect(plan).not.toBeNull();
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (plan.bearerOutcome === "safe") {
      expect(r.value.standing[cid]!.health).toBe(75); // 80 − 5
      expect(r.value.resources.bloodline.heirs.length).toBe(1);
    }
  });

  it("生产扣血致 0：皇嗣已落库存活，母方进身后事（safe 且 health=5 → −5 = 0）", () => {
    const { s, cid } = withConsortDueBirth({ health: 5 });
    const plan = buildBirth(db, s)!;
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (plan.bearerOutcome === "safe") {
      expect(r.value.resources.bloodline.heirs.length).toBe(1); // 已产存嗣
      expect(r.value.standing[cid]!.lifecycle).toBe("deceased"); // 母亡
    }
  });
});
```

> **生产裁决依赖随机**（`bearerOutcome` 由 seed 决定）。测试用 `if (plan.bearerOutcome === "safe")` 守卫断言，避免脆弱；并加一条直接对 `childbirthCostDelta` 的纯断言（safe→−5、child_dies→−10、bearer_dies/both→0）补足覆盖。实现时按 `plannedBirthOf` 校准日历使 `dueGestation` 命中（参照 `tests` 中既有 birth 测试的造态方式——先 grep `tests/` 找现成 helper 复用）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/birthCost.test.ts`
Expected: FAIL（`buildBirth` 未追加成本，母方 health 不变）

- [ ] **Step 3: `buildBirth` 追加成本效果**

`src/store/gestation.ts` 的 `buildBirth`，在 `return { effects: [ { type: "birth", ... } ], ... }` 处，把 effects 改为「birth 效果 + 母方成本效果」：

```ts
  const birthEffect: EventEffect = {
    type: "birth",
    sex: verdict.sex,
    fatherId: verdict.fatherId,
    bearer: verdict.bearer,
    legitimate: verdict.legitimate,
    favor: verdict.favor,
    bearerOutcome: verdict.bearerOutcome,
    ...(recover !== undefined ? { recoverUntilMonth: recover } : {}),
  };

  const bearerSurvives = verdict.bearerOutcome === "safe" || verdict.bearerOutcome === "child_dies";
  const costDelta = childbirthCostDelta(verdict.bearerOutcome);
  const costFx =
    gest.carrier !== "sovereign" && bearerSurvives && costDelta !== 0
      ? planHealthChange(state, {
          subject: { kind: "consort", id: gest.carrier },
          healthDelta: costDelta,
          cause: "childbirth",
          at: now,
        }).effects
      : [];

  return {
    effects: [birthEffect, ...costFx],   // 先落库皇嗣，再扣母方（§5 顺序）
    lines,
    bearer: gest.carrier,
    bearerOutcome: verdict.bearerOutcome,
  };
```

加 import：`import { childbirthCostDelta } from "./pregnancyCost"; import { planHealthChange } from "./health";`

> 注意：`planHealthChange` 在此读的是**生产前** state（母方仍 carrying/normal、未亡），故 `isDeceased` 守卫不误杀；`set_consort_health` apply 在 birth 之后执行（数组顺序），若成本致 0 则其内部产出的 `consort_decease` 把母方置 deceased——皇嗣已由前面的 birth 效果落库，符合「已产存嗣仅母亡」。

- [ ] **Step 4: 跑测试确认通过 + 类型 + 构建**

Run: `npx vitest run tests/store/birthCost.test.ts && npx tsc --noEmit && npx vite build`
Expected: PASS，tsc 无错，build OK。

- [ ] **Step 5: 提交**

```bash
git add src/store/gestation.ts tests/store/birthCost.test.ts
git commit -m "feat: 生产健康成本 −5/−10（先落库皇嗣再扣母方，已产存嗣仅母亡）"
```

---

### Task 9: gating 纯函数 `canHoldCourt` / `canBedchamber`（重病 + 服丧）

**Files:**
- Create: `src/store/gating.ts`
- Test: `tests/store/gating.test.ts`

**Interfaces:**
- Consumes: `state.resources.sovereign.healthStatus`、`state.taihou.{deceased, mourningUntilDayExclusive}`、`state.calendar.dayIndex`。
- Produces:
  - `type GateResult = { ok: true } | { ok: false; reason: string }`
  - `canHoldCourt(state: GameState): GateResult`
  - `canBedchamber(state: GameState): GateResult`

- [ ] **Step 1: 写失败测试**

`tests/store/gating.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { canHoldCourt, canBedchamber } from "../../src/store/gating";

const db = loadGameContent();

describe("gating：皇帝重病 + 太后服丧", () => {
  it("健康且无丧 → 放行", () => {
    const s = createNewGameState(db);
    expect(canHoldCourt(s).ok).toBe(true);
    expect(canBedchamber(s).ok).toBe(true);
  });

  it("皇帝重病 → 上朝/侍寝均禁，文案含凤体违和", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和");
    expect(canBedchamber(s).ok).toBe(false);
  });

  it("太后服丧窗口内 → 禁；窗口外 → 放行", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3; // 当日起 3 个行动日
    expect(canHoldCourt(s).ok).toBe(false);
    const after = structuredClone(s);
    after.calendar.dayIndex = s.calendar.dayIndex + 3; // 达到独占上界
    expect(canHoldCourt(after).ok).toBe(true);
  });

  it("重病 + 服丧叠加 → 禁，主因显示重病", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3;
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和"); // 重病优先
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/gating.test.ts`
Expected: FAIL（`gating.ts` 不存在）

- [ ] **Step 3: 实现 `gating.ts`**

```ts
/**
 * 上朝 / 侍寝 gating（设计 §8）：皇帝重病 + 太后服丧，任一成立即禁；重病优先显示。
 * 纯函数，UI 与入口逻辑共用，便于叠加场景单测。
 */
import type { GameState } from "../engine/state/types";

export type GateResult = { ok: true } | { ok: false; reason: string };

const SOVEREIGN_CRITICAL = "陛下凤体违和，太医请陛下静养。";
const TAIHOU_MOURNING = "国丧期间，举哀守制，不宜临朝侍寝。";

function blockReason(state: GameState): string | null {
  if (state.resources.sovereign.healthStatus === "critical") return SOVEREIGN_CRITICAL; // 重病优先
  if (
    state.taihou.deceased === true &&
    state.taihou.mourningUntilDayExclusive !== undefined &&
    state.calendar.dayIndex < state.taihou.mourningUntilDayExclusive
  ) {
    return TAIHOU_MOURNING;
  }
  return null;
}

export function canHoldCourt(state: GameState): GateResult {
  const r = blockReason(state);
  return r ? { ok: false, reason: r } : { ok: true };
}

export function canBedchamber(state: GameState): GateResult {
  const r = blockReason(state);
  return r ? { ok: false, reason: r } : { ok: true };
}
```

> 上朝与侍寝当前禁因相同，故共用 `blockReason`；若日后分化（如重病可临朝不可侍寝）再拆。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/store/gating.test.ts`
Expected: PASS（4 测试）

- [ ] **Step 5: 提交**

```bash
git add src/store/gating.ts tests/store/gating.test.ts
git commit -m "feat: canHoldCourt/canBedchamber gating 纯函数（皇帝重病 + 太后服丧叠加）"
```

---

### Task 10: gating 接入 App（上朝 / 侍寝入口）

**Files:**
- Modify: `src/ui/App.tsx`（`beginCourt` / `startEvent("ev_chaohui")` 与侍寝入口接 gating；按钮禁用 + 文案）
- Test: 人工验证为主；若 Step 3 抽出可测 selector 则补单测。

**Interfaces:**
- Consumes: `canHoldCourt`/`canBedchamber`（Task 9）。

> 先读 `App.tsx`：`beginCourt`（约 207）、`startEvent`（约 191，`ev_chaohui` 分支）、上朝按钮所在屏（`LocationScreen`/主界面，grep `ev_chaohui` / 上朝）、侍寝入口（`onSummon`/`BedchamberPicker`/翻牌 按钮）。确认按钮 disabled 与点击两处都接 gating（双保险）。

- [ ] **Step 1: `beginCourt` 守卫**

`beginCourt` 顶部加：

```ts
  const gate = canHoldCourt(store.getState());
  if (!gate.ok) { setReaction({ speakerId: "wei_sui", lines: [gate.reason] }); return; }
```

（放在现有 AP 校验之前；用既有旁白角色 `wei_sui` 播一句拦截文案。）import `canHoldCourt`。

- [ ] **Step 2: 上朝按钮禁用 + 提示**

上朝入口按钮（`LocationScreen` 或主界面对应处）：`disabled = !canHoldCourt(liveState).ok`，并把 `canHoldCourt(liveState)` 的 reason 作为禁用提示（title/副文案），与既有 AP 禁用并列。

- [ ] **Step 3: 侍寝入口守卫 + 禁用**

侍寝（翻牌子 / `BedchamberPicker` 打开入口）：打开前 `const g = canBedchamber(liveState); if (!g.ok) { setReaction({ speakerId: "wei_sui", lines: [g.reason] }); return; }`；对应按钮 `disabled = !canBedchamber(liveState).ok` + reason 提示。import `canBedchamber`。

> 若侍寝入口已有「皇帝/对象状态」类禁用，**叠加**本 gating，不替换。

- [ ] **Step 4: 类型检查 + 构建 + 人工验证**

Run: `npx tsc --noEmit && npx vite build`
Expected: tsc 无错，build OK。

人工验证（记录于报告）：
- 把皇帝 `healthStatus` 调 `critical`（debug 入口或临时存档）→ 上朝、侍寝按钮禁用且点击有拦截文案。
- 太后死亡后服丧 3 个行动日内 → 上朝/侍寝禁；满 3 日后恢复。
- 两者叠加时显示「凤体违和」（重病优先）。

- [ ] **Step 5: 提交**

```bash
git add src/ui/App.tsx
git commit -m "feat: 上朝/侍寝接入重病+服丧 gating（按钮禁用 + 拦截文案）"
```

---

## 最终整支审查

10 个任务完成后，按 subagent-driven-development 派最强模型做整支审查（`scripts/review-package $(git merge-base main HEAD) HEAD`）。重点核对 §12 测试要点跨任务不变量：看诊每月每人一次幂等、读档不重掷（seedKey 稳定）、转胎/生产扣血致 0 即时死亡且断胎/存嗣正确、重病+服丧 gating 叠加、承养月度成本接线、太医确定性派生、manifest 立绘齐备。

整支审查后用 superpowers:finishing-a-development-branch 收尾（开 PR，base = `main`）。

---

## Self-Review（plan vs spec）

**1. Spec coverage（§4/§5/§8/§11 Phase 3 项）：**
- §4.1 四类看诊入口/各 1 AP → T5（`buildConsultOptions` + UI + `doConsult` via `resolveTimedAction`）。✓
- §4.2 每月每人一次 → T1（`lastPhysicianVisitMonthKey` 字段 + `record_physician_visit`）+ T3（`physicianVisitedThisMonth`）+ T5（picker 逐项禁用）。✓
- §4.3 看诊结算（加血 5–10、sick 50%/critical 30% 治愈、写月键）→ T3。太医 `courtPhysician`、官员姓名池、official1-8、`CharacterReactionScreen` 复用 → T2/T5。✓
- §4.4 manifest official1-8 → T4。✓
- §5 转胎 −10 → T7；承养月度 −rand(0–5) → T6；生产 −5/−10 + 先落库皇嗣 → T8。皇帝自孕不计 → T6（carrier 检测仅侍君）/T8（`carrier !== "sovereign"`）。✓
- §6.5 转胎未产→断胎（T7 测试）、已产存嗣仅母亡（T8 测试）。✓
- §8 皇帝重病 + 太后服丧 gating（用户决策：本期含两项）→ T9 + T10。✓
- §11 分期：Phase 4 仅余太后葬仪谥号 UI / 侍君追封 / 奉先殿 / `FEATURE_AFTERMATH_UI`——本 plan 不触碰，符合分期。✓

**2. Placeholder scan：** 无 TBD/TODO；每个改码步骤含完整代码或精确改法 + 行号锚点。UI 任务（T5/T10）含明确人工验证步骤且优先抽纯函数保证可测。✓

**3. Type consistency：** `HealthSubject`（health.ts）= `PhysicianSubject`（physician.ts 复用）；`record_physician_visit` 的 `subjectKind`/`subjectId`/`monthKey` 在 T1 schema、T1 funnel、T3 planner、T5 一致；`childbirthCostDelta`（T7）被 T8 消费、签名一致；`canHoldCourt`/`canBedchamber` 返回 `GateResult`（T9）被 T10 消费、一致；`buildConsultOptions`（T5）返回 `ConsultOption[]`，字段与 PhysicianModal props 的 `consults` 一致。✓

**已知实现期需对齐项（实现者注意）**：① `pregnancy_transfer` 字段名以 schema 为准；② manifest 真实结构（T4 Step 0 先读）；③ 组件测试环境是否就绪（T5 优先纯函数路线）；④ birth 造态用 `plannedBirthOf` 校准日历（T8，复用 tests 现成 helper）。
