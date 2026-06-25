# 官员能力与铨选评分（Phase 3 · PR3C-1）

为在任官员建模**静态能力 `aptitude`** 与**动态履历 `reviewState`**，并提供**家族势力 `familyBacking`** 与
**升迁评分 `promotionScore`**。本 PR **纯数据/引擎，确定性，不发生任何职位变化、不改 UI、不做 PUNISH**。
年度考课与自动升降（PR3C-2）、人事事件与官员 PUNISH（PR3C-3）在此之上。

## 一、官员新增两组数据

```ts
Official.aptitude: OfficialAptitude   // = CandidateAptitude：governance/scholarship/military/integrity
Official.reviewState: OfficialReviewState // merit(0–100,初始 50) / lastReviewedYear? / underperformanceYears
```

- **候补授官转正**：`aptitude` 原样继承候补四维能力（不另造第二套属性）；`reviewState` 取初值。
- **开局/现有官员**：`deriveOfficialAptitude(officialId, rngSeed)` 按稳定 seed **一次性确定性回填**（与候补
  同范围 20–95），物化入档；**读档绝不重算**（值已存于 `Official.aptitude`）。
- 旧档迁移 `SAVE_FORMAT_VERSION` 13→14：回填优先级 **已有值 → 候补出身者继承其候补能力（v13 已含 PR3B
  授官记录，须保持同一人能力一致）→ 否则稳定 seed 派生**；reviewState 取初值。

## 二、年资

衡量的是**当前在任官职**的任职年资，故仅 `status==="active"` 且确占官职（`postId` 非空）才计；无职/退休/
下狱/流放一律 0（这些状态下 `appointedAt` 仍保留「最近一次任职」时刻，不应继续累计）。`seniorityScore`
归一化 0–100（`SENIORITY_FULL_YEARS=10` 年计满）。

## 三、家族势力 `familyBacking`（0–100，实时派生，不复制进官员字段）

```
consortScore  = haremRankScore*0.60 + favorScore*0.40
consortBacking= top1*0.75 + top2*0.25              // 同族只取贡献最大两名侍君，次者明显衰减
familyBacking = influence*0.55 + imperialFavor*0.15 + consortBacking*0.30
```

`haremRankScore` 按**位分序位**归一化（`idx/(n−1)*100`）而非直接除 order——content 的 order 非等距（凤后
order=1000 是礼制特殊值，直接除会把其余位分压扁到 <20）；最低位≈0、中位≈50、最高位=100，保留相对排序，
集中实现供他系统复用。只认明确 `familyId`/`birthFamilyId`，**不靠同姓猜测亲缘**；排除 `deceased`；无侍君则
`consortBacking=0`。

## 四、升迁评分 `promotionScore`（0–100，确定性，纯函数）

```
g = clamp((targetGradeOrder − 1)/17, 0, 1)
promotionScore =
  postFit       * (0.25 + 0.10g) +   // postFit 复用 PR3B candidatePostFit（官员 aptitude × 目标部门）
  merit         * (0.20 + 0.15g) +
  seniority     * (0.40 − 0.35g) +
  loyalty       * 0.10 +
  familyBacking * (0.05 + 0.10g)
```

各项权重之和在 g 两端恒为 1（全满输入 → 100、全零 → 0）。**低品循资迁转、高位熬年资几乎无用**，能力/
政绩/家世在高品权重显著上升。PR3C-1 只计算评分，**不据此发生任何任免**。

## 五、校验与存档

`validateOfficialWorld` 新增：`aptitude` 四维 0–100、`reviewState.merit` 0–100、`underperformanceYears ≥ 0`。
所有 `Official` 构造点（worldgen / 授官）均落两字段；schema `officialSchema` 同步。`MIGRATIONS[13]` 确定性
回填。

## 六、测试

worldgen 官员带确定性 aptitude/初值 reviewState；`deriveOfficialAptitude` 稳定且 20–95；授官继承候补
能力；年资计算；`familyBacking`（top-2 同族、影响/恩宠权重、无侍君=0、不跨族不猜姓）；`promotionScore`
（g 加权两端和为 1 → 全满 100/全零 0、低品年资主导 vs 高品能力主导、确定性、无副作用）；validator 越界；
save round-trip + v13→v14 迁移（确定性回填 + 不覆盖既有值）。

## 七、不在本 PR（留 PR3C-2 / 3C-3）

任何职位变化、年度考课推进、自动升迁/降级、`resolveOfficialVacancies` 连锁补缺、人事事件、官员 PUNISH、
关闭玩家自由调任入口、UI。

> 硬约束（贯穿 PR3C）：自动考课升降属**行政制度结果**（`authority: "system_review"`），不进 PUNISH；
> **皇帝亲自下令的降职/降品/免官/褫夺权力**都算惩罚，必须进入既有 PUNISH consequence，绝不新建绕过路径。
