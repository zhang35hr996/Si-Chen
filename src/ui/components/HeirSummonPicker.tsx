/** 召见皇嗣选择器：列出当前在世皇嗣，玩家选定后由父层播放入场反应。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { heirAge, heirPortraitSet, heirStage, listHeirsBySex } from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { Heir, GameState } from "../../engine/state/types";

export interface HeirSummonResult {
  heirId: string;
  /** 年龄阶段：infant/toddler = 幼小（旁白），schooling = 说台词。 */
  isInfant: boolean;
  heirDisplayName: string;
  portraitSrc: string | undefined;
  heirSex: "daughter" | "son";
}

export function HeirSummonPicker({
  db,
  state,
  registry,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  onPick: (result: HeirSummonResult) => void;
  onClose: () => void;
}) {
  const allHeirs = [
    ...listHeirsBySex(state.resources.bloodline.heirs, "daughter"),
    ...listHeirsBySex(state.resources.bloodline.heirs, "son"),
  ].filter(({ heir }) => heir.lifecycle === "alive");

  const custodianName = (heir: Heir): string | undefined => {
    const custId = heir.adoptiveFatherId;
    if (!custId) return undefined;
    const c = db.characters[custId] ?? state.generatedConsorts[custId];
    if (!c) return custId;
    const st = state.standing[custId];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };

  const pick = ({ heir, name }: { heir: Heir; name: string }) => {
    const stage = heirStage(heir, state.calendar);
    const portraitKey = heirPortraitSet(heir, state.calendar);
    // 皇嗣无独立 portraitSet 字符串，按 portraitKey 查注册表（child_baby / child_school）。
    const portraitSrc = registry.portrait(portraitKey, "neutral").url;
    onPick({
      heirId: heir.id,
      isInfant: stage === "infant" || stage === "toddler",
      heirDisplayName: name,
      portraitSrc,
      heirSex: heir.sex,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>召见皇嗣</h2>
        {allHeirs.length === 0 ? (
          <p>当前无皇嗣可召见。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {allHeirs.map(({ heir, name }) => {
              const age = heirAge(heir, state.calendar);
              const custodian = custodianName(heir);
              return (
                <li key={heir.id} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => pick({ heir, name })}
                  >
                    <span>{name}</span>
                    {heir.givenName && <span>·{heir.givenName}</span>}
                    <span>　{age}岁</span>
                    {custodian && <span>　由{custodian}抚养</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="action-btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

/** 根据年龄阶段生成入场台词或旁白（speakerId 始终是字符串，婴幼期借乘风叙述）。 */
export function buildHeirSummonReaction(result: HeirSummonResult): { speakerId: string; lines: string[] } {
  if (result.isInfant) {
    const noun = result.heirSex === "daughter" ? "皇子" : "皇郎";
    return {
      speakerId: "cheng_feng", // 由乘风代为旁白
      lines: [`乳父将${result.heirDisplayName}抱来，${noun}睁着好奇的眼睛望着陛下，咿呀作声。`],
    };
  }
  return {
    speakerId: result.heirId,
    lines: ["儿臣参见母皇。"],
  };
}
