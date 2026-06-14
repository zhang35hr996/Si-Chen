# Dialogue Style Guide

For both AI generation and manual writing. The hard term rules live in
[`../world/70-taboo-and-lexicon.md`](../world/70-taboo-and-lexicon.md) and
`content/lexicon.json`; this is about tone.

## Register

- **Semi-classical court Chinese.** Restrained, ritualized, period-flavored — not
  museum-stiff, not modern. Aim for the texture of a refined historical drama.
- Men in the 后宫/household speak in 礼法语体 — deferential, graceful — **never** a
  modern romance/"恋爱腔" register.

## Addressing the sovereign

- The 女帝 is **陛下**. Never 皇上.
- Self-reference follows the speaker's rank tier (see
  [`../world/50-harem-ranks.md`](../world/50-harem-ranks.md)): 凤后 → 臣后/本宫;
  贵君级 → 本宫; 驸/承徽/承仪 → 本位; 侍宸及以下 → 臣侍; before a much higher consort → 小侍.
  Officials → 臣/下官.

## Rank affects tone

- Higher rank ⇒ more composed, more entitled to initiate.
- Lower rank ⇒ more deferential, more hedged, more careful.
- A proud character may bristle; a timid one defers; cold ones stay terse. Keep
  voice consistent with the character's `voice.register` and `personalityTraits`.

## Forbidden phrasing

- No modern idiom/slang, no anachronisms, no 现代恋爱腔.
- Don't coin new offices/ranks/lineage terms; if an institution is 未定, describe
  it plainly (a lexicon style rule).
- Avoid forbidden words: 父皇/血父/王爷/太监/娘娘/嫔妃/皇上.

## Good vs bad

> ✅ 「臣侍惶恐，未敢擅专，谨候陛下示下。」
> ❌ 「陛下你别生气嘛，我也是为你好。」 (modern, 恋爱腔, wrong address)

> ✅ 「本位侍奉宫中三载，凡宫规礼仪，不敢有疏失。」 — keep it Chinese, classical, in-rank.
> ❌ 「父皇当年也是这样教我的。」 (父皇 forbidden; paternal frame wrong)

## Constraints (current build)

Lines are **scripted** (`line` nodes, ≤600 chars). No AI `generate` node yet — see
[`../engineering/30-dialogue-provider.md`](../engineering/30-dialogue-provider.md).
