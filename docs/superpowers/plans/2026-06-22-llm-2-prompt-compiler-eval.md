# LLM-2 Prompt Compiler + Eval

**日期:** 2026-06-22  
**PR 目标:** `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀；prompt caching；共用 online/fixture eval pipeline；20-30 黄金场景；自动指标 + 盲评导出。  
**基准分支:** main（commit `0dd9dc1`）  
**worktree:** `.worktrees/llm-2`  
**branch:** `feat/llm-2-prompt-compiler`

---

## LLM-2 边界（总体 spec §5-6）

- 编译器：`compilePromptPayload(request: DialogueRequest)` — 纯 DTO 变换，不接收 `ContentDB` / `GameState`
- `DialogueRequest` 扩展 `promptContext: DialoguePromptContext`（orchestrator 用 db/state 填入）
- 固定前缀（可缓存）：世界观规则 + etiquette → `cache_control: { type: "ephemeral" }`
- 动态后缀（不缓存）：角色·记忆·场景 → **只放 `messages[0].content`，不放 system**
- `currentScene.directive` 接入 `request.sceneDirective`（本轮对话意图）
- Relay schema 支持并透传 `cache_control`
- Eval 复用同一 compiler/parser/gates；`validateDialogueProviderResult` 失败时仍返回 diagnostics
- 不实现：batch（独立 LLM-2b）；reactionPlan live planner（LLM-3）；assembleClaims 升级（LLM-3）；修复重试（LLM-4）；streaming

## 非目标

- 让模型选 choice 文本（仍 authored）
- knownEvents 进 DialogueRequest（LLM-3）
- AuthorizedClaim / assembleClaims 升级（LLM-3）
- 真实 Anthropic Batch API（LLM-2b）
- 重试 / fallback（LLM-4）

---

## Global Constraints

1. **`compilePromptPayload` 签名只接收 `request: DialogueRequest`。** 不接 `ContentDB`、`GameState`。所有 db/state 访问在 orchestrator 完成，结果写入 `request.promptContext`。
2. **动态 payload 只出现一次，在 `messages[0].content`。** `system[]` 只放 2 个固定前缀 blocks（带 `cache_control`）。不允许追加"动态 system block"。
3. **Relay schema 必须支持并透传 `cache_control`。**
4. **`validateDialogueProviderResult` 无论 gate 通过还是拒绝，都必须携带 diagnostics。** 返回类型是 `DialogueValidationOutcome`（含 `ok: false` 路径也有 diagnostics）。
5. **`EvalExecutionMode = "fixture" | "online"`。** TypeScript 类型不含 `"batch"`。CLI parser 遇到 `--mode batch` 直接报错退出，不调用 runner。
6. **Fixture mode 通过注入 fixture provider 实现，不是 mode switch。**
7. **`EvalResult` 用三态 `CheckStatus = "pass" | "fail" | "not_run"`。**
8. **`expectations` 必须在 runner 里真正消费**，结果写入 `expectationStatus` 和 `expectationFindings`。`requiredSourceContextIds` 对照 `acceptedClaims.sourceContextIds`，不做 NLP 猜测。
9. **`EvalResult` 含 `runId: string` 和 `runIndex: number`。** CLI 支持 `--runs N`（默认 1）。盲评按 `scenarioId + runIndex` 配对。
10. **`DialogueSpeakerPayload.rank` 是对象（含可读中文名、grade、selfRefs），不是裸 ID。** orchestrator 在 assembly 阶段从 `db.ranks` 读入 `rankName / rankGrade` 写进 `promptContext`；compiler 只做组装。
11. **黄金场景用 fixture builders。** 含记忆的场景通过 builder 注入，不依赖默认 state。
12. **盲评导出两个文件：** `blind-samples.tsv`（无模型名）+ `blind-key.tsv`（映射）。A/B 用固定 seed 打乱。
13. **eval:run → JSONL → score/export。** 时间戳用 `Date.now()`，不用 shell `$(date)`。
14. **`PromptMemory.createdAt`（不叫 `occurredAt`）。** 记忆创建时间语义不等于事件发生时间。
15. **`PromptEvent.facts: Record<string, PromptFactValue>`。** `PromptFactValue = string | number | boolean | null`，不用 `unknown`。
16. **Prompt caching 验收：** `capabilities.promptCaching: true` 表示 adapter 支持注解；fixture 测试只验 `cache_control` 透传；`cacheReadTokens === 0` 不自动判定失败（Sonnet 4.6 最小阈值 1024 tokens，低于时不报错只不命中）；不为凑阈值填充无意义文本。
17. **`rawDialogueResponseSchema`（`types.ts:42-56`）在 T0 删除**（零消费者）。
18. **Provider 签名不变（`generate(request, options)`）。** Provider 不持有 db/state。
19. **CI 不调真实 API。** Fixture mode 跑 CI；在线 eval 是手动步骤。

---

## 关键接口（任务间约定）

### T0 DTO 类型 + request 扩展

```ts
// src/engine/dialogue/promptPayload.ts（新建）

export type PromptFactValue = string | number | boolean | null;

/** 记忆 DTO — 只含发给模型的字段，类型层面排除内部运行字段 */
export interface PromptMemory {
  id: string;
  kind: MemoryKind;
  summary: string;
  subjectIds: string[];
  perspective: MemoryPerspective;
  emotions: Partial<Record<MemoryEmotion, number>>;
  unresolved: boolean;
  createdAt: GameTime;          // 语义准确：记忆创建时间（≠ 事件发生时间）
  // 不含：ownerId, strength, retention, triggerTags, sourceEventId
}

/** 事件 DTO（LLM-3 前只定义类型，knownEvents 传 []） */
export interface PromptEvent {
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];
  locationId?: string;
  facts: Record<string, PromptFactValue>;   // 标量值，非 unknown
  // 不含：publicity, publicSalience, retention, tags
}

export interface DialogueChoiceCandidate {
  id: string;
  intent: string;
}

/** Orchestrator 填入 request 的 sanitized policy 字段 */
export interface DialoguePromptContext {
  speakerDisplayName: string;
  rankName: string;           // db.ranks[standing.rank].name（可读中文位分名）
  rankGrade: string;          // db.ranks[standing.rank].grade（如 "正二品"）
  audience: DialogueAudienceContext;
  relevantMemories: PromptMemory[];
  reactionPlan?: ReactionPlan;          // LLM-3 前 undefined
  knownEvents: PromptEvent[];           // LLM-3 前 []
  allowedClaims: DialogueClaim[];       // LLM-3 前 []
  forbiddenClaims: DialogueClaim[];     // LLM-3 前 []
  choiceCandidates: DialogueChoiceCandidate[];  // LLM-2 前 []
}

export function toPromptMemory(m: MemoryEntry): PromptMemory {
  return {
    id: m.id, kind: m.kind, summary: m.summary,
    subjectIds: m.subjectIds, perspective: m.perspective,
    emotions: m.emotions, unresolved: m.unresolved,
    createdAt: m.createdAt,    // 保留语义：m.createdAt 不叫 occurredAt
  };
}
```

**`DialogueRequest` 扩展（`types.ts`）：**
```ts
export interface DialogueRequest {
  // ... 现有字段 ...
  promptContext: DialoguePromptContext;   // T0 新增
}
```

**`assembleDialogueRequest` 更新（orchestrator）：**
```ts
const memCtx = buildMemoryContext(state, { speakerId }, { ... });
return ok({
  // ... 现有字段 ...
  speakerContext: {
    // ... 现有字段（relevantMemories 仍是 MemoryEntry[]，供 offeredContextIds 用）...
  },
  promptContext: {
    speakerDisplayName: resolveDisplayName(character, standing, rank),
    rankName: rank.name,
    rankGrade: rank.grade,
    audience: buildAudienceContext(state, db, { speakerId, targetId: "player" }),
    relevantMemories: memCtx.activatedMemories.map(toPromptMemory),
    reactionPlan: undefined,
    knownEvents: [],
    allowedClaims: [],
    forbiddenClaims: [],
    choiceCandidates: [],
  },
});
```

注意：`speakerContext.relevantMemories` 保留 `MemoryEntry[]`（供 offeredContextIds 等既有逻辑）；`promptContext.relevantMemories` 是 `PromptMemory[]` 投影。两者来自同一次 `buildMemoryContext` 调用。

### T1 DialoguePromptPayload + compilePromptPayload

```ts
export interface DialogueSpeakerPayload {
  id: string;
  name: string;                             // promptContext.speakerDisplayName
  rank: {
    id: string;                             // speakerContext.standing.rank
    name: string;                           // promptContext.rankName
    grade: string;                          // promptContext.rankGrade
    selfRefs: CharacterRank["selfRefs"];    // speakerContext.standing.selfRefs
  };
  speechStyle: string;                      // speakerContext.profile.speechStyle
  personalityTraits: string[];              // speakerContext.profile.personalityTraits
  coreFacts: string[];                      // speakerContext.profile.coreFacts
  voice: CharacterContent["voice"];         // { register, quirks, tabooTopics }
}

export interface DialoguePromptPayload {
  speaker: DialogueSpeakerPayload;
  audience: DialogueAudienceContext;
  reactionPlan?: ReactionPlan;
  relevantMemories: PromptMemory[];
  knownEvents: PromptEvent[];
  allowedClaims: DialogueClaim[];
  forbiddenClaims: DialogueClaim[];
  choiceCandidates: DialogueChoiceCandidate[];
  currentScene: {
    location: string;
    directive?: string;                     // request.sceneDirective（本轮对话意图）
    topicTags: string[];
    recentLines: { speaker: string; text: string }[];
  };
}

export function compilePromptPayload(request: DialogueRequest): DialoguePromptPayload {
  const ctx = request.promptContext;
  return {
    speaker: {
      id: request.speakerId,
      name: ctx.speakerDisplayName,
      rank: {
        id: request.speakerContext.standing.rank,
        name: ctx.rankName,
        grade: ctx.rankGrade,
        selfRefs: request.speakerContext.standing.selfRefs,
      },
      speechStyle: request.speakerContext.profile.speechStyle,
      personalityTraits: request.speakerContext.profile.personalityTraits,
      coreFacts: request.speakerContext.profile.coreFacts,
      voice: request.speakerContext.voice,
    },
    audience: ctx.audience,
    reactionPlan: ctx.reactionPlan,
    relevantMemories: ctx.relevantMemories,
    knownEvents: ctx.knownEvents,
    allowedClaims: ctx.allowedClaims,
    forbiddenClaims: ctx.forbiddenClaims,
    choiceCandidates: ctx.choiceCandidates,
    currentScene: {
      location: request.locationId,
      ...(request.sceneDirective ? { directive: request.sceneDirective } : {}),
      topicTags: [],
      recentLines: request.transcript.slice(-6),
    },
  };
}
```

### T2 buildAnthropicToolRequest 升级 + relay schema

**`AnthropicRequestPayload.system` 类型：**
```ts
system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
```

**结构（2 个固定 system blocks + user message）：**
```ts
system: [
  { type: "text", text: WORLD_RULES_TEXT, cache_control: { type: "ephemeral" } },
  { type: "text", text: renderEtiquetteBlock(request.etiquette), cache_control: { type: "ephemeral" } },
]
messages: [{ role: "user", content: JSON.stringify(compilePromptPayload(request)) }]
```

`capabilities.promptCaching: true`。

**Relay schema（`server/llm/anthropicRelay.ts`）：**
```ts
const systemBlockSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  cache_control: z.strictObject({ type: z.literal("ephemeral") }).optional(),
});

// messages.content 支持 string | array
messages: z.array(z.strictObject({
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]),
})),
```

### T3 共用 validation pipeline

```ts
// src/engine/dialogue/orchestrator.ts — 提取并导出

export interface DialogueValidationDiagnostics {
  claimFindings: ClaimFinding[];
  textFindings: GateFinding[];
  acceptedClaims: ProposedClaim[];
}

/** 无论 gate 通过还是拒绝，都携带 diagnostics */
export type DialogueValidationOutcome =
  | { ok: true;  line: DialogueLine; diagnostics: DialogueValidationDiagnostics }
  | { ok: false; error: GameError;   diagnostics: DialogueValidationDiagnostics };

export function validateDialogueProviderResult(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  response: DialogueProviderResult,
): DialogueValidationOutcome   // 注意：非 Result<>, 直接是 Outcome
```

`produceDialogueLineWithPolicy` 包装：
```ts
const outcome = validateDialogueProviderResult(...);
if (!outcome.ok) return err(outcome.error);
// 用 outcome.line / outcome.diagnostics 做 mention writeback
```

### T4 Eval runner 接口

```ts
// src/engine/dialogue/eval/types.ts

export type EvalExecutionMode = "fixture" | "online";
// "batch" 不在类型中；CLI parser 遇到 --mode batch 直接报错

export type CheckStatus = "pass" | "fail" | "not_run";

export interface EvalExpectationFinding {
  code: "unexpected_gate_result" | "forbidden_text_present" | "required_source_not_cited";
  detail: string;
}

export interface EvalResult {
  scenarioId: string;
  runId: string;             // 形如 "<model>-<timestamp>-r<index>"
  runIndex: number;          // 0-based，供盲评配对
  fixtureId: string;
  model: string;
  mode: EvalExecutionMode;
  schemaStatus: CheckStatus;
  gateStatus: CheckStatus;
  providerError?: { kind: string; cause?: string };
  claimFindings: { code: string; claimId: string }[];
  textFindings: { gate: string; severity: string; matched: string }[];
  expectationStatus: CheckStatus;
  expectationFindings: EvalExpectationFinding[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  requestId?: string;
  text?: string;
  durationMs: number;
}

export interface EvalScenario {
  id: string;
  fixtureId: string;
  speakerId: string;
  targetId?: string;
  locationId: string;
  sceneDirective?: string;              // 本轮对话意图（接入 request.sceneDirective）
  transcript?: { speaker: string; text: string }[];
  expectations?: {
    gatePass?: boolean;
    forbiddenTexts?: string[];
    requiredSourceContextIds?: string[];  // 对照 acceptedClaims.sourceContextIds，非 NLP 猜测
  };
}
```

**Expectation 检查逻辑（在 runEvalScenario 里）：**
```ts
const findings: EvalExpectationFinding[] = [];
if (exp.gatePass !== undefined) {
  const actual = result.gateStatus === "pass";
  if (actual !== exp.gatePass)
    findings.push({ code: "unexpected_gate_result", detail: `expected gatePass=${exp.gatePass}` });
}
for (const forbidden of exp.forbiddenTexts ?? []) {
  if (result.text?.includes(forbidden))
    findings.push({ code: "forbidden_text_present", detail: forbidden });
}
for (const srcId of exp.requiredSourceContextIds ?? []) {
  const cited = diagnostics?.acceptedClaims.some(c => c.sourceContextIds.includes(srcId));
  if (!cited)
    findings.push({ code: "required_source_not_cited", detail: srcId });
}
result.expectationStatus = findings.length === 0 ? "pass" : "fail";
result.expectationFindings = findings;
// 无 expectations → expectationStatus: "not_run"
```

### T5 Fixture builders + 场景集

```ts
// tests/eval/fixtures/builders.ts
export const fixtureBuilders: Record<string, () => { db: ContentDB; state: GameState }> = {
  base_palace: ...,
  consort_with_grievance: ...,
  demoted_consort: ...,
};
```

**场景集（JSONL）覆盖：**
- ≥4 个不同 speakerId
- ≥3 个不同 fixtureId
- **≥5 条含 `sceneDirective`**（如 `"请安"`、`"回应降位"`、`"试探皇帝态度"`）
- ≥5 条含 transcript
- ≥5 条 `expectations.gatePass: true`
- ≥4 条 `expectations.forbiddenTexts`
- ≥2 条使用含记忆的 fixtureId

### T6 CLI 工具链

```json
"eval:run": "tsx tools/eval-run.ts",
"eval:score": "tsx tools/eval-score.ts",
"eval:export": "tsx tools/eval-export.ts"
```

**eval-run.ts CLI：**
```
--provider anthropic|fixture
--model <modelId>
--mode online|fixture
--runs N          (默认 1；每场景跑 N 次，runIndex 0..N-1)
--scenarios <path>
--output <path>   (含 Date.now()，不用 shell date)
```

`runId` 格式：`"${model}-${Date.now()}-r${runIndex}"`

**eval-score.ts：**
```
Scenarios:      20   (runs × scenarios if runs>1 则标注)
Schema pass:    19/20 (95%)
Gate pass:      17/20 (85%)
Expectation:    15/20 (75%)
Avg input tok:  450
Avg out tok:    92
Cache hits:     13/20 (65%)
```

**eval-export.ts 盲评：**
- `--input <pathA> <pathB>` 两个 run JSONL
- 按 `scenarioId + runIndex` 配对（runIndex 对应相同的 scenario 第 n 次运行）
- `--seed N`（默认 42）随机交换 A/B 顺序

`blind-samples.tsv` 列（无模型名）：
```
sampleId  scenarioId  runIndex  sceneDirective  candidateA  candidateB  naturalness  characterVoice  worldConsistency  overallPreference
```

`blind-key.tsv` 列：
```
sampleId  candidateA_runId  candidateB_runId  scenarioId  runIndex
```

---

## Tasks

### Task 0: DTO 类型 + `DialogueRequest.promptContext` + orchestrator 填充

**文件：**
- `src/engine/dialogue/promptPayload.ts`（新建：`PromptFactValue`, `PromptMemory`, `PromptEvent`, `DialogueChoiceCandidate`, `DialoguePromptContext`, `toPromptMemory`）
- `src/engine/dialogue/types.ts`（修改：追加 `promptContext`；删除 `rawDialogueResponseSchema` 第 42-56 行）
- `src/engine/dialogue/orchestrator.ts`（修改：`assembleDialogueRequest` 填入 `promptContext`，含 `rankName/rankGrade`）
- `tests/dialogue/promptPayload.test.ts`（新建：DTO 投影测试）

**测试（TDD）：**
```ts
describe("toPromptMemory", () => {
  it("maps id/kind/summary/subjectIds/perspective/emotions/unresolved")
  it("createdAt = m.createdAt (not occurredAt)")
  it("result has no ownerId field")
  it("result has no strength/retention/triggerTags fields")
})
describe("assembleDialogueRequest promptContext", () => {
  it("speakerDisplayName = resolveDisplayName result")
  it("rankName = db.ranks[standing.rank].name")
  it("rankGrade = db.ranks[standing.rank].grade")
  it("audience.targetRole = sovereign when targetId = player")
  it("relevantMemories is PromptMemory[] (no ownerId)")
  it("knownEvents = [], allowedClaims = [], forbiddenClaims = []")
  it("reactionPlan = undefined")
  it("choiceCandidates = []")
})
```

**验收：**
- `PromptMemory` 类型上不含 `ownerId`（编译期）
- `rawDialogueResponseSchema` 已删，无 unused import
- 现有所有测试全绿

---

### Task 1: `DialoguePromptPayload` + `compilePromptPayload`

**文件：**
- `src/engine/dialogue/promptPayload.ts`（续 T0：加 `DialogueSpeakerPayload`, `DialoguePromptPayload`, `compilePromptPayload`）
- `tests/dialogue/promptPayload.test.ts`（续 T0：加 compiler 测试）

**测试（TDD）：**
```ts
describe("compilePromptPayload", () => {
  it("speaker.id = request.speakerId")
  it("speaker.name = promptContext.speakerDisplayName")
  it("speaker.rank.id = speakerContext.standing.rank")
  it("speaker.rank.name = promptContext.rankName")
  it("speaker.rank.grade = promptContext.rankGrade")
  it("speaker.rank.selfRefs = speakerContext.standing.selfRefs")
  it("speaker.speechStyle = profile.speechStyle (not voice.register)")
  it("speaker.personalityTraits = profile.personalityTraits")
  it("speaker.coreFacts = profile.coreFacts")
  it("currentScene.directive = request.sceneDirective when present")
  it("currentScene has no directive key when sceneDirective absent")
  it("currentScene.recentLines = last 6 of transcript")
  it("result contains no GameState/db reference")
  it("result contains no ownerId/strength/retention")
})
```

**验收：**
- `compilePromptPayload` 签名 `(request: DialogueRequest)` — 零额外参数
- 类型保证无 `ownerId/strength/retention`

---

### Task 2: 升级 `buildAnthropicToolRequest` + relay `cache_control` schema

**文件：**
- `src/engine/dialogue/providers/anthropicProvider.ts`（修改）
- `server/llm/anthropicRelay.ts`（修改）
- `tests/server/anthropicRelay.test.ts`（修改：加 cache_control 透传测试）
- `tests/dialogue/anthropicProvider.test.ts`（新/改：加 caching 结构测试）

**provider 变更：**
1. `AnthropicRequestPayload.system` 加 `cache_control?: { type: "ephemeral" }`
2. `buildAnthropicToolRequest`：2 个固定 blocks（均有 `cache_control`）+ user message
3. `WORLD_RULES_TEXT` 模块级常量
4. `capabilities.promptCaching: true`

**relay 测试新增：**
```ts
it("forwards cache_control to transport (not stripped by .strict() schema)")
it("request without cache_control is still valid")
```

**provider 测试新增：**
```ts
it("system has exactly 2 blocks")
it("all system blocks have cache_control.type === ephemeral")
it("system.length stays 2 regardless of request content")
it("messages[0].content includes currentScene.directive when sceneDirective present")
it("messages[0].content has no ownerId/strength")
it("capabilities.promptCaching === true")
```

---

### Task 3: 提取 `validateDialogueProviderResult`（DialogueValidationOutcome）

**文件：**
- `src/engine/dialogue/orchestrator.ts`（修改）
- `tests/dialogue/orchestrator.test.ts`（修改：加提取函数直接测试）

**返回类型 `DialogueValidationOutcome`（非 `Result<>`）：**
- `ok: false` 时也包含 `diagnostics`（含 `claimFindings`, `textFindings`, `acceptedClaims`）
- `produceDialogueLineWithPolicy` 包装：`if (!outcome.ok) return err(outcome.error)`

**测试：**
```ts
describe("validateDialogueProviderResult", () => {
  it("ok=true: returns line + diagnostics")
  it("ok=false speaker mismatch: returns error + diagnostics (claimFindings=[], textFindings=[])")
  it("ok=false text gate rejects: textFindings contains rejection, acceptedClaims still present")
  it("ok=false claim gate rejects: claimFindings contains violation, diagnostics intact")
  it("ok=true partial: flagged (non-reject) claims in claimFindings, ok=true")
})
```

`produceDialogueLineWithPolicy` 现有集成测试覆盖行为回归（不得改变外部行为）。

---

### Task 4: Eval runner（fixture + online，复用 T3 pipeline）

**文件：**
- `src/engine/dialogue/eval/types.ts`（新建：`EvalExecutionMode`, `CheckStatus`, `EvalExpectationFinding`, `EvalResult`, `EvalScenario`）
- `src/engine/dialogue/eval/evalRunner.ts`（新建）
- `tests/dialogue/eval/evalRunner.test.ts`（新建）

**runEvalScenario 步骤：**
1. `fixtureBuilders[scenario.fixtureId]()` 得 `{ db, state }`
2. `assembleDialogueRequest`（含 `sceneDirective: scenario.sceneDirective`）
3. `buildDialoguePolicyContext`
4. `provider.generate(request)` → 记时
5. Provider err：`schemaStatus/gateStatus: "not_run"`（`schema_invalid` → `schemaStatus: "fail"`）
6. 成功：`validateDialogueProviderResult(...)` → 得 `outcome`（含 diagnostics）
7. `outcome.ok`：`gateStatus: "pass"`；否则：`gateStatus: "fail"`
8. 检查 `expectations`：对照 `outcome.diagnostics.acceptedClaims`, `forbidden texts`, `gateStatus`
9. 返回完整 `EvalResult`（含 `runId`, `runIndex`, `expectationStatus/Findings`）

**CLI mode 处理：**
- TypeScript 类型 `EvalExecutionMode = "fixture" | "online"`
- CLI parser 层判断：收到 `"batch"` → `console.error("batch mode not supported in LLM-2..."); process.exit(1)`
- 不在 runner 里处理 `"batch"` 入参

**测试（全 mock provider）：**
```ts
describe("runEvalScenario", () => {
  it("gateStatus=pass, expectationStatus=pass when all pass and expectations met")
  it("gateStatus=fail when text gate rejects; diagnostics.textFindings present")
  it("gateStatus=not_run when provider returns transport error")
  it("schemaStatus=fail when provider returns schema_invalid")
  it("expectationStatus=fail when gatePass=true but gate actually failed")
  it("expectationStatus=fail when forbiddenText found in result.text")
  it("expectationStatus=not_run when no expectations defined")
  it("runIndex correctly set per call")
  it("sceneDirective passed to assembleDialogueRequest when set in scenario")
})
```

---

### Task 5: Fixture builders + 黄金场景集（≥20 条）

**文件：**
- `tests/eval/fixtures/builders.ts`（新建，≥3 个 builder）
- `tests/eval/golden/scenarios.jsonl`（新建，≥20 条）

**场景覆盖（调整后）：**
- ≥4 个不同 speakerId（先 grep content JSON 确认存在的角色 id）
- ≥3 个不同 fixtureId
- **≥5 条含 `sceneDirective`**（核心新增：这是让模型知道"说什么"的关键）
- ≥5 条含 transcript（测试 recentLines ≤6 行截取）
- ≥5 条 `expectations.gatePass: true`
- ≥4 条 `expectations.forbiddenTexts`
- ≥2 条使用含记忆 fixtureId + `requiredSourceContextIds`
- ≥2 条含 `sceneDirective` + `expectations.gatePass: true`（验证"有意图 + 合规"组合）

**示例场景行：**
```json
{"id":"s001","fixtureId":"base_palace","speakerId":"shen_zhibai","locationId":"yan_bo_lou","sceneDirective":"请安","transcript":[],"expectations":{"gatePass":true,"forbiddenTexts":["大人","公子"]}}
{"id":"s010","fixtureId":"demoted_consort","speakerId":"shen_zhibai","locationId":"yan_bo_lou","sceneDirective":"回应降位后的沉默","transcript":[],"expectations":{"gatePass":true}}
{"id":"s015","fixtureId":"consort_with_grievance","speakerId":"shen_zhibai","locationId":"yan_bo_lou","sceneDirective":"试探皇帝是否还记得旧事","expectations":{"requiredSourceContextIds":["mem_xxx"]}}
```

---

### Task 6: eval:run + eval:score + 盲评导出

**文件：**
- `tools/eval-run.ts`（新建）
- `tools/eval-score.ts`（新建）
- `tools/eval-export.ts`（新建）
- `src/engine/dialogue/eval/scoring.ts`（新建：纯函数聚合，供 vitest 测试）

**eval-run.ts：**
- `--runs N`（默认 1）：每场景跑 N 次；`runIndex` 0..N-1
- `runId = "${model}-${Date.now()}-r${runIndex}"`

**eval-score.ts 输出：**
```
Scenarios:       20 (runs: 3 → 60 results)
Schema pass:     58/60 (97%)
Gate pass:       52/60 (87%)
Expectation:     48/60 (80%)
Avg input tok:   450
Avg out tok:     92
Cache hits:      39/60 (65%)
```

**eval-export.ts 盲评：**
- 按 `scenarioId + runIndex` 配对两份 JSONL
- A/B 位置用 `seed`（默认 42）的 deterministic shuffle
- `blind-samples.tsv`（含 `sceneDirective` 列，帮助评审者理解期望）
- `blind-key.tsv`（映射 `sampleId → candidateA_runId / candidateB_runId`）

**scoring.ts vitest 测试：**
```ts
describe("scoreResults", () => {
  it("schema pass = pass count / (pass+fail), not_run excluded from denominator")
  it("gate pass 同理")
  it("expectation pass 同理")
  it("cache hit = cacheReadTokens > 0 比例")
  it("avg tokens calculated only from results with usage")
  it("empty input returns zeros")
})
```

eval-run/score/export 不进 CI vitest，只测 scoring.ts 纯函数。

---

## 执行顺序

```
T0 (DTO + request 扩展 + rawDialogueResponseSchema 删除)
  → T1 (compiler，含 sceneDirective + rank object)
  → T2 (caching + relay)  ← T2 依赖 T1 的 compilePromptPayload
    T3 (shared pipeline)  ← T3 不依赖 T2，可与 T2 并行
      → T4 (eval runner)  ← 依赖 T3 的 validateDialogueProviderResult
         → T5 (fixtures + scenarios)
            → T6 (CLI tools)
```

---

## 验收清单

- [ ] `compilePromptPayload(request)` — 零 db/state 参数
- [ ] `currentScene.directive` 来自 `request.sceneDirective`（含则有，无则缺省）
- [ ] `speaker.rank` 是对象（id/name/grade/selfRefs），非裸 ID
- [ ] `PromptMemory` 有 `createdAt`（不叫 `occurredAt`），无 `ownerId/strength/retention`（编译期）
- [ ] `PromptEvent.facts: Record<string, PromptFactValue>`（非 `unknown`）
- [ ] `system[]` 有 2 个 blocks，全带 `cache_control`；动态内容只在 `messages[0].content`
- [ ] Relay schema 支持 `cache_control`；relay 测试断言透传（不被 `.strict()` 剥离）
- [ ] `validateDialogueProviderResult` 返回 `DialogueValidationOutcome`（`ok:false` 也含 diagnostics）
- [ ] `EvalExecutionMode = "fixture" | "online"`（无 `"batch"` 类型）；CLI parser 遇 batch 报错退出
- [ ] `EvalResult` 含 `runId`, `runIndex`, `expectationStatus`, `expectationFindings`
- [ ] `EvalScenario` 含 `sceneDirective?` 和 `requiredSourceContextIds?`（非 `mentionedMemoryKinds`）
- [ ] Expectation checks 在 runner 里实现（gatePass 对照、forbiddenText 字符串检查、sourceContextIds 对照）
- [ ] ≥5 个场景含 `sceneDirective`
- [ ] `eval:run --runs N` 生成 JSONL；`eval:export` 按 `scenarioId+runIndex` 配对；盲评两文件
- [ ] `capabilities.promptCaching: true`（不承诺命中阈值）
- [ ] `npm run typecheck` clean（client + server）
- [ ] `npx vitest run` 全绿（新增约 50+ tests）
- [ ] `npx vite build` 成功
- [ ] `rawDialogueResponseSchema` 已删除

---

## 进度账本（执行期填写）

Branch: feat/llm-2-prompt-compiler  
Worktree: .worktrees/llm-2  
Base (branch start): 0dd9dc1

| Task | Status | Commits | Notes |
|------|--------|---------|-------|
| T0   |        |         |       |
| T1   |        |         |       |
| T2   |        |         |       |
| T3   |        |         |       |
| T4   |        |         |       |
| T5   |        |         |       |
| T6   |        |         |       |
