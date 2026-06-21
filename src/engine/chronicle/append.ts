/**
 * 编年史写入：append-only，永不回写。id 由现有最大序号 +1 派生（正则校验，空洞/异常 id 不影响）。
 * 拒绝未来事件——编年史只记「已发生」。返回新 state，不改入参。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { CourtEvent, GameState } from "../state/types";

const ID_RE = /^evt_(\d{6})$/;

export function courtEventId(seq: number): string {
  return `evt_${String(seq).padStart(6, "0")}`;
}

function maxSeq(chronicle: readonly CourtEvent[]): number {
  let max = 0;
  for (const e of chronicle) {
    const m = ID_RE.exec(e.id); // 仅识别 evt_NNNNNN，忽略其它前缀
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

export function appendCourtEvent(
  state: GameState,
  draft: Omit<CourtEvent, "id">,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  if (compareGameTime(draft.occurredAt, toGameTime(state.calendar)) > 0) {
    return err([stateError("FUTURE_EVENT", `cannot append a future CourtEvent`, { context: { occurredAt: draft.occurredAt } })]);
  }
  const event: CourtEvent = { id: courtEventId(maxSeq(state.chronicle) + 1), ...draft };
  return ok({ state: { ...state, chronicle: [...state.chronicle, event] }, event });
}
