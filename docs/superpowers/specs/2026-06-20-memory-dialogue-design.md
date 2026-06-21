# 记忆 / 对话「活人感」系统 — 设计

> 让后宫角色拥有连续记忆、随情境变化的态度、看人下菜的表达,而不退化成「复读事件摘要」的 NPC。
> 跨 5 个 PR 的子系统;本 spec 锁定设计与 PR 边界,每个 PR 单独出实现 plan(PR 接口依赖前序 PR 落地后才能精确成稿)。

## 核心原则

> **引擎决定角色「知道什么 / 想表达什么 / 敢不敢表达」;LLM 只负责把它说成人话。**

把这五个问题**彼此独立**:① 事实此刻是否成立 ② 角色是否知道 ③ 角色怎么看 ④ 角色敢不敢说 ⑤ 这次会不会想起来。混在一起就会出现:反复提同一件事、永久创伤霸占全部对话、已搬走还说「如今同住」、人人说同质化的话、模型乱判断谁知道谁喜欢谁。

## 五类信息(取代早期「三层」表述)

| # | 类别 | 语义 | 落地 |
|---|---|---|---|
| 1 | **当前世界状态** | 此刻什么是真的 | 从 `standing`/`bloodline`/角色表**实时派生**(`TemporalFact`),不进记忆 |
| 2 | **客观事件编年史** | 曾经发生过什么(不可变) | **新增** `GameState.chronicle: CourtEvent[]`(append-only) |
| 3 | **角色认知** | 谁知道这件事 | `canKnowEvent()` 规则 + 后续 `EventAwareness`(私密/谣言才落行) |
| 4 | **私人记忆** | 这件事对「我」意味着什么 | **原位演进**现有 `MemoryEntry`/`CharacterMemoryStore` |
| 5 | **长期性格/立场** | 角色是怎样的人 | `SocialDisposition` 派生偏见 + 现有 `stances` + `standing.affection` |

### 关键的代码现状对齐(grounded deviations)

- **`chronicle` 必须独立于 `eventLog`,不是「升级」它。** 现有 `eventLog: {eventId, firedAt}[]`(`events/resolve.ts:70` 写、`events/conditions.ts:22` `hasEventFired` 读、`events/engine.ts` 读 recency)是**事件触发记账**,不是世界编年史。新增 `chronicle` 承载生育/夭折/降位/搬迁等「剧情事实」,`eventLog` 原样保留。
- **私人记忆原位演进 `MemoryEntry`**(见 [[no-save-backcompat]],预发布可破坏式改 shape,不写迁移)。现有 `MemoryEntry` 已有 `salience`/`protected`/`participants`/`kind`/`source`;扩为下文字段,`protected` 由 `retention:"permanent"` 取代。
- **新增 `CharacterStanding.palaceEnteredAt`**:state 现无「入宫时刻」,`canKnowEvent` 必需。
- **新增 `compareGameTime`**:`calendar/time.ts` 现有 `dayIndexOf`/`monthOrdinal`,无比较器;知情资格判定需要它(按 `dayIndex` 比较)。

## 数据结构(设计定稿)

### 2 客观事件编年史

```ts
type CourtEventType =
  | "residence_changed" | "heir_born" | "heir_died"
  | "rank_changed" | "punished" | "rewarded"
  | "conflict" | "promise" | "secret_discovered";
  // claim_corrected(谣言被证伪的更正事件)延后到【首个真正拥有错误信念/可证伪 claim 的 PR】,
  // 而非承诺 PR5:它需要生产者(产生错误信念的途径)与消费者(读取更正的 gate)。PR5 可建 claim
  // assembler 与 fact-conflict gate,但若届时仍无生产者/消费者,PR5 也不加入该类型。append-only
  // 原则现仅写进本 spec。

type KnowledgePersistence =
  | "contemporaneous"  // 仅事件发生时已在该范围内者默认知道(普通降位、口角、搬宫)
  | "institutional";   // 后来进入该范围者也默认知道(生育/夭折/册后/登基等宫史)

/** 判别联合:无效组合(circle 缺 circleIds / palace 带 circleIds / realm+contemporaneous)在数据入口即失败。 */
type CourtEventPublicity =
  | { scope: "circle"; circleIds: string[] }
  | { scope: "palace"; persistence: KnowledgePersistence }
  | { scope: "realm"; persistence: "institutional" };   // v1 不允许 realm+contemporaneous

interface CourtEventParticipant {
  charId: string;
  /** 显式角色,不靠数组位置:birth_father / adoptive_father / sovereign_parent / newborn / demoted / … */
  role: string;
}

/** 一条不可变的「曾经发生过什么」。append-only,永不回写;更正用 claim_corrected 新事件。 */
interface CourtEvent {
  id: string;                     // "evt_000001" 单调(由现有最大序号+1 派生)
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];   // 替代 actorIds/subjectIds:角色显式
  locationId?: string;
  payload: Record<string, unknown>;        // 仅非角色标量(birthOrder/sex/from-to rank …)
  publicity: CourtEventPublicity;
  publicSalience: number;         // 0–100
  retention: MemoryRetention;     // 公共事件也参与有效强度衰减(与私人记忆同一检索公式)
  tags: string[];
}
```

> **严格不可变**:复位/改封**追加** `rank_changed`,不改旧事件;谣言证伪(首个有错误信念/可证伪 claim 的 PR)将**追加** `claim_corrected`(`payload: { correctedEventId, correctedPredicate }`),原「曾出现传闻」与「后查明不实」两条都为真。`CourtEvent` **无** `invalidatedAt`/`supersededBy` 字段——绝不回写;需失效索引则**另建派生索引**。

授定典型:

| 事件 | scope | persistence |
|---|---|---|
| 皇嗣出生/夭折 | palace 或 realm | institutional |
| 册后/废后/登基 | realm | institutional |
| 普通侍君降位 | palace | contemporaneous |
| 搬宫/口角 | palace | contemporaneous |
| 私下密议 | circle | （不适用——circle 只有 `circleIds` 显式名单，无 persistence 字段） |

> **不可变性**:顾侍君降位后又复位,**不撤销**降位事件——追加一条 `rank_changed`。当前位分由第 1 类(`standing`)派生。原事件永不回写。

### 3 知情资格

两条**时间闸**必须在 scope 分支**之前**(否则未来入宫者经 circle/realm 仍偷知,且谁都能预知未来事件):

```ts
function canKnowEvent(state, charId, event): boolean {
  const standing = state.standing[charId];
  if (!standing) return false;                       // 未知/不存在角色:一律不知道
  const now = toGameTime(state.calendar);
  // 闸1:尚未入宫的未来角色 → 对所有 scope 都不知情
  if (standing.palaceEnteredAt && compareGameTime(standing.palaceEnteredAt, now) > 0) return false;
  // 闸2:编年史只载「已发生」;未来事件谁都不知道
  if (compareGameTime(event.occurredAt, now) > 0) return false;

  const p = event.publicity;
  if (p.scope === "circle") return p.circleIds.includes(charId);
  if (p.scope === "realm")  return true;             // v1: realm 必为 institutional(schema 保证)
  // palace:须在宫
  const enteredAt = standing.palaceEnteredAt;
  if (!enteredAt) return false;
  return p.persistence === "institutional" || compareGameTime(enteredAt, event.occurredAt) <= 0;
}
```

> **删除 `existedAt`**(错误抽象:`palaceEnteredAt` 缺失 ≠ 几十年前已存在;且对未知 id 误返 true)。`realm + contemporaneous` 由判别联合在 **schema 层禁止**。`appendCourtEvent` 同样**拒绝未来事件**(occurredAt > now 抛错)——编年史只记已发生。

后续(非 MVP)接入 `EventAwareness{learnedAt, source, certainty, discussability}`:仅 private/circle/rumor 落行,palace/realm 继续走规则。

### 4 私人记忆(演进 `MemoryEntry`)

```ts
type MemoryKind =
  | "episodic" | "trauma" | "grievance" | "gratitude"
  | "promise" | "secret" | "impression";
type MemoryRetention = "fast" | "slow" | "permanent";
type MemoryPerspective =
  | "actor" | "target" | "witness" | "parent" | "ally" | "enemy" | "relative";
type MemoryEmotion =
  | "joy" | "grief" | "fear" | "anger" | "envy" | "shame" | "guilt" | "relief";

interface MemoryEntry {
  id: string;
  ownerId: string;
  kind: MemoryKind;
  sourceEventId?: string;          // 关联 chronicle CourtEvent
  subjectIds: string[];
  perspective: MemoryPerspective;
  summary: string;                 // POV,供降级展示
  strength: number;                // 0–100,记忆本身的牢固度(替代旧 salience)
  retention: MemoryRetention;      // permanent 取代旧 protected
  emotions: Partial<Record<MemoryEmotion, number>>;
  triggerTags: string[];           // 触发加分必须由记忆声明对应 tag
  unresolved: boolean;
  createdAt: GameTime;
}
```

> 私人记忆同样 **append-only**:不回写「失效」。角色「不再相信 X」追加一条新 `impression`/`fact_learned`,旧条目保留(它记录的是「当时如此认为」)。
> **无 `lastRetrievedAt`**:「被选入上下文」≠「实际说出口」。冷却由有界 `MemoryMentionRecord`(PR4,只在**真正提及**时落)承担,不把检索时刻写回记忆。

`EmotionalCondition`(与永久创伤记忆**分开**:记一辈子 ≠ 每句都哭):

```ts
interface EmotionalCondition {
  id: string;                      // "cond_<ownerId>_000001"
  ownerId: string;                 // 这是谁的情绪状态(缺它无法区分「谁在悲伤」)
  type: "acute_grief" | "prolonged_grief" | "resentment" | "anxiety" | "infatuation" | "humiliation";
  sourceEventId: string;
  severity: number;
  startedAt: GameTime;
  recoveryProfile: "fast" | "normal" | "slow" | "stuck";
}
```

### 衰减 + 检索(乘加混合,禁纯乘积)

`strength`(是否遗忘)与 `activation`(这次是否想起)严格分离:

```ts
effectiveStrength(m, now) =
  m.retention === "permanent" ? m.strength
                              : m.strength * halfLife(ageDays(m, now), HALF[m.retention]);

retrievalScore(m, plan, ctx, state) =
    effectiveStrength(m, now) * (BASE_RELEVANCE + TOPIC_WEIGHT * topicRelevance)   // 话题是放大器
  + ANNIVERSARY_WEIGHT  * anniversaryMatch     // ↓ 加项:可独立抬分,不被话题=0 清零
  + LOCATION_WEIGHT     * locationMatch
  + SUBJECT_WEIGHT      * subjectPresentMatch
  + UNRESOLVED_WEIGHT   * unresolvedMatch
  + CONDITION_WEIGHT    * emotionalConditionMatch
  - recentMentionPenalty;
```

- 所有 `*Match ∈ [0,1]` 归一化;触发加分**要求** `m.triggerTags` 声明对应 tag(如忌辰需 `triggerTags.includes("anniversary") && isEventAnniversary(...)`)。
- **禁纯乘积**:`score = eS*topic*ctx*trigger` 会在日常问安(topic=0)时把忌辰触发也清零——违背「相关场景才高激活」。
- `MEMORY_CONFIG = { halfLifeDays: { fast: 75, slow: 720 }, minimumRetrievalSalience: 25 }`。
- `permanent` 语义 = **不因时间衰减**;**不**意味着必进 top-N、不绕过冷却、不每轮必发给模型。高强度 permanent 进**第一阶段候选池**,最终仍按 `retrievalScore` 精排。
- `minimumRetrievalSalience` 是**候选门槛**,排名靠 `retrievalScore`。

### 反应规划(`primary` + 可选 `undertone`,两套枚举)

```ts
type ReactionPrimary =      // 外显言语行为(唯一)
  | "congratulate" | "praise" | "comfort" | "petition" | "defend"
  | "criticize" | "agree" | "probe" | "warn" | "reassure"
  | "confide" | "gloat" | "avoid_topic" | "change_subject" | "remain_reserved";
type ReactionUndertone =    // 台词下泄露的潜台词(至多一个)
  | "envy" | "resentment" | "contempt" | "fear" | "grief" | "guilt"
  | "affection" | "admiration" | "suspicion" | "calculation" | "reluctance";

interface ReactionPlan {
  subjectIds: string[];
  primary: ReactionPrimary;
  undertone?: { type: ReactionUndertone; intensity: number; concealment: number };
  intensity: number;        // 外显强度
  openness: number;         // 坦率/收敛
  claimNeeds: ClaimNeed[];  // 「想表达哪些断言」的抽象需求,不含具体 claim id
  rationaleCodes: string[]; // 调试:为何这样规划
}
```

> **PR3 只产 `claimNeeds`(抽象需求)。** 具体 `allowedClaimIds`/`forbiddenClaimIds` 的组装属 **PR5**(claim assembler,需当前事实/believedState/在场)。PR3 不碰具体 claim,避免把 PR5 的事实装配提前耦合进规划器。

- **不用任意 intent 数组**:外显只一个、潜台词至多一个 → 可演口是心非(表面 `congratulate` + `undertone:envy/concealment:85`),TDD 断言稳定,不会三个方向争台词。
- 纯函数 `planReaction({candidateSubjects, candidateEvents, believedState, relations, audienceContext, dispositions})`;**确定性**(同输入同输出),同分 tie-break 用稳定排序,需抖动用 `stableNoise(saveSeed, speakerId, turnId, candidateId)`,**禁 `Math.random()`**。
- **已知取舍**:单 `undertone` 下「表面恭贺、底下泛酸」可表达,但「恭贺为真+酸意极淡」与「敌意伪装成恭贺」共用 `congratulate+envy`,细分度有限;MVP 接受。

### 关系(传数值,不传形容词)

```ts
interface SubjectRelation {
  charId: string;
  affection: number; trust: number; hostility: number;
  envy: number; fear: number; respect: number;
  stance: "devoted" | "friendly" | "neutral" | "competitive" | "contemptuous" | "hostile";
  reasons: string[];        // 可读理由,供模型润色不许臆造
}
interface SocialDisposition {   // MVP 先三轴,其余按需
  statusConsciousness: number; compassion: number; discretion: number;
  // 后续: jealousy / ambition / courage
}
```

「世家轻视寒门新人」由**三轴 MVP**派生,例如 `classBias = statusConsciousness*0.7 - compassion*0.5`(不读尚不存在的 `ambition`),再叠加新人家世/恩宠/是否威胁/是否同住/共同好友/帝王是否偏爱——故温厚者不排斥、失宠者反而亲近,**不**一刀切。`ambition`(野心家假亲近)等权重待 disposition 扩轴后接入。

### 6 对话场景约束(audience = 听众身份 + 在场人 + 私密度)

```ts
interface DialogueAudienceContext {
  targetId: string;
  targetRole: "sovereign" | "consort" | "heir" | "official" | "servant";
  presentCharacterIds: string[];     // 在场旁人
  privacy: "public" | "semi_private" | "private";
}
```

同样对帝王:朝宴公开 / 寝殿独处 / 帝王私下追问,尺度不同。谨慎角色(`discretion` 高)即便对宫人,人多处也不诋毁高位侍君。gate 不只判「对陛下不能幸灾乐祸」,还判在场与私密度。

### 结构化 claim(约束不靠自然语言)

```ts
interface DialogueClaim {
  id: string;
  predicate: "resides_at" | "currently_same_residence" | "parent_of"
    | "responsible_for" | "holds_rank" | "alive" | "caused_event";
  subjectId: string;
  object?: string | boolean | number;
  modality: "assert" | "suspect" | "rumor" | "deny";
  certaintyCeiling?: number;
}
```

旧搬宫事件结论与当前 `TemporalFact` 相反时,纯函数**自动**产出 `{predicate:"currently_same_residence", subjectId, object:shenId, modality:"assert"}` 加入 `forbiddenClaims`。自然语言提示只是这些 claim 的**渲染结果**,非事实来源。

### 信念投影(为错误信念留接口边界,MVP 不实现错信)

```ts
interface CurrentFactVisibility { canSee(state, viewerId, key): boolean; }
interface BeliefProjection { getFact(charId: string, key: FactKey): BelievedFact | undefined; }
class GroundTruthBeliefProjection implements BeliefProjection {
  constructor(state, visibility: CurrentFactVisibility) {}   // 必传可见性,杜绝全知
}
```

- v1:`believedState(char) === **可见的** ground truth`——**非全知**。`getFact` 先过 `visibility.canSee`,未知 viewer / 无权查看 → `undefined`。MVP 可见性 = viewer 与 subject **均须「此刻在场」**(`isCurrentlyPresent`:有 standing 且 `palaceEnteredAt ≤ now`)——尚未入宫的未来角色既不能看、也不能被看;`alive` 谓词留待皇嗣生命周期建模后(本 PR 不含)。fact gate 本版校验**角色可见的 ground truth**。
- API **从第一版就走 `BeliefProjection`**,不写死 `validateAgainstGroundTruth`。接入 rumor 后替换实现、gate 接口不变。
- 系统效果(`applyEffects`)**永远只用 ground truth**:角色相信某人下毒 ≠ 引擎给某人写「凶手」。
- gate 违规类型:`contradicts_speaker_belief | reveals_unknown_fact | claims_excessive_certainty | violates_etiquette | identity_mismatch`。

## 事件 → 记忆 编译(规则注册表,不在剧本手挂)

```ts
interface EventMemoryRule {
  eventType: CourtEventType;
  defaultPublicity: CourtEventPublicity;
  publicSalience: number;
  createPersonalMemories(event, state): MemoryEntry[];
  applyRelationshipEffects(event, state): RelationshipEffect[];
  applyConditions?(event, state): EmotionalCondition[];
}
```

统一提交流程 `commitCourtEvent`(原子事务):改世界状态 → append `chronicle` → propagate awareness → 规则注册表派生私人记忆/关系/情绪 condition。例:`heir_died` → palace+institutional chronicle(salience 100)+ 生父/养父各一条 `retention:"permanent"` trauma 记忆(`emotions.grief` 高、生父 guilt 40 / 养父 guilt 90)+ 为双亲建 `acute_grief` condition。

## 最终数据流

```
剧情/系统事件
  → 改当前世界状态(TemporalFact 来源)
  → 写唯一不可变 CourtEvent 进 chronicle
  → propagateAwareness(谁知道)
  → 规则注册表:为亲历者生成带情绪的私人记忆 + 关系/情绪 condition
对话时:
  → 派生当前事实 + believedState
  → Phase1 轻量候选召回(话题/在场/高 strength 记忆/可知近期事件,top~20)
  → Phase2 reactionPlanner 选 primary(+undertone) + claimNeeds(纯函数;不组装具体 claim)
  → Phase3 意图导向精排(乘加混合公式 + 冷却,top 3–5)
  → PR5 claim assembler:由 claimNeeds + 当前事实/believedState 组装 allowed/forbidden claims
  → LLM 只生成台词
  → gate 按 believedState 校 身份/礼制/越权/泄密/事实冲突/过度确定
  → 仅当**实际提及**某记忆时,写一条有界 MemoryMentionRecord(不写回 lastRetrievedAt)
```

**两阶段(召回→规划→精排)避免循环**:「没记忆选不了 intent / 没 intent 检索不了」。

## PR 分解(每 PR 独立 plan,单独可测可交付)

- **PR1 事件 / 状态 / 知情资格** — `compareGameTime`;`CourtEvent` + `chronicle` 状态/schema/持久化/init;`appendCourtEvent`;`CharacterStanding.palaceEnteredAt` + newGame 播种;`canKnowEvent`(scope+persistence);`BeliefProjection` 接口 + `GroundTruthBeliefProjection`。*(本 plan 已成稿,见 plans/2026-06-20-memory-dialogue-pr1-events-awareness.md)*
- **PR2 演进 `MemoryEntry`** — strength/retention/emotions/perspective/triggerTags/unresolved/ownerId/sourceEventId(破坏式,删 `protected`/`salience`);`EmotionalCondition`(含 `id`/`ownerId`)仅存储不自动恢复;`EventMemoryRule` 注册表 + `commitCourtEvent`;`heir_born`/`heir_died`/`rank_changed`/`residence_changed` 四条规则。**硬前置**:实现 `heir_died` 规则**之前**,必须先给皇嗣加权威生死状态 `Heir.lifecycle: "alive" | "deceased"` + `deceasedAt?: GameTime`(现 `Heir` 无生死字段),随后才恢复 `alive` 谓词。否则会出现 chronicle/私人记忆都说皇嗣已夭折、`bloodline.heirs` 仍当活人参与互动的状态分裂。**同时**:皇嗣 lifecycle 落地时,把 `canKnowEvent`/`isCurrentlyPresent` 的「角色存在与在场」判断**扩展到皇嗣**(现仅依赖 `state.standing`,皇嗣只存于 `bloodline.heirs`、无 standing → 会被当未知角色,无法知道任何事件)。
- **PR3 候选召回 + ReactionPlanner** — Phase1 召回;`SubjectRelation` 派生;`SocialDisposition`(三轴);`planReaction` 纯函数(primary+undertone、稳定 tie-break);table-driven 测试。
- **PR4 激活 / 精排 / 冷却** — 乘加混合 `retrievalScore`;场景触发(忌辰/旧居/在场);`MemoryMentionRecord`(`MAX_MENTIONS_PER_CHARACTER=100`、`MENTION_LOOKBACK_DAYS=180` 裁剪);填充 `DialogueRequest.relevantMemories` → 升级为结构化 `DialogueMemoryContext`。
- **PR5 对话装配 + gates** — `DialogueAudienceContext` 全量;`DialogueClaim` 结构化 + 自动派生事实冲突 forbiddenClaims;gate 经 `BeliefProjection` 校验(身份/礼制/越权/泄密/事实冲突/过度确定);写回提及。

## 非目标(本子系统不做)

- 动态谣言传播 / 八卦扩散图;`certainty` 与错误信念(只留 `BeliefProjection` 接口边界)。
- `EmotionalCondition` 自动恢复/转化 tick(PR2 只存储)。
- `SocialDisposition` 全轴(先三轴)。
- 旧存档迁移(见 [[no-save-backcompat]])。

## 已拍板决策

1. `chronicle` 独立于 `eventLog`(代码现状:后者是事件触发记账)。
2. 私人记忆**原位演进** `MemoryEntry`,删 `protected`/`salience` → `retention`/`strength`。
3. `ReactionPlan` = 单 `primary` + 可选单 `undertone`(两套枚举)。
4. 检索 = 乘加混合,`permanent` 不等于必进/绕冷却。
5. 知情 = `palaceEnteredAt` + `publicity.persistence`(contemporaneous|institutional)。
6. gate v1 校 ground truth,但走 `BeliefProjection` 接口;接 rumor 后切 believed-state。
7. 确定性:纯函数 + 稳定排序 + `stableNoise`,禁 `Math.random()`。
8. 称谓遵循 [[official-naming-rule]];侍君对帝言谈遵循 [[dialogue-etiquette-rule]];住处/搬迁复用 [[consort-residence-relocation]]。

## 关键默认(实现期可据现有代码择优,已在 plan 标注)

- `chronicle` 事件 id 单调 `evt_NNNNNN`,由**现有最大序号 +1** 派生(非 `length+1`,防未来导入/空洞重号)。
- `palaceEnteredAt` 存 `GameTime`;开局授定侍君 = `initialStanding.palaceEnteredAt ?? 开局时刻`(**不覆盖** authored 历史值),后续入宫 = 入宫事件 `occurredAt`,非常住者 `undefined`。**Invariant**:所有创建/更新 `CharacterStanding` 的入宫流程(选秀等)**必须**写 `palaceEnteredAt`,否则 `canKnowEvent` 视其不在宫。
- `compareGameTime` 按 `dayIndex` 升序比较(periodic 粒度足够)。
- `CourtEventPublicity` 为判别联合 + `z.discriminatedUnion("scope", …)`:`realm+contemporaneous`、`circle` 缺 `circleIds`、`palace` 带 `circleIds` 在数据入口即失败。
- `BeliefProjection` v1 **非全知**:必传 `CurrentFactVisibility`;无权查看 / 未知 viewer → `undefined`。系统效果(`applyEffects`)永远只用 ground truth。
- 自动派生「事实冲突 claim」放 **PR5**(gate 是其唯一消费者;PR1 只交付其依赖的 `chronicle`+`standing` 数据,避免 YAGNI 空挂)。`alive` 谓词随皇嗣生命周期建模(PR2+)落地。
- `content/schemas.ts` 的本地 `gameTimeShape` 与 `save/stateSchema.ts` 的 `gameTimeSchema` 须有**等价性测试**(同样本同接受/拒绝),防漂移。
