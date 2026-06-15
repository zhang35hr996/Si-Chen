/**
 * Dialogue TEXT gates (skeleton-plan §8 "Gate boundary, P1").
 *
 * These validate provider output TEXT ONLY — forbidden lexicon, self-reference
 * correctness, unauthorized rank/title terms, leaked template tokens. ALL
 * numeric/state validation (delta clamps, illegal fields, resource/rank typing)
 * lives in engine/effects (PR 6) and is tested there. Keeping the dialogue seam
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
   * Wrong honorifics for the 皇帝. The world's one rule (lexicon.styleRules) is
   * 「对皇帝一律称『陛下』」; styleRules are unstructured prose the engine can't
   * parse, so this is a small v0 watch-list of common WRONG forms. Terms also in
   * forbiddenTerms are dropped here so they fire under forbidden_lexicon only.
   */
  wrongPlayerHonorifics: string[];
}

const MIN_SELF_REF_LEN = 2;

/** v0 heuristic watch-list — see TextGateContext.wrongPlayerHonorifics. */
const WRONG_PLAYER_HONORIFICS = ["皇上", "圣上", "万岁爷", "万岁", "圣驾"];

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

/** Assemble the gate context for one speaker from the loaded content. */
export function buildTextGateContext(db: ContentDB, speakerRankId: string): TextGateContext {
  const forbidden = db.lexicon.forbiddenTerms;

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
    wrongPlayerHonorifics: WRONG_PLAYER_HONORIFICS.filter((t) => !forbidden.includes(t)),
  };
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

  for (const term of ctx.forbiddenTerms) {
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
    for (const term of ctx.wrongPlayerHonorifics) {
      if (text.includes(term)) {
        findings.push({
          gate: "rank_title",
          severity: "reject",
          message: `the 皇帝 is addressed as 「陛下」, never 「${term}」`,
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
