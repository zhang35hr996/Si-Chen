/**
 * 官员名册与基础任免（Phase 2 PR2B）。玩家面向只读名册 + 官位表 + 详情/操作。
 *
 * 设计约束（spec §十二）：UI 不承担业务计算，只读 state 与 selector、只调 store 命令；移动端整行可点、
 * 列表/分组而非密集小卡。本屏只做基础任免（免职/调任/恢复/准告老/挽留），**不含升迁规则**（属 Phase 3）。
 */
import { useMemo, useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { Official, OfficialDepartment, OfficialStatus } from "../../engine/state/types";
import {
  getHighVacancyPosts,
  getOfficialsByStatus,
  getPostOccupancy,
  getVacantPosts,
  getVacantSeatCount,
  hasPendingRetirement,
} from "../../engine/officials/selectors";
import { OfficialDetail } from "./OfficialDetail";
import { DEPARTMENT_LABEL, OFFICIAL_STATUS_LABEL } from "./labels";

export interface OfficialsScreenProps {
  db: ContentDB;
  store: GameStore;
  onBack: () => void;
}

/** 名册状态筛选页（默认在任）。 */
const STATUS_TABS: OfficialStatus[] = ["active", "retired", "imprisoned", "exiled", "dead"];

const DEPARTMENT_ORDER: OfficialDepartment[] = [
  "chancellery", "personnel", "revenue", "rites", "military",
  "justice", "works", "censorate", "academy", "provincial", "none",
];

export function OfficialsScreen({ db, store, onBack }: OfficialsScreenProps) {
  const state = useGameState(store);
  const [tab, setTab] = useState<"roster" | "posts">("roster");
  const [statusFilter, setStatusFilter] = useState<OfficialStatus>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vacancySnoozed, setVacancySnoozed] = useState(false);

  const nameOf = (o: Official) => `${o.surname}${o.givenName}`;
  const highVacancies = getHighVacancyPosts(state, db);

  // 选中官员若已不存在则回名册。
  const selected = selectedId ? state.officials[selectedId] : undefined;

  const run = (label: string, fn: () => { ok: boolean; error?: { message: string } }) => {
    const r = fn();
    setNotice(r.ok ? `${label}已办妥。` : `${label}未成：${r.error?.message ?? "未知缘由"}`);
  };

  if (selected) {
    return (
      <div className="officials-screen">
        <OfficialDetail db={db} state={state} officialId={selected.id} onBack={() => { setSelectedId(null); setNotice(null); }} />
        <OfficialActions
          db={db}
          state={state}
          official={selected}
          onDismiss={() => run("罢免", () => store.dismissOfficial(selected.id))}
          onRestore={() => run("起复", () => store.restoreOfficial(selected.id))}
          onApprove={() => run("准告老", () => store.approveRetirement(selected.id))}
          onRetain={() => run("挽留", () => store.retainRetirement(selected.id))}
          onAssign={(postId) => run(postId ? "调任" : "卸任", () => store.assignOfficialPost(db, selected.id, postId))}
        />
        {notice && <p className="officials-screen__notice" role="status">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="officials-screen">
      <header className="officials-screen__header">
        <button type="button" className="officials-screen__back" onClick={onBack}>← 返回宣政殿</button>
        <h2 className="officials-screen__title">官员名册</h2>
      </header>

      {highVacancies.length > 0 && !vacancySnoozed && (
        <div className="officials-screen__vacancy" role="status">
          <span>陛下，{highVacancies.length} 处要职现已空缺，是否择人补任？</span>
          <span className="officials-screen__vacancy-actions">
            <button type="button" onClick={() => { setTab("posts"); }}>立即处理</button>
            <button type="button" onClick={() => setVacancySnoozed(true)}>稍后</button>
          </span>
        </div>
      )}

      <nav className="officials-screen__tabs" aria-label="名册/官位表">
        <button type="button" className={tab === "roster" ? "is-active" : ""} onClick={() => setTab("roster")}>名册</button>
        <button type="button" className={tab === "posts" ? "is-active" : ""} onClick={() => setTab("posts")}>官位表</button>
      </nav>

      {tab === "roster" ? (
        <RosterTab db={db} state={state} statusFilter={statusFilter} onFilter={setStatusFilter} onSelect={setSelectedId} nameOf={nameOf} />
      ) : (
        <PostTable db={db} state={state} />
      )}
      {notice && <p className="officials-screen__notice" role="status">{notice}</p>}
    </div>
  );
}

// ── 名册（按状态筛选，部门分组） ──────────────────────────────────────────
function RosterTab({
  db, state, statusFilter, onFilter, onSelect, nameOf,
}: {
  db: ContentDB;
  state: ReturnType<typeof useGameState>;
  statusFilter: OfficialStatus;
  onFilter: (s: OfficialStatus) => void;
  onSelect: (id: string) => void;
  nameOf: (o: Official) => string;
}) {
  const officials = getOfficialsByStatus(state, statusFilter);
  const grouped = useMemo(() => {
    const m = new Map<OfficialDepartment, Official[]>();
    for (const o of officials) {
      const dept = (o.postId ? db.officialPosts[o.postId]?.department : undefined) ?? "none";
      (m.get(dept) ?? m.set(dept, []).get(dept)!).push(o);
    }
    return m;
  }, [officials, db]);

  return (
    <>
      <nav className="officials-screen__filters" aria-label="状态筛选">
        {STATUS_TABS.map((s) => (
          <button key={s} type="button" className={s === statusFilter ? "is-active" : ""} onClick={() => onFilter(s)}>
            {OFFICIAL_STATUS_LABEL[s]}（{getOfficialsByStatus(state, s).length}）
          </button>
        ))}
      </nav>
      {officials.length === 0 ? (
        <p className="officials-screen__empty">暂无{OFFICIAL_STATUS_LABEL[statusFilter]}官员。</p>
      ) : (
        DEPARTMENT_ORDER.filter((d) => grouped.has(d)).map((dept) => (
          <section key={dept} className="officials-screen__group">
            <h4 className="officials-screen__group-title">{DEPARTMENT_LABEL[dept]}</h4>
            <ul className="officials-screen__list">
              {grouped.get(dept)!
                .slice()
                .sort((a, b) => (db.officialPosts[b.postId ?? ""]?.gradeOrder ?? -1) - (db.officialPosts[a.postId ?? ""]?.gradeOrder ?? -1))
                .map((o) => {
                  const post = o.postId ? db.officialPosts[o.postId] : undefined;
                  return (
                    <li key={o.id}>
                      <button type="button" className="officials-screen__row" onClick={() => onSelect(o.id)}>
                        <span className="officials-screen__row-name">{nameOf(o)}</span>
                        <span className="officials-screen__row-post">{post ? `${post.grade}·${post.name}` : "（无职）"}</span>
                        <span className="officials-screen__row-meta">年{o.age}</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

// ── 官位表（按部门，显示占用/空缺/几席在任） ─────────────────────────────
function PostTable({ db, state }: { db: ContentDB; state: ReturnType<typeof useGameState> }) {
  const posts = Object.values(db.officialPosts).filter((p) => p.gradeOrder > 0);
  const byDept = new Map<OfficialDepartment, typeof posts>();
  for (const p of posts) (byDept.get(p.department) ?? byDept.set(p.department, []).get(p.department)!).push(p);

  return (
    <div className="officials-screen__posts">
      {DEPARTMENT_ORDER.filter((d) => byDept.has(d)).map((dept) => (
        <section key={dept} className="officials-screen__group">
          <h4 className="officials-screen__group-title">{DEPARTMENT_LABEL[dept]}</h4>
          <ul className="officials-screen__list">
            {byDept.get(dept)!
              .slice()
              .sort((a, b) => b.gradeOrder - a.gradeOrder)
              .map((p) => {
                const occ = getPostOccupancy(state, db, p.id);
                const vacant = getVacantSeatCount(state, db, p.id);
                const occupants = Object.values(state.officials).filter((o) => o.status === "active" && o.postId === p.id);
                const high = vacant > 0 && p.gradeOrder >= 13;
                return (
                  <li key={p.id} className={`officials-screen__post-row${high ? " is-vacant-high" : ""}`}>
                    <span className="officials-screen__post-name">{p.grade}·{p.name}</span>
                    <span className="officials-screen__post-occ">
                      {p.seatCount > 1 ? `${occ} / ${p.seatCount} 在任` : occupants[0] ? `${occupants[0].surname}${occupants[0].givenName}` : "空缺"}
                      {p.seatCount === 1 && vacant > 0 ? "" : ""}
                    </span>
                    {vacant > 0 && <span className="officials-screen__post-vacant">空 {vacant}</span>}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── 详情操作（按状态/未决告老条件渲染按钮 + 调任空缺选择） ────────────────
function OfficialActions({
  db, state, official, onDismiss, onRestore, onApprove, onRetain, onAssign,
}: {
  db: ContentDB;
  state: ReturnType<typeof useGameState>;
  official: Official;
  onDismiss: () => void;
  onRestore: () => void;
  onApprove: () => void;
  onRetain: () => void;
  onAssign: (postId: string | null) => void;
}) {
  const [transferOpen, setTransferOpen] = useState(false);
  const pendingRetire = hasPendingRetirement(state, official.id);
  const vacant = getVacantPosts(state, db);

  if (official.status === "dead") {
    return <section className="officials-screen__actions"><p className="officials-screen__empty">已故，无可任免。</p></section>;
  }

  return (
    <section className="officials-screen__actions" aria-label="任免操作">
      {pendingRetire && (
        <div className="officials-screen__action-row">
          <span className="officials-screen__action-hint">告老请辞</span>
          <button type="button" onClick={onApprove}>准其告老</button>
          <button type="button" onClick={onRetain}>挽留一年</button>
        </div>
      )}
      {official.status === "active" && (
        <div className="officials-screen__action-row">
          {official.postId !== null && <button type="button" onClick={onDismiss}>免职</button>}
          <button type="button" onClick={() => setTransferOpen((v) => !v)}>{official.postId ? "调任" : "任命"}</button>
        </div>
      )}
      {(official.status === "retired" || official.status === "imprisoned" || official.status === "exiled") && (
        <div className="officials-screen__action-row">
          <button type="button" onClick={onRestore}>起复（恢复可任用）</button>
        </div>
      )}
      {transferOpen && official.status === "active" && (
        <div className="officials-screen__transfer">
          <p className="officials-screen__action-hint">选空缺官职授任：</p>
          {vacant.length === 0 ? (
            <p className="officials-screen__empty">当前无空缺官职。</p>
          ) : (
            <ul className="officials-screen__list">
              {vacant.map((v) => {
                const p = db.officialPosts[v.postId]!;
                return (
                  <li key={v.postId}>
                    <button type="button" className="officials-screen__row" onClick={() => { onAssign(v.postId); setTransferOpen(false); }}>
                      <span className="officials-screen__row-name">{p.grade}·{p.name}</span>
                      <span className="officials-screen__row-meta">空 {v.vacantSeatCount}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
