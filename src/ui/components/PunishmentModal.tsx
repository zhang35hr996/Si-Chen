/**
 * 侍君惩罚菜单（任务 §2/§3/§8/§9）。紫宸殿与侍君宫殿共用此唯一组件；业务逻辑全在
 * imperialCommands 命令层，组件只负责选择与确认，绝不直接改存档。
 *
 *   惩罚：禁足（可用）/ 下狱（禁用·尚未开放）/ 赐死（可用·二次确认）/ 株连九族（禁用·尚未开放）
 *
 * 已禁足者打开菜单时直接显示禁足详情与「解除禁足」，而非重复下旨。
 * 凤后禁足流程增加「六宫主理者选择」步骤。
 */
import { useState, type ReactNode } from "react";
import {
  CONFINEMENT_DURATIONS,
  CONFINEMENT_DURATION_LABELS,
  CONFINEMENT_DURATION_ORDER,
  activeConfinement,
  type ConfinementDurationKey,
} from "../../engine/characters/confinement";
import { eligibleHaremAdministrators } from "../../engine/characters/haremAdministration";
import { resolveDisplayName } from "../../engine/characters/standing";
import { addTurns, formatGameTime, toGameTime } from "../../engine/calendar/time";
import { canSendToColdPalace } from "../../engine/characters/coldPalace";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import type { HaremAdministratorChoice, ImperialCommand } from "../../store/imperialCommands";
import { describeActiveConfinement } from "../format/confinement";

type Step =
  | { kind: "menu" }
  | { kind: "confine_duration" }
  | { kind: "confine_admin_select"; duration: ConfinementDurationKey }
  | { kind: "confine_replacement_select"; duration: ConfinementDurationKey }
  | { kind: "confine_confirm"; duration: ConfinementDurationKey; administrator?: HaremAdministratorChoice; administratorReplacement?: HaremAdministratorChoice }
  | { kind: "execute_replacement_select" }
  | { kind: "execute_confirm"; administratorReplacement?: HaremAdministratorChoice }
  | { kind: "cold_palace_confirm" };

export function PunishmentModal({
  db,
  state,
  character,
  onCommand,
  onSendToColdPalace,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  character: CharacterContent;
  onCommand: (command: ImperialCommand) => void;
  onSendToColdPalace?: (charId: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "menu" });
  const [typedName, setTypedName] = useState("");

  const standing = state.standing[character.id];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = resolveDisplayName(character, standing, rank);
  const eraName = state.calendar.eraName;
  const confinement = activeConfinement(state, character.id);
  const isEmpress = standing?.rank === "fenghou";
  const coldPalaceEligibility = canSendToColdPalace(state, character.id);

  const haremAdmin = state.haremAdministration;
  const isActingAdmin = haremAdmin.mode === "acting_consort" && haremAdmin.charId === character.id;
  // 协理者失格后有资格接任的候选（排除目标本身）。
  const replacementCandidates = isActingAdmin ? eligibleHaremAdministrators(db, state).filter((c) => c.id !== character.id) : [];
  // 仅当有候选时才需要玩家选择；无候选时自动切内务府。
  const needsReplacementChoice = isActingAdmin && replacementCandidates.length > 0;

  const issue = (command: ImperialCommand) => {
    onCommand(command);
  };

  // ── 已禁足：显示详情与管理（解除禁足），不重复下旨。 ──────────────────────
  if (confinement) {
    return (
      <Backdrop onClose={onClose}>
        <h2>{name}　禁足管理</h2>
        <p className="punish-modal__status">{describeActiveConfinement(confinement, eraName)}</p>
        <ul className="punish-modal__detail">
          <li>当前禁足开始：{formatGameTime({ ...confinement.imposedAt, eraName })}</li>
          <li>
            预计解除：
            {confinement.endTurnExclusive === null
              ? "无诏不得出"
              : formatGameTime({ ...addTurns(confinement.imposedAt, confinement.endTurnExclusive - confinement.startTurn), eraName })}
          </li>
        </ul>
        <div className="punish-modal__actions">
          <button
            type="button"
            className="punish-btn punish-btn--lift"
            onClick={() => issue({ type: "lift_confinement", targetId: character.id })}
          >
            解除禁足
          </button>
          <button type="button" className="punish-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </Backdrop>
    );
  }

  // ── 凤后禁足：选择六宫主理者 ────────────────────────────────────────────
  if (step.kind === "confine_admin_select") {
    const candidates = eligibleHaremAdministrators(db, state);
    if (candidates.length === 0) {
      // 无候选者 → 唯一选项是内务府代理，不需要用户选择，直接确认。
      return (
        <Backdrop onClose={onClose}>
          <h2>六宫主理　内务府代理</h2>
          <p className="punish-modal__confirm">
            宫中目前无驸级以上侍君可协理六宫。
            <br />
            凤后禁足期间，将由内务府总管暂代宫务。
          </p>
          <div className="punish-modal__actions">
            <button
              type="button"
              className="punish-btn punish-btn--confine"
              onClick={() =>
                setStep({
                  kind: "confine_confirm",
                  duration: step.duration,
                  administrator: { kind: "neiwu_proxy" },
                })
              }
            >
              确认
            </button>
            <button
              type="button"
              className="punish-btn punish-btn--minor"
              onClick={() => setStep({ kind: "confine_duration" })}
            >
              返回
            </button>
          </div>
        </Backdrop>
      );
    }

    return (
      <Backdrop onClose={onClose}>
        <h2>选择协理六宫者</h2>
        <p className="punish-modal__subtitle">凤后禁足期间，须指定一位侍君协理六宫：</p>
        <div className="punish-modal__admin-list">
          {candidates.map((c) => {
            const cSt = state.standing[c.id];
            const cRank = cSt ? db.ranks[cSt.rank] : undefined;
            const cName = resolveDisplayName(c, cSt, cRank);
            return (
              <button
                key={c.id}
                type="button"
                className="punish-btn"
                onClick={() =>
                  setStep({
                    kind: "confine_confirm",
                    duration: step.duration,
                    administrator: { kind: "consort", charId: c.id },
                  })
                }
              >
                {cName}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="punish-btn punish-btn--minor"
          onClick={() => setStep({ kind: "confine_duration" })}
        >
          返回
        </button>
      </Backdrop>
    );
  }

  // ── 协理者接任选择（禁足目标是当前协理者）────────────────────────────────
  if (step.kind === "confine_replacement_select") {
    return (
      <Backdrop onClose={onClose}>
        <h2>指定六宫接任者</h2>
        <p className="punish-modal__subtitle">{name}禁足后，须指定新的六宫主理者：</p>
        <div className="punish-modal__admin-list">
          {replacementCandidates.map((c) => {
            const cSt = state.standing[c.id];
            const cRank = cSt ? db.ranks[cSt.rank] : undefined;
            const cName = resolveDisplayName(c, cSt, cRank);
            return (
              <button
                key={c.id}
                type="button"
                className="punish-btn"
                onClick={() =>
                  setStep({
                    kind: "confine_confirm",
                    duration: step.duration,
                    administratorReplacement: { kind: "consort", charId: c.id },
                  })
                }
              >
                {cName}
              </button>
            );
          })}
        </div>
        <button type="button" className="punish-btn punish-btn--minor" onClick={() => setStep({ kind: "confine_duration" })}>
          返回
        </button>
      </Backdrop>
    );
  }

  // ── 协理者接任选择（赐死目标是当前协理者）────────────────────────────────
  if (step.kind === "execute_replacement_select") {
    return (
      <Backdrop onClose={onClose}>
        <h2>指定六宫接任者</h2>
        <p className="punish-modal__subtitle">{name}赐死后，须指定新的六宫主理者：</p>
        <div className="punish-modal__admin-list">
          {replacementCandidates.map((c) => {
            const cSt = state.standing[c.id];
            const cRank = cSt ? db.ranks[cSt.rank] : undefined;
            const cName = resolveDisplayName(c, cSt, cRank);
            return (
              <button
                key={c.id}
                type="button"
                className="punish-btn"
                onClick={() =>
                  setStep({
                    kind: "execute_confirm",
                    administratorReplacement: { kind: "consort", charId: c.id },
                  })
                }
              >
                {cName}
              </button>
            );
          })}
        </div>
        <button type="button" className="punish-btn punish-btn--minor" onClick={() => setStep({ kind: "menu" })}>
          返回
        </button>
      </Backdrop>
    );
  }

  // ── 禁足期限选择 ──────────────────────────────────────────────────────
  if (step.kind === "confine_duration") {
    return (
      <Backdrop onClose={onClose}>
        <h2>{name}　禁足期限</h2>
        <div className="punish-modal__durations">
          {CONFINEMENT_DURATION_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className="punish-btn"
              onClick={() => {
                if (isEmpress) {
                  setStep({ kind: "confine_admin_select", duration: key });
                } else if (needsReplacementChoice) {
                  setStep({ kind: "confine_replacement_select", duration: key });
                } else {
                  setStep({ kind: "confine_confirm", duration: key });
                }
              }}
            >
              {CONFINEMENT_DURATION_LABELS[key]}
            </button>
          ))}
        </div>
        <button type="button" className="punish-btn punish-btn--minor" onClick={() => setStep({ kind: "menu" })}>
          返回
        </button>
      </Backdrop>
    );
  }

  // ── 禁足最终确认（展示精确起止旬）──────────────────────────────────────
  if (step.kind === "confine_confirm") {
    const durationTurns = CONFINEMENT_DURATIONS[step.duration];
    const now = toGameTime(state.calendar);
    const startLabel = formatGameTime({ ...now, eraName });
    const indefinite = durationTurns === null;
    const releaseLabel = indefinite ? null : formatGameTime({ ...addTurns(now, durationTurns), eraName });

    let adminLine: ReactNode = null;
    if (isEmpress && step.administrator) {
      const a = step.administrator;
      if (a.kind === "neiwu_proxy") {
        adminLine = <p className="punish-modal__confirm">六宫主理：内务府总管暂代宫务。</p>;
      } else {
        const ac = db.characters[a.charId] ?? state.generatedConsorts[a.charId];
        const acSt = state.standing[a.charId];
        const acRank = acSt ? db.ranks[acSt.rank] : undefined;
        const acName = ac ? resolveDisplayName(ac, acSt, acRank) : a.charId;
        adminLine = <p className="punish-modal__confirm">六宫主理：{acName}协理六宫。</p>;
      }
    }
    let replacementLine: ReactNode = null;
    if (step.administratorReplacement) {
      const r = step.administratorReplacement;
      if (r.kind === "neiwu_proxy") {
        replacementLine = <p className="punish-modal__confirm">六宫接任：内务府总管暂代宫务。</p>;
      } else {
        const rc = db.characters[r.charId] ?? state.generatedConsorts[r.charId];
        const rcSt = state.standing[r.charId];
        const rcRank = rcSt ? db.ranks[rcSt.rank] : undefined;
        const rcName = rc ? resolveDisplayName(rc, rcSt, rcRank) : r.charId;
        replacementLine = <p className="punish-modal__confirm">六宫接任：{rcName}协理六宫。</p>;
      }
    }

    const prevStepForBack = isEmpress
      ? ({ kind: "confine_admin_select", duration: step.duration } as const)
      : needsReplacementChoice
        ? ({ kind: "confine_replacement_select", duration: step.duration } as const)
        : ({ kind: "confine_duration" } as const);

    return (
      <Backdrop onClose={onClose}>
        <h2>{name}　禁足下旨</h2>
        {indefinite ? (
          <p className="punish-modal__confirm">
            【{name}】将自{startLabel}起无诏不得出。
            <br />
            此次禁足没有自动期限，只能由皇帝下旨解除。
          </p>
        ) : (
          <p className="punish-modal__confirm">
            【{name}】将自{startLabel}起禁足，
            <br />
            至{releaseLabel}解除。
            <br />
            禁足期间不得离宫、请安、赴宴或接受普通召见。
          </p>
        )}
        {adminLine}
        {replacementLine}
        <div className="punish-modal__actions">
          <button
            type="button"
            className="punish-btn punish-btn--confine"
            onClick={() =>
              issue({
                type: "impose_confinement",
                targetId: character.id,
                durationTurns,
                ...(step.administrator ? { administrator: step.administrator } : {}),
                ...(step.administratorReplacement ? { administratorReplacement: step.administratorReplacement } : {}),
              })
            }
          >
            确认下旨
          </button>
          <button
            type="button"
            className="punish-btn punish-btn--minor"
            onClick={() => setStep(prevStepForBack)}
          >
            返回
          </button>
        </div>
      </Backdrop>
    );
  }

  // ── 赐死高危确认（输入姓名方可下旨，视觉区别于普通确认）────────────────
  if (step.kind === "execute_confirm") {
    const nameMatches = typedName.trim() === name;
    let execReplacementLine: ReactNode = null;
    if (step.administratorReplacement) {
      const r = step.administratorReplacement;
      if (r.kind === "neiwu_proxy") {
        execReplacementLine = <p className="punish-modal__confirm">六宫接任：内务府总管暂代宫务。</p>;
      } else {
        const rc = db.characters[r.charId] ?? state.generatedConsorts[r.charId];
        const rcSt = state.standing[r.charId];
        const rcRank = rcSt ? db.ranks[rcSt.rank] : undefined;
        const rcName = rc ? resolveDisplayName(rc, rcSt, rcRank) : r.charId;
        execReplacementLine = <p className="punish-modal__confirm">六宫接任：{rcName}协理六宫。</p>;
      }
    }
    const backStep: Step = needsReplacementChoice
      ? { kind: "execute_replacement_select" }
      : { kind: "menu" };
    return (
      <Backdrop onClose={onClose}>
        <div className="punish-modal__danger">
          <h2 className="punish-modal__danger-title">赐死【{name}】？</h2>
          <p className="punish-modal__danger-body">
            此操作将使该角色永久死亡，
            <br />
            相关剧情、关系和未完成事件将被终止。此举不可逆。
          </p>
          {execReplacementLine}
          <label className="punish-modal__name-confirm">
            为防误触，请输入该角色姓名「{name}」以确认：
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={name}
              aria-label="确认姓名"
            />
          </label>
          <div className="punish-modal__actions">
            <button
              type="button"
              className="punish-btn punish-btn--execute"
              disabled={!nameMatches}
              onClick={() => issue({
                type: "execute",
                targetId: character.id,
                ...(step.administratorReplacement ? { administratorReplacement: step.administratorReplacement } : {}),
              })}
            >
              赐死
            </button>
            <button
              type="button"
              className="punish-btn punish-btn--minor"
              onClick={() => {
                setTypedName("");
                setStep(backStep);
              }}
            >
              取消
            </button>
          </div>
        </div>
      </Backdrop>
    );
  }

  // ── 打入冷宫确认 ────────────────────────────────────────────────────
  if (step.kind === "cold_palace_confirm") {
    const now = toGameTime(state.calendar);
    const nowLabel = formatGameTime({ ...now, eraName });
    const isActingAdmin = state.haremAdministration.mode === "acting_consort" && state.haremAdministration.charId === character.id;
    return (
      <Backdrop onClose={onClose}>
        <h2>{name}　打入冷宫</h2>
        <p className="punish-modal__confirm">
          【{name}】将自{nowLabel}起迁居长门宫，幽禁于此。
          <br />
          幽居期间不得召见、侍寝、搬迁或出宫。
          {isActingAdmin && (
            <>
              <br />
              六宫主理权将自动移交（内务府代理或其他合资格侍君）。
            </>
          )}
          <br />
          此次幽居须由皇帝下旨方可解除，正式记录在案。
        </p>
        <div className="punish-modal__actions">
          <button
            type="button"
            className="punish-btn punish-btn--confine"
            onClick={() => {
              onSendToColdPalace?.(character.id);
            }}
          >
            确认下旨
          </button>
          <button
            type="button"
            className="punish-btn punish-btn--minor"
            onClick={() => setStep({ kind: "menu" })}
          >
            返回
          </button>
        </div>
      </Backdrop>
    );
  }

  // ── 惩罚主菜单 ────────────────────────────────────────────────────────
  return (
    <Backdrop onClose={onClose}>
      <h2>{name}　惩罚</h2>
      <div className="punish-modal__menu">
        <button type="button" className="punish-btn" onClick={() => setStep({ kind: "confine_duration" })}>
          禁足
        </button>
        {coldPalaceEligibility.ok ? (
          <button
            type="button"
            className="punish-btn punish-btn--danger"
            onClick={() => setStep({ kind: "cold_palace_confirm" })}
            disabled={!onSendToColdPalace}
          >
            打入冷宫
          </button>
        ) : (
          <button
            type="button"
            className="punish-btn"
            disabled
            title={coldPalaceEligibility.reason}
          >
            打入冷宫（{coldPalaceEligibility.reason}）
          </button>
        )}
        <button type="button" className="punish-btn" disabled title="尚未开放">
          下狱（尚未开放）
        </button>
        {!isEmpress && (
          <button
            type="button"
            className="punish-btn punish-btn--danger"
            onClick={() =>
              needsReplacementChoice
                ? setStep({ kind: "execute_replacement_select" })
                : setStep({ kind: "execute_confirm" })
            }
          >
            赐死
          </button>
        )}
        <button type="button" className="punish-btn" disabled title="尚未开放">
          株连九族（尚未开放）
        </button>
      </div>
      <button type="button" className="punish-btn punish-btn--minor" onClick={onClose}>
        关闭
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
