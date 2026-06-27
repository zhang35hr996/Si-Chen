/**
 * Dialogue TEXT gates (skeleton-plan §8 "Gate boundary, P1").
 *
 * These validate provider output TEXT ONLY — forbidden lexicon, self-reference
 * correctness, unauthorized rank/title terms, leaked template tokens. ALL
 * numeric/state validation (delta clamps, illegal fields, resource/rank typing)
 * lives in engine/effects and is tested there. Keeping the dialogue seam
 * text-only stops a future model's prose problems and its proposed-effect
 * problems from coupling: they are caught by different, independently testable
 * layers.
 *
 * Gates are PURE — (text, context) → findings. They never touch GameState and
 * never call a provider. The orchestrator decides what a finding MEANS (a
 * "reject" finding fails the line; a "flag" finding serves it, marked degraded).
 * Built and unit-tested in PR 11 even though MockProvider output trivially
 * passes them: when a real provider lands it inherits these gates rather than
 * negotiating them.
 */
import type { ContentDB } from "../content/loader";
import type { CharacterRank } from "../content/schemas";
import type { SceneRegister } from "./types";

export type GateId = "forbidden_lexicon" | "self_ref" | "rank_title" | "template_leak";

export interface GateFinding {
  gate: GateId;
  /** "reject": fail the line. "flag": serve it, but mark the line degraded. */
  severity: "reject" | "flag";
  message: string;
  /** The offending substring — surfaced verbatim in diagnostics. */
  matched: string;
}

export interface TextGateContext {
  /** lexicon.forbiddenTerms — banned outright. */
  forbiddenTerms: string[];
  /**
   * Multi-character selfRefs belonging to OTHER ranks (minus any the speaker
   * also legitimately uses). A speaker using one is borrowing another rank's
   * identity. Single-char refs (e.g. 「臣」) are excluded: substring-matching a
   * lone character false-positives on compounds like 大臣/众臣.
   */
  foreignSelfRefs: string[];
  /**
   * Wrong honorifics for the 皇帝. Formal contexts require 陛下; daily speech also
   * permits 皇上/圣上/万岁/圣驾. The gate can't distinguish context, so this
   * watch-list only holds terms that are globally wrong regardless of context.
   * Terms also in forbiddenTerms are dropped so they fire under forbidden_lexicon.
   */
  wrongPlayerHonorifics: string[];
  /**
   * Terms forbidden in THIS SPECIFIC conversational context due to the speaker–target
   * pairing (e.g. 本宫 when addressing someone of equal or higher rank).
   * Populated from resolvedAddress.forbiddenInContext at call time.
   */
  contextForbiddenRefs: string[];
  /**
   * Scene register: "court" / "public" block register-restricted terms;
   * "private" / "intimate" allow them for authorized speakers.
   */
  register: SceneRegister;
  /**
   * Subset of forbiddenTerms this speaker is authorized to use — but only
   * in private / intimate registers. In court or public contexts these terms
   * remain forbidden even for authorized speakers.
   *
   * Populated from the intersection of (rank exemptions + character-level
   * allowedTerms) with lexicon.forbiddenTerms.
   *
   * Example: 「凤君」 for 皇后 — allowed in private but never in court.
   */
  privateAllowedTerms: string[];
}

const MIN_SELF_REF_LEN = 2;

/** v0 heuristic watch-list — globally wrong forms only; context-restricted terms (皇上/圣上/万岁/圣驾) excluded since the gate can't check context. */
const WRONG_PLAYER_HONORIFICS: string[] = [];

/**
 * Rank-level private-term exemptions: terms in forbiddenTerms that a given rank
 * may use in private / intimate registers. Character-level permissions are passed
 * in as speakerAllowedTerms at call time.
 *
 * 凤君 — 皇后 may privately address the emperor this way.
 * Authorized 侍君 / ministers use character-level dialoguePolicy allowedTerms.
 */
const RANK_PRIVATE_EXEMPTIONS: Record<string, string[]> = {
  huanghou: ["凤君"],
};

/** Raw prompt-template tokens that must never survive into player-facing text. */
const TEMPLATE_PATTERNS: RegExp[] = [
  /(?<!\$)\{\{?\s*[\w.]+\s*\}\}?/g, // {token} / {{token}} (but not the {} of ${})
  /\$\{[^}]+\}/g, // ${token}
  /\[\[[^\]]+\]\]/g, // [[token]]
  /<\/?[A-Za-z_][\w.-]*>/g, // <token> / </token>
  /%[sd]\b/g, // printf %s / %d
];

function allSelfRefs(refs: CharacterRank["selfRefs"]): string[] {
  return [...refs.toPlayer, ...refs.formal, ...(refs.informal ?? [])];
}

/**
 * Assemble the gate context for one speaker from the loaded content.
 *
 * @param speakerRankId   The speaker's current harem rank ID (or "__elder__").
 * @param speakerAllowedTerms  Character-level allowedTerms from etiquette
 *   (includes both global approvedTerms and any rank exemptions already merged
 *   by the orchestrator). The gate uses this to populate privateAllowedTerms.
 * @param register  Scene register. Defaults to "private".
 */
export function buildTextGateContext(
  db: ContentDB,
  speakerRankId: string,
  speakerAllowedTerms: string[] = [],
  register: SceneRegister = "private",
): TextGateContext {
  const forbidden = db.lexicon.forbiddenTerms;
  const forbiddenSet = new Set(forbidden);

  // Private-allowed = union of rank exemptions + character-level allowedTerms,
  // intersected with forbiddenTerms (only relevant if they're actually forbidden).
  const rankExemptions = RANK_PRIVATE_EXEMPTIONS[speakerRankId] ?? [];
  const privateAllowed = [...new Set([...rankExemptions, ...speakerAllowedTerms])].filter((t) =>
    forbiddenSet.has(t),
  );

  const own = new Set(db.ranks[speakerRankId] ? allSelfRefs(db.ranks[speakerRankId]!.selfRefs) : []);
  const foreign = new Set<string>();
  for (const [rankId, rank] of Object.entries(db.ranks)) {
    if (rankId === speakerRankId) continue;
    for (const ref of [...rank.selfRefs.toPlayer, ...rank.selfRefs.formal]) {
      if (ref.length >= MIN_SELF_REF_LEN && !own.has(ref)) foreign.add(ref);
    }
  }

  return {
    forbiddenTerms: forbidden,
    foreignSelfRefs: [...foreign],
    wrongPlayerHonorifics: WRONG_PLAYER_HONORIFICS.filter((t) => !forbiddenSet.has(t)),
    contextForbiddenRefs: [],
    register,
    privateAllowedTerms: privateAllowed,
  };
}

/** Terms that a given rank is allowed to use in private / intimate registers. */
export function getRankPrivateExemptions(rankId: string): string[] {
  return RANK_PRIVATE_EXEMPTIONS[rankId] ?? [];
}

export interface ScanOptions {
  /**
   * Skip the speaker-identity gates (self_ref, rank/title self-claim). Used for
   * player CHOICE text, which is the 皇帝's words, not the NPC's — only the
   * content-level gates (forbidden lexicon, template leaks) apply there.
   */
  skipIdentityGates?: boolean;
}

/** Pure scan: returns every gate finding for a single piece of text. */
export function scanDialogueText(
  text: string,
  ctx: TextGateContext,
  options: ScanOptions = {},
): GateFinding[] {
  const findings: GateFinding[] = [];

  // Register-aware exemption: in private/intimate registers, privateAllowedTerms
  // are lifted from the forbidden list for this speaker.
  const isPrivateRegister = ctx.register === "private" || ctx.register === "intimate";
  const exempted = isPrivateRegister ? new Set(ctx.privateAllowedTerms) : new Set<string>();

  for (const term of ctx.forbiddenTerms) {
    if (exempted.has(term)) continue;
    if (text.includes(term)) {
      findings.push({
        gate: "forbidden_lexicon",
        severity: "reject",
        message: `forbidden term 「${term}」`,
        matched: term,
      });
    }
  }

  for (const pattern of TEMPLATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      findings.push({
        gate: "template_leak",
        severity: "reject",
        message: `leaked template token 「${match[0]}」`,
        matched: match[0],
      });
    }
  }

  if (!options.skipIdentityGates) {
    for (const ref of ctx.foreignSelfRefs) {
      if (text.includes(ref)) {
        findings.push({
          gate: "self_ref",
          severity: "reject",
          message: `self-reference 「${ref}」 belongs to another rank`,
          matched: ref,
        });
      }
    }
    for (const ref of ctx.contextForbiddenRefs) {
      if (ref.length >= MIN_SELF_REF_LEN && text.includes(ref)) {
        findings.push({
          gate: "self_ref",
          severity: "reject",
          message: `self-reference 「${ref}」 is forbidden in this conversational context`,
          matched: ref,
        });
      }
    }
    for (const term of ctx.wrongPlayerHonorifics) {
      if (text.includes(term)) {
        findings.push({
          gate: "rank_title",
          severity: "reject",
          message: `globally forbidden honorific 「${term}」 for the 皇帝`,
          matched: term,
        });
      }
    }
  }

  return dedupe(findings);
}

function dedupe(findings: GateFinding[]): GateFinding[] {
  const seen = new Set<string>();
  const out: GateFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.gate}:${finding.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}
