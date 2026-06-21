# 记忆/对话系统 PR3：候选召回 + ReactionPlanner — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「引擎决定角色想表达什么 / 敢不敢表达」落地：从授定 `stances` + 动态 `affection` 派生 `SubjectRelation`，从 `personalityTraits` 派生 `SocialDisposition`，用纯函数 `planReaction` 按 关系×听众×性格×事件 选出 `ReactionPlan`（外显 `primary` + 可选潜台词 `undertone`），并做第一阶段候选召回。

**Architecture:** 全部纯函数、确定性、table-driven，**不做模糊 NLP/字符串相似度/LLM 映射**——映射靠集中式词表，未识别值走稳定回退 + 诊断。`planReaction` 在 LLM 之前定意图，LLM 零意图自由度（PR5 才接 LLM/gate）。本 PR 不改授定内容格式，不接 `DialogueRequest`（PR4 填 `relevantMemories`、PR5 装配 audience）。

**Tech Stack:** TypeScript, Zod（仅诊断类型，不新增 schema）, Vitest。新代码集中在 `src/engine/dialogue/`。

## Global Constraints

- 纯函数 / 确定性（同输入同输出），**禁 `Math.random()`**、禁字符串相似度、禁 LLM 猜测。
- 数值轴 clamp（disposition 0–100；relation affection −100..100，其余 0–100）。
- **未识别授定值不静默猜测、不致角色加载失败**：回退中性 + 结构化 `diagnostics`（dev 记 warning，prod 稳定回退）。
- 不改授定内容格式（`stances` 仍 freeform `attitude:string`；`personalityTraits` 仍文本标签）。未来 override 兼容留后续，不在本 PR。
- `stance` 是叙事方向、数值是当前强度：动态 `affection` 只**微调**数值，**不翻转** authored stance。
- 称谓/礼制遵循 [[dialogue-etiquette-rule]]、[[official-naming-rule]]。
- 基线：PR2 已并入 main（644 green, tsc clean）；本 PR 在 `worktree-memory-dialogue-pr34` 分支。

## File Structure

- `src/engine/dialogue/reactionTypes.ts` — `ReactionPrimary`/`ReactionUndertone`/`ReactionPlan`/`ClaimNeed`/`AudienceContext`/`EventReactionContext`（纯类型）。
- `src/engine/dialogue/disposition.ts` — `SocialDisposition` + `PERSONALITY_TRAIT_DELTAS` + `deriveDisposition`。
- `src/engine/dialogue/subjectRelation.ts` — `RelationStance`/`RelationVector`/`SubjectRelation` + `ATTITUDE_ALIASES` + `STANCE_DEFAULTS` + `deriveSubjectRelation`。
- `src/engine/dialogue/planReaction.ts` — `planReaction`（四事件类型）。
- `src/engine/dialogue/recall.ts` — `recallCandidates`（第一阶段召回）。

---

### Task 1: 反应规划类型（reactionTypes.ts）

**Files:**
- Create: `src/engine/dialogue/reactionTypes.ts`
- Test: `tests/dialogue/reactionTypes.test.ts`（新建）

**Interfaces:**
- Produces（下游 Task 4/5 依赖）:

```ts
export type ReactionPrimary =
  | "congratulate" | "praise" | "comfort" | "petition" | "defend"
  | "criticize" | "agree" | "probe" | "warn" | "reassure"
  | "confide" | "gloat" | "avoid_topic" | "change_subject" | "remain_reserved";
export type ReactionUndertone =
  | "envy" | "resentment" | "contempt" | "fear" | "grief" | "guilt"
  | "affection" | "admiration" | "suspicion" | "calculation" | "reluctance";

export interface ClaimNeed {
  /** 抽象表达需求（不含具体 claim id；PR5 组装真实 claim）。 */
  about: "subject_event" | "self_feeling" | "relationship";
  subjectId?: string;
}
export interface ReactionPlan {
  subjectIds: string[];
  primary: ReactionPrimary;
  undertone?: { type: ReactionUndertone; intensity: number; concealment: number };
  intensity: number;        // 0–100 外显强度
  openness: number;         // 0–100 坦率/收敛
  claimNeeds: ClaimNeed[];
  rationaleCodes: string[]; // 调试：为何这样规划
}

export type AudienceRole = "sovereign" | "consort" | "heir" | "official" | "servant";
export interface AudienceContext {
  targetRole: AudienceRole;
  privacy: "public" | "semi_private" | "private";
  presentCharacterIds: string[];
}
export interface EventReactionContext {
  eventType: "heir_born" | "heir_died" | "rank_changed" | "residence_changed";
  subjectId: string;                 // 事件主角（被降位者/生育者/夭折之亲等）
  direction?: "demote" | "promote";  // 仅 rank_changed
}
```

- [ ] **Step 1: 写测试**

新建 `tests/dialogue/reactionTypes.test.ts`（类型无运行逻辑，用一个最小构造 + `satisfies` 锁形状）：

```ts
import { describe, expect, it } from "vitest";
import type { ReactionPlan } from "../../src/engine/dialogue/reactionTypes";

describe("ReactionPlan 形状", () => {
  it("可构造 primary+undertone 的口是心非计划", () => {
    const plan: ReactionPlan = {
      subjectIds: ["consort_gu"], primary: "congratulate",
      undertone: { type: "envy", intensity: 70, concealment: 85 },
      intensity: 45, openness: 30,
      claimNeeds: [{ about: "subject_event", subjectId: "consort_gu" }],
      rationaleCodes: ["birth_competitor_concealed_envy"],
    };
    expect(plan.primary).toBe("congratulate");
    expect(plan.undertone?.type).toBe("envy");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

Run: `npx vitest run tests/dialogue/reactionTypes.test.ts`（FAIL：模块不存在）→ 新建 `reactionTypes.ts` 含上方类型 → PASS。

- [ ] **Step 3: 提交**

```bash
git add src/engine/dialogue/reactionTypes.ts tests/dialogue/reactionTypes.test.ts
git commit -m "feat: 反应规划类型（ReactionPrimary/Undertone/Plan/Audience/EventReactionContext）"
```

---

### Task 2: `SocialDisposition` + `deriveDisposition`（标签→三轴，中性基线叠加）

**Files:**
- Create: `src/engine/dialogue/disposition.ts`
- Test: `tests/dialogue/disposition.test.ts`（新建）

**Interfaces:**
- Produces:
  - `interface SocialDisposition { statusConsciousness: number; compassion: number; discretion: number }`
  - `const DEFAULT_DISPOSITION`（三轴均 50）
  - `const PERSONALITY_TRAIT_DELTAS: Record<string, DispositionDelta>`
  - `deriveDisposition(traits: readonly string[]): { disposition: SocialDisposition; diagnostics: { code: "unknown_personality_trait"; trait: string }[] }`
- 派生：中性基线 50 → 各已知标签增量叠加（**一标签可影响多轴**）→ clamp 0–100。未映射标签**忽略**（不警告、不致加载失败——许多 trait 是对话风格/人设，与三轴无关）。增量幅度：弱 ±5–10 / 中 ±15–20 / 强 ±25–30。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/disposition.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { deriveDisposition, DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";

describe("deriveDisposition", () => {
  it("无标签 → 中性基线 50/50/50", () => {
    expect(deriveDisposition([]).disposition).toEqual(DEFAULT_DISPOSITION);
  });
  it("高傲：门第↑、同情↓（多轴）", () => {
    const d = deriveDisposition(["高傲"]).disposition;
    expect(d.statusConsciousness).toBeGreaterThan(50);
    expect(d.compassion).toBeLessThan(50);
  });
  it("多标签确定性叠加 + clamp", () => {
    const d = deriveDisposition(["势利", "刻薄", "高傲"]).disposition;
    expect(d.compassion).toBe(0); // 叠加后下溢 clamp 到 0
    expect(d.statusConsciousness).toBeLessThanOrEqual(100);
  });
  it("未映射标签忽略、不报错、不影响三轴，但进 diagnostics", () => {
    const r = deriveDisposition(["才思敏捷", "仁厚"]);
    expect(r.disposition.compassion).toBeGreaterThan(50); // 仁厚生效
    expect(r.disposition.statusConsciousness).toBe(50);    // 才思敏捷不影响
    expect(r.diagnostics).toContainEqual({ code: "unknown_personality_trait", trait: "才思敏捷" });
  });
  it("确定性：同输入同输出", () => {
    expect(deriveDisposition(["谨慎", "圆滑"])).toEqual(deriveDisposition(["谨慎", "圆滑"]));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dialogue/disposition.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 实现（disposition.ts）**

新建 `src/engine/dialogue/disposition.ts`：

```ts
/** 长期性格三轴（spec 第 5 类，MVP）。中性基线 50，标签增量叠加，clamp 0–100。 */
export interface SocialDisposition {
  statusConsciousness: number; // 门第/位分/礼序敏感度
  compassion: number;          // 同情/宽厚/顾念他人
  discretion: number;          // 克制/谨慎/看场合说话
}
export const DEFAULT_DISPOSITION: SocialDisposition = {
  statusConsciousness: 50, compassion: 50, discretion: 50,
};

type DispositionDelta = Partial<SocialDisposition>;

/** 集中式标签→三轴增量表（一标签可影响多轴；幅度弱±5–10/中±15–20/强±25–30）。 */
export const PERSONALITY_TRAIT_DELTAS: Record<string, DispositionDelta> = {
  高傲: { statusConsciousness: 25, compassion: -10 },
  重礼: { statusConsciousness: 20, discretion: 15 },
  势利: { statusConsciousness: 30, compassion: -20 },
  清高: { statusConsciousness: 15, discretion: 10 },
  仁厚: { compassion: 30 },
  温柔: { compassion: 20, discretion: 5 },
  心软: { compassion: 25, discretion: -5 },
  冷漠: { compassion: -30 },
  刻薄: { compassion: -25, discretion: -10 },
  谨慎: { discretion: 30 },
  克制: { discretion: 25 },
  圆滑: { discretion: 25, statusConsciousness: 10 },
  直率: { discretion: -20 },
  冲动: { discretion: -30 },
  口无遮拦: { discretion: -35 },
};

const clamp = (n: number): number => Math.min(100, Math.max(0, n));

export interface DispositionDiagnostic { code: "unknown_personality_trait"; trait: string }

export function deriveDisposition(traits: readonly string[]): {
  disposition: SocialDisposition;
  diagnostics: DispositionDiagnostic[];
} {
  const acc = { ...DEFAULT_DISPOSITION };
  const diagnostics: DispositionDiagnostic[] = [];
  for (const trait of traits) {
    const delta = PERSONALITY_TRAIT_DELTAS[trait];
    if (!delta) {
      diagnostics.push({ code: "unknown_personality_trait", trait });
      continue; // 未映射标签忽略，不影响三轴、不致加载失败
    }
    acc.statusConsciousness += delta.statusConsciousness ?? 0;
    acc.compassion += delta.compassion ?? 0;
    acc.discretion += delta.discretion ?? 0;
  }
  return {
    disposition: {
      statusConsciousness: clamp(acc.statusConsciousness),
      compassion: clamp(acc.compassion),
      discretion: clamp(acc.discretion),
    },
    diagnostics,
  };
}
```

- [ ] **Step 4: 运行测试 + 提交**

Run: `npx vitest run tests/dialogue/disposition.test.ts` → PASS；`npx vitest run` 全绿。

```bash
git add src/engine/dialogue/disposition.ts tests/dialogue/disposition.test.ts
git commit -m "feat: SocialDisposition + deriveDisposition（标签→三轴，中性基线+clamp，未映射忽略）"
```

---

### Task 3: `SubjectRelation` + `deriveSubjectRelation`（词表→stance→向量→affection 微调）

**Files:**
- Create: `src/engine/dialogue/subjectRelation.ts`
- Test: `tests/dialogue/subjectRelation.test.ts`（新建）

**Interfaces:**
- Produces:
  - `type RelationStance = "devoted"|"friendly"|"neutral"|"competitive"|"contemptuous"|"hostile"`
  - `interface RelationVector { affection; trust; hostility; envy; fear; respect }`
  - `interface SubjectRelation { charId: string; stance: RelationStance } & RelationVector & { reasons: string[] }`
  - `const ATTITUDE_ALIASES: Record<string, RelationStance>`（限定词表，**`防备`→neutral** 不映射 hostile）
  - `const STANCE_DEFAULTS: Record<RelationStance, RelationVector>`
  - `deriveSubjectRelation(input: { charId; authoredAttitude?: string; standingAffection?: number; favorThreat?: number }): { relation: SubjectRelation; diagnostics: {...}[] }`
- 规则：authored attitude → 规范化 stance（未识别→neutral + 诊断，无 NLP）。取 `STANCE_DEFAULTS[stance]` 为基线向量。动态 `affection` 微调：`affection = clamp(baseline.affection*0.6 + standingAffection*0.4, -100, 100)`；正向 affection 略降 hostility、略升 trust；`favorThreat`（对方恩宠上升威胁）略升 envy。**stance 不被 affection 翻转**。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/subjectRelation.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { deriveSubjectRelation, STANCE_DEFAULTS } from "../../src/engine/dialogue/subjectRelation";

describe("deriveSubjectRelation", () => {
  it("交好→friendly 基线向量", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "交好" }).relation;
    expect(r.stance).toBe("friendly");
    expect(r.affection).toBe(STANCE_DEFAULTS.friendly.affection);
  });
  it("防备→neutral（不映射 hostile），低 trust", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "防备" }).relation;
    expect(r.stance).toBe("neutral");
  });
  it("动态 affection 微调数值但不翻转 stance：长期交恶+近期缓和", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "交恶", standingAffection: 40 }).relation;
    expect(r.stance).toBe("hostile"); // 叙事方向不变
    expect(r.affection).toBeGreaterThan(STANCE_DEFAULTS.hostile.affection); // 数值被拉高
  });
  it("favorThreat 升 envy（争宠者）", () => {
    const base = deriveSubjectRelation({ charId: "a", authoredAttitude: "争宠" }).relation;
    const threatened = deriveSubjectRelation({ charId: "a", authoredAttitude: "争宠", favorThreat: 30 }).relation;
    expect(threatened.envy).toBeGreaterThan(base.envy);
  });
  it("未识别 attitude→neutral + 诊断（不猜测、不报错）", () => {
    const r = deriveSubjectRelation({ charId: "a", authoredAttitude: "若即若离" });
    expect(r.relation.stance).toBe("neutral");
    expect(r.diagnostics).toContainEqual({ code: "unknown_authored_attitude", value: "若即若离" });
  });
  it("缺 attitude→neutral 无诊断；确定性", () => {
    expect(deriveSubjectRelation({ charId: "a" }).relation.stance).toBe("neutral");
    expect(deriveSubjectRelation({ charId: "a", authoredAttitude: "嫉妒" }))
      .toEqual(deriveSubjectRelation({ charId: "a", authoredAttitude: "嫉妒" }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dialogue/subjectRelation.test.ts` → FAIL。

- [ ] **Step 3: 实现（subjectRelation.ts）**

新建 `src/engine/dialogue/subjectRelation.ts`：

```ts
/** 说话人对某当事人的关系（spec：数值 + stance 枚举 + reasons）。词表驱动，确定性，无 NLP。 */
export type RelationStance =
  | "devoted" | "friendly" | "neutral" | "competitive" | "contemptuous" | "hostile";

export interface RelationVector {
  affection: number; trust: number; hostility: number; envy: number; fear: number; respect: number;
}
export interface SubjectRelation extends RelationVector {
  charId: string;
  stance: RelationStance;
  reasons: string[];
}

/** 限定别名词表（不做字符串相似度）。`防备` 归 neutral，用低 trust/高 suspicion 表达，不当 hostile。 */
export const ATTITUDE_ALIASES: Record<string, RelationStance> = {
  亲近: "friendly", 交好: "friendly", 友善: "friendly",
  忠心: "devoted", 敬爱: "devoted",
  平淡: "neutral", 不熟: "neutral", 疏远: "neutral", 防备: "neutral",
  争宠: "competitive", 竞争: "competitive", 嫉妒: "competitive",
  轻视: "contemptuous", 鄙夷: "contemptuous",
  交恶: "hostile", 敌视: "hostile", 仇恨: "hostile",
};

export const STANCE_DEFAULTS: Record<RelationStance, RelationVector> = {
  devoted:      { affection: 75, trust: 80, hostility: 0,  envy: 5,  fear: 10, respect: 80 },
  friendly:     { affection: 45, trust: 55, hostility: 5,  envy: 10, fear: 5,  respect: 45 },
  neutral:      { affection: 0,  trust: 20, hostility: 5,  envy: 5,  fear: 5,  respect: 20 },
  competitive:  { affection: -10, trust: 15, hostility: 25, envy: 55, fear: 10, respect: 30 },
  contemptuous: { affection: -30, trust: 10, hostility: 25, envy: 5,  fear: 0,  respect: 0 },
  hostile:      { affection: -65, trust: 0,  hostility: 80, envy: 25, fear: 15, respect: 5 },
};

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));
const clampSigned = (n: number): number => Math.min(100, Math.max(-100, n));

export interface RelationDiagnostic { code: "unknown_authored_attitude"; value: string }

export function deriveSubjectRelation(input: {
  charId: string;
  authoredAttitude?: string;
  standingAffection?: number;  // 0–100 运行时 affection（侍君）
  favorThreat?: number;        // 0–100 对方恩宠上升威胁度
}): { relation: SubjectRelation; diagnostics: RelationDiagnostic[] } {
  const diagnostics: RelationDiagnostic[] = [];
  let stance: RelationStance = "neutral";
  const reasons: string[] = [];
  if (input.authoredAttitude !== undefined) {
    const mapped = ATTITUDE_ALIASES[input.authoredAttitude];
    if (mapped) {
      stance = mapped;
      reasons.push(`授定态度「${input.authoredAttitude}」`);
    } else {
      diagnostics.push({ code: "unknown_authored_attitude", value: input.authoredAttitude });
    }
  }
  const base = STANCE_DEFAULTS[stance];
  // 动态 affection 微调（不翻转 stance）：60% 基线 + 40% 运行时
  const affection = input.standingAffection !== undefined
    ? clampSigned(base.affection * 0.6 + input.standingAffection * 0.4)
    : base.affection;
  const positiveBonus = Math.max(0, affection); // 仅正向 affection 缓和
  const favorThreat = input.favorThreat ?? 0;
  if (favorThreat > 0) reasons.push("对方恩宠上升");
  const relation: SubjectRelation = {
    charId: input.charId,
    stance,
    affection,
    trust: clampPct(base.trust + positiveBonus * 0.5 / 100 * 30),
    hostility: clampPct(base.hostility - positiveBonus / 100 * 20),
    envy: clampPct(base.envy + favorThreat / 100 * 30),
    fear: base.fear,
    respect: base.respect,
    reasons,
  };
  return { relation, diagnostics };
}
```

> 数值系数可实现期校准；关键是固定、纯、可测。

- [ ] **Step 4: 运行测试 + 提交**

Run: `npx vitest run tests/dialogue/subjectRelation.test.ts` → PASS；`npx vitest run` 全绿。

```bash
git add src/engine/dialogue/subjectRelation.ts tests/dialogue/subjectRelation.test.ts
git commit -m "feat: SubjectRelation + deriveSubjectRelation（词表→stance→向量，affection 微调不翻转，未知值诊断）"
```

---

### Task 4: `planReaction`（四事件类型，关系×听众×性格→primary+undertone）

**Files:**
- Create: `src/engine/dialogue/planReaction.ts`
- Test: `tests/dialogue/planReaction.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1/2/3）：`ReactionPlan`/`AudienceContext`/`EventReactionContext`、`SubjectRelation`、`SocialDisposition`。
- Produces: `planReaction(params: { relation: SubjectRelation; disposition: SocialDisposition; audience: AudienceContext; event: EventReactionContext }): ReactionPlan`
- 决策（纯函数、确定性、带兜底 `remain_reserved`）：
  1. **事件基调** → 候选 primary：
     - `heir_born`（对方得子，于对方为喜）：friendly/devoted→`congratulate`；competitive(高 envy)→`congratulate`+潜 `envy`；hostile→外 `congratulate` 内 `resentment`/`probe`。
     - `heir_died`（对方丧子，于对方为痛）：devoted/friendly→`comfort`+潜 `grief`；hostile/contemptuous→冷淡：私下可 `remain_reserved`+潜 `contempt`/relief。
     - `rank_changed` demote（对方降位）：盟友(高 affection/respect、低 hostility)→`petition`/`defend`；hostile→`gloat`（仅私下）。
     - `rank_changed` promote（对方晋位）：friendly→`congratulate`；competitive→`congratulate`+潜 `envy`。
     - `residence_changed`：低烈度，friendly→`agree`/愉快评论；否则 `remain_reserved`。
  2. **听众闸（礼制）**：`targetRole==="sovereign"` 时，当面 `gloat`/`criticize` 他人属僭越→降级为 `remain_reserved`/`agree`，把被压住的情绪转入 `undertone`（高 concealment）。
  3. **场合×性格**：`privacy!=="private"` 且 `disposition.discretion` 高 → 抑制负面外显（gloat/criticize→remain_reserved），同样转 undertone。在场有「被议论者的好友」→ 进一步抑制。
  4. **undertone**：当外显被中和、但存在强情绪（envy/contempt/grief/relief），按 `concealment = f(discretion, 场合正式度)` 设潜台词；日常无强情绪则无 undertone。
  5. **intensity/openness**：intensity 由情绪强度与 stance 烈度定；openness 由 `discretion`（高→低 openness）与 privacy 定。
  6. 兜底：无命中 → `remain_reserved`，空 undertone。

- [ ] **Step 1: 写失败测试（覆盖 spec 工作例）**

新建 `tests/dialogue/planReaction.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { planReaction } from "../../src/engine/dialogue/planReaction";
import { deriveSubjectRelation } from "../../src/engine/dialogue/subjectRelation";
import { DEFAULT_DISPOSITION } from "../../src/engine/dialogue/disposition";
import type { AudienceContext, EventReactionContext } from "../../src/engine/dialogue/reactionTypes";

const sovereign: AudienceContext = { targetRole: "sovereign", privacy: "private", presentCharacterIds: [] };
const consortPrivate: AudienceContext = { targetRole: "consort", privacy: "private", presentCharacterIds: [] };
const rel = (attitude: string, over = {}) => deriveSubjectRelation({ charId: "gu", authoredAttitude: attitude, ...over }).relation;
const demote: EventReactionContext = { eventType: "rank_changed", subjectId: "gu", direction: "demote" };
const birth: EventReactionContext = { eventType: "heir_born", subjectId: "gu" };
const died: EventReactionContext = { eventType: "heir_died", subjectId: "gu" };

describe("planReaction", () => {
  it("降位+盟友+对陛下 → 求情/辩护", () => {
    const p = planReaction({ relation: rel("交好"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(["petition", "defend"]).toContain(p.primary);
  });
  it("降位+仇敌+对陛下 → 不当面幸灾乐祸（收敛），潜 contempt", () => {
    const p = planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote });
    expect(p.primary).not.toBe("gloat");
    expect(p.undertone?.type === "contempt" || p.undertone === undefined).toBe(true);
  });
  it("降位+仇敌+私下对侍君 → 可幸灾乐祸", () => {
    const p = planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: demote });
    expect(p.primary).toBe("gloat");
  });
  it("高 discretion 仇敌即便私下也克制（半私场合）", () => {
    const semi: AudienceContext = { targetRole: "consort", privacy: "semi_private", presentCharacterIds: ["x"] };
    const p = planReaction({ relation: rel("交恶"), disposition: { ...DEFAULT_DISPOSITION, discretion: 95 }, audience: semi, event: demote });
    expect(p.primary).not.toBe("gloat");
  });
  it("生育+争宠者+对陛下 → 表面恭贺、潜 envy（高 concealment）", () => {
    const p = planReaction({ relation: rel("争宠", { favorThreat: 40 }), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: birth });
    expect(p.primary).toBe("congratulate");
    expect(p.undertone?.type).toBe("envy");
    expect(p.undertone!.concealment).toBeGreaterThan(60);
  });
  it("夭折+挚友 → 安慰、潜 grief", () => {
    const p = planReaction({ relation: rel("敬爱"), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: died });
    expect(p.primary).toBe("comfort");
  });
  it("确定性 + 兜底（中性+搬迁 → remain_reserved/agree）", () => {
    const res: EventReactionContext = { eventType: "residence_changed", subjectId: "gu" };
    const p = planReaction({ relation: rel(""), disposition: DEFAULT_DISPOSITION, audience: consortPrivate, event: res });
    expect(["remain_reserved", "agree"]).toContain(p.primary);
    expect(planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }))
      .toEqual(planReaction({ relation: rel("交恶"), disposition: DEFAULT_DISPOSITION, audience: sovereign, event: demote }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dialogue/planReaction.test.ts` → FAIL。

- [ ] **Step 3: 实现（planReaction.ts）**

新建 `src/engine/dialogue/planReaction.ts`，按上方决策实现。结构：① `baseInclination(event, relation)` 返回 `{ primary, undertoneType?, emotion强度 }`；② `applyAudienceAndDiscretion(...)` 做礼制/场合/性格闸，把被压负面外显转 undertone；③ 组装 `intensity/openness/claimNeeds/rationaleCodes`，无命中兜底 `remain_reserved`。完整代码（确定性、无随机）：

```ts
import type {
  AudienceContext, EventReactionContext, ReactionPlan, ReactionPrimary, ReactionUndertone,
} from "./reactionTypes";
import type { SocialDisposition } from "./disposition";
import type { SubjectRelation } from "./subjectRelation";

const HOSTILE = (r: SubjectRelation) => r.stance === "hostile" || r.stance === "contemptuous";
const ALLY = (r: SubjectRelation) => r.stance === "friendly" || r.stance === "devoted";

interface Inclination {
  primary: ReactionPrimary;
  undertone?: ReactionUndertone;
  emotion: number;          // 0–100 内在情绪强度
  negativeOutward: boolean; // 外显是否「对他人不利」（gloat/criticize 之类，需受礼制/场合约束）
}

function baseInclination(event: EventReactionContext, r: SubjectRelation): Inclination {
  switch (event.eventType) {
    case "rank_changed":
      if (event.direction === "demote") {
        if (ALLY(r)) return { primary: "petition", emotion: 60, negativeOutward: false };
        if (HOSTILE(r)) return { primary: "gloat", undertone: "contempt", emotion: r.hostility, negativeOutward: true };
        return { primary: "remain_reserved", emotion: 20, negativeOutward: false };
      }
      // promote
      if (r.envy >= 45) return { primary: "congratulate", undertone: "envy", emotion: r.envy, negativeOutward: false };
      if (ALLY(r)) return { primary: "congratulate", emotion: 45, negativeOutward: false };
      return { primary: "agree", emotion: 20, negativeOutward: false };
    case "heir_born":
      if (r.envy >= 45) return { primary: "congratulate", undertone: "envy", emotion: r.envy, negativeOutward: false };
      if (HOSTILE(r)) return { primary: "congratulate", undertone: "resentment", emotion: r.hostility, negativeOutward: false };
      if (ALLY(r)) return { primary: "congratulate", emotion: 55, negativeOutward: false };
      return { primary: "congratulate", emotion: 30, negativeOutward: false };
    case "heir_died":
      if (ALLY(r)) return { primary: "comfort", undertone: "grief", emotion: 70, negativeOutward: false };
      if (HOSTILE(r)) return { primary: "remain_reserved", undertone: "contempt", emotion: r.hostility, negativeOutward: false };
      return { primary: "comfort", emotion: 35, negativeOutward: false };
    case "residence_changed":
      if (ALLY(r)) return { primary: "agree", emotion: 25, negativeOutward: false };
      return { primary: "remain_reserved", emotion: 15, negativeOutward: false };
  }
}

export function planReaction(params: {
  relation: SubjectRelation;
  disposition: SocialDisposition;
  audience: AudienceContext;
  event: EventReactionContext;
}): ReactionPlan {
  const { relation: r, disposition: d, audience: a, event } = params;
  const inc = baseInclination(event, r);
  const rationale: string[] = [`${event.eventType}:${r.stance}`];

  // 礼制/场合/性格闸：把「对他人不利的外显」在不当场合压住，转入 undertone（高 concealment）
  const formal = a.targetRole === "sovereign" || a.privacy !== "private";
  const suppress =
    (inc.negativeOutward && a.targetRole === "sovereign") ||              // 当着陛下不僭越
    (inc.negativeOutward && a.privacy !== "private" && d.discretion >= 70); // 人多+谨慎者收敛
  let primary = inc.primary;
  let undertoneType = inc.undertone;
  if (suppress) {
    primary = "remain_reserved";
    undertoneType = undertoneType ?? (HOSTILE(r) ? "contempt" : undefined);
    rationale.push(a.targetRole === "sovereign" ? "etiquette:no_gloat_to_sovereign" : "discretion:suppress_in_public");
  }

  const concealment = undertoneType ? Math.min(95, (formal ? 50 : 20) + d.discretion * 0.4) : 0;
  const undertone = undertoneType
    ? { type: undertoneType, intensity: Math.round(inc.emotion), concealment: Math.round(concealment) }
    : undefined;

  return {
    subjectIds: [event.subjectId],
    primary,
    ...(undertone ? { undertone } : {}),
    intensity: Math.round(Math.min(100, inc.emotion * (a.privacy === "private" ? 1 : 0.7))),
    openness: Math.round(Math.max(0, 100 - d.discretion - (formal ? 20 : 0))),
    claimNeeds: [{ about: "subject_event", subjectId: event.subjectId }],
    rationaleCodes: rationale,
  };
}
```

- [ ] **Step 4: 运行测试 + 全量回归**

Run: `npx vitest run tests/dialogue/planReaction.test.ts` → PASS；`npx vitest run` 全绿；`npx tsc --noEmit` clean。

- [ ] **Step 5: 提交**

```bash
git add src/engine/dialogue/planReaction.ts tests/dialogue/planReaction.test.ts
git commit -m "feat: planReaction（四事件类型，关系×听众×性格→primary+undertone，礼制/场合压制转潜台词，兜底 remain_reserved）"
```

---

### Task 5: 第一阶段候选召回（recall.ts）

**Files:**
- Create: `src/engine/dialogue/recall.ts`
- Test: `tests/dialogue/recall.test.ts`（新建）

**Interfaces:**
- Consumes：`listMemories`（memory/inspect）、`canKnowEvent`（chronicle/awareness）、`MemoryEntry`/`CourtEvent`/`GameState`。
- Produces:
  - `interface RecallQuery { speakerId: string; topicTags?: string[]; presentCharacterIds?: string[]; subjectIds?: string[] }`
  - `recallCandidates(state, query, limit?): { memories: MemoryEntry[]; events: CourtEvent[] }`
- 召回（宽召回，不排序——精排是 PR4）：① 说话人私人记忆（按 `strength` 取高分 + 命中 topic/subject 的）；② 说话人**可知**的近期 chronicle 事件（`canKnowEvent` 过滤 + 命中 topic/subject）。`limit` 默认 20。**确定性**：同 state 同 query 同结果（稳定排序 strength desc, id asc）。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/recall.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { recallCandidates } from "../../src/engine/dialogue/recall";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

function mem(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem_a_000001", ownerId: "a", kind: "impression", subjectIds: ["player"], perspective: "witness",
    summary: "x", strength: 50, retention: "slow", emotions: {}, triggerTags: [], unresolved: false,
    createdAt: makeGameTime(1, 1, "early"), ...over,
  };
}

describe("recallCandidates", () => {
  it("召回说话人高 strength 私人记忆（确定性、限量）", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["a"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    s.memories["a"] = { nextSeq: 4, entries: [
      mem({ id: "mem_a_000001", strength: 90, triggerTags: ["heir"] }),
      mem({ id: "mem_a_000002", strength: 20 }),
      mem({ id: "mem_a_000003", strength: 80, subjectIds: ["consort_gu"] }),
    ]};
    const out = recallCandidates(s, { speakerId: "a", topicTags: ["heir"] }, 20);
    expect(out.memories.map((m) => m.id)).toContain("mem_a_000001"); // 命中 topic
    expect(out.memories[0]!.strength).toBeGreaterThanOrEqual(out.memories.at(-1)!.strength); // strength desc
    expect(recallCandidates(s, { speakerId: "a" })).toEqual(recallCandidates(s, { speakerId: "a" })); // 确定性
  });
  it("只召回说话人【可知】的 chronicle 事件", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["newcomer"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 6, "mid") };
    s.chronicle.push({
      id: "evt_000001", type: "rank_changed", occurredAt: makeGameTime(1, 3, "mid"),
      participants: [{ charId: "consort_gu", role: "subject" }], payload: {},
      publicity: { scope: "palace", persistence: "contemporaneous" }, publicSalience: 60, retention: "slow", tags: ["demotion"],
    });
    // newcomer 三月之后才入宫 + contemporaneous → 不可知
    const out = recallCandidates(s, { speakerId: "newcomer", topicTags: ["demotion"] });
    expect(out.events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dialogue/recall.test.ts` → FAIL。

- [ ] **Step 3: 实现（recall.ts）**

新建 `src/engine/dialogue/recall.ts`：

```ts
/** 第一阶段候选召回（宽召回，不排序——精排在 PR4）。确定性、稳定排序。 */
import { listMemories } from "../memory/inspect";
import { canKnowEvent } from "../chronicle/awareness";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export interface RecallQuery {
  speakerId: string;
  topicTags?: string[];
  presentCharacterIds?: string[];
  subjectIds?: string[];
}

function hits(tags: readonly string[], subjects: readonly string[], q: RecallQuery): boolean {
  const topic = q.topicTags?.length ? q.topicTags.some((t) => tags.includes(t)) : false;
  const subj = q.subjectIds?.length ? q.subjectIds.some((s) => subjects.includes(s)) : false;
  const present = q.presentCharacterIds?.length ? q.presentCharacterIds.some((s) => subjects.includes(s)) : false;
  return topic || subj || present;
}

export function recallCandidates(
  state: GameState,
  query: RecallQuery,
  limit = 20,
): { memories: MemoryEntry[]; events: CourtEvent[] } {
  const anyFilter = !!(query.topicTags?.length || query.subjectIds?.length || query.presentCharacterIds?.length);

  const memories = [...listMemories(state, query.speakerId)]
    .filter((m) => !anyFilter || m.strength >= 70 || hits(m.triggerTags, m.subjectIds, query))
    .sort((x, y) => (y.strength - x.strength) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, limit);

  const events = state.chronicle
    .filter((e) => canKnowEvent(state, query.speakerId, e))
    .filter((e) => !anyFilter || hits(e.tags, e.participants.map((p) => p.charId), query))
    .sort((x, y) => (y.publicSalience - x.publicSalience) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, limit);

  return { memories, events };
}
```

- [ ] **Step 4: 运行测试 + 全量回归 + tsc**

Run: `npx vitest run tests/dialogue/recall.test.ts` → PASS；`npx vitest run` 全绿；`npx tsc --noEmit` clean。

- [ ] **Step 5: 提交**

```bash
git add src/engine/dialogue/recall.ts tests/dialogue/recall.test.ts
git commit -m "feat: recallCandidates 第一阶段候选召回（私人记忆+可知 chronicle，确定性稳定排序）"
```

---

## Self-Review

**Spec coverage:** `ReactionPrimary/Undertone/ReactionPlan`→T1；`SocialDisposition`（三轴、标签表、未映射忽略）→T2；`SubjectRelation`（词表→stance→向量、affection 微调不翻转、未知诊断）→T3；`planReaction`（四事件、关系×听众×性格、礼制/场合压制转 undertone、兜底）→T4；第一阶段候选召回→T5。两阶段「召回→规划」就位（精排/冷却是 PR4）。

**Placeholder scan:** 无 TBD；每步含完整代码/命令/预期。

**Type consistency:** `RelationStance`/`RelationVector`/`SubjectRelation`（T3）→ planReaction（T4）一致；`SocialDisposition`（T2）→ T4；`AudienceContext`/`EventReactionContext`/`ReactionPlan`（T1）→ T4；`MemoryEntry`/`CourtEvent`（PR2）→ T5。

**已知实现期决策（已确认）:**
1. 关系/性格派生 = **词表 + 确定性数值派生 + 未知值诊断**，不改授定 schema，不做 NLP（用户拍板）。`防备`→neutral；动态 affection 只微调不翻转 stance。
2. 性格三轴 = 中性基线 50 + 标签增量叠加 + clamp；未映射标签忽略不报错（用户拍板）。
3. `planReaction` 用结构化分支（事件基调→礼制/场合/性格闸→undertone/兜底），非穷举矩阵；数值系数实现期可校准。
4. 本 PR **不接 `DialogueRequest`**：PR4 用 `recallCandidates` + 精排填 `relevantMemories`/`DialogueMemoryContext`，PR5 装配 `AudienceContext` 并把 `planReaction` 接入 gate/LLM。`favorThreat`/`presentCharacterIds` 的真实来源在 PR4/PR5 接。

## 后续

PR4（乘加混合 `retrievalScore` 激活/精排 + `MemoryMentionRecord` 冷却 + 结构化 `DialogueMemoryContext`）见后续单独 plan；PR5（audience 装配 + gates + LLM）最后。
