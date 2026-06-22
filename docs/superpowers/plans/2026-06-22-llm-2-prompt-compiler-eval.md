# LLM-2 Prompt Compiler + Eval

**日期:** 2026-06-22  
**PR 目标:** `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀；prompt caching；共用 online/fixture eval pipeline；20-30 黄金场景；自动指标 + 盲评导出。  
**基准分支:** main（commit `bc6b12c`）  
**worktree:** `.worktrees/llm-2`  
**branch:** `feat/llm-2-prompt-compiler`

---

## LLM-2 边界（总体 spec §5-6）

- 编译器：`compilePromptPayload(request: DialogueRequest)` — 纯 DTO 变换，不接收 `ContentDB` / `GameState`
- `DialogueRequest` 扩展 `promptContext: DialoguePromptContext`（orchestrator 用 db/state 填入）
- `assembleDialogueRequest` 末位参数改为 `options: DialogueAssemblyOptions`（接收 targetId / sceneDirective / transcript）
- 固定前缀（可缓存）：世界观规则 + etiquette → `cache_control: { type: "ephemeral" }`
- 动态后缀（不缓存）：角色·记忆·场景 → **只放 `messages[0].content`，不放 system**
- `currentScene.directive` 接入 `request.sceneDirective`
- Relay schema 支持并透传 `cache_control`
- Eval 复用同一 compiler/parser/gates；`validateDialogueProviderResult` 始终携带 diagnostics
- 不实现：batch（LLM-2b）；reactionPlan live planner（LLM-3）；assembleClaims 升级（LLM-3）；修复重试（LLM-4）；streaming

## 非目标

- 让模型选 choice 文本（仍 authored）
- knownEvents 进 DialogueRequest（LLM-3）
- AuthorizedClaim / assembleClaims 升级（LLM-3）
- 真实 Anthropic Batch API（LLM-2b）
- 重试 / fallback（LLM-4）

---

## Global Constraints

1. **`assembleDialogueRequest` 末位改为 `options: DialogueAssemblyOptions = {}`。** `targetId`、`sceneDirective`、`transcript`、`scripted` 都从 options 读。`targetId` 同时写入 `request.targetId`、`memoryContext.audienceId`、`buildAudienceContext` 的 targetId — 三处必须同源。
2. **`compilePromptPayload(request)` 零额外参数。** 所有 db/state 访问在 orchestrator 完成后写入 `promptContext`。
3. **Elder 的 rank display 是 `{ kind: "unranked" }`，不读 `db.ranks["__elder__"]`。** `DialogueSpeakerStanding` 是判别联合；orchestrator 在 assembly 阶段填入正确分支。
4. **`buildDialoguePolicyContext` 的 audience 来自 `request.promptContext.audience`。** 不再独立调用 `buildAudienceContext`；gate 和 prompt 使用同一个对象，不会漂移。
5. **动态 payload 只出现一次，在 `messages[0].content`。** `system[]` 只放 2 个固定 blocks（带 `cache_control`）。
6. **Relay schema 支持并透传 `cache_control`。**
7. **`validateDialogueProviderResult` 返回 `DialogueValidationOutcome`，始终携带 diagnostics。** `ok: false` 时 `diagnostics` 也存在。
8. **Validation 顺序：speaker check → claim gate → text gate。** 这是有意调整（非"行为不变"）。受影响的集成测试必须显式更新，并注释说明调整原因。
9. **`EvalExecutionMode = "fixture" | "online"`，TypeScript 类型不含 `"batch"`。** CLI parser 遇到 `--provider` 不在白名单时直接报错退出；`--mode` 选项删除，mode 由 `--provider` 推导。
10. **`evaluationId` 在一次 CLI 执行开始时生成一次，不在每个 scenario 内重新调用 `Date.now()`。** `runId = "${evaluationId}-r${runIndex}"`。
11. **Expectation 的 prerequisite 规则：** 当 `schemaStatus !== "pass"` 或 `gateStatus === "not_run"` 或 `result.text === undefined` 时，`expectationStatus: "not_run"`（即使场景定义了 expectations）。Prerequisite 通过后才检查各条。
12. **`EvalResult` 含 `runId`, `runIndex`, `expectationStatus`, `expectationFindings`。**
13. **`EvalScenario` 含 `sceneDirective?` 和 `requiredSourceContextIds?`（代替 `mentionedMemoryKinds`）。**
14. **Fixture mode 通过注入 fixture provider 实现；`--provider fixture` 推导 mode=fixture。**
15. **盲评：`evaluationId` 作为同一轮评测的归组键；按 `scenarioId + runIndex` 配对两个模型。**
16. **`PromptMemory.createdAt`（非 `occurredAt`）；`PromptEvent.facts: Record<string, PromptFactValue>`（非 `unknown`）。**
17. **Prompt caching 验收：** `capabilities.promptCaching: true` 只表示 adapter 支持注解；`cacheReadTokens === 0` 不自动判定失败（Sonnet 4.6 阈值 1024 tokens）；不填充无意义文本。
18. **CI 不调真实 API。** Fixture mode 跑 CI；在线 eval 手动。
19. **`rawDialogueResponseSchema`（`types.ts:42-56`）在 T0 删除**（零消费者）。

---

## 关键接口（任务间约定）

### T0 DTO 类型 + assembleDialogueRequest 参数扩展 + promptContext

**新增 / 修改文件：** `src/engine/dialogue/promptPayload.ts`（新建 DTO），`src/engine/dialogue/types.ts`（扩展 DialogueRequest），`src/engine/dialogue/orchestrator.ts`（修改 assemble 函数签名 + 填 promptContext + 修改 buildDialoguePolicyContext）

---

**`DialogueAssemblyOptions`（`orchestrator.ts` 或 `types.ts`）：**
```ts
export interface DialogueAssemblyOptions {
  targetId?: string;                           // 默认 "player"
  sceneDirective?: string;
  transcript?: { speaker: string; text: string }[];  // 默认 []
  scripted?: { text: string; expression?: string };
}
```

`assembleDialogueRequest` 新签名：
```ts
export function assembleDialogueRequest(
  db: ContentDB,
  state: GameState,
  speakerId: string,
  locationId: string,
  options: DialogueAssemblyOptions = {},
): Result<DialogueRequest, GameError>
```

内部：
```ts
const targetId = options.targetId ?? "player";
// targetId 同时用于：request.targetId、memoryContext.audienceId、buildAudienceContext targetId
```

**所有现有调用方**（游戏主流程传 `scripted`）必须更新为 `options` 对象形式：
```ts
// 旧：assembleDialogueRequest(db, state, speakerId, locationId, scripted)
// 新：assembleDialogueRequest(db, state, speakerId, locationId, { scripted })
```

---

**DTO 类型（`promptPayload.ts`）：**
```ts
export type PromptFactValue = string | number | boolean | null;

export interface PromptMemory {
  id: string;
  kind: MemoryKind;
  summary: string;
  subjectIds: string[];
  perspective: MemoryPerspective;
  emotions: Partial<Record<MemoryEmotion, number>>;
  unresolved: boolean;
  createdAt: GameTime;       // 语义准确：记忆创建时间（≠ 事件发生时间）
  // 不含：ownerId, strength, retention, triggerTags, sourceEventId
}

export interface PromptEvent {
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];
  locationId?: string;
  facts: Record<string, PromptFactValue>;    // 标量，非 unknown
  // 不含：publicity, publicSalience, retention, tags
}

export interface DialogueChoiceCandidate {
  id: string;
  intent: string;
}

/** 判别联合：位分角色 vs elder（无位分） */
export type DialogueSpeakerStanding =
  | {
      kind: "ranked";
      id: string;          // rank id，如 "zhaoyi"
      name: string;        // 可读中文位分名，如 "昭仪"
      grade: string;       // 如 "正二品"
      selfRefs: CharacterRank["selfRefs"];
    }
  | {
      kind: "unranked";
      role: string;        // character.profile.role，如 "皇太后"
      selfRefs: CharacterRank["selfRefs"];
    };

export interface DialoguePromptContext {
  speakerDisplayName: string;
  rankDisplay: DialogueSpeakerStanding;      // 判别联合，不含 db.ranks 假设
  audience: DialogueAudienceContext;
  relevantMemories: PromptMemory[];
  reactionPlan?: ReactionPlan;              // LLM-3 前 undefined
  knownEvents: PromptEvent[];               // LLM-3 前 []
  allowedClaims: DialogueClaim[];           // LLM-3 前 []
  forbiddenClaims: DialogueClaim[];         // LLM-3 前 []
  choiceCandidates: DialogueChoiceCandidate[];  // LLM-2 前 []
}

export function toPromptMemory(m: MemoryEntry): PromptMemory {
  return {
    id: m.id, kind: m.kind, summary: m.summary,
    subjectIds: m.subjectIds, perspective: m.perspective,
    emotions: m.emotions, unresolved: m.unresolved,
    createdAt: m.createdAt,
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

**`assembleDialogueRequest` 内部填充 `promptContext`：**
```ts
// Elder 路径（standing 为 undefined / synthetic）
rankDisplay = { kind: "unranked", role: character.profile.role, selfRefs: contextStanding.selfRefs };

// 位分路径（standing 存在，rank 从 db.ranks 读到）
rankDisplay = { kind: "ranked", id: standing.rank, name: rank.name, grade: rank.grade, selfRefs: rank.selfRefs };

promptContext = {
  speakerDisplayName: resolveDisplayName(character, contextStanding, rankDisplay.kind === "ranked" ? rank : undefined),
  rankDisplay,
  audience: buildAudienceContext(state, db, { speakerId, targetId }),
  relevantMemories: memCtx.activatedMemories.map(toPromptMemory),
  reactionPlan: undefined,
  knownEvents: [], allowedClaims: [], forbiddenClaims: [], choiceCandidates: [],
};
```

**`buildDialoguePolicyContext` 修改（`orchestrator.ts`）：**
```ts
export function buildDialoguePolicyContext(
  db: ContentDB,
  state: GameState,
  request: DialogueRequest,
): DialoguePolicyContext {
  return {
    audience: request.promptContext.audience,    // 单一来源，与 prompt 完全一致
    beliefProjection: new GroundTruthBeliefProjection(state),
    offeredContextIds: new Set(request.speakerContext.relevantMemories.map(m => m.id)),
    now: request.time,
  };
  // 删除对 buildAudienceContext 的独立调用
}
```

注：`db` 参数可在此提交中保留签名（避免大面积调用方更新），内部不使用。

---

### T1 DialoguePromptPayload + compilePromptPayload

```ts
// src/engine/dialogue/promptPayload.ts

export interface DialogueSpeakerPayload {
  id: string;
  name: string;
  standing: DialogueSpeakerStanding;        // 判别联合（ranked | unranked）
  speechStyle: string;
  personalityTraits: string[];
  coreFacts: string[];
  voice: CharacterContent["voice"];
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
    directive?: string;                      // request.sceneDirective
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
      standing: ctx.rankDisplay,             // 直接透传判别联合
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

---

### T2 buildAnthropicToolRequest 升级 + relay schema

**`AnthropicRequestPayload.system` 类型扩展：**
```ts
system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
```

**结构（2 个固定 blocks + user message）：**
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
messages: z.array(z.strictObject({
  role: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]),
})),
```

---

### T3 `validateDialogueProviderResult`（有意调整验证顺序）

**有意行为变更：** 顺序调整为 **speaker check → claim gate → text gate**（原：claim gate → speaker check → text gate）。

**理由：** speaker 错误时 claim 不应归属该 speaker；旧顺序导致"错误 speaker 的 claim 被当成正确 speaker 的 claim 校验"。

**受影响测试（必须显式更新，不能沿用旧期望）：**
- 同时存在 wrong speaker + wrong claim 的测试：旧期望 `CLAIM_REJECTED`，新期望 `WRONG_SPEAKER`
- 更新注释说明：`// 行为变更 LLM-2: speaker 检查优先于 claim gate`

```ts
export type DialogueValidationOutcome =
  | { ok: true;  line: DialogueLine; diagnostics: DialogueValidationDiagnostics }
  | { ok: false; error: GameError;   diagnostics: DialogueValidationDiagnostics };

export function validateDialogueProviderResult(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  policy: DialoguePolicyContext,
  response: DialogueProviderResult,
): DialogueValidationOutcome
// 顺序：1. speaker check  2. claim gate  3. text gate
// 每步均将已有 findings 写入 diagnostics 再返回 ok:false
```

`produceDialogueLineWithPolicy` 包装：
```ts
const outcome = validateDialogueProviderResult(...);
if (!outcome.ok) return err(outcome.error);
```

---

### T4 Eval runner

```ts
export type EvalExecutionMode = "fixture" | "online";  // 无 "batch"
export type CheckStatus = "pass" | "fail" | "not_run";

export interface EvalExpectationFinding {
  code: "unexpected_gate_result" | "forbidden_text_present" | "required_source_not_cited";
  detail: string;
}

export interface EvalResult {
  scenarioId: string;
  runId: string;         // "${evaluationId}-r${runIndex}"
  runIndex: number;
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
  sceneDirective?: string;
  transcript?: { speaker: string; text: string }[];
  expectations?: {
    gatePass?: boolean;
    forbiddenTexts?: string[];
    requiredSourceContextIds?: string[];
  };
}
```

**Expectation prerequisite 规则（必须按此实现）：**
```ts
function evaluateExpectations(
  expectations: EvalScenario["expectations"],
  result: Pick<EvalResult, "schemaStatus" | "gateStatus" | "text">,
  diagnostics: DialogueValidationDiagnostics | undefined,
): { status: CheckStatus; findings: EvalExpectationFinding[] } {
  if (!expectations) return { status: "not_run", findings: [] };

  // prerequisite：没有有效输出时，expectation 不可判
  if (
    result.schemaStatus !== "pass" ||
    result.gateStatus === "not_run" ||
    result.text === undefined
  ) {
    return { status: "not_run", findings: [] };
  }

  const findings: EvalExpectationFinding[] = [];

  if (expectations.gatePass !== undefined) {
    const actual = result.gateStatus === "pass";
    if (actual !== expectations.gatePass)
      findings.push({ code: "unexpected_gate_result",
        detail: `expected gatePass=${expectations.gatePass}, got ${actual}` });
  }
  for (const t of expectations.forbiddenTexts ?? []) {
    if (result.text.includes(t))
      findings.push({ code: "forbidden_text_present", detail: t });
  }
  for (const id of expectations.requiredSourceContextIds ?? []) {
    const cited = diagnostics?.acceptedClaims.some(c => c.sourceContextIds.includes(id)) ?? false;
    if (!cited)
      findings.push({ code: "required_source_not_cited", detail: id });
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
}
```

**`runEvalScenario` 步骤：**
1. `fixtureBuilders[scenario.fixtureId]()` → `{ db, state }`
2. `assembleDialogueRequest(db, state, scenario.speakerId, scenario.locationId, { targetId: scenario.targetId, sceneDirective: scenario.sceneDirective, transcript: scenario.transcript })`
3. `buildDialoguePolicyContext(db, state, request)`
4. `provider.generate(request)` → 记时
5. Provider err：
   - `cause === "schema_invalid"` → `schemaStatus: "fail", gateStatus: "not_run"`
   - 其他 err → `schemaStatus: "not_run", gateStatus: "not_run"`
6. Provider ok → `validateDialogueProviderResult(...)` → `outcome`
   - `outcome.ok` → `schemaStatus: "pass", gateStatus: "pass"，text: outcome.line.text`
   - `!outcome.ok` → `schemaStatus: "pass", gateStatus: "fail"，text: undefined`
   - 两者均有 `outcome.diagnostics`
7. `evaluateExpectations(...)` → `expectationStatus/Findings`
8. 返回完整 `EvalResult`

---

### T5 Fixture builders + 场景集（≥20 条）

```ts
// tests/eval/fixtures/builders.ts
export const fixtureBuilders: Record<string, () => { db: ContentDB; state: GameState }> = {
  base_palace: ...,
  consort_with_grievance: ...,
  demoted_consort: ...,
};
```

场景覆盖：
- ≥4 个不同 speakerId（先 grep `src/content/*.json` 或 `public/` 确认存在的 id）
- ≥3 个不同 fixtureId
- **≥5 条含 `sceneDirective`**（如 `"请安"`、`"回应降位"`、`"试探皇帝是否还记得旧事"`）
- ≥5 条含 transcript（测试 recentLines 截取）
- ≥5 条 `expectations.gatePass: true`
- ≥4 条 `expectations.forbiddenTexts`
- ≥2 条含记忆的 fixtureId + `requiredSourceContextIds`（sourceContextId 来自 builder 注入的记忆 id）

---

### T6 CLI 工具链

```json
"eval:run": "tsx tools/eval-run.ts",
"eval:score": "tsx tools/eval-score.ts",
"eval:export": "tsx tools/eval-export.ts"
```

**eval-run.ts CLI（删除 `--mode`，由 `--provider` 推导）：**
```
--provider anthropic|fixture
          anthropic → mode=online（需 ANTHROPIC_API_KEY）
          fixture   → mode=fixture（不调 API）
--model <modelId>   (anthropic 时必填)
--runs N            (默认 1)
--scenarios <path>
--output <path>     (含时间戳)
```

`evaluationId` 在 CLI 入口生成一次：
```ts
const evaluationId = `${model ?? "fixture"}-${Date.now()}`;
// 每个 scenario 的每次 run：
const runId = `${evaluationId}-r${runIndex}`;
```

**eval-score.ts：**
```
Scenarios:       20 (runs: 3 → 60 results)
Schema pass:     58/60 (97%)
Gate pass:       52/60 (87%)
Expectation:     48/60 (80%)
Avg input tok:   450
Avg out tok:     92
Cache hits:      39/60 (65%)
```

**eval-export.ts：**
- `--input <pathA> <pathB>`（两个 run JSONL，不同模型）
- 按 `scenarioId + runIndex` 配对
- `--seed N`（默认 42）确定性打乱 A/B
- `blind-samples.tsv`（含 `sceneDirective` 列，无模型名）
- `blind-key.tsv`（映射 `sampleId → candidateA/B_runId + scenarioId + runIndex`）

---

## Tasks

### Task 0: assembleDialogueRequest options + DTO + promptContext + buildDialoguePolicyContext

**文件：**
- `src/engine/dialogue/promptPayload.ts`（新建：`PromptFactValue`, `PromptMemory`, `PromptEvent`, `DialogueChoiceCandidate`, `DialogueSpeakerStanding`, `DialoguePromptContext`, `toPromptMemory`, `DialogueAssemblyOptions`）
- `src/engine/dialogue/types.ts`（修改：追加 `promptContext`；删除 `rawDialogueResponseSchema` 第 42-56 行）
- `src/engine/dialogue/orchestrator.ts`（修改：`assembleDialogueRequest` 签名 + 内部 + 填 `promptContext`；`buildDialoguePolicyContext` 改用 `request.promptContext.audience`）
- 更新所有现有调用方（将第 5 个位置参数 `scripted?` 改为 `options.scripted`）
- `tests/dialogue/promptPayload.test.ts`（新建）
- 更新受影响的 assembleDialogueRequest 测试（targetId 新默认行为）

**测试（TDD）：**
```ts
describe("DialogueAssemblyOptions", () => {
  it("targetId defaults to 'player' when not provided")
  it("targetId propagates to request.targetId, memoryContext.audienceId, and audience.targetId")
  it("sceneDirective propagates to request.sceneDirective")
  it("transcript propagates to request.transcript")
  it("scripted propagates to request.scripted")
})
describe("toPromptMemory", () => {
  it("maps id/kind/summary/subjectIds/perspective/emotions/unresolved")
  it("createdAt = m.createdAt (not occurredAt)")
  it("result has no ownerId field")
  it("result has no strength/retention/triggerTags fields")
})
describe("assembleDialogueRequest promptContext", () => {
  it("ranked speaker: rankDisplay.kind === 'ranked', has name and grade")
  it("elder speaker: rankDisplay.kind === 'unranked', has role (not name/grade)")
  it("speakerDisplayName = resolveDisplayName result")
  it("audience = buildAudienceContext(state, db, {speakerId, targetId})")
  it("relevantMemories is PromptMemory[] (no ownerId)")
  it("knownEvents = [], allowedClaims = [], forbiddenClaims = []")
  it("reactionPlan = undefined, choiceCandidates = []")
})
describe("buildDialoguePolicyContext", () => {
  it("audience === request.promptContext.audience (same object, not rebuilt)")
})
```

**验收：**
- Elder speaker 不触发 `BAD_SPEAKER`，`rankDisplay.kind === "unranked"`
- `buildDialoguePolicyContext` 不调 `buildAudienceContext`
- 所有现有调用方编译通过（options 对象形式）
- `rawDialogueResponseSchema` 已删，无 unused import
- 现有测试全绿

---

### Task 1: `DialoguePromptPayload` + `compilePromptPayload`

**文件：**
- `src/engine/dialogue/promptPayload.ts`（续 T0）
- `tests/dialogue/promptPayload.test.ts`（续 T0）

**测试（TDD）：**
```ts
describe("compilePromptPayload", () => {
  it("speaker.id = request.speakerId")
  it("speaker.name = promptContext.speakerDisplayName")
  it("speaker.standing passes through promptContext.rankDisplay as-is")
  it("ranked speaker standing has kind=ranked, name, grade, selfRefs")
  it("elder speaker standing has kind=unranked, role, selfRefs")
  it("speaker.speechStyle = profile.speechStyle (not voice.register)")
  it("speaker.personalityTraits = profile.personalityTraits")
  it("speaker.coreFacts = profile.coreFacts")
  it("currentScene.directive = request.sceneDirective when present")
  it("currentScene has no directive key when sceneDirective absent")
  it("currentScene.recentLines = last 6 of transcript")
  it("result contains no ownerId/strength/retention")
})
```

---

### Task 2: 升级 `buildAnthropicToolRequest` + relay `cache_control` schema

**文件：**
- `src/engine/dialogue/providers/anthropicProvider.ts`（修改）
- `server/llm/anthropicRelay.ts`（修改）
- `tests/server/anthropicRelay.test.ts`（修改）

**测试新增：**
```ts
// relay
it("forwards cache_control blocks to transport without stripping")
it("request without cache_control is valid")

// provider
it("system has exactly 2 blocks")
it("all system blocks have cache_control.type === ephemeral")
it("system.length stays 2 regardless of request content")
it("messages[0].content includes currentScene.directive when sceneDirective present")
it("messages[0].content has no ownerId/strength")
it("capabilities.promptCaching === true")
```

---

### Task 3: 提取 `validateDialogueProviderResult`（有意调整验证顺序）

**文件：**
- `src/engine/dialogue/orchestrator.ts`（修改）
- `tests/dialogue/orchestrator.test.ts`（修改：更新行为变更处）

**顺序：speaker check → claim gate → text gate**（有意变更，不能声称行为不变）

受影响测试须显式更新（旧：wrong speaker + wrong claim → `CLAIM_REJECTED`；新：`WRONG_SPEAKER`），并加注释：
```ts
// LLM-2: speaker check 优先于 claim gate; 见 docs/superpowers/plans/2026-06-22-llm-2-prompt-compiler-eval.md T3
```

**新增测试：**
```ts
describe("validateDialogueProviderResult", () => {
  it("ok=true: returns line + non-empty diagnostics")
  it("ok=false speaker mismatch: error=WRONG_SPEAKER, diagnostics present (claimFindings may be empty)")
  it("ok=false wrong speaker + wrong claim: WRONG_SPEAKER (not CLAIM_REJECTED) — behavior change LLM-2")
  it("ok=false claim gate rejects: claimFindings in diagnostics, textFindings=[](text gate skipped)")
  it("ok=false text gate rejects: textFindings in diagnostics")
  it("diagnostics.acceptedClaims present even on ok=false")
})
```

---

### Task 4: Eval runner

**文件：**
- `src/engine/dialogue/eval/types.ts`（新建）
- `src/engine/dialogue/eval/evalRunner.ts`（新建，含 `evaluateExpectations` 私有函数）
- `tests/dialogue/eval/evalRunner.test.ts`（新建）

**CLI mode 设计：**
- TypeScript 类型 `EvalExecutionMode = "fixture" | "online"`（无 `"batch"`）
- CLI parser 遇到未知 `--provider` 值 → `console.error(...); process.exit(1)`

**测试（全 mock provider）：**
```ts
describe("runEvalScenario", () => {
  it("pass path: gateStatus=pass, expectationStatus=pass")
  it("gateStatus=fail when validation rejects; diagnostics.textFindings present")
  it("gateStatus=not_run when provider returns transport error")
  it("schemaStatus=fail when provider returns schema_invalid")
  it("expectationStatus=not_run when provider fails (prerequisite not met)")
  it("expectationStatus=not_run when gateStatus=not_run (prerequisite not met)")
  it("expectationStatus=fail when gatePass=true but gate failed")
  it("expectationStatus=fail when forbiddenText found in text")
  it("expectationStatus=not_run when no expectations defined")
  it("sceneDirective passed to assembleDialogueRequest")
  it("runIndex correctly set")
})
describe("evaluateExpectations", () => {
  it("not_run when schemaStatus !== pass")
  it("not_run when gateStatus === not_run")
  it("not_run when text === undefined")
  it("pass when all expectations met")
  it("fail on unexpected_gate_result")
  it("fail on forbidden_text_present")
  it("fail on required_source_not_cited")
})
```

---

### Task 5: Fixture builders + 黄金场景集（≥20 条）

**文件：**
- `tests/eval/fixtures/builders.ts`（新建）
- `tests/eval/golden/scenarios.jsonl`（新建）

（先 grep content JSON 确认有效 speakerId / locationId，再写场景。）

---

### Task 6: eval:run + eval:score + 盲评导出

**文件：**
- `tools/eval-run.ts`（新建）
- `tools/eval-score.ts`（新建）
- `tools/eval-export.ts`（新建）
- `src/engine/dialogue/eval/scoring.ts`（新建，纯函数）
- `package.json`（加 3 个 scripts）

**scoring.ts vitest 测试：**
```ts
describe("scoreResults", () => {
  it("schema pass = pass / (pass+fail), not_run excluded from denominator")
  it("gate pass same logic")
  it("expectation pass same logic")
  it("cache hit = cacheReadTokens > 0 比例")
  it("avg tokens only from results with usage")
  it("empty input returns zeros")
})
```

---

## 执行顺序

```
T0 (assembleDialogueRequest options + DTO + promptContext + buildDialoguePolicyContext 单一来源)
  → T1 (compiler，含 standing 判别联合 + sceneDirective)
  → T2 (caching + relay)    ← 依赖 T1 的 compilePromptPayload
    T3 (shared pipeline)    ← 不依赖 T2，可与 T2 并行
      → T4 (eval runner)    ← 依赖 T3 的 validateDialogueProviderResult
         → T5 (fixtures)
            → T6 (CLI tools)
```

---

## 验收清单

- [ ] `assembleDialogueRequest(db, state, speakerId, locationId, options?)` — 末位为 options 对象
- [ ] `targetId` 同时写入 `request.targetId`、`memoryContext.audienceId`、`buildAudienceContext`
- [ ] Elder speaker `rankDisplay.kind === "unranked"`（不读 `db.ranks["__elder__"]`）
- [ ] `buildDialoguePolicyContext` 用 `request.promptContext.audience`（不调 `buildAudienceContext`）
- [ ] `compilePromptPayload(request)` — 零额外参数；`speaker.standing` 是判别联合
- [ ] `currentScene.directive` 来自 `request.sceneDirective`（缺省时无 key）
- [ ] `PromptMemory.createdAt`（非 `occurredAt`），无 `ownerId/strength/retention`（编译期）
- [ ] `PromptEvent.facts: Record<string, PromptFactValue>`（非 `unknown`）
- [ ] `system[]` 有 2 个 blocks，全带 `cache_control`；`messages[0].content` 含 payload
- [ ] Relay schema 含 `cache_control? optional`；relay 测试断言透传
- [ ] `validateDialogueProviderResult` 顺序：speaker → claim → text；`ok:false` 也含 diagnostics
- [ ] 旧 "wrong speaker + wrong claim → CLAIM_REJECTED" 测试已更新并注释
- [ ] `EvalExecutionMode = "fixture" | "online"`（无 `"batch"` 类型）；CLI 遇未知 provider 报错退出
- [ ] `evaluationId` 一次 CLI 运行生成一次；`runId = "${evaluationId}-r${runIndex}"`
- [ ] `evaluateExpectations` prerequisite：schemaStatus≠pass 或 gateStatus=not_run 或 text=undefined → `not_run`
- [ ] ≥5 个场景含 `sceneDirective`
- [ ] `blind-samples.tsv` 无模型名；`blind-key.tsv` 有映射；按 `scenarioId+runIndex` 配对
- [ ] `npm run typecheck` clean（client + server）
- [ ] `npx vitest run` 全绿（新增约 55+ tests）
- [ ] `npx vite build` 成功
- [ ] `rawDialogueResponseSchema` 已删除

---

## 进度账本（执行期填写）

Branch: feat/llm-2-prompt-compiler  
Worktree: .worktrees/llm-2  
Base (branch start): bc6b12c

| Task | Status | Commits | Notes |
|------|--------|---------|-------|
| T0   |        |         |       |
| T1   |        |         |       |
| T2   |        |         |       |
| T3   |        |         |       |
| T4   |        |         |       |
| T5   |        |         |       |
| T6   |        |         |       |
