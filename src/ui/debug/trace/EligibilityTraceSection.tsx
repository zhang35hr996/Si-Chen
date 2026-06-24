import { useState } from "react";
import type { EligibilityFailure, EligibilityTraceEvent } from "../../../engine/trace/domainEvents";

function FailureList({ failures, label }: { failures: EligibilityFailure[]; label: string }) {
  if (failures.length === 0) return null;
  return (
    <ul className="trace-section__sublist">
      <li className="trace-section__sublabel">{label}</li>
      {failures.map((f, i) => (
        <li key={i} className="trace-section__item trace-section__item--indent">
          <code>{f.conditionType}</code>
          {f.subjectId && <span> · {f.subjectId}</span>}
          {f.expected !== undefined && (
            <span className="trace-section__meta"> 期望={JSON.stringify(f.expected)} 实际={JSON.stringify(f.actual)}</span>
          )}
          {f.path && <span className="trace-section__meta"> @ {f.path}</span>}
        </li>
      ))}
    </ul>
  );
}

export function EligibilityTraceSection({ events }: { events: EligibilityTraceEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <section className="trace-section">
      <button type="button" className="trace-section__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 资格变动 ({events.length})
      </button>
      {open && (
        <ul className="trace-section__list">
          {events.map((e, i) => (
            <li key={i} className="trace-section__item">
              <span className={e.transition === "became_eligible" ? "trace-badge--ok" : "trace-badge--err"}>
                {e.transition === "became_eligible" ? "转为可触发" : "转为不可触发"}
              </span>
              {" "}
              <code>{e.eventId}</code>
              <FailureList failures={e.failedBefore} label="之前失败条件:" />
              <FailureList failures={e.failedAfter} label="之后失败条件:" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
