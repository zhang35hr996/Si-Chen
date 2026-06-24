import { useState } from "react";
import type { QueueTraceEvent } from "../../../engine/trace/domainEvents";

export function QueueTraceSection({ events }: { events: QueueTraceEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <section className="trace-section">
      <button type="button" className="trace-section__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 队列 ({events.length})
      </button>
      {open && (
        <ul className="trace-section__list">
          {events.map((e, i) => (
            <li key={i} className="trace-section__item">
              <span className="trace-badge--kind">{e.operation}</span>
              {" "}
              <code>{e.queue}</code>
              {" · "}
              <code>{e.itemId}</code>
              {e.itemType && <span className="trace-section__meta"> ({e.itemType})</span>}
              {e.resolution && <span className="trace-section__meta"> → {e.resolution}</span>}
              {e.reason && <span className="trace-section__meta"> — {e.reason}</span>}
              <span className="trace-section__phase"> [{e.phase}]</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
