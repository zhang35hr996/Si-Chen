/**
 * 国库台账领域层（Phase 4B Task 1）。
 *
 * 提供原子借贷事务 `applyTreasuryTransaction` 和完整性校验 `validateTreasuryLedger`。
 * 纯函数——不触碰 store、不发事件、不操作 React。输入 state 永不变更（spread 构造新对象）。
 */
import { compareGameTime, type GameTime } from "../calendar/time";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState, TreasuryLedgerEntry } from "../state/types";

// ── ID 生成 ────────────────────────────────────────────────────────────────────

/** "tre_000001" 格式序列号。 */
export function ledgerEntryId(seq: number): string {
  return `tre_${String(seq).padStart(6, "0")}`;
}

/** 扫描现有条目最大序号 +1（忽略格式非法条目，杜绝稀疏键覆盖）。 */
export function nextLedgerEntryId(state: GameState): string {
  let maxSeq = 0;
  for (const entry of state.treasuryLedger) {
    const m = /^tre_(\d{6})$/.exec(entry.id);
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  }
  return ledgerEntryId(maxSeq + 1);
}

// ── 事务命令 ───────────────────────────────────────────────────────────────────

export interface TreasuryTransactionCommand {
  delta: number;
  at: GameTime;
  source:
    | { kind: "memorial"; memorialId: string; optionId: string }
    | { kind: "shop_purchase"; itemId: string }
    | { kind: "system"; reasonCode: string };
  reason: string;
}

// ── 原子事务 ───────────────────────────────────────────────────────────────────

/**
 * 原子国库借贷事务。验证顺序：
 * 1. delta 非零安全整数 → TREASURY_BAD_DELTA
 * 2. balanceBefore 非负安全整数 → TREASURY_INVALID_BALANCE
 * 3. balanceAfter >= 0 → TREASURY_INSUFFICIENT
 * 4. balanceAfter 为安全整数 → TREASURY_OVERFLOW
 *
 * 成功后返回新 state（含更新的 treasury 和追加的台账条目）；失败时输入 state 不变。
 */
export function applyTreasuryTransaction(
  state: GameState,
  command: TreasuryTransactionCommand,
): Result<{ state: GameState; entry: TreasuryLedgerEntry }, GameError> {
  // 1. delta 校验
  if (!Number.isSafeInteger(command.delta) || command.delta === 0) {
    return err(stateError("TREASURY_BAD_DELTA", `delta 必须为非零安全整数，当前值：${command.delta}`, {
      context: { delta: command.delta },
    }));
  }

  // 2. balanceBefore 校验
  const balanceBefore = state.resources.nation.treasury;
  if (!Number.isSafeInteger(balanceBefore) || balanceBefore < 0) {
    return err(stateError("TREASURY_INVALID_BALANCE", `国库余额不合法：${balanceBefore}`, {
      context: { balanceBefore },
    }));
  }

  // 3. 余额充足性校验
  const balanceAfter = balanceBefore + command.delta;
  if (balanceAfter < 0) {
    return err(stateError("TREASURY_INSUFFICIENT", `国库余额不足：需 ${-command.delta}，现有 ${balanceBefore}`, {
      context: { balanceBefore, delta: command.delta, balanceAfter },
    }));
  }

  // 4. 溢出校验
  if (!Number.isSafeInteger(balanceAfter)) {
    return err(stateError("TREASURY_OVERFLOW", `国库余额溢出：${balanceBefore} + ${command.delta} = ${balanceAfter}`, {
      context: { balanceBefore, delta: command.delta, balanceAfter },
    }));
  }

  // 构造台账条目
  const entry: TreasuryLedgerEntry = {
    id: nextLedgerEntryId(state),
    at: command.at,
    delta: command.delta,
    balanceBefore,
    balanceAfter,
    source: command.source,
    reason: command.reason,
  };

  // 构造新 state（spread，绝不变更入参）
  const newState: GameState = {
    ...state,
    resources: {
      ...state.resources,
      nation: {
        ...state.resources.nation,
        treasury: balanceAfter,
      },
    },
    treasuryLedger: [...state.treasuryLedger, entry],
  };

  return ok({ state: newState, entry });
}

// ── 完整性校验 ─────────────────────────────────────────────────────────────────

/**
 * 校验整个台账的持久不变量，返回所有发现的 GameError。
 * 供存档加载路径（saveSystem.ts）调用；纯函数，不修改 state。
 *
 * 注：checks 12/16/17（option.treasuryDelta 跨引用）在 Task 2 后补充。
 */
export function validateTreasuryLedger(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));

  const ledger = state.treasuryLedger;

  const seenIds = new Set<string>();
  const seenSourceMemorials = new Set<string>();

  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i]!;

    // 1. ID 格式
    if (!/^tre_\d{6}$/.test(entry.id)) {
      e("TREASURY_LEDGER_DUP_ID", `台账条目 ID 格式无效或重复「${entry.id}」`, { id: entry.id, index: i });
    }

    // 2. ID 唯一性
    if (seenIds.has(entry.id)) {
      e("TREASURY_LEDGER_DUP_ID", `台账条目 id 重复：「${entry.id}」`, { id: entry.id, index: i });
    }
    seenIds.add(entry.id);

    // 3. delta 非零安全整数
    if (!Number.isSafeInteger(entry.delta) || entry.delta === 0) {
      e("TREASURY_LEDGER_BAD_AMOUNT", `台账条目「${entry.id}」delta 非法：${entry.delta}`, { id: entry.id, delta: entry.delta });
    }

    // 4. balanceBefore / balanceAfter 非负安全整数
    if (!Number.isSafeInteger(entry.balanceBefore) || entry.balanceBefore < 0 ||
        !Number.isSafeInteger(entry.balanceAfter) || entry.balanceAfter < 0) {
      e("TREASURY_LEDGER_BAD_BALANCE", `台账条目「${entry.id}」balanceBefore/After 不合法`, {
        id: entry.id, balanceBefore: entry.balanceBefore, balanceAfter: entry.balanceAfter,
      });
    }

    // 5. balanceAfter === balanceBefore + delta
    if (entry.balanceAfter !== entry.balanceBefore + entry.delta) {
      e("TREASURY_LEDGER_BAD_BALANCE", `台账条目「${entry.id}」余额等式不成立：${entry.balanceBefore} + ${entry.delta} ≠ ${entry.balanceAfter}`, {
        id: entry.id, balanceBefore: entry.balanceBefore, delta: entry.delta, balanceAfter: entry.balanceAfter,
      });
    }

    // 6. 相邻链接：prev.balanceAfter === cur.balanceBefore
    if (i > 0) {
      const prev = ledger[i - 1]!;
      if (prev.balanceAfter !== entry.balanceBefore) {
        e("TREASURY_LEDGER_CHAIN_BROKEN", `台账链断裂：条目「${prev.id}」balanceAfter(${prev.balanceAfter}) ≠ 「${entry.id}」balanceBefore(${entry.balanceBefore})`, {
          prevId: prev.id, curId: entry.id, prevBalanceAfter: prev.balanceAfter, curBalanceBefore: entry.balanceBefore,
        });
      }
    }

    // 7. at non-decreasing
    if (i > 0) {
      const prev = ledger[i - 1]!;
      if (compareGameTime(entry.at, prev.at) < 0) {
        e("TREASURY_LEDGER_CHAIN_BROKEN", `台账第 ${i} 条 at 早于第 ${i - 1} 条`, { id: entry.id });
      }
    }

    // 8–13. 奏折来源专属校验（shop_purchase / system 条目跳过）
    if (entry.source.kind === "memorial") {
      // 提取到局部常量，使 TypeScript 在回调中也能保持类型窄化
      const src = entry.source;

      // 8. source memorial 存在
      const memorial = state.memorials[src.memorialId];
      if (!memorial) {
        e("TREASURY_LEDGER_BAD_SOURCE", `台账条目「${entry.id}」来源奏折「${src.memorialId}」不存在`, {
          id: entry.id, memorialId: src.memorialId,
        });
        // 后续依赖 memorial 的检查无法继续
        continue;
      }

      // 9. source option 存在于该奏折
      const optionExists = memorial.payload.options.some((o) => o.id === src.optionId);
      if (!optionExists) {
        e("TREASURY_LEDGER_BAD_SOURCE", `台账条目「${entry.id}」来源选项「${src.optionId}」不属于奏折「${src.memorialId}」`, {
          id: entry.id, memorialId: src.memorialId, optionId: src.optionId,
        });
      }

      // 10. 奏折已 resolved
      if (memorial.status !== "resolved") {
        e("TREASURY_LEDGER_SOURCE_PENDING", `台账条目「${entry.id}」来源奏折「${src.memorialId}」仍为 pending`, {
          id: entry.id, memorialId: src.memorialId, status: memorial.status,
        });
      }

      // 11. memorial.resolution === source.optionId
      if (memorial.status === "resolved" && memorial.resolution !== src.optionId) {
        e("TREASURY_LEDGER_OPTION_MISMATCH", `台账条目「${entry.id}」optionId「${src.optionId}」与奏折裁断「${memorial.resolution}」不符`, {
          id: entry.id, memorialId: src.memorialId, ledgerOptionId: src.optionId, resolution: memorial.resolution,
        });
      }

      // 12. option.treasuryDelta 与台账 delta 一致；无成本选项不应产生台账条目（P1-B）
      const matchedOption = memorial.payload.options.find((o) => o.id === src.optionId);
      if (matchedOption !== undefined && matchedOption.treasuryDelta === undefined) {
        e("TREASURY_LEDGER_OPTION_MISMATCH", `奏折「${src.memorialId}」选项「${src.optionId}」无国库影响，不应有台账条目`, { id: entry.id });
      }
      if (matchedOption?.treasuryDelta !== undefined && matchedOption.treasuryDelta !== entry.delta) {
        e("TREASURY_LEDGER_OPTION_MISMATCH", `台账条目「${entry.id}」delta(${entry.delta})与选项「${src.optionId}」treasuryDelta(${matchedOption.treasuryDelta})不一致`, {
          id: entry.id, optionId: src.optionId, ledgerDelta: entry.delta, optionDelta: matchedOption.treasuryDelta,
        });
      }

      // 13. 每个奏折至多一条台账
      if (seenSourceMemorials.has(src.memorialId)) {
        e("TREASURY_LEDGER_DUP_SOURCE", `奏折「${src.memorialId}」产生了多条台账条目`, {
          id: entry.id, memorialId: src.memorialId,
        });
      }
      seenSourceMemorials.add(src.memorialId);
    }
  }

  // 15. 台账末条目 balanceAfter 与当前 treasury 一致（仅台账非空时适用）
  if (ledger.length > 0) {
    const last = ledger[ledger.length - 1]!;
    if (state.resources.nation.treasury !== last.balanceAfter) {
      e("TREASURY_LEDGER_CURRENT_MISMATCH", `国库当前余额（${state.resources.nation.treasury}）与台账末条目「${last.id}」balanceAfter（${last.balanceAfter}）不一致`, {
        currentTreasury: state.resources.nation.treasury, lastBalanceAfter: last.balanceAfter, lastId: last.id,
      });
    }
  }

  // 16/17. 已批奏折中，选定选项有 treasuryDelta 者必须恰好有一条台账（多条由 check 13 覆盖，此处查缺失）。
  for (const [, m] of Object.entries(state.memorials)) {
    if (m.status !== "resolved") continue;
    const chosenOption = m.payload.options.find((o) => o.id === m.resolution);
    if (!chosenOption) continue;
    if (chosenOption.treasuryDelta !== undefined) {
      const ledgerForThis = state.treasuryLedger.filter(
        (entry) => entry.source.kind === "memorial" && entry.source.memorialId === m.id,
      );
      if (ledgerForThis.length === 0) {
        e("TREASURY_LEDGER_MISSING_ENTRY", `已批奏折「${m.id}」选项「${chosenOption.id}」有国库变化但无台账条目`, {
          id: m.id, optionId: chosenOption.id, treasuryDelta: chosenOption.treasuryDelta,
        });
      }
    }
  }

  return errors;
}
