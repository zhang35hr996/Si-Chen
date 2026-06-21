# LLM 对话 Provider 接入 — 统一设计 spec

> 把记忆 / 对话「活人感」系统(见 `2026-06-20-memory-dialogue-design.md`,PR1–5 已全部落地)真正接上真实 LLM:
> 引擎已经能决定角色「知道什么 / 想表达什么 / 敢不敢表达」,本阶段让 **LLM 只负责把既定意图写成符合人物身份的中文台词**——不创造事实、不创造玩家行为、不改状态。
> 跨 4 个 PR(LLM-1…4);本 spec 是**唯一总体设计**,锁定 provider 契约 / choice 策略 / claim 策略 / 在线·Batch 共用管线 / 重试·降级 / 安全·成本;每个 PR 另出实现 plan。

## 核心原则(承接并收紧)

> **引擎决定一切有后果的东西(事实、立场、玩家选项、状态效果);LLM 只把引擎授权的意图润色成人话。**

记忆系统已把「① 事实是否成立 ② 角色是否知道 ③ 角色怎么看 ④ 敢不敢说 ⑤ 这次会不会想起」拆开。本阶段加入第六件事——**⑥ 怎么把第④步的「敢说的意图」说成中文**——并明确它是**唯一交给模型**的事。模型越界(凭空说事实、自造选项、夸大确定性)由 gate 拦截,而非靠提示词自觉。

## 1. Provider 抽象(LLM-1 钉死)

现状(已存在):
```ts
interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  generate(request: DialogueRequest): Promise<Result<RawDialogueResponseInput, GameError>>;
}
// RawDialogueResponseInput = { speaker, text, choices, proposedClaims? }
```

扩展为厂商无关契约(保留向后兼容,旧 mock 仍满足):
```ts
interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  generate(
    request: DialogueRequest,
    options?: DialogueGenerationOptions,   // 新增,可选 → 旧实现不受影响
  ): Promise<Result<DialogueProviderResult, ProviderError>>;
}

interface DialogueGenerationOptions {
  model?: string;            // 不传 → provider 默认档
  timeoutMs?: number;
  signal?: AbortSignal;      // 取消
  maxTokens?: number;
}

interface DialogueProviderResult {
  speaker: string;
  text: string;
  choices: RenderedDialogueChoice[];   // 见 §2,保留字段
  proposedClaims: ProposedClaim[];
  usage?: { inputTokens: number; outputTokens: number;
            cacheReadTokens?: number; cacheCreationTokens?: number };
  providerMeta?: { provider: string; model: string; requestId?: string };
}

type ProviderError =
  | { kind: "transport"; retryable: true; cause: "timeout" | "rate_limit" | "5xx" | "network" }
  | { kind: "protocol"; retryable: true; cause: "no_tool_call" | "wrong_tool" | "schema_invalid" | "truncated" | "multiple_tool_calls" }
  | { kind: "config"; retryable: false; cause: "not_configured" | "auth" | "incompatible_schema" }
  | { kind: "refused"; retryable: false };   // 内容政策等
```

文件布局:
```
providers/
  mockProvider.ts        # 既有,确定性桩
  remoteProvider.ts      # 既有 stub → 升级为「按配置路由的 facade」
  anthropicProvider.ts   # 新增 (LLM-1)
  openAIProvider.ts      # 新增 (LLM-2 对照 / 后期)
```
`remoteProvider` 不写死 Anthropic,而是按 `model`/配置路由到具体 adapter。

## 2. 结构化输出:强制 strict 工具,禁自由文本

对 Claude **不要**让其输出 JSON 文本再解析,而是定义强制工具并 `tool_choice` 强制调用:
```ts
const tool = {
  name: "emit_dialogue_line",
  description: "提交最终角色台词、台词中实际表达的结构化事实、以及为每个引擎给定选项渲染的文字。",
  strict: true,
  input_schema: dialogueProviderResultJsonSchema, // 由 zod 派生,与 parser 同源
};
// 请求:tool_choice = { type: "tool", name: "emit_dialogue_line" }
```
系统提示明确边界:
```
你不决定角色的立场、事实或行动,也不决定出现哪些选项。
你只能依据 ReactionPlan、allowedClaims、角色资料与提供的记忆,
把既定意图写成一段符合人物身份的中文台词。
proposedClaims 只填 text 中真正说出口的事实;未说出的不得填。
sourceContextIds 只能引用请求中提供的 id。
choices 只能为请求给定的每个 choiceCandidate.id 渲染文字,不得新增/删除/改 id。
```
**v1 不做 streaming**:一行台词短;结果必须先过 claim gate 才能展示;细粒度工具流可能产出不完整/非法 JSON。后期可「先完整生成并过 gate → UI 再逐字播放」(视觉似流式,逻辑先验证后展示)。

## 3. Choice 策略(本轮新拍板)

> **保留 `choices` 作为 provider 结果的一部分,但 LLM 只能渲染引擎提供的稳定 choice id,不得自由创造带游戏效果的选项。**

两类东西必须分开:
```ts
// 引擎控制:能选什么、选后发生什么(LLM 看不到 effectIds 的语义后果)
interface DialogueChoiceCandidate {
  id: string;
  intent: string;            // 给模型润色用的抽象意图,如 "reassure" / "remain_formal"
  effectIds: string[];       // 引擎专有:行动点/关系/剧情触发
  claimNeeds?: ClaimNeed[];
}
// LLM 输出:只把候选润色成文字
interface RenderedDialogueChoice {
  id: string;                // 必须来自 request.choiceCandidates
  text: string;
}
```
硬约束(gate 校验,非靠提示):`choice.id ∈ request.choiceCandidates`,不得新增 id、不得改 effects、不得自决是否出现某选项。

**LLM-1 兼容策略**:若此刻还没有结构化 `choiceCandidates`,真实 adapter 暂 `choices: []`(或仅回显旧 mock 的 choices),不生成自由 choices;`choiceCandidates` 的 live 装配 + choice 渲染留到 **LLM-3**。这样既不删现有字段、也不让 LLM 设计玩家行为。

## 4. Claim 策略:新增 `claim_not_allowed` + 语义包含(LLM-3 钉死)

现状 `claimGate` 有 6 个 violation,且 **`ClaimGateContext` 根本不接收 `allowedClaims`**。本阶段:
1. 把 `assembleClaims()` 产出的 `allowed`(`AssembledClaims.allowed: DialogueClaim[]`)接进 gate;
2. 新增第 7 个 violation:
```ts
type ClaimViolationCode = /* 既有 6 个 */ | "claim_not_allowed";
```
3. **不是**对象引用 / 整 JSON 相等,而是规范化 key + **语义包含**:
```ts
function claimKey(c: DialogueClaim): string {
  return [c.predicate, c.subjectId, normalizeClaimObject(c.object), c.modality].join(":");
}
// 模型可用更弱的表达(allowed=assert,proposed=suspect/rumor)→ 允许;反之不允许。
function isClaimCoveredByAllowedClaim(proposed: ProposedClaim, allowed: DialogueClaim[]): boolean;
//   至少校验:predicate 相同;subject/object 相同;
//   proposed.certainty ≤ allowed.certaintyCeiling(若有);
//   proposed.modality 不强于 allowed.modality(强度序 deny<rumor<suspect<assert,deny 另案);
//   sourceContextIds ⊆ offeredContextIds(已由 unknown_source_context 保证,这里复用)。
```
语义:**事实正确、角色也知道,但未被 ReactionPlan/assembler 授权表达 → `claim_not_allowed` → 整行拒绝 → 不写 mention**。防模型「顺便说出」无关但真实的信息。

## 5. Prompt compiler + 缓存边界(LLM-2 钉死)

只给模型必要载荷,**不传** 完整 `GameState` / 全部侍君资料 / 全部 `chronicle` / 隐藏后台属性 / 无关秘密 / 原始存档 JSON:
```ts
interface DialoguePromptPayload {
  speaker: { id; name; rank; speechStyle; personalityTraits: string[]; coreFacts: string[] };
  audience: DialogueAudienceContext;          // targetId/targetRole/privacy/presentCharacterIds
  reactionPlan: ReactionPlan;                 // primary + undertone + intensity/openness + claimNeeds
  relevantMemories: RetrievedMemory[];
  knownEvents: RetrievedEvent[];
  allowedClaims: DialogueClaim[];
  forbiddenClaims: DialogueClaim[];
  choiceCandidates: DialogueChoiceCandidate[]; // 仅 id+intent 暴露给模型,effectIds 不暴露
  currentScene: { location; topicTags: string[]; recentLines: string[] };
}
```
**缓存边界**:固定世界观 / 称谓表([[official-naming-rule]]) / 礼制禁词([[dialogue-etiquette-rule]]) / tool schema 走 **prompt caching**(命中按标准输入价 ~10% 计费)放前缀;动态角色·场景载荷放后缀,不进缓存。

## 6. 在线 / Batch 共用管线(LLM-2 钉死)

eval runner 支持两种执行器,但**共用同一套** prompt compiler / tool schema / response parser / gates / 评分:
```ts
type EvalExecutionMode = "online" | "batch";
```
Batch(50% 成本)用于大批量黄金集、多模型对照、多次重采样的回归;**绝不为 batch 单独拼 prompt**,否则离线结果不代表线上 adapter。每次定版模型配置仍跑一小组**在线 smoke**,验证真实延迟 / timeout / tool forcing / 缓存命中 / 线上与 batch 行为一致。

## 7. 重试 / 降级(LLM-4 钉死)

- **可重试(原样)**:transport(timeout/429/5xx/network)、protocol(no_tool_call/wrong_tool/schema_invalid/truncated)。
- **一次「修复重试」**:`unknown_source_context` / `claims_excessive_certainty` / `reveals_unknown_fact` / `contradicts_speaker_belief` / `claim_not_allowed` —— 第二次只把结构化违规回灌:「上一结果因以下违规被拒,请重新生成,不得引用未提供/未授权事实」。**最多一次**,防循环与成本失控。
- **不重试**:内容政策拒绝、provider 未配置、用户断网、本地配置错误、固定 schema 与模型不兼容。
- **失败 fallback**:① 预制 dialogue template;② 或输出符合角色语域的中性台词;③ **不写 mention**。例:「侍身明白了,陛下放心便是。」

## 8. 安全 / 成本(LLM-1 边界,LLM-4 完善)

- **API key 绝不进前端 bundle / 普通前端环境变量**。链路:`renderer → ProviderAdapter → 本地 native/backend relay → 厂商 API`。开发期先用 localhost Node proxy;发布期支持「玩家自带 key(桌面 native 加密保存)」与「服务端持 key 按额度」两模式。
- token/cost metrics、rate limit、**日志脱敏**(不落 key、不落玩家敏感输入原文)。

## PR 边界

- **LLM-1 Anthropic adapter** — provider/error/options 类型;Anthropic transport(SDK/HTTP);key 注入;timeout/abort;strict forced `emit_dialogue_line`;schema parse;`choices` 字段保留但真实模型暂不自造(回显或空);timeout/abort/基本重试分类;**录制 HTTP fixture 测试,CI 不调真实 API**;**不接 live planner**。验收:adapter 解析结果直接进既有 `claim gate → text gate → mention writeback`,**不得在 adapter 内复制事实校验**;既有 `pr5Integration` 各链对 fixture 通过。
- **LLM-2 Prompt compiler + eval** — `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀;prompt caching 边界;online+batch 共用 runner;50–100 黄金场景;Claude(Sonnet 4.6 / Opus 4.8)与中国/对照模型(GPT/Gemini)A/B;自动算 gate/schema 指标 + 人工中文盲评导出。
- **LLM-3 完整 policy 接线** — live `deriveSubjectRelations`/`deriveSocialDisposition`/`planReaction`;`knownEvents` 进 `DialogueRequest`;`assembleClaims`;**`allowedClaims` 进 gate + `claim_not_allowed` + `isClaimCoveredByAllowedClaim`**;`choiceCandidates` live 装配 + choice 渲染;provider 调用 → mention writeback 全链路打通。
- **LLM-4 生产化** — 一次结构化修复重试;fallback;prompt caching metrics;token/cost accounting;rate limit;日志脱敏;provider/model 路由配置;可选离线/typewriter reveal。

## 非目标(本阶段不做)

- streaming 实时展示(v1 先完整生成→过 gate→可选逐字播放)。
- 让 LLM 创造带游戏效果的玩家选项 / 自造事实 / 改状态。
- 谣言传播 / believed-state(仍只留 `BeliefProjection` 接口;接入后 gate 不改)。
- 旧存档迁移([[no-save-backcompat]])。

## 已拍板决策

1. **保留 `choices`**:LLM 只渲染引擎给定的稳定 `choice id` 文字,不创造带效果的选项。
2. 结构化输出走 **strict forced tool `emit_dialogue_line`**,禁自由文本;v1 不 streaming。
3. `claim_not_allowed` 用**语义包含**(`isClaimCoveredByAllowedClaim`),不强求 modality 完全相等;弱化表达允许、强化/越权不允许。
4. **唯一一份总体 spec(本文件)**;LLM-1…4 各只出 plan,不各写 spec,避免重复漂移。
5. eval **online/batch 共用** compiler/schema/parser/gates/scoring;batch 不单独拼 prompt。
6. 重试分级:transport/protocol 原样重试;claim 类**最多一次**修复重试;config/refused/断网不重试。
7. **API key 不进前端**,经 relay;日志脱敏。
8. 模型分层:Sonnet 4.6 默认、Opus 4.8 重要剧情可选、Haiku 4.5 闲聊待 eval 验证、GPT/Gemini 仅作对照/低成本备选(上线前 pin 精确 model id)。

## 关键默认(实现期可据现有代码择优,plan 标注)

- `dialogueProviderResultJsonSchema` 由 zod(`proposedClaimSchema` 等)**单源派生**,与 parser 同一来源,防 schema 与解析漂移(沿用 `gameTimeShape` 等价性先例)。
- `offeredContextIds` 已是**单源派生自实际下发的 request**(见 `orchestrator.buildDialoguePolicyContext`);`claim_not_allowed` 的来源校验复用同一集合。
- claim 强度序固定:`deny < rumor < suspect < assert`;`deny` 与肯定类不同维度,单独判。
- adapter 不做任何事实/礼制校验——全部交给既有 `claimGate` + `gates`(text)。
- `choiceCandidates.effectIds` 永不进 prompt 载荷(只暴露 `id`+`intent`)。
