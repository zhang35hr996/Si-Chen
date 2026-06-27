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
   * Honorifics permitted in inner-quarters registers (private/intimate) but
   * forbidden in all other registers (court, public, or default).
   * 「皇上」 is the canonical example: acceptable in bedchamber daily speech,
   * rejected in court audiences and outer-palace public scenes.
   * Checked whenever register is NOT private/intimate.
   */
  courtRestrictedHonorifics: string[];
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
   * Forbidden terms lifted for this specific (speaker × target × register) triple.
   * Computed by resolveAddress and set by the orchestrator on the NPC gate context.
   * Always empty for player choice gate contexts — NPC address permissions must
   * not bleed into player-authored choice text.
   *
   * Example: 「凤君」 for 皇后 addressing the emperor in a private register.
   */
  privateAllowedTerms: string[];
}

const MIN_SELF_REF_LEN = 2;
/** Registers that permit informal emperor address (皇上, 凤君). Must mirror addressResolver's PRIVATE_REGISTERS. */
const PRIVATE_REGISTERS = new Set(["private", "intimate"]);

/** v0 heuristic watch-list — globally wrong forms only; 圣上 is blocked via contextForbiddenRefs (target-scoped by resolver). */
const WRONG_PLAYER_HONORIFICS: string[] = [];

/**
 * 「皇上」 is acceptable inner-quarters address (private/intimate) but forbidden in any
 * non-private register (court, public, or unset default).
 * 「万岁」 is a legitimate court cheer (朝贺山呼) — not in this list.
 * 「圣上/今上/圣驾」 are solemn third-person references blocked when target=emperor via
 * contextForbiddenRefs (set by orchestrator from resolvedAddress.forbiddenInContext);
 * they are NOT blocked globally since non-emperor-target dialogue legitimately uses them.
 */
const EMPEROR_NON_PRIVATE_RESTRICTED: string[] = ["皇上"];

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
 * `privateAllowedTerms` is NOT set here — it is populated by the orchestrator
 * from resolvedAddress.liftedForbiddenTerms after calling resolveAddress with
 * the register and addressPermissions. This keeps target-scoping out of the
 * gate and in the resolver where it belongs.
 *
 * @param speakerRankId  The speaker's current harem rank ID (or "__elder__").
 * @param register       Scene register. Defaults to "public" (fail-closed).
 */
export function buildTextGateContext(
  db: ContentDB,
  speakerRankId: string,
  register: SceneRegister = "public",
): TextGateContext {
  const forbidden = db.lexicon.forbiddenTerms;
  const forbiddenSet = new Set(forbidden);

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
    courtRestrictedHonorifics: EMPEROR_NON_PRIVATE_RESTRICTED.filter((t) => !forbiddenSet.has(t)),
    contextForbiddenRefs: [],
    register,
    privateAllowedTerms: [], // set externally by orchestrator from resolvedAddress.liftedForbiddenTerms
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

  // privateAllowedTerms is already fully resolved (speaker × target × register) by
  // resolveAddress before reaching the gate. No register check needed here.
  const exempted = new Set(ctx.privateAllowedTerms);

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

  // Non-private register check: 皇上 is inner-quarters address only.
  // Block it in court, public, and any unset/default register.
  if (!PRIVATE_REGISTERS.has(ctx.register)) {
    for (const term of ctx.courtRestrictedHonorifics) {
      if (text.includes(term)) {
        findings.push({
          gate: "rank_title",
          severity: "reject",
          message: `「${term}」 is inner-quarters address only — use 陛下 in ${ctx.register} register`,
          matched: term,
        });
      }
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
