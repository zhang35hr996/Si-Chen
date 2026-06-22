# LLM-2 Prompt Compiler + Eval

**日期:** 2026-06-22  
**PR 目标:** `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀；prompt caching；共用 online/fixture eval pipeline；20-30 黄金场景；自动指标 + 盲评导出。  
**基准分支:** main（commit `5cd2217`）  
**worktree:** `.worktrees/llm-2`  
**branch:** `feat/llm-2-prompt-compiler`

---

## LLM-2 边界（总体 spec §5-6）

- 编译器：`compilePromptPayload(request: DialogueRequest)` — 纯 DTO 变换，不接收 `ContentDB` / `GameState`
- `DialogueRequest` 扩展 `promptContext: DialoguePromptContext`（由 orchestrator 用 db/state 填入）
- 固定前缀（可缓存）：世界观规则 + etiquette → `cache_control: { type: "ephemeral" }`
- 动态后缀（不缓存）：角色·记忆·场景 → **只放 `messages[0].content`，不放 system**
- Relay 更新：schema 支持并透传 `cache_control`
- Eval：在线 + fixture 共用同一 compiler/schema/parser/gates（不写第二套）
- 不实现：batch（独立 LLM-2b）；reactionPlan live planner（LLM-3）；assembleClaims 升级（LLM-3）；修复重试（LLM-4）；streaming

## 非目标

- 让模型选 choice 文本（仍 authored）
- knownEvents 进 DialogueRequest（LLM-3）
- AuthorizedClaim / assembleClaims 升级（LLM-3）
- 真实 Anthropic Batch API（LLM-2b）
- 重试 / fallback（LLM-4）

---

## Global Constraints

1. **`compilePromptPayload` 签名只接收 `request: DialogueRequest`。** 不接 `ContentDB`、`GameState`、db、state getter。所有 db/state 访问必须在 orchestrator 里完成，结果写入 `request.promptContext`。
2. **动态 payload 只出现一次，在 `messages[0].content`。** `system[]` 只放固定前缀 blocks（带 `cache_control`）。不允许在 system 最后追加"动态 system block"。
3. **Relay schema 必须支持并透传 `cache_control`。** 任何不透传 `cache_control` 的 relay 实现都违背 caching 目标。
4. **Eval 不写第二套 gate。** 所有 claim / text / speaker gate 走 `validateDialogueProviderResult`，eval 和 orchestrator 共用同一函数。
5. **`EvalExecutionMode = "fixture" | "online"`。** 不实现伪 batch（fallback online 并记录 mode=batch 是误导）；遇到 batch 入参直接报 `unsupported_execution_mode`。
6. **Fixture mode 通过注入 fixture provider 实现，不是 mode switch。** `runEvalScenario(scenario, fixtureProvider, ...)` — mode 只区分是否调真实 API，不替换 provider 引用。
7. **`EvalResult` 用三态 `CheckStatus`。** `"pass" | "fail" | "not_run"` — provider 错误不能误计为 schema failure。
8. **黄金场景用 fixture builder。** 含记忆/事件的场景必须通过 `fixtureBuilders[fixtureId]()` 构造完整 `{ db, state }`，不依赖默认初始 state 恰好有某段记忆。
9. **盲评导出生成两个文件。** `blind-samples.tsv`（无模型名，供评审）+ `blind-key.tsv`（映射表，评后对照）。
10. **eval:run 生成 result JSONL，score/export 消费 JSONL。** 脚本用 Node 生成时间戳，不用 shell `$(date)`（Windows 兼容）。
11. **Provider 签名不变（`generate(request, options)`）。** Provider 不持有 db/state。
12. **`PromptMemory` / `PromptEvent` 是专用 DTO，不直接序列化 `MemoryEntry` / `CourtEvent`。** 类型层面保证不泄露内部运行字段。
13. **`capabilities.promptCaching: true` 必须与 caching blocks 同时设置。**
14. **CI 不调真实 API。** Eval fixture mode 跑 CI；在线 smoke 是手动步骤。
15. **`rawDialogueResponseSchema`（`types.ts:42-56`）在 T0 删除**（零消费者）。

---

## 关键接口（任务间约定）

### T0 新增 DTO 和 request 扩展

```ts
// src/engine/dialogue/promptPayload.ts（新建）

/** 供 compiler 使用的记忆 DTO — 只含发给模型的字段，不含运行内部字段 */
export interface PromptMemory {
  id: string;
  kind: MemoryKind;                              // "episodic" | "trauma" | ...
  summary: string;                               // ≤240，POV
  subjectIds: string[];
  perspective: MemoryPerspective;
  emotions: Partial<Record<MemoryEmotion, number>>;
  unresolved: boolean;
  occurredAt: GameTime;
  // 不含：ownerId, strength, retention, triggerTags, sourceEventId
}

/** 供 compiler 使用的事件 DTO（LLM-3 前只定义类型，knownEvents 传 []） */
export interface PromptEvent {
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];         // { charId; role }
  locationId?: string;
  facts: Record<string, unknown>;                // event.payload 的别名，已过滤 publicity/salience
  // 不含：publicity, publicSalience, retention, tags
}

/** 可选玩家选择候选（只暴露 id+intent，不含 authoredText/effectIds） */
export interface DialogueChoiceCandidate {
  id: string;
  intent: string;    // authored choice 的 tone 或 id 语义化描述
}

/** Orchestrator 用 db/state 填入 request 的 sanitized policy 字段 */
export interface DialoguePromptContext {
  speakerDisplayName: string;                       // resolveDisplayName 结果
  audience: DialogueAudienceContext;
  relevantMemories: PromptMemory[];                 // MemoryEntry[] 的 DTO 投影
  reactionPlan?: ReactionPlan;                      // LLM-3 前 undefined
  knownEvents: PromptEvent[];                       // LLM-3 前 []
  allowedClaims: DialogueClaim[];                   // LLM-3 前 []
  forbiddenClaims: DialogueClaim[];                 // LLM-3 前 []（assembleClaims().forbidden）
  choiceCandidates: DialogueChoiceCandidate[];      // 无 authored choices 时 []
}
```

**`DialogueRequest` 扩展：**
```ts
// src/engine/dialogue/types.ts — 在现有字段后追加
export interface DialogueRequest {
  // ... 现有字段 speakerId/targetId/locationId/time/speakerContext/etiquette/transcript/scripted ...
  promptContext: DialoguePromptContext;   // T0 新增，由 assembleDialogueRequest 填入
}
```

**`assembleDialogueRequest` 更新（LLM-2 stub 值）：**
```ts
promptContext: {
  speakerDisplayName: resolveDisplayName(character, standing, rank),
  audience: buildAudienceContext(state, db, { speakerId, targetId: "player" }),
  relevantMemories: buildMemoryContext(state, ...).activatedMemories.map(toPromptMemory),
  reactionPlan: undefined,
  knownEvents: [],
  allowedClaims: [],
  forbiddenClaims: [],
  choiceCandidates: [],
}
```

**`MemoryEntry → PromptMemory` 投影：**
```ts
function toPromptMemory(m: MemoryEntry): PromptMemory {
  return {
    id: m.id, kind: m.kind, summary: m.summary,
    subjectIds: m.subjectIds, perspective: m.perspective,
    emotions: m.emotions, unresolved: m.unresolved, occurredAt: m.createdAt,
  };
}
```

注意：`speakerContext.relevantMemories` 仍保留 `MemoryEntry[]`（供 offeredContextIds 等既有逻辑使用）；`promptContext.relevantMemories` 是 `PromptMemory[]` 投影（供 compiler 用）。两者必须源自同一次 `buildMemoryContext` 调用。

### T1 Prompt Payload 类型 + compilePromptPayload

```ts
// src/engine/dialogue/promptPayload.ts（续 T0）

export interface DialogueSpeakerPayload {
  id: string;
  name: string;                         // promptContext.speakerDisplayName
  rank: string;                         // speakerContext.standing.rank
  speechStyle: string;                  // speakerContext.profile.speechStyle
  personalityTraits: string[];          // speakerContext.profile.personalityTraits
  coreFacts: string[];                  // speakerContext.profile.coreFacts
  voice: CharacterContent["voice"];     // { register, quirks, tabooTopics }
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
    topicTags: string[];
    recentLines: { speaker: string; text: string }[];
  };
}

/** 纯 DTO 变换。不接收 ContentDB / GameState。 */
export function compilePromptPayload(request: DialogueRequest): DialoguePromptPayload {
  const ctx = request.promptContext;
  return {
    speaker: {
      id: request.speakerId,
      name: ctx.speakerDisplayName,
      rank: request.speakerContext.standing.rank,
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
      topicTags: [],
      recentLines: request.transcript.slice(-6),
    },
  };
}
```

### T2 buildAnthropicToolRequest 升级

**system block 类型扩展（`AnthropicRequestPayload`）：**
```ts
system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
```

**结构（只有两个固定 blocks，都带 cache_control）：**
```ts
system: [
  {
    type: "text",
    text: WORLD_RULES_TEXT,             // 模块级常量，世界观 + 角色扮演规则
    cache_control: { type: "ephemeral" },
  },
  {
    type: "text",
    text: renderEtiquetteBlock(request.etiquette),  // 称谓表 + 禁词
    cache_control: { type: "ephemeral" },
  },
]
// 动态内容全部在 user message，不追加第三个 system block
messages: [
  { role: "user", content: JSON.stringify(compilePromptPayload(request)) }
]
```

`capabilities.promptCaching: true`。

**Relay schema 更新（`server/llm/anthropicRelay.ts`）：**
```ts
const systemBlockSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  cache_control: z.strictObject({ type: z.literal("ephemeral") }).optional(),
});

// messages content：支持 string（当前用法）或 array（未来扩展）
messages: z.array(z.strictObject({
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]),
})),
```

### T3 共用 validation pipeline

```ts
// src/engine/dialogue/orchestrator.ts — 提取为导出函数

export interface DialogueValidationDiagnostics {
  claimFindings: ClaimFinding[];
  textFindings: GateFinding[];
  acceptedClaims: ProposedClaim[];
}

export function validateDialogueProviderResult(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  response: DialogueProviderResult,
): Result<{ line: DialogueLine; diagnostics: DialogueValidationDiagnostics }, GameError>
```

`produceDialogueLineWithPolicy` 改为调用此函数（行为不变）。Eval runner 也调用此函数。

### T4 Eval runner 接口

```ts
// src/engine/dialogue/eval/types.ts

export type EvalExecutionMode = "fixture" | "online";
export type CheckStatus = "pass" | "fail" | "not_run";

export interface EvalResult {
  scenarioId: string;
  fixtureId: string;
  model: string;
  mode: EvalExecutionMode;
  schemaStatus: CheckStatus;
  gateStatus: CheckStatus;
  providerError?: { kind: string; cause?: string };
  claimFindings: { code: string; claimId: string }[];
  textFindings: { gate: string; severity: string; matched: string }[];
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
  transcript?: { speaker: string; text: string }[];
  expectations?: {
    gatePass?: boolean;
    forbiddenTexts?: string[];
    mentionedMemoryKinds?: MemoryKind[];
  };
}
```

```ts
// src/engine/dialogue/eval/evalRunner.ts
export async function runEvalScenario(
  scenario: EvalScenario,
  provider: DialogueProvider,
  fixtureBuilders: Record<string, () => { db: ContentDB; state: GameState }>,
  mode: EvalExecutionMode,
): Promise<EvalResult>
```

`schemaStatus` / `gateStatus` 三态规则：
- provider err `cause === "schema_invalid"` → `schemaStatus: "fail"`
- 任何其他 provider err → `schemaStatus: "not_run", gateStatus: "not_run"`
- success → `schemaStatus: "pass"`；validate err → `gateStatus: "fail"`；validate ok → `gateStatus: "pass"`

### T5 Fixture builders + 场景集

```ts
// tests/eval/fixtures/builders.ts
export const fixtureBuilders: Record<
  string,
  () => { db: ContentDB; state: GameState }
> = {
  base_palace: ...,
  consort_with_grievance: ...,
  demoted_consort: ...,
};
```

场景 JSONL（`tests/eval/golden/scenarios.jsonl`）每行：
```json
{ "id": "s001", "fixtureId": "base_palace", "speakerId": "shen_zhibai", "locationId": "yan_bo_lou", "transcript": [], "expectations": { "gatePass": true } }
```

### T6 CLI 工具链

```json
"eval:run": "tsx tools/eval-run.ts",
"eval:score": "tsx tools/eval-score.ts",
"eval:export": "tsx tools/eval-export.ts"
```

**`blind-samples.tsv`（无模型名）:**
```
sampleId  scenarioContext  candidateA  candidateB  naturalness  characterVoice  worldConsistency  overallPreference
```

**`blind-key.tsv`（评后映射）:**
```
sampleId  candidateA_model  candidateB_model  scenarioId  runId
```

A/B 用 `--seed`（默认 42）固定 seed 打乱，可复现。文件名含 `Date.now()`，不用 shell `$(date)`。

---

## Tasks

### Task 0: DTO 类型 + `DialogueRequest.promptContext` + orchestrator 填充

**文件：**
- `src/engine/dialogue/promptPayload.ts`（新建：`PromptMemory`, `PromptEvent`, `DialogueChoiceCandidate`, `DialoguePromptContext`, `toPromptMemory`）
- `src/engine/dialogue/types.ts`（修改：追加 `promptContext: DialoguePromptContext`；删除 `rawDialogueResponseSchema` 第 42-56 行及相关 `z` import）
- `src/engine/dialogue/orchestrator.ts`（修改：`assembleDialogueRequest` 填入 `promptContext`）
- `tests/dialogue/promptPayload.test.ts`（新建：DTO 投影测试）
- 更新所有 `assembleDialogueRequest` 调用处（补充 `promptContext`）

**测试（TDD）：**
```ts
describe("toPromptMemory", () => {
  it("maps id/kind/summary/subjectIds/perspective/emotions/unresolved/createdAt→occurredAt")
  it("result has no ownerId field")
  it("result has no strength field")
  it("result has no retention/triggerTags fields")
})
describe("assembleDialogueRequest promptContext", () => {
  it("speakerDisplayName = resolveDisplayName result")
  it("audience.targetRole = sovereign when targetId = player")
  it("relevantMemories is PromptMemory[] (no ownerId)")
  it("knownEvents = []")
  it("allowedClaims = []")
  it("forbiddenClaims = []")
  it("reactionPlan = undefined")
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

**约束：**
- 签名 `compilePromptPayload(request: DialogueRequest): DialoguePromptPayload` — 无 db/state
- `speaker.speechStyle = request.speakerContext.profile.speechStyle`（不是 `voice.register`）
- `speaker.voice = request.speakerContext.voice`（含 register/quirks/tabooTopics）
- `personalityTraits/coreFacts` 直接读 profile（required 数组，无 string fallback）
- 不调 assembleClaims / planReaction / buildMemoryContext

**测试（TDD）：**
```ts
describe("compilePromptPayload", () => {
  it("speaker.id = request.speakerId")
  it("speaker.name = promptContext.speakerDisplayName")
  it("speaker.rank = speakerContext.standing.rank")
  it("speaker.speechStyle = profile.speechStyle (not voice.register)")
  it("speaker.personalityTraits = profile.personalityTraits (array)")
  it("speaker.coreFacts = profile.coreFacts (array)")
  it("relevantMemories = promptContext.relevantMemories")
  it("knownEvents = []")
  it("currentScene.recentLines = last 6 of transcript")
  it("no GameState/db in result")
  it("no ownerId/strength/retention in result")
})
```

---

### Task 2: 升级 `buildAnthropicToolRequest` + relay `cache_control` schema

**文件：**
- `src/engine/dialogue/providers/anthropicProvider.ts`（修改）
- `server/llm/anthropicRelay.ts`（修改）
- `tests/server/anthropicRelay.test.ts`（修改：加 cache_control 透传测试）
- `tests/dialogue/anthropicProvider.test.ts`（修改/新建：加 caching 结构测试）

**anthropicProvider 变更：**
1. `AnthropicRequestPayload.system` 类型加 `cache_control?: { type: "ephemeral" }`
2. `buildAnthropicToolRequest`：2 个固定 system blocks（均有 `cache_control`）+ user message（`compilePromptPayload` 结果）
3. `WORLD_RULES_TEXT` 提取为模块级常量
4. `capabilities.promptCaching: true`

**relay schema 变更：**
- `system: z.array(systemBlockSchema)`（`systemBlockSchema` 含可选 `cache_control`）
- `messages.content: z.union([z.string(), z.array(z.unknown())])`

**relay 测试新增：**
```ts
it("forwards cache_control blocks to transport without stripping")
it("request without cache_control is still valid")
it("request with unknown system block fields is rejected (.strict())")
```

**provider 测试新增：**
```ts
it("system has exactly 2 blocks")
it("all system blocks have cache_control.type === ephemeral")
it("system.length stays 2 regardless of request content")
it("messages[0].content parses as DialoguePromptPayload")
it("capabilities.promptCaching === true")
```

---

### Task 3: 提取共用 `validateDialogueProviderResult`

**文件：**
- `src/engine/dialogue/orchestrator.ts`（修改：提取并导出函数）
- `tests/dialogue/orchestrator.test.ts`（修改：加提取函数的直接测试）

**重构：**
- 提取 `validateDialogueProviderResult`（含 claim gate + finalizeLine）
- `produceDialogueLineWithPolicy` 改为调用它（行为不变）
- 现有集成测试覆盖行为回归

**新增测试：**
```ts
describe("validateDialogueProviderResult", () => {
  it("returns line+diagnostics when all gates pass")
  it("returns err when speaker mismatch")
  it("returns err when text gate rejects")
  it("returns err when claim gate rejects")
  it("diagnostics.claimFindings includes flagged claims")
  it("diagnostics.textFindings includes flagged text findings")
})
```

---

### Task 4: Eval runner（fixture + online，复用 T3 pipeline）

**文件：**
- `src/engine/dialogue/eval/types.ts`（新建）
- `src/engine/dialogue/eval/evalRunner.ts`（新建）
- `tests/dialogue/eval/evalRunner.test.ts`（新建）

**约束：**
- `mode="batch"` → 立即返回 `providerError: { kind: "config", cause: "unsupported_execution_mode" }`
- 调用 `validateDialogueProviderResult`（T3），不重写 gate 逻辑
- `schemaStatus / gateStatus` 严格遵守三态规则

**测试（全 mock provider）：**
```ts
describe("runEvalScenario", () => {
  it("schemaStatus=pass, gateStatus=pass when provider succeeds and gates pass")
  it("gateStatus=fail when text gate rejects")
  it("gateStatus=not_run when provider returns transport error")
  it("schemaStatus=fail when provider returns schema_invalid")
  it("schemaStatus=not_run when provider returns transport error")
  it("mode=batch returns unsupported_execution_mode immediately")
  it("fixture mode and online mode use same pipeline (different provider, same result shape)")
  it("durationMs >= 0")
})
```

---

### Task 5: Fixture builders + 黄金场景集（≥20 条）

**文件：**
- `tests/eval/fixtures/builders.ts`（新建，≥3 个 builder）
- `tests/eval/golden/scenarios.jsonl`（新建，≥20 条）

**builders.ts 要求：**
- 每个 builder 返回能通过 `assembleDialogueRequest` 的有效 `{ db, state }`
- 所有 ref 字段（speakerId / locationId / rankId）在 db 中存在
- 含记忆的场景通过 `injectMemory(state, ...)` helper 注入，不依赖默认 state

**场景集覆盖：**
- ≥4 个不同 speakerId（先 grep 确认 content JSON 中存在的角色）
- ≥3 个不同 fixtureId
- ≥5 条含 transcript（`≤6` 行，测试 recentLines 截取）
- ≥5 条 `expectations.gatePass: true`
- ≥4 条 `expectations.forbiddenTexts`
- ≥2 条使用含记忆的 fixtureId

---

### Task 6: eval:run + eval:score + 盲评导出

**文件：**
- `tools/eval-run.ts`（新建）
- `tools/eval-score.ts`（新建）
- `tools/eval-export.ts`（新建）
- `src/engine/dialogue/eval/scoring.ts`（新建：纯函数聚合，供 vitest 测试）
- `package.json`（加 3 个 scripts）

**eval-run.ts CLI 参数：**
```
--provider anthropic|fixture
--model <modelId>        (anthropic mode 时)
--mode online|fixture
--scenarios <path>
--output <path>          (含 Date.now() 时间戳，不用 shell date)
```

**eval-score.ts 输出格式：**
```
Scenarios:      20
Schema pass:    19/20 (95%)
Gate pass:      17/20 (85%)
Avg input tok:  450
Avg out tok:    92
Cache hits:     13/20 (65%)
```

**eval-export.ts：**
- `--input <pathA> <pathB>` 两份结果
- `--seed <n>`（默认 42）确定性打乱 A/B
- 输出 `blind-samples.tsv`（无模型名）+ `blind-key.tsv`（有映射）

**scoring.ts 测试（vitest）：**
```ts
describe("scoreResults", () => {
  it("schema pass rate = pass / (pass + fail), not_run excluded from denominator")
  it("gate pass rate same logic")
  it("cache hit = cacheReadTokens > 0 比例")
  it("avg tokens across results with usage")
  it("empty input returns zeros")
})
```

eval-run/score/export 不进 CI vitest，只测 scoring.ts 纯函数。

---

## 执行顺序

```
T0 (DTO + request 扩展)
  → T1 (compiler) [依赖 T0 的 PromptMemory/PromptContext]
  → T2 (caching + relay) [依赖 T1 的 compilePromptPayload]
     → T3 (shared pipeline) [T2 可并行，T3 不依赖 T2]
        → T4 (eval runner)
           → T5 (fixtures + scenarios)
              → T6 (CLI tools)
```

T2 和 T3 可以并行（T3 只重构 orchestrator，不依赖 relay 变更）。

---

## 验收清单

- [ ] `compilePromptPayload(request)` — 零 db/state 参数
- [ ] `PromptMemory` 类型无 `ownerId/strength/retention/triggerTags`（编译期）
- [ ] `system[]` 有 2 个 blocks，全带 `cache_control`；`messages[0].content` 含 payload
- [ ] Relay schema 支持 `cache_control`；测试断言透传
- [ ] `validateDialogueProviderResult` 被 orchestrator 和 eval 共用
- [ ] `runEvalScenario` 遇 `mode="batch"` 返回 `unsupported_execution_mode`
- [ ] `EvalResult.schemaStatus/gateStatus` 三态
- [ ] 场景含记忆 → 通过 fixtureBuilder 注入，不在 JSONL 写 MemoryEntry
- [ ] `blind-samples.tsv` 无模型名；`blind-key.tsv` 有映射
- [ ] `npm run typecheck` clean（client + server）
- [ ] `npx vitest run` 全绿（新增约 45+ tests）
- [ ] `npx vite build` 成功
- [ ] `rawDialogueResponseSchema` 已删除

---

## 进度账本（执行期填写）

Branch: feat/llm-2-prompt-compiler  
Worktree: .worktrees/llm-2  
Base (branch start): 5cd2217

| Task | Status | Commits | Notes |
|------|--------|---------|-------|
| T0   |        |         |       |
| T1   |        |         |       |
| T2   |        |         |       |
| T3   |        |         |       |
| T4   |        |         |       |
| T5   |        |         |       |
| T6   |        |         |       |
