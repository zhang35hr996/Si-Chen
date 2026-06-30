/** 御书房·查看子嗣：皇子/皇郎两表；点名字钻取详情（立绘按年龄/属性/召见）。查看零行动点。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime } from "../../engine/calendar/time";
import {
  heirAge,
  heirAgeMonths,
  heirPortraitSet,
  heirStage,
  isEnrolled,
  listHeirsBySex,
  type NamedHeir,
} from "../../engine/characters/heirs";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { getBiologicalParents } from "../../engine/characters/parentage/parentageSelectors";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, Heir } from "../../engine/state/types";
import { describe } from "../format/descriptors";
import { HealthStatusChip } from "./HealthStatusChip";

export function HeirListModal({
  db,
  state,
  registry,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  onClose: () => void;
}) {
  const heirs = state.resources.bloodline.heirs;
  const named: NamedHeir[] = [
    ...listHeirsBySex(heirs, "daughter"),
    ...listHeirsBySex(heirs, "son"),
  ];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = named.find((n) => n.heir.id === selectedId) ?? null;

  const nameOf = (charId: string): string => {
    const c = db.characters[charId];
    if (!c) return charId;
    const st = state.standing[charId];
    return resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined);
  };

  const bearerLabel = (h: Heir): string => {
    // 生父以 parentage 为唯一权威（不读 Heir.fatherId 镜像）。
    // 显式区分「无 parentage 记录（损坏状态）」与「生父为 null（自孕）」——
    // 不得用 ?? null 把缺失静默解释成自孕（Slice A 禁止 undefined→null 合并）。
    const parents = getBiologicalParents(state, h.id);
    if (!parents) return "亲缘数据缺失";
    const fatherId = parents.fatherId;
    if (fatherId === null) return "自孕";
    const c = db.characters[fatherId];
    if (!c) return fatherId;
    const st = state.standing[fatherId];
    const name = resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined);
    return st?.lifecycle === "deceased" ? `${name}（已故）` : name;
  };

  const renderTable = (sex: "daughter" | "son", title: string) => {
    const rows = named.filter((n) => n.heir.sex === sex);
    return (
      <section className="heir-list__table">
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="heir-list__empty">暂无。</p>
        ) : (
          <ul>
            {rows.map(({ heir, name }) => (
              <li key={heir.id} className="heir-list__row">
                <button
                  type="button"
                  className="heir-list__pick"
                  onClick={() => setSelectedId(heir.id)}
                >
                  <span className="heir-list__name">
                    {name}
                    {heir.legitimate ? "（嫡）" : ""}：{heir.givenName ?? (heir.petName || "—")}
                  </span>
                  <span className="heir-list__age">{heirAge(heir, state.calendar)}岁</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const renderDetail = (sel: NamedHeir) => {
    const h = sel.heir;
    const portrait = registry.portrait(heirPortraitSet(h, state.calendar), "neutral");
    const stage = heirStage(h, state.calendar);
    const ageLabel =
      stage === "schooling"
        ? `${heirAge(h, state.calendar)}岁`
        : `${heirAge(h, state.calendar)}岁（${heirAgeMonths(h, state.calendar)}月龄）`;
    return (
      <div className="heir-detail">
        <img
          className="heir-detail__portrait"
          src={portrait.url}
          alt={sel.name}
          data-fallback={portrait.isFallback || undefined}
        />
        <div className="heir-detail__body">
          <h3 className="heir-detail__name">
            {sel.name}
            {h.legitimate ? "（嫡）" : ""}
          </h3>
          <p className="heir-detail__field">名讳：{h.givenName ?? "未赐名"}
            {h.petName ? `（小名 ${h.petName}）` : ""}</p>
          <p className="heir-detail__field">年龄：{ageLabel}</p>
          <p className="heir-detail__field">生辰：{formatGameTime(h.birthAt)}</p>
          <p className="heir-detail__field">承嗣：{bearerLabel(h)}</p>
          {h.custodianId && (
            <p className="heir-detail__field">养父：{nameOf(h.custodianId)}</p>
          )}
          <p className="heir-detail__field">健康：{describe("health", h.health)}　<HealthStatusChip status={h.healthStatus ?? "healthy"} health={h.health} /></p>
          <p className="heir-detail__field">宠爱：{describe("favor", h.favor, "heir")}</p>
          <p className="heir-detail__field">天赋：{describe("talent", h.talent)}</p>
          <p className="heir-detail__field">努力：{describe("effort", h.diligence)}</p>
          {isEnrolled(h, state.calendar) && (
            <p className="heir-detail__field">
              政治：{describe("statecraft", h.education.scholarship)}・武力：{describe("martial", h.education.martial)}・道德：{describe("virtue", h.education.virtue)}
            </p>
          )}
          <p className="heir-detail__field">野心：{describe("ambition", h.ambition, "heir")}</p>
          <p className="heir-detail__field">亲近：{describe("closeness", h.closeness)}</p>
          <p className="heir-detail__field">继位支持：{describe("support", h.support)}</p>
          <div className="heir-detail__actions">
            <button type="button" onClick={() => setSelectedId(null)}>
              返回
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>皇嗣</h2>
        {selected ? (
          renderDetail(selected)
        ) : (
          <>
            {renderTable("daughter", "皇子")}
            {renderTable("son", "皇郎")}
          </>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
