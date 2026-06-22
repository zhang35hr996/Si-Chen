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
- 固定前缀（可缓存）：`WORLD_RULES_TEXT`（12 条最小契约） + `renderEtiquetteBlock`（称谓 + 禁词）→ `cache_control: { type: "ephemeral" }`
- 动态后缀（不缓存）：角色·记忆·场景 → **只放 `messages[0].content`，不放 system**
- `currentScene.directive` 接入 `request.sceneDirective`
- Relay schema 支持并透传 `cache_control`
- Eval：fixture provider 可配置确定性响应（含 claims / 错误 speaker）；`result.text` 保存模型原始输出（gate 拒绝时也保留）
- 不实现：batch（LLM-2b）；reactionPlan live planner（LLM-3）；assembleClaims 升级（LLM-3）；修复重试（LLM-4）；streaming

## 非目标

- 让模型选 choice 文本（仍 authored）
- knownEvents 进 DialogueRequest（LLM-3）
- AuthorizedClaim / assembleClaims 升级（LLM-3）
- 真实 Anthropic Batch API（LLM-2b）
- 重试 / fallback（LLM-4）

---

## Global Constraints

1. **`assembleDialogueRequest` 末位改为 `options: DialogueAssemblyOptions = {}`。** `targetId` 同时写入 `request.targetId`、`memoryContext.audienceId`、`buildAudienceContext` 的 targetId — 三处同源。`DialogueAssemblyOptions` 放在 `types.ts`（不放 `promptPayload.ts`）。
2. **更新所有直接构造 `DialogueRequest` 的地方（测试 / smoke / fixture）。** 搜索 `: DialogueRequest =`、`as DialogueRequest`、`satisfies DialogueRequest`、`makeRequest(` — 不只搜 `assembleDialogueRequest(`。
3. **Elder `rankDisplay.kind === "unranked"`，不读 `db.ranks["__elder__"]`。** `DialogueSpeakerStanding` 是判别联合。
4. **`buildDialoguePolicyContext` 的 audience 来自 `request.promptContext.audience`，不独立调用 `buildAudienceContext`。**
5. **`compilePromptPayload(request)` 零额外参数。**
6. **`system[]` 只放 2 个固定 blocks（都带 `cache_control`）；动态内容只在 `messages[0].content`。**
7. **Relay schema 透传 `cache_control`（不被 `.strict()` 剥离）。**
8. **`WORLD_RULES_TEXT` 必须包含下方第 3 节定义的 12 条规则，并有快照测试。** `renderEtiquetteBlock` 有快照测试，验证包含 allowedTerms / forbiddenTerms / rankAddressRules / speaker selfRefs / audience targetRole。
9. **`validateDialogueProviderResult` 返回 `DialogueValidationOutcome`，始终携带 diagnostics（ok:false 也含）。** 顺序：speaker check → claim gate → text gate（有意变更）。
10. **`EvalResult.text` 是模型原始生成文本（无论 gate 是否通过均保留）；`servedText?` 只在 `outcome.ok` 时赋值。** Expectation prerequisite 改为：`schemaStatus !== "pass"` 或 `gateStatus === "not_run"` 或 `text === undefined` → `expectationStatus: "not_run"`。Gate fail 时有 text，expectation 可正常评估。
11. **Fixture mode 使用 `EvalFixtureDefinition`，不复用生产 `mockProvider`。** Fixture response 可配置 `proposedClaims`、`speakerIdOverride`、`expression`，覆盖 gate pass / fail / wrong speaker / claim reject 场景。
12. **`EvalExecutionMode = "fixture" | "online"`，TypeScript 无 `"batch"` 类型。** CLI 由 `--provider` 推导 mode，无 `--mode` 参数。
13. **`evaluationId` 在 CLI 入口生成一次；`runId = "${evaluationId}-r${runIndex}"`。**
14. **Expectation prerequisite：** `schemaStatus !== "pass"` 或 `gateStatus === "not_run"` 或 `text === undefined` → `not_run`。
15. **`PromptMemory.createdAt`（非 `occurredAt`）；`PromptEvent.facts: Record<string, PromptFactValue>`（非 `unknown`）。**
16. **Prompt caching 验收：** `capabilities.promptCaching: true` 只表示 adapter 支持注解；`cacheReadTokens === 0` 不自动判定失败（Sonnet 4.6 阈值 1024 tokens）；不填充无意义文本。
17. **CI 不调真实 API。** Fixture mode 跑 CI；在线 eval 手动。
18. **`rawDialogueResponseSchema`（`types.ts:42-56`）在 T0 删除**（零消费者）。

---

## 关键接口（任务间约定）

### §1 assembleDialogueRequest 选项扩展（T0）

```ts
// src/engine/dialogue/types.ts（不在 promptPayload.ts）
export interface DialogueAssemblyOptions {
  targetId?: string;                           // 默认 "player"
  sceneDirective?: string;
  transcript?: { speaker: string; text: string }[];  // 默认 []
  scripted?: { text: string; expression?: string };
}

// 新签名
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
// targetId 同时用于：request.targetId、memoryContext.audienceId、buildAudienceContext.targetId
```

### §2 DTO 类型（T0，在 promptPayload.ts）

```ts
export type PromptFactValue = string | number | boolean | null;

export interface PromptMemory {
  id: string; kind: MemoryKind; summary: string; subjectIds: string[];
  perspective: MemoryPerspective; emotions: Partial<Record<MemoryEmotion, number>>;
  unresolved: boolean; createdAt: GameTime;
  // 不含：ownerId, strength, retention, triggerTags, sourceEventId
}

export interface PromptEvent {
  id: string; type: CourtEventType; occurredAt: GameTime;
  participants: CourtEventParticipant[]; locationId?: string;
  facts: Record<string, PromptFactValue>;  // 不含：publicity, publicSalience, retention, tags
}

export interface DialogueChoiceCandidate { id: string; intent: string; }

export type DialogueSpeakerStanding =
  | { kind: "ranked"; id: string; name: string; grade: string; selfRefs: CharacterRank["selfRefs"] }
  | { kind: "unranked"; role: string; selfRefs: CharacterRank["selfRefs"] };

export interface DialoguePromptContext {
  speakerDisplayName: string;
  rankDisplay: DialogueSpeakerStanding;
  audience: DialogueAudienceContext;
  relevantMemories: PromptMemory[];
  reactionPlan?: ReactionPlan;           // LLM-3 前 undefined
  knownEvents: PromptEvent[];            // LLM-3 前 []
  allowedClaims: DialogueClaim[];        // LLM-3 前 []
  forbiddenClaims: DialogueClaim[];      // LLM-3 前 []
  choiceCandidates: DialogueChoiceCandidate[];  // LLM-2 前 []
}

export function toPromptMemory(m: MemoryEntry): PromptMemory {
  return { id: m.id, kind: m.kind, summary: m.summary, subjectIds: m.subjectIds,
           perspective: m.perspective, emotions: m.emotions,
           unresolved: m.unresolved, createdAt: m.createdAt };
}
```

**`DialogueRequest` 扩展（`types.ts`）：**
```ts
export interface DialogueRequest {
  // ... 现有字段 ...
  promptContext: DialoguePromptContext;
}
```

### §3 WORLD_RULES_TEXT 最小契约（T2 必须包含全部 12 条）

```ts
// src/engine/dialogue/providers/anthropicProvider.ts
const WORLD_RULES_TEXT = `
你是一位宫廷叙事引擎，负责生成单个角色在一轮对话中的中文台词。

1. 只生成 speaker 的本轮台词，严禁替玩家发言或叙述引擎行为。
2. 严格遵守 currentScene.directive 指定的本轮行为目标，不得自行改变。
3. 使用 speaker.standing.selfRefs 中适合当前场合的自称（面向皇帝用 toPlayer；正式场合用 formal）。
4. 对皇帝称"陛下"；不得使用 etiquette 中 forbiddenTerms 所列称谓。
5. 不得在台词中透出 JSON 字段名、规则说明或内部 ID。
6. 不得凭空引入 payload 未提供的事实或事件。
7. proposedClaims 只记录台词中明确表达的事实，不填隐含信息。
8. 引用 relevantMemories 中记忆的 claim 必须填写对应 memory id 在 sourceContextIds。
9. 不确定信息不得用断言语气（"确实"、"一定"），应用 "听说"、"好像" 等。
10. forbiddenClaims 中的事实内容一律不在台词中出现。
11. allowedClaims 为空不代表禁止问候、情绪表达或主观感受。
12. 台词长度适中，符合人物位分与场景私密度（currentScene.audience.privacy）。
`.trim();
```

`renderEtiquetteBlock(etiquette: DialogueRequest["etiquette"])` 必须渲染：
- `allowedTerms`（允许称谓列表）
- `forbiddenTerms`（禁用称谓列表）
- `addressRules`（每个 rank 的被称方式）
- **调用时传入 speaker selfRefs 和 audience targetRole**（compiler 先 `compilePromptPayload` 拿到 payload，然后 `buildAnthropicToolRequest` 用 payload 里的信息渲染 etiquette block）

实际上，`renderEtiquetteBlock` 只需要 `request.etiquette` + `payload.speaker.standing.selfRefs` + `payload.audience.targetRole`。签名：
```ts
function renderEtiquetteBlock(
  etiquette: DialogueRequest["etiquette"],
  speakerSelfRefs: CharacterRank["selfRefs"],
  audienceRole: AudienceRole,
): string
```

### §4 DialoguePromptPayload + compilePromptPayload（T1）

```ts
export interface DialogueSpeakerPayload {
  id: string; name: string;
  standing: DialogueSpeakerStanding;
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
    directive?: string;
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
      standing: ctx.rankDisplay,
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

### §5 Validation outcome（T3）

```ts
export type DialogueValidationOutcome =
  | { ok: true;  line: DialogueLine; diagnostics: DialogueValidationDiagnostics }
  | { ok: false; error: GameError;   diagnostics: DialogueValidationDiagnostics };

// 顺序：speaker check → claim gate → text gate（有意变更）
export function validateDialogueProviderResult(
  db, provider, request, policy, response,
): DialogueValidationOutcome
```

### §6 Fixture provider 接口（T4）

```ts
// src/engine/dialogue/eval/fixtureProvider.ts

export interface EvalFixtureResponse {
  text: string;
  proposedClaims?: ProposedClaim[];
  speakerIdOverride?: string;    // 测试 wrong-speaker 路径
  expression?: string;
}

export interface EvalFixtureDefinition {
  buildState(): { db: ContentDB; state: GameState };
  responseFor(scenario: EvalScenario, request: DialogueRequest): EvalFixtureResponse;
}

export function createEvalFixtureProvider(
  response: EvalFixtureResponse,
  speakerId: string,
): DialogueProvider
// provider.generate 返回固定 ok(DialogueProviderResult)：
//   speaker = speakerIdOverride ?? speakerId
//   text = response.text
//   proposedClaims = response.proposedClaims ?? []
//   choices = []
//   usage = undefined
```

**`EvalFixtureDefinition` 位置：** `tests/eval/fixtures/` 目录，不在 `src/`。

**`fixtureBuilders` 同时提供 `buildState` 和 `responseFor`：**
```ts
// tests/eval/fixtures/builders.ts
export const evalFixtures: Record<string, EvalFixtureDefinition> = {
  base_palace: {
    buildState: () => ({ db: buildTestDb(), state: buildInitialGameState() }),
    responseFor: (scenario, _request) => ({
      text: scenario.sceneDirective
        ? `侍身明白，${scenario.sceneDirective}。`
        : "侍身见过陛下。",
    }),
  },
  consort_with_grievance: {
    buildState: () => ({ ... }), // 注入 grievance 记忆，记忆有已知 id
    responseFor: (scenario, request) => ({
      text: "侍身记得旧事，心中难免感怀。",
      proposedClaims: [{
        claim: { id: "c1", predicate: "alive", subjectId: "player",
                  modality: "assert", object: true },
        sourceContextIds: [request.speakerContext.relevantMemories[0]?.id ?? ""],
        modality: "assert", certainty: 90,
      }],
    }),
  },
  demoted_consort: {
    buildState: () => ({ ... }),
    responseFor: () => ({
      text: "侍身领命，不敢有怨。",
    }),
  },
  wrong_speaker_test: {
    buildState: () => ({ ... }),
    responseFor: (_s, _r) => ({
      text: "此乃测试。",
      speakerIdOverride: "wrong_speaker_id",
    }),
  },
  gate_reject_test: {
    buildState: () => ({ ... }),
    responseFor: () => ({
      text: "先生请安。",   // 含禁词，会被 text gate 拒绝
    }),
  },
};
```

### §7 EvalResult — text 保留原始输出（T4）

```ts
export interface EvalResult {
  scenarioId: string;
  runId: string;             // "${evaluationId}-r${runIndex}"
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
  text?: string;             // 模型原始生成文本（gate 拒绝时也保留）
  servedText?: string;       // 只在 outcome.ok 时赋值（最终可服务台词）
  durationMs: number;
}
```

**`runEvalScenario` 中的 text 赋值：**
```ts
// provider 成功后立即保存，不等 validation
const generatedText = response.text;    // DialogueProviderResult.text（parsed 后）

// ... 调用 validateDialogueProviderResult ...

result.text = generatedText;            // 始终赋值
if (outcome.ok) {
  result.servedText = outcome.line.text;
}
```

**Expectation prerequisite（更新后）：**
```ts
if (
  result.schemaStatus !== "pass" ||
  result.gateStatus === "not_run" ||
  result.text === undefined
) {
  return { status: "not_run", findings: [] };
}
// gate fail 时 text 有值，可评估 gatePass:false / forbiddenTexts / sourceContextIds
```

### §8 EvalScenario

```ts
export interface EvalScenario {
  id: string;
  fixtureId: string;         // 索引 evalFixtures
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

---

## Tasks

### Task 0: assembleDialogueRequest options + DTO + promptContext + buildDialoguePolicyContext

**文件：**
- `src/engine/dialogue/types.ts`（修改：追加 `DialogueAssemblyOptions`、`promptContext`；删除 `rawDialogueResponseSchema` 第 42-56 行；更新 `assembleDialogueRequest` 签名）
- `src/engine/dialogue/promptPayload.ts`（新建：PromptFactValue / PromptMemory / PromptEvent / DialogueChoiceCandidate / DialogueSpeakerStanding / DialoguePromptContext / toPromptMemory）
- `src/engine/dialogue/orchestrator.ts`（修改：`assembleDialogueRequest` 内部 + 填 `promptContext`；`buildDialoguePolicyContext` 用 `request.promptContext.audience`）
- 所有现有 `assembleDialogueRequest(db, state, id, loc, scripted?)` 调用方 → 改为 `options` 对象形式
- 所有直接构造 `DialogueRequest` 的文件（grep `: DialogueRequest =` / `as DialogueRequest` / `satisfies DialogueRequest` / `makeRequest(`）→ 补 `promptContext`

**测试（TDD）：**
```ts
describe("DialogueAssemblyOptions", () => {
  it("targetId defaults to 'player' when not provided")
  it("targetId propagates to request.targetId, memoryContext.audienceId, and audience.targetId (same value)")
  it("sceneDirective propagates to request.sceneDirective")
  it("transcript propagates to request.transcript")
  it("scripted propagates to request.scripted")
})
describe("toPromptMemory", () => {
  it("maps id/kind/summary/subjectIds/perspective/emotions/unresolved")
  it("createdAt = m.createdAt (not occurredAt)")
  it("result has no ownerId field (compile-time and runtime)")
  it("result has no strength/retention/triggerTags")
})
describe("assembleDialogueRequest promptContext", () => {
  it("ranked speaker: rankDisplay.kind === 'ranked', has name and grade from db.ranks")
  it("elder speaker: rankDisplay.kind === 'unranked', has role = character.profile.role")
  it("speakerDisplayName = resolveDisplayName result")
  it("audience = buildAudienceContext(state, db, {speakerId, targetId})")
  it("relevantMemories is PromptMemory[] (no ownerId)")
  it("knownEvents = [], allowedClaims = [], forbiddenClaims = []")
  it("reactionPlan = undefined, choiceCandidates = []")
})
describe("buildDialoguePolicyContext", () => {
  it("audience === request.promptContext.audience (same object reference)")
})
```

**验收：**
- Elder 不触发 `BAD_SPEAKER`，`rankDisplay.kind === "unranked"`
- `buildDialoguePolicyContext` 不调 `buildAudienceContext`（可 grep 验证）
- `rawDialogueResponseSchema` 已删，无 unused import
- 所有调用方编译通过
- 现有测试全绿

---

### Task 1: `DialoguePromptPayload` + `compilePromptPayload`

**文件：**
- `src/engine/dialogue/promptPayload.ts`（续 T0：加 `DialogueSpeakerPayload`, `DialoguePromptPayload`, `compilePromptPayload`）
- `tests/dialogue/promptPayload.test.ts`（续 T0）

**测试（TDD）：**
```ts
describe("compilePromptPayload", () => {
  it("speaker.id = request.speakerId")
  it("speaker.name = promptContext.speakerDisplayName")
  it("ranked: speaker.standing has kind=ranked, name, grade, selfRefs")
  it("elder: speaker.standing has kind=unranked, role, selfRefs")
  it("speaker.speechStyle = profile.speechStyle (not voice.register)")
  it("speaker.personalityTraits = profile.personalityTraits (array, not string)")
  it("speaker.coreFacts = profile.coreFacts")
  it("currentScene.directive present when sceneDirective set")
  it("currentScene has no directive key when sceneDirective absent")
  it("currentScene.recentLines = last 6 of transcript (slice(-6))")
  it("result has no ownerId/strength/retention")
  it("result has no GameState/ContentDB reference")
})
```

---

### Task 2: 升级 `buildAnthropicToolRequest` + WORLD_RULES_TEXT + relay schema

**文件：**
- `src/engine/dialogue/providers/anthropicProvider.ts`（修改）
- `server/llm/anthropicRelay.ts`（修改）
- `tests/server/anthropicRelay.test.ts`（修改）
- `tests/dialogue/anthropicProvider.test.ts`（新建或修改）

**WORLD_RULES_TEXT 必须包含 §3 定义的全部 12 条规则。** 快照测试锁定内容，防止意外截断：
```ts
it("WORLD_RULES_TEXT contains all 12 rule markers", () => {
  for (let i = 1; i <= 12; i++) {
    expect(WORLD_RULES_TEXT).toContain(`${i}.`);
  }
});
```

**`renderEtiquetteBlock` 快照测试：** 验证输出中包含：
```ts
it("renderEtiquetteBlock includes allowedTerms", ...)
it("renderEtiquetteBlock includes forbiddenTerms", ...)
it("renderEtiquetteBlock includes at least one rank address rule", ...)
it("renderEtiquetteBlock includes speaker selfRefs.toPlayer", ...)
it("renderEtiquetteBlock includes audienceRole", ...)
```

**relay 测试新增：**
```ts
it("forwards cache_control to transport without stripping")
it("request without cache_control is valid")
```

**provider 测试新增：**
```ts
it("system has exactly 2 blocks")
it("all system blocks have cache_control.type === ephemeral")
it("system.length stays 2 regardless of request content")
it("messages[0].content includes speaker.standing.kind")
it("messages[0].content includes currentScene.directive when sceneDirective set")
it("messages[0].content has no ownerId/strength")
it("capabilities.promptCaching === true")
```

---

### Task 3: 提取 `validateDialogueProviderResult`（有意调整验证顺序）

**文件：**
- `src/engine/dialogue/orchestrator.ts`（修改）
- `tests/dialogue/orchestrator.test.ts`（修改）

**顺序变更（有意）：** speaker check → claim gate → text gate

**受影响测试必须显式更新，加注释：**
```ts
// 行为变更 LLM-2：speaker check 优先于 claim gate
// 旧期望：CLAIM_REJECTED；新期望：WRONG_SPEAKER
```

**新增测试：**
```ts
describe("validateDialogueProviderResult", () => {
  it("ok=true: returns line + diagnostics with claimFindings/textFindings")
  it("ok=false speaker mismatch: error=WRONG_SPEAKER, diagnostics.claimFindings may be empty")
  it("ok=false wrong speaker + wrong claim: WRONG_SPEAKER (not CLAIM_REJECTED) — LLM-2 behavior change")
  it("ok=false claim gate rejects: error=CLAIM_REJECTED, claimFindings non-empty in diagnostics")
  it("ok=false text gate rejects: error=GATE_REJECTED, textFindings non-empty in diagnostics")
  it("diagnostics.acceptedClaims present on ok=false text gate path")
})
```

---

### Task 4: Eval runner + fixture provider

**文件：**
- `src/engine/dialogue/eval/types.ts`（新建）
- `src/engine/dialogue/eval/evalRunner.ts`（新建，含 `evaluateExpectations`）
- `src/engine/dialogue/eval/fixtureProvider.ts`（新建）
- `tests/dialogue/eval/evalRunner.test.ts`（新建）
- `tests/dialogue/eval/fixtureProvider.test.ts`（新建）

**`createEvalFixtureProvider` 测试：**
```ts
describe("createEvalFixtureProvider", () => {
  it("returns ok with text = response.text")
  it("returns ok with speaker = speakerId when no speakerIdOverride")
  it("returns ok with speaker = speakerIdOverride when set (enables wrong-speaker test)")
  it("returns ok with proposedClaims when set")
  it("returns ok with empty proposedClaims when not set")
  it("capabilities.strictTools = true, kind = generative")
})
```

**`runEvalScenario` 测试：**
```ts
describe("runEvalScenario", () => {
  it("pass path: schemaStatus=pass, gateStatus=pass, expectationStatus=pass")
  it("result.text = model raw output even when gate fails")
  it("result.servedText set only when outcome.ok")
  it("gateStatus=fail on text gate reject; result.text preserved")
  it("gateStatus=not_run when provider returns transport error")
  it("schemaStatus=fail when provider returns schema_invalid")
  it("expectationStatus=not_run when schemaStatus !== pass")
  it("expectationStatus=not_run when gateStatus = not_run (transport error)")
  it("expectationStatus=fail when gatePass=true but gate failed (text preserved, gate=fail)")
  it("expectationStatus=fail when forbiddenText found in result.text")
  it("expectationStatus=pass when gatePass=false and gate actually failed")
  it("sceneDirective passed to assembleDialogueRequest via options")
  it("wrong speaker fixture: gateStatus=fail, WRONG_SPEAKER error")
  it("requiredSourceContextIds: fail when claim not in acceptedClaims.sourceContextIds")
  it("requiredSourceContextIds: pass when claim cited in fixture proposedClaims")
})
describe("evaluateExpectations", () => {
  it("not_run when schemaStatus !== pass")
  it("not_run when gateStatus === not_run")
  it("not_run when text === undefined")
  it("not_run when no expectations defined")
  it("pass when all expectations met")
  it("fail on unexpected_gate_result (gatePass=true, gate=fail)")
  it("fail on unexpected_gate_result (gatePass=false, gate=pass)")
  it("fail on forbidden_text_present")
  it("fail on required_source_not_cited")
  it("multiple failures all recorded in findings")
})
```

---

### Task 5: Fixture builders + 黄金场景集（≥20 条）

**文件：**
- `tests/eval/fixtures/builders.ts`（新建，实现 `evalFixtures` map，含 §6 列出的 5+ fixture）
- `tests/eval/golden/scenarios.jsonl`（新建，≥20 条）

**Fixture builders 覆盖（必须包含用于各类 gate 测试的 fixture）：**
- `base_palace`：正常通过（responseFor 返回合规台词）
- `consort_with_grievance`：含注入记忆，`responseFor` 含 `proposedClaims`（测试 requiredSourceContextIds）
- `demoted_consort`：降位场景，合规台词
- `wrong_speaker_test`：`responseFor` 返回 `speakerIdOverride`（测试 WRONG_SPEAKER）
- `gate_reject_test`：`responseFor` 返回含禁词的台词（测试 text gate reject + text 保留）

**场景集覆盖：**
- ≥4 个不同 speakerId（先 grep content JSON 确认有效 id）
- ≥5 个不同 fixtureId（含测试 gate fail 和 wrong speaker 的 fixture）
- ≥5 条含 `sceneDirective`
- ≥5 条含 transcript
- ≥5 条 `expectations.gatePass: true`（使用正常 fixture）
- ≥2 条 `expectations.gatePass: false`（使用 gate_reject_test fixture）
- ≥4 条 `expectations.forbiddenTexts`
- ≥2 条 `expectations.requiredSourceContextIds`（使用 consort_with_grievance fixture 注入的记忆 id）

---

### Task 6: eval:run + eval:score + 盲评导出

**文件：**
- `tools/eval-run.ts`（新建）
- `tools/eval-score.ts`（新建）
- `tools/eval-export.ts`（新建）
- `src/engine/dialogue/eval/scoring.ts`（新建，纯函数）
- `package.json`（加 3 个 scripts）

**eval-run.ts：**
```
--provider anthropic|fixture
          anthropic → mode=online（需 ANTHROPIC_API_KEY）
          fixture   → mode=fixture（不调 API）
--model <modelId>   (anthropic 时必填)
--runs N            (默认 1)
--scenarios <path>
--output <path>     (含 Date.now())
```

```ts
const evaluationId = `${model ?? "fixture"}-${Date.now()}`;
// 每场景每次 run：runId = `${evaluationId}-r${runIndex}`
```

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

**eval-export.ts：**
- `--input <pathA> <pathB>`（两个 run JSONL）
- `--seed N`（默认 42）
- 按 `scenarioId + runIndex` 配对
- `blind-samples.tsv`（含 `sceneDirective` 列，无模型名）
- `blind-key.tsv`（映射）

**scoring.ts vitest 测试（唯一进 CI 的 T6 代码）：**
```ts
describe("scoreResults", () => {
  it("schema pass = pass / (pass+fail), not_run excluded")
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
T0 (assembleDialogueRequest options + DTO + promptContext + buildDialoguePolicyContext)
  → T1 (compiler: DialoguePromptPayload + compilePromptPayload)
  → T2 (WORLD_RULES_TEXT + caching + relay)   ← 依赖 T1
    T3 (shared pipeline, validation order)     ← 不依赖 T2，可与 T2 并行
      → T4 (eval runner + fixture provider)   ← 依赖 T3
         → T5 (fixture builders + scenarios)  ← 依赖 T4 的 EvalFixtureDefinition
            → T6 (CLI tools)
```

---

## 验收清单

- [ ] `assembleDialogueRequest(db, state, speakerId, locationId, options?)` — `DialogueAssemblyOptions` 在 `types.ts`
- [ ] `targetId` 同时写入 3 处（request.targetId / memoryContext.audienceId / buildAudienceContext）
- [ ] 所有直接构造 `DialogueRequest` 的文件已补 `promptContext`
- [ ] Elder `rankDisplay.kind === "unranked"`，不读 `db.ranks["__elder__"]`
- [ ] `buildDialoguePolicyContext` 用 `request.promptContext.audience`（无独立 `buildAudienceContext` 调用）
- [ ] `compilePromptPayload(request)` — 零额外参数；`speaker.standing` 是判别联合
- [ ] `currentScene.directive` 来自 `request.sceneDirective`（缺省时无 key）
- [ ] `PromptMemory.createdAt`（非 `occurredAt`），无 `ownerId/strength/retention`（编译期）
- [ ] `PromptEvent.facts: Record<string, PromptFactValue>`（非 `unknown`）
- [ ] `WORLD_RULES_TEXT` 包含 12 条规则；快照测试验证
- [ ] `renderEtiquetteBlock` 快照测试验证含 5 个必要字段
- [ ] `system[]` 有 2 个 blocks，全带 `cache_control`；`messages[0].content` 含 payload
- [ ] Relay schema 含 `cache_control? optional`；relay 测试断言透传
- [ ] `validateDialogueProviderResult` 顺序 speaker→claim→text；`ok:false` 也含 diagnostics
- [ ] "wrong speaker + wrong claim → WRONG_SPEAKER"（旧 CLAIM_REJECTED）测试已更新并注释
- [ ] `EvalFixtureDefinition` 提供 `buildState()` 和 `responseFor()`；包含 5 类 fixture
- [ ] `EvalResult.text` = 模型原始输出（gate fail 时也有值）；`servedText` 只在 `outcome.ok` 时赋值
- [ ] Expectation prerequisite：gate=not_run 或 schema 失败或 text=undefined → `expectationStatus: "not_run"`
- [ ] `expectations.gatePass: false` + gate fail → `expectationStatus: "pass"`（而非 not_run）
- [ ] `EvalExecutionMode = "fixture" | "online"`（无 `"batch"` 类型）；CLI 未知 provider 报错退出
- [ ] `evaluationId` 一次 CLI 执行生成一次；`runId = "${evaluationId}-r${runIndex}"`
- [ ] ≥5 个场景含 `sceneDirective`；≥2 个场景 `expectations.gatePass: false`
- [ ] `blind-samples.tsv` 无模型名；`blind-key.tsv` 有映射；按 `scenarioId+runIndex` 配对
- [ ] `npm run typecheck` clean（client + server）
- [ ] `npx vitest run` 全绿（新增约 65+ tests）
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
