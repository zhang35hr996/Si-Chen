# 属性形容词显示 — 设计

日期：2026-06-20
范围：前端把 0–100 数值属性按所属"程度段"显示为形容词；移除这些属性的进度条。少数保持数字（疲劳/国库/年龄），少数为类别/文本（嫡庶/承养人/特长/喜好/家世）。
约束：纯显示层，后台数值不变；发布前无存档兼容问题。
前置：母家/官员系统已完成——家世已是文本（`familyText`），母家忠心/母家权势已是派生数字（`maternalLoyalty`/`maternalPower`），本层把后两者也渲染成形容词。

---

## 1. 架构

新增纯函数模块 `src/ui/format/descriptors.ts`：

```ts
export type ScaleId = /* 见 §3 全部 scale id */ string;

/** 每个 scale 10 段，索引 0=值 0–9 … 9=值 90–100。 */
export const DESCRIPTOR_SCALES: Record<ScaleId, readonly string[]> = { /* §3 */ };

/** 数值→形容词。band = clamp(floor(value/10), 0, 9)。 */
export function describe(scale: ScaleId, value: number): string {
  const band = Math.max(0, Math.min(9, Math.floor(value / 10)));
  return DESCRIPTOR_SCALES[scale]?.[band] ?? String(value);
}
```

- 每个被显示的属性映射到一个 `ScaleId`（§4 映射表）。语义相同的属性共用一个 scale（如 侍君健康/皇帝健康/皇嗣健康 共用 `health`）。
- 负向属性（暴戾/贪腐/宗室不满/谣言）高段为"坏"。
- 显示层改动：原先画进度条 + 数字的地方，改为只显示 `describe(scale, value)` 文本，**去掉进度条**。

### 保持数字（不转形容词、不画条）
- 皇帝 **疲劳** fatigue（显示数字）
- 国家 **国库** treasury（显示数字，如 `50`；本层只去进度条、显示纯数字。注：后台仍是 0–100 抽象值，"具体钱数 50000" 是另一档模型改造，不在本 spec）
- 皇嗣 **年龄**（由出生推算，数字）

### 类别 / 文本（非数值，不经 describe）
- 皇嗣 **嫡庶**（嫡/庶）、**承养人**（人名）、**党羽**（faction 文本枚举）
- 侍君 **家世**（`familyText` 文本）、**特长**、**喜好**（文本）

---

## 2. 渲染改动点

- `src/ui/components/ResourcePanel.tsx`：皇帝 7 项 + 国家 9 项改形容词（疲劳/国库除外），去进度条。
- `src/ui/components/CharacterProfileDrawer.tsx`：侍君 容貌/健康/恩宠/情意/恐惧/野心/母家忠心/母家权势 改形容词（`Stat` 改为形容词文本行；保留 `Stat` 仅用于…无——全部改文本）。家世/特长/喜好不变。
- `src/ui/components/CharacterCard.tsx`：卡片 容貌/健康 改形容词；**承养** nurture 一并改形容词或移除（见 §5 待定）。
- 皇嗣展示（`HeirListModal` / `YuqingGongScreen` 等显示皇嗣属性处）：健康/宠爱/天赋/努力/道德/武力/政治（+若显示 野心/亲近/继位支持）改形容词；年龄/嫡庶/承养人不变。

> 进度条组件（`profile-stat__bar` 等）在这些属性上不再渲染；CSS 可保留（其它地方或不再使用）。

---

## 3. 形容词表（草案，索引 0→9 对应 0–9 … 90–100；负向表高段为坏）

> 措辞可在评审时调整；要求每段 10 个、语义单调递进。

**appearance 容貌**：容貌丑陋 / 其貌不扬 / 姿色平庸 / 姿色寻常 / 略逊风姿 / 平平无奇 / 眉目清秀 / 姿容秀丽 / 倾国倾城 / 美若天仙

**health 健康**（侍君/皇帝/皇嗣共用）：病入膏肓 / 缠绵病榻 / 体弱多病 / 时常抱恙 / 略显孱弱 / 康健寻常 / 身强体健 / 精力充沛 / 龙精虎猛 / 福寿康宁

**favor 恩宠**（侍君恩宠/皇嗣宠爱）：失宠见弃 / 圣眷渐疏 / 久未承幸 / 恩宠平平 / 略沾雨露 / 颇得青眼 / 恩宠正隆 / 盛宠加身 / 专房之宠 / 万千宠爱

**affection 情意**：漠不关心 / 平淡如水 / 略有好感 / 渐有亲近 / 心生暖意 / 情意微萌 / 两情相洽 / 情意绵绵 / 情深意重 / 生死相随

**fear 恐惧**：毫无惧色 / 略感不安 / 心存忌惮 / 颇为畏怯 / 惴惴不安 / 战战兢兢 / 心生怖惧 / 惶惶难安 / 畏之如虎 / 魂飞魄散

**ambition 野心**（侍君/皇嗣）：安分守己 / 与世无争 / 略有念想 / 小有所图 / 暗藏心思 / 颇有进取 / 志在不小 / 锐意进取 / 野心勃勃 / 觊觎大位

**loyalty 忠心**（母家忠心/大臣忠心）：离心离德 / 貌合神离 / 心怀异志 / 忠诚存疑 / 中立观望 / 尚算恭顺 / 忠谨可信 / 赤诚可托 / 忠心耿耿 / 肝脑涂地

**power 权势**（母家权势）：门庭冷落 / 势单力薄 / 微末之家 / 略有根基 / 小有声势 / 颇具声望 / 根基深厚 / 权倾一方 / 权势熏天 / 权势滔天

**clanPowerNation 外戚权势**（国家外戚权势）：外戚式微 / 母族无依 / 外戚势弱 / 略有依仗 / 渐有声势 / 颇有权柄 / 外戚得势 / 外戚干政 / 权倾朝野 / 外戚专权

**diligence 勤政**（皇帝）：荒怠政务 / 疏于朝政 / 偶理政事 / 勤怠无常 / 尚知理政 / 兢兢业业 / 勤于政务 / 夙兴夜寐 / 宵衣旰食 / 励精图治

**effort 努力**（皇嗣）：懒散怠惰 / 疏于课业 / 偶尔用功 / 时勤时惰 / 尚知上进 / 勤勉有加 / 刻苦用功 / 笃志好学 / 悬梁刺股 / 发奋忘食

**prestige 威望**（皇帝）：声名狼藉 / 威信扫地 / 威望不足 / 平平无闻 / 略有声望 / 颇有威信 / 威望渐隆 / 威震朝野 / 德高望重 / 威加海内

**martial 武力**（皇帝/皇嗣）：手无缚鸡之力 / 文弱不堪 / 略通拳脚 / 身手平平 / 略有武艺 / 武艺娴熟 / 身手矫健 / 骁勇善战 / 武艺超群 / 万夫不当

**statecraft 政略 / 政治**（皇帝政略/皇嗣政治）：毫无谋略 / 不谙政事 / 略通政务 / 见识平平 / 略有见地 / 颇通谋略 / 深谙政道 / 老成谋国 / 经天纬地 / 雄才大略

**cruelty 暴戾**（负向）：仁厚宽和 / 性情温和 / 待下平和 / 偶有苛责 / 喜怒无常 / 渐显严苛 / 性情暴躁 / 刻薄寡恩 / 暴戾恣睢 / 嗜杀成性

**regimeSecurity 皇权安全**：危如累卵 / 风雨飘摇 / 根基不稳 / 暗流涌动 / 略有隐忧 / 大致安稳 / 皇权稳固 / 江山稳固 / 固若金汤 / 万世之基

**military 军力**：兵微将寡 / 武备废弛 / 军力薄弱 / 兵力平平 / 略可自保 / 军备尚整 / 兵强马壮 / 军威赫赫 / 所向披靡 / 雄师百万

**publicSupport 民心**：民怨沸腾 / 民心离散 / 民心浮动 / 民心平平 / 渐得民心 / 民心安定 / 民心归附 / 深得民心 / 万民拥戴 / 四海归心

**productivity 生产力**：民生凋敝 / 百业萧条 / 生产低迷 / 勉力维持 / 渐有起色 / 仓廪渐实 / 物阜民丰 / 五谷丰登 / 国富民殷 / 仓廪丰盈

**governance 朝政**：朝纲败坏 / 政事荒废 / 吏治松弛 / 朝政平平 / 渐有条理 / 政务井然 / 朝纲整肃 / 政通人和 / 百官称职 / 朝政清明

**corruption 贪腐**（负向）：吏治清明 / 两袖清风 / 贪墨鲜见 / 偶有蝇营 / 渐有贪风 / 贪腐渐生 / 贪墨成风 / 贪赃枉法 / 贪腐横行 / 蠹政害民

**clanDiscontent 宗室不满**（负向）：宗室和睦 / 宗亲拥戴 / 略无异议 / 偶有微词 / 渐生嫌隙 / 宗室不平 / 宗室离心 / 宗室怨怼 / 宗室异动 / 宗室离叛

**rumor 谣言**（负向）：清平无谤 / 流言鲜起 / 偶有风言 / 略有传闻 / 渐起非议 / 流言渐盛 / 蜚短流长 / 谣诼纷纭 / 谣言四起 / 众口铄金

**talent 天赋**（皇嗣）：资质愚钝 / 天资平庸 / 略显迟钝 / 资质寻常 / 尚有悟性 / 颖悟可教 / 天资聪颖 / 聪慧过人 / 天纵奇才 / 旷世奇才

**virtue 道德**（皇嗣）：品行败坏 / 顽劣不堪 / 德行有亏 / 品性寻常 / 尚知礼义 / 品行端正 / 德行可嘉 / 温良恭俭 / 德行高洁 / 仁德昭彰

**closeness 亲近**（皇嗣对帝，若显示）：离心疏远 / 形同陌路 / 略显生分 / 寻常情分 / 渐生亲近 / 颇为亲昵 / 孺慕之情 / 亲密无间 / 依恋至深 / 情同骨肉

**support 继位支持**（皇嗣，若显示）：众叛亲离 / 无人拥护 / 支持寥寥 / 毁誉参半 / 略有拥趸 / 渐得人心 / 颇有拥戴 / 众望所归 / 储位稳固 / 天命所归

---

## 4. 属性 → scale 映射

| 显示位置 | 属性（字段） | scale | 备注 |
|---|---|---|---|
| 侍君 | 容貌 appearance | appearance | |
| 侍君/皇帝/皇嗣 | 健康 health | health | |
| 侍君 恩宠 standing.favor / 皇嗣 宠爱 favor | favor | |
| 侍君 | 情意 hidden.affection | affection | |
| 侍君 | 恐惧 hidden.fear | fear | |
| 侍君/皇嗣 | 野心 hidden.ambition / heir.ambition | ambition | |
| 侍君 | 母家忠心 `maternalLoyalty` | loyalty | 派生 |
| 侍君 | 母家权势 `maternalPower` | power | 派生 |
| 皇帝 | 勤政 diligence | diligence | |
| 皇帝 | 威望 prestige | prestige | |
| 皇帝/皇嗣 | 武力 martial | martial | |
| 皇帝 政略 statecraft / 皇嗣 政治 education.scholarship | statecraft | |
| 皇帝 | 暴戾 cruelty | cruelty | 负向 |
| 皇帝 | 皇权安全 regimeSecurity | regimeSecurity | |
| 皇帝 | 疲劳 fatigue | —（数字） | |
| 国家 | 军力 military | military | |
| 国家 | 民心 publicSupport | publicSupport | |
| 国家 | 生产力 productivity | productivity | |
| 国家 | 朝政 governance | governance | |
| 国家 | 外戚权势 consortClanPower | clanPowerNation | |
| 国家 | 大臣忠心 ministerLoyalty | loyalty | |
| 国家 | 贪腐 corruption | corruption | 负向 |
| 国家 | 宗室不满 clanDiscontent | clanDiscontent | 负向 |
| 国家 | 谣言 rumor | rumor | 负向 |
| 国家 | 国库 treasury | —（数字，去条） | |
| 皇嗣 | 天赋 talent | talent | |
| 皇嗣 | 努力 diligence | effort | |
| 皇嗣 | 道德 education.virtue | virtue | |
| 皇嗣 | 亲近 closeness / 继位支持 support | closeness / support | 若 UI 显示 |
| 皇嗣 | 嫡庶 legitimate / 承养人 / 年龄 / 党羽 faction | —（类别/数字） | |

---

## 5. 待定（评审时定）

1. **侍君 承养 nurture**（CharacterCard 仍显示）：(a) 一并去掉（与抽屉一致，抽屉已无承养）；(b) 给一个 `nurture` scale 转形容词。**建议 (a) 去掉**——抽屉已移除承养，卡片留着不一致。
2. 皇嗣 **亲近/继位支持** 是否在 UI 显示：取决于现有皇嗣面板；若未显示则不需 closeness/support 两表。实现期按现有皇嗣 UI 实际显示的属性接 scale。

---

## 6. 影响面

- 新：`src/ui/format/descriptors.ts`（表 + `describe`）。
- 改显示：`ResourcePanel`、`CharacterProfileDrawer`、`CharacterCard`、皇嗣面板组件。
- 无引擎/内容/存档改动。

## 7. 测试策略

- `describe`：边界分段（0→band0、9→band0、10→band1、95→band9、100→band9 clamp）；未知 scale 回退数字。
- 每个 scale 恰 10 段、无空串。
- 负向 scale 高段词义为"坏"（抽样断言，如 cruelty[9] 含"杀"/贪腐[9] 含"害"）。
- 映射完整性：每个被显示的数值属性都有 scale（可对映射表做一次断言）。
- UI 渲染以手动验证为主。
