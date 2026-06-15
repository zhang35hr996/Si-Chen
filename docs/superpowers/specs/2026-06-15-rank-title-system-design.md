# 位分升降 + 封号 System — Design Spec

Date: 2026-06-15 · Status: approved (pending written review)
Canonical lore reference: [`docs/background-v1.0.md`](../../background-v1.0.md) §9.

## Goal

Let the player promote/demote a consort's 位分 and grant/strip a 封号, with the
consort reacting in-character (谢恩 / 请罪 / 惶恐谢罪). A titled consort is
addressed as **封号 + 位分** instead of **姓氏 + 位分**, and ranks slightly above
an untitled same-rank peer. 凤后 (正宫) is the cap and is never adjustable.

## 1. Data model

### 1.1 Full §9.2 rank ladder (content)

Add the full canonical consort ladder to `content/world.json` `ranks[]` **and**
`content/lexicon.json` `rankAddressRules[]` (the loader enforces selfRefs parity).
All are `domain: "harem"`, `favorTerm: "恩宠"`. `order` descends by rank; same-品
multi-name tiers get distinct, closely-spaced orders (承徽 > 承仪 > 承德). selfRefs
follow background §9.3.

| id | name | grade | order | toPlayer | formal | informal |
|---|---|---|---|---|---|---|
| fenghou | 凤后 | 正宫 | 1000 | 臣后 | 本宫 | — | *(cap, existing, not a target)* |
| huangguijun | 皇贵君 | 超品 | 180 | 臣 | 本宫 | — |
| guijun | 贵君 | 正一品 | 170 | 臣,臣侍 | 本宫 | — |
| jun | 君 | 从一品 | 160 | 臣侍 | 本宫 | — | *(existing)* |
| guifu | 贵驸 | 正二品 | 150 | 臣侍 | 本宫 | — |
| fu | 驸 | 从二品 | 140 | 臣侍 | 本宫 | — |
| chenghui | 承徽 | 正三品 | 134 | 侍,侍身 | 本宫 | 我 | *(existing)* |
| chengyi | 承仪 | 正三品 | 132 | 侍,侍身 | 本宫 | 我 |
| chengde | 承德 | 正三品 | 130 | 侍,侍身 | 本宫 | 我 |
| zhaohui | 昭徽 | 从三品 | 124 | 侍,侍身 | 本宫 | 我 |
| zhaoyi | 昭仪 | 从三品 | 122 | 侍,侍身 | 本宫 | 我 |
| zhaorong | 昭容 | 从三品 | 120 | 侍,侍身 | 本宫 | 我 |
| shichen | 侍宸 | 正四品 | 110 | 侍,侍身 | 本宫 | 我 |
| guiren | 贵人 | 从四品 | 100 | 侍,侍身 | 本侍,我 | — |
| meiren | 美人 | 正五品 | 90 | 侍,侍身 | 本侍,我 | — |
| cairen | 才人 | 从五品 | 80 | 侍,侍身 | 本侍,我 | — |
| changzai | 常在 | 六品 | 70 | 小侍 | 我 | — |
| daying | 答应 | 七品 | 60 | 小侍 | 我 | — |
| gengyi | 更衣 | 八品 | 50 | 小侍 | 我 | — |
| guannanzi | 官男子 | 九品 | 40 | 小侍 | 我 | — |

Existing ranks' `order` values are **reassigned** to this scheme (fenghou 1000,
jun 160, chenghui 134); nothing in code/content compares ranks by absolute order
today, so this is safe. Existing `sili_zhang` (official, 司礼) is unchanged.

### 1.2 Character surname (content)

Add optional `profile.surname` (姓) to the character schema. Set:
- 沈承徽 → `沈`, 初君 → `初`, 温雅 → `温`.
- 凤后 and officials: no surname.

### 1.3 Runtime title (state + save)

Extend `CharacterStanding` with optional `title?: string` (封号). It lives in
`GameState.standing[charId]`, persists with the save. Old saves (no `title`) load
unchanged — `title` is simply absent.

## 2. Display name (称呼)

New pure engine helper `resolveDisplayName(character, standing, rank): string`:
- consort **with** `profile.surname` → `(standing.title ?? surname) + rank.name`
- otherwise → `character.profile.name` (covers 凤后, officials)

Examples: 沈承徽 · promote→沈君 · 封号「婉」→婉承徽 · 褫夺→沈承徽.

Consumers (all switch from `profile.name`): `CharacterCard`, the 御书房 后宫名册
roster, the `DialogueScreen` speaker label, and the `DialogueProvider` request's
`speakerName` (thread the speaker's `standing`/`rank` into the request builder).

## 3. Effects (the single funnel)

Three new `EventEffect` variants (Zod schema + funnel + reducer). Being effects,
they are also author-usable inside event scenes ("事件中"):

- `{ "type": "set_rank", "char": id, "rank": id }`
- `{ "type": "set_title", "char": id, "title": string }`
- `{ "type": "remove_title", "char": id }`

Funnel guards (whole batch rejected on any violation, per existing semantics):
- `char` must be a consort with an existing standing.
- `set_rank.rank` must be an existing `domain: "harem"` rank and **≠ fenghou**.
- `set_title.title`: 1–4 漢字, must pass the forbidden-lexicon gate (no 女帝/女官…).
- `remove_title`: no-op-safe; clears `title` if present.

These mutate `standing[char].rank` / `.title` only. Numeric clamps don't apply.

## 4. Player flow

### 4.1 Surfaces
- **Palace card:** a consort's `CharacterCard`, when she is present, gains a
  「管理」button — **hidden for 凤后**. Opens `RankAdminModal(charId)`.
- **御书房 roster:** `LocationScreen` for `yushufang` gains a 「后宫名册」section
  listing every consort (display 称呼 + 位分 + 封号), each row → 管理 → same modal.

### 4.2 `RankAdminModal`
One modal, three independent ops (each its own confirm + reaction):
- **位分 picker:** the harem ladder (≠ fenghou), sorted by `order` desc, current
  marked. Confirm:
  - target == current → nothing happens (no reaction).
  - `effectiveOrder(target) > effectiveOrder(current)` → **promote**.
  - else → **demote**.
- **封号:** free-text input (1–4 漢字, gated) → **grant_title** (or 改封 if already
  titled). 褫夺封号 button (disabled when untitled) → **strip_title**.

Confirming an op dispatches a single atomic effect batch through the funnel
(**0 AP**): the rank/title effect **plus** an auto-memory effect, then launches
the reaction. The modal closes after the reaction.

### 4.3 Reaction (shared, branching)

Reaction text is **content-authored** in `world.json` under a new
`rankChangeReactions` object, keyed by op kind, each `{ lines: string[], memory: string }`:

```jsonc
"rankChangeReactions": {
  "promote":     { "lines": ["谢陛下隆恩！{self}定当尽心侍奉，不负圣眷。"], "memory": "陛下晋我为{rank}，圣眷正隆。" },
  "demote":      { "lines": ["……{self}知罪。谢陛下教诲。"],             "memory": "陛下贬我为{rank}，颜面无存。" },
  "grant_title": { "lines": ["蒙陛下赐号，{self}惶恐领赏——谢陛下隆恩！"], "memory": "陛下赐我封号「{title}」，恩宠加身。" },
  "strip_title": { "lines": ["陛下息怒……{self}知罪，惶恐请罪，恳请陛下开恩。"], "memory": "陛下褫夺我封号，我惶惶不可终日。" }
}
```

Placeholders in **lines**: `{self}` → the consort's `selfRefs.toPlayer[0]` (her
**new** rank's ref). In **memory** (her own POV): first-person 我. Both: `{rank}` →
new rank name, `{title}` → granted 封号. Lines are played as
`DialogueLine`s through the existing `DialogueProvider` (MockProvider echo) on a
small `ReactionScreen` (consort as speaker, her **new** 称呼), dismissed with
继续 → return to the prior screen. The reaction text passes all gates because
`{self}` is the speaker's own selfRef.

## 5. 封号 precedence

`effectiveOrder(rank, hasTitle) = rank.order + (hasTitle ? TITLE_BOOST : 0)`,
with `TITLE_BOOST = 1` (smaller than the 2-step gap between adjacent same-品
tiers, so a titled consort sits just above untitled same-rank peers without
leapfrogging the next tier). Used wherever consorts are ordered for
display/precedence (e.g. the 御书房 roster sort).

## 6. Validation, gates, saves, tests

- Loader continues to enforce `lexicon` ↔ `world.json` rank parity for the new ladder.
- 封号 input + reaction lines run the existing text gates.
- `standing.title` optional → backward-compatible saves.

**Tests**
- Funnel unit tests: `set_rank` / `set_title` / `remove_title` happy paths + guards
  (non-consort, fenghou target, bad title, missing standing).
- `resolveDisplayName` unit tests: surname compose, title override, 凤后/official fallback.
- Gate test: each reaction template (rendered) passes for its consort.
- Content: full ladder validates; lexicon parity holds.
- e2e: in 御书房, promote a consort → reaction 谢恩 shown → card 称呼 + 位分 updated.

## 7. Out of scope (YAGNI)

- 封后 (promoting anyone to 凤后/皇后).
- 封号 presets, multi-char 封号 lore validation beyond length + gate.
- AP cost / cooldown / per-day limits on rank ops.
- Faction/relationship ripple effects of promotions beyond the auto-memory.
- LLM-generated reactions (MockProvider echo only, same as the rest of the slice).

## 8. Edge cases

- Promote cap = 皇贵君 (皇后 excluded); demote floor = 官男子.
- 加封 when already titled = 改封 (replace).
- 褫夺 when untitled → button disabled.
- Same-rank "promote" selection → no change, no reaction.
- Demoting a titled consort keeps the 封号 (称呼 stays 封号+新位分) unless separately 褫夺.
