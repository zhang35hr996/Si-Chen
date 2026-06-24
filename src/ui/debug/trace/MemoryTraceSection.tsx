import { useState } from "react";
import type { MemoryTraceEvent } from "../../../engine/trace/domainEvents";

export function MemoryTraceSection({ events }: { events: MemoryTraceEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <section className="trace-section">
      <button type="button" className="trace-section__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 记忆 ({events.length})
      </button>
      {open && (
        <ul className="trace-section__list">
          {events.map((e, i) => (
            <li key={i} className="trace-section__item">
              <span className="trace-badge--kind">{e.operation}</span>
              {" "}
              <code>{e.ownerId}</code>
              {" → "}
              <code>{e.entryId}</code>
              {e.summary && <span className="trace-section__meta"> — {e.summary}</span>}
              {e.sourceCourtEventId && (
                <span className="trace-section__meta"> · 来源: <code>{e.sourceCourtEventId}</code></span>
              )}
              <span className="trace-section__phase"> [{e.phase}]</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
