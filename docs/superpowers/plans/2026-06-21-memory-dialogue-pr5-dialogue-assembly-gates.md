# Memory-Dialogue PR5: 对话装配 + Claim Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把召回到的记忆/事件经「想表达哪些 claim → 这些 claim 是否符合角色认知/礼制/audience → 模型实际用了哪些来源才写冷却」的确定性装配与校验链路接入现有 orchestrator seam。

**Architecture:** 五个纯模块（audience / claims 类型 / claim assembler / claim gate / mention 写回）+ 一个 orchestrator policy seam。装配在 provider 之前构造 audience、claimNeeds→候选/禁止 claim 并连同 forbiddenClaims、offeredContextIds 一并下发；provider 返回结构化 `proposedClaims` 后，claim gate（只读 `BeliefProjection`，非 ground truth）→ 现有 text gates → **整行接受后**按 accepted claims 的 `sourceContextIds` 写 `MemoryMentionRecord`。完整 relation/disposition/`planReaction` 实时装配不在本 PR——`reactionPlan` 可由调用方提供或显式 neutral 回退，**orchestrator 内不临时重算简化版 relation/disposition**。

**Tech Stack:** TypeScript, Zod, Vitest. 复用 PR1 `chronicle/belief.ts`（`BeliefProjection`/`FactKey`/`GroundTruthBeliefProjection`/`courtMemberVisibility`）、PR3 `dialogue/reactionTypes.ts`（`ReactionPlan`/`ClaimNeed`/`AudienceRole`）、PR4 `dialogue/mention.ts`（`appendMention`/`MemoryMentionRecord`）、`dialogue/memoryContext.ts`（`DialogueMemoryContext`）。

## Global Constraints

- **纯函数 + 确定性**：所有装配/校验函数同输入同输出；同分 tie-break 用稳定排序；**禁 `Math.random()`/`Date`**。
- **gate 只依赖 `BeliefProjection`**：claim gate 绝不直接读 `GameState` ground truth 判断「角色相信什么」；一律 `beliefs.getFact(speakerId, key)`。`applyEffects` 之类系统效果仍只用 ground truth（不经本 PR）。
- **写回时机**：`appendMention` **仅**在整行台词最终被接受（claim gate ∧ text gate 全过）后，按 **accepted** `proposedClaims.sourceContextIds` 写；任一 claim/文本失败 → 整行 reject → 一条 mention 都不写。
- **来源合法性**：`sourceContextIds.every(id => offeredContextIds.has(id))`，否则 `unknown_source_context` 拒绝（provider 不得伪造未召回来源）。
- **意图不可由模型自补**：`reactionPlan` 缺失时回退 `{ subjectIds:[], primary:"remain_reserved", undertone:undefined, intensity:0, openness:50, claimNeeds:[], rationaleCodes:["fallback_no_plan"] }`。
- **Mock 平凡通过**：`proposedClaims` 缺省归一化为 `[]`；MockProvider 无需特殊分支，语义路径由合成 provider result 单测覆盖。
- **append-only / no-backcompat**：不回写失效；可自由改 state shape（见 [[no-save-backcompat]]）。
- **称谓/礼制**：遵循 [[dialogue-etiquette-rule]] 与 [[official-naming-rule]]；住处/搬迁语义见 [[consort-residence-relocation]]。
- **基线**：分支 `feat/memory-dialogue-pr5`（off main `a364a9c`），起始 690 green / `tsc --noEmit` clean。每个 task 结束须全绿 + tsc clean。

## File Structure

- `src/engine/dialogue/claims.ts` — **新建**：`DialogueClaim`/`ClaimPredicate`/`ClaimModality`/`ProposedClaim` 类型 + `proposedClaimSchema`（缺省→`[]`）+ `claimToFactKey(claim)`。
- `src/engine/dialogue/audience.ts` — **新建**：`DialogueAudienceContext` + `buildAudienceContext(...)`。
- `src/engine/dialogue/claimAssembler.ts` — **新建**：`assembleClaims(...)`（候选 allowed + 自动事实冲突 forbidden）。
- `src/engine/dialogue/claimGate.ts` — **新建**：`ClaimGateContext`/`ClaimViolationCode`/`ClaimGateFinding` + `validateDialogueClaims(ctx)`。
- `src/engine/dialogue/mentionWriteback.ts` — **新建**：`recordMentionedContext(state, acceptedClaims, mentionContext, offeredContextIds)`。
- `src/engine/dialogue/types.ts` — **改**：`rawDialogueResponseSchema` 增加可选 `proposedClaims`（归一化 `[]`）；导出 `DialoguePolicyContext`。
- `src/engine/dialogue/orchestrator.ts` — **改**：`assembleDialogueRequest` 构造 audience + offeredContextIds；`produceDialogueLine` 接 claim gate（provider 后、text gate 同层）+ 整行接受后写回。
- 测试：与每个模块同名于 `tests/dialogue/`，加 `tests/dialogue/pr5Integration.test.ts`。

---

### Task 1: DialogueClaim / ProposedClaim 类型 + schema + claimToFactKey

**Files:**
- Create: `src/engine/dialogue/claims.ts`
- Test: `tests/dialogue/claims.test.ts`

**Interfaces:**
- Consumes: PR1 `chronicle/belief.ts` 的 `FactKey`/`FactPredicate`（`"resides_at"|"holds_rank"|"alive"`）。
- Produces:
  - `type ClaimPredicate = "resides_at" | "currently_same_residence" | "parent_of" | "responsible_for" | "holds_rank" | "alive" | "caused_event";`
  - `type ClaimModality = "assert" | "suspect" | "rumor" | "deny";`
  - `interface DialogueClaim { id: string; predicate: ClaimPredicate; subjectId: string; object?: string | boolean | number; modality: ClaimModality; certaintyCeiling?: number; }`
  - `interface ProposedClaim { claim: DialogueClaim; sourceContextIds: string[]; modality: ClaimModality; certainty: number; }`
  - `const proposedClaimSchema: z.ZodType<ProposedClaim>`（数组在 types.ts 用 `.default([])`）
  - `function claimToFactKey(claim: DialogueClaim): FactKey | undefined`（仅 `resides_at`/`holds_rank`/`alive` 映射；其余返回 `undefined`）

- [ ] **Step 1: 写失败测试**

```ts
// tests/dialogue/claims.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { proposedClaimSchema, claimToFactKey, type DialogueClaim } from "../../src/engine/dialogue/claims";

const claim = (over: Partial<DialogueClaim> = {}): DialogueClaim => ({
  id: "c1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace",
  modality: "assert", ...over,
});

describe("proposedClaimSchema", () => {
  it("accepts a well-formed proposed claim", () => {
    const parsed = proposedClaimSchema.safeParse({
      claim: claim(), sourceContextIds: ["mem_shen_zhibai_000001"], modality: "assert", certainty: 90,
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects certainty out of 0–100", () => {
    expect(proposedClaimSchema.safeParse({
      claim: claim(), sourceContextIds: [], modality: "assert", certainty: 150,
    }).success).toBe(false);
  });
  it("normalizes a missing proposedClaims array to []", () => {
    const wrapper = z.object({ proposedClaims: z.array(proposedClaimSchema).default([]) });
    expect(wrapper.parse({}).proposedClaims).toEqual([]);
  });
});

describe("claimToFactKey", () => {
  it("maps resides_at/holds_rank/alive to a FactKey", () => {
    expect(claimToFactKey(claim({ predicate: "resides_at" }))).toEqual({ predicate: "resides_at", subjectId: "shen_zhibai" });
    expect(claimToFactKey(claim({ predicate: "holds_rank" }))).toEqual({ predicate: "holds_rank", subjectId: "shen_zhibai" });
    expect(claimToFactKey(claim({ predicate: "alive" }))).toEqual({ predicate: "alive", subjectId: "shen_zhibai" });
  });
  it("returns undefined for predicates with no belief fact", () => {
    expect(claimToFactKey(claim({ predicate: "currently_same_residence" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "caused_event" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "parent_of" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "responsible_for" }))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dialogue/claims.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 claims.ts**

```ts
// src/engine/dialogue/claims.ts
/**
 * 结构化对话断言（spec §结构化 claim）。约束不靠自然语言：claim gate 校验的是
 * provider 声明的 ProposedClaim，而非从文本反解。claimToFactKey 把可投影的谓词
 * 桥接到 PR1 BeliefProjection 的 FactKey；无对应事实的谓词返回 undefined（gate 据此
 * 走 reveals_unknown_fact / 礼制 / 身份分支，而非误判 belief）。
 */
import { z } from "zod";
import type { FactKey } from "../chronicle/belief";

export type ClaimPredicate =
  | "resides_at" | "currently_same_residence" | "parent_of"
  | "responsible_for" | "holds_rank" | "alive" | "caused_event";
export type ClaimModality = "assert" | "suspect" | "rumor" | "deny";

export interface DialogueClaim {
  id: string;
  predicate: ClaimPredicate;
  subjectId: string;
  object?: string | boolean | number;
  modality: ClaimModality;
  certaintyCeiling?: number;
}

export interface ProposedClaim {
  claim: DialogueClaim;
  /** 本条 claim 依据本次请求中的哪些记忆/编年史/事实 id（写回与来源合法性的唯一依据）。 */
  sourceContextIds: string[];
  modality: ClaimModality;
  certainty: number; // 0–100
}

const claimModalitySchema = z.enum(["assert", "suspect", "rumor", "deny"]);

export const dialogueClaimSchema: z.ZodType<DialogueClaim> = z.strictObject({
  id: z.string().min(1),
  predicate: z.enum([
    "resides_at", "currently_same_residence", "parent_of",
    "responsible_for", "holds_rank", "alive", "caused_event",
  ]),
  subjectId: z.string().min(1),
  object: z.union([z.string(), z.boolean(), z.number()]).optional(),
  modality: claimModalitySchema,
  certaintyCeiling: z.number().min(0).max(100).optional(),
});

export const proposedClaimSchema: z.ZodType<ProposedClaim> = z.strictObject({
  claim: dialogueClaimSchema,
  sourceContextIds: z.array(z.string().min(1)),
  modality: claimModalitySchema,
  certainty: z.number().min(0).max(100),
});

/** 仅可投影谓词桥接到 BeliefProjection；派生/关系/因果类谓词无单一 fact → undefined。 */
export function claimToFactKey(claim: DialogueClaim): FactKey | undefined {
  switch (claim.predicate) {
    case "resides_at":
    case "holds_rank":
    case "alive":
      return { predicate: claim.predicate, subjectId: claim.subjectId };
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/dialogue/claims.test.ts`
Expected: PASS

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/engine/dialogue/claims.ts tests/dialogue/claims.test.ts
git commit -m "feat: DialogueClaim/ProposedClaim 类型 + schema + claimToFactKey（PR5-1）"
```

---

### Task 2: buildAudienceContext

**Files:**
- Create: `src/engine/dialogue/audience.ts`
- Test: `tests/dialogue/audience.test.ts`

**Interfaces:**
- Consumes: PR3 `reactionTypes.ts` 的 `AudienceRole`；`GameState`；`ContentDB`。
- Produces:
  - `interface DialogueAudienceContext { targetId: string; targetRole: AudienceRole; presentCharacterIds: string[]; privacy: "public" | "semi_private" | "private"; }`
  - `function buildAudienceContext(state, db, args: { speakerId: string; targetId: string; presentCharacterIds?: string[]; privacy?: DialogueAudienceContext["privacy"] }): DialogueAudienceContext`

**说明**：MVP 不在 orchestrator 重算复杂在场推断。`targetRole`：`targetId === "player"` → `"sovereign"`；否则 target 有 standing → `"consort"`；皇嗣 id → `"heir"`；都不是 → `"servant"`。`presentCharacterIds` 默认 `[targetId]`（去重、去 speaker 自己、稳定排序）。`privacy` 默认 `"semi_private"`，调用方可覆盖。**纯函数确定性**。

- [ ] **Step 1: 写失败测试**

```ts
// tests/dialogue/audience.test.ts
import { describe, it, expect } from "vitest";
import { buildAudienceContext } from "../../src/engine/dialogue/audience";
import { createNewGameState } from "../../src/engine/save/newGame";
import { loadContent } from "../../src/engine/content/loader";

const db = loadContent();
const state = createNewGameState(db);

describe("buildAudienceContext", () => {
  it("targets the player as sovereign, semi_private by default", () => {
    const a = buildAudienceContext(state, db, { speakerId: "shen_zhibai", targetId: "player" });
    expect(a.targetRole).toBe("sovereign");
    expect(a.privacy).toBe("semi_private");
    expect(a.presentCharacterIds).toContain("player");
  });
  it("classifies a fellow consort target as consort", () => {
    const a = buildAudienceContext(state, db, { speakerId: "shen_zhibai", targetId: "gu_yunzhi" });
    expect(a.targetRole).toBe("consort");
  });
  it("dedupes/excludes speaker and sorts presentCharacterIds; honors explicit privacy", () => {
    const a = buildAudienceContext(state, db, {
      speakerId: "shen_zhibai", targetId: "player",
      presentCharacterIds: ["gu_yunzhi", "player", "shen_zhibai", "gu_yunzhi"], privacy: "public",
    });
    expect(a.privacy).toBe("public");
    expect(a.presentCharacterIds).toEqual([...a.presentCharacterIds].sort());
    expect(a.presentCharacterIds).not.toContain("shen_zhibai");
    expect(a.presentCharacterIds.filter((x) => x === "gu_yunzhi")).toHaveLength(1);
  });
  it("is deterministic", () => {
    const args = { speakerId: "shen_zhibai", targetId: "player" } as const;
    expect(buildAudienceContext(state, db, args)).toEqual(buildAudienceContext(state, db, args));
  });
});
```
> 实现前用 `loadContent()`/`createNewGameState` 确认 `gu_yunzhi` 等 id 真实存在；若不同则替换为真实 consort id（实现者负责核对，不要硬编不存在的 id）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dialogue/audience.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 audience.ts**

```ts
// src/engine/dialogue/audience.ts
/**
 * 对话场景 audience（spec §6）= 听众身份 + 在场人 + 私密度。gate 不只判「对陛下不能
 * 幸灾乐祸」，还判在场与私密度。MVP 在场人由调用方/scene 提供，不在此重算复杂推断。
 */
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import type { AudienceRole } from "./reactionTypes";

export interface DialogueAudienceContext {
  targetId: string;
  targetRole: AudienceRole;
  presentCharacterIds: string[];
  privacy: "public" | "semi_private" | "private";
}

function classifyRole(state: GameState, targetId: string): AudienceRole {
  if (targetId === "player") return "sovereign";
  if (state.standing[targetId]) return "consort";
  if (state.resources.bloodline.heirs.some((h) => h.id === targetId)) return "heir";
  return "servant";
}

export function buildAudienceContext(
  state: GameState,
  _db: ContentDB,
  args: {
    speakerId: string;
    targetId: string;
    presentCharacterIds?: string[];
    privacy?: DialogueAudienceContext["privacy"];
  },
): DialogueAudienceContext {
  const present = new Set(args.presentCharacterIds ?? [args.targetId]);
  present.add(args.targetId);
  present.delete(args.speakerId);
  return {
    targetId: args.targetId,
    targetRole: classifyRole(state, args.targetId),
    presentCharacterIds: [...present].sort(),
    privacy: args.privacy ?? "semi_private",
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/dialogue/audience.test.ts`
Expected: PASS

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/engine/dialogue/audience.ts tests/dialogue/audience.test.ts
git commit -m "feat: buildAudienceContext（targetRole/在场/私密度，PR5-2）"
```

---

### Task 3: assembleClaims（候选 allowed + 自动事实冲突 forbidden）

**Files:**
- Create: `src/engine/dialogue/claimAssembler.ts`
- Test: `tests/dialogue/claimAssembler.test.ts`

**Interfaces:**
- Consumes: Task1 `DialogueClaim`；Task2 `DialogueAudienceContext`；PR3 `ReactionPlan`/`ClaimNeed`；PR4 `DialogueMemoryContext`（`{ activatedMemories, knownEvents }`）；PR1 `BeliefProjection`；`GameState`。
- Produces:
  - `interface AssembledClaims { allowed: DialogueClaim[]; forbidden: DialogueClaim[]; }`
  - `function assembleClaims(args: { reactionPlan: ReactionPlan; memoryContext: DialogueMemoryContext; beliefs: BeliefProjection; state: GameState; audience: DialogueAudienceContext; }): AssembledClaims`

**核心**：
1. **自动事实冲突 forbidden**（spec 签名能力）：扫描 `memoryContext.activatedMemories`，对每条带 `residence`/同住语义旧结论的记忆（`triggerTags.includes("residence")` 且其历史 `subjectIds` 含某 subject），读 **当前** `state.standing[subject].residence` 与 speaker 当前 residence；若历史「同住」结论与当前不再同住相反，追加 forbidden claim `{ predicate:"currently_same_residence", subjectId, object:false, modality:"assert" }`。纯函数派生，不手写。
2. **候选 allowed**：对每个 `claimNeed`，`about:"subject_event"` 且对应 subject 有可投影 `resides_at`/`holds_rank`/`alive` belief（`beliefs.getFact` 非 undefined）→ 生成对应 `assert` claim（certaintyCeiling = 该 fact 的 certainty）。`self_feeling`/`relationship` 在 MVP 不产结构化 fact claim（留空，未来扩展）。
3. 稳定排序（forbidden 与 allowed 各按 `predicate` 再 `subjectId` 升序）；确定性。

- [ ] **Step 1: 写失败测试**

```ts
// tests/dialogue/claimAssembler.test.ts
import { describe, it, expect } from "vitest";
import { assembleClaims } from "../../src/engine/dialogue/claimAssembler";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createNewGameState } from "../../src/engine/save/newGame";
import { loadContent } from "../../src/engine/content/loader";
import type { ReactionPlan } from "../../src/engine/dialogue/reactionTypes";
import type { DialogueMemoryContext } from "../../src/engine/dialogue/memoryContext";
import type { MemoryEntry } from "../../src/engine/state/types";

const db = loadContent();
const plan = (over: Partial<ReactionPlan> = {}): ReactionPlan => ({
  subjectIds: [], primary: "remain_reserved", intensity: 0, openness: 50,
  claimNeeds: [], rationaleCodes: [], ...over,
});
const emptyCtx: DialogueMemoryContext = { activatedMemories: [], knownEvents: [] };

describe("assembleClaims", () => {
  it("derives a forbidden currently_same_residence claim when an old co-residence memory is now false", () => {
    const state = createNewGameState(db);
    // 找两个有 standing 的角色，制造「曾同住、现不同住」的记忆
    const ids = Object.keys(state.standing);
    const [speaker, other] = ids;
    state.standing[speaker]!.residence = "xianfu_palace";
    state.standing[other]!.residence = "changchun_palace"; // 现已不同住
    const mem: MemoryEntry = {
      id: "m_res", ownerId: speaker, kind: "episodic", subjectIds: [speaker, other],
      perspective: "witness", summary: "曾同住咸福宫", strength: 60, retention: "slow",
      emotions: {}, triggerTags: ["residence"], unresolved: false,
      createdAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const ctx: DialogueMemoryContext = { activatedMemories: [mem], knownEvents: [] };
    const beliefs = new GroundTruthBeliefProjection(state);
    const out = assembleClaims({ reactionPlan: plan(), memoryContext: ctx, beliefs, state, audience: { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" } });
    expect(out.forbidden.some((c) => c.predicate === "currently_same_residence" && c.subjectId === other && c.object === false)).toBe(true);
  });

  it("derives an allowed holds_rank claim from a subject_event claimNeed when the fact is visible", () => {
    const state = createNewGameState(db);
    const subject = Object.keys(state.standing)[0]!;
    const beliefs = new GroundTruthBeliefProjection(state);
    const out = assembleClaims({
      reactionPlan: plan({ claimNeeds: [{ about: "subject_event", subjectId: subject }] }),
      memoryContext: emptyCtx, beliefs, state,
      audience: { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" },
    });
    expect(out.allowed.some((c) => c.subjectId === subject)).toBe(true);
  });

  it("is deterministic", () => {
    const state = createNewGameState(db);
    const beliefs = new GroundTruthBeliefProjection(state);
    const args = { reactionPlan: plan(), memoryContext: emptyCtx, beliefs, state, audience: { targetId: "player", targetRole: "sovereign" as const, presentCharacterIds: ["player"], privacy: "semi_private" as const } };
    expect(assembleClaims(args)).toEqual(assembleClaims(args));
  });
});
```
> `createNewGameState` 的 `state.standing` 应至少含两个常住侍君；实现者先 `console`-核对再定 fixture（不可硬编不存在 id）。`isCurrentlyPresent` 要求 subject 在场——测试里两角色均有 standing 且 `palaceEnteredAt ≤ now`，否则 `getFact` 返回 undefined，allowed 测试要据此调正 fixture。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dialogue/claimAssembler.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 claimAssembler.ts**

```ts
// src/engine/dialogue/claimAssembler.ts
/**
 * Claim 装配（spec §结构化 claim / 数据流 PR5）：由 reactionPlan.claimNeeds + 召回上下文
 * + believedState 派生候选 allowed claims，并【自动】派生「旧结论 vs 当前 TemporalFact 相反」
 * 的 forbidden claims（如旧同住记忆 vs 现住处不同）。自然语言提示只是这些 claim 的渲染，
 * 非事实来源。纯函数确定性。
 */
import type { BeliefProjection } from "../chronicle/belief";
import type { GameState } from "../state/types";
import type { DialogueAudienceContext } from "./audience";
import { claimToFactKey, type DialogueClaim } from "./claims";
import type { DialogueMemoryContext } from "./memoryContext";
import type { ReactionPlan } from "./reactionTypes";

export interface AssembledClaims {
  allowed: DialogueClaim[];
  forbidden: DialogueClaim[];
}

const byPredicateThenSubject = (a: DialogueClaim, b: DialogueClaim): number =>
  a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1
  : a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;

export function assembleClaims(args: {
  reactionPlan: ReactionPlan;
  memoryContext: DialogueMemoryContext;
  beliefs: BeliefProjection;
  state: GameState;
  audience: DialogueAudienceContext;
}): AssembledClaims {
  const { reactionPlan, memoryContext, beliefs, state } = args;
  const allowed: DialogueClaim[] = [];
  const forbidden: DialogueClaim[] = [];

  // 1) 自动事实冲突 forbidden：旧「同住」结论现已不成立
  for (const mem of memoryContext.activatedMemories) {
    if (!mem.triggerTags.includes("residence")) continue;
    const speakerResidence = state.standing[mem.ownerId]?.residence;
    for (const subj of mem.subjectIds) {
      if (subj === mem.ownerId) continue;
      const subjResidence = state.standing[subj]?.residence;
      const noLongerCoResident =
        speakerResidence !== undefined && subjResidence !== undefined && speakerResidence !== subjResidence;
      if (noLongerCoResident) {
        forbidden.push({
          id: `forbid_same_res_${subj}`,
          predicate: "currently_same_residence",
          subjectId: subj,
          object: false,
          modality: "assert",
        });
      }
    }
  }

  // 2) 候选 allowed：可投影 subject_event → 对应 fact claim
  for (const need of reactionPlan.claimNeeds) {
    if (need.about !== "subject_event" || !need.subjectId) continue;
    for (const predicate of ["holds_rank", "resides_at", "alive"] as const) {
      const fact = beliefs.getFact(reactionPlan.subjectIds[0] ?? need.subjectId, { predicate, subjectId: need.subjectId });
      if (!fact) continue;
      allowed.push({
        id: `allow_${predicate}_${need.subjectId}`,
        predicate,
        subjectId: need.subjectId,
        object: fact.value,
        modality: "assert",
        certaintyCeiling: fact.certainty,
      });
    }
  }

  // dedupe by id, stable order
  const dedupe = (cs: DialogueClaim[]): DialogueClaim[] => {
    const seen = new Set<string>();
    return cs.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort(byPredicateThenSubject);
  };
  return { allowed: dedupe(allowed), forbidden: dedupe(forbidden) };
}
```
> `claimToFactKey` 在本 task 不直接调用（保留给 gate）；若实现者发现 allowed 派生更适合复用它，可重构——但 `currently_same_residence` 的 forbidden 派生必须显式读当前 `standing.residence`（这是「当前 TemporalFact」来源），不可经 belief（belief 无该谓词）。viewer 用 speaker 自己（`reactionPlan.subjectIds[0] ?? need.subjectId` 仅占位；实现者应以真正的 speakerId 为 viewer——把 speakerId 作为参数显式传入更干净，可调整签名增加 `speakerId`）。

- [ ] **Step 4: 跑测试确认通过 + 全套**

Run: `npx vitest run tests/dialogue/claimAssembler.test.ts && npx vitest run`
Expected: PASS（含既有全绿）

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/engine/dialogue/claimAssembler.ts tests/dialogue/claimAssembler.test.ts
git commit -m "feat: assembleClaims（候选 allowed + 自动事实冲突 forbidden，PR5-3）"
```

---

### Task 4: validateDialogueClaims（belief/audience/etiquette claim gate）

**Files:**
- Create: `src/engine/dialogue/claimGate.ts`
- Test: `tests/dialogue/claimGate.test.ts`

**Interfaces:**
- Consumes: Task1 `ProposedClaim`/`claimToFactKey`；Task2 `DialogueAudienceContext`；PR1 `BeliefProjection`。
- Produces:
  - `type ClaimViolationCode = "contradicts_speaker_belief" | "reveals_unknown_fact" | "claims_excessive_certainty" | "violates_etiquette" | "identity_mismatch" | "unknown_source_context";`
  - `interface ClaimGateFinding { code: ClaimViolationCode; claimId: string; message: string; }`
  - `interface ClaimGateContext { speakerId: string; audience: DialogueAudienceContext; beliefs: BeliefProjection; offeredContextIds: ReadonlySet<string>; proposedClaims: readonly ProposedClaim[]; }`
  - `interface ClaimGateResult { ok: boolean; acceptedClaims: ProposedClaim[]; findings: ClaimGateFinding[]; }`
  - `function validateDialogueClaims(ctx: ClaimGateContext): ClaimGateResult`

**判定（每条 proposed，全部纯函数、只读 `beliefs`）**：
- `unknown_source_context`：`sourceContextIds.some(id => !offeredContextIds.has(id))`。
- `contradicts_speaker_belief`：`claimToFactKey` 有 key 且 `beliefs.getFact(speakerId,key)` 存在但 `value !== claim.object`（且 modality 非 `deny`）。
- `reveals_unknown_fact`：`claimToFactKey` 有 key 但 `beliefs.getFact` 返回 `undefined`，而 modality 为 `assert`（断言自己无权知道的事实）。
- `claims_excessive_certainty`：`beliefs.getFact` 存在且其 `certainty` 低（< 50）却用 `assert` 且 `certainty >= 80`；或 belief 不存在但 `modality:"assert"` 且 `certainty >= 80`（与 reveals 叠加时取更具体者，见下）。
- `violates_etiquette`：`audience.targetRole === "sovereign"` 且 claim 表达对在场被降位者的贬抑类（MVP：`predicate:"holds_rank"` 且 `object` 为低位 + `modality:"assert"` 在 `privacy !== "private"`）——保守规则，table 化；或 `caused_event` 当众议皇嗣死因。MVP 仅需一条可断言规则即可（见测试）。
- `identity_mismatch`：claim 把 speaker 当帝（`subjectId === "player"` 且 `predicate` 宣称帝室行为如 `caused_event`/`holds_rank` 由侍君 assert），或 `parent_of` 把 player 写成生父等。MVP 一条规则即可（见测试）。

**任一 finding → `ok:false`，`acceptedClaims:[]`（全行否决策略）**；无 finding → `ok:true`，`acceptedClaims = [...proposedClaims]`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/dialogue/claimGate.test.ts
import { describe, it, expect } from "vitest";
import { validateDialogueClaims, type ClaimGateContext } from "../../src/engine/dialogue/claimGate";
import type { BeliefProjection, FactKey, BelievedFact } from "../../src/engine/chronicle/belief";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";
import type { DialogueAudienceContext } from "../../src/engine/dialogue/audience";

const audience: DialogueAudienceContext = { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" };
const beliefsFrom = (facts: Record<string, BelievedFact>): BeliefProjection => ({
  getFact: (_charId: string, key: FactKey) => facts[`${key.predicate}:${key.subjectId}`],
});
const pc = (over: Partial<ProposedClaim> & { id?: string } = {}): ProposedClaim => ({
  claim: { id: over.id ?? "c1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace", modality: "assert" },
  sourceContextIds: ["mem_1"], modality: "assert", certainty: 90, ...over,
});
const base = (over: Partial<ClaimGateContext> = {}): ClaimGateContext => ({
  speakerId: "gu_yunzhi", audience, beliefs: beliefsFrom({}), offeredContextIds: new Set(["mem_1"]), proposedClaims: [], ...over,
});

describe("validateDialogueClaims", () => {
  it("passes a claim that matches speaker belief from offered context", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc()],
    }));
    expect(r.ok).toBe(true);
    expect(r.acceptedClaims).toHaveLength(1);
  });
  it("flags unknown_source_context when a source id was not offered", () => {
    const r = validateDialogueClaims(base({ proposedClaims: [pc({ sourceContextIds: ["mem_X"] })] }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("unknown_source_context");
  });
  it("flags contradicts_speaker_belief when belief value differs", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "changchun_palace", certainty: 100 } }),
      proposedClaims: [pc()],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("contradicts_speaker_belief");
  });
  it("flags reveals_unknown_fact when belief is undefined but claim asserts", () => {
    const r = validateDialogueClaims(base({ proposedClaims: [pc({ certainty: 60 })] })); // belief empty
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("reveals_unknown_fact");
  });
  it("flags claims_excessive_certainty when low-certainty belief is asserted strongly", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 30 } }),
      proposedClaims: [pc({ certainty: 95 })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claims_excessive_certainty");
  });
  it("flags identity_mismatch when a consort asserts an imperial act as the player", () => {
    const r = validateDialogueClaims(base({
      proposedClaims: [pc({ claim: { id: "c1", predicate: "caused_event", subjectId: "player", object: "decree", modality: "assert" }, sourceContextIds: ["mem_1"] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("identity_mismatch");
  });
  it("rejects the whole line (acceptedClaims empty) when any claim fails", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc({ id: "ok" }), pc({ id: "bad", sourceContextIds: ["mem_X"] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.acceptedClaims).toHaveLength(0);
  });
  it("passes trivially on empty proposedClaims (mock)", () => {
    expect(validateDialogueClaims(base()).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dialogue/claimGate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 claimGate.ts**

```ts
// src/engine/dialogue/claimGate.ts
/**
 * Claim 语义 gate（spec §信念投影 / gate 违规类型）：校验 provider 声明的 proposedClaims
 * 是否符合 speaker 的【可投影认知】、来源合法性、身份与礼制。只依赖 BeliefProjection，
 * 绝不直读 ground truth——接入 rumor/错误信念后只换 projection 实现，gate 不变。
 * 策略：任一 claim 违规 → 整行否决（acceptedClaims 为空）。
 */
import type { BeliefProjection } from "../chronicle/belief";
import { claimToFactKey, type ProposedClaim } from "./claims";
import type { DialogueAudienceContext } from "./audience";

export type ClaimViolationCode =
  | "contradicts_speaker_belief" | "reveals_unknown_fact" | "claims_excessive_certainty"
  | "violates_etiquette" | "identity_mismatch" | "unknown_source_context";

export interface ClaimGateFinding { code: ClaimViolationCode; claimId: string; message: string; }

export interface ClaimGateContext {
  speakerId: string;
  audience: DialogueAudienceContext;
  beliefs: BeliefProjection;
  offeredContextIds: ReadonlySet<string>;
  proposedClaims: readonly ProposedClaim[];
}

export interface ClaimGateResult { ok: boolean; acceptedClaims: ProposedClaim[]; findings: ClaimGateFinding[]; }

const STRONG_ASSERT = 80;
const LOW_CERTAINTY = 50;

function findingsFor(pc: ProposedClaim, ctx: ClaimGateContext): ClaimGateFinding[] {
  const out: ClaimGateFinding[] = [];
  const { claim } = pc;
  const id = claim.id;

  // 来源合法性
  if (pc.sourceContextIds.some((sid) => !ctx.offeredContextIds.has(sid))) {
    out.push({ code: "unknown_source_context", claimId: id, message: "claim 引用了本次未提供的来源" });
  }
  // 身份：侍君不得以帝身份断言帝室行为
  if (claim.subjectId === "player" && ctx.speakerId !== "player" &&
      (claim.predicate === "caused_event" || claim.predicate === "holds_rank") && claim.modality === "assert") {
    out.push({ code: "identity_mismatch", claimId: id, message: "侍君不得以帝身份断言帝室行为" });
  }
  // belief 投影
  const key = claimToFactKey(claim);
  if (key) {
    const believed = ctx.beliefs.getFact(ctx.speakerId, key);
    if (!believed) {
      if (claim.modality === "assert") {
        out.push({ code: "reveals_unknown_fact", claimId: id, message: "断言了自己无权知道的事实" });
      }
    } else if (claim.object !== undefined && believed.value !== claim.object && claim.modality !== "deny") {
      out.push({ code: "contradicts_speaker_belief", claimId: id, message: "claim 与角色相信的事实相反" });
    } else if (believed.certainty < LOW_CERTAINTY && claim.modality === "assert" && pc.certainty >= STRONG_ASSERT) {
      out.push({ code: "claims_excessive_certainty", claimId: id, message: "低置信信息被过强断言" });
    }
  }
  // 礼制：当众（非私下）对在场侍君断言降位等贬抑，对帝失礼
  if (ctx.audience.targetRole === "sovereign" && ctx.audience.privacy !== "private" &&
      claim.predicate === "holds_rank" && claim.modality === "assert" &&
      ctx.audience.presentCharacterIds.includes(claim.subjectId) && claim.subjectId !== ctx.speakerId) {
    out.push({ code: "violates_etiquette", claimId: id, message: "当众议论在场者位分，于帝前失礼" });
  }
  return out;
}

export function validateDialogueClaims(ctx: ClaimGateContext): ClaimGateResult {
  const findings = ctx.proposedClaims.flatMap((pc) => findingsFor(pc, ctx));
  if (findings.length > 0) return { ok: false, acceptedClaims: [], findings };
  return { ok: true, acceptedClaims: [...ctx.proposedClaims], findings: [] };
}
```
> 礼制/身份是保守 MVP 规则，仅需让测试断言的那条路径成立；实现者勿过度泛化（YAGNI）。`violates_etiquette` 测试若与 `reveals_unknown_fact` 叠加，确保该用例 belief 命中以避免 code 混淆——实现者据测试调 fixture/规则顺序。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/dialogue/claimGate.test.ts`
Expected: PASS

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit`
```bash
git add src/engine/dialogue/claimGate.ts tests/dialogue/claimGate.test.ts
git commit -m "feat: validateDialogueClaims（belief/来源/身份/礼制 claim gate，PR5-4）"
```

---

### Task 5: provider result 扩展 + recordMentionedContext + orchestrator policy seam + 集成

**Files:**
- Modify: `src/engine/dialogue/types.ts`（`rawDialogueResponseSchema` 加可选 `proposedClaims` → `.default([])`；导出 `DialoguePolicyContext`）
- Create: `src/engine/dialogue/mentionWriteback.ts`
- Modify: `src/engine/dialogue/orchestrator.ts`（`assembleDialogueRequest` 构造 audience + offeredContextIds；`produceDialogueLine` 接 claim gate + 整行接受后写回）
- Test: `tests/dialogue/mentionWriteback.test.ts`, `tests/dialogue/pr5Integration.test.ts`
- Modify (如有断言变化): `tests/dialogue/provider.test.ts`

**Interfaces:**
- Consumes: Task1–4 全部；PR4 `appendMention`/`MemoryMentionRecord`（`mention.ts`）；现有 `produceDialogueLine`/`assembleDialogueRequest`。
- Produces:
  - `interface DialoguePolicyContext { audience: DialogueAudienceContext; reactionPlan?: ReactionPlan; beliefProjection: BeliefProjection; offeredContextIds: ReadonlySet<string>; }`
  - `function recordMentionedContext(state, acceptedClaims: readonly ProposedClaim[], mention: { speakerId: string; audienceId: string; now: GameTime }, offeredContextIds: ReadonlySet<string>): GameState`
  - `produceDialogueLine(...)` 新增可选末参 `policy?: DialoguePolicyContext`；缺省回退 `remain_reserved` 计划、空 proposedClaims（行为与今日一致）。

**写回流程（严格顺序）**：claim gate（policy 存在且 `proposedClaims` 非空时）→ 失败即 reject、**不写 mention** → text gates → 失败即 reject、**不写 mention** → 接受台词 → `recordMentionedContext` 写 accepted claims 的 `sourceContextIds`（去重、仅 offered）。`produceDialogueLine` 当前签名返回 `DialogueLine`；写回需要返回新 `state`——因此 `produceDialogueLine` 返回值扩展为 `{ line: DialogueLine; state: GameState }`，或新增 `policy.onAccept(state) => state`。**采用**：当 `policy` 提供时，返回 `Result<{ line: DialogueLine; nextState: GameState }, GameError>`；不提供时维持旧 `Result<DialogueLine>`。为避免重载复杂度，**新增独立入口** `produceDialogueLineWithPolicy(db, provider, request, policy, logger?)`，旧 `produceDialogueLine` 内部委托（policy=undefined 路径）。

- [ ] **Step 1: 写失败测试（recordMentionedContext 单测）**

```ts
// tests/dialogue/mentionWriteback.test.ts
import { describe, it, expect } from "vitest";
import { recordMentionedContext } from "../../src/engine/dialogue/mentionWriteback";
import { createNewGameState } from "../../src/engine/save/newGame";
import { loadContent } from "../../src/engine/content/loader";
import { recentMentionPenalty } from "../../src/engine/dialogue/mention";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadContent();
const now = { year: 1, month: 1, period: "early", dayIndex: 0 } as const;
const accepted = (sourceContextIds: string[]): ProposedClaim => ({
  claim: { id: "c", predicate: "resides_at", subjectId: "x", object: "y", modality: "assert" },
  sourceContextIds, modality: "assert", certainty: 90,
});

describe("recordMentionedContext", () => {
  it("writes a mention for each offered sourceContextId and raises that memory's penalty", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1"]);
    const s1 = recordMentionedContext(s0, [accepted(["mem_1"])], { speakerId: "shen_zhibai", audienceId: "player", now }, offered);
    expect(s1.mentionLog.length).toBeGreaterThan(s0.mentionLog.length);
    const p = recentMentionPenalty(s1, { speakerId: "shen_zhibai", audienceId: "player", memoryId: "mem_1", now });
    expect(p).toBeGreaterThan(0);
  });
  it("never writes a source id that was not offered (defense in depth)", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(s0, [accepted(["mem_X"])], { speakerId: "shen_zhibai", audienceId: "player", now }, new Set(["mem_1"]));
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });
  it("dedupes repeated source ids across accepted claims", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1"]);
    const s1 = recordMentionedContext(s0, [accepted(["mem_1"]), accepted(["mem_1"])], { speakerId: "shen_zhibai", audienceId: "player", now }, offered);
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dialogue/mentionWriteback.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 mentionWriteback.ts**

```ts
// src/engine/dialogue/mentionWriteback.ts
/**
 * 记忆冷却写回（spec §数据流末步）：仅在整行台词最终被接受后，按 gate-accepted 的
 * proposedClaims.sourceContextIds 写 MemoryMentionRecord。「被召回 ≠ 被选中 ≠ 打算表达
 * ≠ 实际说出口」——只有 provider 声明使用、且通过 gate 的来源才记冷却。来源必须本次实际
 * 提供给 provider（offeredContextIds），防止伪造。
 */
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";
import { appendMention } from "./mention";
import type { ProposedClaim } from "./claims";

export function recordMentionedContext(
  state: GameState,
  acceptedClaims: readonly ProposedClaim[],
  mention: { speakerId: string; audienceId: string; now: GameTime },
  offeredContextIds: ReadonlySet<string>,
): GameState {
  const ids = new Set<string>();
  for (const pc of acceptedClaims) {
    for (const sid of pc.sourceContextIds) {
      if (offeredContextIds.has(sid)) ids.add(sid);
    }
  }
  let next = state;
  for (const memoryId of [...ids].sort()) {
    next = appendMention(next, {
      speakerId: mention.speakerId, audienceId: mention.audienceId,
      memoryId, mentionedAt: mention.now,
    });
  }
  return next;
}
```
> 核对 `appendMention` 入参形状（PR4 `mention.ts`）——若字段名为 `mentionedAt`/`memoryId`/`speakerId`/`audienceId` 之外，按实际签名调整。

- [ ] **Step 4: 跑单测确认通过**

Run: `npx vitest run tests/dialogue/mentionWriteback.test.ts`
Expected: PASS

- [ ] **Step 5: 扩展 types.ts（proposedClaims + DialoguePolicyContext）**

在 `rawDialogueResponseSchema`（`src/engine/dialogue/types.ts`）的 `z.strictObject({...})` 内追加：
```ts
  proposedClaims: z.array(proposedClaimSchema).default([]),
```
并在文件顶部 `import { proposedClaimSchema } from "./claims";`。文件末新增：
```ts
import type { GameTime } from "../calendar/time";
import type { BeliefProjection } from "../chronicle/belief";
import type { DialogueAudienceContext } from "./audience";
import type { ReactionPlan } from "./reactionTypes";

/** PR5 policy seam：装配 audience/可选 reactionPlan/believedState/本次提供的来源 id 集。 */
export interface DialoguePolicyContext {
  audience: DialogueAudienceContext;
  reactionPlan?: ReactionPlan;
  beliefProjection: BeliefProjection;
  offeredContextIds: ReadonlySet<string>;
  now: GameTime;
}
```
> `rawDialogueResponseSchema` 现为 `strictObject`，新增字段已含 `.default([])`，旧 provider（不发该字段）仍通过。`RawDialogueResponse` 类型随之带 `proposedClaims: ProposedClaim[]`。

- [ ] **Step 6: 接 orchestrator（assemble 构造 offeredContextIds + audience；produceWithPolicy 接 gate + 写回）**

在 `assembleDialogueRequest` 内（构造 `relevantMemories` 后）计算并通过 policy 暴露 `offeredContextIds`（= 本次 `activatedMemories.map(m => m.id)` ∪ `knownEvents.map(e => e.id)`）。新增导出：
```ts
// orchestrator.ts —— 新入口，旧 produceDialogueLine 保持不变（内部 policy=undefined）
import { validateDialogueClaims, type ClaimGateContext } from "./claimGate";
import { recordMentionedContext } from "./mentionWriteback";
import type { DialoguePolicyContext } from "./types";

export async function produceDialogueLineWithPolicy(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  state: GameState,
  logger?: RingBufferLogger,
): Promise<Result<{ line: DialogueLine; nextState: GameState }, GameError>> {
  const raw = await provider.generate(request);
  if (!raw.ok) return raw;
  const parsed = rawDialogueResponseSchema.safeParse(raw.value);
  if (!parsed.success) return err(aiError("MALFORMED", `provider "${provider.id}" returned an invalid response`, { context: { issues: parsed.error.issues.slice(0, 3).map((i) => i.message) } }));
  const response = parsed.data;
  if (response.speaker !== request.speakerId) return err(aiError("WRONG_SPEAKER", `asked for "${request.speakerId}", got "${response.speaker}"`));

  // ── claim gate（provider 后；失败即 reject，不写 mention）
  const claimResult = validateDialogueClaims({
    speakerId: request.speakerId, audience: policy.audience, beliefs: policy.beliefProjection,
    offeredContextIds: policy.offeredContextIds, proposedClaims: response.proposedClaims,
  } satisfies ClaimGateContext);
  for (const f of claimResult.findings) {
    logger?.logGameError(aiError(`CLAIM_${f.code.toUpperCase()}`, f.message, { severity: "error", context: { provider: provider.id, speaker: request.speakerId, claim: f.claimId } }));
  }
  if (!claimResult.ok) return err(aiError("CLAIM_REJECTED", `provider "${provider.id}" output failed ${claimResult.findings.length} claim gate(s)`, { context: { findings: claimResult.findings.map((f) => f.code) } }));

  // ── text gates（复用现有逻辑：抽出 buildLineFromResponse 或就地复制 produceDialogueLine 的 text-gate 段）
  // 失败即 reject、不写 mention；通过则 accept 台词
  // ...（与 produceDialogueLine 相同的 text gate + expression 归一化，得到 line + degraded）

  // ── 整行接受后写回（仅 accepted claims 的 offered 来源）
  const nextState = recordMentionedContext(state, claimResult.acceptedClaims, { speakerId: request.speakerId, audienceId: request.targetId, now: policy.now }, policy.offeredContextIds);
  return ok({ line, nextState });
}
```
> 为 DRY，将 `produceDialogueLine` 里「text gate + expression 归一化 + 组 DialogueLine」抽成内部纯函数 `finalizeLine(db, provider, request, response, logger): Result<{ line: DialogueLine }, GameError>`，新旧两入口共用。旧 `produceDialogueLine` 行为与签名保持不变（不写 state）。

- [ ] **Step 7: 集成测试（三条真实链路 + 失败链路）**

```ts
// tests/dialogue/pr5Integration.test.ts —— 用合成 provider 注入 proposedClaims
// 1) happy：提供的来源 + 命中 belief 的 claim → gate 过 → text 过 → 对应 memoryId 写入 mentionLog
// 2) reject：claim 与 speaker 可知事实冲突 → CLAIM_REJECTED → 不写 mention（mentionLog 不变）
// 3) no-declaration：context 已 offered 但 provider 返回 proposedClaims:[] → 不写 mention
// 4) unknown_source：proposedClaims 引用未 offered 的 id → CLAIM_REJECTED → 不写 mention
```
实现者按 Task4/Task5 的真实签名构造合成 `DialogueProvider`（`kind:"generative"`，`generate` 返回带 `proposedClaims` 的 `ok`），`GroundTruthBeliefProjection(state)` 作 belief，`offeredContextIds` 取自请求装配；断言 `nextState.mentionLog` 的增减与 `recentMentionPenalty`。

- [ ] **Step 8: 跑全套 + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿、tsc clean。若 `tests/dialogue/provider.test.ts` 因 `RawDialogueResponse` 增 `proposedClaims` 而需调整断言，**据实更新**（新增字段默认 `[]`，多数断言不受影响）。

- [ ] **Step 9: commit**

```bash
git add src/engine/dialogue/types.ts src/engine/dialogue/mentionWriteback.ts src/engine/dialogue/orchestrator.ts tests/dialogue/mentionWriteback.test.ts tests/dialogue/pr5Integration.test.ts tests/dialogue/provider.test.ts
git commit -m "feat: provider proposedClaims + claim gate seam + 记忆写回（PR5-5 集成）"
```

---

## Self-Review（写完计划后对照 spec）

1. **Spec 覆盖**：DialogueAudienceContext 全量（T2）✓；DialogueClaim 结构化 + 自动事实冲突 forbidden（T1+T3）✓；gate 经 BeliefProjection 校验六类违规（T4）✓；写回提及（T5）✓。
2. **占位符扫描**：无 TBD；每个 code step 含完整代码。T5 Step6 的 `finalizeLine` 抽取与 text-gate 段标注为「复用现有 produceDialogueLine 逻辑」——实现者须真正抽取，不得留空。
3. **类型一致性**：`ProposedClaim`/`DialogueClaim`/`ClaimGateContext`/`DialoguePolicyContext` 跨 task 一致；`claimToFactKey` 仅映射三谓词；`appendMention` 入参须核对 PR4 实际签名（T5 Step3 注记）。
4. **已知取舍/待实现者核对**：fixture 的角色 id 必须 `loadContent()` 实核；礼制/身份为保守 MVP 规则（够测试断言即可，勿泛化）；`assembleClaims` 的 viewer 应显式传 speakerId（签名可加参，T3 Step3 注记）。
