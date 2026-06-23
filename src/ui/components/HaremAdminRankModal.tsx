/**
 * 六宫行政位分管理弹窗。
 *
 * 由代理侍君对**严格低于自身位分**的侍君进行晋封/降位/封号管理。
 * 皇帝自己的位分管理走 RankAdminModal，不受此处约束。
 *
 * neiwu_proxy 模式下此弹窗不应开放，但保留只读提示作为防呆。
 */
import { useState, type ReactNode } from "react";
import { effectiveOrder, resolveDisplayName, resolveIdentityLabel } from "../../engine/characters/standing";
import { getHaremRankAuthority } from "../../engine/characters/haremRankAuthority";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import type { HaremAdminRankCommand } from "../../store/haremAdminCommands";

type Step =
  | { kind: "target_select" }
  | { kind: "rank_select"; targetId: string }
  | { kind: "confirm"; targetId: string; request: HaremAdminRankCommand["request"] };

export function HaremAdminRankModal({
  db,
  state,
  actorId,
  onCommand,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  actorId: string;
  onCommand: (command: HaremAdminRankCommand) => { ok: boolean; reason?: string };
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "target_select" });
  const [lastError, setLastError] = useState<string | null>(null);

  const authority = getHaremRankAuthority(db, state);

  if (authority.kind === "none") {
    return (
      <Backdrop onClose={onClose}>
        <h2>六宫位分管理</h2>
        <p className="harem-rank__notice">{authority.reason}</p>
        <button type="button" onClick={onClose}>关闭</button>
      </Backdrop>
    );
  }

  const actorSt = state.standing[actorId];
  const actorChar = db.characters[actorId] ?? state.generatedConsorts[actorId];
  const actorRankMeta = actorSt ? db.ranks[actorSt.rank] : undefined;
  const actorName = actorChar ? resolveDisplayName(actorChar, actorSt, actorRankMeta) : actorId;
  const actorRankOrder = actorRankMeta?.order ?? 0;

  // 合格处分目标：存活在宫侍君，位分 order 严格低于协理者。
  const allConsorts = Object.values(db.characters).filter((c) => c.kind === "consort");
  const targets = allConsorts.filter((c) => {
    if (c.id === actorId) return false;
    const st = state.standing[c.id];
    if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") return false;
    if (st.rank === "fenghou") return false;
    const rankOrder = db.ranks[st.rank]?.order ?? 0;
    return rankOrder < actorRankOrder;
  });

  // ── 目标选择 ──────────────────────────────────────────────────────────
  if (step.kind === "target_select") {
    return (
      <Backdrop onClose={onClose}>
        <h2>协理六宫　管理低位侍君</h2>
        <p className="harem-rank__subtitle">
          {actorName}当前协理六宫，可对以下侍君进行晋封或降位：
        </p>
        {targets.length === 0 ? (
          <p className="harem-rank__notice">宫中目前无可处分的低位侍君。</p>
        ) : (
          <ul className="harem-rank__list">
            {targets
              .sort((a, b) => {
                const oa = db.ranks[state.standing[a.id]!.rank]?.order ?? 0;
                const ob = db.ranks[state.standing[b.id]!.rank]?.order ?? 0;
                return ob - oa;
              })
              .map((c) => {
                const st = state.standing[c.id]!;
                const rank = db.ranks[st.rank];
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="harem-rank__pick"
                      onClick={() => { setLastError(null); setStep({ kind: "rank_select", targetId: c.id }); }}
                    >
                      <span className="harem-rank__name">{c.profile.name}</span>
                      <span className="harem-rank__rank">
                        {rank?.name ?? st.rank}
                        {st.title ? `　封号「${st.title}」` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
        <button type="button" className="harem-rank__close" onClick={onClose}>关闭</button>
      </Backdrop>
    );
  }

  // ── 位分 / 封号选择 ──────────────────────────────────────────────────
  if (step.kind === "rank_select") {
    return (
      <RankSelectStep
        db={db}
        state={state}
        targetId={step.targetId}
        actorName={actorName}
        actorRankOrder={actorRankOrder}
        onConfirm={(request) => { setLastError(null); setStep({ kind: "confirm", targetId: step.targetId, request }); }}
        onBack={() => { setLastError(null); setStep({ kind: "target_select" }); }}
        onClose={onClose}
      />
    );
  }

  // ── 确认页 ────────────────────────────────────────────────────────────
  if (step.kind === "confirm") {
    const targetChar = db.characters[step.targetId] ?? state.generatedConsorts[step.targetId];
    const targetSt = state.standing[step.targetId];
    if (!targetChar || !targetSt) return null;
    const targetRankMeta = db.ranks[targetSt.rank];
    const targetName = resolveIdentityLabel(targetChar, targetSt, targetRankMeta);

    const fromRankName = targetRankMeta?.name ?? targetSt.rank;
    let opLine: string;
    if (step.request.kind === "set_rank") {
      const toRank = db.ranks[step.request.rank];
      const toRankOrder = toRank?.order ?? 0;
      const fromRankOrder = targetRankMeta?.order ?? 0;
      const dir = toRankOrder > fromRankOrder ? "晋封" : "降位";
      opLine = `${dir}：${fromRankName} → ${toRank?.name ?? step.request.rank}`;
    } else if (step.request.kind === "set_title") {
      opLine = targetSt.title
        ? `改封封号：「${targetSt.title}」→「${step.request.title}」`
        : `赐封号：「${step.request.title}」`;
    } else {
      opLine = `褫夺封号：「${targetSt.title ?? ""}」`;
    }

    return (
      <Backdrop onClose={onClose}>
        <h2>确认处分</h2>
        <p className="harem-rank__confirm-row">协理者：{actorName}</p>
        <p className="harem-rank__confirm-row">目标：{targetName}</p>
        <p className="harem-rank__confirm-row">{opLine}</p>
        {lastError && <p className="harem-rank__error" role="alert">{lastError}</p>}
        <div className="punish-modal__actions">
          <button
            type="button"
            className="punish-btn punish-btn--confine"
            onClick={() => {
              const result = onCommand({ type: "harem_admin_rank_change", actorId, targetId: step.targetId, request: step.request });
              if (result.ok) {
                setLastError(null);
                onClose();
              } else {
                setLastError(result.reason ?? "操作失败，请重试。");
              }
            }}
          >
            确认下旨
          </button>
          <button type="button" className="punish-btn punish-btn--minor" onClick={() => { setLastError(null); setStep({ kind: "rank_select", targetId: step.targetId }); }}>
            返回
          </button>
        </div>
      </Backdrop>
    );
  }

  return null;
}

function RankSelectStep({
  db,
  state,
  targetId,
  actorName,
  actorRankOrder,
  onConfirm,
  onBack,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  targetId: string;
  actorName: string;
  actorRankOrder: number;
  onConfirm: (request: HaremAdminRankCommand["request"]) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const targetChar = db.characters[targetId] ?? state.generatedConsorts[targetId];
  const targetSt = state.standing[targetId];
  const targetRankMeta = targetSt ? db.ranks[targetSt.rank] : undefined;
  const targetName = targetChar && targetSt ? resolveIdentityLabel(targetChar, targetSt, targetRankMeta) : targetId;

  const rankLadder = Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.id !== "fenghou" && r.order < actorRankOrder)
    .sort((a, b) => effectiveOrder(b, false) - effectiveOrder(a, false));

  const [selectedRank, setSelectedRank] = useState(targetSt?.rank ?? "");
  const [title, setTitle] = useState("");
  const titleValid = /^[一-龥]{1,4}$/.test(title);

  if (!targetChar || !targetSt) return null;

  return (
    <Backdrop onClose={onClose}>
      <h2>{targetName}　晋降处分</h2>
      <p className="harem-rank__subtitle">协理者：{actorName}</p>

      <section className="rank-modal__section">
        <label>调整位分：</label>
        <select value={selectedRank} onChange={(e) => setSelectedRank(e.target.value)}>
          {rankLadder.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}（{r.grade}）
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={selectedRank === targetSt.rank}
          onClick={() => onConfirm({ kind: "set_rank", rank: selectedRank })}
        >
          确认调整
        </button>
      </section>

      <section className="rank-modal__section">
        <label>封号：</label>
        <input value={title} maxLength={4} placeholder="1–4 字" onChange={(e) => setTitle(e.target.value)} />
        <button type="button" disabled={!titleValid} onClick={() => onConfirm({ kind: "set_title", title })}>
          {targetSt.title ? "改封" : "加封"}
        </button>
        <button type="button" disabled={targetSt.title === undefined} onClick={() => onConfirm({ kind: "remove_title" })}>
          褫夺封号
        </button>
      </section>

      <button type="button" className="punish-btn punish-btn--minor" onClick={onBack}>
        返回
      </button>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="punish-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
