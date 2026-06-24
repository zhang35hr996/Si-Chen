/**
 * 科举与候补（Phase 3 PR3B）：玩家查看历年科举榜单、候补池，并把 eligible 候补授任到空缺官职。
 *
 * 设计约束：UI 不承担业务计算，只读 state/selector、只调 store 命令；移动端整行可点；成功后经
 * onCommitted 落盘。授官是行政行为，**不算惩罚**。打开榜单经正式命令置 acknowledged（不在 render 写）。
 */
import { useEffect, useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { OfficialCandidate } from "../../engine/state/types";
import {
  getEligibleOfficialCandidates,
  getLatestExaminationResult,
} from "../../engine/officials/examination";
import { getVacantPostsForCandidate } from "../../engine/officials/candidateAppointmentSelectors";
import { APTITUDE_LABEL, CANDIDATE_STATUS_LABEL, DEPARTMENT_LABEL } from "./labels";

export interface ExaminationScreenProps {
  db: ContentDB;
  store: GameStore;
  onBack: () => void;
  /** 授官/查看成功提交后回调（App 用于 autosave）。 */
  onCommitted: () => void;
}

type CandidateSort = "rank" | "year" | "score" | "age";

const examScoreOf = (a: OfficialCandidate["aptitude"]) =>
  a.scholarship * 0.45 + a.governance * 0.25 + a.integrity * 0.2 + a.military * 0.1;

export function ExaminationScreen({ db, store, onBack, onCommitted }: ExaminationScreenProps) {
  const state = useGameState(store);
  const [tab, setTab] = useState<"results" | "pool">("results");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const familyName = (c: OfficialCandidate) =>
    c.familyId ? (state.officialFamilies[c.familyId]?.surname ?? "—") + "氏" : "寒门";
  const nameOf = (c: OfficialCandidate) => `${c.surname}${c.givenName}`;

  const selected = selectedId ? state.officialCandidates[selectedId] : undefined;

  if (selected) {
    return (
      <div className="officials-screen">
        <CandidateDetail
          db={db}
          store={store}
          candidate={selected}
          familyName={familyName(selected)}
          notice={notice}
          onBack={() => { setSelectedId(null); setNotice(null); }}
          onNotice={setNotice}
          onAppointed={(msg) => { setSelectedId(null); setNotice(msg); }} // 回池但保留成功提示
          onCommitted={onCommitted}
        />
      </div>
    );
  }

  return (
    <div className="officials-screen">
      <header className="officials-screen__header">
        <button type="button" className="officials-screen__back" onClick={onBack}>← 返回宣政殿</button>
        <h2 className="officials-screen__title">科举与候补</h2>
      </header>

      <nav className="officials-screen__tabs" aria-label="科举榜单/候补池">
        <button type="button" className={tab === "results" ? "is-active" : ""} onClick={() => setTab("results")}>科举榜单</button>
        <button type="button" className={tab === "pool" ? "is-active" : ""} onClick={() => setTab("pool")}>候补池</button>
      </nav>

      {tab === "results" ? (
        <ResultsTab store={store} state={state} nameOf={nameOf} familyName={familyName} onCommitted={onCommitted} />
      ) : (
        <PoolTab state={state} nameOf={nameOf} familyName={familyName} onSelect={setSelectedId} />
      )}
      {notice && <p className="officials-screen__notice" role="status">{notice}</p>}
    </div>
  );
}

// ── 科举榜单（历年；默认最新；打开置 acknowledged） ──────────────────────────
function ResultsTab({
  store, state, nameOf, familyName, onCommitted,
}: {
  store: GameStore;
  state: ReturnType<typeof useGameState>;
  nameOf: (c: OfficialCandidate) => string;
  familyName: (c: OfficialCandidate) => string;
  onCommitted: () => void;
}) {
  const years = state.examinationResults.map((r) => r.year).sort((a, b) => b - a);
  const latest = getLatestExaminationResult(state)?.year ?? null;
  const [year, setYear] = useState<number | null>(latest);
  const shownYear = year ?? latest;

  // 打开某年榜单 → 正式命令置 acknowledged（幂等），成功后落盘。不在 render 写：用 effect。
  useEffect(() => {
    if (shownYear === null) return;
    const res = state.examinationResults.find((r) => r.year === shownYear);
    if (res && !res.acknowledged) {
      store.acknowledgeExaminationResult(shownYear);
      onCommitted();
    }
  }, [shownYear, state.examinationResults, store, onCommitted]);

  if (shownYear === null) return <p className="officials-screen__empty">尚无科举榜单。</p>;
  const result = state.examinationResults.find((r) => r.year === shownYear)!;
  // 按 candidateIds 顺序（即榜次）展示。
  const ranked = result.candidateIds.map((id) => state.officialCandidates[id]).filter((c): c is OfficialCandidate => !!c);

  return (
    <>
      {years.length > 1 && (
        <nav className="officials-screen__filters" aria-label="科举年份">
          {years.map((y) => (
            <button key={y} type="button" className={y === shownYear ? "is-active" : ""} onClick={() => setYear(y)}>
              {y} 年
            </button>
          ))}
        </nav>
      )}
      <ul className="officials-screen__list">
        {ranked.map((c) => (
          <li key={c.id} className="officials-screen__candidate-row">
            <span className="officials-screen__row-name">第{c.examinationRank}名 {nameOf(c)}</span>
            <span className="officials-screen__row-post">{familyName(c)} · 年{c.age} · {CANDIDATE_STATUS_LABEL[c.status]}</span>
            <span className="officials-screen__row-meta">{aptitudeBrief(c)}</span>
          </li>
        ))}
      </ul>
      <p className="officials-screen__action-hint">本届共 {ranked.length} 人。</p>
    </>
  );
}

// ── 候补池（仅 eligible；可排序；点击进详情） ────────────────────────────────
function PoolTab({
  state, nameOf, familyName, onSelect,
}: {
  state: ReturnType<typeof useGameState>;
  nameOf: (c: OfficialCandidate) => string;
  familyName: (c: OfficialCandidate) => string;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<CandidateSort>("rank");
  const pool = getEligibleOfficialCandidates(state).slice().sort((a, b) => {
    switch (sort) {
      case "year": return b.examinationYear - a.examinationYear || a.examinationRank - b.examinationRank;
      case "score": return examScoreOf(b.aptitude) - examScoreOf(a.aptitude);
      case "age": return a.age - b.age;
      case "rank":
      default: return a.examinationRank - b.examinationRank || b.examinationYear - a.examinationYear;
    }
  });

  const SORTS: { key: CandidateSort; label: string }[] = [
    { key: "rank", label: "按榜次" }, { key: "year", label: "按年份" },
    { key: "score", label: "按综合分" }, { key: "age", label: "按年齿" },
  ];

  return (
    <>
      <nav className="officials-screen__filters" aria-label="候补排序">
        {SORTS.map((s) => (
          <button key={s.key} type="button" className={s.key === sort ? "is-active" : ""} onClick={() => setSort(s.key)}>{s.label}</button>
        ))}
      </nav>
      {pool.length === 0 ? (
        <p className="officials-screen__empty">候补池暂无可授官人选。</p>
      ) : (
        <ul className="officials-screen__list">
          {pool.map((c) => (
            <li key={c.id}>
              <button type="button" className="officials-screen__row" onClick={() => onSelect(c.id)}>
                <span className="officials-screen__row-name">{nameOf(c)}</span>
                <span className="officials-screen__row-post">{familyName(c)} · {c.examinationYear}年第{c.examinationRank}名</span>
                <span className="officials-screen__row-meta">年{c.age}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── 候补详情 + 授官（按适配度排空缺；确认后授官） ────────────────────────────
function CandidateDetail({
  db, store, candidate, familyName, notice, onBack, onNotice, onAppointed, onCommitted,
}: {
  db: ContentDB;
  store: GameStore;
  candidate: OfficialCandidate;
  familyName: string;
  notice: string | null;
  onBack: () => void;
  onNotice: (n: string) => void;
  onAppointed: (msg: string) => void;
  onCommitted: () => void;
}) {
  const state = useGameState(store);
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const vacancies = getVacantPostsForCandidate(state, db, candidate.id);

  const doAppoint = (postId: string) => {
    const r = store.appointOfficialCandidate(db, candidate.id, postId);
    if (!r.ok) {
      onNotice(`授官未成：${r.error?.message ?? "未知缘由"}`); // 失败：不关闭确认、state 不变
      return;
    }
    onCommitted();
    onAppointed(`已授任 ${db.officialPosts[postId]?.name ?? postId}。`); // 回池并保留成功提示
  };

  return (
    <div className="official-detail">
      <button type="button" className="official-detail__back" onClick={onBack}>← 返回候补池</button>
      <h3 className="official-detail__name">{candidate.surname}{candidate.givenName}</h3>
      <p className="official-detail__line">
        {familyName} · 年{candidate.age} · {candidate.examinationYear}年第{candidate.examinationRank}名 · {CANDIDATE_STATUS_LABEL[candidate.status]}
      </p>
      <p className="official-detail__line">{aptitudeBrief(candidate)}</p>

      <section className="officials-screen__actions" aria-label="授官">
        {candidate.status !== "eligible" ? (
          <p className="officials-screen__empty">该候补已不可授官（{CANDIDATE_STATUS_LABEL[candidate.status]}）。</p>
        ) : vacancies.length === 0 ? (
          <p className="officials-screen__empty">当前无空缺官职可授。</p>
        ) : (
          <>
            <p className="officials-screen__action-hint">择空缺官职授任（按适配度）：</p>
            <ul className="officials-screen__list">
              {vacancies.map((v) => {
                const p = db.officialPosts[v.postId]!;
                const confirming = confirmPostId === v.postId;
                return (
                  <li key={v.postId}>
                    {confirming ? (
                      <div className="officials-screen__transfer">
                        <span className="officials-screen__action-hint">授任 {p.grade}·{p.name}？</span>
                        <button type="button" onClick={() => doAppoint(v.postId)}>确认授官</button>
                        <button type="button" onClick={() => setConfirmPostId(null)}>取消</button>
                      </div>
                    ) : (
                      <button type="button" className="officials-screen__row" onClick={() => setConfirmPostId(v.postId)}>
                        <span className="officials-screen__row-name">{p.grade}·{p.name}</span>
                        <span className="officials-screen__row-post">{DEPARTMENT_LABEL[p.department]} · 空 {v.vacantSeatCount}</span>
                        <span className="officials-screen__row-meta">适配 {v.fit}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {notice && <p className="officials-screen__notice" role="status">{notice}</p>}
    </div>
  );
}

function aptitudeBrief(c: OfficialCandidate): string {
  const a = c.aptitude;
  return `${APTITUDE_LABEL.governance}${a.governance} ${APTITUDE_LABEL.scholarship}${a.scholarship} ${APTITUDE_LABEL.military}${a.military} ${APTITUDE_LABEL.integrity}${a.integrity}`;
}
