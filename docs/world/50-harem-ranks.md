# Harem Ranks (后宫位分)

The 后宫 rank system serves the sovereign's emotional, political, lineage, and
ritual needs. Men gain rank by birth, favor, 承养 ability, family value, and
后宫 maneuvering. To avoid clashing with imperial-kin male titles (贵主 etc.),
**后宫 men use the 君 family of ranks.**

## Full rank table (lore)

| Grade | Rank | Self-reference |
|---|---|---|
| 正宫 | 皇后 / 凤后 | 臣后 / 本宫 |
| 超品 | 皇贵君 | 本宫 |
| 正一品 | 贵君 | 本宫 |
| 从一品 | 君 | 本宫 |
| 正二品 | 贵驸 | 本宫 / 本位 |
| 从二品 | 驸 | 本位 |
| 正三品 | 承徽 | 本位 |
| 从三品 | 承仪 | 本位 / 臣侍 |
| 正四品 | 侍宸 | 臣侍 |
| 从四品 | 贵人 | 臣侍 |
| 正五品 | 美人 | 臣侍 |
| 从五品 | 才人 | 臣侍 |
| 六品 | 常在 | 臣侍 / 小侍 |
| 七品 | 答应 | 小侍 |
| 八品 | 更衣 | 小侍 |

## Self-reference rules (canonical)

| Tier | Self-reference |
|---|---|
| 皇后 | 臣后 / 本宫 |
| 皇贵君, 贵君, 君, 贵驸 | 本宫 |
| 驸, 承徽, 承仪 | 本位 |
| 侍宸 and below | 臣侍 |
| addressing a much higher consort | 小侍 |

## What is implemented today

`content/world.json` defines the ranks the engine currently uses; the
**rank table there is canonical** and `content/lexicon.json` must agree with it
(the loader enforces this). Currently shipped harem ranks: **凤后 (`fenghou`)**,
**君 (`jun`)**, **承徽 (`chenghui`)** — plus the official rank 司礼女官. Add more
ranks by extending `world.json` `ranks[]` **and** `lexicon.json`
`rankAddressRules` together. See
[`../content-authoring/20-character-template.md`](../content-authoring/20-character-template.md).
