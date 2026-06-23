import type { MutationRecord } from "../../../engine/trace/types";

const CLASS_MAP: Record<string, string> = {
  direct: "trace-mut--direct",
  derived: "trace-mut--derived",
  scheduled: "trace-mut--scheduled",
  untracked: "trace-mut--untracked",
};

function fmt(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

export function TraceMutationRow({ mut }: { mut: MutationRecord }) {
  const cls = CLASS_MAP[mut.classification] ?? "";
  const deltaStr = mut.delta !== undefined ? (mut.delta >= 0 ? `+${mut.delta}` : String(mut.delta)) : null;
  return (
    <li className={`trace-mut ${cls}`}>
      <span className="trace-mut__path">{mut.path}</span>
      <span className="trace-mut__arrow">
        {fmt(mut.before)} → {fmt(mut.after)}
        {deltaStr && <em> ({deltaStr})</em>}
      </span>
      {mut.reason && <span className="trace-mut__reason">{mut.reason}</span>}
      <span className="trace-mut__badge">{mut.classification}</span>
      {mut.phase !== "effects" && <span className="trace-mut__phase">[{mut.phase}]</span>}
    </li>
  );
}
