# 属性形容词显示 — 设计

日期：2026-06-20
范围：前端把 0–100 数值属性按所属"程度段"显示为形容词；移除这些属性的进度条。少数保持数字（疲劳/国库/年龄），少数为类别/文本（嫡庶/承养人/特长/喜好/家世）。
约束：纯显示层，后台数值不变；发布前无存档兼容问题。
前置：母家/官员系统已完成——家世已是文本（`familyText`），母家忠心/母家权势已是派生数字（`maternalLoyalty`/`maternalPower`），本层把后两者也渲染成形容词。

---

## 1. 架构

新增纯函数模块 `src/ui/format/descriptors.ts`。每个属性是一个带**方向**的配置，而非一张裸表——UI 据此决定"好/坏"着色，**绝不默认数值越高越好**。

```ts
/** 形容词主体（注意：heir 不是 CharacterKind，故单列一个 union）。 */
export type DescriptorKind = "consort" | "heir";

export type ScaleId = /* §3 全部 id */ string;

export interface DescriptorConfig {
  /** UI 着色方向：higher_is_better → 高段为好（绿）；lower_is_better → 高段为坏（红）。 */
  direction: "higher_is_better" | "lower_is_better";
  /** 默认 10 段（索引 0=值 0–9 … 9=值 90–100）。与 labelsByKind 至少有其一。 */
  labels?: readonly string[];
  /** 按主体覆盖（如恩宠：侍君 vs 皇嗣措辞不同）。命中则用之，否则回退 labels。 */
  labelsByKind?: Partial<Record<DescriptorKind, readonly string[]>>;
}

export const DESCRIPTORS: Record<ScaleId, DescriptorConfig> = { /* §3 */ };

const band = (v: number) => Math.max(0, Math.min(9, Math.floor(v / 10)));

/** 数值→形容词；kind 仅 favor/ambition 等需要按主体区分时传。未知/缺表回退数字串。 */
export function describe(scale: ScaleId, value: number, kind?: DescriptorKind): string {
  const cfg = DESCRIPTORS[scale];
  if (!cfg) return String(value);
  const labels = (kind && cfg.labelsByKind?.[kind]) ?? cfg.labels;
  return labels?.[band(value)] ?? String(value);
}

/** UI 着色用：缺省 higher_is_better。 */
export function directionOf(scale: ScaleId): DescriptorConfig["direction"] {
  return DESCRIPTORS[scale]?.direction ?? "higher_is_better";
}
```

**着色规则（UI）**：取 `band(value)` 与 `directionOf(scale)`。`higher_is_better` 时高段偏吉色、低段偏警色；`lower_is_better` 反之（高段警色）。负向属性（见 §3 标注）务必走 `lower_is_better`。

### 保持数字（不转形容词、不画条）
- 皇帝 **疲劳** fatigue（数字）
- 国家 **国库** treasury（数字，如 `50`；只去进度条。"具体钱数 50000" 是另一档模型改造，不在本 spec）
- 皇嗣 **年龄**（由出生推算，数字）

### 类别 / 文本（非数值，不经 describe）
- 皇嗣 **嫡庶**（嫡/庶）、**承养人**（人名）、**党羽**（faction 文本枚举）
- 侍君 **家世**（`familyText` 文本）、**特长**、**喜好**（文本）

---

## 2. 渲染改动点

- `src/ui/components/ResourcePanel.tsx`：皇帝 7 项 + 国家明面项改形容词（疲劳/国库除外），去进度条；按 `directionOf` 着色。**外戚权势移出明面**（见 §4、§5）。
- `src/ui/components/CharacterProfileDrawer.tsx`：侍君 容貌/健康/恩宠(consort)/情意/恐惧/野心(consort)/母家忠心/母家权势 改形容词。家世/特长/喜好不变。
- `src/ui/components/CharacterCard.tsx`：卡片 容貌/健康 改形容词；**承养 nurture 去掉**（§5.1）。
- 皇嗣展示（`HeirListModal` / `YuqingGongScreen` 等）：健康/宠爱(heir)/天赋/努力/道德/武力/政治 改形容词；皇嗣暗属性 野心(heir)/亲近/继位支持 亦以形容词显示（§5.2）；年龄/嫡庶/承养人/党羽 不变。

> 进度条 CSS 可保留（不再被这些属性使用）。

---

## 3. 形容词配置（草案，索引 0→9 = 0–9 … 90–100；负向标注 lower_is_better）

> 措辞可评审调整；每段恰 10 个、语义单调递进。direction 决定 UI 着色，不改变文字顺序。

**appearance 容貌** — higher_is_better
容貌丑陋 / 其貌不扬 / 姿色平庸 / 容貌寻常 / 小家碧玉 / 眉目清秀 / 姿容秀丽 / 姿容出众 / 惊为天人 / 绝世之姿

**health 健康**（侍君/皇帝/皇嗣共用）— higher_is_better
病入膏肓 / 缠绵病榻 / 体弱多病 / 时常抱恙 / 略显孱弱 / 康健寻常 / 身体康健 / 精力充沛 / 气血充盈 / 康强无恙

**favor 恩宠** — higher_is_better — `labelsByKind`
- consort（侍君恩宠）：失宠见弃 / 久未承幸 / 圣眷渐疏 / 恩宠寥寥 / 恩宠平平 / 颇得青眼 / 恩宠日盛 / 盛宠加身 / 专房之宠 / 冠宠六宫
- heir（皇嗣恩宠）：厌弃不顾 / 冷眼相待 / 少有顾念 / 关怀渐疏 / 宠爱平平 / 略得疼爱 / 颇受疼爱 / 偏爱有加 / 视若珍宝 / 掌上明珠

**affection 情意** — higher_is_better
漠不关心 / 情分淡薄 / 略有好感 / 渐感亲近 / 心生暖意 / 情意暗生 / 倾心相待 / 情意绵绵 / 情深意重 / 生死相许

**fear 恐惧** — higher_is_better（中性偏控制；如日后定为负向再改 direction）
毫无惧色 / 略感不安 / 心存忌惮 / 谨小慎微 / 惴惴不安 / 战战兢兢 / 心生怖惧 / 惶惶难安 / 畏之如虎 / 魂飞魄散

**ambition 野心** — higher_is_better — `labelsByKind`
- consort（侍君）：无欲无求 / 安分守己 / 略有念想 / 小有所求 / 暗藏心思 / 颇有图谋 / 所图不小 / 志在高位 / 野心勃勃 / 欲掌六宫
- heir（皇嗣）：闲云野鹤 / 安分守己 / 略有念想 / 小有所求 / 暗藏心思 / 颇有图谋 / 所图不小 / 志在储位 / 野心勃勃 / 问鼎大位

**loyalty 忠心**（母家忠心/大臣忠心）— higher_is_better
离心离德 / 貌合神离 / 心怀异志 / 忠诚存疑 / 中立观望 / 尚知恭顺 / 忠谨可信 / 赤诚可托 / 忠贞不贰 / 一心奉国

**power 权势**（母家权势）— higher_is_better
衰微无势 / 势单力薄 / 微末之家 / 略有根基 / 小有声势 / 颇具势力 / 根基深厚 / 权重一方 / 权势熏天 / 权势滔天

**clanPowerNation 外戚权势**（国家外戚权势）— **lower_is_better**（高=威胁皇权）
外戚不显 / 外戚式微 / 外戚势弱 / 略有依仗 / 渐有声势 / 颇具权柄 / 外戚得势 / 把持要津 / 权倾朝野 / 外戚专权

**diligence 勤政**（皇帝）— higher_is_better
荒怠政务 / 疏于朝政 / 偶理政事 / 勤怠无常 / 尚知理政 / 兢兢业业 / 勤于政务 / 夙兴夜寐 / 宵衣旰食 / 励精图治

**effort 努力**（皇嗣）— higher_is_better
懒散怠惰 / 疏于课业 / 偶尔用功 / 时勤时惰 / 尚知上进 / 勤勉有加 / 刻苦用功 / 笃志好学 / 悬梁刺股 / 发奋忘食

**prestige 威望**（皇帝）— higher_is_better
声名狼藉 / 威信扫地 / 威望寥寥 / 声望平平 / 略有声望 / 颇有威信 / 威望渐隆 / 威震朝野 / 德高望重 / 威加海内

**martial 武力**（皇帝/皇嗣）— higher_is_better
手无缚鸡之力 / 文弱不堪 / 略通拳脚 / 身手平平 / 略有武艺 / 武艺娴熟 / 身手矫健 / 骁勇善战 / 武艺超群 / 万夫不当

**statecraft 政略/政治**（皇帝政略/皇嗣政治）— higher_is_better
毫无谋略 / 不谙政事 / 略通政务 / 见识平平 / 略有见地 / 颇通谋略 / 深谙政道 / 老成谋国 / 经天纬地 / 雄才大略

**cruelty 暴戾** — **lower_is_better**
仁德宽厚 / 宽和少罚 / 待下平和 / 偶有苛责 / 御下严厉 / 用刑偏重 / 刻薄寡恩 / 酷烈无情 / 暴戾恣睢 / 嗜杀成性

**regimeSecurity 皇权安全**（皇帝）— higher_is_better
危如累卵 / 风雨飘摇 / 根基不稳 / 暗流涌动 / 略有隐忧 / 大致安稳 / 皇权稳固 / 江山稳固 / 固若金汤 / 万世之基

**military 军力** — higher_is_better
兵微将寡 / 武备废弛 / 军力薄弱 / 兵力平平 / 略可自保 / 军备尚整 / 兵强马壮 / 军威赫赫 / 所向披靡 / 威震四海

**publicSupport 民心** — higher_is_better
民怨沸腾 / 民心离散 / 民心浮动 / 民心平平 / 渐得民心 / 民心安定 / 民心归附 / 深得民心 / 万民拥戴 / 四海归心

**productivity 生产力** — higher_is_better
百业凋敝 / 耕织废弛 / 生产低迷 / 勉力维持 / 渐有起色 / 耕织渐兴 / 百业复苏 / 物产丰饶 / 百业兴盛 / 国富民殷

**governance 朝政** — higher_is_better
朝纲败坏 / 政事荒废 / 吏治松弛 / 朝政平平 / 渐有条理 / 政务井然 / 百官称职 / 朝纲整肃 / 政通人和 / 朝政清明

**corruption 贪腐** — **lower_is_better**
吏治清明 / 廉风盛行 / 贪墨鲜见 / 偶有蝇营 / 渐有贪风 / 贪腐渐生 / 贪墨成风 / 贪赃枉法 / 贪腐横行 / 蠹政害民

**clanDiscontent 宗室不满** — **lower_is_better**
宗室和睦 / 宗亲拥戴 / 宗室安分 / 偶有微词 / 渐生嫌隙 / 宗室不平 / 宗室离心 / 宗室怨怼 / 暗有异动 / 宗室离叛

**rumor 谣言** — **lower_is_better**
清平无谤 / 流言鲜起 / 偶有风言 / 略有传闻 / 渐起非议 / 流言渐盛 / 蜚短流长 / 谣诼纷纭 / 谣言四起 / 众口铄金

**talent 天赋**（皇嗣）— higher_is_better
资质愚钝 / 略显迟钝 / 天资平庸 / 资质寻常 / 尚有悟性 / 颖悟可教 / 天资聪颖 / 聪慧过人 / 七窍玲珑 / 旷世奇才

**virtue 道德**（皇嗣）— higher_is_better
品行败坏 / 顽劣不堪 / 德行有亏 / 品性寻常 / 尚知礼义 / 品行端正 / 德行可嘉 / 温良恭俭 / 德行高洁 / 仁德昭彰

**closeness 亲近**（皇嗣对帝，暗属性）— higher_is_better
形同陌路 / 离心疏远 / 略显生分 / 情分寻常 / 渐生亲近 / 颇为亲昵 / 孺慕之情 / 亲密无间 / 依恋至深 / 至爱至亲

**support 继位支持**（皇嗣，暗属性）— higher_is_better
众皆反对 / 孤立无援 / 支持寥寥 / 少有声援 / 略有拥趸 / 渐得人心 / 颇受拥戴 / 朝野属望 / 众望所归 / 天命所归

---

## 4. 属性 → scale 映射

| 显示位置 | 属性（字段） | scale | kind | direction |
|---|---|---|---|---|
| 侍君 | 容貌 appearance | appearance | — | higher |
| 侍君/皇帝/皇嗣 | 健康 health | health | — | higher |
| 侍君 恩宠 standing.favor | favor | consort | higher |
| 皇嗣 宠爱 favor | favor | heir | higher |
| 侍君 | 情意 hidden.affection | affection | — | higher |
| 侍君 | 恐惧 hidden.fear | fear | — | higher |
| 侍君 | 野心 hidden.ambition | ambition | consort | higher |
| 皇嗣 | 野心 ambition | ambition | heir | higher |
| 侍君 | 母家忠心 `maternalLoyalty` | loyalty | — | higher |
| 侍君 | 母家权势 `maternalPower` | power | — | higher |
| 皇帝 | 勤政 diligence | diligence | — | higher |
| 皇帝 | 威望 prestige | prestige | — | higher |
| 皇帝/皇嗣 | 武力 martial | martial | — | higher |
| 皇帝 政略 / 皇嗣 政治 education.scholarship | statecraft | — | higher |
| 皇帝 | 暴戾 cruelty | cruelty | — | **lower** |
| 皇帝 | 皇权安全 regimeSecurity | regimeSecurity | — | higher |
| 皇帝 | 疲劳 fatigue | —（数字） | — | — |
| 国家 | 军力 military | military | — | higher |
| 国家 | 民心 publicSupport | publicSupport | — | higher |
| 国家 | 生产力 productivity | productivity | — | higher |
| 国家 | 朝政 governance | governance | — | higher |
| 国家 | 外戚权势 consortClanPower | clanPowerNation | — | **lower**（移入暗属性，§5.3） |
| 国家 | 大臣忠心 ministerLoyalty | loyalty | — | higher |
| 国家 | 贪腐 corruption | corruption | — | **lower** |
| 国家 | 宗室不满 clanDiscontent | clanDiscontent | — | **lower** |
| 国家 | 谣言 rumor | rumor | — | **lower** |
| 国家 | 国库 treasury | —（数字，去条） | — | — |
| 皇嗣 | 天赋 talent | talent | — | higher |
| 皇嗣 | 努力 diligence | effort | — | higher |
| 皇嗣 | 道德 education.virtue | virtue | — | higher |
| 皇嗣 | 亲近 closeness | closeness | — | higher（暗属性）|
| 皇嗣 | 继位支持 support | support | — | higher（暗属性）|
| 皇嗣 | 嫡庶/承养人/年龄/党羽 faction | —（类别/数字） | — | — |

---

## 5. 已决（评审反馈）

1. **侍君 承养 nurture**：**去掉**——CharacterCard 不再显示 nurture（抽屉已无，保持一致）。
2. **皇嗣 亲近 closeness / 继位支持 support**：归为**暗属性**，开发期以形容词显示（同侍君情意/恐惧/野心的"暗属性"待遇），各配一张表（§3）。
3. **国家 外戚权势 consortClanPower**：视为**负向**（高=威胁皇权），direction `lower_is_better`，并从国家**明面**面板移入**暗属性**展示区（与 ministerLoyalty/corruption/clanDiscontent/rumor 同列为暗）。注：types.ts 注释当前把 consortClanPower 列在"明面"，本 spec 仅改 UI 归类与着色，不动后台字段；"条件负向"（仅在威胁皇权时为负）留作日后细化。

> 说明：`DescriptorConfig.labelsByKind` 按 `DescriptorKind = "consort" | "heir"` 键控，而非 `CharacterKind`（heir 不属 CharacterKind）。这是对原建议类型的唯一调整。

---

## 6. 影响面

- 新：`src/ui/format/descriptors.ts`（`DescriptorConfig` 表 + `describe` + `directionOf`）。
- 改显示：`ResourcePanel`、`CharacterProfileDrawer`、`CharacterCard`、皇嗣面板组件。
- 无引擎/内容/存档改动。

## 7. 测试策略

- `describe`：分段边界（0/9→band0、10→band1、95/100→band9 clamp）；`labelsByKind` 命中（favor consort vs heir 取不同串）与回退（无 kind 用 labels）；未知 scale/缺表回退数字。
- `directionOf`：cruelty/corruption/clanDiscontent/rumor/clanPowerNation 返回 `lower_is_better`；其余 `higher_is_better`；未知 scale 缺省 `higher_is_better`。
- 每个 config：labels 或 labelsByKind 至少其一；命中的 label 数组恰 10 段、无空串。
- 负向 scale 高段词义为坏（抽样：cruelty[9] 含"杀"、corruption[9] 含"害"、clanPowerNation[9]="外戚专权"）。
- 映射完整性：每个被显示的数值属性都有 scale。
- UI 渲染与着色以手动验证为主。
