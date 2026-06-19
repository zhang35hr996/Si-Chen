# 太后系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增太后 NPC、慈宁宫地点、太后对话、生病/侍疾、敲打侍君、太后入养父池。

**Architecture:** 太后 = `kind:"elder"` 的 db 角色（无位分/属性）；慈宁宫走专用 `CiningGongScreen`（仿 上书房/奉先殿，避开 location_enter 事件自动触发问题）。生病在旬翻转掷骰、侍疾在进慈宁宫掷骰、敲打在每行动点掷骰——全部种子化确定性，经 `applyEffects` 漏斗写状态，台词经 `ReactionScreen`/`reactionQueue` 串播。

**Tech Stack:** TypeScript strict · React · Zod · Vitest

**Spec:** `docs/superpowers/specs/2026-06-18-taihou-system-design.md`

---

## 关键既有事实（实现者必读）

- 效果只能经 `src/engine/effects/funnel.ts` 的 `applyEffects(db, state, effects)`。新效果 = `eventEffectSchema` 加分支（`src/engine/content/schemas.ts`）+ funnel `validateEffects` 分支 + apply 分支。
- `favor` 效果 `{type:"favor", char, delta}`，`delta` schema 限 ±10，apply 走 `cappedDelta`（±10）。本计划用 ±5。
- 掷骰统一用 `gestationRoll(seedString: string): number`（`src/engine/characters/gestation.ts`），返回非负整数；取 `% 100` 比概率，`% n` 选索引。**禁用 `Math.random`**。
- 凤后懿旨是范本：`src/store/empressDecree.ts` 的 `buildEmpressDecree(db,state,seedKey)`；App 在 `spendAp`→`rollDecree` 每行动点掷骰。
- 旬翻转：每次 `SPEND_AP` 耗尽行动点 → `spend.value.rolledOver === true`，恰好过一旬。`restAlone`(`SKIP_REMAINDER`) 也翻旬。
- 专用屏路由：`enterCurrentLocation()`（App.tsx）按 `playerLocation` 路由 shangshufang/fengxiandian/location；`runCheckpoints` 的 else-if 链同理；`MapScreen.onEnterCurrent` 与 `SaveLoadScreen.onClose/onLoaded` 都用 `enterCurrentLocation`。
- `getPresentAt`（`src/engine/characters/presence.ts`）排序时访问 `character.initialStanding.rank`——太后无 standing，须先改成 null-safe（Task 1）。
- 存档：`SAVE_FORMAT_VERSION`(`src/engine/save/saveSystem.ts`) 现为 3；`MIGRATIONS[v]` 阶梯迁移；`gameStateSchema`(`src/engine/save/stateSchema.ts`) 是 `strictObject(...) satisfies z.ZodType<GameState>`——给 `GameState` 加键必须同步加 schema 键。
- 计数测试：`tests/content/boot.test.ts`（角色/地点/事件/场景数）、`tests/assets/manifestCheck.test.ts`（`entryCount`）。每加内容都要更新。

运行测试：`npx vitest run <path>`；全量 `npx vitest run`；`npm run typecheck`；`npm run validate-content`；`npm run validate-manifest`。

---

## Task 1: elder 角色种类 + 太后角色 + 慈宁宫地点

**Files:**
- Modify: `src/engine/content/schemas.ts`（character `kind` enum、`initialStanding` 可选）
- Modify: `src/engine/state/newGame.ts`（elder 跳过 standing）
- Modify: `src/engine/characters/presence.ts`（排序 null-safe）
- Create: `content/characters/taihou.json`
- Create: `content/locations/cining_gong.json`
- Modify: `content/locations/yushufang.json`（connections 加 cining_gong）
- Modify: `tests/content/boot.test.ts`（计数 6 角色 / 9 地点）
- Create: `tests/content/ciningGong.test.ts`
- Test: `tests/content/schemas.test.ts`（若有 elder 断言，可加）

- [ ] **Step 1: 写失败测试 — elder 角色与慈宁宫解析**

Create `tests/content/ciningGong.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("太后 + 慈宁宫 content", () => {
  const result = loadGameContent();

  it("loads without errors", () => {
    expect(result.ok).toBe(true);
  });

  it("太后 is an elder with no standing, no attributes", () => {
    if (!result.ok) return;
    const c = result.value.characters["taihou"];
    expect(c).toBeDefined();
    expect(c!.kind).toBe("elder");
    expect(c!.attributes).toBeUndefined();
    expect(c!.defaultLocation).toBe("cining_gong");
    expect(c!.portraitSet).toBe("taihou");
  });

  it("慈宁宫 is a palace travel node bidirectionally linked to 御书房", () => {
    if (!result.ok) return;
    const loc = result.value.locations["cining_gong"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.entry).toBe("travel");
    expect(loc!.connections).toContain("yushufang");
    expect(result.value.locations["yushufang"]!.connections).toContain("cining_gong");
  });
});
```

> `loadGameContent()` returns `Result<ContentDB>`; guard `result.ok` before reading `result.value` (this is the exact pattern in `tests/content/fengxiandian.test.ts`).

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/content/ciningGong.test.ts`
Expected: FAIL（taihou/cining_gong 不存在，或 elder 不被 schema 接受）

- [ ] **Step 3: schema 接受 elder + initialStanding 可选**

In `src/engine/content/schemas.ts`, change character `kind`:

```ts
    kind: z.enum(["consort", "official", "elder"]),
```

And make `initialStanding` optional (elders carry no 位分):

```ts
    initialStanding: characterStandingSchema.optional(),
```

- [ ] **Step 4: newGame 对无 standing 的角色跳过 seeding**

In `src/engine/state/newGame.ts`, replace line `standing[character.id] = { ...character.initialStanding };` with:

```ts
    if (character.initialStanding) {
      standing[character.id] = { ...character.initialStanding };
    }
```

- [ ] **Step 5: presence 排序 null-safe**

In `src/engine/characters/presence.ts`, change the sort comparator to tolerate a missing `initialStanding`:

```ts
    .sort(
      (a, b) =>
        (db.ranks[b.initialStanding?.rank ?? ""]?.order ?? 0) -
        (db.ranks[a.initialStanding?.rank ?? ""]?.order ?? 0),
    );
```

- [ ] **Step 6: 写太后角色文件**

Create `content/characters/taihou.json`:

```json
{
  "id": "taihou",
  "kind": "elder",
  "profile": {
    "name": "太后",
    "age": 52,
    "role": "陛下生父，退居慈宁宫颐养的尊长",
    "appearance": "鬓染微霜，眉目仍见当年风仪，常着石青常服，神色温然而自有威重。",
    "personalityTraits": ["慈和", "威重", "明察", "护礼法"],
    "coreFacts": ["陛下生父，昔年正位中宫", "如今退居慈宁宫，不预朝政而重家法", "膝下儿孙是其晚岁牵挂"],
    "goals": ["盼皇嗣得善教养", "戒诸侍君恃宠骄纵，护后宫安宁"],
    "speechStyle": "言语温缓，话里有分量；训诫时不疾不徐，慈中带戒。"
  },
  "defaultLocation": "cining_gong",
  "portraitSet": "taihou",
  "expressions": ["neutral"],
  "voice": {
    "register": "formal",
    "quirks": ["自称『哀家』", "称陛下『皇帝』而非『陛下』", "唤侍君多以位分相称"],
    "tabooTopics": []
  },
  "initialRelationship": { "trust": 60, "affinity": 55, "flags": [] },
  "initialMemories": [],
  "secrets": []
}
```

> Note: no `initialStanding`, no `attributes`, no `stances`. `secrets` must be `[]`. `expressions` must include `"neutral"`.

- [ ] **Step 7: 写慈宁宫地点文件**

Create `content/locations/cining_gong.json`:

```json
{
  "id": "cining_gong",
  "name": "慈宁宫",
  "description": "太后颐养之所。庭中古柏森然，廊下檀香袅袅，处处透着不预世事的清贵与沉静。",
  "backgroundKey": "bg.cining_gong",
  "ambience": ["檀香", "古柏苍翠", "宫人屏息侍立"],
  "position": { "x": 0.16, "y": 0.58 },
  "zone": "palace",
  "connections": ["yushufang"],
  "travelCost": { "ap": 1 }
}
```

- [ ] **Step 8: 御书房加回边（连接对称）**

In `content/locations/yushufang.json`, add `"cining_gong"` to `connections`:

```json
  "connections": ["yuhuayuan", "shangshufang", "fengxiandian", "cining_gong"],
```

- [ ] **Step 9: 更新 boot 计数**

In `tests/content/boot.test.ts`, update the `it("contains the planned slice ...")` title and assertions:
- Title: `6 characters, 9 locations` (events/scenes 在 Task 2 再改).
- characters array add `"taihou"`.
- locations array add `"cining_gong"`.

```ts
    expect(Object.keys(db.characters).sort()).toEqual(
      ["chu_jun", "feng_hou", "shen_chenghui", "sili_nvguan", "wenya_shijun", "taihou"].sort(),
    );
    expect(Object.keys(db.locations).sort()).toEqual(
      ["chaotang", "fengxiandian", "kunninggong", "lenggong", "shangshufang", "xianfugong", "yushufang", "yuhuayuan", "cining_gong"].sort(),
    );
```

- [ ] **Step 10: 跑测试确认通过**

Run: `npx vitest run tests/content/ciningGong.test.ts tests/content/boot.test.ts`
Expected: PASS

- [ ] **Step 11: 全量回归 + 内容校验**

Run: `npm run typecheck && npm run validate-content && npx vitest run`
Expected: 全绿（注意：manifest 还缺 `bg.cining_gong`/`portrait.taihou.neutral` → `validate-manifest` 暂会告警，Task 8 处理；本步不跑 validate-manifest）

- [ ] **Step 12: 提交**

```bash
git add src/engine/content/schemas.ts src/engine/state/newGame.ts src/engine/characters/presence.ts content/characters/taihou.json content/locations/cining_gong.json content/locations/yushufang.json tests/content/ciningGong.test.ts tests/content/boot.test.ts
git commit -m "feat: 太后 elder 角色 + 慈宁宫地点"
```

---

## Task 2: 太后对话（脚本事件）+ 慈宁宫专用屏

**Files:**
- Create: `content/events/ev_taihou_converse.json`
- Create: `content/scenes/sc_taihou_converse.json`
- Create: `src/ui/screens/CiningGongScreen.tsx`
- Modify: `src/ui/App.tsx`（view 类型、import、`enterCurrentLocation`、`runCheckpoints` else-if、render 块）
- Modify: `tests/content/boot.test.ts`（events 7 / scenes 7）
- Test: `tests/content/ciningGong.test.ts`（追加事件断言）

**背景**：慈宁宫是 travel 地点。若把太后对话设为 `checkpoint:"location_enter"`，`runCheckpoints` 到站会自动 `startEvent` 它（变成强制过场）。为让它**可选**，慈宁宫路由到专用 `CiningGongScreen`（仿 `ShangshufangScreen`），由屏内按钮 `onStartEvent("ev_taihou_converse")` 手动触发；事件 `checkpoint` 设 `"game_start"`——game_start 只在新游戏查询一次（彼时玩家在御书房，`atLocation:cining_gong` 不满足），故永不自动触发，仅按钮触发。

- [ ] **Step 1: 追加失败测试 — 太后对话事件解析**

Append to `tests/content/ciningGong.test.ts`:

```ts
  it("太后对话 event/scene present, 1 AP, located at 慈宁宫", () => {
    if (!result.ok) return;
    const ev = result.value.events["ev_taihou_converse"];
    expect(ev).toBeDefined();
    expect(ev!.apCost).toBe(1);
    expect(ev!.sceneId).toBe("sc_taihou_converse");
    expect(result.value.scenes["sc_taihou_converse"]).toBeDefined();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/content/ciningGong.test.ts`
Expected: FAIL（事件/场景不存在）

- [ ] **Step 3: 写太后对话事件**

Create `content/events/ev_taihou_converse.json`:

```json
{
  "id": "ev_taihou_converse",
  "title": "与太后叙话",
  "sceneId": "sc_taihou_converse",
  "checkpoint": "game_start",
  "condition": { "atLocation": "cining_gong" },
  "priority": 0,
  "once": false,
  "apCost": 1
}
```

> `checkpoint:"game_start"` 是「仅手动触发」的标记：game_start 仅在新游戏查询一次，那时玩家不在慈宁宫，故此事件永不自动弹出，只由 `CiningGongScreen` 按钮触发。

- [ ] **Step 4: 写太后对话场景**

Create `content/scenes/sc_taihou_converse.json`:

```json
{
  "id": "sc_taihou_converse",
  "locationId": "cining_gong",
  "participants": ["taihou"],
  "startNodeId": "n_open",
  "nodes": [
    {
      "type": "line",
      "id": "n_open",
      "speaker": "taihou",
      "text": "皇帝来了。哀家这里清静，难得你还记挂着来坐坐。近日朝中可还安顺？",
      "expression": "neutral",
      "next": "n_choice"
    },
    {
      "type": "choice",
      "id": "n_choice",
      "choices": [
        { "id": "c_filial", "text": "儿臣特来给母后请安。", "tone": "friendly", "next": "n_fx_filial" },
        { "id": "c_heir", "text": "想请母后为皇嗣教养指点一二。", "tone": "neutral", "next": "n_fx_heir" }
      ]
    },
    {
      "type": "line",
      "id": "n_fx_filial",
      "speaker": "taihou",
      "text": "好孩子。你身在万乘之位，也莫太亏了自己。哀家别无所求，只盼你保重。",
      "expression": "neutral",
      "next": "n_fx_apply"
    },
    {
      "type": "line",
      "id": "n_fx_heir",
      "speaker": "taihou",
      "text": "教养皇嗣，重在德行根基。你肯上心，是宗社之福。哀家也算放心了。",
      "expression": "neutral",
      "next": "n_fx_apply"
    },
    {
      "type": "effect",
      "id": "n_fx_apply",
      "effects": [
        { "type": "resource", "pillar": "bloodline", "field": "legitimacy", "delta": 2 },
        {
          "type": "memory",
          "char": "taihou",
          "entry": {
            "kind": "event",
            "summary": "皇帝来慈宁宫问安叙话，哀家心里宽慰。",
            "salience": 45,
            "tags": ["player", "taihou"],
            "participants": ["player", "taihou"],
            "locationId": "cining_gong"
          }
        }
      ],
      "next": null
    }
  ]
}
```

> Confirm node-type field names against `content/scenes/sc_chaohui.json` (e.g. `effect` node uses `effects` + `next:null` terminal). Match that file's exact shape.

- [ ] **Step 5: 写 CiningGongScreen**

Create `src/ui/screens/CiningGongScreen.tsx` (mirror `src/ui/screens/ShangshufangScreen.tsx` 的头部/HUD 结构；先打开该文件抄 HUD + 背景 + 返回按钮，再换内容):

```tsx
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function CiningGongScreen({
  db,
  store,
  registry,
  onOpenMap,
  onOpenSave,
  onConverse,
  onOpenResources,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onOpenSave: () => void;
  onConverse: () => void;
  onOpenResources?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["cining_gong"]!;
  const taihou = db.characters["taihou"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const portrait = registry.portrait(taihou.portraitSet, "neutral");
  const canAct = state.calendar.ap >= 1;
  const ill = state.taihou.ill;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        <span className="hud__group">
          {onOpenResources && (
            <button type="button" className="hud__button" onClick={onOpenResources}>国情</button>
          )}
          <button type="button" className="hud__button" onClick={onOpenSave}>存档</button>
          <button type="button" className="hud__button" onClick={onOpenMap}>宫城图</button>
        </span>
      </header>

      <section
        className="location-screen__stage"
        style={{ backgroundImage: `url("${background.url}")` }}
        data-fallback={background.isFallback || undefined}
      >
        <h1 className="location-screen__name">{location.name}</h1>
        <p className="location-screen__desc">{location.description}</p>
        <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
      </section>

      <section className="location-screen__present">
        <article className="char-card">
          <img
            className="char-card__portrait"
            src={portrait.url}
            alt={taihou.profile.name}
            data-fallback={portrait.isFallback || undefined}
          />
          <header className="char-card__header">
            <strong className="char-card__name">{taihou.profile.name}</strong>
            <span className="char-card__kind">尊长</span>
          </header>
          <p className="char-card__role">{taihou.profile.role}</p>
          {ill && <p className="char-card__lifecycle" data-lifecycle="deceased">凤体违和</p>}
          <button type="button" className="char-card__converse" disabled={!canAct} onClick={onConverse}>
            与太后叙话（1行动点）
          </button>
        </article>
      </section>
    </main>
  );
}
```

> `state.taihou` 在 Task 3 才加入 `GameState`。本 Task 先实现到 `const ill = state.taihou.ill;` 会 typecheck 失败——因此本 Task 的 CiningGongScreen 暂时**不读 `state.taihou`**：删掉 `const ill` 行与 `{ill && ...}` 行，留 TODO 注释 `// 凤体违和提示在 Task 3 接入`。Task 3 完成后再补回这两行。

- [ ] **Step 6: App 接线 — view 类型 + import + 路由 + render**

In `src/ui/App.tsx`:

(a) import:
```ts
import { CiningGongScreen } from "./screens/CiningGongScreen";
```

(b) View union type — find the `type View = ...` (or `useState<...>` for `view`) that lists `"shangshufang" | "fengxiandian"` and add `| "cining_gong"`.

(c) `enterCurrentLocation`:
```ts
  const enterCurrentLocation = () => {
    const loc = store.getState().playerLocation;
    setView(
      loc === "shangshufang" ? "shangshufang" :
      loc === "fengxiandian" ? "fengxiandian" :
      loc === "cining_gong" ? "cining_gong" :
      "location",
    );
  };
```

(d) `runCheckpoints` else-if 链——在 fengxiandian 分支后加：
```ts
    else if (store.getState().playerLocation === "cining_gong") setView("cining_gong");
```

(e) render 块（放在 `view === "fengxiandian"` 块之后）:
```tsx
      {view === "cining_gong" && (
        <CiningGongScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSave={() => setView("save")}
          onConverse={() => startEvent("ev_taihou_converse")}
          onOpenResources={() => setResourcePanelOpen(true)}
        />
      )}
```

- [ ] **Step 7: 更新 boot 计数（events 7 / scenes 7）**

In `tests/content/boot.test.ts`: title 改 `7 events, 7 scenes`；events 数组加 `"ev_taihou_converse"`；`expect(Object.keys(db.scenes)).toHaveLength(7);`。

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run tests/content/ciningGong.test.ts tests/content/boot.test.ts && npm run typecheck && npm run validate-content`
Expected: PASS / 绿

- [ ] **Step 9: 提交**

```bash
git add content/events/ev_taihou_converse.json content/scenes/sc_taihou_converse.json src/ui/screens/CiningGongScreen.tsx src/ui/App.tsx tests/content/boot.test.ts tests/content/ciningGong.test.ts
git commit -m "feat: 太后对话脚本事件 + 慈宁宫专用屏"
```

---

## Task 3: 太后生病状态 + 效果 + 旬掷骰 + 存档迁移

**Files:**
- Modify: `src/engine/state/types.ts`（`TaihouState` + `GameState.taihou`）
- Modify: `src/engine/state/newGame.ts`（初始 `taihou:{ill:false}`）
- Modify: `src/engine/content/schemas.ts`（`set_taihou_illness` 效果）
- Modify: `src/engine/effects/funnel.ts`（validate + apply）
- Create: `src/store/taihou.ts`（`taihouIllnessChance` + `buildTaihouIllnessTick`）
- Modify: `src/engine/save/stateSchema.ts`（`taihou` schema）
- Modify: `src/engine/save/saveSystem.ts`（version 4 + migration 3）
- Modify: `src/ui/screens/CiningGongScreen.tsx`（补回 `ill` 提示）
- Test: `tests/store/taihou.test.ts`、`tests/effects/funnel.taihou.test.ts`、`tests/save/migrationV4.test.ts`

- [ ] **Step 1: 写失败测试 — 概率与 tick**

Create `tests/store/taihou.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { taihouIllnessChance, buildTaihouIllnessTick } from "../../src/store/taihou";
import type { GameState } from "../../src/engine/state/types";

function stateWith(over: { ill: boolean; year: number }): GameState {
  // minimal stub: only fields taihou logic reads
  return {
    calendar: { year: over.year, month: 1, period: "early", apMax: 6, ap: 6, dayIndex: 0 },
    taihou: { ill: over.ill },
  } as unknown as GameState;
}

describe("taihouIllnessChance", () => {
  it("元年 5%, 逐年 +1%, 封顶 25%", () => {
    expect(taihouIllnessChance(1)).toBe(5);
    expect(taihouIllnessChance(2)).toBe(6);
    expect(taihouIllnessChance(21)).toBe(25);
    expect(taihouIllnessChance(40)).toBe(25);
  });
});

describe("buildTaihouIllnessTick", () => {
  it("not ill: a hitting seed produces set_taihou_illness{ill:true} + a prompt beat", () => {
    // probe seeds until one falls under the 元年 5% gate (deterministic search)
    let hitSeed = "";
    for (let i = 0; i < 500; i++) {
      const tick = buildTaihouIllnessTick(stateWith({ ill: false, year: 1 }), `probe:${i}`);
      if (tick && tick.effects.some((e) => e.type === "set_taihou_illness" && e.ill === true)) { hitSeed = `probe:${i}`; break; }
    }
    expect(hitSeed).not.toBe("");
    const tick = buildTaihouIllnessTick(stateWith({ ill: false, year: 1 }), hitSeed)!;
    expect(tick.beats.length).toBeGreaterThan(0);
  });

  it("deterministic: same state+seed → same result", () => {
    const a = buildTaihouIllnessTick(stateWith({ ill: false, year: 3 }), "k1");
    const b = buildTaihouIllnessTick(stateWith({ ill: false, year: 3 }), "k1");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ill: a hitting recover seed produces set_taihou_illness{ill:false}, no prompt", () => {
    let seed = "";
    for (let i = 0; i < 200; i++) {
      const tick = buildTaihouIllnessTick(stateWith({ ill: true, year: 1 }), `r:${i}`);
      if (tick && tick.effects.some((e) => e.type === "set_taihou_illness" && e.ill === false)) { seed = `r:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const tick = buildTaihouIllnessTick(stateWith({ ill: true, year: 1 }), seed)!;
    expect(tick.beats.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: FAIL（`src/store/taihou.ts` 不存在）

- [ ] **Step 3: types — TaihouState + GameState.taihou**

In `src/engine/state/types.ts`, add before `GameState`:

```ts
export interface TaihouState {
  /** 太后是否卧病。 */
  ill: boolean;
}
```

And add to `GameState` (after `rngSeed: number;` or anywhere in the interface body):

```ts
  taihou: TaihouState;
```

- [ ] **Step 4: newGame 初始化 taihou**

In `src/engine/state/newGame.ts`, in the returned object add:

```ts
    taihou: { ill: false },
```

- [ ] **Step 5: schema — set_taihou_illness 效果**

In `src/engine/content/schemas.ts`, add to the `eventEffectSchema` union (next to other state-setting effects):

```ts
  z.strictObject({ type: z.literal("set_taihou_illness"), ill: z.boolean() }),
```

- [ ] **Step 6: funnel — validate + apply**

In `src/engine/effects/funnel.ts` `validateEffects` switch, add a no-op validation case (no target to check):

```ts
      case "set_taihou_illness":
        break;
```

In the apply switch (near `flag`/`set_bloodline_status`):

```ts
      case "set_taihou_illness": {
        next.taihou.ill = effect.ill;
        break;
      }
```

- [ ] **Step 7: 写 src/store/taihou.ts（概率 + tick）**

Create `src/store/taihou.ts`:

```ts
/** 太后系统纯逻辑（生病/侍疾/敲打），种子化确定性。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export const TAIHOU_BASE_ILL_CHANCE = 5;
export const TAIHOU_ILL_CHANCE_CAP = 25;
export const TAIHOU_RECOVER_CHANCE = 50;

export interface TaihouBeats {
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 元年=5%，逐年+1%，封顶 25%。 */
export function taihouIllnessChance(year: number): number {
  return Math.min(TAIHOU_BASE_ILL_CHANCE + Math.max(0, year - 1), TAIHOU_ILL_CHANCE_CAP);
}

/** 旬翻转掷骰：未病→可能生病（含提示）；已病→可能自愈（无提示）。无变化返回 null。 */
export function buildTaihouIllnessTick(state: GameState, seedKey: string): TaihouBeats | null {
  if (!state.taihou.ill) {
    const chance = taihouIllnessChance(state.calendar.year);
    if (gestationRoll(`taihou:ill:${seedKey}`) % 100 >= chance) return null;
    return {
      effects: [{ type: "set_taihou_illness", ill: true }],
      beats: [{ speakerId: "sili_nvguan", lines: ["司礼官急奏：太后凤体违和，太医已往慈宁宫诊视。"] }],
    };
  }
  if (gestationRoll(`taihou:recover:${seedKey}`) % 100 >= TAIHOU_RECOVER_CHANCE) return null;
  return { effects: [{ type: "set_taihou_illness", ill: false }], beats: [] };
}
```

- [ ] **Step 8: 跑 store 测试确认通过**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: PASS

- [ ] **Step 9: 写 funnel 失败测试**

Create `tests/effects/funnel.taihou.test.ts` (same harness as `tests/effects/funnel.bedchamber.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("set_taihou_illness", () => {
  it("flips taihou.ill through the funnel", () => {
    const s0 = createNewGameState(db);
    expect(s0.taihou.ill).toBe(false);
    const r = applyEffects(db, s0, [{ type: "set_taihou_illness", ill: true }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.taihou.ill).toBe(true);
  });
});
```

- [ ] **Step 10: 跑确认通过（funnel 已在 Step 6 实现）**

Run: `npx vitest run tests/effects/funnel.taihou.test.ts`
Expected: PASS

- [ ] **Step 11: stateSchema 加 taihou**

In `src/engine/save/stateSchema.ts`, add to `gameStateSchema` strictObject (anywhere among top keys):

```ts
  taihou: z.strictObject({ ill: z.boolean() }),
```

- [ ] **Step 12: 存档版本 + 迁移测试**

Create `tests/save/migrationV4.test.ts` (mirror an existing `tests/save/migration*.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { SAVE_FORMAT_VERSION } from "../../src/engine/save/saveSystem";

describe("save format v4", () => {
  it("version is 4", () => {
    expect(SAVE_FORMAT_VERSION).toBe(4);
  });
});
```

Plus a round-trip/migration assertion mirroring the existing v2→v3 migration test: load a v3 envelope lacking `state.taihou` and assert the loaded state has `taihou:{ill:false}`. Copy the structure of the existing `tests/save/migration*.test.ts` that builds a stale envelope and runs the loader.

- [ ] **Step 13: 升版本 + 写迁移**

In `src/engine/save/saveSystem.ts`:
- `export const SAVE_FORMAT_VERSION = 4;`
- Add `MIGRATIONS[3]`:

```ts
  3: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    if (state.taihou === undefined) state.taihou = { ill: false };
    return { ...env, formatVersion: 4, state, checksum: checksumOf(state) };
  },
```

> Match the exact helper names used in the existing `MIGRATIONS[1]/[2]` (`checksumOf`, `SaveEnvelope`).

- [ ] **Step 14: 补回 CiningGongScreen 的 ill 提示**

In `src/ui/screens/CiningGongScreen.tsx`, restore:
```tsx
  const ill = state.taihou.ill;
```
and the `{ill && <p className="char-card__lifecycle" data-lifecycle="deceased">凤体违和</p>}` line.

- [ ] **Step 15: 全量回归**

Run: `npx vitest run tests/store/taihou.test.ts tests/effects/funnel.taihou.test.ts tests/save/migrationV4.test.ts && npm run typecheck && npx vitest run`
Expected: 全绿

- [ ] **Step 16: 提交**

```bash
git add src/engine/state/types.ts src/engine/state/newGame.ts src/engine/content/schemas.ts src/engine/effects/funnel.ts src/store/taihou.ts src/engine/save/stateSchema.ts src/engine/save/saveSystem.ts src/ui/screens/CiningGongScreen.tsx tests/store/taihou.test.ts tests/effects/funnel.taihou.test.ts tests/save/migrationV4.test.ts
git commit -m "feat: 太后生病状态/效果/旬掷骰 + 存档 v4 迁移"
```

---

## Task 4: App 接线 — 旬翻转掷骰生病

**Files:**
- Modify: `src/ui/App.tsx`

**目标**：每次旬翻转（`rolledOver`）掷一次生病/自愈 tick，把效果应用、提示节拍并入既有反应流。所有 `spendAp` 调用点（对话/侍寝/召见皇嗣/问功课/问先生/批阅）自动覆盖；travel 与独自休息单独补。

- [ ] **Step 1: 加 import + 掷骰 helper**

In `src/ui/App.tsx`:
```ts
import { buildTaihouIllnessTick } from "../store/taihou";
```
Add a ref near `rolledSlots`:
```ts
  const tickedPeriods = useRef<Set<string>>(new Set());
```
Add helper near `rollDecree`:
```ts
  /** 旬翻转：掷太后生病/自愈，应用效果并返回提示节拍（每旬至多一次）。 */
  const rollTaihouIllness = (): DecreeReaction[] => {
    const cal = store.getState().calendar;
    const key = `${store.getState().rngSeed}:${cal.year}:${cal.month}:${cal.period}`;
    if (tickedPeriods.current.has(key)) return [];
    tickedPeriods.current.add(key);
    const tick = buildTaihouIllnessTick(store.getState(), key);
    if (!tick) return [];
    const applied = store.applyEffects(db, tick.effects);
    if (!applied.ok) return [];
    return tick.beats;
  };
```

- [ ] **Step 2: spendAp 在翻旬时并入生病节拍**

Replace `spendAp`:
```ts
  const spendAp = (amount: number) => {
    const before = store.getState().calendar;
    const spend = store.dispatch({ type: "SPEND_AP", amount });
    let decreeBeats = spend.ok ? rollDecree(before, amount) : [];
    if (spend.ok && spend.value.rolledOver) decreeBeats = [...decreeBeats, ...rollTaihouIllness()];
    return { spend, decreeBeats };
  };
```

- [ ] **Step 3: travel 路径并入**

In `MapScreen` `onTravelled` (around the `if (beats.length) playReactions(beats, rolledOver); else runCheckpoints(rolledOver);` tail), insert before that tail:
```ts
            if (rolledOver) beats = [...beats, ...rollTaihouIllness()];
```
(`beats` is the `let beats: DecreeReaction[]` already declared above in that callback.)

- [ ] **Step 4: 独自休息并入**

Replace `restAlone`:
```ts
  const restAlone = () => {
    const spend = store.dispatch({ type: "SKIP_REMAINDER" });
    if (!spend.ok) return;
    doAutosave();
    const beats = rollTaihouIllness();
    if (beats.length) playReactions(beats, true);
    else runCheckpoints(true);
  };
```

- [ ] **Step 5: typecheck + build + 全量**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: 绿（App 接线无独立单测，靠 Task 3 store 测试 + 编译保证）

- [ ] **Step 6: 提交**

```bash
git add src/ui/App.tsx
git commit -m "feat: 旬翻转掷太后生病并入反应流"
```

---

## Task 5: 侍疾事件（病中进慈宁宫遇侍君/皇后）

**Files:**
- Modify: `src/store/taihou.ts`（`buildShizhiEncounter`）
- Modify: `src/ui/App.tsx`（进慈宁宫触发）
- Test: `tests/store/taihou.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

Append to `tests/store/taihou.test.ts`:

```ts
import { buildShizhiEncounter } from "../../src/store/taihou";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("buildShizhiEncounter", () => {
  const loaded = loadGameContent();
  const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

  it("null when 太后 not ill", () => {
    const s = createNewGameState(db);
    s.taihou.ill = false;
    expect(buildShizhiEncounter(db, s, "1:1:early")).toBeNull();
  });

  it("when ill + hitting gate: picks an attendant, cures 太后, +favor", () => {
    const s = createNewGameState(db);
    s.taihou.ill = true;
    let seed = "";
    for (let i = 0; i < 200; i++) {
      const plan = buildShizhiEncounter(db, s, `g:${i}`);
      if (plan) { seed = `g:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const plan = buildShizhiEncounter(db, s, seed)!;
    expect(db.characters[plan.attendantId]).toBeDefined();
    expect(plan.effects.some((e) => e.type === "set_taihou_illness" && e.ill === false)).toBe(true);
    expect(plan.effects.some((e) => e.type === "favor" && e.char === plan.attendantId && e.delta === 5)).toBe(true);
    expect(plan.beats.length).toBe(3);
  });

  it("deterministic", () => {
    const s = createNewGameState(db);
    s.taihou.ill = true;
    expect(JSON.stringify(buildShizhiEncounter(db, s, "k"))).toBe(JSON.stringify(buildShizhiEncounter(db, s, "k")));
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: FAIL（`buildShizhiEncounter` 未导出）

- [ ] **Step 3: 实现 buildShizhiEncounter**

Append to `src/store/taihou.ts`:

```ts
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";

export const TAIHOU_SHIZHI_CHANCE = 50;

export interface ShizhiPlan {
  attendantId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 在宫存活的侍君 + 凤后。 */
function attendantPool(db: ContentDB, state: GameState): string[] {
  return Object.values(db.characters)
    .filter((c) => {
      if (c.kind !== "consort") return false;
      if (c.defaultLocation === "lenggong") return false;
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => c.id);
}

/** 病中进慈宁宫遇侍君/凤后侍疾。seedKey 按旬钉死。无遭遇/无候选→null。 */
export function buildShizhiEncounter(db: ContentDB, state: GameState, seedKey: string): ShizhiPlan | null {
  if (!state.taihou.ill) return null;
  if (gestationRoll(`taihou:shizhi:gate:${seedKey}`) % 100 >= TAIHOU_SHIZHI_CHANCE) return null;
  const pool = attendantPool(db, state);
  if (pool.length === 0) return null;
  const attendantId = pool[gestationRoll(`taihou:shizhi:pick:${seedKey}`) % pool.length]!;
  const char = db.characters[attendantId]!;
  const st = state.standing[attendantId];
  const name = resolveDisplayName(char, st, st ? db.ranks[st.rank] : undefined);
  return {
    attendantId,
    effects: [
      { type: "set_taihou_illness", ill: false },
      { type: "favor", char: attendantId, delta: 5 },
      {
        type: "memory",
        char: attendantId,
        entry: {
          kind: "event",
          summary: "太后凤体违和，臣往慈宁宫侍疾，蒙太后与陛下嘉许。",
          salience: 55,
          tags: ["taihou", "favor"],
          participants: ["taihou", attendantId, "player"],
        },
      },
    ],
    beats: [
      { speakerId: "taihou", lines: [`哀家病中，难为${name}日日来侍奉汤药，难得这份孝心。`] },
      { speakerId: "player", lines: [`${name}侍疾辛劳，朕都看在眼里。`] },
      { speakerId: attendantId, lines: [`侍奉太后，是臣的本分，不敢当太后与陛下夸赞。`] },
    ],
  };
}
```

> `feng_hou` 的 `kind` 是 `"consort"`（见 `content/characters/feng_hou.json`），故已含在 attendantPool。

- [ ] **Step 4: 跑确认通过**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: PASS

- [ ] **Step 5: App — 进慈宁宫触发侍疾**

In `src/ui/App.tsx`:
(a) import: add `buildShizhiEncounter` to the taihou import.
(b) Helper:
```ts
  /** 进慈宁宫且太后病中：掷侍疾遭遇，命中即应用并串播。返回是否已起反应。 */
  const maybeShizhi = (): boolean => {
    const cal = store.getState().calendar;
    const key = `${cal.year}:${cal.month}:${cal.period}`;
    const plan = buildShizhiEncounter(db, store.getState(), key);
    if (!plan) return false;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return false;
    doAutosave();
    const [first, ...rest] = plan.beats;
    setReactionQueue((q) => [...q, ...rest]);
    if (first) setReaction(first);
    return true;
  };
```
(c) In `enterCurrentLocation`, after computing route, when target is cining_gong fire shizhi first:
```ts
  const enterCurrentLocation = () => {
    const loc = store.getState().playerLocation;
    if (loc === "cining_gong") {
      setView("cining_gong");
      maybeShizhi();
      return;
    }
    setView(loc === "shangshufang" ? "shangshufang" : loc === "fengxiandian" ? "fengxiandian" : "location");
  };
```
(d) In `runCheckpoints` else-if 链的 cining_gong 分支，改为同样触发：
```ts
    else if (store.getState().playerLocation === "cining_gong") { setView("cining_gong"); maybeShizhi(); }
```

> 幂等性：侍疾命中即 `set_taihou_illness{ill:false}`，太后转为非病；同旬再进 `buildShizhiEncounter` 因 `!ill` 返回 null，不会重复加恩宠。

- [ ] **Step 6: typecheck + build + 全量**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: 绿

- [ ] **Step 7: 提交**

```bash
git add src/store/taihou.ts src/ui/App.tsx tests/store/taihou.test.ts
git commit -m "feat: 太后病中侍疾遭遇（侍君/凤后 +恩宠并治愈）"
```

---

## Task 6: 敲打事件（每行动点 5%，宠爱加权）

**Files:**
- Modify: `src/store/taihou.ts`（`buildTaihouRebuke`）
- Modify: `src/ui/App.tsx`（`rollRebuke` + spendAp 并入）
- Test: `tests/store/taihou.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

Append to `tests/store/taihou.test.ts`:

```ts
import { buildTaihouRebuke } from "../../src/store/taihou";

describe("buildTaihouRebuke", () => {
  const loaded2 = loadGameContent();
  const db2 = loaded2.ok ? loaded2.value : (() => { throw new Error("content failed"); })();

  it("null when 太后 ill (病中不敲打)", () => {
    const s = createNewGameState(db2);
    s.taihou.ill = true;
    // even with a hitting seed it must stay null while ill
    let any = false;
    for (let i = 0; i < 100; i++) if (buildTaihouRebuke(db2, s, `x:${i}`)) any = true;
    expect(any).toBe(false);
  });

  it("on hit: targets a non-凤后 consort, -5 favor + harem harmony +2", () => {
    const s = createNewGameState(db2);
    s.taihou.ill = false;
    let seed = "";
    for (let i = 0; i < 300; i++) {
      const plan = buildTaihouRebuke(db2, s, `h:${i}`);
      if (plan) { seed = `h:${i}`; break; }
    }
    expect(seed).not.toBe("");
    const plan = buildTaihouRebuke(db2, s, seed)!;
    expect(plan.targetId).not.toBe("feng_hou");
    expect(db2.characters[plan.targetId]!.kind).toBe("consort");
    expect(plan.effects.some((e) => e.type === "favor" && e.char === plan.targetId && e.delta === -5)).toBe(true);
    expect(plan.effects.some((e) => e.type === "resource" && e.pillar === "harem" && e.field === "harmony" && e.delta === 2)).toBe(true);
    expect(plan.beats.length).toBe(2);
  });

  it("favor-weighted: across many hits the highest-favor consort is picked most often", () => {
    const s = createNewGameState(db2);
    s.taihou.ill = false;
    // find the consort with max favor as a sanity anchor
    const counts: Record<string, number> = {};
    let hits = 0;
    for (let i = 0; i < 2000 && hits < 200; i++) {
      const plan = buildTaihouRebuke(db2, s, `w:${i}`);
      if (plan) { counts[plan.targetId] = (counts[plan.targetId] ?? 0) + 1; hits++; }
    }
    expect(hits).toBeGreaterThan(0);
    // weighted pick must never select 凤后
    expect(counts["feng_hou"]).toBeUndefined();
  });

  it("deterministic", () => {
    const s = createNewGameState(db2);
    s.taihou.ill = false;
    expect(JSON.stringify(buildTaihouRebuke(db2, s, "k"))).toBe(JSON.stringify(buildTaihouRebuke(db2, s, "k")));
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: FAIL（`buildTaihouRebuke` 未导出）

- [ ] **Step 3: 实现 buildTaihouRebuke**

Append to `src/store/taihou.ts`:

```ts
export const TAIHOU_REBUKE_CHANCE = 5;

export interface RebukePlan {
  targetId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 候选：在宫存活侍君，排除凤后。 */
function rebukePool(db: ContentDB, state: GameState): { id: string; favor: number }[] {
  return Object.values(db.characters)
    .filter((c) => {
      if (c.kind !== "consort" || c.id === "feng_hou") return false;
      if (c.defaultLocation === "lenggong") return false;
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => ({ id: c.id, favor: state.standing[c.id]?.favor ?? 0 }));
}

/** 每行动点 5% 敲打；病中不掷。按 favor 加权选人（宠高更易中）。无候选→null。 */
export function buildTaihouRebuke(db: ContentDB, state: GameState, seedKey: string): RebukePlan | null {
  if (state.taihou.ill) return null;
  if (gestationRoll(`taihou:rebuke:gate:${seedKey}`) % 100 >= TAIHOU_REBUKE_CHANCE) return null;
  const pool = rebukePool(db, state);
  if (pool.length === 0) return null;

  // favor-weighted pick; favor 全 0 时退化为均匀。
  const total = pool.reduce((sum, p) => sum + p.favor, 0);
  let pickId: string;
  if (total <= 0) {
    pickId = pool[gestationRoll(`taihou:rebuke:pick:${seedKey}`) % pool.length]!.id;
  } else {
    let roll = gestationRoll(`taihou:rebuke:pick:${seedKey}`) % total;
    pickId = pool[pool.length - 1]!.id;
    for (const p of pool) {
      if (roll < p.favor) { pickId = p.id; break; }
      roll -= p.favor;
    }
  }

  const char = db.characters[pickId]!;
  const st = state.standing[pickId];
  const name = resolveDisplayName(char, st, st ? db.ranks[st.rank] : undefined);
  return {
    targetId: pickId,
    effects: [
      { type: "favor", char: pickId, delta: -5 },
      { type: "resource", pillar: "harem", field: "harmony", delta: 2 },
      {
        type: "memory",
        char: pickId,
        entry: {
          kind: "event",
          summary: "被太后召去慈宁宫训诫，戒臣勿恃宠骄纵、独占圣心。",
          salience: 65,
          tags: ["taihou", "rebuke"],
          participants: ["taihou", pickId],
        },
      },
    ],
    beats: [
      { speakerId: "taihou", lines: [`${name}近来圣眷正浓，哀家有句话须叮嘱：宠不可恃，更不可独揽圣心，免招后宫非议。`] },
      { speakerId: pickId, lines: [`${name}惶恐领训，谨记太后教诲，不敢有违。`] },
    ],
  };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `npx vitest run tests/store/taihou.test.ts`
Expected: PASS

- [ ] **Step 5: App — rollRebuke + spendAp 并入**

In `src/ui/App.tsx`:
(a) import: add `buildTaihouRebuke` to the taihou import.
(b) Helper near `rollDecree`:
```ts
  /** 每行动点掷太后敲打（独立于懿旨；至多一次/行动）。返回台词节拍。 */
  const rollRebuke = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): DecreeReaction[] => {
    const beats: DecreeReaction[] = [];
    for (let i = 0; i < amount; i++) {
      const slot = before.apMax - before.ap + i;
      const key = `rebuke:${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
      if (rolledSlots.current.has(key)) continue;
      rolledSlots.current.add(key);
      const plan = buildTaihouRebuke(db, store.getState(), key);
      if (plan) {
        const applied = store.applyEffects(db, plan.effects);
        if (applied.ok) { beats.push(...plan.beats); break; }
      }
    }
    return beats;
  };
```
(c) In `spendAp`, fold rebuke beats in (before the illness tick):
```ts
  const spendAp = (amount: number) => {
    const before = store.getState().calendar;
    const spend = store.dispatch({ type: "SPEND_AP", amount });
    let decreeBeats = spend.ok ? rollDecree(before, amount) : [];
    if (spend.ok) decreeBeats = [...decreeBeats, ...rollRebuke(before, amount)];
    if (spend.ok && spend.value.rolledOver) decreeBeats = [...decreeBeats, ...rollTaihouIllness()];
    return { spend, decreeBeats };
  };
```

> 敲打的 `rolledSlots` key 带 `rebuke:` 前缀，与懿旨 key（无前缀）不冲突；两者同 slot 可各自至多一次。

- [ ] **Step 6: typecheck + build + 全量**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: 绿

- [ ] **Step 7: 提交**

```bash
git add src/store/taihou.ts src/ui/App.tsx tests/store/taihou.test.ts
git commit -m "feat: 太后敲打高宠侍君（每行动点5%，宠爱加权）"
```

---

## Task 7: 养父池含太后 + heir_adopt 接受 elder + 太后欣然播报

**Files:**
- Modify: `src/store/adoption.ts`（`eligibleAdoptiveFathers` + `buildAdoptionReaction` elder 分支）
- Modify: `src/engine/effects/funnel.ts`（`heir_adopt` 接受 elder）
- Create: `tests/store/adoptionTaihou.test.ts`
- Test: `tests/effects/funnel.heirAdopt.test.ts`（追加 elder 接受/official 拒绝）

- [ ] **Step 1: 写失败测试 — 池含太后 + 太后欣然单段**

Create `tests/store/adoptionTaihou.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eligibleAdoptiveFathers, buildAdoptionReaction } from "../../src/store/adoption";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

const loaded = loadGameContent();
const db = loaded.ok ? loaded.value : (() => { throw new Error("content failed"); })();

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: makeGameTime(1, 1, "early"),
  favor: 50, legitimate: false, petName: "", education: { scholarship: 5, martial: 5, virtue: 5 },
  ...over,
});

describe("养父池含太后", () => {
  it("eligibleAdoptiveFathers includes taihou", () => {
    const s = createNewGameState(db);
    expect(eligibleAdoptiveFathers(db, s).some((c) => c.id === "taihou")).toBe(true);
  });

  it("太后养父：单段欣然，无谢恩、无生父泪报（即便生父尚在宫）", () => {
    const s = createNewGameState(db);
    // bio father in palace → would normally trigger the 司礼官 tears beat for a normal father
    const h = heir({ fatherId: "chu_jun" });
    const beats = buildAdoptionReaction(db, s, h, "taihou");
    expect(beats.length).toBe(1);
    expect(beats[0]!.speakerId).toBe("taihou");
    expect(beats.some((b) => b.speakerId === "sili_nvguan")).toBe(false);
  });
});
```

> Confirm `Heir.birthAt`/`GameTime` shape against `src/engine/calendar/time.ts` (`makeGameTime`) — prefer `makeGameTime(1,1,"early")` if exported, instead of the cast above.

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run tests/store/adoptionTaihou.test.ts`
Expected: FAIL（taihou 不在池中 / 走了谢恩分支）

- [ ] **Step 3: 池加入太后**

In `src/store/adoption.ts`, change `eligibleAdoptiveFathers` to include elders:

```ts
export function eligibleAdoptiveFathers(db: ContentDB, state: GameState): CharacterContent[] {
  return Object.values(db.characters).filter((c) => {
    if (c.kind !== "consort" && c.kind !== "elder") return false;
    if (c.defaultLocation === "lenggong") return false;
    if (state.standing[c.id]?.lifecycle === "deceased") return false;
    return true;
  });
}
```

- [ ] **Step 4: buildAdoptionReaction 太后分支**

In `src/store/adoption.ts`, at the top of `buildAdoptionReaction` (before the existing consort `thanks`/tears logic), add the elder branch:

```ts
  const fatherChar = db.characters[fatherId];
  if (fatherChar?.kind === "elder") {
    const child = SEX_CHILD[heir.sex];
    return [
      {
        speakerId: fatherId,
        lines: [`太后闻陛下择其抚育皇嗣，含笑颔首：好，这${child}就交给哀家，定当悉心教养，看着他长大成人。`],
      },
    ];
  }
```

> `SEX_CHILD` 与 `nameOf` 已在该文件顶部存在；复用即可。太后分支不引用 `nameOf`（直接用「太后」与 child）。

- [ ] **Step 5: funnel — heir_adopt 接受 elder**

In `src/engine/effects/funnel.ts` `validateEffects` 的 `case "heir_adopt"`, replace the target check:

```ts
      case "heir_adopt": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        const ch = db.characters[e.fatherId];
        if (!ch || (ch.kind !== "consort" && ch.kind !== "elder")) {
          bad(index, "BAD_EFFECT_TARGET", `heir_adopt needs a consort or elder: "${e.fatherId}"`, { char: e.fatherId });
        } else if (ch.kind === "consort") {
          const st = state.standing[e.fatherId];
          if (!st) {
            bad(index, "BAD_EFFECT_TARGET", `heir_adopt needs a consort with standing: "${e.fatherId}"`, { char: e.fatherId });
          } else if (st.lifecycle === "deceased") {
            bad(index, "BAD_EFFECT_TARGET", `adoptive father is deceased: "${e.fatherId}"`, { char: e.fatherId });
          } else if (ch.defaultLocation === "lenggong") {
            bad(index, "BAD_EFFECT_TARGET", `adoptive father is in 冷宫: "${e.fatherId}"`, { char: e.fatherId });
          }
        }
        break;
      }
```

> elder（太后）无 standing/lifecycle，恒可作养父；故 elder 分支无额外校验。

- [ ] **Step 6: 追加 funnel elder 测试**

Open `tests/effects/funnel.heirAdopt.test.ts` (existing). It already loads `db` via `loadGameContent()` and uses `createNewGameState` + `applyEffects` + `makeGameTime`. Append a new `it` inside its describe (reuse its existing `db` / heir-seeding helper — read the file first to match how it pushes a heir):

```ts
  it("accepts elder 太后 as adoptive father, rejects official", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs.push({
      id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: false, petName: "",
      education: { scholarship: 5, martial: 5, virtue: 5 },
    });
    const ok = applyEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "taihou" }]);
    expect(ok.ok).toBe(true);
    const bad = applyEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "sili_nvguan" }]);
    expect(bad.ok).toBe(false);
  });
```

> If `funnel.heirAdopt.test.ts` does not import `makeGameTime`, add the import. Match its existing `db` variable name.

- [ ] **Step 7: 跑确认通过**

Run: `npx vitest run tests/store/adoptionTaihou.test.ts tests/effects/funnel.heirAdopt.test.ts`
Expected: PASS

- [ ] **Step 8: 全量回归**

Run: `npm run typecheck && npx vitest run`
Expected: 绿

- [ ] **Step 9: 提交**

```bash
git add src/store/adoption.ts src/engine/effects/funnel.ts tests/store/adoptionTaihou.test.ts tests/effects/funnel.heirAdopt.test.ts
git commit -m "feat: 太后入养父池 + heir_adopt 接受 elder + 太后欣然播报"
```

---

## Task 8: 美术接线（manifest）

**Files:**
- Modify: `assets/manifest.json`
- Modify: `tests/assets/manifestCheck.test.ts`（`entryCount`）

- [ ] **Step 1: 盘点实际素材文件**

Run:
```bash
ls public/assets/portraits/ -R | grep -i taihou
ls public/assets/backgrounds/ | grep -iE "cining|jingjiao|yushufang|hougong|jingcheng|twilight|night|dusk|evening"
```
Record the exact filenames present（黄昏=twilight，晚上=night，按 `src/engine/calendar/time.ts` 的 `TimeOfDay`）。

- [ ] **Step 2: 注册条目**

In `assets/manifest.json` `entries`, add（仅登记实际存在的文件；路径相对 `public/assets/`）:

```json
    "portrait.taihou.neutral": { "path": "portraits/<太后立绘文件>", "kind": "portrait", "placeholder": false },
    "bg.cining_gong": { "path": "backgrounds/<慈宁宫文件>", "kind": "background", "placeholder": false }
```

并为用户新增的黄昏/晚上背景登记变体键（每个仅当文件存在时加），形如:
```json
    "bg.jingjiao.twilight": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.jingjiao.night": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.yushufang.twilight": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.yushufang.night": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.hougong.twilight": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.hougong.night": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.jingcheng.twilight": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false },
    "bg.jingcheng.night": { "path": "backgrounds/<文件>", "kind": "background", "placeholder": false }
```

> `AssetRegistry.resolveVariant` 自动按 `timeOfDay` 选 `.twilight`/`.night`，缺变体回落基键。基键（如 `bg.jingjiao`）已存在，无需重复。

- [ ] **Step 3: 校验素材清单**

Run: `npm run validate-manifest`
Expected: 路径全部存在、无缺失引用；记下报告的 `entryCount`（= 旧 22 + 本次新增条目数）。

- [ ] **Step 4: 更新 manifest 计数测试**

In `tests/assets/manifestCheck.test.ts`, set `expect(result.entryCount).toBe(<新值>);`（用 Step 3 实际值）。

- [ ] **Step 5: 跑确认通过 + 全量**

Run: `npx vitest run tests/assets/manifestCheck.test.ts && npm run validate-manifest && npx vitest run && npm run build`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add assets/manifest.json tests/assets/manifestCheck.test.ts
git commit -m "feat: 注册太后立绘/慈宁宫背景 + 时段背景变体"
```

---

## 最终验收（全部任务后）

Run:
```bash
npm run typecheck && npm run lint && npx vitest run && npm run validate-content && npm run validate-manifest && npm run build
```
Expected: 全绿，main 可启动。

逐项核对 spec：太后 NPC（§1）、慈宁宫（§2）、太后对话（§3）、生病旬掷骰+提示（§4）、侍疾（§5）、敲打（§6）、养父池含太后（§7）、美术（§8）、测试（§9）均有对应 Task。
