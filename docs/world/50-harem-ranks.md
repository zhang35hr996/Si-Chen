# Harem Ranks (后宫位分)

> Canonical source: [`45-address-and-title-system.md`](45-address-and-title-system.md). This file
> summarises the rank table; if they ever diverge, the address-system doc wins.

The 后宫 rank system serves the 皇帝's emotional, political, lineage, and ritual
needs. Men gain rank by birth, favor, 承养 ability, family value, and 后宫
maneuvering. To avoid clashing with imperial-kin male titles (贵主 etc.),
**后宫 men use the 驸 family of ranks** (旧 君 系已废弃).

## Full rank table (lore)

| 等级 | 位分 ID | 汉称 | 对低位自称 | 说明 |
|---|---|---|---|---|
| 正宫(超品) | huanghou | 皇后 | 本宫 | 后宫之主，皇帝正配 |
| 超品 | huangguifu | 皇贵驸 | 本宫 | 副后级 |
| 正一品① | guifu | 贵驸 | 本宫 | 高位宠侍 |
| 正一品② | xianfu | 贤驸 | 本宫 | 高位 |
| 正一品③ | liangfu | 良驸 | 本宫 | 高位 |
| 正一品④ | defu | 德驸 | 本宫 | 高位 |
| 从一品 | fu | 驸 | 本宫 | 正式宫嫔 |
| 正二品① | zhaoyi | 昭仪 | 本宫 | 承品之首 |
| 正二品② | zhaohui | 昭徽 | 本宫 | |
| 正二品③ | zhaode | 昭德 | 本宫 | |
| 从二品① | chengyi | 承仪 | 本宫 | |
| 从二品② | chenghui | 承徽 | 本宫 | |
| 从二品③ | chengde | 承德 | 本宫 | |
| 正三品 | jieyu | 倢伃 | 本宫 | 近侍 |
| 从三品 | shichen | 侍宸 | 本宫 | 近侍 |
| 正四品 | changyu | 长御 | 本宫 | |
| 从四品 | shaoshi | 少使 | 侍/侍身 | |
| 正五品 | guiren | 贵人 | 侍/侍身 | 一品官员或皇亲郎儿进宫初始位分 |
| 从五品 | liangren | 良人 | 侍/侍身 | |
| 正六品 | meiren | 美人 | 侍/侍身 | 二三品官员郎儿进宫初始位分 |
| 从六品 | cairen | 才人 | 侍/侍身 | |
| 正七品 | changzai | 常在 | 我 | 一般四五品官员郎儿初始位分 |
| 从七品 | daying | 答应 | 我 | 一般六七品官员郎儿初始位分 |
| 正八品 | gengyi | 更衣 | 我 | 低位，平民晋封 |
| 从八品 | xuanshi | 选侍 | 我 | |
| 正九品 | guannanzi | 观南子 | 我 | 最低位，宫隶晋封 |

## Self-reference rules

自称取决于**位分 + 说话对象 + 场合**：

| Tier | 对低位 | 对皇帝 / 高位后宫 |
|---|---|---|
| 皇后 / 皇贵驸 / 贵驸 / 贤驸 / 良驸 / 德驸 / 驸 / 昭仪~昭德 / 长御 | 本宫 | 臣侍 |
| 承仪~承德 / 倢伃 / 侍宸 / 少使 / 贵人 / 良人 / 美人 / 才人 | 本宫/侍身 | 侍 / 侍身 |
| 常在 / 答应 / 更衣 / 选侍 / 观南子 | 我 | 小侍 |

- 「本宫」只可由倢伃（正三品）及以上对低位者使用，不得对皇帝或高位者使用。
- 「侍身」多用于私下、病弱、承宠、被责罚、示弱或亲密语境。
- 「隶」仅限未入后宫名册的宫隶、内隶，不适用于已晋封的观南子及以上。

## What is implemented today

`content/world.json` defines the ranks the engine currently uses; the rank
rows there must stay a **faithful subset** of the canonical table above, and
`content/lexicon.json` must agree with it (the loader enforces selfRefs
equality). Currently shipped: the **full consort ladder** — all 27 ranks
from **皇贵驸 (`huangguifu`)** down to **观南子 (`guannanzi`)**, plus the
official ranks **司礼长 (`sili_zhang`)** and **侍卫长 (`shiwei_zhang`)**.

The player can **升/降位分** and **加/褫夺封号** for any consort from her palace
card (管理 button → `RankAdminModal`) or from the 紫宸殿 后宫名册 roster — except
**皇后**（正宫，the cap, not adjustable). Add more ranks by extending `world.json`
`ranks[]` **and** `lexicon.json` `rankAddressRules` together.
