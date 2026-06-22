# 健康 / 病情 / 生死 系统 Phase 3 Implementation Plan v3.2（太医 · 怀孕成本 · 重病/服丧 gating）

> **v3.2 修订（执行前阻塞项闭环）**：①修正 PhysicianModal 自孕/承养共存条件（`consortCarrying` 独立判定，不再 `!selfCarrying`）；②修正事务测试以匹配实际 `GameStore` API（`new GameStore()` + `loadState()`；`resolveTimedAction` 返回 `TimedOutcome{rolledOver,monthChanged,healthOutcome}`，断言读 `store.getState()`）；③Task 7 承养月度成本：去掉假绿测试 + 修 `projectMonthlyHealth` 怀孕致死归因 `"pregnancy"`；④Task 9 难产母死统一经 `planHealthChange(forceDeath, cause:"childbirth")` 产生 `deathRecord` + `pendingAftermath`（从 birth handler 移除直接置死）。另含 Task 1/8 测试补强、看诊静养文案中性化、`commitBedchamber` 二次 gate。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为既有健康系统接入「召见太医看诊（四类对象、每月每人一次、各 1 AP，引擎强制约束）」「怀孕健康成本（转胎 −10 / 承养每月 −rand(0–5) / 生产 −5/−10）」「皇帝重病 + 太后服丧（死亡当日起 3 个行动日）的上朝/侍寝 gating」。

**Architecture:** 全部健康变更继续经 §1.4 funnel（`planHealthChange`，`src/store/health.ts`）原子落地，满足「扣血致 0 即时死亡」不变量；看诊与孕期成本只是新的调用方。**看诊的「每月每人一次/目标存活/月键正确」由 funnel `record_physician_visit` 的 validate 阶段强制**（UI 禁用只是辅助；`resolveTimedAction` 校验失败整笔回滚）。`taihou_decease` 同时写入服丧截止日，使 gating 真正生效。gating 抽为纯函数 `canHoldCourt` / `canBedchamber`。太医本人 `courtPhysician(rngSeed)` 确定性派生、不落档（仿 `gongli.ts`）。本期 bump `SAVE_FORMAT_VERSION` 6→7（无 v6 迁移，旧档 quarantine）。

**Tech Stack:** TypeScript + React + Vitest（测试只放 `tests/**/*.test.ts`，不与源码同目录）。Zod schema 用 `satisfies z.ZodType<GameState>` 维持类型↔schema 一致；确定性随机走 `healthRoll`/`healthRollRange`（`fnv1a64Hex`）；时间事务走 `GameStore.resolveTimedAction` / `advanceTime`。

## Global Constraints

以下为本期全局约束，每个任务隐含适用（数值/字符串逐字照抄设计稿与本节）：

- **设计稿活文档**：`docs/superpowers/specs/2026-06-21-health-illness-mortality-design.md`（§4 太医、§5 怀孕成本、§8 gating、§11 分期、§12 测试要点）。实施以本 plan 与实际代码为准。
- **存档策略**（[[no-save-backcompat]]）：pre-release，**不做向后兼容、不写 migration**。本期 bump `SAVE_FORMAT_VERSION` 6→7；**不**新增 `MIGRATIONS[6]`，旧 v6 档命中缺失迁移即 quarantine。新增字段仍为 optional（「从未看诊/未服丧」即 `undefined`，语义正确），格式版本提升负责隔离旧档。**不得**新增任何 migration 代码或 migration 测试。
- **健康不变量**：任何使健康降至 0 的变更必须在同一事务内立即标记死亡并入身后事（经 `planHealthChange`，绝不调用方自拼「扣血+置死+入队」）。
- **看诊治疗数值**：加血掷骰 `rolledHealing = healthRollRange(key, 5, 10)`（clamp 到 100 在 apply 内发生）；`sick` 50% / `critical` 30% 命中 → `healthStatus="healthy"`；`healthy` 仅加血、不改状态。
- **看诊文案显示实际回血**：UI 用 `actualHealing = outcome.nextHealth − outcome.previousHealth`（而非 `rolledHealing`，因 clamp 可能使实际 < 掷出值）。`actualHealing > 0` → 「调理一番，气色稍复（健康 +N）」；治愈病情（`cured`）→ 「药石见效，病气已退」；既未治愈又 `actualHealing === 0` → 「太医诊脉后嘱咐，仍需静养调理。」（**主体中性**，太后/侍君/皇嗣同款，不写「陛下」；**不显示虚假 +0**）。治愈且有回血可两句并陈。
- **每月每人至多一次看诊**：月键 `monthKey = "{year}:{month}"`；字段 `lastPhysicianVisitMonthKey?: string`。**此约束由引擎强制**——`record_physician_visit` 的 funnel validate 必须拒绝「本月已请脉」的目标。
- **每次看诊耗 1 AP**：经 `store.resolveTimedAction(db, effects, { type: "SPEND_AP", amount: 1 })`（转旬/跨月 tick 照常）。AP 不足 UI 禁用；引擎层不强制 AP（由 SPEND_AP 命令承担）。
- **看诊目标合法性（引擎强制）**：`record_physician_visit` validate 必须确认 ①`monthKey === "{state.calendar.year}:{state.calendar.month}"`；②目标存在且存活（consort `lifecycle !== "deceased"` 且有 standing、heir `lifecycle === "alive"`、taihou `deceased !== true`）；③本月尚未对该目标请脉。任一不满足 → `BAD_EFFECT_TARGET`，整笔事务回滚。
- **怀孕成本**（仅侍君承孕，皇帝自孕 `bearer/carrier === "sovereign"` 不计）：转胎落到侍君 `healthDelta = −10`（`cause: "pregnancy"`，一次性）；承养期间每月 `−rand(0–5)`（`cause: "pregnancy"`，已在 `projectMonthlyHealth` 步骤 1 实现，本期只接线 carrier 检测）；生产顺产 `−5`/难产 `−10`（`cause: "childbirth"`）。**生产顺序：先落库皇嗣（birth 效果），再对母方扣血**——已产则皇嗣存活仅母亡。
- **生产成本映射**（照抄）：`bearerOutcome === "safe"` → 顺产 `−5`；`bearerOutcome === "child_dies"` → 难产 `−10`（母存活）；`bearer_dies` / `both` → **不走成本扣血**，改由 `planHealthChange(forceDeath:true, cause:"childbirth")` 统一致死（产出 `consort_decease` 写 `deathRecord.cause="childbirth"` + `enqueue_aftermath` 一条）。母方死亡**不再**由 birth handler 直接置 `deceased`（见 Task 9）。
- **太后服丧**：`taihou_decease` 写入 `mourningUntilDayExclusive = effect.at.dayIndex + 3`（**死亡当日计为第 1 日，独占上界 = 死亡日 + 3**）。重复 `taihou_decease` **不得**延长截止日（已 `deceased` 则整个分支 no-op）。葬仪扣银/谥号留 Phase 4。
- **gating（本期含两项，叠加）**：`canHoldCourt(state)` / `canBedchamber(state)` 任一不通过即禁止——①皇帝重病 `resources.sovereign.healthStatus === "critical"`（文案「陛下凤体违和，太医请陛下静养。」）；②太后服丧 `taihou.deceased === true && taihou.mourningUntilDayExclusive !== undefined && state.calendar.dayIndex < taihou.mourningUntilDayExclusive`（文案「国丧期间，举哀守制，不宜临朝侍寝。」）。两者同时成立按主因（**重病优先**）显示文案。Phase 4 仅补谥号输入 UI，不再改 gating。
- **太医姓名池**（本期决策）：复用官员姓名池 `pickSurname` + `pickGivenName`（`src/engine/officials/namePool.ts`）。
- **太医立绘**：`official1`–`official8` → manifest `portrait.official1.neutral`–`official8.neutral`。**这些条目 main 已存在**（`assets/manifest.json:19-26`）——本期**不**修改 manifest。
- **确定性随机 seedKey**：看诊用 `physician:{rngSeed}:{subjectKey}:{year}:{month}:{用途}`（subjectKey：sovereign→`"sovereign"`、taihou→`"taihou"`、consort/heir→`id`），保证读档重算一致。
- **DeathCause** 枚举（`src/engine/state/types.ts`，已存在）：`"illness" | "critical_sudden" | "pregnancy" | "childbirth" | "scripted"`。
- **`planHealthChange`** 已实现（`src/store/health.ts`）：入参 `{ subject, healthDelta?, healthStatus?, forceDeath?, cause, at }`，返回 `{ effects, outcome }`（`outcome.previousHealth/nextHealth` 已 clamp）；`HealthSubject = { kind: "sovereign" } | { kind: "taihou" } | { kind: "consort"; id } | { kind: "heir"; id }`；死者 no-op；`delta=0 && 无 status && 无 forceDeath` → 不发空效果。
- **测试命令**：单测 `npx vitest run tests/path/to/test.ts`；类型 `npx tsc --noEmit`；构建 `npx vite build`。提交信息用 `feat:`/`fix:`/`test:` 前缀，**不带 Co-Authored-By**（项目 attribution 全局关闭）。

---

## File Structure

新建：

- `src/engine/characters/taiyi.ts` — `courtPhysician(rngSeed) → { name, portraitSet }`（确定性派生，不落档；仿 `gongli.ts`）。
- `src/store/physician.ts` — 看诊纯逻辑：`physicianMonthKey`、`physicianVisitedThisMonth`、`planPhysicianVisit`（返回 `PhysicianVisitPlan | null`）、`buildConsultOptions`。
- `src/store/gating.ts` — `canHoldCourt(state)` / `canBedchamber(state)` 纯函数（重病 + 服丧）。
- `src/store/pregnancyCost.ts` — `planPregnancyTransfer`（转胎 −10）；`childbirthCostDelta`。

修改：

- `src/engine/state/types.ts` — 各角色加 `lastPhysicianVisitMonthKey?: string`。
- `src/engine/save/stateSchema.ts` + `src/engine/content/schemas.ts` — 镜像上字段；`eventEffectSchema` 增 `record_physician_visit`（判别式 subject 联合）分支。
- `src/engine/effects/funnel.ts` — `record_physician_visit` 的 validate（合法性强制）+ apply case；`taihou_decease` apply 增写 `mourningUntilDayExclusive`；`birth` apply 移除对 `bearer_dies`/`both` 的直接置死（母死改由 `consort_decease` 统一）。
- `src/engine/save/saveSystem.ts` — `SAVE_FORMAT_VERSION = 7`（不加 MIGRATIONS[6]）。
- `src/store/healthTick.ts` — `projectMonthlyHealth` 怀孕损耗独立判死归因 `"pregnancy"`；`buildMonthlyHealthTick` 接线 `pregnancyMonthlyCost`（承孕侍君检测）。
- `src/store/gestation.ts` — `buildBirth` 追加母方成本/死亡效果（`safe −5` / `child_dies −10` / `bearer_dies·both` → `planHealthChange(forceDeath, cause:"childbirth")`）。
- `src/ui/components/PhysicianModal.tsx` — 看诊区常驻 + 流胎/承养区**各自独立判定**可共存（`selfCarrying` 与 `consortCarrying` 互不前置）。
- `src/ui/App.tsx` — 看诊 handler（reaction，actualHealing 中性文案）；gating 接入（上朝守卫 + 侍寝入口 + `commitBedchamber` 二次 gate）；转胎 −10 接线。

测试（新增）：`tests/effects/recordPhysicianVisit.test.ts`、`tests/effects/taihouMourning.test.ts`、`tests/save/saveFormatV7.test.ts`、`tests/characters/taiyi.test.ts`、`tests/store/physician.test.ts`、`tests/store/physicianTransaction.test.ts`、`tests/store/gating.test.ts`、`tests/store/pregnancyCost.test.ts`、`tests/store/healthTickPregnancy.test.ts`、`tests/store/birthCost.test.ts`。

依赖顺序（线性）：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11。

---

### Task 1: schema/type 字段 + `record_physician_visit` 受约束效果

**Files:**
- Modify: `src/engine/state/types.ts`（`SovereignState`、`TaihouState`、`CharacterStanding`、`Heir` 各加 `lastPhysicianVisitMonthKey?: string`）
- Modify: `src/engine/save/stateSchema.ts`（sovereign/taihou/heir 对象加字段）
- Modify: `src/engine/content/schemas.ts`（`characterStandingSchema` 加字段；`eventEffectSchema` 增 `record_physician_visit` 分支）
- Modify: `src/engine/effects/funnel.ts`（validate 强制合法性 + apply）
- Test: `tests/effects/recordPhysicianVisit.test.ts`

**Interfaces:**
- Produces: 效果（**判别式 subject 联合**）
  ```ts
  {
    type: "record_physician_visit";
    subject:
      | { kind: "sovereign" }
      | { kind: "taihou" }
      | { kind: "consort"; id: string }
      | { kind: "heir"; id: string };
    monthKey: string;
  }
  ```
  apply 把 `monthKey` 写到对应角色 `lastPhysicianVisitMonthKey`。validate 强制 monthKey 当月、目标存活、本月未请脉。
- Produces: 类型字段 `lastPhysicianVisitMonthKey?: string` 在四个角色形状上。

- [ ] **Step 1: 写失败测试**

`tests/effects/recordPhysicianVisit.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";

const db = loadGameContent();
const monthKey = (s: { calendar: { year: number; month: number } }) => `${s.calendar.year}:${s.calendar.month}`;

describe("record_physician_visit", () => {
  it("写皇帝/太后的本月已请脉月键", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk },
      { type: "record_physician_visit", subject: { kind: "taihou" }, monthKey: mk },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.lastPhysicianVisitMonthKey).toBe(mk);
    expect(r.value.taihou.lastPhysicianVisitMonthKey).toBe(mk);
  });

  it("写侍君的本月已请脉月键", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased")!;
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "consort", id: cid }, monthKey: monthKey(s0) },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.lastPhysicianVisitMonthKey).toBe(monthKey(s0));
  });

  it("拒绝：月键非当月", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: "999:9" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("拒绝：本月已对该目标请脉（连续第二次 applyEffects）", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    const first = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyEffects(db, first.value, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: mk }]);
    expect(second.ok).toBe(false);
  });

  it("拒绝：不存在的侍君 / 已薨太后", () => {
    const s0 = createNewGameState(db);
    const mk = monthKey(s0);
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: "nope_xyz" }, monthKey: mk }]).ok).toBe(false);
    const dead = structuredClone(s0);
    dead.taihou.deceased = true;
    expect(applyEffects(db, dead, [{ type: "record_physician_visit", subject: { kind: "taihou" }, monthKey: mk }]).ok).toBe(false);
  });

  it("记录成功：存活皇嗣写月键", () => {
    const s0 = createNewGameState(db);
    s0.resources.bloodline.heirs.push(makeHeir("heir_alive", "alive"));
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "heir", id: "heir_alive" }, monthKey: monthKey(s0) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.find((h) => h.id === "heir_alive")!.lastPhysicianVisitMonthKey).toBe(monthKey(s0));
  });

  it("拒绝：已故皇嗣", () => {
    const s0 = createNewGameState(db);
    s0.resources.bloodline.heirs.push(makeHeir("heir_dead", "deceased"));
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "heir", id: "heir_dead" }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });

  it("拒绝：已故侍君", () => {
    const s0 = createNewGameState(db);
    const cid = Object.keys(s0.standing).find((id) => s0.standing[id]!.lifecycle !== "deceased")!;
    s0.standing[cid]!.lifecycle = "deceased";
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: cid }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });

  it("拒绝：consort id 指向非侍君（有 standing 但无侍君角色记录）", () => {
    const s0 = createNewGameState(db);
    // standing 存在但 db.characters/generatedConsorts 中无该 id → c 为空 → 非侍君 → 拒绝
    s0.standing["ghost_official"] = { ...s0.standing[Object.keys(s0.standing)[0]!]!, lifecycle: "normal" };
    expect(applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "consort", id: "ghost_official" }, monthKey: monthKey(s0) }]).ok).toBe(false);
  });
});
```

> 在文件顶部 `import type { Heir } from "../../src/engine/state/types";`，并加 `makeHeir` helper（字段以 `Heir` 类型为准微调，validate 仅读 `id`/`lifecycle`）：
>
> ```ts
> function makeHeir(id: string, lifecycle: "alive" | "deceased"): Heir {
>   return {
>     id, sex: "son", fatherId: null, bearer: "sovereign",
>     birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
>     favor: 50, legitimate: true, petName: "儿",
>     education: { scholarship: 0, martial: 0, virtue: 0 },
>     health: 80, talent: 50, diligence: 50, ambition: 50, closeness: 50, support: 50,
>     faction: "none", lifecycle,
>     ...(lifecycle === "deceased" ? { deceasedAt: { year: 1, month: 2, period: "early", dayIndex: 30 } } : {}),
>   };
> }
> ```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/effects/recordPhysicianVisit.test.ts`
Expected: FAIL（`record_physician_visit` 未在 schema/funnel 定义）

- [ ] **Step 3: 加类型字段**

`src/engine/state/types.ts`：在 `SovereignState`、`TaihouState`、`CharacterStanding`、`Heir` 各接口里加（放在各接口现有 `healthStatus?` 字段附近）：

```ts
  /** 本月已请脉月键 "{year}:{month}"；当月已看诊则禁再请脉（设计 §4.2）。 */
  lastPhysicianVisitMonthKey?: string;
```

- [ ] **Step 4: 加 save schema 字段**

`src/engine/save/stateSchema.ts`：
- `resources.sovereign` 对象（`z.strictObject({ health... })`，约 82–92 行）末尾加：`lastPhysicianVisitMonthKey: z.string().optional(),`
- `taihou` 对象（约 188–195 行）加：`lastPhysicianVisitMonthKey: z.string().optional(),`
- heir 对象（约 121–165 行 `z.strictObject({ ... })`，在 `.superRefine` 之前）加：`lastPhysicianVisitMonthKey: z.string().optional(),`

`src/engine/content/schemas.ts`：`characterStandingSchema` 加：`lastPhysicianVisitMonthKey: z.string().optional(),`

- [ ] **Step 5: 加 `record_physician_visit` 到 eventEffectSchema**

`src/engine/content/schemas.ts`：在 `eventEffectSchema` 的 `z.union([...])` 内（紧接 `enqueue_aftermath` 分支后）加：

```ts
  z.strictObject({
    type: z.literal("record_physician_visit"),
    subject: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("sovereign") }),
      z.strictObject({ kind: z.literal("taihou") }),
      z.strictObject({ kind: z.literal("consort"), id: idSchema }),
      z.strictObject({ kind: z.literal("heir"), id: idSchema }),
    ]),
    monthKey: z.string().min(1),
  }),
```

- [ ] **Step 6: funnel validate（合法性强制）**

`src/engine/effects/funnel.ts` validate switch，**新增独立 case**（不要并入 line 67 的 passthrough 组）：

```ts
      case "record_physician_visit": {
        const sub = effect.subject;
        const expectedKey = `${state.calendar.year}:${state.calendar.month}`;
        if (effect.monthKey !== expectedKey) {
          bad(index, "BAD_EFFECT_TARGET", `physician visit monthKey "${effect.monthKey}" != current "${expectedKey}"`, {});
          break;
        }
        let alive = false;
        let lastKey: string | undefined;
        if (sub.kind === "sovereign") { alive = true; lastKey = state.resources.sovereign.lastPhysicianVisitMonthKey; }
        else if (sub.kind === "taihou") { alive = state.taihou.deceased !== true; lastKey = state.taihou.lastPhysicianVisitMonthKey; }
        else if (sub.kind === "consort") {
          const st = state.standing[sub.id];
          const c = db.characters[sub.id] ?? state.generatedConsorts[sub.id];
          alive = !!st && st.lifecycle !== "deceased" && !!c && c.kind === "consort";
          lastKey = st?.lastPhysicianVisitMonthKey;
        } else {
          const h = state.resources.bloodline.heirs.find((x) => x.id === sub.id);
          alive = !!h && h.lifecycle === "alive";
          lastKey = h?.lastPhysicianVisitMonthKey;
        }
        if (!alive) bad(index, "BAD_EFFECT_TARGET", `physician visit on missing/deceased subject`, {});
        else if (lastKey === expectedKey) bad(index, "BAD_EFFECT_TARGET", `physician already visited subject this month`, {});
        break;
      }
```

- [ ] **Step 7: funnel apply**

`src/engine/effects/funnel.ts` apply switch（`set_heir_health` case 之后）加：

```ts
      case "record_physician_visit": {
        const sub = effect.subject;
        if (sub.kind === "sovereign") next.resources.sovereign.lastPhysicianVisitMonthKey = effect.monthKey;
        else if (sub.kind === "taihou") next.taihou.lastPhysicianVisitMonthKey = effect.monthKey;
        else if (sub.kind === "consort") { const st = next.standing[sub.id]; if (st) st.lastPhysicianVisitMonthKey = effect.monthKey; }
        else { const h = next.resources.bloodline.heirs.find((x) => x.id === sub.id); if (h) h.lastPhysicianVisitMonthKey = effect.monthKey; }
        break;
      }
```

- [ ] **Step 8: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/effects/recordPhysicianVisit.test.ts && npx tsc --noEmit`
Expected: PASS（9 测试），tsc 无错。

- [ ] **Step 9: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/recordPhysicianVisit.test.ts
git commit -m "feat: lastPhysicianVisitMonthKey 字段 + record_physician_visit 受约束漏斗效果（引擎强制每月每人一次/目标存活）"
```

---

### Task 2: bump SAVE_FORMAT_VERSION 6→7（无 v6 迁移）

**Files:**
- Modify: `src/engine/save/saveSystem.ts:21`（`SAVE_FORMAT_VERSION = 7`；更新 117–118 行注释）
- Test: `tests/save/saveFormatV7.test.ts`

**Interfaces:**
- Consumes: 既有存档系统（`saveGame`/`loadGame`/quarantine 流程）。
- Produces: 新档写 `formatVersion: 7`；旧 v6 档命中缺失 `MIGRATIONS[6]` → quarantine。

> 先读 `src/engine/save/saveSystem.ts` 现有 save/load API 与 quarantine 行为（约 121+ 行 `SaveSystem`），照其签名造测试。`MIGRATIONS` 当前 keyed 1–4，v5→v6 注释式省略。本任务**不**新增 `MIGRATIONS[6]`。

- [ ] **Step 1: 写失败测试**

`tests/save/saveFormatV7.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

describe("SAVE_FORMAT_VERSION = 7（Phase 3 字段引入，旧档隔离）", () => {
  it("常量已 bump 到 7", () => {
    expect(SAVE_FORMAT_VERSION).toBe(7);
  });
});
```

> 若仓库已有「save round-trip / quarantine」集成测试（grep `tests/save`），**改为**在该测试套件里加两条更强断言：①用 `SaveSystem` 存读一局新档 → `formatVersion === 7` 且加载成功；②构造一个 `formatVersion: 6` 的 envelope 写入存储 → 加载返回 quarantine/CORRUPT（命中缺失 `MIGRATIONS[6]`）。优先此集成路线（更贴近真实失效场景）；下面 Step 3 据此实现即可同样过关。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/save/saveFormatV7.test.ts`
Expected: FAIL（常量仍为 6）

- [ ] **Step 3: bump 常量 + 更新注释**

`src/engine/save/saveSystem.ts:21`：`export const SAVE_FORMAT_VERSION = 7;`

更新 117–118 行注释为：

```ts
  // v5 → v6、v6 → v7 迁移均按 no-save-backcompat 政策省略。
  // 旧档命中缺失的 MIGRATIONS[v] 即 quarantine（pre-release，不保旧档）。
```

- [ ] **Step 4: 跑测试 + 全量存档测试确认通过**

Run: `npx vitest run tests/save/ && npx tsc --noEmit`
Expected: PASS（含既有存档测试与新断言）。若既有测试硬编码了 `formatVersion: 6` 断言，一并更新为 7。

- [ ] **Step 5: 提交**

```bash
git add src/engine/save/saveSystem.ts tests/save/saveFormatV7.test.ts
git commit -m "feat: bump SAVE_FORMAT_VERSION 6→7（Phase 3 字段；旧 v6 档 quarantine，无迁移）"
```

---

### Task 3: `courtPhysician`（太医本人确定性派生）

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
      expect(/^official([1-8])$/.test(courtPhysician(seed).portraitSet)).toBe(true);
    }
  });
  it("name 非空（姓+名 ≥ 2 字）", () => {
    expect(courtPhysician(7).name.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/characters/taiyi.test.ts`
Expected: FAIL（`taiyi.ts` 不存在）

- [ ] **Step 3: 实现 `taiyi.ts`**

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

> `pickSurname`/`pickGivenName` 的确切签名以 `src/engine/officials/namePool.ts` 现状为准（去重 Set / 返回值），按实对齐。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/characters/taiyi.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/characters/taiyi.ts tests/characters/taiyi.test.ts
git commit -m "feat: courtPhysician 太医院正确定性派生（官员姓名池 + official1-8 立绘）"
```

---

### Task 4: `taihou_decease` 写入 3 行动日服丧截止

**Files:**
- Modify: `src/engine/effects/funnel.ts:592-596`（`taihou_decease` apply）
- Test: `tests/effects/taihouMourning.test.ts`

**Interfaces:**
- Produces: `taihou_decease` apply 写 `mourningUntilDayExclusive = effect.at.dayIndex + 3`；重复 decease no-op（不延长）。被 Task 10 的 `canHoldCourt/canBedchamber` 消费。

- [ ] **Step 1: 写失败测试**

`tests/effects/taihouMourning.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import type { GameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
const at = (dayIndex: number): GameTime => ({ year: 1, month: 6, period: "mid", dayIndex });

describe("taihou_decease 服丧截止", () => {
  it("死亡 dayIndex=10 → mourningUntilDayExclusive=13（死亡当日计第1日，独占上界 +3）", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [{ type: "taihou_decease", at: at(10), cause: "illness" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.taihou.deceased).toBe(true);
    expect(r.value.taihou.diedAt).toEqual(at(10));
    expect(r.value.taihou.mourningUntilDayExclusive).toBe(13);
  });

  it("重复 taihou_decease 不延长截止日", () => {
    const s0 = createNewGameState(db);
    const r1 = applyEffects(db, s0, [{ type: "taihou_decease", at: at(10), cause: "illness" }]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyEffects(db, r1.value, [{ type: "taihou_decease", at: at(11), cause: "illness" }]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.taihou.mourningUntilDayExclusive).toBe(13); // 不被改成 14
    expect(r2.value.taihou.diedAt).toEqual(at(10)); // 死亡日不变
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/effects/taihouMourning.test.ts`
Expected: FAIL（`mourningUntilDayExclusive` 当前为 undefined；重复 decease 覆盖 diedAt）

- [ ] **Step 3: 改 `taihou_decease` apply（幂等 + 写服丧截止）**

`src/engine/effects/funnel.ts:592-596` 改为：

```ts
      case "taihou_decease": {
        if (!next.taihou.deceased) {
          next.taihou.deceased = true;
          next.taihou.diedAt = effect.at;
          next.taihou.mourningUntilDayExclusive = effect.at.dayIndex + 3; // 死亡当日计第1日，独占上界
        }
        break;
      }
```

- [ ] **Step 4: 跑测试确认通过 + 类型**

Run: `npx vitest run tests/effects/taihouMourning.test.ts && npx tsc --noEmit`
Expected: PASS（2 测试）

- [ ] **Step 5: 提交**

```bash
git add src/engine/effects/funnel.ts tests/effects/taihouMourning.test.ts
git commit -m "fix: taihou_decease 写入 3 行动日服丧截止（幂等，不延长），使服丧 gating 生效"
```

---

### Task 5: 看诊纯逻辑 `planPhysicianVisit`（返回 plan 或 null）+ `buildConsultOptions`

**Files:**
- Create: `src/store/physician.ts`
- Test: `tests/store/physician.test.ts`

**Interfaces:**
- Consumes: `planHealthChange`（`src/store/health.ts`，`HealthSubject`）、`healthRoll`/`healthRollRange`、`livingConsortIds`（`src/store/healthRoster.ts`）、`record_physician_visit`（Task 1）。
- Produces:
  - `physicianMonthKey(cal: { year: number; month: number }): string` → `"{year}:{month}"`
  - `physicianVisitedThisMonth(state, subject: PhysicianSubject): boolean`
  - `type PhysicianSubject = HealthSubject`
  - `interface PhysicianVisitPlan { effects: EventEffect[]; rolledHealing: number; actualHealing: number; cured: boolean; }`
  - `planPhysicianVisit(state, subject, at): PhysicianVisitPlan | null`（目标不存在/已故/本月已看诊 → `null`，**不**回退成 healthy）
  - `buildConsultOptions(db, state): ConsultOption[]`（四类入口可用性）

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
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: physicianMonthKey(s0.calendar) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(physicianVisitedThisMonth(r.value, { kind: "sovereign" })).toBe(true);
  });
});

describe("planPhysicianVisit", () => {
  it("healthy：actualHealing 5–10、不改状态、含 record 效果", () => {
    const s0 = createNewGameState(db);
    const seeded = applyEffects(db, s0, [{ type: "set_sovereign_health", healthDelta: -20 }]); // 压到 80
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const before = seeded.value.resources.sovereign.health;
    const plan = planPhysicianVisit(seeded.value, { kind: "sovereign" }, at)!;
    expect(plan).not.toBeNull();
    expect(plan.rolledHealing).toBeGreaterThanOrEqual(5);
    expect(plan.rolledHealing).toBeLessThanOrEqual(10);
    expect(plan.cured).toBe(false);
    expect(plan.effects.some((e) => e.type === "record_physician_visit")).toBe(true);
    const r = applyEffects(db, seeded.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(plan.actualHealing).toBe(r.value.resources.sovereign.health - before);
    expect(r.value.resources.sovereign.healthStatus).toBe("healthy");
  });

  it("actualHealing 受 clamp 限制（health=98 → 实际 ≤ 2）", () => {
    const s0 = createNewGameState(db);
    const cur = s0.resources.sovereign.health;
    const seeded = applyEffects(db, s0, [{ type: "set_sovereign_health", healthDelta: 98 - cur }]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const plan = planPhysicianVisit(seeded.value, { kind: "sovereign" }, at)!;
    expect(plan.actualHealing).toBeLessThanOrEqual(2);
    expect(plan.actualHealing).toBeGreaterThanOrEqual(0);
  });

  it("目标不存在 → 返回 null（不回退 healthy）", () => {
    const s0 = createNewGameState(db);
    expect(planPhysicianVisit(s0, { kind: "consort", id: "nope_xyz" }, at)).toBeNull();
  });

  it("本月已看诊 → 返回 null", () => {
    const s0 = createNewGameState(db);
    const r = applyEffects(db, s0, [{ type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: physicianMonthKey(s0.calendar) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planPhysicianVisit(r.value, { kind: "sovereign" }, at)).toBeNull();
  });

  it("sick：治愈与否随 seed 确定；cured 与落地状态一致", () => {
    const s0 = createNewGameState(db);
    const sick = applyEffects(db, s0, [{ type: "set_sovereign_health", healthStatus: "sick" }]);
    expect(sick.ok).toBe(true);
    if (!sick.ok) return;
    const plan = planPhysicianVisit(sick.value, { kind: "sovereign" }, at)!;
    const r = applyEffects(db, sick.value, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.sovereign.healthStatus).toBe(plan.cured ? "healthy" : "sick");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/physician.test.ts`
Expected: FAIL（`physician.ts` 不存在）

- [ ] **Step 3: 实现 `physician.ts`**

```ts
/**
 * 召见太医·看诊纯逻辑（设计 §4）：加血 5–10、按概率治病、追加 record_physician_visit。
 * 目标不存在/已故/本月已看诊 → 返回 null（不伪造 healthy）；引擎层再由 funnel validate 兜底。
 */
import { healthRoll, healthRollRange } from "../engine/characters/healthRoll";
import type { GameTime } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { ContentDB } from "../engine/content/loader";
import type { GameState, HealthStatus } from "../engine/state/types";
import { planHealthChange, type HealthSubject } from "./health";
import { livingConsortIds } from "./healthRoster";

export type PhysicianSubject = HealthSubject;

export interface PhysicianVisitPlan {
  effects: EventEffect[];
  rolledHealing: number;
  actualHealing: number;
  cured: boolean;
}

export interface ConsultOption {
  key: "sovereign" | "taihou" | "consort" | "heir";
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

export function physicianMonthKey(cal: { year: number; month: number }): string {
  return `${cal.year}:${cal.month}`;
}

function subjectKeyOf(s: PhysicianSubject): string {
  return s.kind === "sovereign" ? "sovereign" : s.kind === "taihou" ? "taihou" : s.id;
}

/** 当前状态；目标不存在/已故返回 null（不默认 healthy）。 */
function liveStatusOf(state: GameState, s: PhysicianSubject): HealthStatus | null {
  switch (s.kind) {
    case "sovereign": return state.resources.sovereign.healthStatus;
    case "taihou": return state.taihou.deceased === true ? null : state.taihou.healthStatus;
    case "consort": {
      const st = state.standing[s.id];
      return st && st.lifecycle !== "deceased" ? (st.healthStatus ?? "healthy") : null;
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === s.id);
      return h && h.lifecycle === "alive" ? (h.healthStatus ?? "healthy") : null;
    }
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
 * 一次看诊。目标不存在/已故/本月已看诊 → null。
 * effects 经 store.resolveTimedAction 落地（funnel validate 会二次强制合法性）。
 */
export function planPhysicianVisit(
  state: GameState,
  subject: PhysicianSubject,
  at: GameTime,
): PhysicianVisitPlan | null {
  const status = liveStatusOf(state, subject);
  if (status === null) return null;
  if (physicianVisitedThisMonth(state, subject)) return null;

  const seed = `physician:${state.rngSeed}:${subjectKeyOf(subject)}:${state.calendar.year}:${state.calendar.month}`;
  const rolledHealing = healthRollRange(`${seed}:heal`, 5, 10);
  let cured = false;
  if (status === "sick") cured = healthRoll(`${seed}:cure`) < 50;
  else if (status === "critical") cured = healthRoll(`${seed}:cure`) < 30;

  const { effects, outcome } = planHealthChange(state, {
    subject,
    healthDelta: rolledHealing,
    ...(cured ? { healthStatus: "healthy" as HealthStatus } : {}),
    cause: "scripted",
    at,
  });
  const actualHealing = outcome.nextHealth - outcome.previousHealth;

  effects.push({
    type: "record_physician_visit",
    subject,
    monthKey: physicianMonthKey(state.calendar),
  });

  return { effects, rolledHealing, actualHealing, cured };
}

/** 四类看诊入口可用性（AP 充足 + 本月未请脉 + 对象存在/存活）。 */
export function buildConsultOptions(db: ContentDB, state: GameState): ConsultOption[] {
  const apOk = state.calendar.ap >= 1;
  const guard = (key: ConsultOption["key"], label: string, subject: PhysicianSubject | null): ConsultOption => {
    if (subject === null) return { key, label, disabled: true, disabledReason: "对象不在" };
    if (!apOk) return { key, label, disabled: true, disabledReason: "行动点不足" };
    if (physicianVisitedThisMonth(state, subject)) return { key, label, disabled: true, disabledReason: "本月已请脉，太医嘱静养" };
    return { key, label, disabled: false };
  };
  const hasConsort = livingConsortIds(db, state).length > 0;
  const hasHeir = state.resources.bloodline.heirs.some((h) => h.lifecycle === "alive");
  return [
    guard("sovereign", "为陛下诊脉", { kind: "sovereign" }),
    guard("taihou", "给太后请脉", state.taihou.deceased === true ? null : { kind: "taihou" }),
    // 侍君/皇嗣为「打开 picker」入口，本月已请脉的逐人判定在 picker 内（见 Task 6）；此处仅判 AP/有无对象。
    { key: "consort", label: "给侍君请脉", disabled: !hasConsort || !apOk, ...(!hasConsort ? { disabledReason: "宫中无在世侍君" } : !apOk ? { disabledReason: "行动点不足" } : {}) },
    { key: "heir", label: "给皇嗣请脉", disabled: !hasHeir || !apOk, ...(!hasHeir ? { disabledReason: "暂无在世皇嗣" } : !apOk ? { disabledReason: "行动点不足" } : {}) },
  ];
}
```

> `livingConsortIds` 的签名以 `src/store/healthRoster.ts` 现状为准（`buildMonthlyHealthTick` 已用，照实对齐）。

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run: `npx vitest run tests/store/physician.test.ts && npx tsc --noEmit`
Expected: PASS（7 测试），tsc 无错。

- [ ] **Step 5: 提交**

```bash
git add src/store/physician.ts tests/store/physician.test.ts
git commit -m "feat: planPhysicianVisit（返回 plan|null，actualHealing 实际回血）+ buildConsultOptions"
```

---

### Task 6: PhysicianModal 看诊区（常驻 + 流胎/承养共存）+ App 接线 + 事务测试

**Files:**
- Modify: `src/ui/components/PhysicianModal.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/store/physicianTransaction.test.ts`（引擎层事务行为，**必测**）；UI 结构以人工验证为主

**Interfaces:**
- Consumes: `planPhysicianVisit`/`physicianVisitedThisMonth`/`buildConsultOptions`（Task 5）、`courtPhysician`（Task 3）、`store.resolveTimedAction`、`CharacterReactionScreen`（已存在）。
- Produces: 看诊耗 1 AP，落地后弹太医 reaction（文案用 `actualHealing`）。

> **PhysicianModal 最终结构（唯一版本，消除互斥分支）**——看诊区始终可见；自孕额外显示流胎入口；有侍君承孕额外显示「承养不可弃」说明；二者可共存（多线孕育允许皇帝自孕与侍君承孕并存）：
> ```tsx
> <>
>   <ConsultationSection consults={consults} physicianName={physicianName}
>     onConsult={onConsult} onPickConsort={onPickConsort} onPickHeir={onPickHeir} />
>   {selfCarrying && <SelfPregnancyAbortSection onAbort={onAbort} />}
>   {consortCarrying && <TransferredPregnancyNotice />}
> </>
> ```
> 两个孕育区块**各自独立判定**（`selfCarrying`、`consortCarrying`），可同时渲染——皇帝自孕 + 侍君承孕时流胎入口与承养说明共存。**不得**给承养说明加 `!selfCarrying` 前置（那会让自孕时隐藏承养说明，与「三者共存」矛盾）。**删除**旧版「selfCarrying 时只显示流胎 / 三个互斥 ternary」的全部文字与实现。

- [ ] **Step 1: 写引擎层事务失败测试（必测，重点）**

`tests/store/physicianTransaction.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { GameStore } from "../../src/store/gameStore";
import { planPhysicianVisit } from "../../src/store/physician";
import type { GameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
const at: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };

// GameStore 构造接收 GameStoreOptions（非 GameState）；完整状态经 loadState 载入。
function freshStore() {
  const store = new GameStore();
  store.loadState(createNewGameState(db));
  return store;
}

describe("看诊事务（resolveTimedAction 整笔回滚）", () => {
  it("第一次看诊：加血、记录月键、扣 1 AP", () => {
    const store = freshStore();
    const before = store.getState();
    const apBefore = before.calendar.ap;
    const hpBefore = before.resources.sovereign.health;
    const plan = planPhysicianVisit(before, { kind: "sovereign" }, at)!;
    const r = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    // TimedOutcome 只含 { rolledOver, monthChanged, healthOutcome }——状态变更读 getState()。
    const after = store.getState();
    expect(after.calendar.ap).toBe(apBefore - 1);
    expect(after.resources.sovereign.health).toBe(hpBefore + plan.actualHealing);
    expect(after.resources.sovereign.lastPhysicianVisitMonthKey).toBe("1:1");
  });

  it("同月对同一目标第二次（非法效果）：整笔失败，health/AP/calendar 不变", () => {
    const store = freshStore();
    const plan1 = planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)!;
    const r1 = store.resolveTimedAction(db, plan1.effects, { type: "SPEND_AP", amount: 1 });
    expect(r1.ok).toBe(true);
    const snapshot = structuredClone(store.getState());
    const illegal = [
      { type: "set_sovereign_health", healthDelta: 9 } as const,
      { type: "record_physician_visit", subject: { kind: "sovereign" }, monthKey: "1:1" } as const,
    ];
    const r2 = store.resolveTimedAction(db, illegal, { type: "SPEND_AP", amount: 1 });
    expect(r2.ok).toBe(false); // record validate 拒绝（本月已请脉）
    const after = store.getState();
    expect(after.resources.sovereign.health).toBe(snapshot.resources.sovereign.health); // 未加 9
    expect(after.calendar).toEqual(snapshot.calendar); // AP/时间未动（整笔回滚）
  });

  it("planPhysicianVisit 对本月已看诊目标返回 null", () => {
    const store = freshStore();
    const plan1 = planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)!;
    store.resolveTimedAction(db, plan1.effects, { type: "SPEND_AP", amount: 1 });
    expect(planPhysicianVisit(store.getState(), { kind: "sovereign" }, at)).toBeNull();
  });
});
```

> `GameStore` 实际 API（`src/store/gameStore.ts` 已确认）：构造 `new GameStore(options?: GameStoreOptions)`，载入 `store.loadState(state)`；`resolveTimedAction(db, effects, { type: "SPEND_AP", amount })` 返回 `Result<TimedOutcome>`，`TimedOutcome = { rolledOver, monthChanged, healthOutcome: MonthlyTickResult | null }`——**不含** `calendar`/`resources`。状态变更一律读 `store.getState()`。`healthOutcome` 仅在 `monthChanged` 时非 null（看诊不跨月，故为 null）。

- [ ] **Step 2: 跑测试确认失败/部分失败**

Run: `npx vitest run tests/store/physicianTransaction.test.ts`
Expected: FAIL（依赖 Task 1/5；若 Task 1 validate 正确则「回滚」断言已可过，主要验证整链）

- [ ] **Step 3: 扩 `PhysicianModal.tsx`（唯一结构）**

按上方「最终结构」实现。Props：

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
}) { /* 看诊区 + 条件流胎/承养区，见最终结构 */ }
```

看诊区：太医名抬头 + 四按钮（`consults` 驱动，`disabled` 时显示 `disabledReason`）；陛下/太后按钮 → `onConsult(key)`；侍君/皇嗣按钮 → `onPickConsort()`/`onPickHeir()`（打开 picker）。先读 `ConsortListModal`/`HeirListModal` 对齐 className 与 `registry.portrait` 用法。

- [ ] **Step 4: App 接线**

`src/ui/App.tsx`：
- import `courtPhysician`、`planPhysicianVisit`/`buildConsultOptions`/`PhysicianSubject`。
- `const physician = courtPhysician(liveState.rngSeed);`
- 新增 reaction 状态：`const [physicianReaction, setPhysicianReaction] = useState<{ portraitSet: string; speakerName: string; lines: string[] } | null>(null);`
- 看诊执行：

```tsx
const doConsult = (subject: PhysicianSubject) => {
  const plan = planPhysicianVisit(liveState, subject, { ...liveState.calendar });
  if (!plan) return; // 目标不可看诊（已故/本月已看），UI 不应发起
  const settled = store.resolveTimedAction(db, plan.effects, { type: "SPEND_AP", amount: 1 });
  if (!settled.ok) return;
  if (settled.value.healthOutcome?.sovereignDied) { onSovereignDeath(); return; }
  setPhysicianOpen(false);
  doAutosave();
  const lines: string[] = [];
  if (plan.cured) lines.push("太医诊脉施治，药石见效，病气已退。");
  if (plan.actualHealing > 0) lines.push(`调理一番，气色稍复（健康 +${plan.actualHealing}）。`);
  if (lines.length === 0) lines.push("太医诊脉后嘱咐，仍需静养调理。"); // 主体中性（太后/侍君/皇嗣皆可用，不写「陛下」）
  setPhysicianReaction({ portraitSet: physician.portraitSet, speakerName: physician.name, lines });
  if (settled.value.rolledOver) setReactionRollover(true);
};
```

- `PhysicianModal` 传 `physicianName={physician.name}`、`consults={buildConsultOptions(db, liveState)}`、`onConsult={(k) => doConsult({ kind: k })}`、`onPickConsort`/`onPickHeir` 打开各自 picker；picker 选中 → `doConsult({ kind: "consort", id })` / `{ kind: "heir", id }`；picker 内每个条目用 `physicianVisitedThisMonth(liveState, subject)` 决定禁选并显示「本月已请脉」。
- 渲染太医 reaction（仿现有 `childReaction` 块）：`<CharacterReactionScreen db={db} store={store} registry={registry} portraitSet={...} speakerName={...} lines={...} onDone={() => { setPhysicianReaction(null); /* 转旬衔接同 childReaction onDone */ }} />`。

> `healthOutcome?.sovereignDied`/`rolledOver` 字段名以 `resolveTimedAction` 返回结构现状为准（读 `gameStore.ts` 对齐；看诊一般不致死，但保留防御）。

- [ ] **Step 5: 跑事务测试 + 类型 + 构建**

Run: `npx vitest run tests/store/physicianTransaction.test.ts && npx tsc --noEmit && npx vite build`
Expected: PASS，tsc 无错，build OK。

- [ ] **Step 6: 人工验证（记录于报告）**

- 御书房「召见太医」→ 看诊区四类入口常驻。为陛下/太后/侍君/皇嗣各请脉：AP −1，弹太医立绘，文案显示**实际回血量**（接近满血时不再显示 +10）。
- 同月同对象再请脉 → 该项禁用「本月已请脉」。
- 皇帝自孕同时有侍君承孕：看诊区 + 流胎入口 + 承养说明三者共存。
- AP=0 → 四项禁用。

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/PhysicianModal.tsx src/ui/App.tsx tests/store/physicianTransaction.test.ts
git commit -m "feat: 太医四类看诊 UI（看诊区常驻/流胎承养共存）+ 接线（1AP/实际回血文案/事务回滚）"
```

---

### Task 7: 月度承养健康成本接线 + 怀孕致死归因 `"pregnancy"`

**Files:**
- Modify: `src/store/healthTick.ts`：①`projectMonthlyHealth`（22–43 行）拆分怀孕损耗并归因致死 `"pregnancy"`；②`buildMonthlyHealthTick` 侍君遍历（109–128 行）接线 `pregnancyMonthlyCost: carrying`
- Test: `tests/store/healthTickPregnancy.test.ts`

**Interfaces:**
- Consumes: `state.resources.bloodline.gestations`（`carrier === consortId` 即承孕）、`healthRollRange`。
- Produces: 承孕侍君月度 tick 多扣 `rand(0–5)`；**若怀孕损耗本身致 health≤0，`deathCause === "pregnancy"`**（不再误记 `"illness"`）；衰老/病损致死仍 `"illness"`。

> **两处都要改**：当前 `projectMonthlyHealth` 先扣怀孕成本、再扣衰老/病损，最后统一 `if (h<=0) return { ..., deathCause: "illness" }`——承养损耗致死被误记 `illness`。必须把怀孕损耗独立扣并先行判死（归因 `"pregnancy"`），再做衰老/病损（归因 `"illness"`）。对存活者数值不变（`clampPct` 仅在归零时有别，而归零即已 return 死亡）。

- [ ] **Step 1: 写失败测试（无条件断言 + 死因 + 对照）**

`tests/store/healthTickPregnancy.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { projectMonthlyHealth, buildMonthlyHealthTick } from "../../src/store/healthTick";
import { healthRollRange } from "../../src/engine/characters/healthRoll";
import { makeGameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
const conceived = makeGameTime(1, 1, "early");

// 选一个使承养损耗 ≥1 的 seedKey；下方 expect 会强制选对（若该 key 损耗为 0 则换一个）。
const SEED_KEY = "tick:1:cseed:1:1";
const PREG_LOSS = healthRollRange(`${SEED_KEY}:preg`, 0, 5);

describe("月度承养健康成本", () => {
  it("锁定 seedKey：承养损耗 > 0（保证后续断言非空跑）", () => {
    expect(PREG_LOSS).toBeGreaterThan(0);
  });

  it("承养损耗本身致死 → deathCause = pregnancy（非 illness）", () => {
    const out = projectMonthlyHealth({
      health: 1, status: "healthy", age: 25, isYearStart: false,
      pregnancyMonthlyCost: true, seedKey: SEED_KEY,
    });
    expect(out.died).toBe(true);
    expect(out.deathCause).toBe("pregnancy");
  });

  it("buildMonthlyHealthTick：承孕侍君精确多扣 PREG_LOSS；无孕对照不扣", () => {
    function stateWithConsort(rngSeed: number, carrying: boolean) {
      const s = createNewGameState(db);
      s.rngSeed = rngSeed;
      const cid = Object.keys(s.standing).find((id) => s.standing[id]!.lifecycle !== "deceased")!;
      s.standing[cid]!.health = 80;
      s.standing[cid]!.healthStatus = "healthy"; // 无病损；isYearStart=false → 无衰老
      if (carrying) s.resources.bloodline.gestations.push({ carrier: cid, conceivedAt: conceived, fatherId: cid, transferredAtMonth: 1 });
      return { s, cid };
    }
    // 用真实 seedKey 形态计算该局承养损耗（buildMonthlyHealthTick 内部 seedKey = tick:{rngSeed}:{cid}:{y}:{m}）
    const probe = stateWithConsort(7, true);
    const seedKey = `tick:${probe.s.rngSeed}:${probe.cid}:${probe.s.calendar.year}:${probe.s.calendar.month}`;
    const loss = healthRollRange(`${seedKey}:preg`, 0, 5);
    expect(loss).toBeGreaterThan(0); // 若为 0，换 rngSeed 直到 >0（强制确定性）

    const tick = buildMonthlyHealthTick(db, probe.s);
    const fx = tick.effects.find((e) => e.type === "set_consort_health" && (e as { char: string }).char === probe.cid) as { healthDelta?: number } | undefined;
    expect(fx).toBeDefined();
    expect(fx!.healthDelta).toBe(-loss); // 精确扣承养损耗（健康 status 无病损）

    // 对照：同 rngSeed、同 cid，但无 gestation → 无任何扣血效果
    const ctrl = stateWithConsort(7, false);
    const ctrlTick = buildMonthlyHealthTick(db, ctrl.s);
    const ctrlFx = ctrlTick.effects.find((e) => e.type === "set_consort_health" && (e as { char: string }).char === ctrl.cid);
    expect(ctrlFx).toBeUndefined();
  });
});
```

> `MonthlyHealthContext` 不含 `at`；`projectMonthlyHealth` 是纯投影。若仓库默认 `rngSeed`/`cid` 组合算出 `loss === 0`，按断言提示改 `rngSeed` 直至 `> 0`——断言本身强制你选对，无隐藏扫描。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/healthTickPregnancy.test.ts`
Expected: FAIL（死因仍 `illness`；orchestrator 仍硬编码 `pregnancyMonthlyCost: false` → 承孕侍君无扣血效果）

- [ ] **Step 3a: `projectMonthlyHealth` 拆怀孕损耗 + 归因死亡**

`src/store/healthTick.ts:22-43` 改为（怀孕损耗独立扣并先判死，归因 `"pregnancy"`；衰老/病损沿用 `"illness"`）：

```ts
export function projectMonthlyHealth(ctx: MonthlyHealthContext): MonthlyHealthOutcome {
  const previousHealth = ctx.health, previousStatus = ctx.status, k = ctx.seedKey;
  let h = ctx.health, nextStatus = ctx.status;
  // 1) 承养月度成本 — 若本身致死，归因 pregnancy
  const pregnancyLoss = ctx.pregnancyMonthlyCost ? healthRollRange(`${k}:preg`, 0, 5) : 0;
  h = clampPct(h - pregnancyLoss);
  if (h <= 0) return { previousHealth, nextHealth: 0, previousStatus, nextStatus: previousStatus, died: true, deathCause: "pregnancy" };
  // 2) 衰老 + 病损 — 归因 illness
  if (ctx.isYearStart && ctx.age >= 35) h -= 1 + Math.floor(ageOver35(ctx.age) / 10);
  if (previousStatus === "sick") h -= healthRollRange(`${k}:sickdmg`, 1, 2);
  else if (previousStatus === "critical") h -= healthRollRange(`${k}:critdmg`, 3, 5);
  h = clampPct(h);
  if (h <= 0) return { previousHealth, nextHealth: 0, previousStatus, nextStatus: previousStatus, died: true, deathCause: "illness" };
  if (previousStatus === "critical" && healthRoll(`${k}:sudden`) < 5)
    return { previousHealth, nextHealth: h, previousStatus, nextStatus: previousStatus, died: true, deathCause: "critical_sudden" };
  if (previousStatus === "healthy") {
    if (healthRollBasisPoints(`${k}:onset`) < monthlyIllnessRate(h, ctx.age) * 10000) nextStatus = "sick";
  } else if (previousStatus === "sick") {
    const criticalRate = Math.min(30, Math.max(1, 1 + ageOver35(ctx.age)));
    const r = healthRoll(`${k}:transition`);
    if (r < criticalRate) nextStatus = "critical";
    else if (r < criticalRate + 50) nextStatus = "healthy";
  }
  return { previousHealth, nextHealth: h, previousStatus, nextStatus, died: false };
}
```

> seedKey 各用途子键（`:preg`/`:sickdmg`/`:critdmg`/`:sudden`/`:onset`/`:transition`）保持不变，读档重算一致。

- [ ] **Step 3b: `buildMonthlyHealthTick` 接线 carrier 检测**

`src/store/healthTick.ts` 侍君遍历（109–128 行）：在 `const status = ...` 后加：

```ts
    const carrying = state.resources.bloodline.gestations.some((g) => g.carrier === consortId);
```

并把该处 `projectMonthlyHealth({ ..., pregnancyMonthlyCost: false, seedKey })` 改为 `pregnancyMonthlyCost: carrying`。

- [ ] **Step 4: 跑测试确认通过 + 类型**

Run: `npx vitest run tests/store/healthTickPregnancy.test.ts && npx tsc --noEmit`
Expected: PASS（3 测试）。另跑既有健康 tick 测试 `npx vitest run tests/store/` 确认归因拆分未回归。

- [ ] **Step 5: 提交**

```bash
git add src/store/healthTick.ts tests/store/healthTickPregnancy.test.ts
git commit -m "feat: 月度 tick 接线承养怀孕成本 + 怀孕损耗致死归因 pregnancy（非 illness）"
```

---

### Task 8: 转胎健康成本 −10（`planPregnancyTransfer`）

**Files:**
- Create: `src/store/pregnancyCost.ts`
- Modify: `src/ui/App.tsx`（`transferTo` 改用新组装）
- Test: `tests/store/pregnancyCost.test.ts`

**Interfaces:**
- Consumes: `planHealthChange`、现有 `pregnancy_transfer` 效果。
- Produces:
  - `planPregnancyTransfer(state, carrierId, atMonth, at): EventEffect[]` = `[pregnancy_transfer, ...扣血效果]`（先转胎落库，再扣 −10）
  - `childbirthCostDelta(bearerOutcome): number`（被 Task 9 消费）

- [ ] **Step 1: 写失败测试**

`tests/store/pregnancyCost.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { planPregnancyTransfer, childbirthCostDelta } from "../../src/store/pregnancyCost";
import { makeGameTime } from "../../src/engine/calendar/time";

const db = loadGameContent();
// 用 makeGameTime 派生合法 dayIndex（手填 dayIndex:120 与 元年五月上旬 不符，会触发日历不变量）。
const at = makeGameTime(1, 5, "early");

function withSovereignGestation(health: number) {
  const s = createNewGameState(db);
  const carrierId = Object.keys(s.standing).find((id) => s.standing[id]!.lifecycle !== "deceased")!;
  s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [carrierId] };
  s.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt: { year: 1, month: 3, period: "early", dayIndex: 60 } }];
  s.standing[carrierId]!.health = health;
  s.standing[carrierId]!.healthStatus = "healthy";
  return { s, carrierId };
}

describe("childbirthCostDelta", () => {
  it("safe −5 / child_dies −10 / bearer_dies 0 / both 0", () => {
    expect(childbirthCostDelta("safe")).toBe(-5);
    expect(childbirthCostDelta("child_dies")).toBe(-10);
    expect(childbirthCostDelta("bearer_dies")).toBe(0);
    expect(childbirthCostDelta("both")).toBe(0);
  });
});

describe("planPregnancyTransfer", () => {
  it("转胎落到侍君并扣 10 健康", () => {
    const { s, carrierId } = withSovereignGestation(70);
    const r = applyEffects(db, s, planPregnancyTransfer(s, carrierId, 3, at));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(true);
    expect(r.value.standing[carrierId]!.health).toBe(60);
  });

  it("转胎扣血致 0 → 侍君死亡 + 断胎 + 入身后事", () => {
    const { s, carrierId } = withSovereignGestation(6); // 6 − 10 ≤ 0
    const r = applyEffects(db, s, planPregnancyTransfer(s, carrierId, 3, at));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[carrierId]!.lifecycle).toBe("deceased");
    expect(r.value.resources.bloodline.gestations.some((g) => g.carrier === carrierId)).toBe(false); // 断胎
    expect(r.value.pendingAftermath.some((a) => a.subjectId === carrierId)).toBe(true);
  });
});
```

> 先读 `eventEffectSchema` 的 `pregnancy_transfer` 字段名（`carrierId`/`atMonth` 或其它）及 `App.tsx` 现有 `transferTo` 取值与造态 helper，照实对齐（`pregnancy`/`gestations` 形状以 schema 现状为准）。

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

/** 生产母方健康成本：safe −5；child_dies −10；bearer_dies/both 0（已亡，不追加）。 */
export function childbirthCostDelta(
  bearerOutcome: "safe" | "child_dies" | "bearer_dies" | "both",
): number {
  if (bearerOutcome === "safe") return -5;
  if (bearerOutcome === "child_dies") return -10;
  return 0;
}
```

> `pregnancy_transfer` 效果的字段名（`carrierId`/`atMonth`）必须与 `eventEffectSchema` 一致；若不同，改本函数的对象字面量以匹配 schema。

- [ ] **Step 4: App `transferTo` 改用 `planPregnancyTransfer`**

`src/ui/App.tsx` `transferTo`：把原 dispatch 单 `pregnancy_transfer`，改为 `store.applyEffects(db, planPregnancyTransfer(liveState, carrierId, atMonth, { ...liveState.calendar }))`（carrierId/atMonth 取原值）。转胎致死则 `pendingAftermath` 增条，照 Phase 2 身后事机制流转（本期不弹 UI）。

- [ ] **Step 5: 跑测试 + 类型 + 构建**

Run: `npx vitest run tests/store/pregnancyCost.test.ts && npx tsc --noEmit && npx vite build`
Expected: PASS，tsc 无错，build OK。

- [ ] **Step 6: 提交**

```bash
git add src/store/pregnancyCost.ts src/ui/App.tsx tests/store/pregnancyCost.test.ts
git commit -m "feat: 转胎 −10 健康成本（致死即断胎）+ childbirthCostDelta"
```

---

### Task 9: 生产健康成本 + 难产母死统一经死亡管线（`buildBirth` + birth handler）

**Files:**
- Modify: `src/engine/effects/funnel.ts`（`birth` apply handler：移除对 `bearer_dies`/`both` 的直接置死）
- Modify: `src/store/gestation.ts`（`buildBirth` 追加母方成本/死亡效果）
- Test: `tests/store/birthCost.test.ts`

**Interfaces:**
- Consumes: `childbirthCostDelta`（Task 8）、`planHealthChange`。
- Produces: `buildBirth` 返回 `effects = [birthEffect, ...maternalFx]`。`maternalFx` 按结局：`safe` → 成本 −5；`child_dies` → 成本 −10（母存活）；`bearer_dies`/`both` → `planHealthChange(forceDeath:true, cause:"childbirth")`（产出 `consort_decease` 写 `deathRecord.cause` + `enqueue_aftermath` 一条）。birth 效果不再负责母方死亡。

> **核心修正（统一死亡管线）**：当前 birth handler 对 `bearer_dies`/`both` 直接 `st.lifecycle = "deceased"`——**不写 `deathRecord`、不归因 `childbirth`、不入 `pendingAftermath`**，导致难产母死后 Phase 4 无法追封/办身后事。本任务把母方死亡从 birth handler 移除，统一由 `planHealthChange(forceDeath:true, cause:"childbirth")` 产出的 `consort_decease`（写 `deathRecord.cause="childbirth"` + 断胎）与 `enqueue_aftermath`（恰一条）承担。birth 效果只负责：皇嗣是否出生、移除 gestation、**生还**母方的恢复期/lifecycle。

> **测试不得用条件断言**：用一段临时脚本逐 `rngSeed` 扫描，找出对**固定造态**分别产出四种 `bearerOutcome`（`safe`/`child_dies`/`bearer_dies`/`both`）的具体种子，填入 `SAFE_SEED`/`CHILD_DIES_SEED`/`BEARER_DIES_SEED`/`BOTH_SEED`，然后**无条件** `expect(plan.bearerOutcome).toBe(...)`。先读 `gestation.ts` 的 `resolveBirth` 裁决逻辑确认 seedKey 构成（依赖哪些字段），固定这些字段后扫 `rngSeed`。

- [ ] **Step 0: 扫描确定 4 个 seed（实现期，临时脚本不提交）**

写一段临时脚本遍历 `rngSeed` 0..N，对**固定造态**（同一 carrier、同一 conceivedAt、同一生产月日历）调用 `buildBirth`，记录首个产出各 `bearerOutcome` 的种子，填入下方测试的四个常量，删除脚本。确保造态字段全部固定，使裁决可复现。

- [ ] **Step 1: 写失败测试（固定 seed，覆盖四结局 + 死亡管线）**

`tests/store/birthCost.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { buildBirth } from "../../src/store/gestation";

const db = loadGameContent();

// Step 0 扫描后填入的确定种子（无条件断言用）。
const SAFE_SEED = 0;        // TODO 实现期填：bearerOutcome==="safe"
const CHILD_DIES_SEED = 0;  // TODO 实现期填：bearerOutcome==="child_dies"
const BEARER_DIES_SEED = 0; // TODO 实现期填：bearerOutcome==="bearer_dies"
const BOTH_SEED = 0;        // TODO 实现期填：bearerOutcome==="both"

function dueBirth(rngSeed: number, health: number) {
  const s = createNewGameState(db);
  s.rngSeed = rngSeed;
  const cid = Object.keys(s.standing).find((id) => s.standing[id]!.lifecycle !== "deceased")!;
  s.standing[cid]!.health = health;
  s.standing[cid]!.healthStatus = "healthy";
  s.standing[cid]!.lifecycle = "carrying";
  // conceivedAt/日历需校准至生产月，使 buildBirth 命中（见 gestation 现有 plannedBirthOf；
  // 复用 tests/ 既有 birth 造态 helper）。
  s.resources.bloodline.gestations = [{ carrier: cid, conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, fatherId: cid, transferredAtMonth: 1 }];
  return { s, cid };
}

const aftermathFor = (st: ReturnType<typeof applyEffects>, cid: string) =>
  st.ok ? st.value.pendingAftermath.filter((a) => a.subjectId === cid) : [];

describe("生产健康成本 + 难产母死统一管线（固定 seed，无条件断言）", () => {
  it("顺产 safe：母方 −5，皇嗣存活，无身后事", () => {
    const { s, cid } = dueBirth(SAFE_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("safe");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.health).toBe(75); // 80 − 5
    expect(r.value.resources.bloodline.heirs.length).toBe(1);
    expect(r.value.standing[cid]!.lifecycle).not.toBe("deceased");
    expect(aftermathFor(r, cid).length).toBe(0);
  });

  it("顺产成本致死（safe，health=5 → −5=0）：皇嗣存活，母亡 + 身后事一条", () => {
    const { s, cid } = dueBirth(SAFE_SEED, 5);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("safe");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.length).toBe(1); // 已产存嗣
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased"); // 母亡
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });

  it("难产 child_dies：母方 −10 存活、无存活皇嗣", () => {
    const { s, cid } = dueBirth(CHILD_DIES_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("child_dies");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[cid]!.health).toBe(70); // 80 − 10
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(false); // 子亡
    expect(r.value.standing[cid]!.lifecycle).not.toBe("deceased"); // 母存活
    expect(aftermathFor(r, cid).length).toBe(0);
  });

  it("bearer_dies：皇嗣存活 / 母方 deceased / deathRecord.cause=childbirth / 身后事恰一条", () => {
    const { s, cid } = dueBirth(BEARER_DIES_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("bearer_dies");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(true); // 皇嗣存活
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased");
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });

  it("both：无存活皇嗣 / 母方 deceased / deathRecord.cause=childbirth / 身后事恰一条", () => {
    const { s, cid } = dueBirth(BOTH_SEED, 80);
    const plan = buildBirth(db, s)!;
    expect(plan.bearerOutcome).toBe("both");
    const r = applyEffects(db, s, plan.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs.some((h) => h.lifecycle === "alive")).toBe(false); // 子亡
    expect(r.value.standing[cid]!.lifecycle).toBe("deceased");
    expect(r.value.standing[cid]!.deathRecord!.cause).toBe("childbirth");
    expect(aftermathFor(r, cid).length).toBe(1);
  });
});
```

> 造态字段名（`gestations`/`lifecycle === "carrying"`）须与 schema/既有 birth 测试一致；若仓库已有 birth 造态 helper，复用之，仅覆盖 `rngSeed` 与 `health`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/birthCost.test.ts`
Expected: FAIL（`buildBirth` 未追加成本/死亡效果；`bearer_dies`/`both` 母方虽 deceased 但无 `deathRecord.cause`、无 `pendingAftermath`）

- [ ] **Step 3a: birth handler 移除母方直接置死**

`src/engine/effects/funnel.ts` 的 `case "birth":` 内，`if (effect.bearer !== "sovereign")` 分支改为（**只处理生还母方**，死亡留给后续 `consort_decease`）：

```ts
      if (effect.bearer !== "sovereign") {
        const st = next.standing[effect.bearer];
        if (st) {
          if (effect.bearerOutcome === "safe") {
            st.lifecycle = "delivered";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          } else if (effect.bearerOutcome === "child_dies") {
            st.lifecycle = "normal";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          }
          // bearer_dies / both: 母方死亡由后续 consort_decease 统一处理
          //（写 deathRecord.cause="childbirth" + 断胎 + enqueue_aftermath）；此处不置死。
        }
      }
```

同时**删除**该 handler 内现已无用的 `const bearerSurvives = ...` 局部（皇嗣落库仍由 `childSurvives` 决定，保留不动）。其余分支（`childSurvives` 推 heir、`gestations` 过滤、sovereign 分支）不变。

- [ ] **Step 3b: `buildBirth` 追加母方成本/死亡效果**

`src/store/gestation.ts` `buildBirth` 的 return：把单 `birth` 效果改为「birth + 母方效果」：

```ts
  const bearerSurvives = verdict.bearerOutcome === "safe" || verdict.bearerOutcome === "child_dies";
  const costDelta = childbirthCostDelta(verdict.bearerOutcome); // safe −5 / child_dies −10 / 其它 0
  let maternalFx: EventEffect[] = [];
  if (gest.carrier !== "sovereign") {
    maternalFx = bearerSurvives
      ? (costDelta !== 0
          ? planHealthChange(state, { subject: { kind: "consort", id: gest.carrier }, healthDelta: costDelta, cause: "childbirth", at: now }).effects
          : [])
      : planHealthChange(state, { subject: { kind: "consort", id: gest.carrier }, forceDeath: true, cause: "childbirth", at: now }).effects;
  }

  return {
    effects: [birthEffect, ...maternalFx], // 先落库皇嗣/移除 gestation，再扣血/置死母方（§5 顺序）
    lines,
    bearer: gest.carrier,
    bearerOutcome: verdict.bearerOutcome,
  };
```

import：`import { childbirthCostDelta } from "./pregnancyCost"; import { planHealthChange } from "./health";`（`EventEffect` 已由 `GestationPlan` 引入；`birthEffect`/`now`/`verdict`/`gest` 沿用现有局部名。当前 return 内联了 `birth` 效果对象——把它提为 `const birthEffect: EventEffect = { type: "birth", ... }` 再用于数组）。

> `planHealthChange` 读**生产前** state（母方仍存活、未断胎）：`safe`/`child_dies` 走成本扣血（若成本致 0 则其内部 `consort_decease` 顺带置死并入身后事）；`bearer_dies`/`both` 走 `forceDeath` 直接产出 `consort_decease`（`deathRecord.cause="childbirth"`）+ `enqueue_aftermath`。皇嗣已由前置 birth 效果落库（`bearer_dies` 存嗣、`both` 无嗣），且 birth 效果先移除 gestation，后续 `consort_decease` 的断胎为 no-op。

- [ ] **Step 4: 跑测试 + 既有回归 + 类型 + 构建**

Run: `npx vitest run tests/store/birthCost.test.ts && npx vitest run tests/store tests/engine && npx tsc --noEmit && npx vite build`
Expected: 新测试 PASS（5 测试）；tsc 无错，build OK。**既有 gestation/birth/heir-lifecycle 测试**：若有用例断言旧行为「birth 直接置 `deceased` 且无 `deathRecord`/无 `pendingAftermath`」，按新统一管线修正其断言（现在难产母死必带 `deathRecord.cause="childbirth"` 与一条身后事）。

- [ ] **Step 5: 提交**

```bash
git add src/engine/effects/funnel.ts src/store/gestation.ts tests/store/birthCost.test.ts
git commit -m "feat: 生产健康成本 −5/−10 + 难产母死统一经死亡管线（deathRecord.cause=childbirth + 身后事）"
```

---

### Task 10: gating 纯函数 `canHoldCourt` / `canBedchamber`

**Files:**
- Create: `src/store/gating.ts`
- Test: `tests/store/gating.test.ts`

**Interfaces:**
- Consumes: `sovereign.healthStatus`、`taihou.{deceased, mourningUntilDayExclusive}`、`calendar.dayIndex`（由 Task 4 写入 mourning 截止）。
- Produces: `type GateResult = { ok: true } | { ok: false; reason: string }`；`canHoldCourt(state)`、`canBedchamber(state)`。

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

  it("皇帝重病 → 上朝/侍寝禁，文案含凤体违和", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和");
    expect(canBedchamber(s).ok).toBe(false);
  });

  it("太后服丧窗口内禁，达独占上界恢复（死亡当日起 3 行动日）", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3;
    expect(canHoldCourt(s).ok).toBe(false); // 第1日
    const at3 = structuredClone(s); at3.calendar.dayIndex = s.calendar.dayIndex + 2;
    expect(canHoldCourt(at3).ok).toBe(false); // 第3日
    const at4 = structuredClone(s); at4.calendar.dayIndex = s.calendar.dayIndex + 3;
    expect(canHoldCourt(at4).ok).toBe(true); // 达上界恢复
  });

  it("deceased 但 mourningUntilDayExclusive 缺失 → 不阻止（防御）", () => {
    const s = createNewGameState(db);
    s.taihou.deceased = true; // 无 mourningUntilDayExclusive
    expect(canHoldCourt(s).ok).toBe(true);
  });

  it("重病 + 服丧叠加 → 禁，主因显示重病", () => {
    const s = createNewGameState(db);
    s.resources.sovereign.healthStatus = "critical";
    s.taihou.deceased = true;
    s.taihou.mourningUntilDayExclusive = s.calendar.dayIndex + 3;
    const c = canHoldCourt(s);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("凤体违和");
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
 * 纯函数，UI 与入口逻辑共用。
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

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/store/gating.test.ts`
Expected: PASS（5 测试）

- [ ] **Step 5: 提交**

```bash
git add src/store/gating.ts tests/store/gating.test.ts
git commit -m "feat: canHoldCourt/canBedchamber gating 纯函数（皇帝重病 + 太后服丧叠加）"
```

---

### Task 11: gating 接入 App（上朝 / 侍寝入口）

**Files:**
- Modify: `src/ui/App.tsx`（`beginCourt` / `startEvent("ev_chaohui")` + 侍寝入口接 gating；按钮禁用 + 文案）
- Test: 人工验证为主。

**Interfaces:**
- Consumes: `canHoldCourt`/`canBedchamber`（Task 10）。

> 先读 `App.tsx`：`beginCourt`（约 207）、`startEvent`（约 191，`ev_chaohui` 分支）、上朝按钮、侍寝入口（翻牌 / `BedchamberPicker`）。按钮 disabled 与点击处都接 gating（双保险）。

- [ ] **Step 1: `beginCourt` 守卫**

`beginCourt` 顶部（现有 AP 校验之前）加：

```ts
  const gate = canHoldCourt(store.getState());
  if (!gate.ok) { setReaction({ speakerId: "wei_sui", lines: [gate.reason] }); return; }
```

import `canHoldCourt`。（`setReaction`/`wei_sui` 旁白入口名以现状为准。）

- [ ] **Step 2: 上朝按钮禁用 + 提示**

上朝入口按钮：`disabled = !canHoldCourt(liveState).ok`，禁用提示用 `canHoldCourt(liveState)` 的 `reason`（与既有 AP 禁用并列，不替换）。

- [ ] **Step 3: 侍寝入口守卫 + 禁用**

侍寝（翻牌子 / `BedchamberPicker` 打开入口）：打开前 `const g = canBedchamber(liveState); if (!g.ok) { setReaction({ speakerId: "wei_sui", lines: [g.reason] }); return; }`；按钮 `disabled = !canBedchamber(liveState).ok` + reason 提示。import `canBedchamber`。既有「对象状态」类禁用**叠加**不替换。

- [ ] **Step 4: `commitBedchamber` 落实前二次 gate**

打开 modal 与实际落实（选定侍君、确认侍寝）之间状态可能改变（例如期间触发事件致太后薨、时间推进跨日）。故在 `commitBedchamber`（实际写入侍寝 / 调用 `resolveTimedAction` 之前）**再次**校验：

```ts
  const g = canBedchamber(store.getState());
  if (!g.ok) { setBedchamberOpen(false); setReaction({ speakerId: "wei_sui", lines: [g.reason] }); return; }
```

> 入口禁用只是辅助；唯一权威是落实点的 `canBedchamber(store.getState())`——读 commit 时的最新 state，非打开时缓存的 `liveState`。（`commitBedchamber` / 关闭 setter 名以现状为准。）

- [ ] **Step 5: 类型检查 + 构建 + 人工验证**

Run: `npx tsc --noEmit && npx vite build`
Expected: tsc 无错，build OK。

人工验证（记录于报告）：
- 皇帝 `healthStatus=critical` → 上朝/侍寝禁，点击有拦截文案「凤体违和」。
- 太后死亡后服丧 3 行动日内禁，满 3 日恢复。
- 两者叠加显示「凤体违和」（重病优先）。
- 入口打开后状态转为禁止（如期间太后薨）→ `commitBedchamber` 二次 gate 拦截，不写侍寝。

- [ ] **Step 6: 提交**

```bash
git add src/ui/App.tsx
git commit -m "feat: 上朝/侍寝接入重病+服丧 gating（按钮禁用 + 拦截文案 + commitBedchamber 二次 gate）"
```

---

## 最终整支审查

11 个任务完成后，按 subagent-driven-development 派最强模型做整支审查（`scripts/review-package $(git merge-base main HEAD) HEAD`）。重点核对 §12 测试要点跨任务不变量：①看诊每月每人一次由**引擎**强制（funnel validate + 事务回滚），非仅 UI；②读档不重掷（seedKey 稳定）；③转胎/生产扣血致 0 即时死亡且断胎/存嗣正确（固定 seed 无条件断言）；④重病+服丧 gating 叠加，且 `taihou_decease` 真正写入服丧截止；⑤承养月度成本接线；⑥太医确定性派生；⑦`SAVE_FORMAT_VERSION=7` 旧档 quarantine、无 v6 迁移；⑧看诊文案显示 `actualHealing` 实际回血。

整支审查后用 superpowers:finishing-a-development-branch 收尾（开 PR，base = `main`）。

---

## Self-Review（plan vs spec + v3.1 review 闭环）

**1. Spec coverage：**
- §4.1 四类看诊/各 1 AP → T6。✓
- §4.2 每月每人一次 → **引擎强制**：T1（validate）+ T5（null 守卫）+ T6（picker 禁用）。✓
- §4.3 看诊结算（加血/治愈/写月键/立绘复用/官员姓名池/official1-8）→ T3/T5/T6。✓
- §4.4 manifest official1-8 → **main 已存在，本期不改**（删除旧 manifest 任务）。✓
- §5 转胎 −10（T8）/承养月度（T7）/生产 −5/−10（T9）；皇帝自孕不计（T7/T9 `carrier !== "sovereign"`）。✓
- §6.5 转胎未产→断胎（T8）、已产存嗣仅母亡（T9，固定 seed）。✓
- §8 重病 + 服丧 gating → T10 + T11；服丧截止由 T4 写入。✓
- §11 分期：Phase 4 仅余葬仪谥号 UI / 追封 / 奉先殿 — 不触碰。✓

**2. v3.1 review 七点闭环：**
1. 服丧 gating 失效 → **T4**（`taihou_decease` 写 `mourningUntilDayExclusive`，幂等不延长）。✓
2. 存档版本矛盾 → **T2**（`SAVE_FORMAT_VERSION=7`，无 MIGRATIONS[6]，旧档 quarantine 测试）。✓
3. 每月每人一次仅 UI → **T1** validate 强制（月键/存活/未请脉/判别式 subject）+ **T5** 返回 null 不伪造 healthy + **T6** 事务回滚测试。✓
4. manifest 任务过期 → **删除**（Global Constraints 注明 main 已有）。✓
5. PhysicianModal 互斥歧义 → **T6** 唯一结构（看诊区常驻 + 流胎/承养**各自独立判定**共存）。✓
6. 文案显示实际回血 → **T5** `actualHealing` + **T6** 文案规则（0 回血不显示虚假 +N，主体中性）。✓
7. 生产空断言 → **T9** 固定四 seed，无条件 `expect(bearerOutcome).toBe(...)`。✓

**2b. v3.2 review 四点闭环（执行前阻塞项）：**
1. 自孕/承养共存条件写反 → **T6**：`selfCarrying` 与 `consortCarrying` 各自独立渲染，承养说明不再 `!selfCarrying` 前置（三者可共存）。✓
2. 事务测试与 `GameStore` API 不匹配 → **T6**：`new GameStore()` + `loadState(createNewGameState(db))`；`resolveTimedAction` 返回 `TimedOutcome{rolledOver,monthChanged,healthOutcome}`，断言一律读 `store.getState()`。✓
3. 假绿测试 + 怀孕死因错误 → **T7**：扫定 `PREG_LOSS>0` 的 seed 无条件断言精确扣血 + 无孕对照；`projectMonthlyHealth` 怀孕损耗独立判死归因 `"pregnancy"`（衰老/病损仍 `"illness"`），新增 health=1 致死归因测试。✓
4. 难产母死绕过死亡管线 → **T9**：母死从 birth handler 移除，统一经 `planHealthChange(forceDeath, cause:"childbirth")` → `consort_decease`（`deathRecord.cause`）+ `enqueue_aftermath`；`bearer_dies`/`both` 新测试断言 `deathRecord.cause="childbirth"` + 身后事恰一条。✓

**3. Placeholder scan：** 仅 T9 留四个 `*_SEED` 待扫描——TDD 内禀步骤（Step 0 明确扫描方法），非计划缺口。✓

**4. Type consistency：** `HealthSubject` = `PhysicianSubject`；`record_physician_visit.subject` 判别联合在 T1 schema/validate/apply、T5、T6 一致；`PhysicianVisitPlan`（rolledHealing/actualHealing/cured）T5 定义、T6 消费一致；`childbirthCostDelta`（T8）被 T9 消费一致；`GateResult`（T10）被 T11 消费一致；`ConsultOption`（T5）与 PhysicianModal `consults` props 一致；`GameStore` 构造/`loadState`/`TimedOutcome` 形状与 `src/store/gameStore.ts` 一致（T6 已校准）。✓

**实现期需对齐项**：① `pregnancy_transfer` 字段名以 schema 为准（T8）；② `buildBirth` 造态用 `plannedBirthOf` 校准日历 + 四 seed 扫描（T9）；③ `pickSurname`/`pickGivenName`/`livingConsortIds` 签名（T3/T5）；④ `commitBedchamber`/关闭 setter 名（T11）。（v3.1 的「GameStore 构造/`resolveTimedAction` 形状」一项已在 v3.2 校准并写实，移出待对齐清单。）
