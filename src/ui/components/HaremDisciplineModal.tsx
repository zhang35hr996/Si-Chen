/**
 * PUNISH-4G-B: 后宫内部惩戒御前裁断弹窗。
 * 全局中断 "harem_discipline" 的 UI；由 App 在 activeGlobalInterrupt === "harem_discipline" 时渲染。
 * 玩家选择三种裁断之一：维持处分 / 回护受罚者 / 各自申饬。
 */
import { useRef } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, HaremDisciplineIncident, HaremDisciplineResolution } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";

function resolveCharName(db: ContentDB, state: GameState, charId: string): string {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  return char ? resolveDisplayName(char, standing, rank) : charId;
}

const DISCIPLINE_KIND_LABEL: Record<string, string> = {
  copy_scripture: "抄写经文",
  kneeling: "罚跪",
  slapping: "掌嘴",
};

export function HaremDisciplineModal({
  db,
  state,
  incident,
  onResolve,
}: {
  db: ContentDB;
  state: GameState;
  incident: HaremDisciplineIncident;
  onResolve: (resolution: HaremDisciplineResolution) => void;
}) {
  const submitted = useRef(false);

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
    };
  }

  const actorName = resolveCharName(db, state, incident.actorId);
  const targetName = resolveCharName(db, state, incident.targetId);
  const actorRank = db.ranks[incident.actorSnapshot.rankId]?.name ?? incident.actorSnapshot.rankId;
  const targetRank = db.ranks[incident.targetSnapshot.rankId]?.name ?? incident.targetSnapshot.rankId;
  const kindLabel = DISCIPLINE_KIND_LABEL[incident.disciplineKind] ?? incident.disciplineKind;

  const bodyText =
    incident.disciplineKind === "slapping"
      ? `${actorRank}${actorName}擅自对${targetRank}${targetName}动了重罚，将其掌嘴。此事已传遍后宫，请圣上裁断。`
      : incident.disciplineKind === "kneeling"
        ? `${actorRank}${actorName}自行做主，命${targetRank}${targetName}罚跪。此事宫人有所耳闻，请圣上裁断。`
        : `${actorRank}${actorName}令${targetRank}${targetName}抄写经文以示惩戒。请圣上裁断。`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
      }}
    >
      <div
        style={{
          background: "#1a0e08",
          border: "2px solid #8b6914",
          borderRadius: 8,
          padding: "28px 32px",
          maxWidth: 480,
          width: "90%",
          color: "#e8d5a3",
        }}
      >
        <h2 style={{ margin: "0 0 12px", color: "#d4a830", fontSize: 18 }}>
          后宫内部惩戒通报
        </h2>
        <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.6 }}>
          <strong>惩戒方式：</strong>{kindLabel}
        </p>
        <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.7 }}>{bodyText}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={guard(() => onResolve("upheld"))}
            style={btnStyle("#6b3d00")}
          >
            <span style={{ fontWeight: "bold" }}>维持处分</span>
            <span style={subStyle}>
              认可{actorName}的管束，{targetName}额外受惩
            </span>
          </button>
          <button
            onClick={guard(() => onResolve("protected"))}
            style={btnStyle("#003d2e")}
          >
            <span style={{ fontWeight: "bold" }}>回护受罚者</span>
            <span style={subStyle}>
              为{targetName}出头，{actorName}颜面受损
            </span>
          </button>
          <button
            onClick={guard(() => onResolve("rebuked_both"))}
            style={btnStyle("#2e2a00")}
          >
            <span style={{ fontWeight: "bold" }}>各自申饬</span>
            <span style={subStyle}>双方皆受训责，息事宁人</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    border: "1px solid #8b6914",
    borderRadius: 6,
    padding: "12px 16px",
    color: "#e8d5a3",
    cursor: "pointer",
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 14,
  };
}

const subStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#a89060",
};
