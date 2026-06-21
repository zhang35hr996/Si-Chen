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

**这是一次原子破坏性迁移,不是向后兼容**(返回类型从 `Result<RawDialogueResponseInput, GameError>` 变为 `Result<DialogueProviderResult, ProviderError>`,旧 mock/调用者未必可赋值)。项目 pre-release([[no-save-backcompat]]),LLM-1 **同一 PR 内**迁移 mock、remote stub、orchestrator、测试和所有消费者,不保留旧返回类型。

```ts
interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;   // §8:batch/cache/strictTools 是能力不是不变量
  generate(
    request: DialogueRequest,
    options?: DialogueGenerationOptions,
  ): Promise<Result<DialogueProviderResult, ProviderError>>;
}

interface DialogueGenerationOptions {
  model?: ModelRef;          // 不传 → provider 默认档;显式 provider,不靠字符串猜厂商(§7)
  timeoutMs?: number;
  signal?: AbortSignal;      // 取消
  maxTokens?: number;
}

interface ModelRef {
  provider: "anthropic" | "openai" | "qwen" | "kimi" | "deepseek";
  model: string;             // 同名别名 / OpenAI-compatible endpoint 不能安全反推厂商
}

interface ProviderCapabilities { strictTools: boolean; promptCaching: boolean; batch: boolean; }
```

**模型生成 ≠ provider 结果**——必须拆成两个类型。`speaker` 由 request 决定、`usage`/`providerMeta` 是 adapter 从 HTTP 响应补的传输元数据,**都不能交给模型生成**:
```ts
// 模型经强制工具产出的、唯一可信任来自模型的部分 → tool schema 只由它派生
interface DialogueToolOutput {
  text: string;
  choices: RenderedDialogueChoice[];
  proposedClaims: ProposedClaim[];
}

// adapter 组装后的对外结果
interface DialogueProviderResult {
  speaker: string;                       // adapter 从 request.speakerId 派生,不信任模型
  text: string;
  choices: RenderedDialogueChoice[];     // 见 §3
  proposedClaims: ProposedClaim[];
  usage?: { inputTokens: number; outputTokens: number;
            cacheReadTokens?: number; cacheCreationTokens?: number };
  providerMeta?: { provider: string; model: string; requestId?: string };
}
```
装配流程:
```text
Claude tool input → dialogueToolOutputSchema.parse → adapter 补 speaker/usage/providerMeta → DialogueProviderResult
```

**错误边界**:`generate()` 只返回 `ProviderError`(传输层错误不扩散进引擎);在 orchestrator/engine 边界经 `mapProviderErrorToGameError()` 转换,adapter 自身不返回 `GameError`。
```ts
type ProviderError =
  | { kind: "transport"; retryable: true; cause: "timeout" | "rate_limit" | "5xx" | "network"; meta?: ProviderErrorMeta }
  | { kind: "protocol"; retryable: true; cause: "no_tool_call" | "wrong_tool" | "schema_invalid" | "truncated" | "multiple_tool_calls"; meta?: ProviderErrorMeta }
  | { kind: "config"; retryable: false; cause: "not_configured" | "auth" | "incompatible_schema"; meta?: ProviderErrorMeta }
  | { kind: "offline"; retryable: false; meta?: ProviderErrorMeta }   // 明确断网,区别于短暂 network(§7)
  | { kind: "refused"; retryable: false; meta?: ProviderErrorMeta };  // 内容政策等

interface ProviderErrorMeta { message?: string; statusCode?: number; retryAfterMs?: number; requestId?: string; }
// 日志只存分类 + requestId,绝不存 key 或完整敏感 prompt(§8)。
```

文件布局:
```
providers/
  mockProvider.ts        # 既有,确定性桩 → LLM-1 迁移到新返回契约
  remoteProvider.ts      # 既有 stub → 升级为「按显式 ModelRef.provider 路由的 facade」(不猜名字)
  anthropicProvider.ts   # 新增 (LLM-1)
  openAIProvider.ts      # 新增 (LLM-2 对照 / 后期)
```

## 2. 结构化输出:强制 strict 工具,禁自由文本

对 Claude **不要**让其输出 JSON 文本再解析,而是定义强制工具并 `tool_choice` 强制调用:
```ts
const tool = {
  name: "emit_dialogue_line",
  description: "提交最终角色台词、台词中实际表达的结构化事实、以及为每个引擎给定选项渲染的文字。",
  strict: true,
  input_schema: dialogueToolOutputJsonSchema, // 仅由 DialogueToolOutput 派生——不含 speaker/usage/providerMeta
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
v1:choices 留空数组——玩家选项文字由引擎提供,不由你渲染。
```
> v1 中 `DialogueToolOutput.choices` 字段保留(契约稳定),但模型须返回 `[]`;**adapter 权威地用 authored 文本覆盖模型的 choices**(§3),模型对选项零影响。
**v1 不做 streaming**:一行台词短;结果必须先过 claim gate 才能展示;细粒度工具流可能产出不完整/非法 JSON。后期可「先完整生成并过 gate → UI 再逐字播放」(视觉似流式,逻辑先验证后展示)。

## 3. Choice 策略(本轮新拍板)

> **保留 `choices` 字段,但 LLM-1…3 不让模型自由渲染玩家选项**——**只校验 id 合法不足以阻止模型改变行为语义**(例:id 仍为 `reply_gentle`,文字却渲染成「朕今日便将顾氏打入冷宫」,id 合法但行为已变)。v1 用 authored 文本,模型只写 NPC 台词。

两类东西必须分开:
```ts
// 引擎控制:能选什么、选后发生什么(LLM 看不到 effectIds 的语义后果)
interface DialogueChoiceCandidate {
  id: string;
  intent: string;            // 抽象意图,如 "reassure" / "remain_formal"
  authoredText?: string;     // v1:有则直接用作选项文字(不经模型)
  effectIds: string[];       // 引擎专有:行动点/关系/剧情触发,永不进 prompt
}
interface RenderedDialogueChoice { id: string; text: string; } // id 必须来自 candidate
```
**v1 选项装配(adapter 不让模型碰)**:
```ts
choices = candidates.filter(c => c.authoredText).map(c => ({ id: c.id, text: c.authoredText! }));
// 无 authoredText → choices: []。模型只生成 NPC 台词。
```

**若将来要让 LLM 润色 choice**(单独 choice-rendering PR,非本阶段):每个 choice 须单独提供 `ChoiceRenderingConstraint { id; intent; allowedClaims: AuthorizedClaim[]; forbiddenClaims: DialogueClaim[] }`,模型输出 `RenderedDialogueChoice` 须带自己的 `proposedClaims`,**逐 choice** 过 claim gate + text gate;未被玩家选择前不写 mention、不触发 effects;任一 choice 失败是丢弃该 choice 还是整批重试需另行规定。这会显著扩大范围,故 v1 不做。

## 4. Claim 策略:新增 `claim_not_allowed` + 语义包含(LLM-3 钉死)

现状 `claimGate` 有 6 个 violation,且 **`ClaimGateContext` 根本不接收 `allowedClaims`**。本阶段:

**① allowed claim 必须携带「授权来源」,否则 mention 可被伪造。** 只校验「被 allowed 覆盖」+「source ∈ offeredContextIds」仍有洞:provider 可把一条 allowed 事实挂到本次恰好提供过的**无关** `mem_b` 上,两项校验都过,却给 `mem_b` 错写 mention cooldown。故 `assembleClaims()` 不返回裸 `DialogueClaim[]`:
```ts
interface AuthorizedClaim { claim: DialogueClaim; sourceContextIds: string[]; }   // 这条事实的合法依据
interface AssembledClaims { allowed: AuthorizedClaim[]; forbidden: DialogueClaim[]; }
```
覆盖校验须额外要求 `proposed.sourceContextIds ⊆ 匹配到的 AuthorizedClaim.sourceContextIds`(每个 proposed source 都是**这条事实**的合法依据,而非「本次恰好提供过的任意上下文」),mention writeback 方可信。

**② fact key 不含 modality;`deny` 不进线性强度序。** key 若含 modality,则 allowed=assert / proposed=suspect 天然不匹配;且 `deny` 是相反极性,不是更弱的 `rumor`。拆成极性 + 认知模态:
```ts
type ClaimPolarity = "affirm" | "deny";
type EpistemicModality = "rumor" | "suspect" | "assert";   // 线性,可比强弱
// DialogueClaim: { predicate, subjectId, object, polarity, modality, certaintyCeiling? }
function factKey(c: DialogueClaim): string {
  return [c.predicate, c.subjectId, normalizeClaimObject(c.object)].join(":"); // 不含 polarity/modality
}
function isClaimCoveredByAllowedClaim(p: ProposedClaim, allowed: AuthorizedClaim[]): boolean;
//   ① factKey 相同;② polarity 相同;③ p.modality 不强于 allowed.modality(rumor<suspect<assert);
//   ④ p.certainty ≤ allowed.certaintyCeiling(若有);⑤ p.sourceContextIds ⊆ allowed.sourceContextIds。
```
> 迁移注:现 `ClaimModality = assert|suspect|rumor|deny` 单枚举。pre-release 直接迁到 polarity+modality;若该型迁移成本过高,**至少写显式 truth table**,禁止实现 `deny < rumor` 这类数值排序。

**③ 新增第 7 个 violation:**
```ts
type ClaimViolationCode = /* 既有 6 个 */ | "claim_not_allowed";
```
语义:**事实正确、角色也知道,但未被 ReactionPlan/assembler 授权表达(或挂错来源)→ `claim_not_allowed` → 整行拒绝 → 不写 mention**。防模型「顺便说出」无关但真实的信息。

## 5. Prompt compiler + 缓存边界(LLM-2 钉死)

只给模型必要载荷,**不传** 完整 `GameState` / 全部侍君资料 / 全部 `chronicle` / 隐藏后台属性 / 无关秘密 / 原始存档 JSON:
```ts
interface DialoguePromptPayload {
  speaker: { id; name; rank; speechStyle; personalityTraits: string[]; coreFacts: string[] };
  audience: DialogueAudienceContext;          // targetId/targetRole/privacy/presentCharacterIds
  reactionPlan: ReactionPlan;                 // primary + undertone + intensity/openness + claimNeeds
  relevantMemories: RetrievedMemory[];
  knownEvents: RetrievedEvent[];
  allowedClaims: AuthorizedClaim[];           // 带授权来源(§4)
  forbiddenClaims: DialogueClaim[];
  choiceCandidates: DialogueChoiceCandidate[]; // 仅 id+intent 暴露给模型,effectIds/authoredText 不暴露
  currentScene: { location; topicTags: string[]; recentLines: string[] };
}
```
**来源用 typed ref,不用裸字符串。** LLM-3 让 `knownEvents` 进 request 后,offered-source 集合必须从**实际 prompt payload** 同时派生 memory 与 event,且区分种类(`evt_*` 与 `mem_*` 语义不同,mention writeback 只对 memory/event 走各自正确逻辑):
```ts
interface ContextRef { kind: "memory" | "event" | "fact"; id: string; }
const offeredContextRefs: ContextRef[] = [
  ...payload.relevantMemories.map(m => ({ kind: "memory", id: m.id })),
  ...payload.knownEvents.map(e => ({ kind: "event", id: e.id })),
];
```
**缓存边界**:固定世界观 / 称谓表([[official-naming-rule]]) / 礼制禁词([[dialogue-etiquette-rule]]) / tool schema 走 **prompt caching**(支持该能力的 provider 上,命中按标准输入价 ~10% 计费)放前缀;动态角色·场景载荷放后缀,不进缓存。

## 6. 在线 / Batch 共用管线(LLM-2 钉死)

eval runner 支持两种执行器,但**共用同一套** prompt compiler / tool schema / response parser / gates / 评分:
```ts
type EvalExecutionMode = "online" | "batch";
```
Batch(具体厂商上 ~50% 成本)用于大批量黄金集、多模型对照、多次重采样的回归;**绝不为 batch 单独拼 prompt**,否则离线结果不代表线上 adapter。每次定版模型配置仍跑一小组**在线 smoke**,验证真实延迟 / timeout / tool forcing / 缓存命中 / 线上与 batch 行为一致。

**batch / promptCaching 是 `ProviderCapabilities`,不是所有 provider 的共同保证。** provider 不支持 `batch` 时,eval runner 走 `online` 或明确跳过,**不伪装统一支持**。

## 7. 重试 / 降级(LLM-4 钉死)

**区分短暂网络错误与明确断网**:transient `transport.network`/`timeout`/`5xx`/`rate_limit` 按退避重试;`offline`(明确断网)不重试。

**总预算(硬上限,防 transport 重试叠加 claim repair 爆量)**:
```text
transport retries: 最多 2 次
protocol retries:  最多 1 次
claim repair:      最多 1 次
单次用户请求的 provider 调用总数 ≤ 3
```
- **可重试(原样)**:transport(timeout/429/5xx/transient network)、protocol(no_tool_call/wrong_tool/schema_invalid/truncated)。
- **一次「修复重试」**:`unknown_source_context` / `claims_excessive_certainty` / `reveals_unknown_fact` / `contradicts_speaker_belief` / `claim_not_allowed` —— 第二次只回灌结构化违规:「上一结果因以下违规被拒,请重新生成,不得引用未提供/未授权事实」。
- **不重试**:内容政策拒绝、provider 未配置、明确断网、本地配置错误、固定 schema 与模型不兼容。
- **exactly-once 写回**:所有失败尝试**不写 mention、不改游戏状态**;只有最终被接受的结果与 mention writeback 一起提交。
- **失败 fallback**:① 预制 dialogue template;② 或输出符合角色语域的中性台词;③ **不写 mention**。例:「侍身明白了,陛下放心便是。」

## 8. 安全 / 成本(LLM-1 边界,LLM-4 完善)

- **API key 绝不进前端 bundle / 普通前端环境变量**。链路:`renderer → ProviderAdapter → 本地 native/backend relay → 厂商 API`。开发期先用 localhost Node proxy;发布期支持「玩家自带 key(桌面 native 加密保存)」与「服务端持 key 按额度」两模式。
- token/cost metrics、rate limit、**日志脱敏**(不落 key、不落玩家敏感输入原文)。

## PR 边界

- **LLM-1 Anthropic adapter** — **原子破坏性迁移**返回契约(同 PR 迁 mock/remote/orchestrator/测试/所有消费者);`DialogueToolOutput`(模型)/`DialogueProviderResult`(adapter)拆分 + `dialogueToolOutputJsonSchema` 单源;`ProviderError` + `mapProviderErrorToGameError` 边界;`ModelRef` 显式路由 + `ProviderCapabilities`;Anthropic transport(SDK/HTTP);key 注入;timeout/abort;strict forced `emit_dialogue_line`;parse;**choices 仅用 authored 文本(无则空),模型只写 NPC 台词**;基本重试分类;**录制 HTTP fixture 测试,CI 不调真实 API**;**不接 live planner**。验收:adapter 解析结果直接进既有 `claim gate → text gate → mention writeback`,**不得在 adapter 内复制事实校验**;既有 `pr5Integration` 各链对 fixture 通过。
- **LLM-2 Prompt compiler + eval** — `DialogueRequest → DialoguePromptPayload` 固定前缀 + 动态后缀;prompt caching 边界;online+batch 共用 runner(batch 按 `capabilities.batch` 门控);50–100 黄金场景;Claude(Sonnet 4.6 / Opus 4.8)与对照模型 A/B;自动算 gate/schema 指标 + 人工中文盲评导出。
- **LLM-3 完整 policy 接线** — live `deriveSubjectRelations`/`deriveSocialDisposition`/`planReaction`;`knownEvents` 进 `DialogueRequest` + **typed `ContextRef` offered-source 集合**;`assembleClaims` 升级产 **`AuthorizedClaim`**;**`allowedClaims` 进 gate + `claim_not_allowed` + `isClaimCoveredByAllowedClaim`(含 source ⊆ 授权来源)+ factKey 去 modality + polarity 拆分**;provider 调用 → mention writeback 全链路 + exactly-once。(choice 仍 authored;LLM 润色 choice 另列 PR。)
- **LLM-4 生产化** — 修复重试 + 总预算上限;fallback;prompt caching metrics;token/cost accounting;rate limit;日志脱敏(仅分类 + requestId);provider/model 路由配置;可选离线/typewriter reveal。

## 非目标(本阶段不做)

- streaming 实时展示(v1 先完整生成→过 gate→可选逐字播放)。
- 让 LLM 创造带游戏效果的玩家选项 / 自造事实 / 改状态。
- 谣言传播 / believed-state(仍只留 `BeliefProjection` 接口;接入后 gate 不改)。
- 旧存档迁移([[no-save-backcompat]])。

## 已拍板决策

1. **provider 返回契约是原子破坏性迁移**(LLM-1 同 PR 全量迁移,不留旧返回类型);非「向后兼容」。
2. **`DialogueToolOutput`(模型)与 `DialogueProviderResult`(adapter)拆开**;tool schema 只由 `DialogueToolOutput` 派生;`speaker`/`usage`/`providerMeta` 由 adapter 补,不交给模型。
3. **保留 `choices` 但 v1 用 authored 文本**,LLM-1…3 不让模型渲染玩家选项(只校验 id 不足以防行为篡改);LLM 润色 choice 另列 PR。
4. **`assembleClaims` 产 `AuthorizedClaim`(带授权来源)**;`isClaimCoveredByAllowedClaim` 须校验 `proposed.sourceContextIds ⊆ 授权来源`,防 mention 伪造。
5. **fact key 不含 modality**;`deny` 拆为 `polarity`,认知模态线性序 `rumor<suspect<assert`;禁 `deny<rumor` 数值排序(迁移成本高时至少出 truth table)。
6. 结构化输出走 **strict forced tool `emit_dialogue_line`**,禁自由文本;v1 不 streaming。
7. `claim_not_allowed` 为第 7 个 violation;**唯一一份总体 spec(本文件)**,LLM-1…4 各只出 plan。
8. eval **online/batch 共用** compiler/schema/parser/gates/scoring;**batch/promptCaching 是 `ProviderCapabilities`**,不支持则降 online 或跳过。
9. 重试**总预算**:transport≤2 / protocol≤1 / claim repair≤1 / 单请求 provider 调用≤3;**exactly-once 写回**(失败尝试不写 mention、不改状态)。
10. **`ModelRef` 显式厂商**,`remoteProvider` 不靠字符串猜;**API key 不进前端**经 relay;日志仅存分类 + requestId。
11. 模型分层:Sonnet 4.6 默认、Opus 4.8 重要剧情可选、Haiku 4.5 闲聊待 eval 验证、GPT/Gemini 仅作对照/低成本备选(上线前 pin 精确 model id)。

## 关键默认(实现期可据现有代码择优,plan 标注)

- `dialogueToolOutputJsonSchema` 由 zod(`proposedClaimSchema` 等)**单源派生**,与 parser 同一来源,防 schema 与解析漂移(沿用 `gameTimeShape` 等价性先例)。
- `offeredContextIds`/`offeredContextRefs` 已是**单源派生自实际下发的 request**(见 `orchestrator.buildDialoguePolicyContext`);`claim_not_allowed` 的来源校验复用同一集合,并加 typed `ContextRef`(memory/event/fact)。
- 认知模态线性序 `rumor < suspect < assert`;`polarity`(affirm/deny)独立比对,不混入强度序。
- adapter 不做任何事实/礼制校验——全部交给既有 `claimGate` + `gates`(text);也不信任模型填的 `speaker`。
- `choiceCandidates` 的 `effectIds`/`authoredText` 永不进 prompt 载荷(只暴露 `id`+`intent`)。
