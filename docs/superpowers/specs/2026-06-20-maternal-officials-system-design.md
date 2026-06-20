# 母家 / 官员系统 — 设计

日期：2026-06-20
范围：后台**朝臣名册**（轻量运行态实体）+ 侍君母家关联 + **家世 / 母家忠心 / 母家权势**由关联官员派生 + 改品级接口。
约束：发布前不做存档兼容迁移（见 memory `no-save-backcompat`）。trust/affinity 已在前一轮单独删除。
关联子项目：**属性形容词显示**是下一份 spec；本系统先把母家三项变成"活数据"，下一份再把它们（连同其它属性）渲染成形容词。

---

## 1. 背景与动机

此前侍君的 `attributes.family`（0–100 数字）、`hidden.clanLoyalty` / `hidden.clanPower`（静态数字）是孤立的死值。本系统把它们换成由一个**朝臣名册**派生的活值：

- 名册里每名朝臣有**官职 / 品级 / 姓名 / 忠心**，**权势**由品级派生，官职可升降。
- 与侍君**同姓**的朝臣即其**母家主**。侍君的**家世** = 母家主官职 + 侍君嫡庶/排行（如「从一品兵部尚书嫡次子」）；**母家权势** = 母家主权势；**母家忠心** = 母家主忠心。

---

## 2. 实体模型

### 2.1 Official（朝臣名册条目，运行态）

`GameState` 新增 `officials: Record<string, Official>`，存档持久化。

```ts
interface Official {
  id: string;        // "official_000001" 单调；母家主可用 "official_<姓拼音>" 便于定位
  surname: string;   // 姓（母家主 = 侍君姓）
  givenName: string; // 名（1–2 字）
  postId: string;    // 指向官职表
  loyalty: number;   // 忠心 0–100
}
```

- **权势不落字段**：由 `postId → 品级 → 权势` 纯函数派生，保证升降职后权势自动跟随。
- **忠心独立存储**：人各有志；且日后事件可增减（v1 不接事件触发，仅留 changeLoyalty 备用，见 §6 YAGNI）。

### 2.2 OfficialPost（官职表，静态内容）

新增 `content/officials/posts.json`（loader 校验进 `ContentDB.officialPosts`）。

```ts
interface OfficialPost {
  id: string;         // "bingbu_shangshu"
  name: string;       // "兵部尚书"
  grade: string;      // "从一品"
  gradeOrder: number; // 1..18（正一品=18 … 从九品=1）；平民=0
}
```

**官职表（草案，覆盖正一品→从九品 + 平民）：**
| id                   | name  | grade | gradeOrder | category |
| -------------------- | ----- | ----- | ---------: | -------- |
| chengxiang           | 丞相    | 正一品   |         18 | 中枢       |
| taifu                | 太傅    | 从一品   |         17 | 皇室辅教     |
| taibao               | 太保    | 从一品   |         17 | 皇室辅弼     |
| dadudu               | 大都督   | 从一品   |         17 | 军职       |
| yushi_dafu           | 御史大夫  | 正二品   |         16 | 监察       |
| zuo_cheng            | 左丞    | 正二品   |         16 | 中枢       |
| you_cheng            | 右丞    | 正二品   |         16 | 中枢       |
| libu_shangshu        | 吏部尚书  | 从二品   |         15 | 六部       |
| hubu_shangshu        | 户部尚书  | 从二品   |         15 | 六部       |
| libu2_shangshu       | 礼部尚书  | 从二品   |         15 | 六部       |
| bingbu_shangshu      | 兵部尚书  | 从二品   |         15 | 六部       |
| xingbu_shangshu      | 刑部尚书  | 从二品   |         15 | 六部       |
| gongbu_shangshu      | 工部尚书  | 从二品   |         15 | 六部       |
| zongzheng_si_zheng   | 宗正寺正  | 正三品   |         14 | 宗室       |
| dali_si_zheng        | 大理寺正  | 正三品   |         14 | 司法       |
| taichang_si_zheng    | 太常寺正  | 正三品   |         14 | 礼祭       |
| guozijian_jijiu      | 国子监祭酒 | 正三品   |         14 | 教育       |
| zhihui_shi           | 指挥使   | 正三品   |         14 | 军职       |
| buzhengshi           | 布政使   | 从三品   |         13 | 地方       |
| anchashi             | 按察使   | 从三品   |         13 | 地方监察     |
| duzhihui_tongzhi     | 都指挥同知 | 从三品   |         13 | 军职       |
| liubu_fu_shangshu    | 六部副尚书 | 正四品   |         12 | 六部       |
| dali_si_fuzheng      | 大理寺副正 | 正四品   |         12 | 司法       |
| taichang_si_fuzheng  | 太常寺副正 | 正四品   |         12 | 礼祭       |
| zongzheng_si_fuzheng | 宗正寺副正 | 正四品   |         12 | 宗室       |
| zhifu                | 知府    | 从四品   |         11 | 地方       |
| yushi_zhongcheng     | 御史中丞  | 从四品   |         11 | 监察       |
| bushi_zheng          | 部司正   | 正五品   |         10 | 六部       |
| tongzhi              | 同知    | 正五品   |         10 | 地方       |
| qianhu               | 千户    | 正五品   |         10 | 军职       |
| bushi_fuzheng        | 部司副正  | 从五品   |          9 | 六部       |
| zhizhou              | 知州    | 从五品   |          9 | 地方       |
| baihu                | 百户    | 从五品   |          9 | 军职       |
| tongpan              | 通判    | 正六品   |          8 | 地方       |
| siye                 | 司业    | 正六品   |          8 | 教育       |
| zhushi               | 主事    | 从六品   |          7 | 六部       |
| xiancheng            | 县丞    | 从六品   |          7 | 地方       |
| zhixian              | 知县    | 正七品   |          6 | 地方       |
| boshi                | 博士    | 正七品   |          6 | 教育       |
| dianbu               | 典簿    | 从七品   |          5 | 文书       |
| jingli               | 经历    | 从七品   |          5 | 文书       |
| xunjian              | 巡检    | 正八品   |          4 | 地方治安     |
| xuezheng             | 学正    | 正八品   |          4 | 教育       |
| zhaomo               | 照磨    | 从八品   |          3 | 文书       |
| xundao               | 训导    | 从八品   |          3 | 教育       |
| zhubo                | 主簿    | 正九品   |          2 | 地方文书     |
| dianshi              | 典史    | 从九品   |          1 | 地方治安     |
| commoner             | 平民    | 无     |          0 | 身份       |

本朝以女子入仕掌政，“郎”“卿”等字多用于男眷、内宅与亲昵称谓，朝廷官职避用，改以“正”“副正”“副尚书”等称。

> 表可在评审时增删；id 为稳定键，gradeOrder 单调对应品级高低。

### 2.3 品级 → 权势

纯函数，权势随品级单调、同品略有人差（确定性，按 official id 派生，稳定不随读取变化）：

```
power(post, id) = clamp( round(gradeOrder / 18 * 92) + 5 + jitter(id), 0, 100 )
// jitter(id) ∈ [-3, +3]，由 id 哈希确定性给出；平民 gradeOrder 0 → ~5
```

例：正一品(18)→~97、从一品(17)→~92、正三品(14)→~76、正四品(12)→~66、正七品(6)→~36、平民→~5。

---

## 3. 侍君关联与派生

### 3.1 侍君内容新增字段（手写，consort-only，可选）

`characterSchema` 增（zod optional）：

```ts
maternalClan?: {
  postId: string;      // 母家主官职（决定家世前缀「从一品兵部尚书」）
  legitimate: boolean; // 嫡=true / 庶=false
  birthOrder: number;  // 1=长 2=次 3=三 …（≥1）
}
```

- `surname` 已有（徐清欢→徐）。
- 无 `maternalClan` 的侍君 → 家世「平民之子」，母家权势/忠心取默认（见 §3.3）。
- **移除**侍君的 `attributes.family`（数字）与 `hidden.clanLoyalty` / `hidden.clanPower`（数字）——改为派生（无存档兼容包袱）。其余 hidden（情意/恐惧/野心）保留。

### 3.2 母家主约定

**每个姓至多一名母家主**；同姓的多名侍君共享同一母家主（视作一族）。母家主的 `postId` 来自该姓某名侍君的 `maternalClan.postId`（约定同姓侍君填一致的 postId；loader 校验冲突）。

> **暂时设定**：一姓一母家主是 v1 的简化，后期可能改为一姓多家/各侍君独立母家，届时再调整派生（§3.3）与生成（§4）。

> **命名规则**：官职名称避用「郎」「卿」等多指男性/男眷的字（本朝女子掌政，此类字属内宅与亲昵称谓），改以「正」「副正」「副尚书」等中性称。见全局记忆。

### 3.3 派生函数（纯函数，查询/显示用）

`src/engine/officials/derive.ts`：

```ts
maternalHead(state, consort): Official | undefined   // officials 中 surname === consort.surname
familyText(db, state, consort): string               // 家世文本
maternalPower(db, state, consort): number            // 母家权势（无母家主 → 0）
maternalLoyalty(state, consort): number              // 母家忠心（无母家主 → 0）
```

- **家世文本** = `{grade}{postName}{嫡|庶}{排行字}子`，排行字：1→长 2→次 3→三 4→四 …（数字→中文）。
  例：post=兵部尚书(从一品) + maternalClan{嫡, 次} → 「从一品兵部尚书嫡次子」。
  无 maternalClan 或母家主为平民 → 「平民之子」。
- **母家权势** = `power(母家主.post, 母家主.id)`。
- **母家忠心** = `母家主.loyalty`。

---

## 4. 名册生成（新游戏，种子确定）

`generateOfficials(db, rngSeed): Record<string, Official>`，在 `createNewGameState` 内调用，结果进 `state.officials`：

1. **母家主**：收集所有有 `surname` + `maternalClan` 的侍君，按姓去重。每个姓建一名 Official：
   - `surname` = 该姓；`postId` = 侍君 `maternalClan.postId`（同姓取一致值）；
   - `givenName` = 按种子从名池取（`given(rngSeed, surname)`）；
   - `loyalty` = 按种子随机 0–100（`gestationRoll(\`loyal:${rngSeed}:${surname}\`)`）；
   - `id` = `official_<姓>`。
2. **无关联官员**：再生成 K 名（草案 **8** 名）填充朝堂：随机姓（避开已用姓）+ 随机 postId + 随机 loyalty，`id` = `official_000001..`。
3. 全程确定性：同 `rngSeed` 同结果。

命名池：姓氏池（约 20 个常见姓）+ 名池（约 30 个双字名）置于 `src/engine/officials/namePool.ts`。
```ts
export const OFFICIAL_SURNAME_POOL: readonly string[] = [
  "王", "谢", "崔", "卢", "郑", "裴", "韦", "柳",
  "沈", "顾", "陆", "萧", "薛", "杜", "苏", "宋",
  "温", "秦", "江", "许", "徐", "韩", "杨", "周",
  "程", "林", "叶", "白", "孟", "方", "纪", "贺",
  "陶", "卫", "霍", "钟", "颜", "虞", "傅", "乔",
  "姜", "殷", "姚", "范", "欧", "邵", "赵", "陈",
  "司马", "上官", "欧阳", "诸葛", "长孙", "宇文",
  "皇甫", "公孙", "夏侯", "尉迟", "闻人", "钟离",
];

export const OFFICIAL_SINGLE_GIVEN_NAME_POOL: readonly string[] = [
  "衡", "珩", "璋", "琰", "瑾", "琛", "琮", "珣",
  "晏", "昭", "晟", "曜", "昶", "昀", "晖", "景",
  "澄", "清", "泓", "渊", "洵", "济", "源", "川",
  "岳", "岑", "岱", "嵘", "峤", "岩", "岫", "嶷",
  "章", "文", "策", "谟", "论", "史", "典", "礼",
  "恪", "谨", "慎", "肃", "端", "正", "直", "贞",
  "仁", "义", "信", "忠", "恕", "诚", "敬", "恭",
  "宣", "宪", "纲", "纪", "度", "则", "法", "律",
  "远", "达", "通", "明", "哲", "睿", "敏", "识",
  "略", "韬", "钧", "铎", "锋", "锐", "镇", "铮",
];

export const OFFICIAL_DOUBLE_GIVEN_NAME_POOL: readonly string[] = [
  // 经世治国
  "安石", "居正", "守仁", "守义", "守礼", "守信", "守正", "守成",
  "经邦", "济世", "治平", "安国", "定国", "辅国", "靖国", "兴国",
  "怀政", "秉政", "修政", "明政", "正则", "正言", "正度", "正己",
  "克明", "克勤", "克俭", "克己", "允中", "允正", "允文", "允执",
  "弘道", "弘文", "弘济", "弘毅", "弘正", "弘礼", "弘章", "弘业",

  // 刚正持重
  "端方", "端谨", "端肃", "端正", "端直", "端明", "端衡", "端礼",
  "秉直", "秉正", "秉公", "秉义", "秉忠", "秉信", "秉节", "秉钧",
  "怀忠", "怀义", "怀信", "怀正", "怀远", "怀德", "怀章", "怀朔",
  "敬之", "敬德", "敬义", "敬文", "敬礼", "敬直", "敬臣", "敬修",
  "慎行", "慎言", "慎独", "慎微", "慎思", "慎明", "慎正", "慎之",

  // 文臣书香
  "文正", "文忠", "文肃", "文简", "文清", "文衡", "文渊", "文远",
  "书衡", "书正", "书远", "书明", "书策", "书章", "书礼", "书臣",
  "清献", "清端", "清正", "清慎", "清直", "清议", "清源", "清衡",
  "明允", "明道", "明礼", "明章", "明远", "明哲", "明识", "明鉴",
  "知远", "知礼", "知章", "知衡", "知政", "知言", "知微", "知常",

  // 谋略与识断
  "玄龄", "如晦", "长孙", "景略", "知节", "元凯", "伯言", "公瑾",
  "思远", "思齐", "思衡", "思政", "思明", "思略", "思危", "思慎",
  "观澜", "观政", "观衡", "观远", "观明", "观礼", "观复", "观止",
  "见深", "见微", "见远", "见明", "见素", "见真", "见衡", "见章",
  "识远", "识微", "识明", "识礼", "识政", "识衡", "识人", "识时",

  // 军政武职
  "靖远", "定远", "镇远", "平远", "怀远", "安远", "威远", "宣威",
  "镇国", "镇军", "镇北", "镇南", "靖边", "定边", "安边", "平戎",
  "怀武", "秉武", "修武", "尚武", "昭武", "宣武", "毅武", "端武",
  "军衡", "军略", "军策", "军正", "军宁", "军昭", "军远", "军肃",
  "铁衣", "长锋", "锐安", "承锋", "怀钧", "秉钧", "昭钧", "靖钧",

  // 清贵台阁
  "令则", "令章", "令闻", "令德", "令正", "令肃", "令衡", "令仪",
  "景衡", "景正", "景明", "景肃", "景文", "景略", "景章", "景安",
  "昭衡", "昭正", "昭明", "昭肃", "昭文", "昭远", "昭章", "昭礼",
  "元衡", "元正", "元明", "元礼", "元章", "元德", "元靖", "元安",
  "承衡", "承正", "承礼", "承章", "承明", "承德", "承远", "承安",

  // 古朴官名气质
  "仲淹", "仲舒", "仲谋", "仲达", "仲宣", "仲衡", "仲正", "仲文",
  "伯安", "伯言", "伯衡", "伯正", "伯远", "伯礼", "伯明", "伯章",
  "季真", "季衡", "季明", "季正", "季安", "季礼", "季远", "季文",
  "叔度", "叔衡", "叔正", "叔明", "叔文", "叔安", "叔礼", "叔远",
  "子厚", "子瞻", "子由", "子美", "子正", "子衡", "子明", "子远",
];
```



---

## 5. 改品级接口

`changeOfficialGrade(state, officialId, newPostId): GameState`（纯函数，返回新 state）：改 `postId`；权势因派生自动跟随。v1 仅提供函数 + store action，**不接自动触发**（升降由日后事件/上朝调用）。

---

## 6. 范围与 YAGNI

- v1 **不做**：自动升降职触发、官员对话/立绘、上朝名册 UI、changeLoyalty 事件接线。
- v1 **做**：名册实体 + 官职表 + 品级→权势 + 侍君 maternalClan 手写 + 派生（家世/母家权势/母家忠心）+ 种子生成 + changeGrade 接口 + 把 CharacterProfileDrawer 的家世/母家两项改读派生。
- **显示形态**（数字 vs 形容词）不在本 spec——家世先显示派生文本，母家权势/忠心先显示派生数字；形容词化是下一份 spec。

---

## 7. 影响面

- 新增：`content/officials/posts.json`、`src/engine/officials/{derive,namePool,generate}.ts`、`changeOfficialGrade`。
- 改 schema：character 增 `maternalClan`、删 `attributes.family` / `hidden.clanLoyalty` / `hidden.clanPower`；新增 `officialPostSchema` + loader 装载校验（postId 引用、同姓 postId 一致）。
- 改 state：`GameState.officials` + stateSchema + newGame 生成 + initialState 空对象。
- 改内容：所有侍君文件——删 family/clanLoyalty/clanPower，加 maternalClan（按人设手写官职/嫡庶/排行）。
- 改 UI：`CharacterProfileDrawer` 的「家世」「母家忠心」「母家权势」改读派生函数。

---

## 8. 测试策略

- **官职表**：每条 gradeOrder 与 grade 自洽；id 唯一；平民 gradeOrder 0。
- **power**：随 gradeOrder 单调；同 id 稳定；范围 0–100。
- **generateOfficials**：同种子同结果（确定性）；每个"有 maternalClan 的姓"恰有一名母家主且 postId 与侍君一致；无关联官员数 = K。
- **派生**：徐清欢（maternalClan{bingbu_shangshu, 嫡, 次}）→ 家世「从一品兵部尚书嫡次子」；母家权势 = 母家主 power；母家忠心 = 母家主 loyalty；无 maternalClan → 「平民之子」、母家权势/忠心 0。
- **changeGrade**：改 postId 后 power 重算、loyalty 不变。
- **loader**：posts.json 校验；同姓侍君 postId 冲突报错；maternalClan.postId 引用未知官职报错。
- 其余 UI 手动验证。
