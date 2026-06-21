/** 御书房·查看侍君：宫中侍君列表；点名字钻取详情（属性/恩宠/抚养皇嗣/封号管理/召见）。查看零行动点。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { toGameTime } from "../../engine/calendar/time";
import { computeFavorStats, FAVOR_TIER_LABEL } from "../../engine/characters/favorTier";
import { listHeirsBySex } from "../../engine/characters/heirs";
import { inPalaceConsorts } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { bedchamberConfig } from "../../store/bedchamber";
import { ATTRIBUTE_LABELS } from "./CharacterCard";
import { describe } from "../format/descriptors";
import type { ScaleId } from "../format/descriptors";

export function ConsortListModal({
  db,
  state,
  registry,
  sovereignPregnant,
  onManage,
  onRelocate,
  onSummon,
  onAddCandidate,
  onRemoveCandidate,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  sovereignPregnant: boolean;
  onManage: (charId: string) => void;
  onRelocate: (charId: string) => void;
  onSummon: (charId: string) => void;
  onAddCandidate: (charId: string) => void;
  onRemoveCandidate: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = inPalaceConsorts(db, state);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = consorts.find((c) => c.id === selectedId) ?? null;

  // 抚养皇嗣名号查表（按性别出生序编号）。
  const heirs = state.resources.bloodline.heirs;
  const heirNameById = new Map<string, string>();
  for (const sex of ["daughter", "son"] as const) {
    for (const { heir, name } of listHeirsBySex(heirs, sex)) heirNameById.set(heir.id, name);
  }

  const renderRow = (c: CharacterContent) => {
    const st = state.standing[c.id]!;
    const lc = st.lifecycle;
    const lifecycleSuffix =
      lc === "carrying" ? "·承嗣君·怀胎"
      : lc === "delivered" ? "·育嗣君"
      : lc === "candidate" ? "·候选承嗣"
      : "";
    return (
      <li key={c.id} className="consort-list__row">
        <button type="button" className="consort-list__pick" onClick={() => setSelectedId(c.id)}>
          <span className="consort-list__name">{c.profile.name}</span>
          <span className="consort-list__rank">
            {db.ranks[st.rank]?.name}
            {st.title ? `·封号「${st.title}」` : ""}
            {lifecycleSuffix}
          </span>
        </button>
      </li>
    );
  };

  const renderDetail = (c: CharacterContent) => {
    const st = state.standing[c.id]!;
    const portrait = registry.portrait(c.portraitSet, "neutral");
    const favor = computeFavorStats(
      state.bedchamber[c.id],
      toGameTime(state.calendar),
      bedchamberConfig(db).tiers,
    );
    const raised = heirs.filter((h) => h.fatherId === c.id || h.adoptiveFatherId === c.id);
    const isEmpress = c.id === "shen_zhibai";
    const lc = st.lifecycle;
    return (
      <div className="consort-detail">
        <img
          className="consort-detail__portrait"
          src={portrait.url}
          alt={c.profile.name}
          data-fallback={portrait.isFallback || undefined}
        />
        <div className="consort-detail__body">
          <h3 className="consort-detail__name">{c.profile.name}</h3>
          <p className="consort-detail__field">
            位分：{db.ranks[st.rank]?.name}
            {st.title ? `　封号：${st.title}` : ""}
          </p>
          <p className="consort-detail__field">{c.profile.role}</p>
          {c.attributes && (
            <dl className="consort-detail__attrs">
              {ATTRIBUTE_LABELS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{describe(key as ScaleId, c.attributes![key]!)}</dd>
                </div>
              ))}
              <div>
                <dt>特长</dt>
                <dd>{c.attributes.specialty}</dd>
              </div>
              <div>
                <dt>喜好</dt>
                <dd>{c.attributes.likes.join("、")}</dd>
              </div>
            </dl>
          )}
          <p className="consort-detail__field">
            恩宠：{FAVOR_TIER_LABEL[favor.tier]}　侍寝 月{favor.lastMonth}·季{favor.lastThreeMonths}·年
            {favor.lastYear}
          </p>
          <p className="consort-detail__field">
            抚养皇嗣：
            {raised.length === 0
              ? "无"
              : raised.map((h) => heirNameById.get(h.id) ?? h.id).join("、")}
          </p>
          <div className="consort-detail__actions">
            <button type="button" onClick={() => onSummon(c.id)}>
              召见
            </button>
            {!isEmpress && (
              <button type="button" onClick={() => onManage(c.id)}>
                封号管理
              </button>
            )}
            {!isEmpress && (
              <button type="button" onClick={() => onRelocate(c.id)}>
                搬迁
              </button>
            )}
            {sovereignPregnant && lc === "candidate" && (
              <button type="button" onClick={() => onRemoveCandidate(c.id)}>
                取消候选
              </button>
            )}
            {sovereignPregnant && (lc === undefined || lc === "normal") && (
              <button type="button" onClick={() => onAddCandidate(c.id)}>
                设为候选承嗣
              </button>
            )}
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
      {/* 复用 .heir-list 弹窗外框样式 */}
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>侍君</h2>
        {selected ? (
          renderDetail(selected)
        ) : (
          <ul className="consort-list">{consorts.map(renderRow)}</ul>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
