# 宗亲 Slice A 亲缘数据基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `state.parentage` 作为所有「已建模父母—子女关系」生身/法统亲缘的唯一权威来源，并把现有 `Heir` 抚养字段语义消歧（`adoptiveFatherId`→`custodianId`）。

**Architecture:** 新增三个顶层权威容器（`parentage` / `adoptionRecords` / `royalResidences`）+ 两个 `nextSeq` 计数器；出生流程写 parentage（legal=bio，母=sovereign）；旧 `Heir.adoptiveFatherId` 全仓 rename 为 `custodianId`（抚养/监护，非过继），所有消费者改走 `getCurrentCustodian`；纯查询 selectors 分离 bio/legal 两链；存档迁移（v38→v39）回填 parentage；分层 validation 守护不变量。**无任何宗亲玩法、UI、过继命令。**

**Tech Stack:** TypeScript、Zod（`z.strictObject` 运行时 schema）、Vitest、自研 `Result<T,E>` 错误通道、自研存档迁移 ladder（`MIGRATIONS` registry）。

**设计依据：** `docs/superpowers/specs/2026-06-28-zongqin-parentage-foundation-design.md`（已确认设计，3 轮评审）。

## Global Constraints

- **唯一权威：** `state.parentage` 是已建模父母—子女关系的唯一真相；`Heir` 字段 / `kinship` / UI 仅为投影，禁止反向写。完整性约束**仅覆盖 `Heir`**（`state.resources.bloodline.heirs`）；`royalRelatives` / `familyMembers` / `officials` / `generatedConsorts` / `officialCandidates` 暂不要求 parentage。
- **null vs undefined：** parent 字段必填；father 为 `PersonId | null`（`null`=自孕，`undefined`=损坏/未建立，禁止作为业务值）。`SOVEREIGN_PERSON_ID = "sovereign"`，是合法父母引用，不要求存在于 `db.characters`/`state.standing`。
- **生身不可变：** 运行时只有 `establishBirthParentage`（仅初始化一次）写 bio；无通用 `setParentageField`；不得修改/删除 bio。过继命令属 Slice D，不在本计划。
- **镜像不变量：** `heir.fatherId === parentage[heir.id].biologicalFatherId`（含 `null`）。`fatherId` 仅由出生与迁移写。
- **抚养≠法统：** `custodianId` 是抚养/监护；不写 `legalFatherId`，不生成 `AdoptionRecord`。皇后抚养使 `legitimate=true` 仍非过继。`getCurrentCustodian` 只返回登记抚养人，不做资格判断。
- **存档版本：** parentage 迁移为 **v38 → v39**（`MIGRATIONS[38]`，`SAVE_FORMAT_VERSION`→39）。**实现时先 `grep SAVE_FORMAT_VERSION` 确认当前值**——main 仍可能推进，届时顺延（迁移键 = 当前版本，目标 = 当前+1）。迁移函数只转换 state + 提升版本 + 重算 checksum；schema/cross-link validation 由 load pipeline 后续阶段执行。
- **rename 验收靠 grep：** 完成后 `grep -rn adoptiveFatherId src tests content docs` 仅允许命中：(a) `MIGRATIONS[38]` legacy 读取；(b) `docs/superpowers/{specs,plans}/` 历史归档（spec/plan 正当引用旧名）。`faction:"adoptive"` 同理。`src/store/adoption.ts`（实为「择养父」抚养模块）改名释放 "adoption" 名给 Slice D。
- **交付边界：** 全部任务作为**一个原子 Slice A**（单 PR 按 commit 分层，或依赖栈），**不得**各任务单独合并到 `main`（strict schema + 单次版本提升要求同批落地）。每个任务结束时 `npx tsc --noEmit` 与该任务测试必须通过（build 全程保持 green）。
- **承养/孕育历史（`bearer`）保持现状**（留在 `Heir.bearer`），`GestationRecord` 延后。`RoyalResidence` **不**持久化 `childIds`（经 `getLegalChildren` 派生）。

---

## File Structure

| 文件 | 责任 | 任务 |
|------|------|------|
| `src/engine/state/types.ts` | 新增实体/容器类型、`SOVEREIGN_PERSON_ID`、`ParentPair`；Heir 字段 rename | 1, 4 |
| `src/engine/save/stateSchema.ts` | 新容器 zod schema；Heir `custodianId`/faction rename + reject-both | 1, 4 |
| `src/engine/state/initialState.ts` | `createInitialState` 初始化三容器 + 两计数器 | 1 |
| `src/engine/state/newGame.ts` | `createNewGameState` 同上 | 1 |
| `src/engine/characters/parentage/parentageSelectors.ts` | 纯查询 selectors（bio/legal 两链 + getCurrentCustodian） | 2, 4 |
| `src/engine/characters/parentage/establishBirthParentage.ts` | 出生建 parentage 命令（Result 通道，仅初始化） | 3 |
| `src/engine/effects/funnel.ts` | birth case 调用建 parentage；rename 消费 | 3, 4 |
| `src/engine/characters/custodianAvailability.ts`、`companionReconciliation.ts`、`store/heirCustody.ts`、UI 5 文件 | `adoptiveFatherId`→`getCurrentCustodian`/`custodianId` | 4 |
| `src/store/fosterFather.ts`（由 `adoption.ts` 改名） | 择养父抚养模块改名 | 4 |
| `src/engine/save/saveSystem.ts` | `MIGRATIONS[38]` + `SAVE_FORMAT_VERSION`=39 | 5 |
| `src/engine/save/parentageValidation.ts` | cross-link 不变量（约束 8） | 6 |
| `tests/...` | 各任务测试 | all |

---

## Task 1: 类型与空容器脚手架（additive，build green）

**Files:**
- Modify: `src/engine/state/types.ts`（新增类型 + `GameState` 字段；**本任务不动 Heir.adoptiveFatherId**）
- Modify: `src/engine/save/stateSchema.ts`（新增 schema + `gameStateSchema` 字段）
- Modify: `src/engine/state/initialState.ts`、`src/engine/state/newGame.ts`
- Test: `tests/state/parentageContainers.test.ts`

**Interfaces:**
- Produces:
  - `export const SOVEREIGN_PERSON_ID = "sovereign"` (`src/engine/state/types.ts`)
  - `type PersonId = string`
  - `interface CharacterParentage { biologicalMotherId: PersonId; biologicalFatherId: PersonId | null; legalMotherId: PersonId; legalFatherId: PersonId | null; activeAdoptionRecordId?: string }`
  - `interface ParentPair { motherId: PersonId; fatherId: PersonId | null }`
  - `interface AdoptionRecord {...}` / `interface RoyalResidence {...}` / `type AdoptionReason` / `type RoyalResidenceTitleType`
  - `GameState` 新增：`parentage: Record<string, CharacterParentage>`、`adoptionRecords: Record<string, AdoptionRecord>`、`royalResidences: Record<string, RoyalResidence>`、`adoptionNextSeq: number`、`royalResidenceNextSeq: number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/parentageContainers.test.ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { SOVEREIGN_PERSON_ID } from "../../src/engine/state/types";

describe("parentage 容器脚手架", () => {
  it("createInitialState 初始化三容器为空、两计数器为 1", () => {
    const s = createInitialState();
    expect(s.parentage).toEqual({});
    expect(s.adoptionRecords).toEqual({});
    expect(s.royalResidences).toEqual({});
    expect(s.adoptionNextSeq).toBe(1);
    expect(s.royalResidenceNextSeq).toBe(1);
  });

  it("createNewGameState 同样初始化三容器与两计数器（验收 #18）", () => {
    const s = createNewGameState(loadRealContent());
    expect(s.parentage).toEqual({});
    expect(s.adoptionRecords).toEqual({});
    expect(s.royalResidences).toEqual({});
    expect(s.adoptionNextSeq).toBe(1);
    expect(s.royalResidenceNextSeq).toBe(1);
  });

  it("SOVEREIGN_PERSON_ID 为 'sovereign'", () => {
    expect(SOVEREIGN_PERSON_ID).toBe("sovereign");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/parentageContainers.test.ts`
Expected: FAIL（`SOVEREIGN_PERSON_ID` 未导出 / 字段不存在）

- [ ] **Step 3: Add types to `src/engine/state/types.ts`**

在文件末尾（或紧邻 `Heir` 定义后）追加：

```ts
export const SOVEREIGN_PERSON_ID = "sovereign";
export type PersonId = string;
export type CharacterId = string;
export type AdoptionRecordId = string;   // adopt_NNNNNN
export type RoyalResidenceId = string;   // res_NNNNNN

export interface ParentPair {
  motherId: PersonId;
  fatherId: PersonId | null;
}

export interface CharacterParentage {
  biologicalMotherId: PersonId;
  biologicalFatherId: PersonId | null;
  legalMotherId: PersonId;
  legalFatherId: PersonId | null;
  activeAdoptionRecordId?: AdoptionRecordId;
}

export type AdoptionReason =
  | "imperial_succession"
  | "preserve_branch"
  | "political_settlement";

export interface AdoptionRecord {
  id: AdoptionRecordId;
  childId: CharacterId;
  previousLegalMotherId: PersonId;
  previousLegalFatherId: PersonId | null;
  newLegalMotherId: PersonId;
  newLegalFatherId: PersonId | null;
  fromResidenceId?: RoyalResidenceId;
  toResidenceId?: RoyalResidenceId;
  effectiveAt: GameTime;
  reason: AdoptionReason;
  status: "active" | "revoked" | "superseded";
}

export type RoyalResidenceTitleType =
  | "fengzhu" | "guizhu"
  | "zhang_fengzhu" | "zhang_guizhu"
  | "dazhang_fengzhu" | "dazhang_guizhu";

export interface RoyalResidence {
  id: RoyalResidenceId;
  holderId: CharacterId;
  titleType: RoyalResidenceTitleType;
  spouseIds: CharacterId[];
  legalHeirId?: CharacterId;
  lineage: { founderId: CharacterId; parentResidenceId?: RoyalResidenceId };
}
```

在 `interface GameState { ... }` 内（任意位置，与其他 `Record<...>` 字段相邻）加入：

```ts
  parentage: Record<CharacterId, CharacterParentage>;
  adoptionRecords: Record<AdoptionRecordId, AdoptionRecord>;
  royalResidences: Record<RoyalResidenceId, RoyalResidence>;
  adoptionNextSeq: number;
  royalResidenceNextSeq: number;
```

- [ ] **Step 4: Add zod schema to `src/engine/save/stateSchema.ts`**

在 `gameStateSchema` 定义之前加入（沿用文件惯用 `z.strictObject` 风格；`idSchema`、`gameTimeSchema` 已存在于本文件）：

```ts
const characterParentageSchema = z.strictObject({
  biologicalMotherId: idSchema,                       // SOVEREIGN_PERSON_ID 满足 idSchema
  biologicalFatherId: z.union([idSchema, z.null()]),
  legalMotherId: idSchema,
  legalFatherId: z.union([idSchema, z.null()]),
  activeAdoptionRecordId: z.string().regex(/^adopt_\d{6}$/).optional(),
});

const adoptionRecordSchema = z.strictObject({
  id: z.string().regex(/^adopt_\d{6}$/),
  childId: idSchema,
  previousLegalMotherId: idSchema,
  previousLegalFatherId: z.union([idSchema, z.null()]),
  newLegalMotherId: idSchema,
  newLegalFatherId: z.union([idSchema, z.null()]),
  fromResidenceId: z.string().regex(/^res_\d{6}$/).optional(),
  toResidenceId: z.string().regex(/^res_\d{6}$/).optional(),
  effectiveAt: gameTimeSchema,
  reason: z.enum(["imperial_succession", "preserve_branch", "political_settlement"]),
  status: z.enum(["active", "revoked", "superseded"]),
});

const royalResidenceSchema = z.strictObject({
  id: z.string().regex(/^res_\d{6}$/),
  holderId: idSchema,
  titleType: z.enum([
    "fengzhu", "guizhu", "zhang_fengzhu", "zhang_guizhu",
    "dazhang_fengzhu", "dazhang_guizhu",
  ]),
  spouseIds: z.array(idSchema),
  legalHeirId: idSchema.optional(),
  lineage: z.strictObject({
    founderId: idSchema,
    parentResidenceId: z.string().regex(/^res_\d{6}$/).optional(),
  }),
});
```

在 `gameStateSchema = z.strictObject({ ... })` 内加入：

```ts
  parentage: z.record(idSchema, characterParentageSchema),
  adoptionRecords: z.record(z.string().regex(/^adopt_\d{6}$/), adoptionRecordSchema),
  royalResidences: z.record(z.string().regex(/^res_\d{6}$/), royalResidenceSchema),
  adoptionNextSeq: z.number().int().min(1),
  royalResidenceNextSeq: z.number().int().min(1),
```

- [ ] **Step 5: Init in both constructors**

`src/engine/state/initialState.ts` 与 `src/engine/state/newGame.ts` 各自在返回的 state 对象字面量中加入：

```ts
    parentage: {},
    adoptionRecords: {},
    royalResidences: {},
    adoptionNextSeq: 1,
    royalResidenceNextSeq: 1,
```

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run tests/state/parentageContainers.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 无错误（其它测试可能因新增 required 字段在各自 fixture 处失败——见 Step 7）。

- [ ] **Step 7: Fix fixtures that build GameState literals**

Run: `npx vitest run 2>&1 | grep -iE "parentage|adoptionNextSeq|royalResidence" | head`
对每个直接构造完整 `GameState` 的测试工厂/fixture，补上 Step 5 的五个字段。常见入口：`tests/**/helpers*.ts`、`tests/**/fixtures*.ts`、`src/**/testFactory*.ts`。

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿。

- [ ] **Step 8: Commit**

> Step 7 改动的 fixture 必须一并提交，否则破坏「每 task 一个完整 green commit」。用 `git add -A`。

```bash
git add -A
git commit -m "feat(parentage): 新增 parentage/adoptionRecords/royalResidences 容器与类型"
```

---

## Task 2: parentage selectors（纯查询，build green）

**Files:**
- Create: `src/engine/characters/parentage/parentageSelectors.ts`
- Test: `tests/characters/parentage/parentageSelectors.test.ts`

**Interfaces:**
- Consumes: `CharacterParentage`、`ParentPair`、`PersonId`、`GameState`（Task 1）
- Produces:
  - `getBiologicalParents(state, characterId): ParentPair | undefined`
  - `getLegalParents(state, characterId): ParentPair | undefined`
  - `getBiologicalChildren(state, parentId): string[]`（按 child id 升序）
  - `getLegalChildren(state, parentId): string[]`（按 child id 升序）
  - `getBiologicalAncestors(state, characterId, maxDepth?): PersonId[]`（层级、母系优先）
  - `getLegalDescendants(state, parentId, maxDepth?): string[]`（世代 BFS，同代按 id 升序）

> 注：`getCurrentCustodian` 在 Task 4 与 rename 同批加入（依赖 `Heir.custodianId`）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/characters/parentage/parentageSelectors.test.ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import {
  getBiologicalParents, getLegalParents,
  getLegalChildren, getBiologicalAncestors, getLegalDescendants,
} from "../../../src/engine/characters/parentage/parentageSelectors";
import { SOVEREIGN_PERSON_ID, type GameState } from "../../../src/engine/state/types";

function withParentage(): GameState {
  const s = createInitialState();
  // 人工构造 bio/legal 分歧：heir_a 生身父 shen_zhibai，法统父 xie_minglang（模拟未来过继）。
  s.parentage = {
    heir_a: { biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: "shen_zhibai",
              legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: "xie_minglang" },
    heir_b: { biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: null,
              legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: null },
    heir_a1: { biologicalMotherId: "heir_a", biologicalFatherId: "consort_x",
               legalMotherId: "heir_a", legalFatherId: "consort_x" },
  };
  return s;
}

describe("parentage selectors", () => {
  it("getBiologicalParents 返回 ParentPair（含 null father）", () => {
    expect(getBiologicalParents(withParentage(), "heir_b"))
      .toEqual({ motherId: SOVEREIGN_PERSON_ID, fatherId: null });
  });
  it("bio 与 legal 链可区分", () => {
    const s = withParentage();
    expect(getBiologicalParents(s, "heir_a")!.fatherId).toBe("shen_zhibai");
    expect(getLegalParents(s, "heir_a")!.fatherId).toBe("xie_minglang");
  });
  it("无记录返回 undefined", () => {
    expect(getBiologicalParents(withParentage(), "unknown_child")).toBeUndefined();
  });
  it("getLegalChildren 按 id 升序", () => {
    expect(getLegalChildren(withParentage(), SOVEREIGN_PERSON_ID)).toEqual(["heir_a", "heir_b"]);
  });
  it("getLegalDescendants 世代 BFS", () => {
    expect(getLegalDescendants(withParentage(), SOVEREIGN_PERSON_ID)).toEqual(["heir_a", "heir_b", "heir_a1"]);
  });
  it("getBiologicalAncestors 母系优先、带 visited 防环", () => {
    expect(getBiologicalAncestors(withParentage(), "heir_a1"))
      .toEqual(["heir_a", "consort_x", SOVEREIGN_PERSON_ID, "shen_zhibai"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/characters/parentage/parentageSelectors.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement selectors**

```ts
// src/engine/characters/parentage/parentageSelectors.ts
import type { GameState, ParentPair, PersonId } from "../../state/types";

export function getBiologicalParents(state: GameState, characterId: string): ParentPair | undefined {
  const p = state.parentage[characterId];
  return p ? { motherId: p.biologicalMotherId, fatherId: p.biologicalFatherId } : undefined;
}

export function getLegalParents(state: GameState, characterId: string): ParentPair | undefined {
  const p = state.parentage[characterId];
  return p ? { motherId: p.legalMotherId, fatherId: p.legalFatherId } : undefined;
}

function childrenBy(state: GameState, parentId: PersonId, link: "bio" | "legal"): string[] {
  const out: string[] = [];
  for (const [childId, p] of Object.entries(state.parentage)) {
    const m = link === "bio" ? p.biologicalMotherId : p.legalMotherId;
    const f = link === "bio" ? p.biologicalFatherId : p.legalFatherId;
    if (m === parentId || f === parentId) out.push(childId);
  }
  return out.sort();
}

export function getBiologicalChildren(state: GameState, parentId: PersonId): string[] {
  return childrenBy(state, parentId, "bio");
}
export function getLegalChildren(state: GameState, parentId: PersonId): string[] {
  return childrenBy(state, parentId, "legal");
}

export function getBiologicalAncestors(
  state: GameState, characterId: string, maxDepth = Infinity,
): PersonId[] {
  const visited = new Set<PersonId>([characterId]);
  const out: PersonId[] = [];
  let frontier: PersonId[] = [characterId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: PersonId[] = [];
    for (const id of frontier) {
      const p = state.parentage[id];
      if (!p) continue;
      // 母系优先：mother 先于 father
      for (const parent of [p.biologicalMotherId, p.biologicalFatherId]) {
        if (parent == null || visited.has(parent)) continue;
        visited.add(parent);
        out.push(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
  return out;
}

export function getLegalDescendants(
  state: GameState, parentId: PersonId, maxDepth = Infinity,
): string[] {
  const visited = new Set<PersonId>([parentId]);
  const out: string[] = [];
  let frontier: PersonId[] = [parentId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const gen: string[] = [];
    for (const id of frontier) {
      for (const child of getLegalChildren(state, id)) {
        if (visited.has(child)) continue;
        visited.add(child);
        gen.push(child);
      }
    }
    gen.sort();
    out.push(...gen);
    frontier = gen;
  }
  return out;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/characters/parentage/parentageSelectors.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/parentage/parentageSelectors.ts tests/characters/parentage/parentageSelectors.test.ts
git commit -m "feat(parentage): bio/legal 两链纯查询 selectors"
```

---

## Task 3: `establishBirthParentage` + 出生接入（build green）

**Files:**
- Create: `src/engine/characters/parentage/establishBirthParentage.ts`
- Modify: `src/engine/effects/funnel.ts`（`case "birth"` 内，每名出生 heir 经 `establishBirthParentage` 写 parentage）
- Test: `tests/characters/parentage/establishBirthParentage.test.ts`（新建，单元）；`tests/effects/funnel.birth.test.ts`（**修改既有文件**，集成）

**Interfaces:**
- Consumes: `CharacterParentage`、`SOVEREIGN_PERSON_ID`（Task 1）、`Result`/`stateError`（既有）
- Produces:
  - `buildBirthParentage(biologicalFatherId: string | null): CharacterParentage`（纯，legal=bio，母=sovereign）
  - `establishBirthParentage(state, input: { childId: string; biologicalFatherId: string | null }): Result<GameState, GameError[]>`（已存在则 `err`，不改输入）

- [ ] **Step 1: Write the failing test**

```ts
// tests/characters/parentage/establishBirthParentage.test.ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import { establishBirthParentage, buildBirthParentage } from "../../../src/engine/characters/parentage/establishBirthParentage";
import { SOVEREIGN_PERSON_ID } from "../../../src/engine/state/types";

describe("establishBirthParentage", () => {
  it("buildBirthParentage：legal=bio，母=sovereign，自孕 father=null", () => {
    expect(buildBirthParentage(null)).toEqual({
      biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: null,
      legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: null,
    });
  });
  it("初始化写入 parentage", () => {
    const r = establishBirthParentage(createInitialState(), { childId: "heir_000001", biologicalFatherId: "c1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.parentage["heir_000001"].legalFatherId).toBe("c1");
  });
  it("重复建立返回 PARENTAGE_ALREADY_ESTABLISHED 且不改输入", () => {
    const s = createInitialState();
    const first = establishBirthParentage(s, { childId: "heir_000001", biologicalFatherId: "c1" });
    expect(first.ok).toBe(true);
    const base = first.ok ? first.value : s;
    const dup = establishBirthParentage(base, { childId: "heir_000001", biologicalFatherId: "c2" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error[0]?.code).toBe("PARENTAGE_ALREADY_ESTABLISHED"); // noUncheckedIndexedAccess
    expect(base.parentage["heir_000001"]?.biologicalFatherId).toBe("c1"); // 未被改
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/characters/parentage/establishBirthParentage.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement command**

```ts
// src/engine/characters/parentage/establishBirthParentage.ts
import { SOVEREIGN_PERSON_ID, type CharacterParentage, type GameState } from "../../state/types";
import { stateError, type GameError } from "../../infra/errors";
import { err, ok, type Result } from "../../infra/result";

export function buildBirthParentage(biologicalFatherId: string | null): CharacterParentage {
  return {
    biologicalMotherId: SOVEREIGN_PERSON_ID,
    biologicalFatherId,
    legalMotherId: SOVEREIGN_PERSON_ID,
    legalFatherId: biologicalFatherId,
  };
}

export function establishBirthParentage(
  state: GameState,
  input: { childId: string; biologicalFatherId: string | null },
): Result<GameState, GameError[]> {
  if (state.parentage[input.childId]) {
    return err([stateError("PARENTAGE_ALREADY_ESTABLISHED",
      `parentage already exists for "${input.childId}"`, { context: { char: input.childId } })]);
  }
  return ok({
    ...state,
    parentage: { ...state.parentage, [input.childId]: buildBirthParentage(input.biologicalFatherId) },
  });
}
```

- [ ] **Step 4: Run command test**

Run: `npx vitest run tests/characters/parentage/establishBirthParentage.test.ts`
Expected: PASS

- [ ] **Step 5: Add real assertions to existing `tests/effects/funnel.birth.test.ts`**

不新建占位测试、不新增 self-preg/twin 用例（文件已有完整 safe / child_dies / both / self-pregnancy / twin 用例，`fatherId: "lu_huaijin"`，safe 的 heir id = `heir_000001`）。先在文件顶部加 import：
```ts
import { buildBirthParentage } from "../../src/engine/characters/parentage/establishBirthParentage";
```
然后在**既有用例**的 `if (!r.ok) return;` 之后**追加**断言（不改原断言）：

```ts
// 既有 "safe → appends heir..." 用例追加：
expect(r.value.parentage["heir_000001"]).toEqual(buildBirthParentage("lu_huaijin"));

// 既有 "child_dies → no heir..." 用例追加：
expect(r.value.parentage).toEqual({});

// 既有 "both → no heir..." 用例追加：
expect(r.value.parentage).toEqual({});

// 既有 "self-pregnancy birth (bearer sovereign)..." 用例追加：
expect(r.value.parentage[r.value.resources.bloodline.heirs[0]!.id])
  .toEqual(buildBirthParentage(null));

// 既有 "twin birth (twinSex+twinFavor)..." 用例追加（两条独立 key，均 fatherId=lu_huaijin）：
expect(r.value.parentage["heir_000001"]).toEqual(buildBirthParentage("lu_huaijin"));
expect(r.value.parentage["heir_000002"]).toEqual(buildBirthParentage("lu_huaijin"));
expect(Object.keys(r.value.parentage)).toHaveLength(2);
```

- [ ] **Step 6: Run to verify new assertions fail**

Run: `npx vitest run tests/effects/funnel.birth.test.ts`
Expected: FAIL（birth 尚未写 parentage → `parentage` 为空）

- [ ] **Step 7: Wire into `funnel.ts` `case "birth"` via the single write entry**

`case "birth"` 顶部 import：`import { establishBirthParentage } from "../characters/parentage/establishBirthParentage";`（文件顶部）。`makeHeir` 改为先入 heirs，再经唯一写入口建 parentage（**不**直接赋值 `next.parentage[...]`）：

```ts
          const pushHeir = (sex: typeof effect.sex, favor: number) => {
            const heir = makeHeir(sex, favor);
            bl.heirs.push(heir);
            const res = establishBirthParentage(next, { childId: heir.id, biologicalFatherId: effect.fatherId });
            if (!res.ok) return res;          // 新 id 不可能撞，仍按 Result 通道传播
            next.parentage = res.value.parentage;
            return undefined;
          };
          const e1 = pushHeir(effect.sex, effect.favor);
          if (e1) return e1;
          if (effect.twinSex !== undefined && effect.twinFavor !== undefined) {
            const e2 = pushHeir(effect.twinSex, effect.twinFavor);
            if (e2) return e2;
          }
```

（删除原 `bl.heirs.push(makeHeir(...))` 两行。`effect.fatherId: string | null` 与 `Heir.fatherId` 一致，满足镜像不变量；`establishBirthParentage` 内部硬编码 `SOVEREIGN_PERSON_ID`，故 birth case 不再硬编码 `"sovereign"`。`child_dies`/`both` 因 `childSurvives=false` 不进入此块。**不**设默认 custodian。`applyEffects` 返回 `Result<GameState, GameError[]>`，故 `return res`（Err）类型相容。）

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run tests/effects/funnel.birth.test.ts tests/characters/parentage && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/engine/characters/parentage/establishBirthParentage.ts src/engine/effects/funnel.ts \
  tests/characters/parentage/establishBirthParentage.test.ts tests/effects/funnel.birth.test.ts
git commit -m "feat(parentage): 出生经唯一写入口建立 parentage（legal=bio，母=sovereign，含双生）"
```

---

## Task 4: custodian / faction 全仓 rename（atomic，build green）

**Files:**
- Modify: `src/engine/state/types.ts`（`Heir.adoptiveFatherId`→`custodianId`；faction `"adoptive"`→`"custodian"`）
- Modify: `src/engine/save/stateSchema.ts`（heir schema 同步；reject-both 校验）
- Modify: `src/engine/characters/parentage/parentageSelectors.ts`（加 `getCurrentCustodian`）
- Modify (rename 消费者，以 grep 为准): `src/engine/effects/funnel.ts`、`src/engine/characters/custodianAvailability.ts`、`src/engine/characters/companionReconciliation.ts`、`src/store/heirCustody.ts`、`src/ui/components/HeirListModal.tsx`、`src/ui/components/HeirSummonPicker.tsx`、`src/ui/components/CharacterProfileDrawer.tsx`、`src/ui/components/ConsortListModal.tsx`、`src/ui/screens/FengxiandianScreen.tsx`、`src/engine/content/schemas.ts`
- Rename: `src/store/adoption.ts` → `src/store/fosterFather.ts`（API + 测试同步改抚养语义）
- Test: `tests/characters/parentage/getCurrentCustodian.test.ts`（新建）；`tests/characters/heirUpbringingSettlement.test.ts`（**改既有 fixture**）；`tests/store/heirCustody.test.ts` 或 funnel custody 测试（**加皇后抚养≠过继用例**）

**Interfaces:**
- Produces: `getCurrentCustodian(state, childId): string | undefined`（读 `Heir.custodianId`，仅登记查询，不判资格）

- [ ] **Step 1: Write failing test for `getCurrentCustodian` + rename regression**

```ts
// tests/characters/parentage/getCurrentCustodian.test.ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../../../src/engine/state/initialState";
import { getCurrentCustodian } from "../../../src/engine/characters/parentage/parentageSelectors";

describe("getCurrentCustodian", () => {
  it("读 Heir.custodianId（登记即返回，不判资格）", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_000001", custodianId: "c9" } as any);
    expect(getCurrentCustodian(s, "heir_000001")).toBe("c9");
  });
  it("无 custodian 返回 undefined", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_000002" } as any);
    expect(getCurrentCustodian(s, "heir_000002")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/characters/parentage/getCurrentCustodian.test.ts`
Expected: FAIL（`getCurrentCustodian` 未导出 / `custodianId` 不在类型）

- [ ] **Step 3: Rename Heir field + faction in `types.ts`**

`Heir` 内 `adoptiveFatherId?: string;` → `custodianId?: string;`；`HeirFaction`（或内联 union）中 `"adoptive"` → `"custodian"`。

- [ ] **Step 4: Update `stateSchema.ts` heir schema**

heir `z.strictObject` 内 `adoptiveFatherId: idSchema.optional()` → `custodianId: idSchema.optional()`；faction `z.enum([...,"adoptive",...])` 的 `"adoptive"` → `"custodian"`。

> 无需额外的 reject-both `superRefine`：heir schema 是 `z.strictObject`，删除 `adoptiveFatherId` 后，任何残留的旧字段都会触发 strict 的 unknown-key 失败；旧 `faction:"adoptive"` 也会被新 enum 拒绝。strictObject 即是保障。

- [ ] **Step 5: Add `getCurrentCustodian` to selectors**

```ts
// append to parentageSelectors.ts
export function getCurrentCustodian(state: GameState, childId: string): string | undefined {
  return state.resources.bloodline.heirs.find((h) => h.id === childId)?.custodianId;
}
```

- [ ] **Step 6: Rewrite all `adoptiveFatherId` consumers (grep-driven)**

Run: `grep -rn "adoptiveFatherId" src` — 逐处改写：
- 读取语境（取当前抚养人）→ `getCurrentCustodian(state, heir.id)` 或直接 `heir.custodianId`（同一 heir 对象内）。
- 写入/赋值语境（如 `funnel.ts` heir_custody `heir.adoptiveFatherId = effect.custodianId` → `heir.custodianId = effect.custodianId`）。
- `custodianAvailability.ts:32` `const custodianId = heir.adoptiveFatherId;` → `const custodianId = heir.custodianId;`。
- 注释/文案中的 `adoptiveFatherId` 一并更新。

Run: `grep -rn "\"adoptive\"" src` — faction 比较/赋值改 `"custodian"`。

- [ ] **Step 7: Audit `heir.fatherId` business reads（验收 #5）**

Run: `grep -rn "heir\.fatherId\|\.fatherId" src` — 所有**亲缘语义**读取改走 `getBiologicalParents`。已知必改两处。**禁止 `?? null`**（会把「无 parentage=损坏」混成「自孕」）；用显式分支：
- `src/store/adoption.ts`（即将改名）`bioFatherAvailable` 开头改为：
```ts
const parents = getBiologicalParents(state, heir.id);
if (!parents) return false;          // 无 parentage（损坏）→ 不可依
const fatherId = parents.fatherId;
if (fatherId === null) return false; // 自孕 → 无生父
// ...后续用 fatherId 替换原 heir.fatherId
```
- `src/store/heirCustody.ts:190` `toChar.id === heir.fatherId`（「是否生父」判断）→ `toChar.id === getBiologicalParents(state, heir.id)?.fatherId`（此处 `?.` 安全：仅比较相等，undefined≠任何 charId，不产生自孕误判）。

仅允许保留 `heir.fatherId` 直读的语境：出生写镜像、migration legacy 读取、validation 镜像比较。

- [ ] **Step 8: Rename `store/adoption.ts` → `store/fosterFather.ts`（API 同步抚养语义）**

```bash
git mv src/store/adoption.ts src/store/fosterFather.ts
```
按 spec 同步改 API（释放「adoption」名给 Slice D）：`eligibleAdoptiveFathers` → `eligibleFosterFathers`；`buildAdoptionReaction` → `buildFosterFatherReaction`；`bioFatherAvailable` 名称无歧义，保留。导入方 `grep -rn "store/adoption\|eligibleAdoptiveFathers\|buildAdoptionReaction" src tests` 全部改路径/改名。若存在 `tests/**/adoption*.test.ts`，`git mv` 为 `fosterFather*.test.ts` 并改 import/调用名。

- [ ] **Step 9: 改 `heirUpbringingSettlement.test.ts` fixture（rename 回归，验收 #4）**

不新建测试。在 `tests/characters/heirUpbringingSettlement.test.ts` 把 `makeHeir`/fixture 里的 `adoptiveFatherId: "..."` 改为 `custodianId: "..."`，**保留**现有 `neglect`/`custodianBond`/`careOutcome` 结果断言不变（证明行为不变）。补一条正向断言：
```ts
// 带 custodian 的 heir 不应判为无人照料
expect(c.careOutcome).not.toBe("no_effective_custodian");
```

- [ ] **Step 10: 加皇后抚养≠过继用例（验收 #15）**

在 `tests/store/heirCustody.test.ts`（或现有 funnel custody 测试）加用例：把某 heir 抚养权 `heir_custody` 转给当朝皇后，断言：
```ts
const beforeLegal = before.parentage[heirId]!.legalFatherId;
// ...apply heir_custody → empress...
expect(afterHeir.legitimate).toBe(true);
expect(after.parentage[heirId]!.legalFatherId).toBe(beforeLegal); // 法统父不变
expect(after.adoptionRecords).toEqual({});                        // 不生成过继记录
```

- [ ] **Step 11: Run full suite + typecheck + grep gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿。
Run: `grep -rn "adoptiveFatherId" src tests content ; grep -rn "\"adoptive\"" src tests content`
Expected: **无输出**（迁移在 Task 5 才引入合法的 legacy 读取；本任务尚未到 Task 5）。
Run: `grep -rn "heir\.fatherId" src`
Expected: 仅出生写镜像 / migration / validation 镜像比较三类语境。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(parentage): adoptiveFatherId→custodianId / faction adoptive→custodian 全仓迁移；adoption.ts→fosterFather.ts；fatherId 读取改走 selector"
```

---

## Task 5: 存档迁移 v38→v39

**Files:**
- Modify: `src/engine/save/saveSystem.ts`（`MIGRATIONS[38]` + `SAVE_FORMAT_VERSION`=39）
- Test: `tests/save/migrationV39.test.ts`

**Interfaces:**
- Consumes: `checksumOf`（`./canonical`，既有 import）
- Produces: `MIGRATIONS[38]`

- [ ] **Step 1: Confirm current version**

Run: `grep -n "SAVE_FORMAT_VERSION =" src/engine/save/saveSystem.ts`
Expected: `38`。若已 >38，迁移键/目标顺延（键=当前值，目标=当前+1），下文 38/39 相应替换。

- [ ] **Step 2: Write failing migration test**

```ts
// tests/save/migrationV39.test.ts
import { describe, it, expect } from "vitest";
import { MIGRATIONS, SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

describe("v38→v39 parentage 迁移", () => {
  it("SAVE_FORMAT_VERSION = 39", () => { expect(SAVE_FORMAT_VERSION).toBe(39); });

  it("回填 parentage、rename custodian、flip faction、加空容器", () => {
    const env: any = { formatVersion: 38, state: { resources: { bloodline: { heirs: [
      { id: "heir_000001", fatherId: "c1", adoptiveFatherId: "c2", faction: "adoptive" },
      { id: "heir_000002", fatherId: null, faction: "none" },
    ] } } } };
    const out: any = MIGRATIONS[38](env);
    expect(out.formatVersion).toBe(39);
    const h1 = out.state.resources.bloodline.heirs[0];
    expect(h1.custodianId).toBe("c2");
    expect(h1.adoptiveFatherId).toBeUndefined();
    expect(h1.faction).toBe("custodian");
    expect(out.state.parentage["heir_000001"]).toEqual({
      biologicalMotherId: "sovereign", biologicalFatherId: "c1",
      legalMotherId: "sovereign", legalFatherId: "c1",
    });
    expect(out.state.parentage["heir_000002"].biologicalFatherId).toBeNull();
    expect(out.state.adoptionRecords).toEqual({});
    expect(out.state.royalResidences).toEqual({});
    expect(out.state.adoptionNextSeq).toBe(1);
    expect(out.state.royalResidenceNextSeq).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/save/migrationV39.test.ts`
Expected: FAIL（`SAVE_FORMAT_VERSION` 仍 38；`MIGRATIONS[38]` 未定义）

- [ ] **Step 4: Implement migration**

`SAVE_FORMAT_VERSION = 38` → `39`。在 `MIGRATIONS` 中加入：

```ts
  // v38 → v39: 亲缘数据基础（Slice A）。回填 parentage；adoptiveFatherId→custodianId；
  // faction "adoptive"→"custodian"；新增 adoptionRecords/royalResidences + 两计数器。
  38: (old): SaveEnvelope => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bl = ((state["resources"] as any)?.["bloodline"]) as { heirs?: any[] } | undefined;
    const parentage: Record<string, unknown> = (state["parentage"] as any) ?? {};
    for (const heir of bl?.heirs ?? []) {
      // 不做 `?? null` fallback：null=自孕、undefined=损坏。原值原样保留——
      // 若坏档 fatherId 为 undefined，迁移后 required schema 拒绝并 quarantine（绝不静默修成自孕）。
      const fatherId = heir["fatherId"];
      parentage[heir.id] = {
        biologicalMotherId: SOVEREIGN_PERSON_ID, biologicalFatherId: fatherId,
        legalMotherId: SOVEREIGN_PERSON_ID, legalFatherId: fatherId,
      };
      heir.custodianId = heir.adoptiveFatherId; // 可能 undefined
      delete heir.adoptiveFatherId;
      if (heir.faction === "adoptive") heir.faction = "custodian";
    }
    state["parentage"] = parentage;
    if (typeof state["adoptionRecords"] !== "object" || state["adoptionRecords"] == null) state["adoptionRecords"] = {};
    if (typeof state["royalResidences"] !== "object" || state["royalResidences"] == null) state["royalResidences"] = {};
    if (typeof state["adoptionNextSeq"] !== "number") state["adoptionNextSeq"] = 1;
    if (typeof state["royalResidenceNextSeq"] !== "number") state["royalResidenceNextSeq"] = 1;
    return { ...env, formatVersion: 39, state: state as unknown as GameState, checksum: checksumOf(state) };
  },
```
（在 `saveSystem.ts` 顶部 import `SOVEREIGN_PERSON_ID`：`import { SOVEREIGN_PERSON_ID } from "../state/types";`，与既有 `GameState` import 合并。）

- [ ] **Step 5: Write failing real-pipeline integration test（经 readSlot）**

直接调用 `MIGRATIONS[38]` 只证明函数改了对象，不证明 ladder/checksum/schema/validation 接得通。新增（沿用 `migrationV37.test.ts` 的 `makeV3xSave` 降级样板）：

```ts
// tests/save/migrationV39Load.test.ts
import { describe, it, expect } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** 把当前版本状态降级成 v38 形态（删新字段、heir 还原 adoptiveFatherId/faction）。 */
function makeV38Save(mutateHeir?: (h: any) => void): string {
  const s = createNewGameState(db);
  // 注入一名 v38 形态 heir
  (s.resources.bloodline.heirs as any).push({
    id: "heir_000001", sex: "daughter", fatherId: "lu_huaijin", bearer: "lu_huaijin",
    birthAt: { year: 1, month: 1, dayIndex: 1 }, favor: 10, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50,
    personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
    interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive", healthStatus: "healthy",
  });
  const raw = structuredClone(s) as any;
  delete raw.parentage; delete raw.adoptionRecords; delete raw.royalResidences;
  delete raw.adoptionNextSeq; delete raw.royalResidenceNextSeq;
  for (const h of raw.resources.bloodline.heirs) {
    h.adoptiveFatherId = h.custodianId; delete h.custodianId;
    if (h.faction === "custodian") h.faction = "adoptive";
    mutateHeir?.(h);
  }
  const env = { ...createSaveData(db, s, "slot1"), formatVersion: 38, state: raw, checksum: checksumOf(raw) };
  return JSON.stringify(env);
}

describe("v38 → v39 经 readSlot 真实迁移", () => {
  it("合法 v38 档迁移并通过 schema+validation", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save());
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const st = loaded.value.state;
    expect(st.parentage["heir_000001"]).toEqual({
      biologicalMotherId: "sovereign", biologicalFatherId: "lu_huaijin",
      legalMotherId: "sovereign", legalFatherId: "lu_huaijin",
    });
    expect((st.resources.bloodline.heirs[0] as any).adoptiveFatherId).toBeUndefined();
    expect(st.adoptionRecords).toEqual({});
    expect(st.adoptionNextSeq).toBe(1);
  });

  it("坏档 fatherId=undefined 迁移后被 schema 拒绝（不静默成 null）", () => {
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, makeV38Save((h) => { delete h.fatherId; }));
    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(false); // required fatherId/biologicalFatherId 缺失 → schema 失败 → quarantine
  });
});
```

- [ ] **Step 6: Implement migration（Step 4 代码）+ run**

Run: `npx vitest run tests/save/migrationV39.test.ts tests/save/migrationV39Load.test.ts && npx vitest run && npx tsc --noEmit`
Expected: 全绿（含既有 save round-trip 测试）。

- [ ] **Step 7: Commit**

```bash
git add src/engine/save/saveSystem.ts tests/save/migrationV39.test.ts tests/save/migrationV39Load.test.ts
git commit -m "feat(parentage): v38→v39 迁移回填 parentage 并消歧 custodian/faction（含 readSlot 集成）"
```

---

## Task 6: cross-link validation（约束 8）

**Files:**
- Create: `src/engine/save/parentageValidation.ts`
- Modify: `src/engine/save/saveSystem.ts`（在 `gameStateSchema.safeParse` 通过后、content cross-check 阶段调用，约 line 901–940 区段）
- Test: `tests/save/parentageValidation.test.ts`

**Interfaces:**
- Consumes: `GameState`、`ContentDB`（cross-check 阶段可见 db）。环检测用本文件独立 `hasCycle`（三色 DFS），**不**复用防环 selector。
- Produces: `validateParentage(state, db): GameError[]`（空数组=通过）

- [ ] **Step 1: Write failing test**

```ts
// tests/save/parentageValidation.test.ts
import { describe, it, expect } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { validateParentage } from "../../src/engine/save/parentageValidation";

const db: any = { characters: { c1: {} } };

function stateWithHeir(parentage: any, heir: any = { id: "heir_000001", fatherId: "c1" }) {
  const s = createInitialState();
  s.resources.bloodline.heirs.push(heir);
  s.parentage = parentage;
  return s;
}

describe("validateParentage", () => {
  it("每个 heir 必须有 parentage", () => {
    const s = stateWithHeir({});
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_MISSING_FOR_HEIR");
  });
  it("fatherId 镜像不一致 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "cX", legalMotherId: "sovereign", legalFatherId: "cX" } });
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_MIRROR_MISMATCH");
  });
  it("自指 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "heir_000001", legalMotherId: "sovereign", legalFatherId: "heir_000001" }, }, { id: "heir_000001", fatherId: "heir_000001" });
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_SELF_REFERENCE");
  });
  it("biological 环 a→b→a → 失败", () => {
    const s = createInitialState();
    s.parentage = {
      heir_a: { biologicalMotherId: "heir_b", biologicalFatherId: null, legalMotherId: "heir_b", legalFatherId: null },
      heir_b: { biologicalMotherId: "heir_a", biologicalFatherId: null, legalMotherId: "heir_a", legalFatherId: null },
    } as any;
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_BIO_CYCLE");
  });
  it("legal 环 a→b→c→a → 失败", () => {
    const s = createInitialState();
    s.parentage = {
      heir_a: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_c", legalFatherId: null },
      heir_b: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_a", legalFatherId: null },
      heir_c: { biologicalMotherId: "sovereign", biologicalFatherId: null, legalMotherId: "heir_b", legalFatherId: null },
    } as any;
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_LEGAL_CYCLE");
  });
  it("合法共享祖先不是环 → 通过", () => {
    const s = createInitialState();
    s.resources.bloodline.heirs.push({ id: "heir_a", fatherId: "c1" } as any, { id: "heir_b", fatherId: "c1" } as any);
    s.parentage = {
      heir_a: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" },
      heir_b: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" },
    } as any;
    expect(validateParentage(s, db)).toEqual([]);
  });
  it("sovereign 引用合法、无环 → 通过", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    expect(validateParentage(s, db)).toEqual([]);
  });
  it("active AdoptionRecord 缺反向引用 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    s.adoptionRecords = { adopt_000001: { id: "adopt_000001", childId: "heir_000001", previousLegalMotherId: "sovereign", previousLegalFatherId: "c1", newLegalMotherId: "sovereign", newLegalFatherId: "c1", effectiveAt: { year: 1, month: 1, dayIndex: 1 } as any, reason: "preserve_branch", status: "active" } } as any;
    expect(validateParentage(s, db).map(e => e.code)).toContain("ADOPTION_RECORD_UNREFERENCED");
  });

  it("未知 parent 引用 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "ghost", legalMotherId: "sovereign", legalFatherId: "ghost" } },
      { id: "heir_000001", fatherId: "ghost" });
    expect(validateParentage(s, db).map(e => e.code)).toContain("PARENTAGE_UNKNOWN_PERSON");
  });

  it("residence map key 与 id 不符 → 失败", () => {
    const s = stateWithHeir({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId: "c1" } });
    s.royalResidences = { res_000001: { id: "res_000002", holderId: "heir_000001", titleType: "fengzhu", spouseIds: [], lineage: { founderId: "heir_000001" } } } as any;
    expect(validateParentage(s, db).map(e => e.code)).toContain("RESIDENCE_KEY_MISMATCH");
  });

  // parentage → record 正向不变量（验收 #22）
  const goodParentage = (legalFatherId: string | null = "c1", activeAdoptionRecordId?: string) =>
    ({ heir_000001: { biologicalMotherId: "sovereign", biologicalFatherId: "c1", legalMotherId: "sovereign", legalFatherId, ...(activeAdoptionRecordId ? { activeAdoptionRecordId } : {}) } });
  const rec = (over: Record<string, unknown> = {}) =>
    ({ adopt_000001: { id: "adopt_000001", childId: "heir_000001", previousLegalMotherId: "sovereign", previousLegalFatherId: "c1", newLegalMotherId: "sovereign", newLegalFatherId: "c1", effectiveAt: { year: 1, month: 1, dayIndex: 1 }, reason: "preserve_branch", status: "active", ...over } });

  it.each([
    ["pointer 悬空（record 不存在）", () => { const s = stateWithHeir(goodParentage("c1", "adopt_000001")); return s; }, "ADOPTION_POINTER_INVALID"],
    ["record childId 错误", () => { const s = stateWithHeir(goodParentage("c1", "adopt_000001")); s.adoptionRecords = rec({ childId: "heir_999999" }) as any; return s; }, "ADOPTION_POINTER_INVALID"],
    ["pointer 指向非 active", () => { const s = stateWithHeir(goodParentage("c1", "adopt_000001")); s.adoptionRecords = rec({ status: "revoked" }) as any; return s; }, "ADOPTION_POINTER_INVALID"],
  ])("%s → 失败", (_label, build, code) => {
    expect(validateParentage(build() as any, db).map(e => e.code)).toContain(code);
  });
});
```

> 上面的 `goodParentage`/`rec` 帮手与已有 `stateWithHeir` 同文件；`it.each` 三行覆盖正向 pointer 的三种坏态。反向（active record 未被引用 / legal 快照不一致）已由「缺反向引用」用例覆盖。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/save/parentageValidation.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement validator**

```ts
// src/engine/save/parentageValidation.ts
import type { GameState, PersonId } from "../state/types";
import { SOVEREIGN_PERSON_ID } from "../state/types";
import { stateError, type GameError } from "../infra/errors";

// 独立三色 DFS——**不**复用带 visited 防环的 selector：那些 selector 永远不把起点放进结果，
// 故 `ancestors(x).includes(x)` 恒为 false，无法识别环。这里用 visiting/done 标记真正检测环。
function hasCycle(state: GameState, link: "biological" | "legal"): boolean {
  const mark = new Map<PersonId, "visiting" | "done">();
  const visit = (id: PersonId): boolean => {
    if (mark.get(id) === "visiting") return true;
    if (mark.get(id) === "done") return false;
    mark.set(id, "visiting");
    const p = state.parentage[id];
    if (p) {
      const parents = link === "biological"
        ? [p.biologicalMotherId, p.biologicalFatherId]
        : [p.legalMotherId, p.legalFatherId];
      for (const parentId of parents) {
        if (parentId !== null && state.parentage[parentId] && visit(parentId)) return true;
      }
    }
    mark.set(id, "done");
    return false;
  };
  return Object.keys(state.parentage).some(visit);
}

export function validateParentage(state: GameState, db: { characters: Record<string, unknown> }): GameError[] {
  const errs: GameError[] = [];
  const heirs = state.resources.bloodline.heirs;
  const known = new Set<PersonId>([
    SOVEREIGN_PERSON_ID,
    ...heirs.map((h) => h.id),
    ...Object.keys(state.standing),
    ...Object.keys(state.generatedConsorts),
    ...Object.keys(db.characters),
  ]);

  // 1. 每个 heir 必有 parentage + 镜像一致
  for (const h of heirs) {
    const p = state.parentage[h.id];
    if (!p) { errs.push(stateError("PARENTAGE_MISSING_FOR_HEIR", `heir ${h.id} lacks parentage`, { context: { char: h.id } })); continue; }
    if ((h.fatherId ?? null) !== p.biologicalFatherId) {
      errs.push(stateError("PARENTAGE_MIRROR_MISMATCH", `heir ${h.id} fatherId != biologicalFatherId`, { context: { char: h.id } }));
    }
  }

  // 2. 自指 + 引用合法
  for (const [childId, p] of Object.entries(state.parentage)) {
    for (const ref of [p.biologicalMotherId, p.biologicalFatherId, p.legalMotherId, p.legalFatherId]) {
      if (ref == null) continue;
      if (ref === childId) errs.push(stateError("PARENTAGE_SELF_REFERENCE", `${childId} references self`, { context: { char: childId } }));
      else if (!known.has(ref)) errs.push(stateError("PARENTAGE_UNKNOWN_PERSON", `${childId} references unknown ${ref}`, { context: { char: childId } }));
    }
  }

  // 3. 无环（bio + legal）：独立三色 DFS（见 hasCycle 注释）
  if (hasCycle(state, "biological")) errs.push(stateError("PARENTAGE_BIO_CYCLE", "biological parentage cycle"));
  if (hasCycle(state, "legal")) errs.push(stateError("PARENTAGE_LEGAL_CYCLE", "legal parentage cycle"));

  // 4. AdoptionRecord 双向不变量
  for (const [k, r] of Object.entries(state.adoptionRecords)) {
    if (r.id !== k) errs.push(stateError("ADOPTION_KEY_MISMATCH", `key ${k} != id ${r.id}`, { context: { key: k } }));
    if (r.status !== "active") continue;
    const p = state.parentage[r.childId];
    if (!p || p.activeAdoptionRecordId !== r.id
        || p.legalMotherId !== r.newLegalMotherId || p.legalFatherId !== r.newLegalFatherId) {
      errs.push(stateError("ADOPTION_RECORD_UNREFERENCED", `active record ${r.id} not back-referenced`, { context: { char: r.childId } }));
    }
  }
  // parentage → record 正向（悬空 / 错 child / 指向非 active）
  for (const [childId, p] of Object.entries(state.parentage)) {
    if (!p.activeAdoptionRecordId) continue;
    const r = state.adoptionRecords[p.activeAdoptionRecordId];
    if (!r || r.childId !== childId || r.status !== "active") {
      errs.push(stateError("ADOPTION_POINTER_INVALID", `${childId} activeAdoptionRecordId dangling`, { context: { char: childId } }));
    }
  }

  // 5. residence map key 自洽
  for (const [k, r] of Object.entries(state.royalResidences)) {
    if (r.id !== k) errs.push(stateError("RESIDENCE_KEY_MISMATCH", `key ${k} != id ${r.id}`, { context: { key: k } }));
  }
  return errs;
}
```

- [ ] **Step 4: Wire into load pipeline**

在 `saveSystem.ts` 的 `readSlot` 中，`gameStateSchema.safeParse` 成功、且 content-id cross-check / 官员世界 cross-collection validators 那一段（grep `readSlot` 函数体内现有的 cross-check 调用定位，约 §940 区段）追加：

```ts
const parentageErrors = validateParentage(parsedState.data, db);
if (parentageErrors.length > 0) {
  const key = quarantine(storage, slot, raw, options);
  return err(saveError("PARENTAGE_INVALID",
    `slot "${slot}" failed parentage validation; quarantined to ${key}`,
    { context: { slot, quarantineKey: key, codes: parentageErrors.map((e) => e.code) } }));
}
```

（`parsedState`、`quarantine`、`raw`、`saveError` 均为 `readSlot` 内既有符号——以实际变量名为准；与相邻官员 cross-collection validator 的失败/quarantine 写法保持一致。）import `validateParentage` 于文件顶部。

- [ ] **Step 5: Write failing load-pipeline integration test**

```ts
// tests/save/parentageValidationLoad.test.ts
import { describe, it, expect } from "vitest";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { checksumOf } from "../../src/engine/save/canonical";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("readSlot parentage validation 接线", () => {
  it("schema 合法但某 heir 缺 parentage → readSlot 失败并 quarantine", () => {
    const s = createNewGameState(db);
    // 注入一名 heir 但故意不给它 parentage（schema 仍通过——heir schema 不要求 parentage）
    s.resources.bloodline.heirs.push({
      id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
      birthAt: { year: 1, month: 1, dayIndex: 1 }, favor: 10, legitimate: true, petName: "",
      education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50,
      personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
      interests: [], imperialFear: 20, neglect: 40, custodianBond: 0,
      portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
      ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive", healthStatus: "healthy",
    } as any);
    // parentage 保持为空 {}（来自 createNewGameState）

    const storage = createMemoryStorage();
    const env = { ...createSaveData(db, s, "slot1"), checksum: checksumOf(s) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.code).toBe("PARENTAGE_INVALID");
    // 已 quarantine：原 slot 不再可正常读出该状态
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).toBeNull();
  });
});
```

> 该测试证明：即便实现者忘记在 `readSlot` 调 `validateParentage`，此用例也会失败——堵住「unit 全绿但未接线」的漏洞。

- [ ] **Step 6: Run tests + full suite + typecheck**

Run: `npx vitest run tests/save/parentageValidation.test.ts tests/save/parentageValidationLoad.test.ts && npx vitest run && npx tsc --noEmit`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/engine/save/parentageValidation.ts src/engine/save/saveSystem.ts \
  tests/save/parentageValidation.test.ts tests/save/parentageValidationLoad.test.ts
git commit -m "feat(parentage): cross-link validation 接入 readSlot（镜像/自指/无环/过继双向/key/quarantine）"
```

---

## Final verification

- [ ] `npx tsc --noEmit` 全绿
- [ ] `npx vitest run` 全绿
- [ ] `grep -rn "adoptiveFatherId" src tests content docs` 仅命中 `MIGRATIONS[38]` legacy 读取与 `docs/superpowers/{specs,plans}/` 归档；`grep -rn "\"adoptive\"" src tests content` 仅命中 `MIGRATIONS[38]`
- [ ] 比对 spec §7 验收标准 1–22 逐条有测试覆盖
- [ ] 确认全部 commit 在 `feat/zongqin-parentage-foundation`，未合并入 `main`（作为一个原子 Slice A PR）

---

## Self-Review 备注（spec 覆盖映射）

| spec §7 验收 | 任务 |
|---|---|
| 1,11,12 出生/双生/自孕 parentage | Task 3 |
| 2 legal=bio 两组相等 | Task 3 + Task 6(镜像) |
| 3,9,16,19 迁移/round-trip/grep | Task 5 + Task 4 |
| 4 抚养行为不变 | Task 4 (Step 9：改 heirUpbringingSettlement fixture，保留结果断言) |
| 5 不依赖 fatherId | Task 4 (Step 6 消费者改写 + Step 7 fatherId 审计) |
| 6 重复建立失败 | Task 3 |
| 7,13,14,21,22 validation（含 bio/legal 环） | Task 6 (三色 DFS hasCycle) |
| 8,20 双链 selector | Task 2 |
| 10,18 空容器/constructor | Task 1 |
| 15 皇后抚养≠过继 | Task 4 (Step 10 显式用例：legitimate=true、legalFatherId 不变、adoptionRecords 空) |
| 17 adoption.ts→fosterFather + API 改名 | Task 4 (Step 8) |
