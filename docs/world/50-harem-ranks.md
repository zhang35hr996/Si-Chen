# Harem Ranks (后宫位分)

> Canonical source: [`../background-v1.0.md`](../background-v1.0.md) §9. This file
> mirrors that table; if they ever diverge, the background bible wins.

The 后宫 rank system serves the 皇帝's emotional, political, lineage, and ritual
needs. Men gain rank by birth, favor, 承养 ability, family value, and 后宫
maneuvering. To avoid clashing with imperial-kin male titles (贵主 etc.),
**后宫 men use the 君 family of ranks.**

## Full rank table (lore — background §9.2)

| 等级 | 位分 | 对低位自称 | 说明 |
|---|---|---|---|
| 正宫 | 皇后 | 本宫 | 后宫之主，皇帝正配 |
| 超品 | 皇贵君 | 本宫 | 副后级 |
| 正一品 | 贵君 | 本宫 | 高位宠侍 |
| 从一品 | 君 | 本宫 | 高位 |
| 正二品 | 贵驸 | 本宫 | 中高位 |
| 从二品 | 驸 | 本宫 | 正式宫嫔 |
| 正三品 | 承徽 / 承仪 / 承德 | 本宫 | 承徽 > 承仪 > 承德 |
| 从三品 | 昭徽 / 昭仪 / 昭容 | 本宫 | 昭徽 > 昭仪 > 昭容 |
| 正四品 | 侍宸 | 本宫 | 近侍位，可掌一宫主位 |
| 从四品 | 贵人 | 本侍 / 我 | 一品官员或皇亲郎儿进宫初始位分 |
| 正五品 | 美人 | 本侍 / 我 | 二三品官员郎儿进宫初始位分 |
| 从五品 | 才人 | 本侍 / 我 | 受宠四五品官员郎儿初始位分 |
| 六品 | 常在 | 我 | 一般四五品官员郎儿初始位分 |
| 七品 | 答应 | 我 | 一般六七品官员郎儿初始位分 |
| 八品 | 更衣 | 我 | 低位，平民晋封 |
| 九品 | 官男子 | 我 | 最低位，宫隶晋封 |

## Self-reference rules (canonical — background §9.3)

自称取决于**位分 + 说话对象 + 场合**：

| Tier | 对低位 | 对皇帝 / 高位后宫 |
|---|---|---|
| 皇后 / 皇贵君 / 贵君 | 本宫 | 臣（贵君亦可臣侍） |
| 君 / 贵驸 / 驸 | 本宫 | 臣侍 |
| 承徽·承仪·承德 / 昭徽·昭仪·昭容 / 侍宸 | 本宫 | 侍 / 侍身 |
| 贵人 / 美人 / 才人 | 本侍 / 我 | 侍 / 侍身 |
| 常在 / 答应 / 更衣 / 官男子 | 我 | 小侍 |

- 「本宫」只可由侍宸及以上对低位者使用，不得对皇帝或高位者使用。
- 「侍身」多用于私下、病弱、承宠、被责罚、示弱或亲密语境。
- 「隶」仅限未入后宫名册的宫隶、内隶，不适用于已晋封的官男子。

## What is implemented today

`content/world.json` defines the ranks the engine currently uses; the rank
rows there must stay a **faithful subset** of the canonical table above, and
`content/lexicon.json` must agree with it (the loader enforces selfRefs
equality). Currently shipped: the **full §9.2 consort ladder** — all 21 ranks
from **皇贵君 (`huangguijun`)** down to **官男子 (`guannanzi`)**, plus the
official rank **司礼 (`sili_zhang`)**. All ranks are defined in `world.json`
`ranks[]` and mirrored in `lexicon.json` `rankAddressRules`.

The player can **升/降位分** and **加/褫夺封号** for any consort from her palace
card (管理 button → `RankAdminModal`) or from the 御书房 后宫名册 roster — except
**凤后**（正宫，the cap, not adjustable). Add more ranks by extending `world.json`
`ranks[]` **and** `lexicon.json` `rankAddressRules` together. See
[`../content-authoring/20-character-template.md`](../content-authoring/20-character-template.md).
