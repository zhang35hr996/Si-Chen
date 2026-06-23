/**
 * 侍君详情抽屉（§六）。右侧宽抽屉 + 标签页，取代居中小弹窗承担"查看详情"。
 * 只绑定真实数据模型字段。暗属性（情意/恐惧/野心/母家忠心/母家权势）开发期全显示，
 * 正式版改 ??? 由血滴子解锁（见 docs/systems/21-attribute-catalog.md）。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { getCharacterLocation } from "../../engine/characters/presence";
import { familyText, maternalLoyalty, maternalPower } from "../../engine/officials/derive";
import { Drawer } from "./Drawer";
import { DescriptorStat } from "./DescriptorStat";
import { PregnancyStatusChip } from "./PregnancyStatusChip";
import { consortGestationDisplay } from "../format/gestationDisplay";

type Tab = "overview" | "attrs" | "history" | "children" | "relations";

export function effectiveAffection(
  hidden: { affection: number },
  standing?: { affection?: number },
): number {
  return standing?.affection ?? hidden.affection;
}

const TABS: Array<[Tab, string]> = [
  ["overview", "总览"],
  ["attrs", "属性"],
  ["history", "经历"],
  ["children", "子嗣"],
  ["relations", "关系"],
];

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function CharacterProfileDrawer({
  db,
  state,
  character,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  character: CharacterContent;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const standing = state.standing[character.id];
  const pregnancy = consortGestationDisplay(state, character.id); // 孕情：唯一权威孕月来源
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const attrs = character.attributes;
  const homeId = getCharacterLocation(db, state, character.id);
  const home = homeId ? db.locations[homeId]?.name : undefined;
  const displayName = character.profile.name; // 抽屉标题显本名；位分见 subtitle
  const heirs = state.resources.bloodline.heirs.filter(
    (h) => h.fatherId === character.id || h.adoptiveFatherId === character.id,
  );
  const memories = state.memories[character.id]?.entries ?? [];

  const subtitle = `${rank ? rank.name : character.kind === "official" ? "官员" : "尊长"}${home ? ` · ${home}` : ""}`;

  const tabsBar = (
    <>
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className="drawer__tab"
          aria-selected={tab === id}
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </>
  );

  return (
    <Drawer title={displayName} subtitle={subtitle} tabs={tabsBar} onClose={onClose}>
      {tab === "overview" && (
        <div className="profile-section">
          <h3 className="profile-h">身份</h3>
          <dl className="profile-fields">
            <Field label="年龄" value={`${character.profile.age}`} />
            {rank && <Field label="位分" value={rank.name} />}
            {standing?.title && <Field label="封号" value={standing.title} />}
            {home && <Field label="住处" value={home} />}
            <Field label="身份" value={character.profile.role} />
            {pregnancy && <Field label="孕育" value={pregnancy.label} />}
          </dl>
          <h3 className="profile-h">性情</h3>
          <div className="profile-tags">
            {character.profile.personalityTraits.map((t) => (
              <span key={t} className="profile-tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {tab === "attrs" && (
        <div className="profile-section">
          {attrs ? (
            <>
              <h3 className="profile-h">才貌</h3>
              <DescriptorStat label="容貌" scale="appearance" value={attrs.appearance} />
              <Field label="家世" value={familyText(db, state, character)} />
              <dl className="profile-fields">
                <Field label="特长" value={attrs.specialty} />
                <Field label="喜好" value={attrs.likes.join("、")} />
              </dl>
              <h3 className="profile-h">身体</h3>
              <DescriptorStat label="健康" scale="health" value={attrs.health} />
              {pregnancy && (
                <p className="profile-field profile-field--pregnancy">
                  <span className="profile-field__label">孕育</span>
                  <PregnancyStatusChip label={pregnancy.label} />
                </p>
              )}
            </>
          ) : (
            <p className="profile-empty">此人无养成属性。</p>
          )}
          {character.hidden && (
            <>
              <h3 className="profile-h">暗属性（开发期可见）</h3>
              <DescriptorStat label="情意" scale="affection" value={effectiveAffection(character.hidden, standing)} />
              <DescriptorStat label="恐惧" scale="fear" value={character.hidden.fear} />
              <DescriptorStat label="野心" scale="ambition" value={character.hidden.ambition} kind="consort" />
              <DescriptorStat label="母家忠心" scale="loyalty" value={maternalLoyalty(state, character)} />
              <DescriptorStat label="母家权势" scale="power" value={maternalPower(db, state, character)} />
            </>
          )}
          <h3 className="profile-h">与皇帝</h3>
          {standing ? <DescriptorStat label="恩宠" scale="favor" value={standing.favor} kind="consort" /> : <p className="profile-empty">尚未查明。</p>}
        </div>
      )}

      {tab === "history" && (
        <div className="profile-section">
          {memories.length === 0 ? (
            <p className="profile-empty">暂无记述。</p>
          ) : (
            <ul className="profile-log">
              {[...memories]
                .sort((a, b) => b.createdAt.dayIndex - a.createdAt.dayIndex)
                .map((m) => (
                  <li key={m.id} className="profile-log__item">
                    {m.summary}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {tab === "children" && (
        <div className="profile-section">
          {heirs.length === 0 ? (
            <p className="profile-empty">暂无子嗣。</p>
          ) : (
            <ul className="profile-children">
              {heirs.map((h) => (
                <li key={h.id} className="profile-children__item">
                  <span className="profile-children__name">
                    {h.givenName || h.petName || "未命名"}
                  </span>
                  <span className="profile-children__meta">
                    {h.sex === "daughter" ? "皇子" : "皇郎"}
                    {h.adoptiveFatherId === character.id ? " · 承养" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "relations" && (
        <div className="profile-section">
          {character.stances && character.stances.length > 0 ? (
            <ul className="profile-relations">
              {character.stances.map((s) => {
                const other = db.characters[s.charId];
                const otherStanding = state.standing[s.charId] ?? other?.initialStanding;
                const otherRank = otherStanding ? db.ranks[otherStanding.rank] : undefined;
                const who = other?.profile.name ?? s.charId;
                return (
                  <li key={s.charId} className="profile-relation">
                    <span className="profile-relation__who">
                      {who}
                      {otherRank ? ` · ${otherRank.name}` : ""}
                    </span>
                    <span className="profile-relation__attitude">{s.attitude}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="profile-empty">暂无与他人的关系记述。</p>
          )}
        </div>
      )}
    </Drawer>
  );
}
