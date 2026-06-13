# 凤司晨（Si-Chen）

中文古风宫廷叙事模拟游戏。玩家是礼法女尊帝国的**女帝**，在江山、后宫、血脉三柱之间经营，与拥有**独立主观记忆**的角色对话。对话未来由 AI 生成、引擎管控；当前骨架阶段全部为脚本内容，但每一句台词都已经走 AI 同款管线。

> 世界观：`docs/background-v0.1.md` · 架构设计：`docs/DESIGN.md`（v2.2） · 骨架实现计划：`docs/skeleton-plan-v0.md`

**当前进度：骨架 PR 1–8 / 12 已完成**（208 个测试全绿）。剩余：PR 9 记忆调试浏览器、PR 10 存档、PR 11 对话文本门、PR 12 验收打磨。

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
| `npm test` | 跑全部测试（Vitest，引擎无头运行，不需要浏览器） |
| `npm run test:watch` | 测试监听模式 |
| `npm run typecheck` | TypeScript strict 检查 |
| `npm run lint` | ESLint（只有一条规则：`src/engine/**` 禁止 import React/ui/store） |
| `npm run validate-content` | 校验 `content/` 全部 JSON（schema + 交叉引用 + 场景图），坏内容退出非零并列出**所有**错误 |
| `npm run validate-manifest` | 校验资产清单：路径存在、内容引用的 key 齐全且 kind 正确、孤儿文件告警、占位符比例报告 |
| `npm run gen-placeholders` | 按 manifest 生成占位 SVG（不会覆盖真实美术） |

CI（GitHub Actions）按序跑：typecheck → lint → test → validate-content → validate-manifest → build。**每个 PR 的统一 DoD**：以上全绿 + main 始终可启动。

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

---

## 怎么 Debug

**调试面板**：游戏内按反引号 `` ` `` 开关。提供：

- 当前日历/行动点实时显示 + 消耗 1/2 AP、重置状态按钮
- **合法/非法效果批**按钮：演示效果漏斗的原子提交与整批拒绝（显示最近一批的 applied/rejected 报告和错误标签）
- ContentDB 摘要（内容版本、角色/地点/事件/场景/位分清单）
- 完整 GameState 实时 JSON dump（关系、好感、记忆、事件日志、flags 全部可见）

**内容坏了**：启动直接进错误屏，逐条列出文件、字段路径、原因（绝不静默带病运行）；命令行等价物是 `npm run validate-content`。

**资产缺了**：游戏不崩——表情缺失回落到该角色 neutral，再缺回落到内置剪影；每次回落记一条 `AssetError:ASSET_MISSING`（按 key 去重）。

**日志**：环形缓冲（500 条，dev 模式同时打到 console）。所有错误都是带稳定标签的类型化 `GameError`，可 grep：`ContentError:MISSING_REF`、`StateError:AP_INSUFFICIENT`、`AIError:WRONG_SPEAKER`……规则：玩家可见的每次降级恰好对应一条日志。

**诊断与世界史分离**：`EffectReport`（最近效果批）是给开发者的；`GameState.eventLog` 是玩家世界里真实发生过的事——被拒批次只进前者，永不进后者。

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
│  │   └── dialogue/     # DialogueProvider 接口 + orchestrator + MockProvider
│  ├── store/            # 引擎↔React 桥（50 行 emitter，无状态库）
│  └── ui/               # 屏幕（标题/地点/宫城图/对话）、角色卡、调试面板
tools/                   # validate-content / validate-manifest / gen-placeholders（tsx）
tests/                   # Vitest，23 个文件 208 个用例；出货的 content/ 本身就是 fixture
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

真实 AI 接入（适配器/路由/评测见 DESIGN §5.7–5.8）、记忆检索与固化、存档（PR 10）、怀胎/承养机制（schema 占位于血脉柱）、派系模拟、动态 NPC↔NPC 关系、真实美术、音频。
