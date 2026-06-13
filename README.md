# 凤司晨（Si-Chen）

中文古风宫廷叙事模拟游戏。玩家是礼法女尊帝国的**女帝**，在江山、后宫、血脉三柱之间经营，与拥有**独立主观记忆**的角色对话。对话未来由 AI 生成、引擎管控；当前骨架阶段全部为脚本内容，但每一句台词都已经走 AI 同款管线。

> 世界观：`docs/background-v0.1.md` · 架构设计：`docs/DESIGN.md`（v2.2） · 骨架实现计划：`docs/skeleton-plan-v0.md`

**当前进度：骨架 PR 1–12 / 12 全部完成**（250 个 Vitest 用例 + 1 个 Playwright 冒烟流程全绿）。第一个垂直切片已按 `docs/skeleton-plan-v0.md` §13 验收清单走通。下一步是真实 AI 接入（适配器骨架已就位，见下文「对话文本门」）。

---

## 快速开始

要求 Node ≥ 20.19。

```bash
npm install        # 干净检出后直接可用
npm run dev        # http://localhost:5173 — 标题屏 → 新游戏
npm run build      # 产物在 dist/
npm run preview    # 预览构建产物
```

### 全部脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm test` | 跑全部单元/集成测试（Vitest，引擎无头运行，不需要浏览器） |
| `npm run test:watch` | 测试监听模式 |
| `npm run test:e2e` | Playwright 冒烟流程：对**生产构建**（`vite preview`）跑「新游戏→事件→选择→存档→刷新→继续→校验持久化」，顺带做构建产物 sanity。需要浏览器（`npx playwright install chromium`） |
| `npm run typecheck` | TypeScript strict 检查 |
| `npm run lint` | ESLint（只有一条规则：`src/engine/**` 禁止 import React/ui/store） |
| `npm run validate-content` | 校验 `content/` 全部 JSON（schema + 交叉引用 + 场景图），坏内容退出非零并列出**所有**错误 |
| `npm run validate-manifest` | 校验资产清单：路径存在、内容引用的 key 齐全且 kind 正确、孤儿文件告警、占位符比例报告 |
| `npm run gen-placeholders` | 按 manifest 生成占位 SVG（不会覆盖真实美术） |

CI（GitHub Actions）：`check` 作业按序跑 typecheck → lint → test → validate-content → validate-manifest → build；`e2e` 作业装 chromium 跑冒烟流程（失败上传 `playwright-report/`）。**每个 PR 的统一 DoD**：以上全绿 + main 始终可启动。

---

## 现在能玩到什么

新游戏开局：**元年一月上旬，行动点 5/5**，身处御书房。

- **三个地点**（宫城图点击移动，每次 1 行动点）：御书房 · 后宫主殿 · 御花园
- **三个角色**（各在自己的地点，卡片按身份分流渲染）：
  - 凤后（正宫，侍君卡：位分 + 恩宠）
  - 沈承徽（正三品侍君，测试失宠/情绪线）
  - 司礼女官（正五品女官，**官员卡：官职 + 圣眷**——架构反例，证明系统不默认人人是侍君）
- **三个脚本事件**（进入地点自动触发，once，对话式选择）：
  - 沈承徽被冷落（御花园，1 AP）— 测试关系变化 + 主观记忆写入
  - 凤后提醒宫规（后宫主殿，1 AP）— 测试后宫秩序资源
  - 司礼女官请示经血祭仪（御书房，1 AP 召对）— 测试血脉合法性 + flag。准奏与推迟都是「做出裁决」，各有后果且消耗召对时间；不想表态就点「离开」（免费）
- **时间系统**：行动点耗尽自动翻旬（上旬→中旬→下旬→次月→次年）；**行动点不足的事件显示禁用，绝不自动翻旬**
- **对话中途「离开」**：零代价——不扣行动点、不产生任何后果、once 不消耗（SceneSession 事务，提交才落账）
- **主观记忆**：同一事件按在场者各写各的记忆条目（措辞 POV 不同，不在场者什么也不写）；调试面板按角色浏览
- **存档/读档**：3 个手动槽 + 自动存档（auto/auto.prev 轮转，场景提交与移动后写）；JSON 导出/导入；损坏存档隔离恢复（详见下文）

### 对话文本门（PR 11，AI 同款管线已就位）

每句台词——无论 MockProvider 回显还是将来 LLM 生成——都过同一组**纯文本门**（`engine/dialogue/gates.ts`）：禁用词扫描、自称越位（用了别的位分的自称）、女帝称谓越位（一律「陛下」）、prompt 模板 token 泄漏。命中 reject 即拒绝该行，命中 flag 则照常呈现但标记 degraded；全部写入诊断日志。**数值/状态校验不在这里**，归效果漏斗（`engine/effects/`）——文本问题与状态问题由两层独立兜住。远程 provider 适配器**只有骨架**（类型 + `createRemoteProvider` 桩，永远返回 `NOT_CONFIGURED`，零网络零密钥，运行时不 import）。

---

## 怎么 Debug

**调试面板**：游戏内按反引号 `` ` `` 开关。提供：

- 当前日历/行动点实时显示 + 消耗 1/2 AP、重置状态按钮
- **合法/非法效果批**按钮：演示效果漏斗的原子提交与整批拒绝（显示最近一批的 applied/rejected 报告和错误标签）
- **强制触发事件**：无视触发条件直接开任意事件（验收用）
- **诊断日志**：环形缓冲里最近的 warn/error（文本门拒绝、存档失败、资产缺失……）+ **导出 Bug 包**（整个日志 JSON 下载）
- **按角色记忆浏览**：id/类型/显著度/年龄/标签/来源/protected + 全文
- ContentDB 摘要（内容版本、角色/地点/事件/场景/位分清单）
- 完整 GameState 实时 JSON dump（关系、好感、记忆、事件日志、flags 全部可见）

**内容坏了**：启动直接进错误屏，逐条列出文件、字段路径、原因（绝不静默带病运行）；命令行等价物是 `npm run validate-content`。

**资产缺了**：游戏不崩——表情缺失回落到该角色 neutral，再缺回落到内置剪影；每次回落记一条 `AssetError:ASSET_MISSING`（按 key 去重）。

**日志**：环形缓冲（500 条，dev 模式同时打到 console）。所有错误都是带稳定标签的类型化 `GameError`，可 grep：`ContentError:MISSING_REF`、`StateError:AP_INSUFFICIENT`、`AIError:WRONG_SPEAKER`……规则：玩家可见的每次降级恰好对应一条日志。

**诊断与世界史分离**：`EffectReport`（最近效果批）是给开发者的；`GameState.eventLog` 是玩家世界里真实发生过的事——被拒批次只进前者，永不进后者。

---

## 存档与读档（细节与刻意的取舍）

- **checksum 只是完整性/篡改检测，不是密码学安全、更不是防作弊。** 本地单机游戏没什么好防玩家改自己存档的；目的只是抓坏 JSON、手滑误改、写入截断。实现是同步的 64 位 FNV-1a（用 `crypto.subtle` 会把整条存档路径逼成 async），相对计划里的 sha-256 是有意偏差。
- **内容版本不一致分两档，绝不静默载入：**
  - **可载入但有风险**——存档引用的对象都还在，只是 `contentHash`/`contentVersion` 变了：弹**可见警告**（「存档内容版本（X）与当前（Y）不一致：可载入，但部分内容可能与存档时不同」）后照常载入。
  - **严重错误**——存档引用了当前内容里**已不存在**的对象（角色/地点/事件/场景 id）：**隔离**到 `sichen.corrupt.<时间戳>`（永不删除），不载入。
- **导入存档不会自动覆盖任何槽。** 导入文件先**校验 + 预览**（创建时间、内容版本、警告），再由玩家显式选择「写入 slot1/2/3」或「直接载入到当前游戏」；自动存档（auto/auto.prev）永远不被导入覆盖。
- **5 MB 上限目前只做监控，不要过早优化。** 每次写存档都记体积（切片 <100 KB）；在 `memory`/`sceneHistory` 真正膨胀之前，不引入压缩、diff 存档或 IndexedDB。

损坏恢复阶梯：解析/checksum/schema 失败 → 隔离当前 blob → 退回 `auto.prev` → 由 UI 提供更旧的槽 / 导出 / 新游戏。未来格式版本号 → **拒绝载入但不隔离**（绝不销毁更新的存档）。

---

## 美术资产

逻辑 **key** 在 `assets/manifest.json`，文件本体在 `public/assets/`，代码/内容只认 key。**当前已全部是真图**（`validate-manifest` 报 100% real art）；对话/地点是 galgame 式布局（背景铺满 + 立绘居中靠下 + 底部对话框），地图屏用皇宫俯视图作底图。

**立绘现在全员共用两张**（按身份分流）：所有侍君用 `portrait.consort.neutral`，女官用 `portrait.official.neutral`。

当前文件与对应 key：

```
public/assets/backgrounds/yushufang.png         bg.yushufang        御书房
public/assets/backgrounds/yuhuayuan.png         bg.yuhuayuan        御花园
public/assets/backgrounds/hougong_zhudian.png   bg.hougong_zhudian  后宫主殿
public/assets/portraits/consort/neutral.png     portrait.consort.neutral   侍君（凤后 / 沈承徽 共用）
public/assets/portraits/official/neutral.png    portrait.official.neutral  女官（司礼女官）
public/assets/map/palace.png                    map.palace          皇宫大地图（俯视）
```

**换图**：同名覆盖文件即可，key 不变。放完跑 `npm run validate-manifest`。
**立绘建议用竖图 + 透明背景 PNG**（约 2:3，如 640×960+）——当前两张是横图且不透明，会在场景上露出一块底；抠图竖图叠上去才贴合 galgame 风。
**想给某角色单独立绘或多表情**：把该角色 `portraitSet` 改成独有名（如 `feng_hou`）、在 `expressions` 里列出表情、在 manifest 加 `portrait.<set>.<表情>` 条目并放文件——场景里写 `expression: "smile"` 就会生效（缺图时自动回退 neutral，绝不崩）。

---

## 目录结构

```
content/                 # 数据即游戏 — 改这里不用动代码（严格 JSON，无注释）
│  ├── characters/ locations/ events/ scenes/
│  ├── lexicon.json      # 世界术语表 + 称谓/自称规则 + 禁用词
│  └── world.json        # 日历配置、位分表、起始状态与资源
assets/manifest.json     # 资产 key → 路径（key 是代码/内容唯一引用方式）
public/assets/           # 实际文件（占位 SVG，可被真实美术逐个替换）
src/
│  ├── engine/           # 框架无关 TS —— lint 强制不准 import React
│  │   ├── infra/        # Result、GameError、环形日志
│  │   ├── calendar/     # GameTime/CalendarState、旬月年翻转、中文格式化
│  │   ├── state/        # GameState、命令、reducer（原子批次）、新游戏构建
│  │   ├── content/      # Zod schemas + 收集全错的 ContentLoader（CLI 与浏览器共用）
│  │   ├── assets/       # AssetRegistry + 回退链（resolve 永不 throw）
│  │   ├── effects/      # ★ 效果漏斗 — 玩法状态唯一变更路径
│  │   ├── events/       # 条件 DSL、事件资格/优先级/冷却、事务化决议
│  │   ├── scenes/       # SceneRunner + SceneSession（预留/累积/提交/丢弃）
│  │   ├── characters/   # 出场规则（v0：默认地点）
│  │   ├── map/          # 旅行合法性 + 原子移动批次
│  │   ├── memory/       # 按角色记忆存储 + 追加/检视（v0 无检索/固化）
│  │   ├── save/         # 版本化 SaveData、槽、自动存档轮转、隔离恢复、导出/导入
│  │   └── dialogue/     # DialogueProvider 接口 + orchestrator + MockProvider
│  │       │              #   + gates.ts（文本门）+ providers/remoteProvider.ts（骨架桩）
│  ├── store/            # 引擎↔React 桥（50 行 emitter，无状态库）
│  └── ui/               # 屏幕（标题/地点/宫城图/对话/存档）、角色卡、调试面板
tools/                   # validate-content / validate-manifest / gen-placeholders（tsx）
tests/                   # Vitest 单元/集成（250 用例）+ tests/e2e Playwright 冒烟；出货的 content/ 本身就是 fixture
docs/                    # 世界观、DESIGN v2.2、骨架计划
```

---

## 架构核心规则（动代码前必读）

1. **单一效果漏斗**：关系/恩宠/资源/记忆/flag 只能经 `EventEffect[] → engine/effects/funnel → store.applyEffects/resolveEvent` 变更。整批原子：一个非法、全批拒绝、状态引用不变、订阅者不通知。数值钳制只在漏斗（单效果 ±10，批内同轴累计 ±10，结果 0–100）。
2. **SceneSession 事务**：入场只检查可负担并预留 AP；场景运行中 GameState 零接触；终端节点一次性提交（效果 + 扣 AP + 标记 fired + sceneHistory）；中途退出/刷新/崩溃 = 全部丢弃。`once` 只在提交时消耗。
3. **对话缝隙**：UI 只消费 `DialogueLine`，不认识场景节点；每句台词都走 `DialogueProvider`（现在是 MockProvider 回显，将来换 LLM 时引擎与 UI 零改动）。
4. **Scaffold 守卫**：三柱资源（圣威/民心/派系压力/和睦/妒意/宗嗣合法性/经血状态）可被效果修改、可在 debug 看、随存档走，但**不能**被触发条件/分支/未来的 prompt 读取——条件 DSL 结构上没有资源谓词。
5. **内容即数据**：加角色/地点/事件 = 加 JSON 文件；坏内容启动即死并报全错；引擎对剧情零硬编码。
6. **时间戳不带 AP**：记录用纯 `GameTime`（年/月/旬/行动日序号），实时钟 `CalendarState` 才有行动点。

## 还没有的东西（设计已留位，骨架故意不做）

真实 AI 接入（适配器/路由/评测见 DESIGN §5.7–5.8——文本门与 provider 骨架已就位，但零网络零密钥）、记忆检索/打分/固化、`generate` 动态场景、怀胎/承养机制（schema 占位于血脉柱）、派系模拟、动态 NPC↔NPC 关系、真实美术、音频、设置界面、本地化。
