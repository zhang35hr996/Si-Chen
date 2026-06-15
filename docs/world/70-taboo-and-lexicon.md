# Taboo & Lexicon

The **runtime source of truth** is [`content/lexicon.json`](../../content/lexicon.json).
The loader cross-checks it against `world.json` ranks. This doc explains intent;
when in doubt, the JSON wins.

## Approved terms (setting vocabulary)

胎息, 承养, 承养人, 承嗣君, 育嗣君, 养君, 自孕, 经血祭祀 / 经血祭仪, 凤后, 承徽, 君,
侍君, 位分, 凤印, 宫规, 皇嗣, 皇子, 皇郎, 公主, 贵主.

Use these exact words for in-world concepts. Don't invent new offices, ranks, or
lineage terms — if an institution is 未定, describe it plainly instead of coining
a word (a hard style rule below).

## Forbidden terms

**父皇, 血父, 王爷, 太监, 娘娘, 嫔妃, 皇上.**

Why they're wrong here:
- **父皇 / 血父** — impose a paternal frame; lineage is matrilineal, men 承养 not father.
- **王爷 / 太监 / 娘娘 / 嫔妃** — import the wrong (male-default or eunuch-harem) court.
- **皇上** — the sovereign is addressed **陛下**, never 皇上.

## Wrong-title pitfalls

- Calling a 后宫 man by an imperial-kin title (贵主) — kin titles ≠ consort ranks.
- Giving a man an 外朝 office or military command — men do not govern.
- A consort self-referencing above their tier (see
  [`50-harem-ranks.md`](50-harem-ranks.md) self-reference rules).

## Dialogue red lines (style rules, from lexicon.json)

1. 不得创造新的官职、位分、宗嗣术语；制度未定时用普通描述，不要造词。
2. 男子角色遵循礼法语体，不用现代恋爱腔。
3. 对皇帝一律称「陛下」，不得称「皇上」；女尊之世官员、皇帝皆默认女性，行文不出现「女官」「女帝」。

See also [`../narrative/50-dialogue-style-guide.md`](../narrative/50-dialogue-style-guide.md)
for tone and good/bad line examples.
