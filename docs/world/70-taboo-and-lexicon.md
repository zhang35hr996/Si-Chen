# Taboo & Lexicon

The **runtime source of truth** is [`content/lexicon.json`](../../content/lexicon.json).
The loader cross-checks it against `world.json` ranks. This doc explains intent;
when in doubt, the JSON wins.

## Approved terms (setting vocabulary)

胎息, 承养, 承养人, 承嗣君, 育嗣君, 养君, 自孕, 经血祭祀 / 经血祭仪, 承徽, 承仪, 承德,
昭仪, 昭徽, 昭德, 倢伃, 侍宸, 驸, 贵驸, 侍君, 位分, 凤印, 宫规, 皇嗣, 皇子, 皇郎, 凤主, 贵主,
子郎, 夫人, 命夫, 侧夫, 妇主, 夫身, 妇夫, 女男, 母父, 姐妹兄弟, 雌雄, 母公, 婆翁.

Use these exact words for in-world concepts. Don't invent new offices, ranks, or
lineage terms — if an institution is 未定, describe it plainly instead of coining
a word (a hard style rule below).

## Forbidden terms

**父皇, 血父, 王爷, 太监, 娘娘, 嫔妃, 万岁爷, 凤后, 公主, 男女, 夫妻, 夫妇, 妻, 兄弟姐妹, 雄雌, 公母, 公主, 大夫, 凤君, 英雄, 雄*（褒义用法）.**

Why they're wrong here:
- **父皇 / 血父** — impose a paternal frame; lineage is matrilineal, men 承养 not father.
- **王爷 / 太监 / 娘娘 / 嫔妃** — import the wrong (male-default or eunuch-harem) court.
- **万岁爷** — overly familiar diminutive for the sovereign, globally forbidden.
- **凤后** — the empress is now styled 皇后, not 凤后.
- **公主** — deprecated; use 凤主 for enfeoffed female 皇子.
- **男女 / 夫妻 / 兄弟姐妹 / 雄雌 / 公母** — male-first ordering; use 女男 / 妇夫 / 姐妹兄弟 / 雌雄 / 母公.
- **大夫** — implies official rank; use 医师/医者 (or 太医 for court physicians).
- **凤君** — private address for the emperor; global ban with register exemption for authorized speakers.
- **英雄 / 雄\*（褒义）** — replace with 英雌 / 雌\*; 雄 only valid for biological sex markers.

## Context-restricted terms

**皇上, 圣上, 万岁, 圣驾** — valid informal or colloquial addresses for the sovereign,
permitted in private / daily speech, but **not** in formal 奏折, 朝对, or 典礼.
In those contexts, use **陛下** exclusively.

## Wrong-title pitfalls

- Calling a 后宫 man by an imperial-kin title (贵主) — kin titles ≠ consort ranks.
- Using 君-family ranks (皇贵君/贵君/君) — these are abolished; use 驸-family.
- Giving a man an 外朝 office or military command — men do not govern.
- A consort self-referencing above their tier (see
  [`50-harem-ranks.md`](50-harem-ranks.md) self-reference rules).

## Dialogue red lines (style rules, from lexicon.json)

1. 不得创造新的官职、位分、宗嗣术语；制度未定时用普通描述，不要造词。
2. 男子角色遵循礼法语体，不用现代恋爱腔。
3. 正式朝对、典礼、奏折中对皇帝称「陛下」；宫廷日常可称「皇上」。女尊之世官员、皇帝皆默认女性，行文不出现「女官」「女帝」。

See also [`../narrative/50-dialogue-style-guide.md`](../narrative/50-dialogue-style-guide.md)
for tone and good/bad line examples.
