# Current Implementation Contract

**This is the authoritative statement of what the engine supports today.** Other
docs may describe designed-ahead or future systems; when they conflict with this
file, this file wins. The ultimate source is the Zod schemas in
[`src/engine/content/schemas.ts`](../../src/engine/content/schemas.ts) — content
is **strict** (unknown keys fail validation), so a field absent here cannot be used.

Last updated: 2026-06-19. Save format version: **4**.

## Capability table

| Area | Implemented | Designed later | Not supported |
|---|---|---|---|
| **Scene nodes** | `line`, `choice`, `branch`, `effect` | `generate` (LLM node) | arbitrary scripts |
| **Conditions** | `all`, `any`, `not`, `flagSet`, `eventFired`, `favorAtLeast`, `rankAtLeast`, `hasMemoryTag`, `periodIs`, `monthAtLeast`, `atLocation` | richer memory queries (count/recency) | `secretRevealed`, resource/bloodline predicates (scaffold guard) |
| **Effects** | `favor`, `resource` (court/harem/bloodline), `set_bloodline_status`, `flag`, `memory`, `relocate`, `set_rank`, `set_title`, `remove_title`, the `heir_*`/`pregnancy*` lifecycle set, and the `set_*_health`/`*_decease` domain effects (representative — see `src/engine/content/schemas.ts` for the full set) | — | direct calendar/location mutation from scenes |
| **Characters** | `consort`, `official`, `elder` (太后: no 位分, no attributes, no standing) | wider roles | nested schedules, secrets gameplay (`secrets` must be empty) |
| **Map** | data-driven `mapBoards` + `mapPortals`; `travel` nodes (cost AP, relocate) and `free` nodes (view only, optional one AP action) | per-area sub-graphs, time-gated portals | adjacency-restricted travel (it's fast-travel) |
| **Calendar** | year / month / 上中下旬 period; `apMax` (6) action points; 时辰 time-of-day buckets driving background variants | seasonal events | sub-旬 scheduling |
| **Memory** | append-only `MemoryEntry` (strength/retention/triggerTags/subjectIds/emotions, no `salience`/`protected`); objective `chronicle` + awareness; emotional conditions with decay; recall → decay → activation → rerank retrieval; `hasMemoryTag` (queries `triggerTags`) | consolidation / indexing / interaction-memory writeback | EventAwareness / rumor / incorrect beliefs |
| **AI dialogue** | real providers (Anthropic/OpenAI/Gemini) + mock + eval harness; structured-claim gates; reaction planner; mention cooldown (incl. `mentionedContextRefs`) | richer reaction coverage; free-chat `topicTags` | unrestricted state mutation by the model |
| **Save** | checksum, content-hash warning, missing-ref quarantine, autosave on scene-commit & travel; versioned format (v4) with laddered `MIGRATIONS[]` | — | automatic ID aliasing |
| **Resources** | court (authority/publicSupport/factionPressure), harem (harmony/jealousy), bloodline (legitimacy/menstrualStatus) — written by effects; read-only 国情面板 UI | faction simulation | resource-based event conditions (deliberately none) |
| **Heirs** | full lifecycle: gestation → birth → 小名 → 百日宴正名 → 开蒙 → 文昭殿教育 → 奉先殿择养父; `Heir` state with petName/givenName/education/custodianId; 4 heir effects (see below) | grown-up / succession events | LLM-driven heir dialogue |
| **Location flags** | `actionFirstSlotOnly: boolean` — action disabled after first AP of the day, with hint text | — | — |
| **Empress decree** | 凤后 auto-adjusts 贵人及以下 consort ranks per consumed AP (3% chance, seeded deterministic); `buildEmpressDecree` in `src/store/empressDecree.ts` | — | — |
| **太后 (Empress Dowager)** | `elder` NPC at 慈宁宫; illness rolled per 旬 (5%+1%/yr, cap 25%; 50%/旬 self-heal); 侍疾 encounter (50%/旬 while ill → +恩宠, heals); 敲打 per-AP (5%, favor-weighted); selectable adoptive father. All in `src/store/taihou.ts`, seeded-deterministic | — | — |

## Hard rules content must obey

- **Strict JSON.** No comments, no trailing commas, no unknown keys.
- **Stable IDs.** lowercase `snake_case`; see
  [`../content-authoring/70-id-naming-and-versioning.md`](../content-authoring/70-id-naming-and-versioning.md).
- **Cross-references must resolve.** Every `char`/`location`/`scene`/`rank`/`event`
  id referenced must exist, or the loader errors (it collects *all* errors per run).
- **Content matches *this* file, not future design docs.** If a system is marked
  "Designed later" / "Not supported", do not author content that assumes it.

## The scaffold guard (why some predicates are missing)

The condition DSL has **no** resource or bloodline predicates by design. Event
logic therefore *structurally cannot* branch on scaffold-only numbers — a
condition referencing one fails schema validation rather than silently reading a
placeholder. Keep it that way until those systems are real.

## Recent additions

- **`hasMemoryTag` condition** — `{ "hasMemoryTag": { "char": "<id>", "tag": "<tag>" } }`.
  True when that character holds ≥1 memory entry whose `triggerTags` include the tag. See
  [`../systems/40-relationship-memory.md`](../systems/40-relationship-memory.md) for the full
  retrieval/decay/activation pipeline, structured-claim gating, and mention cooldown.
- **Data-driven map boards** — `world.json` declares `mapBoards` (主图/子图 backdrops)
  and `mapPortals` (出宫 / 后宫 / 郊外 buttons). A location's `zone` names its board.
- **Map is the home screen (皇城主地图).** 新游戏 and every committed event land on
  the root board (`mapBoards[0]`); abandoning a scene mid-way returns to the room
  instead. A location node for the room you are already in re-opens it 免行动点
  (`onEnterCurrent`); other travel nodes fast-travel. The 返回 breadcrumb is seeded
  with the current board's ancestor path (walked back through `mapPortals`), so 返回
  climbs to the 主图 instead of dropping straight back into the room — this is the
  fix for the old "宫城图 → 返回 fell back into the palace" bug.
- **Consort attributes** — characters may carry an optional `attributes` block
  (容貌/才情/家世/健康/承养, each 0–100; background §四.4.1). The character card shows
  位分 + 属性 + relationship stats for 侍君, and 官职 + 圣眷 for 官员; it no longer
  renders 自称 or 品级括注 (player-facing summary only).
- **位分升降 + 封号 system** — three new effects (`set_rank` / `set_title` /
  `remove_title`) flow through the standard effect funnel (`store.applyEffects`,
  0-AP, not routed through events). 称呼 is composed at render time via
  `resolveDisplayName` (封号/姓 + 当前位分); a 封号 also nudges a consort just above
  untitled same-rank peers in ordering via `effectiveOrder`. Player surfaces: the consort's
  palace card 管理 button and the 紫宸殿 后宫名册 roster both open `RankAdminModal`;
  after each op the consort's reaction (谢恩 / 请罪 / 惶恐) is replayed through
  `ReactionScreen` via `DialogueProvider`. 凤后 is the 正宫 cap and is excluded from
  all rank/title ops.
- **Heir lifecycle system** — `bloodline.heirs[]` tracks each born heir with `petName`
  / `givenName` / `education {scholarship,martial,virtue}` / `custodianId`. Four
  effects: `heir_name` (set small or given name), `heir_summon` (+20 favor, bypasses
  ±10 cap), `heir_educate` (attribute + favor delta, both clamped), `heir_adopt`
  (set adoptive father). Growth stages derived at render time from birth date
  (`infant` / `toddler` / `schooling`). Auto-modals: 小名 after birth; 百日宴 when
  ≥3 months old and unnamed (dismissible per-month). New locations: **文昭殿**
  (问功课 / 问先生, enrolled heirs only) and **奉先殿** (择养父), both 1-AP travel
  from 紫宸殿. Save format bumped to **v3** with `2→3` migration.
- **凤后懿旨 (Empress Decree)** — each consumed AP has a 3% seeded-deterministic
  chance to trigger a decree: 凤后 auto-promotes or demotes one eligible consort
  (贵人 order 100 ↔ 官男子 order 40, based on favor ≥65 promote / <35 demote).
  Candidate selection and gate roll use `gestationRoll(seedKey)`. Decree beats are
  appended to `reactionQueue` and played after the action's own reaction. Entry point:
  `buildEmpressDecree(db, state, seedKey)` in `src/store/empressDecree.ts`.
- **AP centralization (`spendAp`)** — all action-point consumption funnels through
  `spendAp(amount)` in App.tsx, which rolls the decree gate for each consumed slot and
  appends any decree beats to `reactionQueue`. The queue is drained by `ReactionScreen`
  and `ChildReactionScreen` `onDone` callbacks.
- **国情面板 (ResourcePanel)** — read-only modal showing all `state.resources` values
  (朝局/后宫/血脉). Triggered by 「国情」 HUD button on `LocationScreen` and `MapScreen`.
- **`actionFirstSlotOnly`** — optional boolean on location schema. When `true`, all
  actions in that location are disabled after the first AP of the day, with hint
  「朝时已过，请明日卯时早朝」. Used by 宣政殿 (`xuanzhengdian`). The 紫禁城 主图 also draws a
  「可上朝」事件标注 on such free nodes while available (`courtAvailable` in `MapScreen`);
  it clears the moment the day's first AP is spent.
- **上朝会话 (Court session)** — entering 宣政殿 and choosing 上朝 opens a *session*, not a
  single scene. Flow lives in `App.tsx`: `startEvent` intercepts `ev_chaohui` → `beginCourt`
  spends **1 AP up front** (the whole session costs exactly one point; 卯时满点扣 1 不转旬),
  then `pickCourtAffairs(db, "court:<rngSeed>:<dayIndex>")` draws **2–3 distinct affairs**
  from a 10-item pool, played **one at a time** through the reused `DialogueScreen`
  (`view:"court"`, keyed by index). Each affair is its own single-matter event/scene
  (`ev_court_*` / `sc_court_*`, `checkpoint:"court"`, `apCost:0`, resource-only effects),
  committed via `resolveEvent` as it completes (autosave each). The HUD shows a **「退朝」**
  button (`quitLabel` prop): pressing it keeps already-resolved affairs, drops the rest, and
  returns straight to the 紫禁城 主图 (the 1 AP is not refunded). The `"court"` checkpoint is
  inert to every auto-checkpoint, so these events never auto-fire — only the session draws them.
  Pure draw logic + tests: `src/engine/court/affairs.ts`, `tests/court/affairs.test.ts`.
- **太后系统 (Empress Dowager)** — new character `kind: "elder"` (`taihou`, no 位分 /
  attributes / standing) living at **慈宁宫** (a 主图 travel node with its own
  `CiningGongScreen`). New state `GameState.taihou.ill` + effect `set_taihou_illness`,
  persisted at save **v4** (migration `3→4` backfills `{ill:false}`). All logic in
  `src/store/taihou.ts`, seeded-deterministic via `gestationRoll`/`gestationRollRaw`:
  - **对话** — fixed scripted scene `ev_taihou_converse` (1 AP). Uses
    `checkpoint:"game_start"` as a manual-trigger marker so it never auto-fires; the
    慈宁宫 button starts it directly. **Do not change to `location_enter`** (would force-pop).
  - **生病** — `buildTaihouIllnessTick` rolls each 旬 rollover: not-ill → fall ill at
    `taihouIllnessChance(year)` (5% + 1%/yr after 元年, cap 25%) with a 司礼官 prompt;
    ill → self-heal at 50%/旬 (silent). Wired into every rollover path (`spendAp`,
    `restAlone`, `onTravelled`, scene-commit) via a per-旬 `tickedPeriods` ref.
  - **侍疾** — `buildShizhiEncounter`: entering 慈宁宫 while ill rolls 50%/旬 (seed pinned
    per 旬, idempotent) to meet a 侍君/凤后 who tends her → +5 恩宠 and heals 太后.
  - **敲打** — `buildTaihouRebuke`: each consumed AP, 5% (skipped while ill) to summon a
    favor-weighted 侍君 (凤后 excluded) for admonishment → −5 恩宠 + 和睦 +2. Rolled in
    `spendAp` alongside the decree via a `rebuke:`-prefixed `rolledSlots` key.
  - **养父** — `eligibleAdoptiveFathers` includes the elder; `heir_adopt` accepts an
    elder father (no standing checks); 太后 gives a single pleased line (no 谢恩, no 生父泪报).
  - Note: `rolledSlots`/`tickedPeriods` refs are cleared on new-game / load
    (`resetRollGuards`) so a prior session's keys never suppress the current game's rolls.
- **宫殿改名 + 后宫扩建 + 毓庆宫** — canonical room renames (id ⇄ filename now aligned):
  御书房→**紫宸殿** (`zichendian`, 起始地/主殿), 朝堂→**宣政殿** (`xuanzhengdian`),
  上书房→**文昭殿** (`wenzhaodian`, 皇嗣开蒙), 冷宫→**长门宫** (`changmengong`). Seven new
  后宫 travel palaces share `bg.hougong_zhudian` and hub off 坤宁宫: 昭宁/承晖/景仁/钟粹/延和/
  霁月/储秀宫 (`zhaoning_gong` … `chuxiu_gong`); 陆怀瑾 now resides at 钟粹宫. New palace
  **毓庆宫** (`yuqing_gong`, behind 文昭殿): 未成年皇嗣居所 — 皇子(女)满 5 / 皇郎(男)满 7 迁入
  (`residesInYuqing`). Its `YuqingGongScreen` lists resident heirs and 召见 them
  (`heir_summon`, 1 AP); the 紫宸殿 子嗣名册 can still summon as well. On the 主图, 文昭殿 and
  毓庆宫 node positions are swapped (文昭殿 now sits at the lower coordinate, 毓庆宫 at the upper).
- **角色定名** — the existing roster's ids/names are finalized and references updated
  engine-wide: 凤后→**沈知白** (`shen_zhibai`), 沈承徽→**陆怀瑾** (`lu_huaijin`),
  初君→**徐清欢** (`xu_qinghuan`), 卫司礼→**卫绥** (`wei_sui`), 温雅 (`wenya`). (The `feng_hou`
  rank id is unchanged; only the character id moved to `shen_zhibai`.)
- **开篇背景** — title screen now renders the `bg.game_start` opening art beneath a dark
  vignette, with 「凤司晨」 centered over it (`TitleScreen` takes the `AssetRegistry`).
- **对话礼数硬规则** — added to [`../narrative/50-dialogue-style-guide.md`](../narrative/50-dialogue-style-guide.md):
  侍君/官员见驾先请安、陛下离去恭送、礼数压过性格、不可僭越、皇权不可侵犯. Lexicon now bans 皇上
  (it was missing); a female emperor's children address her 母皇 (she calls the 太后 母后).
