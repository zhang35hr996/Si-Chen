# LLM-2 Prompt Compiler + Eval

**日期:** 2026-06-22  
**PR 目标:** `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀；prompt caching；online+batch 共用 eval runner；50+ 黄金场景；自动指标 + 人工中文盲评导出。  
**基准分支:** main（合并 LLM-1.5 后，commit `03eb945`）  
**worktree:** `.worktrees/llm-2`  
**branch:** `feat/llm-2-prompt-compiler`

---

## LLM-2 边界（来自总体 spec）

- 编译器：`DialogueRequest → DialoguePromptPayload`（格式见 spec §5）
- 固定前缀（可缓存）：世界观/礼制/称谓规则 + tool schema
- 动态后缀（不缓存）：角色·场景·记忆 payload
- Prompt caching：`cache_control: { type: "ephemeral" }` 加到固定前缀 blocks；`capabilities.promptCaching: true`
- Eval runner：online + batch 共用 compiler/schema/parser/gates/scoring；batch 按 `capabilities.batch` 门控
- 黄金集：50 场景（`tests/eval/golden/`，JSONL）
- 指标：gate pass rate、schema valid %、avg tokens；人工盲评 TSV 导出
- **不实现**：`reactionPlan` 活接（LLM-3）；`allowedClaims`（LLM-3）；`knownEvents` 进 request（LLM-3）；修复重试（LLM-4）；streaming

## 非目标

- 让模型选 choice 文本（仍 authored）
- reactionPlan live planner 接线
- knownEvents 进 DialogueRequest
- AuthorizedClaim / assembleClaims 升级（LLM-3）
- 重试 / fallback（LLM-4）

---

## Global Constraints

1. **`buildAnthropicToolRequest` 必须从 `compilePromptPayload` 派生**，不能绕过编译器直接拼字符串。
2. **固定前缀 blocks 加 `cache_control`，动态后缀不加**。两者必须分开放在 `system[]` 中：固定 blocks 在前，动态 block 在后且无 `cache_control`。
3. **`DialoguePromptPayload` 不含 `GameState` 原始对象、完整存档 JSON、隐藏属性**。只含 spec §5 定义的字段。
4. **`choiceCandidates` 只暴露 `id + intent`，不含 effectIds 或 authoredText**（authoredText 由 orchestrator 用 authored content 回填，不给模型）。
5. **`capabilities.promptCaching: true` 必须随 caching 一起设置**，不能只设 blocks 不改 capabilities。
6. **Eval runner 不绕过 compiler**：eval 用的 prompt 必须来自 `compilePromptPayload → buildAnthropicToolRequest`，与线上路径完全相同。不为 eval 单独拼 prompt（spec §6 明确禁止）。
7. **CI 不调真实 API**：eval runner 在 CI 下使用 fixture transport（offline mock）。在线 smoke 是手动步骤。
8. **batch 按 `capabilities.batch` 门控**：当前 anthropic provider `capabilities.batch = false`，eval runner 遇 batch mode 且 provider 不支持时 fallback 到 online 并 warn，不抛出错误。
9. **测试：vitest 全绿，typecheck:client + typecheck:server 干净，vite build 成功**。
10. **rawDialogueResponseSchema**（`src/engine/dialogue/types.ts` 第 42-56 行）仍存在；若本 PR 任务中的代码不使用它，在 Task 1 中删除（零消费者）。

---

## 关键接口（任务间约定）

### `DialoguePromptPayload`（Task 1 定义，Task 2 消费）

```ts
// src/engine/dialogue/promptPayload.ts
export interface DialogueSpeakerPayload {
  id: string;
  name: string;          // resolveDisplayName 结果
  rank: string;          // rank.id
  speechStyle: string;   // character.voice
  personalityTraits: string[];   // character.profile.personalityTraits（若无则 []）
  coreFacts: string[];           // 角色固有事实（如「头牌」「寒门出身」）
}

export interface DialogueChoiceCandidate {
  id: string;
  intent: string;   // 玩家选择意图摘要（authored choice 的 tone 或 id 语义化）
  // authoredText 不进 payload（orchestrator 回填，模型只写 NPC 台词）
}

export interface DialoguePromptPayload {
  speaker: DialogueSpeakerPayload;
  audience: DialogueAudienceContext;          // from ./audience
  reactionPlan?: ReactionPlan;                // stub in LLM-2，LLM-3 接活 planner
  relevantMemories: MemoryEntry[];            // from request.speakerContext.relevantMemories
  knownEvents: CourtEvent[];                  // empty in LLM-2，LLM-3 从 request 传入
  allowedClaims: DialogueClaim[];             // empty in LLM-2，LLM-3 接 assembleClaims
  forbiddenClaims: DialogueClaim[];           // from claimAssembler.assembleClaims().forbidden（用 stub reactionPlan）
  choiceCandidates: DialogueChoiceCandidate[];  // 当前场景玩家可用选项，仅 id+intent
  currentScene: {
    location: string;                         // request.locationId
    topicTags: string[];                      // request.etiquette 中可推断，或空 []
    recentLines: { speaker: string; text: string }[];  // request.transcript（最近 N 条）
  };
}
```

### `compilePromptPayload`（Task 1 实现，Task 2 消费）

```ts
// src/engine/dialogue/promptPayload.ts
export function compilePromptPayload(
  request: DialogueRequest,
  db: ContentDB,
  state: GameState,
): DialoguePromptPayload
```

- 从 `request.speakerContext` 派生 `speaker`（需要 `db.ranks` 拿 rank.id）
- 从 `db.characters[speakerId].profile` 拿 `personalityTraits` / `coreFacts`（若 profile 只是字符串，则 `coreFacts: [profile]`，`personalityTraits: []`）
- `audience` = `buildAudienceContext(state, db, { speakerId, targetId: request.targetId })`
- `reactionPlan` = undefined（LLM-2 stub）
- `relevantMemories` = `request.speakerContext.relevantMemories`
- `knownEvents` = `[]`（LLM-2 stub；TODO: LLM-3 从 buildMemoryContext 的 knownEvents 传入）
- `allowedClaims` = `[]`（LLM-2 stub；TODO: LLM-3 接 assembleClaims 输出）
- `forbiddenClaims` = `assembleClaims({ speakerId, reactionPlan: STUB_REACTION_PLAN, memoryContext, beliefs, ... }).forbidden`
- `choiceCandidates` = `[]`（无 authored choices 来源时为空；后续 orchestrator 传入）
- `currentScene` = `{ location: request.locationId, topicTags: [], recentLines: request.transcript.slice(-6) }`

### `buildAnthropicToolRequest` 升级（Task 2）

签名不变，内部逻辑重写：

```ts
// system[]: 固定前缀 blocks（带 cache_control） + 动态后缀 block（无 cache_control）
// messages[0].content: JSON.stringify(dynamicPayload)  — 动态后缀（仅非缓存字段）
```

固定前缀（不含角色/场景数据，仅世界观 + 礼制 + etiquette + tool schema）：
- Block 1：角色扮演规则 + 礼制禁词总则（从 spec 文本 + `db.lexicon` 常量派生）
- Block 2：称谓表（从 `request.etiquette.addressRules` 渲染）  
- Block 3（可选）：tool schema 说明（如 provider 支持 caching）  
每个固定 block 加 `cache_control: { type: "ephemeral" as const }`。

动态后缀 block（无 cache_control）= `payload.speaker + audience + reactionPlan + memories + scene`。

`AnthropicRequestPayload.system` 类型须扩展为：
```ts
system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
```

### Eval runner（Task 3）

```ts
// tools/eval-runner.ts
export type EvalExecutionMode = "online" | "batch" | "dry";
//  dry = 用 fixture transport，不调 API，可在 CI 跑

export interface EvalScenario {
  id: string;
  speakerId: string;
  locationId: string;
  transcript?: { speaker: string; text: string }[];
  scripted?: { text: string };
  expectations?: {
    gatePass?: boolean;          // 期望 gate 全通
    mentionedMemories?: string[]; // 期望台词涉及这些记忆 id
    forbiddenTexts?: string[];    // 期望台词不包含这些字符串
  };
}

export interface EvalResult {
  scenarioId: string;
  model: string;
  mode: EvalExecutionMode;
  schemaValid: boolean;
  gatePass: boolean;
  gateFindings: { gate: string; severity: string; matched: string }[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  requestId?: string;
  text?: string;           // 生成的台词（用于人工盲评导出）
  errorKind?: string;      // 若 provider 返回 err
  durationMs: number;
}
```

### 黄金场景格式（Task 4）

```jsonl
// tests/eval/golden/scenarios.jsonl — 每行一个 JSON 对象
{"id":"s001","speakerId":"shen_zhibai","locationId":"yan_bo_lou","transcript":[],"expectations":{"gatePass":true}}
```

### 人工导出格式（Task 5）

```tsv
// eval-results-YYYY-MM-DD.tsv
scenarioId\tspeakerId\tmodel\tgatePass\tviolations\tinputTokens\toutputTokens\tcacheHit\ttext
```

---

## Tasks

### Task 1: `DialoguePromptPayload` 类型 + `compilePromptPayload` 编译器

**文件:**
- `src/engine/dialogue/promptPayload.ts`（新建）
- `tests/dialogue/promptPayload.test.ts`（新建）

**需要删除:** `src/engine/dialogue/types.ts` 中的 `rawDialogueResponseSchema`（第 42-56 行，零消费者）及其 `z` import（如 orchestrator 不再用则删）。

**实现要点:**
- `DialoguePromptPayload` + 子接口（如上方接口定义）
- `compilePromptPayload(request, db, state)` 纯函数
- `STUB_REACTION_PLAN: ReactionPlan` = `{ subjectIds: [], primary: "remain_reserved", intensity: 0, openness: 50, claimNeeds: [], rationaleCodes: ["llm2-stub"] }`
- `assembleClaims` 调用拿 `forbidden`（allowed stub 为 []）
- `coreFacts` 处理：`character.profile` 若为 string 则 `[profile]`；若为对象则按字段提取

**测试（TDD，先写）:**
```ts
describe("compilePromptPayload", () => {
  it("speaker id/name/rank/speechStyle from request", ...)
  it("audience = buildAudienceContext result", ...)
  it("relevantMemories = request.speakerContext.relevantMemories", ...)
  it("knownEvents = [] in LLM-2 stub", ...)
  it("allowedClaims = [] in LLM-2 stub", ...)
  it("forbiddenClaims comes from assembleClaims().forbidden", ...)
  it("currentScene.recentLines = last 6 of transcript", ...)
  it("choiceCandidates = [] when no choices provided", ...)
  it("does NOT include GameState raw object or hidden attributes", ...)
})
```

**验收:**
- `compilePromptPayload` 返回对象不含 `GameState`、`CharacterContent` 完整对象
- `personalityTraits` / `coreFacts` 有值时非空
- tsc 干净，vitest 全绿

---

### Task 2: 升级 `buildAnthropicToolRequest` + prompt caching

**文件:**
- `src/engine/dialogue/providers/anthropicProvider.ts`（修改）

**实现要点:**

签名扩展（向后兼容，加可选参数）：
```ts
export function buildAnthropicToolRequest(
  request: DialogueRequest,
  db: ContentDB,
  state: GameState,
  model: string,
  options?: DialogueGenerationOptions,
): AnthropicRequestPayload
```
注意：`createAnthropicProvider` 调用时需传 `db, state`，所以 `createAnthropicProvider` 的 `opts` 需要加 `db: ContentDB; state: GameState` 或在 `generate()` 入参传入。**推荐：`generate(request, options, { db, state })` 不合适；改为 `createAnthropicProvider` 接受 `{ model, transport, db, state }` 或从 `request` 中读取 db/state（若 orchestrator 改为把 db/state 放进某个 context 中）。**

实际实现路径（最小改动）：`createAnthropicProvider(opts: { model; transport; db: ContentDB; state: () => GameState })` — state 用 getter 因为对话中 state 可能更新。

固定前缀 blocks：
```ts
const FIXED_ETIQUETTE_BLOCK = (etiquette: DialogueRequest["etiquette"]): SystemBlock => ({
  type: "text",
  text: renderEtiquetteRules(etiquette),  // 称谓表 + 禁词
  cache_control: { type: "ephemeral" },
});
const FIXED_RULES_BLOCK: SystemBlock = {
  type: "text",
  text: SYSTEM_RULES_TEXT,  // 硬编码世界观规则，不含角色数据
  cache_control: { type: "ephemeral" },
};
```

动态后缀 block（无 cache_control）：
```ts
const dynamicBlock: SystemBlock = {
  type: "text",
  text: JSON.stringify(omitCached(payload)),  // 去掉 etiquette（已在固定块），只留 speaker/audience/memories/scene
};
```

`AnthropicRequestPayload.system` 类型更新：
```ts
system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
```

`capabilities.promptCaching: true`。

**测试（TDD，先写）:**
```ts
describe("buildAnthropicToolRequest", () => {
  it("system[] 有 ≥2 个 fixed blocks 含 cache_control", ...)
  it("最后一个 system block 无 cache_control（动态后缀）", ...)
  it("动态 block 含 speaker.id / relevantMemories", ...)
  it("动态 block 不含原始 GameState / CharacterContent 完整对象", ...)
  it("capabilities.promptCaching === true", ...)
  it("tool_choice 仍是 emit_dialogue_line strict forced", ...)
  it("etiquette forbiddenTerms 出现在固定 block 中", ...)
})
```

**验收:**
- `system[0..N-2]` 全有 `cache_control`，`system[N-1]` 无
- `capabilities.promptCaching` = true
- 现有 adapter 测试（`tests/dialogue/adapter.test.ts` / `remoteProvider.test.ts`）全绿

---

### Task 3: Eval runner 核心（shared pipeline）

**文件:**
- `src/engine/dialogue/eval/evalRunner.ts`（新建）
- `src/engine/dialogue/eval/types.ts`（新建，`EvalScenario` / `EvalResult` / `EvalExecutionMode`）
- `tests/dialogue/eval/evalRunner.test.ts`（新建）

**实现要点:**

```ts
// evalRunner.ts
export async function runEvalScenario(
  scenario: EvalScenario,
  provider: DialogueProvider,
  db: ContentDB,
  state: GameState,
  mode: EvalExecutionMode,
): Promise<EvalResult>
```

步骤：
1. `assembleDialogueRequest(db, state, scenario.speakerId, scenario.locationId, scenario.scripted)`
2. 若 mode = "batch" 且 `!provider.capabilities.batch` → warn + fallback online
3. `buildDialoguePolicyContext(db, state, request)` 得 policy
4. `provider.generate(request)` → 记录 usage/requestId/duration
5. 若 err → `{ schemaValid: false, gatePass: false, errorKind: err.kind }`
6. 若 ok → `validateDialogueClaims(...)` + `scanDialogueText(...)` → `gateFindings`
7. `gatePass = findings.filter(f => f.severity === "reject").length === 0`
8. 返回 `EvalResult`

**测试（TDD，先写）:**
```ts
describe("runEvalScenario", () => {
  it("schemaValid=true when provider returns valid structure", ...)
  it("gatePass=false when text gate rejects", ...)
  it("batch mode falls back to online when !capabilities.batch, warns", ...)
  it("errorKind set when provider returns err", ...)
  it("usage forwarded from provider result", ...)
  it("dry mode uses injected fixture transport, no real API calls", ...)
})
```

全部用 mock provider，无真实 API 调用。

---

### Task 4: 黄金场景集（50 个，JSONL）

**文件:**
- `tests/eval/golden/scenarios.jsonl`（新建，50 条）
- `tests/eval/golden/README.md`（新建，格式说明）

**场景覆盖（必须包含）:**
- 至少 8 个不同 speakerId（覆盖不同 rank / speechStyle）
- 至少 5 个场景含 transcript（测试 recentLines 处理）
- 至少 10 个含 `expectations.gatePass: true`（正向场景）
- 至少 5 个含 `expectations.forbiddenTexts`（测试台词不含违禁词）
- 至少 3 个含 `relevantMemories`（测试记忆注入）
- 至少 2 个不同 locationId

**格式（每行）:**
```json
{
  "id": "s001",
  "speakerId": "shen_zhibai",
  "locationId": "yan_bo_lou",
  "transcript": [],
  "expectations": { "gatePass": true, "forbiddenTexts": ["大人", "公子"] }
}
```

**注意:** 场景使用现有 content DB 中存在的 speakerId 和 locationId，不造不存在的角色。Task 4 开始前先 `grep` 确认有效 speakerId 列表。

---

### Task 5: 指标聚合 + 人工盲评导出

**文件:**
- `tools/eval-score.ts`（新建，聚合指标）
- `tools/eval-export.ts`（新建，生成 TSV）
- `package.json`（添加 scripts）

**scripts:**
```json
"eval:score": "tsx tools/eval-score.ts tests/eval/golden/scenarios.jsonl",
"eval:export": "tsx tools/eval-export.ts tests/eval/golden/scenarios.jsonl --output eval-results-$(date +%Y-%m-%d).tsv"
```

**`eval-score.ts` 输出（stdout）:**
```
Scenarios:     50
Schema valid:  48/50 (96%)
Gate pass:     45/50 (90%)
Avg input tok: 412
Avg out tok:   87
Cache hits:    32/50 (64%)
```

**`eval-export.ts` TSV 列:**
```
scenarioId | speakerId | model | gatePass | violations | inputTokens | outputTokens | cacheHit | text
```
每行一个场景结果，`text` 为模型台词（人工盲评用）。

**注意:** 这两个工具是手动脚本（`!` 前缀运行），**不进 CI**，不在 vitest 里测试。只对 `EvalResult[]` 纯函数聚合写单元测试。

**测试:**
```ts
describe("scoreResults", () => {
  it("计算 schema valid %", ...)
  it("计算 gate pass %", ...)
  it("avg tokens", ...)
  it("空数组返回 zeros", ...)
})
```

---

## 执行顺序

```
T1 (compiler) → T2 (caching) → T3 (runner) → T4 (fixtures) → T5 (export)
```

T1 和 T3 可以并行（T3 不依赖 T2 的 caching 修改），但 T2 必须在 T1 之后（需要 `compilePromptPayload`）。

---

## 验收标准

- [ ] `compilePromptPayload` 不含 `GameState` 原始对象
- [ ] `system[]` fixed blocks 有 `cache_control`，dynamic block 无
- [ ] `capabilities.promptCaching: true`
- [ ] `evalRunner.runEvalScenario` 用的 prompt 来自 `compilePromptPayload → buildAnthropicToolRequest`（与线上路径完全一致）
- [ ] batch mode 遇到 `!capabilities.batch` 时 fallback online + warn
- [ ] 50 个黄金场景，覆盖 ≥8 speakerId
- [ ] `npm run typecheck` clean
- [ ] `npx vitest run` 全绿（新增约 40+ tests）
- [ ] `npx vite build` 成功（eval runner 不进 browser bundle）
- [ ] `rawDialogueResponseSchema` 已从 types.ts 删除

---

## 进度账本（执行期填写）

Branch: feat/llm-2-prompt-compiler  
Worktree: .worktrees/llm-2  
Base (branch start): TBD

| Task | Status | Commits | Notes |
|------|--------|---------|-------|
| T1   |        |         |       |
| T2   |        |         |       |
| T3   |        |         |       |
| T4   |        |         |       |
| T5   |        |         |       |
