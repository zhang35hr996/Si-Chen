/**
 * Derive per-speaker SpeakerProfile records from loaded content, for the proxy
 * scorers (PR3). Pure: (ContentDB) → Record<speakerId, SpeakerProfile>. Self-refs
 * come from the speaker's rank (位分 selfRefs) when ranked, else from the
 * character's own selfRefs (尊长). Used by tools/eval-report.ts.
 */
import type { ContentDB } from "../../content/loader";
import { extractQuirkLexemes, type SpeakerProfile } from "./consistencyProxy";

export function buildSpeakerProfiles(db: ContentDB): Record<string, SpeakerProfile> {
  const out: Record<string, SpeakerProfile> = {};
  for (const [id, char] of Object.entries(db.characters)) {
    const rankSelfRefs = char.initialStanding?.rank ? db.ranks[char.initialStanding.rank]?.selfRefs : undefined;
    const sr = rankSelfRefs ?? char.selfRefs;
    const selfRefs = sr ? [...sr.toPlayer, ...sr.formal, ...(sr.informal ?? [])] : [];
    out[id] = {
      selfRefs,
      addressTerm: "陛下", // 世界规则：对皇帝一律称「陛下」
      quirkLexemes: extractQuirkLexemes(char.voice.quirks),
      tabooTopics: char.voice.tabooTopics,
      register: char.voice.register,
    };
  }
  return out;
}
