import type { TraceFacets, TraceQuery } from "../../../engine/trace/query";
import type { TraceDomainEvent } from "../../../engine/trace/domainEvents";
import type { TraceSource } from "../../../engine/trace/types";

interface Props {
  query: TraceQuery;
  facets: TraceFacets;
  filteredCount: number;
  onChange: (q: TraceQuery) => void;
}

const SOURCE_KIND_LABELS: Record<TraceSource["kind"], string> = {
  choice: "选择",
  action: "行动",
  event: "事件",
  imperial_command: "帝令",
  harem_admin: "位分",
  time_advance: "时间",
  debug: "调试",
  system: "系统",
};

const DOMAIN_KIND_LABELS: Record<TraceDomainEvent["kind"], string> = {
  memory: "记忆",
  queue: "队列",
  eligibility: "可触发性",
  rollback: "回滚",
};

function toggleStr<T extends string>(arr: T[] | undefined, item: T): T[] {
  if (!arr) return [item];
  return arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
}

export function TraceFilterBar({ query, facets, filteredCount, onChange }: Props) {
  const isFiltered =
    (query.text !== undefined && query.text.trim() !== "") ||
    (query.outcomes?.length ?? 0) > 0 ||
    (query.sourceKinds?.length ?? 0) > 0 ||
    (query.domainKinds?.length ?? 0) > 0 ||
    query.hasWarnings === true ||
    query.hasUntracked === true;

  const availableSourceKinds = Object.keys(facets.sourceKinds) as TraceSource["kind"][];
  const availableDomainKinds = Object.keys(facets.domainKinds) as TraceDomainEvent["kind"][];

  return (
    <div className="trace-filter-bar" role="search" aria-label="筛选追踪记录">
      <div className="trace-filter-bar__row">
        <input
          className="trace-filter-bar__text"
          type="search"
          placeholder="搜索…"
          aria-label="关键词搜索"
          value={query.text ?? ""}
          onChange={(e) => onChange({ ...query, text: e.target.value })}
        />
        <span className="trace-filter-bar__count" aria-live="polite">
          {isFiltered ? `${filteredCount} / ${facets.totalCount} 条` : `${facets.totalCount} 条`}
        </span>
        {isFiltered && (
          <button type="button" className="trace-filter-bar__clear" onClick={() => onChange({})}>
            清除筛选
          </button>
        )}
      </div>

      <div className="trace-filter-bar__group" role="group" aria-label="结果类型">
        {(["committed", "rolled_back"] as const).map((o) => {
          const count = facets.outcomes[o] ?? 0;
          if (count === 0) return null;
          const active = query.outcomes?.includes(o) ?? false;
          return (
            <button
              key={o}
              type="button"
              className={`trace-filter-bar__chip${active ? " trace-filter-bar__chip--active" : ""}`}
              aria-pressed={active}
              onClick={() => onChange({ ...query, outcomes: toggleStr(query.outcomes, o) })}
            >
              {o === "committed" ? "已提交" : "已回滚"} ({count})
            </button>
          );
        })}
      </div>

      {availableSourceKinds.length > 1 && (
        <div className="trace-filter-bar__group" role="group" aria-label="来源类型">
          {availableSourceKinds.map((k) => {
            const active = query.sourceKinds?.includes(k) ?? false;
            const count = facets.sourceKinds[k] ?? 0;
            return (
              <button
                key={k}
                type="button"
                className={`trace-filter-bar__chip${active ? " trace-filter-bar__chip--active" : ""}`}
                aria-pressed={active}
                onClick={() => onChange({ ...query, sourceKinds: toggleStr(query.sourceKinds, k) })}
              >
                {SOURCE_KIND_LABELS[k]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {availableDomainKinds.length > 0 && (
        <div className="trace-filter-bar__group" role="group" aria-label="领域事件类型">
          {availableDomainKinds.map((k) => {
            const active = query.domainKinds?.includes(k) ?? false;
            const count = facets.domainKinds[k] ?? 0;
            return (
              <button
                key={k}
                type="button"
                className={`trace-filter-bar__chip${active ? " trace-filter-bar__chip--active" : ""}`}
                aria-pressed={active}
                onClick={() => onChange({ ...query, domainKinds: toggleStr(query.domainKinds, k) })}
              >
                {DOMAIN_KIND_LABELS[k]} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div className="trace-filter-bar__group" role="group" aria-label="特殊标记">
        <label className="trace-filter-bar__check">
          <input
            type="checkbox"
            checked={query.hasWarnings === true}
            onChange={(e) => onChange({ ...query, hasWarnings: e.target.checked || undefined })}
          />
          {" "}仅含警告
        </label>
        <label className="trace-filter-bar__check">
          <input
            type="checkbox"
            checked={query.hasUntracked === true}
            onChange={(e) => onChange({ ...query, hasUntracked: e.target.checked || undefined })}
          />
          {" "}含未追踪
        </label>
      </div>
    </div>
  );
}
