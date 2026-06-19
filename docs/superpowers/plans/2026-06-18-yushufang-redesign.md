# 御书房交互重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把御书房整理成「奏折 / 休息 / 查看子嗣 / 查看侍君 / 翻牌子 + 杂务」菜单，分离零行动点的「查看」与扣点的「召见/对话/侍寝」，翻牌子改为牌子托盘并经御书房召见卡完成互动。

**Architecture:** 纯 UI 层 + 少量 App 瞬时状态接线，复用全部现有 store handler（`reviewMemorials`/`restAlone`/`converse`/`beginBedchamber`/`summonHeir`/`buildRankOp`/候选承嗣 effect）。新增一个共享过滤 helper、一个新弹窗组件，改造两个既有组件与 `LocationScreen`/`App`。引擎、掷骰、行动点、孕事流程不改。

**Tech Stack:** React + TypeScript（Vite），vitest（node 环境，纯逻辑单测），Playwright（端到端手测）。组件无 RTL/jsdom，故 UI 仅以 typecheck + Playwright 验证。

## Global Constraints

- 复用现有 handler，不改引擎/store 逻辑、掷骰、行动点与孕事流程。
- 行动点：奏折=2、召见皇嗣=1、对话=1、侍寝提交=1、休息=`SKIP_REMAINDER`；查看/钻取/翻牌/召见到御书房/退下=0。
- 「宫中侍君」过滤统一为：`kind === "consort" && state.standing[id]?.lifecycle !== "deceased" && defaultLocation !== "lenggong"`，按 `effectiveOrder(rank, hasTitle)` 降序。查看侍君与翻牌子共用。
- 凤后（`feng_hou`）：保留在两处列表中，但隐藏「封号管理」。
- 皇嗣立绘：`heirPortraitSet(heir, calendar)` → `"child_baby" | "child_school"`，经 `registry.portrait(set, "neutral")` 渲染。
- 沿用既有朱砂鎏金 CSS 主题令牌（`var(--gold)` / `var(--cinnabar)` 等）。
- 现有命名约定：daughter→「皇子」、son→「皇郎」（见 `heirs.ts` `SEX_NOUN`）。

---

### Task 1: 共享过滤 helper `inPalaceConsorts`

**Files:**
- Modify: `src/engine/characters/presence.ts`
- Test: `tests/characters/presence.inPalace.test.ts`

**Interfaces:**
- Consumes: `effectiveOrder(rank, hasTitle)` from `src/engine/characters/standing.ts`。
- Produces: `inPalaceConsorts(db: ContentDB, state: GameState): CharacterContent[]` — 宫中侍君（排除已故与冷宫），按位分降序。

- [ ] **Step 1: Write the failing test**

Create `tests/characters/presence.inPalace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { inPalaceConsorts } from "../../src/engine/characters/presence";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("inPalaceConsorts", () => {
  it("returns only consorts, excluding officials", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.kind === "consort")).toBe(true);
  });

  it("excludes 冷宫 consorts (defaultLocation lenggong)", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    expect(list.every((c) => c.defaultLocation !== "lenggong")).toBe(true);
  });

  it("excludes deceased consorts", () => {
    const s = createNewGameState(db);
    const victim = inPalaceConsorts(db, s)[0]!;
    s.standing[victim.id] = { ...s.standing[victim.id]!, lifecycle: "deceased" };
    expect(inPalaceConsorts(db, s).some((c) => c.id === victim.id)).toBe(false);
  });

  it("sorts by effective precedence, highest first", () => {
    const list = inPalaceConsorts(db, createNewGameState(db));
    const s = createNewGameState(db);
    const orders = list.map((c) => {
      const st = s.standing[c.id]!;
      return db.ranks[st.rank]!.order + (st.title !== undefined ? 1 : 0);
    });
    const sorted = [...orders].sort((a, b) => b - a);
    expect(orders).toEqual(sorted);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/characters/presence.inPalace.test.ts`
Expected: FAIL — `inPalaceConsorts` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/engine/characters/presence.ts` (add the `effectiveOrder` import at top alongside existing imports):

```ts
import { effectiveOrder } from "./standing";
```

```ts
/** 宫中侍君：在宫（非冷宫）、未故的侍君（含凤后），按位分降序。查看侍君与翻牌子共用。 */
export function inPalaceConsorts(db: ContentDB, state: GameState): CharacterContent[] {
  return Object.values(db.characters)
    .filter(
      (c) =>
        c.kind === "consort" &&
        state.standing[c.id]?.lifecycle !== "deceased" &&
        c.defaultLocation !== "lenggong",
    )
    .sort((a, b) => {
      const ra = state.standing[a.id];
      const rb = state.standing[b.id];
      if (!ra || !rb) return 0; // 无 standing（如存档后新增）按中性处理
      return (
        effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
        effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined)
      );
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/characters/presence.inPalace.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/presence.ts tests/characters/presence.inPalace.test.ts
git commit -m "feat: inPalaceConsorts 共享过滤（宫中侍君，排除冷宫/已故）"
```

---

### Task 2: 翻牌子改造为牌子托盘（排除冷宫）

**Files:**
- Modify: `src/ui/components/BedchamberPicker.tsx`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `inPalaceConsorts(db, state)`（Task 1）、`resolveDisplayName`。
- Produces: `BedchamberPicker` props 不变 `{ db, state, onPick: (charId: string) => void, onClose: () => void }`（`onPick` 语义由调用方在 Task 5 改为「召见」；组件本身只透传）。

- [ ] **Step 1: Rewrite the component**

Replace entire `src/ui/components/BedchamberPicker.tsx` with:

```tsx
/** 御书房「翻牌子」：托盘上排开宫中侍君的竖刻名牌，点牌即召见到御书房。 */
import { inPalaceConsorts } from "../../engine/characters/presence";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function BedchamberPicker({
  db,
  state,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onPick: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = inPalaceConsorts(db, state);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="tablet-tray" onClick={(e) => e.stopPropagation()}>
        <h2 className="tablet-tray__title">翻牌子</h2>
        <div className="tablet-tray__rack">
          {consorts.map((c) => {
            const st = state.standing[c.id]!;
            return (
              <button
                key={c.id}
                type="button"
                className="tablet"
                onClick={() => onPick(c.id)}
              >
                <span className="tablet__name">
                  {resolveDisplayName(c, st, db.ranks[st.rank])}
                </span>
                <span className="tablet__rank">{db.ranks[st.rank]?.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="bedchamber-picker__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tray styles**

Append to `src/ui/styles.css`:

```css
/* ── 翻牌子 · 牌子托盘 ─────────────────────────────────────────── */
.tablet-tray {
  position: relative;
  background: linear-gradient(170deg, #2a1d12, #1c130b);
  border: 1px solid var(--line-gold);
  border-radius: 8px;
  padding: 1.3rem 1.6rem 1.5rem;
  max-width: 46rem;
  box-shadow: var(--shadow-deep);
  animation: rise 0.3s ease both;
}
.tablet-tray__title {
  margin: 0 0 1rem;
  color: var(--gold-bright);
  letter-spacing: 0.3em;
  text-indent: 0.3em;
  text-align: center;
}
.tablet-tray__rack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  justify-content: center;
  /* 托盘木纹底座 */
  padding: 1rem 0.8rem;
  background: linear-gradient(180deg, rgba(60, 40, 24, 0.55), rgba(34, 22, 13, 0.55));
  border-top: 2px solid rgba(217, 184, 124, 0.25);
  border-bottom: 2px solid rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  max-height: 60vh;
  overflow-y: auto;
}
.tablet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  writing-mode: vertical-rl;
  text-orientation: upright;
  padding: 0.9rem 0.55rem;
  min-height: 9.5rem;
  font: inherit;
  color: #f3ead7;
  /* 玉/牙质名牌 */
  background: linear-gradient(100deg, #d9c7a4, #c2a878 55%, #a98c5a);
  border: 1px solid #6b522f;
  border-radius: 3px 3px 5px 5px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 245, 220, 0.4);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.tablet__name {
  writing-mode: vertical-rl;
  letter-spacing: 0.25em;
  font-size: 1.2rem;
  font-weight: 600;
  color: #3a2410; /* 朱漆刻字 */
}
.tablet__rank {
  writing-mode: vertical-rl;
  font-size: 0.72rem;
  color: #5a4124;
}
.tablet:hover {
  transform: translateY(-6px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 245, 220, 0.6),
    0 0 14px rgba(217, 184, 124, 0.4);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/BedchamberPicker.tsx src/ui/styles.css
git commit -m "feat: 翻牌子改为牌子托盘（竖刻名牌 + 排除冷宫/已故）"
```

---

### Task 3: 查看子嗣 — HeirListModal 钻取详情（移除 ± 宠爱）

**Files:**
- Modify: `src/ui/components/HeirListModal.tsx`
- Modify: `src/ui/App.tsx`（call-site：移除 `onAdjust`，传 `registry`；删 `adjustHeirFavor`）
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `registry.portrait(set, "neutral")`、`heirPortraitSet`/`heirStage`/`heirAge`/`heirAgeMonths`/`isEnrolled`/`listHeirsBySex`、`formatGameTime`、`resolveDisplayName`。
- Produces: `HeirListModal` props `{ db, state, registry, onSummon?, canSummon, onClose }`（**移除 `onAdjust`**）。

- [ ] **Step 1: Rewrite HeirListModal with list/detail drill-in**

Replace entire `src/ui/components/HeirListModal.tsx` with:

```tsx
/** 御书房·查看子嗣：皇子/皇郎两表；点名字钻取详情（立绘按年龄/属性/召见）。查看零行动点。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime } from "../../engine/calendar/time";
import {
  heirAge,
  heirAgeMonths,
  heirPortraitSet,
  heirStage,
  isEnrolled,
  listHeirsBySex,
  type NamedHeir,
} from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, Heir } from "../../engine/state/types";

export function HeirListModal({
  db,
  state,
  registry,
  onSummon,
  canSummon,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  onSummon?: (heirId: string) => void;
  canSummon: boolean;
  onClose: () => void;
}) {
  const heirs = state.resources.bloodline.heirs;
  const named: NamedHeir[] = [
    ...listHeirsBySex(heirs, "daughter"),
    ...listHeirsBySex(heirs, "son"),
  ];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = named.find((n) => n.heir.id === selectedId) ?? null;

  const nameOf = (charId: string): string => {
    const c = db.characters[charId];
    if (!c) return charId;
    const st = state.standing[charId];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };

  const bearerLabel = (h: Heir): string => {
    if (h.fatherId === null) return "自孕";
    const c = db.characters[h.fatherId];
    if (!c) return h.fatherId;
    const st = state.standing[h.fatherId];
    const name = resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
    return st?.lifecycle === "deceased" ? `${name}（已故）` : name;
  };

  const renderTable = (sex: "daughter" | "son", title: string) => {
    const rows = named.filter((n) => n.heir.sex === sex);
    return (
      <section className="heir-list__table">
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="heir-list__empty">暂无。</p>
        ) : (
          <ul>
            {rows.map(({ heir, name }) => (
              <li key={heir.id} className="heir-list__row">
                <button
                  type="button"
                  className="heir-list__pick"
                  onClick={() => setSelectedId(heir.id)}
                >
                  <span className="heir-list__name">
                    {name}
                    {heir.legitimate ? "（嫡）" : ""}：{heir.givenName ?? heir.petName || "—"}
                  </span>
                  <span className="heir-list__age">{heirAge(heir, state.calendar)}岁</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const renderDetail = (sel: NamedHeir) => {
    const h = sel.heir;
    const portrait = registry.portrait(heirPortraitSet(h, state.calendar), "neutral");
    const stage = heirStage(h, state.calendar);
    const ageLabel =
      stage === "schooling"
        ? `${heirAge(h, state.calendar)}岁`
        : `${heirAge(h, state.calendar)}岁（${heirAgeMonths(h, state.calendar)}月龄）`;
    return (
      <div className="heir-detail">
        <img
          className="heir-detail__portrait"
          src={portrait.url}
          alt={sel.name}
          data-fallback={portrait.isFallback || undefined}
        />
        <div className="heir-detail__body">
          <h3 className="heir-detail__name">
            {sel.name}
            {h.legitimate ? "（嫡）" : ""}
          </h3>
          <p className="heir-detail__field">名讳：{h.givenName ?? "未赐名"}
            {h.petName ? `（小名 ${h.petName}）` : ""}</p>
          <p className="heir-detail__field">年龄：{ageLabel}</p>
          <p className="heir-detail__field">生辰：{formatGameTime(h.birthAt)}</p>
          <p className="heir-detail__field">承嗣：{bearerLabel(h)}</p>
          {h.adoptiveFatherId && (
            <p className="heir-detail__field">养父：{nameOf(h.adoptiveFatherId)}</p>
          )}
          <p className="heir-detail__field">宠爱：{h.favor}</p>
          {isEnrolled(h, state.calendar) && (
            <p className="heir-detail__field heir-list__edu">
              学问{h.education.scholarship}·骑射{h.education.martial}·品行{h.education.virtue}
            </p>
          )}
          <div className="heir-detail__actions">
            {onSummon && (
              <button type="button" disabled={!canSummon} onClick={() => onSummon(h.id)}>
                召见
              </button>
            )}
            <button type="button" onClick={() => setSelectedId(null)}>
              返回
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>皇嗣</h2>
        {selected ? (
          renderDetail(selected)
        ) : (
          <>
            {renderTable("daughter", "皇子")}
            {renderTable("son", "皇郎")}
          </>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App call-site + remove adjustHeirFavor**

In `src/ui/App.tsx`:

Delete the `adjustHeirFavor` function (currently around lines 339–342):

```ts
  const adjustHeirFavor = (heirId: string, delta: number) => {
    const r = store.applyEffects(db, [{ type: "child_favor", heirId, delta }]);
    if (r.ok) doAutosave();
  };
```

Change the `HeirListModal` render block to pass `registry` and drop `onAdjust`:

```tsx
      {heirListOpen && (
        <HeirListModal
          db={db}
          state={liveState}
          registry={registry}
          onSummon={summonHeir}
          canSummon={liveState.calendar.ap >= 1}
          onClose={() => setHeirListOpen(false)}
        />
      )}
```

- [ ] **Step 3: Add detail styles**

Append to `src/ui/styles.css`:

```css
/* ── 子嗣列表 · 行可点 ─────────────────────────────────────────── */
.heir-list__pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  width: 100%;
  font: inherit;
  text-align: left;
  padding: 0.5rem 0.6rem;
  color: var(--cream);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
}
.heir-list__pick:hover {
  background: rgba(217, 184, 124, 0.07);
  border-color: var(--line-gold);
}
.heir-list__age {
  color: var(--gold-soft);
  font-size: 0.85rem;
}
/* ── 子嗣详情 ──────────────────────────────────────────────────── */
.heir-detail {
  display: flex;
  gap: 1.2rem;
  margin: 0.6rem 0;
}
.heir-detail__portrait {
  width: 11rem;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border: 1px solid var(--line-gold);
  background: var(--ink-800);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.heir-detail__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.heir-detail__name {
  margin: 0 0 0.3rem;
  color: var(--gold-bright);
  letter-spacing: 0.1em;
}
.heir-detail__field {
  margin: 0;
  color: var(--cream-dim);
  font-size: 0.92rem;
}
.heir-detail__actions {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.heir-detail__actions button {
  font: inherit;
  padding: 0.4rem 1.2rem;
  color: var(--gold);
  background: var(--ink-600);
  border: 1px solid var(--line-gold);
  cursor: pointer;
}
.heir-detail__actions button:hover:enabled {
  border-color: var(--gold);
  color: var(--gold-bright);
}
.heir-detail__actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/HeirListModal.tsx src/ui/App.tsx src/ui/styles.css
git commit -m "feat: 查看子嗣弹窗内钻取详情（立绘/年龄/属性，宠爱只读）"
```

---

### Task 4: 查看侍君 — 新 ConsortListModal（钻取详情）

**Files:**
- Modify: `src/ui/components/CharacterCard.tsx`（导出 `ATTRIBUTE_LABELS`）
- Create: `src/ui/components/ConsortListModal.tsx`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `inPalaceConsorts`（Task 1）、`resolveDisplayName`、`computeFavorStats`/`FAVOR_TIER_LABEL`、`bedchamberConfig`、`toGameTime`、`listHeirsBySex`、`ATTRIBUTE_LABELS`。
- Produces: `ConsortListModal` props
  `{ db, state, registry, sovereignPregnant, onManage, onSummon, onAddCandidate, onRemoveCandidate, onClose }`，类型见 Step 2。

- [ ] **Step 1: Export ATTRIBUTE_LABELS from CharacterCard**

In `src/ui/components/CharacterCard.tsx`, add `export` to the labels const:

```tsx
/** 侍君明面属性 — label order follows background §四.4.1. */
export const ATTRIBUTE_LABELS: Array<[keyof ConsortAttributes, string]> = [
  ["appearance", "容貌"],
  ["talent", "才情"],
  ["family", "家世"],
  ["health", "健康"],
  ["nurture", "承养"],
];
```

- [ ] **Step 2: Create ConsortListModal**

Create `src/ui/components/ConsortListModal.tsx`:

```tsx
/** 御书房·查看侍君：宫中侍君列表；点名字钻取详情（属性/恩宠/抚养皇嗣/封号管理/召见）。查看零行动点。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { toGameTime } from "../../engine/calendar/time";
import { computeFavorStats, FAVOR_TIER_LABEL } from "../../engine/characters/favorTier";
import { listHeirsBySex } from "../../engine/characters/heirs";
import { inPalaceConsorts } from "../../engine/characters/presence";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { bedchamberConfig } from "../../store/bedchamber";
import { ATTRIBUTE_LABELS } from "./CharacterCard";

export function ConsortListModal({
  db,
  state,
  registry,
  sovereignPregnant,
  onManage,
  onSummon,
  onAddCandidate,
  onRemoveCandidate,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  sovereignPregnant: boolean;
  onManage: (charId: string) => void;
  onSummon: (charId: string) => void;
  onAddCandidate: (charId: string) => void;
  onRemoveCandidate: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = inPalaceConsorts(db, state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = consorts.find((c) => c.id === selectedId) ?? null;

  // 抚养皇嗣名号查表（按性别出生序编号）。
  const heirs = state.resources.bloodline.heirs;
  const heirNameById = new Map<string, string>();
  for (const sex of ["daughter", "son"] as const) {
    for (const { heir, name } of listHeirsBySex(heirs, sex)) heirNameById.set(heir.id, name);
  }

  const renderRow = (c: CharacterContent) => {
    const st = state.standing[c.id]!;
    return (
      <li key={c.id} className="consort-list__row">
        <button type="button" className="consort-list__pick" onClick={() => setSelectedId(c.id)}>
          <span className="consort-list__name">{resolveDisplayName(c, st, db.ranks[st.rank])}</span>
          <span className="consort-list__rank">
            {db.ranks[st.rank]?.name}
            {st.title ? `·封号「${st.title}」` : ""}
          </span>
        </button>
      </li>
    );
  };

  const renderDetail = (c: CharacterContent) => {
    const st = state.standing[c.id]!;
    const portrait = registry.portrait(c.portraitSet, "neutral");
    const favor = computeFavorStats(
      state.bedchamber[c.id],
      toGameTime(state.calendar),
      bedchamberConfig(db).tiers,
    );
    const raised = heirs.filter((h) => h.fatherId === c.id || h.adoptiveFatherId === c.id);
    const isEmpress = c.id === "feng_hou";
    const lc = st.lifecycle;
    return (
      <div className="consort-detail">
        <img
          className="consort-detail__portrait"
          src={portrait.url}
          alt={c.profile.name}
          data-fallback={portrait.isFallback || undefined}
        />
        <div className="consort-detail__body">
          <h3 className="consort-detail__name">{resolveDisplayName(c, st, db.ranks[st.rank])}</h3>
          <p className="consort-detail__field">
            位分：{db.ranks[st.rank]?.name}
            {st.title ? `　封号：${st.title}` : ""}
          </p>
          <p className="consort-detail__field">{c.profile.role}</p>
          {c.attributes && (
            <dl className="consort-detail__attrs">
              {ATTRIBUTE_LABELS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{c.attributes![key]}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="consort-detail__field">
            恩宠：{FAVOR_TIER_LABEL[favor.tier]}　侍寝 月{favor.lastMonth}·季{favor.lastThreeMonths}·年
            {favor.lastYear}
          </p>
          <p className="consort-detail__field">
            抚养皇嗣：
            {raised.length === 0
              ? "无"
              : raised.map((h) => heirNameById.get(h.id) ?? h.id).join("、")}
          </p>
          <div className="consort-detail__actions">
            <button type="button" onClick={() => onSummon(c.id)}>
              召见
            </button>
            {!isEmpress && (
              <button type="button" onClick={() => onManage(c.id)}>
                封号管理
              </button>
            )}
            {sovereignPregnant && lc === "candidate" && (
              <button type="button" onClick={() => onRemoveCandidate(c.id)}>
                取消候选
              </button>
            )}
            {sovereignPregnant && (lc === undefined || lc === "normal") && (
              <button type="button" onClick={() => onAddCandidate(c.id)}>
                设为候选承嗣
              </button>
            )}
            <button type="button" onClick={() => setSelectedId(null)}>
              返回
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>侍君</h2>
        {selected ? (
          renderDetail(selected)
        ) : (
          <ul className="consort-list">{consorts.map(renderRow)}</ul>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Append to `src/ui/styles.css`:

```css
/* ── 查看侍君 · 列表 + 详情 ─────────────────────────────────────── */
.consort-list {
  list-style: none;
  padding: 0;
  margin: 0.6rem 0;
}
.consort-list__pick {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  width: 100%;
  font: inherit;
  text-align: left;
  padding: 0.55rem 0.6rem;
  color: var(--cream);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
}
.consort-list__pick:hover {
  background: rgba(217, 184, 124, 0.07);
  border-color: var(--line-gold);
}
.consort-list__name {
  color: var(--parchment);
  font-weight: 500;
}
.consort-list__rank {
  color: var(--muted);
  font-size: 0.85rem;
}
.consort-detail {
  display: flex;
  gap: 1.2rem;
  margin: 0.6rem 0;
}
.consort-detail__portrait {
  width: 11rem;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border: 1px solid var(--line-gold);
  background: var(--ink-800);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}
.consort-detail__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.consort-detail__name {
  margin: 0 0 0.3rem;
  color: var(--gold-bright);
  letter-spacing: 0.1em;
}
.consort-detail__field {
  margin: 0;
  color: var(--cream-dim);
  font-size: 0.92rem;
}
.consort-detail__attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.1rem;
  margin: 0.3rem 0;
}
.consort-detail__attrs div {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}
.consort-detail__attrs dt {
  font-size: 0.78rem;
  color: var(--muted);
}
.consort-detail__attrs dd {
  margin: 0;
  color: var(--cream);
}
.consort-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.consort-detail__actions button {
  font: inherit;
  padding: 0.4rem 1.1rem;
  color: var(--gold);
  background: var(--ink-600);
  border: 1px solid var(--line-gold);
  cursor: pointer;
}
.consort-detail__actions button:hover {
  border-color: var(--gold);
  color: var(--gold-bright);
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors. (Component is not yet wired; that's Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/CharacterCard.tsx src/ui/components/ConsortListModal.tsx src/ui/styles.css
git commit -m "feat: 查看侍君弹窗（列表钻取详情：五维/恩宠/抚养皇嗣/封号管理/召见/候选）"
```

---

### Task 5: 御书房菜单重构 + 召见到御书房接线

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Consumes: `ConsortListModal`（Task 4）、`BedchamberPicker`（Task 2）、`CharacterCard`、现有 handler `reviewMemorials`/`restAlone`/`converse`/`beginBedchamber`/`addCandidate`/`removeCandidate`。
- Produces: `LocationScreen` 新增 props
  `onOpenConsorts: () => void`、`summonedConsortId?: string | null`、`onDismissSummon?: () => void`；移除 props `onAddCandidate`/`onRemoveCandidate`（迁入 ConsortListModal）。

- [ ] **Step 1: Rewrite the 御书房 sections + summoned card in LocationScreen**

In `src/ui/screens/LocationScreen.tsx`:

(a) Update the props type and destructure: remove `onAddCandidate`, `onRemoveCandidate`; add `onOpenConsorts`, `summonedConsortId`, `onDismissSummon`. The new prop list:

```tsx
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onOpenSave: () => void;
  onStartEvent: (eventId: string) => void;
  onManage?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onFlipTablet?: () => void;
  onSummonZongzheng?: () => void;
  onSummonPhysician?: () => void;
  onOpenHeirs?: () => void;
  onOpenConsorts?: () => void;
  onReviewMemorials?: () => void;
  onRestAlone?: () => void;
  onConverse?: (charId: string) => void;
  onOpenResources?: () => void;
  summonedConsortId?: string | null;
  onDismissSummon?: () => void;
}) {
```

(b) Replace BOTH `location.id === "yushufang"` sections (the `yushufang-menu` 行动 block AND the entire `location-screen__roster` block — current lines ~107–188) with this single menu block:

```tsx
      {location.id === "yushufang" && (
        <section className="yushufang-menu">
          <div className="yushufang-actions">
            {onReviewMemorials && (
              <button type="button" disabled={state.calendar.ap < 2} onClick={onReviewMemorials}>
                奏折
              </button>
            )}
            {onRestAlone && (
              <button type="button" title="弃当旬剩余行动点，直接进入次旬" onClick={onRestAlone}>
                休息
              </button>
            )}
            {onOpenHeirs && (
              <button type="button" onClick={onOpenHeirs}>
                查看子嗣
              </button>
            )}
            {onOpenConsorts && (
              <button type="button" onClick={onOpenConsorts}>
                查看侍君
              </button>
            )}
            {onFlipTablet && (
              <button type="button" disabled={!canBedchamber} onClick={onFlipTablet}>
                翻牌子
              </button>
            )}
          </div>
          {(onSummonPhysician || onSummonZongzheng) && (
            <div className="yushufang-actions yushufang-actions--minor">
              {onSummonPhysician && (
                <button type="button" onClick={onSummonPhysician}>
                  召见太医
                </button>
              )}
              {onSummonZongzheng && (
                <button type="button" onClick={onSummonZongzheng}>
                  召见宗正寺
                </button>
              )}
            </div>
          )}
        </section>
      )}
```

(c) Above the `return`, after `const sovereignPregnant = ...`, compute the summoned consort:

```tsx
  // 召见到御书房：把被召见的侍君并入在场（仅御书房）。
  const summoned =
    location.id === "yushufang" && summonedConsortId
      ? db.characters[summonedConsortId]
      : undefined;
```

(d) Replace the `location-screen__present` section with one that renders the summoned card (with 退下) plus actual present characters:

```tsx
      <section className="location-screen__present">
        {summoned && (
          <div className="summoned-consort">
            <CharacterCard
              db={db}
              state={state}
              registry={registry}
              character={summoned}
              onManage={onManage ? () => onManage(summoned.id) : undefined}
              onBedchamber={
                onBedchamber && canBedchamber && canSummon(state, summoned.id)
                  ? () => onBedchamber(summoned.id)
                  : undefined
              }
              onConverse={
                onConverse && canBedchamber && canSummon(state, summoned.id)
                  ? () => onConverse(summoned.id)
                  : undefined
              }
            />
            {onDismissSummon && (
              <button type="button" className="summoned-consort__dismiss" onClick={onDismissSummon}>
                退下
              </button>
            )}
          </div>
        )}
        {present.length === 0 && !summoned ? (
          <p className="location-screen__empty">此处无人。</p>
        ) : (
          present
            .filter((character) => character.id !== summoned?.id)
            .map((character) => (
              <CharacterCard
                key={character.id}
                db={db}
                state={state}
                registry={registry}
                character={character}
                onManage={onManage ? () => onManage(character.id) : undefined}
                onBedchamber={
                  onBedchamber && character.kind === "consort" && canBedchamber && canSummon(state, character.id)
                    ? () => onBedchamber(character.id)
                    : undefined
                }
                onConverse={
                  onConverse && character.kind === "consort" && canBedchamber && canSummon(state, character.id)
                    ? () => onConverse(character.id)
                    : undefined
                }
              />
            ))
        )}
      </section>
```

- [ ] **Step 2: Wire App.tsx**

In `src/ui/App.tsx`:

(a) Add state near the other `useState` declarations (after `const [heirListOpen, setHeirListOpen] = useState(false);`):

```tsx
  const [consortListOpen, setConsortListOpen] = useState(false);
  const [summonedConsortId, setSummonedConsortId] = useState<string | null>(null);
```

(b) In `converse`, clear the summon after a successful spend. Change the body to:

```tsx
  const converse = (charId: string) => {
    const lines = buildConversation(db, store.getState(), charId);
    if (!lines) return;
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    setSummonedConsortId(null);
    doAutosave();
    playReactions([{ speakerId: charId, lines }, ...decreeBeats], spend.value.rolledOver);
  };
```

(c) In `commitBedchamber`, clear the summon after a successful spend. Add `setSummonedConsortId(null);` immediately after the `if (!spend.ok) return;` line:

```tsx
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return; // AP guard backstop — don't autosave an un-spent encounter
    setSummonedConsortId(null);
    doAutosave();
```

(d) In `reviewMemorials` and `restAlone`, clear the summon at the top of each function body (first line):

```tsx
    setSummonedConsortId(null);
```

(e) Update the `LocationScreen` render block props — remove `onAddCandidate`/`onRemoveCandidate`, add `onOpenConsorts`/`summonedConsortId`/`onDismissSummon`, and clear summon when leaving the room:

```tsx
      {view === "location" && (
        <LocationScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => {
            setSummonedConsortId(null);
            setMapAtRoot(false); // open on the current board so 返回 climbs to 主图
            setView("map");
          }}
          onOpenSave={() => {
            setSummonedConsortId(null);
            setView("save");
          }}
          onStartEvent={startEvent}
          onManage={(id) => setManageCharId(id)}
          onBedchamber={(id) => beginBedchamber(id)}
          onFlipTablet={() => setFlipOpen(true)}
          onSummonZongzheng={canSummonZongzheng ? () => setSuccessorOpen(true) : undefined}
          onSummonPhysician={() => setPhysicianOpen(true)}
          onOpenHeirs={() => setHeirListOpen(true)}
          onOpenConsorts={() => setConsortListOpen(true)}
          onReviewMemorials={reviewMemorials}
          onRestAlone={restAlone}
          onConverse={converse}
          onOpenResources={() => setResourcePanelOpen(true)}
          summonedConsortId={summonedConsortId}
          onDismissSummon={() => setSummonedConsortId(null)}
        />
      )}
```

(f) Change `BedchamberPicker`'s `onPick` from `beginBedchamber` to a summon, and add the `ConsortListModal` render. Replace the existing `flipOpen` block with:

```tsx
      {flipOpen && (
        <BedchamberPicker
          db={db}
          state={store.getState()}
          onPick={(id) => {
            setFlipOpen(false);
            setSummonedConsortId(id);
          }}
          onClose={() => setFlipOpen(false)}
        />
      )}
      {consortListOpen && (
        <ConsortListModal
          db={db}
          state={liveState}
          registry={registry}
          sovereignPregnant={preg.status !== "none"}
          onManage={(id) => setManageCharId(id)}
          onSummon={(id) => {
            setConsortListOpen(false);
            setSummonedConsortId(id);
          }}
          onAddCandidate={addCandidate}
          onRemoveCandidate={removeCandidate}
          onClose={() => setConsortListOpen(false)}
        />
      )}
```

(g) Add the import near the other component imports:

```tsx
import { ConsortListModal } from "./components/ConsortListModal";
```

- [ ] **Step 3: Add menu styles**

Append to `src/ui/styles.css`:

```css
/* ── 御书房主菜单 ──────────────────────────────────────────────── */
.yushufang-actions--minor {
  margin-top: 0.4rem;
}
.yushufang-actions--minor button {
  color: var(--cream-dim);
  background: transparent;
  border-color: var(--line-strong);
}
.yushufang-actions--minor button:hover:enabled {
  color: var(--gold);
  border-color: var(--line-gold);
}
/* ── 御书房·召见侍君卡 ─────────────────────────────────────────── */
.summoned-consort {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem;
  border: 1px solid var(--gold);
  border-radius: 3px;
  background: rgba(217, 184, 124, 0.05);
  box-shadow: 0 0 16px rgba(217, 184, 124, 0.12);
}
.summoned-consort__dismiss {
  font: inherit;
  padding: 0.35rem 1rem;
  color: var(--cream-dim);
  background: var(--ink-600);
  border: 1px solid var(--line-strong);
  cursor: pointer;
}
.summoned-consort__dismiss:hover {
  color: var(--gold);
  border-color: var(--line-gold);
}
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/LocationScreen.tsx src/ui/App.tsx src/ui/styles.css
git commit -m "feat: 御书房5项菜单 + 杂务组 + 召见到御书房（牌子托盘/查看侍君接线）"
```

---

### Task 6: 端到端验证（Playwright）

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

Run (background): `npm run dev -- --port 5219`
Confirm: log shows `ready` and `Local: http://localhost:5219/`.

- [ ] **Step 2: Drive the 御书房 flow with Playwright**

Navigate to `http://localhost:5219/`, 新游戏 → 宫城图 → 御书房（若起始已在御书房则略过）。逐项核对：

1. 御书房显示菜单：奏折 / 休息 / 查看子嗣 / 查看侍君 / 翻牌子；孕期才出现 召见太医 / 召见宗正寺。
2. 查看子嗣 → 点皇嗣 → 详情显示立绘（按年龄 baby/school）、年龄、属性；宠爱**无 ± 按钮**；返回/关闭可用。记录当前 AP，开关弹窗后 AP 不变。
3. 查看侍君 → 列表无冷宫/已故 → 点侍君 → 五维 + 恩宠 + 抚养皇嗣 + 封号管理 + 召见；点封号管理弹 `RankAdminModal`；返回可用。
4. 翻牌子 → 托盘竖排名牌（冷宫/已故不出现）→ 点牌 → 弹窗关闭、御书房出现该侍君立绘卡（金框 + 退下）。
5. 召见卡：对话扣 1 AP 并清除召见卡；再召见 → 侍寝走流程，提交扣 1 AP 并清除。点退下清除卡、AP 不变。

Capture screenshots of: 菜单、子嗣详情、侍君详情、牌子托盘、召见卡。

- [ ] **Step 3: Confirm no console errors (beyond favicon 404) and AP rules hold**

Verify viewing actions never decrement `hud__time` AP; only 奏折/对话/侍寝/召见皇嗣 do.

- [ ] **Step 4: Stop dev server + clean screenshots**

```bash
pkill -f "vite --port 5219"
```

---

## Self-Review

**Spec coverage:**
- 5 项主菜单 + 杂务组 → Task 5 ✓
- 候选承嗣入查看侍君详情（孕期）→ Task 4 + Task 5(wiring) ✓
- 查看子嗣详情（立绘按年龄/年龄/属性/宠爱只读/召见）→ Task 3 ✓
- 查看侍君详情（五维/恩宠/抚养皇嗣/封号管理/召见）→ Task 4 ✓
- 翻牌子牌子托盘 + 排除冷宫/已故 → Task 2（视觉/过滤）+ Task 5（onPick→召见）✓
- 召见到御书房瞬时卡 + 对话/侍寝 + 清除时机 → Task 5 ✓
- 统一「宫中侍君」过滤 helper → Task 1 ✓
- 查看零行动点 → Task 3/4 纯渲染，Task 6 验证 ✓

**Placeholder scan:** 无 TODO/TBD；所有代码步骤含完整代码。

**Type consistency:**
- `inPalaceConsorts(db, state)` 在 Task 1 定义，Task 2/4 使用，签名一致。
- `HeirListModal` 去 `onAdjust`、加 `registry`：Task 3 同时改组件与 App call-site，保持一致。
- `LocationScreen` 去 `onAddCandidate`/`onRemoveCandidate`、加 `onOpenConsorts`/`summonedConsortId`/`onDismissSummon`：Task 5 同时改组件与 App，一致。
- `ConsortListModal` props 与 Task 5 渲染处一一对应。
- `ATTRIBUTE_LABELS` 由 `CharacterCard` 导出（Task 4 Step 1），ConsortListModal 导入，一致。
- `setSummonedConsortId` 在 Task 5 各清除点命名一致。
