import type { RollbackTraceEvent } from "../../../engine/trace/domainEvents";

export function RollbackTraceSection({ events }: { events: RollbackTraceEvent[] }) {
  if (events.length === 0) return null;
  return (
    <>
      {events.map((e, i) => (
        <section key={i} className="trace-rollback-banner">
          <strong>ATTEMPTED — NOT COMMITTED</strong>
          <p>未写入任何状态变更。失败阶段: <code>{e.failedPhase}</code></p>
          {e.errorCode && <p>错误码: <code>{e.errorCode}</code></p>}
          <p className="trace-rollback-banner__msg">{e.message}</p>
          <p className="trace-section__meta">
            已尝试变更: {e.attemptedMutationCount} · 已尝试语义事件: {e.attemptedDomainEventCount}
          </p>
        </section>
      ))}
    </>
  );
}
