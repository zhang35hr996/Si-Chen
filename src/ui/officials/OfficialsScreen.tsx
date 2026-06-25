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
  getVacantSeatCount,
  hasPendingRetirement,
} from "../../engine/officials/selectors";
import { getLatestAnnualReview } from "../../engine/officials/annualReview";
import { OfficialDetail } from "./OfficialDetail";
import { officialPostView } from "./postDisplay";
import { DEPARTMENT_LABEL, OFFICIAL_STATUS_LABEL, PERSONNEL_CHANGE_LABEL } from "./labels";

export interface OfficialsScreenProps {
  db: ContentDB;
  store: GameStore;
  onBack: () => void;
  /** 任免成功提交后回调（App 用于 autosave，使决定持久化）。 */
  onCommitted: () => void;
}

/** 名册状态筛选页（默认在任）。 */
const STATUS_TABS: OfficialStatus[] = ["active", "retired", "imprisoned", "exiled", "dead"];

const DEPARTMENT_ORDER: OfficialDepartment[] = [
  "chancellery", "personnel", "revenue", "rites", "military",
  "justice", "works", "censorate", "academy", "provincial", "none",
];

export function OfficialsScreen({ db, store, onBack, onCommitted }: OfficialsScreenProps) {
  const state = useGameState(store);
  const [tab, setTab] = useState<"roster" | "posts" | "review">("roster");
  const [statusFilter, setStatusFilter] = useState<OfficialStatus>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [vacancySnoozed, setVacancySnoozed] = useState(false);

  const nameOf = (o: Official) => `${o.surname}${o.givenName}`;
  const highVacancies = getHighVacancyPosts(state, db);

  // 选中官员若已不存在则回名册。
  const selected = selectedId ? state.officials[selectedId] : undefined;

  // 成功才 autosave（onCommitted）并提示；失败仅提示、不持久化。返回是否成功，供调任列表据此关闭。
  const run = (label: string, fn: () => { ok: boolean; error?: { message: string } }): boolean => {
    const r = fn();
    if (!r.ok) {
      setNotice(`${label}未成：${r.error?.message ?? "未知缘由"}`);
      return false;
    }
    onCommitted();
    setNotice(`${label}已办妥。`);
    return true;
  };

  if (selected) {
    return (
      <div className="officials-screen">
        <OfficialDetail db={db} state={state} officialId={selected.id} onBack={() => { setSelectedId(null); setNotice(null); }} />
        <OfficialActions
          state={state}
          official={selected}
          onRestore={() => run("起复", () => store.restoreOfficial(selected.id))}
          onApprove={() => run("准告老", () => store.approveRetirement(selected.id))}
          onRetain={() => run("挽留", () => store.retainRetirement(selected.id))}
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

      <nav className="officials-screen__tabs" aria-label="名册/官位表/人事简报">
        <button type="button" className={tab === "roster" ? "is-active" : ""} onClick={() => setTab("roster")}>名册</button>
        <button type="button" className={tab === "posts" ? "is-active" : ""} onClick={() => setTab("posts")}>官位表</button>
        <button type="button" className={tab === "review" ? "is-active" : ""} onClick={() => setTab("review")}>人事简报</button>
      </nav>

      {tab === "roster" ? (
        <RosterTab db={db} state={state} statusFilter={statusFilter} onFilter={setStatusFilter} onSelect={setSelectedId} nameOf={nameOf} />
      ) : tab === "posts" ? (
        <PostTable db={db} state={state} />
      ) : (
        <ReviewTab db={db} state={state} />
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
      const dept = officialPostView(db, state, o).dept; // 非在任也按原任部门归组
      (m.get(dept) ?? m.set(dept, []).get(dept)!).push(o);
    }
    return m;
  }, [officials, db, state]);

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
                .sort((a, b) => officialPostView(db, state, b).gradeOrder - officialPostView(db, state, a).gradeOrder)
                .map((o) => {
                  const pv = officialPostView(db, state, o);
                  return (
                    <li key={o.id}>
                      <button type="button" className="officials-screen__row" onClick={() => onSelect(o.id)}>
                        <span className="officials-screen__row-name">{nameOf(o)}</span>
                        <span className="officials-screen__row-post">{pv.label}</span>
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
/**
 * 详情操作（PR3C-2 起，名册不再开放玩家自由调任/免职——常规人事由吏部考课自动进行；皇帝亲发的惩戒性
 * 处置走事件/PUNISH，见 PR3C-3）。此处仅保留对官员自发请求的裁决：准告老/挽留，以及起复。
 */
function OfficialActions({
  state, official, onRestore, onApprove, onRetain,
}: {
  state: ReturnType<typeof useGameState>;
  official: Official;
  onRestore: () => void;
  onApprove: () => void;
  onRetain: () => void;
}) {
  const pendingRetire = hasPendingRetirement(state, official.id);

  if (official.status === "dead") {
    return <section className="officials-screen__actions"><p className="officials-screen__empty">已故，无可裁决。</p></section>;
  }

  const canRestore = official.status === "retired" || official.status === "imprisoned" || official.status === "exiled";
  if (!pendingRetire && !canRestore) {
    return <section className="officials-screen__actions"><p className="officials-screen__empty">常规迁转由吏部考课自动进行，无需在此处置。</p></section>;
  }

  return (
    <section className="officials-screen__actions" aria-label="裁决">
      {pendingRetire && (
        <div className="officials-screen__action-row">
          <span className="officials-screen__action-hint">告老请辞</span>
          <button type="button" onClick={onApprove}>准其告老</button>
          <button type="button" onClick={onRetain}>挽留一年</button>
        </div>
      )}
      {canRestore && (
        <div className="officials-screen__action-row">
          <button type="button" onClick={onRestore}>起复（恢复可任用）</button>
        </div>
      )}
    </section>
  );
}

// ── 人事简报（吏部考课只读结果） ─────────────────────────────────────────────
function ReviewTab({ db, state }: { db: ContentDB; state: ReturnType<typeof useGameState> }) {
  const review = getLatestAnnualReview(state);
  if (!review) return <p className="officials-screen__empty">尚无吏部考课简报。</p>;
  const postLabel = (postId: string | null) => (postId ? `${db.officialPosts[postId]?.grade ?? ""}·${db.officialPosts[postId]?.name ?? postId}` : "无职");
  const nameForChange = (id: string) => { const o = state.officials[id]; return o ? `${o.surname}${o.givenName}` : id; };
  return (
    <div className="officials-screen__review">
      <h4 className="officials-screen__group-title">{review.year} 年吏部考课</h4>
      {review.changes.length === 0 ? (
        <p className="officials-screen__empty">本年无人事变动。</p>
      ) : (
        <ul className="officials-screen__list">
          {review.changes.map((c, i) => (
            <li key={i} className="officials-screen__review-row">
              <span className="officials-screen__row-name">{nameForChange(c.officialId)}</span>
              <span className="officials-screen__row-post">{PERSONNEL_CHANGE_LABEL[c.kind]}</span>
              <span className="officials-screen__row-meta">{postLabel(c.fromPostId)} → {postLabel(c.toPostId)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
