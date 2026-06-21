# 属性形容词显示 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端把 0–100 数值属性显示为分段形容词（带吉/警着色），去掉进度条；疲劳/国库/年龄保持数字，类别/文本不变。

**Architecture:** 纯函数模块 `src/ui/format/descriptors.ts`（`DescriptorConfig` 表 + `describe`/`directionOf`/`tone`）→ 共享展示组件 `DescriptorStat`（标签 + 形容词 + 按 tone 着色）→ 各面板（ResourcePanel/CharacterProfileDrawer/CharacterCard/HeirListModal）改用之。纯显示层，零引擎/内容/存档改动。

**Tech Stack:** React 18 + TypeScript + Vite + vitest。

## Global Constraints

- 设计源：`docs/superpowers/specs/2026-06-20-attribute-descriptors-design.md`。**形容词表（§3）以 spec 为唯一权威**——实现时逐字转写，不得改词、漏段或改顺序；每 scale 恰 10 段。
- **绝不默认数值越高越好**：`direction` 决定着色。`lower_is_better` 的 scale：`cruelty`、`corruption`、`clanDiscontent`、`rumor`、`clanPowerNation`；其余 `higher_is_better`。
- `labelsByKind` 键控用 `DescriptorKind = "consort" | "heir"`（heir 不属 CharacterKind）。`favor` 与 `ambition` 用 labelsByKind 分 consort/heir 两套。
- 保持数字（不转形容词、不画条）：皇帝 `fatigue` 疲劳、国家 `treasury` 国库、皇嗣 年龄。
- 承养 nurture 从 CharacterCard **去掉**。
- 外戚权势 consortClanPower：UI 归入**暗属性**且 `lower_is_better`（不动后台字段）。
- NEVER `git add -A` / `git add .` —— 逐文件 targeted add。

---

### Task 1: 核心 descriptors 模块

**Files:**
- Create: `src/ui/format/descriptors.ts`
- Test: `tests/ui/descriptors.test.ts`（新）

**Interfaces:**
- Produces:
  - `type DescriptorKind = "consort" | "heir"`
  - `type ScaleId`（下列全部 id 的联合）
  - `interface DescriptorConfig { direction: "higher_is_better" | "lower_is_better"; labels?: readonly string[]; labelsByKind?: Partial<Record<DescriptorKind, readonly string[]>> }`
  - `const DESCRIPTORS: Record<ScaleId, DescriptorConfig>`
  - `describe(scale: ScaleId, value: number, kind?: DescriptorKind): string`
  - `directionOf(scale: ScaleId): "higher_is_better" | "lower_is_better"`
  - `tone(scale: ScaleId, value: number): "good" | "bad" | "neutral"`

**Scale id 清单（25 个）：** `appearance, health, favor, affection, fear, ambition, loyalty, power, clanPowerNation, diligence, effort, prestige, martial, statecraft, cruelty, regimeSecurity, military, publicSupport, productivity, governance, corruption, clanDiscontent, rumor, talent, virtue, closeness, support`。
- 用 `labelsByKind`（consort+heir）的：`favor`、`ambition`。其余用 `labels`。
- `direction: "lower_is_better"` 的：`cruelty`、`corruption`、`clanDiscontent`、`rumor`、`clanPowerNation`。其余 `higher_is_better`。
- 每个 scale 的 10 段文字 **逐字转写自 spec §3**（含 favor/ambition 的 consort/heir 两套）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/ui/descriptors.test.ts
import { describe as group, expect, it } from "vitest";
import { DESCRIPTORS, describe, directionOf, tone } from "../../src/ui/format/descriptors";

group("describe band boundaries", () => {
  it("maps value to the right 10-band label", () => {
    expect(describe("appearance", 0)).toBe(DESCRIPTORS["appearance"]!.labels![0]);
    expect(describe("appearance", 9)).toBe(DESCRIPTORS["appearance"]!.labels![0]);
    expect(describe("appearance", 10)).toBe(DESCRIPTORS["appearance"]!.labels![1]);
    expect(describe("appearance", 95)).toBe(DESCRIPTORS["appearance"]!.labels![9]);
    expect(describe("appearance", 100)).toBe(DESCRIPTORS["appearance"]!.labels![9]); // clamp
  });
  it("falls back to the number string for an unknown scale", () => {
    expect(describe("nope" as never, 42)).toBe("42");
  });
});

group("labelsByKind", () => {
  it("favor differs by kind and both are 10 long", () => {
    const c = describe("favor", 95, "consort");
    const h = describe("favor", 95, "heir");
    expect(c).not.toBe(h);
    expect(DESCRIPTORS["favor"]!.labelsByKind!.consort).toHaveLength(10);
    expect(DESCRIPTORS["favor"]!.labelsByKind!.heir).toHaveLength(10);
  });
});

group("directionOf", () => {
  it.each(["cruelty", "corruption", "clanDiscontent", "rumor", "clanPowerNation"] as const)(
    "%s is lower_is_better", (s) => expect(directionOf(s)).toBe("lower_is_better"),
  );
  it("a positive scale and an unknown scale are higher_is_better", () => {
    expect(directionOf("health")).toBe("higher_is_better");
    expect(directionOf("nope" as never)).toBe("higher_is_better");
  });
});

group("tone", () => {
  it("high value on a positive scale is good; on a negative scale is bad", () => {
    expect(tone("health", 95)).toBe("good");
    expect(tone("health", 5)).toBe("bad");
    expect(tone("cruelty", 95)).toBe("bad");
    expect(tone("cruelty", 5)).toBe("good");
    expect(tone("health", 50)).toBe("neutral");
  });
});

group("every config is well-formed", () => {
  it("each scale resolves to a 10-entry label set with no blanks (negatives end badly)", () => {
    for (const [id, cfg] of Object.entries(DESCRIPTORS)) {
      const sets = cfg.labels ? [cfg.labels] : Object.values(cfg.labelsByKind ?? {});
      expect(sets.length, id).toBeGreaterThan(0);
      for (const set of sets) {
        expect(set, id).toHaveLength(10);
        expect(set!.every((s) => s.length > 0), id).toBe(true);
      }
    }
    expect(DESCRIPTORS["clanPowerNation"]!.labels![9]).toBe("外戚专权");
    expect(DESCRIPTORS["cruelty"]!.labels![9]).toContain("杀");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ui/descriptors.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 descriptors.ts**

写出文件骨架（types + describe/directionOf/tone 如下），并把 25 个 scale 的 config 全部填上——**labels/labelsByKind 的文字逐字取自 spec §3**，direction 按 Global Constraints。

```ts
export type DescriptorKind = "consort" | "heir";

export type ScaleId =
  | "appearance" | "health" | "favor" | "affection" | "fear" | "ambition"
  | "loyalty" | "power" | "clanPowerNation" | "diligence" | "effort" | "prestige"
  | "martial" | "statecraft" | "cruelty" | "regimeSecurity" | "military"
  | "publicSupport" | "productivity" | "governance" | "corruption"
  | "clanDiscontent" | "rumor" | "talent" | "virtue" | "closeness" | "support";

export interface DescriptorConfig {
  direction: "higher_is_better" | "lower_is_better";
  labels?: readonly string[];
  labelsByKind?: Partial<Record<DescriptorKind, readonly string[]>>;
}

export const DESCRIPTORS: Record<ScaleId, DescriptorConfig> = {
  appearance: { direction: "higher_is_better", labels: ["容貌丑陋", "其貌不扬", "姿色平庸", "容貌寻常", "小家碧玉", "眉目清秀", "姿容秀丽", "姿容出众", "惊为天人", "绝世之姿"] },
  favor: {
    direction: "higher_is_better",
    labelsByKind: {
      consort: ["失宠见弃", "久未承幸", "圣眷渐疏", "恩宠寥寥", "恩宠平平", "颇得青眼", "恩宠日盛", "盛宠加身", "专房之宠", "冠宠六宫"],
      heir: ["厌弃不顾", "冷眼相待", "少有顾念", "关怀渐疏", "宠爱平平", "略得疼爱", "颇受疼爱", "偏爱有加", "视若珍宝", "掌上明珠"],
    },
  },
  cruelty: { direction: "lower_is_better", labels: ["仁德宽厚", "宽和少罚", "待下平和", "偶有苛责", "御下严厉", "用刑偏重", "刻薄寡恩", "酷烈无情", "暴戾恣睢", "嗜杀成性"] },
  // …其余 22 个 scale（health/affection/fear/ambition(labelsByKind)/loyalty/power/
  //   clanPowerNation(lower)/diligence/effort/prestige/martial/statecraft/
  //   regimeSecurity/military/publicSupport/productivity/governance/
  //   corruption(lower)/clanDiscontent(lower)/rumor(lower)/talent/virtue/closeness/support）
  //   ——文字逐字转写自 spec §3，direction 见 Global Constraints。
};

const band = (v: number): number => Math.max(0, Math.min(9, Math.floor(v / 10)));

export function describe(scale: ScaleId, value: number, kind?: DescriptorKind): string {
  const cfg = DESCRIPTORS[scale];
  if (!cfg) return String(value);
  const labels = (kind && cfg.labelsByKind?.[kind]) ?? cfg.labels;
  return labels?.[band(value)] ?? String(value);
}

export function directionOf(scale: ScaleId): DescriptorConfig["direction"] {
  return DESCRIPTORS[scale]?.direction ?? "higher_is_better";
}

export function tone(scale: ScaleId, value: number): "good" | "bad" | "neutral" {
  const b = band(value);
  const high = b >= 7;
  const low = b <= 2;
  const positive = directionOf(scale) === "higher_is_better";
  if (positive) return high ? "good" : low ? "bad" : "neutral";
  return high ? "bad" : low ? "good" : "neutral";
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ui/descriptors.test.ts && npm run typecheck`
Expected: PASS（全 25 config 填齐后）

- [ ] **Step 5: 提交**

```bash
git add src/ui/format/descriptors.ts tests/ui/descriptors.test.ts
git commit -m "feat: 属性形容词核心 descriptors（DescriptorConfig + describe/directionOf/tone）"
```

---

### Task 2: DescriptorStat 组件 + CSS + ResourcePanel 接线

**Files:**
- Create: `src/ui/components/DescriptorStat.tsx`
- Modify: `src/ui/styles.css`（`.attr-line` + tone 着色）
- Modify: `src/ui/components/ResourcePanel.tsx`
- Test: 手动验证 + `npm run typecheck && npm run build`

**Interfaces:**
- Consumes: `describe`, `tone`, `DescriptorKind`（Task 1）
- Produces: `DescriptorStat({ label, scale, value, kind? })` — 一行：标签 + 形容词，按 `tone` 着色（`data-tone`）。

- [ ] **Step 1: DescriptorStat 组件**

```tsx
// src/ui/components/DescriptorStat.tsx
import { describe, tone, type DescriptorKind, type ScaleId } from "../format/descriptors";

export function DescriptorStat({
  label, scale, value, kind,
}: { label: string; scale: ScaleId; value: number; kind?: DescriptorKind }) {
  return (
    <div className="attr-line">
      <span className="attr-line__label">{label}</span>
      <span className="attr-line__value" data-tone={tone(scale, value)}>
        {describe(scale, value, kind)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: CSS**

`src/ui/styles.css` 末尾追加：

```css
.attr-line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 4px 0; }
.attr-line__label { color: var(--c-text-dim); font-size: 0.9rem; }
.attr-line__value { font-family: var(--font-title); letter-spacing: 0.05em; }
.attr-line__value[data-tone="good"] { color: var(--c-gold-text, #d9b87c); }
.attr-line__value[data-tone="bad"] { color: #c8625a; }
.attr-line__value[data-tone="neutral"] { color: var(--c-text); }
```
（变量名以 styles.css 现有为准；若 `--c-gold-text` 不存在，用现有金色变量。）

- [ ] **Step 3: ResourcePanel 改写**

把 `Bar` 用法替换为 `DescriptorStat`，疲劳/国库仍用数字行（保留一个简单数字行），并按 明面/暗属性 分组、外戚权势移入暗属性：

```tsx
import { DescriptorStat } from "./DescriptorStat";
// 数字行（疲劳/国库）：
function NumberLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="attr-line">
      <span className="attr-line__label">{label}</span>
      <span className="attr-line__value">{value}</span>
    </div>
  );
}
// …Drawer 内：
// 皇帝 · 明面
<DescriptorStat label="健康" scale="health" value={sovereign.health} />
<DescriptorStat label="勤政" scale="diligence" value={sovereign.diligence} />
<DescriptorStat label="威望" scale="prestige" value={sovereign.prestige} />
<DescriptorStat label="武力" scale="martial" value={sovereign.martial} />
<DescriptorStat label="政略" scale="statecraft" value={sovereign.statecraft} />
// 皇帝 · 暗属性
<DescriptorStat label="暴戾" scale="cruelty" value={sovereign.cruelty} />
<DescriptorStat label="皇权安全" scale="regimeSecurity" value={sovereign.regimeSecurity} />
<NumberLine label="疲劳" value={sovereign.fatigue} />
// 国家 · 明面
<DescriptorStat label="军力" scale="military" value={nation.military} />
<NumberLine label="国库" value={nation.treasury} />
<DescriptorStat label="民心" scale="publicSupport" value={nation.publicSupport} />
<DescriptorStat label="生产力" scale="productivity" value={nation.productivity} />
<DescriptorStat label="朝政" scale="governance" value={nation.governance} />
// 国家 · 暗属性
<DescriptorStat label="外戚权势" scale="clanPowerNation" value={nation.consortClanPower} />
<DescriptorStat label="大臣忠心" scale="loyalty" value={nation.ministerLoyalty} />
<DescriptorStat label="贪腐" scale="corruption" value={nation.corruption} />
<DescriptorStat label="宗室不满" scale="clanDiscontent" value={nation.clanDiscontent} />
<DescriptorStat label="谣言热度" scale="rumor" value={nation.rumor} />
```
用 `<h3 className="profile-h">皇帝 · 明面</h3>` / `皇帝 · 暗属性` / `国家 · 明面` / `国家 · 暗属性` 分四组（或 明面/暗属性两层小标题，措辞自定）。删除旧 `Bar` 组件。

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run build`
Expected: PASS。手动确认国情抽屉显示形容词、暴戾/贪腐等高值显警色、外戚权势在暗属性组。

- [ ] **Step 5: 提交**

```bash
git add src/ui/components/DescriptorStat.tsx src/ui/styles.css src/ui/components/ResourcePanel.tsx
git commit -m "feat: DescriptorStat 组件 + 国情面板改形容词（明/暗分组，负向警色）"
```

---

### Task 3: CharacterProfileDrawer 侍君属性改形容词

**Files:**
- Modify: `src/ui/components/CharacterProfileDrawer.tsx`
- Test: 手动 + `npm run typecheck && npm test`

**Interfaces:**
- Consumes: `DescriptorStat`（Task 2），`maternalLoyalty`/`maternalPower`（既有 derive）

- [ ] **Step 1: 改写 attrs tab**

`import { DescriptorStat } from "./DescriptorStat";`。把以下 `Stat` 改为 `DescriptorStat`（家世/特长/喜好仍用 Field 文本，不动）：
- 才貌：`<DescriptorStat label="容貌" scale="appearance" value={attrs.appearance} />`
- 身体：`<DescriptorStat label="健康" scale="health" value={attrs.health} />`
- 暗属性：`<DescriptorStat label="情意" scale="affection" value={character.hidden.affection} />`、`恐惧 fear`、`<DescriptorStat label="野心" scale="ambition" value={character.hidden.ambition} kind="consort" />`、`<DescriptorStat label="母家忠心" scale="loyalty" value={maternalLoyalty(state, character)} />`、`<DescriptorStat label="母家权势" scale="power" value={maternalPower(db, state, character)} />`
- 与皇帝：`<DescriptorStat label="恩宠" scale="favor" value={standing.favor} kind="consort" />`（仅 standing 存在时）

移除文件内不再使用的 `Stat` 组件（若 relations/其它 tab 也不再用 Stat）。`Field` 保留。

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm test`
Expected: PASS（无既有测试依赖这些 Stat 数字渲染）。

- [ ] **Step 3: 提交**

```bash
git add src/ui/components/CharacterProfileDrawer.tsx
git commit -m "feat: 侍君详情属性改形容词（容貌/健康/恩宠/情意/恐惧/野心/母家忠心/权势）"
```

---

### Task 4: CharacterCard 改形容词 + 去承养

**Files:**
- Modify: `src/ui/components/CharacterCard.tsx`
- Test: `npm run typecheck && npm test`

- [ ] **Step 1: 改写属性块**

`CharacterCard` 当前用 `ATTRIBUTE_LABELS`（appearance/health/nurture）渲染数字 `dd`。改为：
- 去掉 `nurture`（承养）整项；从 `ATTRIBUTE_LABELS` 与其 key 类型移除 `"nurture"`。
- 容貌/健康 改用 `describe`（或 `DescriptorStat`）显示形容词而非数字。最简：保留 `ATTRIBUTE_LABELS = [["appearance","容貌"],["health","健康"]]` 并把 `<dd>{character.attributes![key]}</dd>` 改为 `<dd>{describe(key as ScaleId, character.attributes![key]!)}</dd>`（`appearance`/`health` 的 scale id 同名）。
- import `describe`（及 `ScaleId` 类型）from `../format/descriptors`。
- 特长/喜好（文本）不变。

> 注意：`ATTRIBUTE_LABELS` 是否被其它组件引用（如 ConsortListModal）——若是，确保移除 nurture 后那些组件仍正确（它们随之不再显示承养，符合本任务意图）。

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm test`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add src/ui/components/CharacterCard.tsx
git commit -m "feat: 侍君卡片 容貌/健康 改形容词，移除承养"
```

---

### Task 5: HeirListModal 皇嗣属性改形容词 + 补全

**Files:**
- Modify: `src/ui/components/HeirListModal.tsx`
- Test: `npm run typecheck && npm test`

**Interfaces:**
- Consumes: `describe`/`DescriptorStat`（kind="heir" 用于 favor/ambition）

- [ ] **Step 1: 改写 heir 详情属性**

当前详情显示：`宠爱：{h.favor}` 和（已入学时）`学问{scholarship}·骑射{martial}·品行{virtue}`。改为形容词，并补全 spec §2 列出的属性：
- 明面：健康 `describe("health", h.health)`、宠爱 `describe("favor", h.favor, "heir")`、天赋 `describe("talent", h.talent)`、努力 `describe("effort", h.diligence)`、政治 `describe("statecraft", h.education.scholarship)`、武力 `describe("martial", h.education.martial)`、道德 `describe("virtue", h.education.virtue)`
- 暗属性：野心 `describe("ambition", h.ambition, "heir")`、亲近 `describe("closeness", h.closeness)`、继位支持 `describe("support", h.support)`
- 不变：嫡庶（嫡/庶）、名讳、年龄、生辰、承嗣、养父、党羽（如显示 faction 文本）

排版：可沿用 `heir-detail__field` 文本行，或用 `DescriptorStat`（kind="heir" 传给 favor/ambition）。教育三项（政治/武力/道德）原仅在 `isEnrolled` 时显示——保留该条件或一并常显，按现有交互择一（建议保留 isEnrolled 守卫教育三项，其余常显）。

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS。手动确认皇嗣详情各属性为形容词、野心/亲近/支持作为暗属性显示。

- [ ] **Step 3: 提交**

```bash
git add src/ui/components/HeirListModal.tsx
git commit -m "feat: 皇嗣详情属性改形容词 + 补全健康/天赋/努力/野心/亲近/继位支持"
```

---

## 自查

- **spec 覆盖**：核心模块(T1)、皇帝+国家显示(T2)、侍君(T3)、卡片+去承养(T4)、皇嗣(T5)。§1 架构、§2 渲染点、§3 表、§4 映射、§5 决议均落到任务；§7 测试在 T1 全覆盖（boundary/labelsByKind/directionOf/tone/完整性）。
- **占位符**：T1 Step 3 的 config 表注明"其余 22 个逐字转写自 spec §3"——spec 是同仓权威源，避免在计划里重复 250 行且可能漂移；direction 与 labelsByKind 归属已在 Global Constraints/Task 1 明确列出，无歧义。
- **类型一致**：`ScaleId`/`DescriptorKind`/`DescriptorConfig`/`describe`/`directionOf`/`tone` 在 T1 定义，T2–T5 引用一致；`DescriptorStat` 在 T2 定义，T3/T5 复用。
- **着色**：负向 5 scale 在 T1 标 `lower_is_better`，`tone` 据此反转，T2 CSS 按 `data-tone` 着色——高值负向属性显警色，满足"不默认高=绿"。
- **绿色保证**：T1 纯新增；T2–T5 为显示替换，无引擎/测试依赖这些数字渲染，typecheck/test/build 各步可绿。
