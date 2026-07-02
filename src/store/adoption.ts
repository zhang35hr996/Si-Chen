/** 奉先殿择养父：候选池、生父可依性、谢恩/司礼官播报（脚本台词）。 */
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { CharacterContent } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

const SEX_CHILD: Record<Heir["sex"], string> = { daughter: "皇子", son: "皇郎" };

function nameOf(db: ContentDB, state: GameState, charId: string): string {
  const c = db.characters[charId];
  if (!c) return charId;
  const st = state.standing[charId];
  return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
}

/** 养父候选：在宫(非冷宫)、非已故的侍君（含皇后）及尊长（太后）。 */
export function eligibleAdoptiveFathers(db: ContentDB, state: GameState): CharacterContent[] {
  // Consorts are procedurally generated into state.generatedConsorts; elders (太后) stay
  // in db.characters. Consider both so generated consorts can be adoptive fathers.
  const candidates = [...Object.values(db.characters), ...Object.values(state.generatedConsorts)];
  return candidates.filter((c) => {
    if (c.kind !== "consort" && c.kind !== "elder") return false;
    if (c.defaultLocation === "changmengong") return false;
    if (state.standing[c.id]?.lifecycle === "deceased") return false;
    return true;
  });
}

/** 生父是否仍可依（存活 + 在宫非冷宫）。自孕(fatherId null)恒 false。 */
export function bioFatherAvailable(db: ContentDB, state: GameState, heir: Heir): boolean {
  if (heir.fatherId === null) return false;
  const c = db.characters[heir.fatherId] ?? state.generatedConsorts[heir.fatherId];
  if (!c || c.kind !== "consort") return false;
  if (c.defaultLocation === "changmengong") return false;
  return state.standing[heir.fatherId]?.lifecycle !== "deceased";
}

export interface AdoptionLine {
  speakerId: string;
  lines: string[];
}

/** 择养父后的播报：养父谢恩；若生父尚在宫中，加司礼官「生父泪如雨下」。
 *  若养父为尊长（太后），单段欣然，无谢恩、无生父泪报。
 */
export function buildAdoptionReaction(
  db: ContentDB,
  state: GameState,
  heir: Heir,
  fatherId: string,
): AdoptionLine[] {
  const fatherChar = db.characters[fatherId] ?? state.generatedConsorts[fatherId];
  if (fatherChar?.kind === "elder") {
    const child = SEX_CHILD[heir.sex];
    const pronoun = heir.sex === "daughter" ? "她" : "他";
    return [
      {
        speakerId: fatherId,
        lines: [`太后闻陛下择其抚育皇嗣，含笑颔首：好，这${child}就交给哀家，定当悉心教养，看着${pronoun}长大成人。`],
      },
    ];
  }
  const child = SEX_CHILD[heir.sex];
  const adoptive = nameOf(db, state, fatherId);
  const thanks: AdoptionLine = {
    speakerId: fatherId,
    lines: [
      `${adoptive}闻陛下择其抚育皇嗣，喜出望外，趋前叩谢天恩。`,
      `${adoptive}哽咽叩首：侍定当视如己出，倾心教养这${child}，不负陛下托付。`,
    ],
  };
  if (bioFatherAvailable(db, state, heir)) {
    return [
      thanks,
      {
        speakerId: "wei_sui",
        lines: [`司礼官低声回禀：择养父之事已告宗庙。臣听闻……那位侍君闻讯，独坐宫中，泪如雨下，嗓子都哑了。`],
      },
    ];
  }
  return [thanks];
}
