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

## 礼数不可废 (etiquette is mandatory — hard rule)

This overrides personality. A character's `voice.register` and
`personalityTraits` shape *how* they speak, never *whether* they observe rites.

- **请安 on arrival, 恭送 on departure.** When a 侍君/官员 first faces the
  sovereign, their opening line is a greeting — e.g.「臣侍给陛下请安，陛下万安。」
  When the sovereign rises to leave, they see her off —「恭送陛下。」No matter the
  favor, intimacy, mood, or grievance, **礼不可废**.
- **Always deferential, never 僭越.** However proud, jealous, naive, or aloof a
  character is, speech to the sovereign stays respectful. Sulking/teasing
  (吃醋撒娇) is allowed *only within bounds* — it must never cross 君臣之分 into
  reproach or presumption.
- **皇权不可侵犯.** The sovereign may rebuke, demote, strip titles, or send a
  consort to 冷宫 at any moment. Characters write as people who know 伴君如伴虎 —
  they hedge, they retreat, they beg pardon.

> ❌ (旧·沈承徽 / 今·陆怀瑾)「侍身还以为这花只配侍身看。」— 挟怨讥讽、自矜失礼，已越
>   吃醋撒娇之界，形同僭越；按律可直接入冷宫。
> ✅ 怨而不僭：「陛下久未垂顾，侍身……一时失仪，望陛下恕罪。」— 哀而知礼，分寸不失。

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
