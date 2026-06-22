/**
 * Deterministic character/style PROXY scorers (PR3).
 *
 * These are explainable lexical/structural PROXIES — NOT a semantic judgment of
 * whether a line "really sounds like" the character. They never call a model and
 * are eval/report-only: they run after an EvalResult exists and never gate,
 * degrade, or influence generation. (Semantic consistency would be a separate,
 * optional LLM judge — out of scope here.)
 *
 * Naming discipline: the exported scores are characterProxyScore / styleProxyScore.
 * Do NOT describe these as "true consistency".
 *
 * Each scorer returns { score in [0,1], signals }, where every signal carries its
 * weight, value, and human-readable evidence so the number is traceable.
 */
import { findAnachronisms, REGISTER_MARKERS } from "./styleLexicon";
import type { EvalResult } from "./types";

export interface Signal {
  name: string;
  weight: number;
  value: number; // 0..1
  evidence: string;
}
export interface ProxyScore {
  score: number; // weighted mean of signal values, 0..1
  signals: Signal[];
}

export interface SpeakerProfile {
  /** The speaker's own self-reference terms (e.g. 「侍身」). */
  selfRefs: string[];
  /** How the speaker should address the player (世界规则：对皇帝称「陛下」). */
  addressTerm: string;
  /** Checkable quirk lexemes (『…』-quoted tokens). Empty → quirk signal not_scorable. */
  quirkLexemes: string[];
  /** Topics the speaker avoids; surfacing one penalizes the character proxy. */
  tabooTopics: string[];
  register: "formal" | "casual" | "rough" | "poetic";
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function weightedScore(signals: Signal[]): number {
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  if (totalWeight === 0) return 0;
  return clamp01(signals.reduce((s, x) => s + x.weight * x.value, 0) / totalWeight);
}

function lineTexts(results: EvalResult[]): string[] {
  return results.map((r) => r.text ?? "");
}

function hasFinding(results: EvalResult[], gate: string): boolean {
  return results.some((r) => r.textFindings.some((f) => f.gate === gate));
}

/**
 * Markers that declare an UNCONDITIONAL fixed phrase (the character always uses
 * it). Only quirks containing one of these contribute a mandatory lexeme.
 */
const FIXED_QUIRK_MARKERS = ["自称", "称玩家", "常说", "口头禅"];
/**
 * Conditional markers ("偶尔/失落时/…"): the『…』inside describes something said
 * only under a condition, so it must NOT be treated as a per-turn requirement.
 */
const CONDITIONAL_QUIRK_MARKERS = ["偶尔", "有时", "失落时", "动情时", "生气时", "私下", "脱口而出"];

/**
 * Extract only MANDATORY 『…』 lexemes from free-form quirk strings: a quirk
 * qualifies when it declares a fixed phrase (FIXED_QUIRK_MARKERS) and is not
 * gated by a condition (CONDITIONAL_QUIRK_MARKERS). e.g. 「自称『侍身』」→ 侍身,
 * but 「失落时偶尔会脱口而出『曾经』」→ (ignored, conditional). Conditional or
 * undeclared quotes are skipped so the character isn't penalized for not saying
 * them in ordinary turns.
 */
export function extractQuirkLexemes(quirks: string[]): string[] {
  const out: string[] = [];
  for (const q of quirks) {
    if (CONDITIONAL_QUIRK_MARKERS.some((c) => q.includes(c))) continue;
    if (!FIXED_QUIRK_MARKERS.some((mk) => q.includes(mk))) continue;
    const re = /『([^』]+)』/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) out.push(m[1]!);
  }
  return out;
}

export function characterProxyScore(resultsForSpeaker: EvalResult[], profile: SpeakerProfile): ProxyScore {
  const texts = lineTexts(resultsForSpeaker);

  // 1. self-ref correctness (reuses the self_ref gate)
  const selfRefFinding = hasFinding(resultsForSpeaker, "self_ref");
  const usesOwnSelfRef = profile.selfRefs.length > 0 && texts.some((t) => profile.selfRefs.some((s) => t.includes(s)));
  const selfRefValue = selfRefFinding ? 0 : usesOwnSelfRef ? 1 : 0.5;
  const selfRefSignal: Signal = {
    name: "self_ref_correctness",
    weight: 0.3,
    value: selfRefValue,
    evidence: selfRefFinding ? "self_ref gate finding present" : usesOwnSelfRef ? "own self-ref used" : "no own self-ref observed",
  };

  // 2. player-address correctness. A wrong honorific (rank_title gate) → 0; the
  // expected address actually observed → 1; no address at all → 0.5 (no evidence
  // either way — not full marks). Lines need not address the player every turn.
  const rankTitleFinding = hasFinding(resultsForSpeaker, "rank_title");
  const usesExpectedAddress = texts.some((t) => t.includes(profile.addressTerm));
  const addressSignal: Signal = {
    name: "address_correctness",
    weight: 0.2,
    value: rankTitleFinding ? 0 : usesExpectedAddress ? 1 : 0.5,
    evidence: rankTitleFinding
      ? "rank_title gate finding present"
      : usesExpectedAddress
        ? `expected address ${profile.addressTerm} observed`
        : "no player address observed",
  };

  // 3. checkable quirk adherence (only MANDATORY 『…』 lexemes). With no scorable
  // lexemes this is not_scorable → weight 0 so it neither inflates nor deflates
  // the score (weightedScore renormalizes over the remaining weight). Note: a
  // lexeme equal to a selfRef/addressTerm is also counted by signals 1/2 — an
  // accepted, small double-weight for declared signature phrases.
  const hasQuirks = profile.quirkLexemes.length > 0;
  const presentQuirks = profile.quirkLexemes.filter((q) => texts.some((t) => t.includes(q)));
  const missingQuirks = profile.quirkLexemes.filter((q) => !presentQuirks.includes(q));
  const quirkSignal: Signal = {
    name: "quirk_adherence",
    weight: hasQuirks ? 0.2 : 0,
    value: hasQuirks ? presentQuirks.length / profile.quirkLexemes.length : 0,
    evidence: !hasQuirks
      ? "not_scorable (no mandatory quirk lexemes)"
      : missingQuirks.length === 0
        ? "all quirk lexemes present"
        : `missing: ${missingQuirks.join("、")}`,
  };

  // 4. taboo avoidance
  const raisedTaboos = profile.tabooTopics.filter((t) => texts.some((line) => line.includes(t)));
  const tabooSignal: Signal = {
    name: "taboo_avoidance",
    weight: 0.15,
    value: raisedTaboos.length === 0 ? 1 : 0,
    evidence: raisedTaboos.length === 0 ? "no taboo topics surfaced" : `raised: ${raisedTaboos.join("、")}`,
  };

  // 5. cross-scenario stability — variance of own-self-ref presence across lines.
  // Needs ≥2 lines to be measurable; with <2 it is not_scorable → weight 0 (a
  // single line is NOT evidence of stability).
  const presence: number[] = texts.map((t) => (profile.selfRefs.some((s) => t.includes(s)) ? 1 : 0));
  const measurable = presence.length >= 2;
  const p = presence.length > 0 ? presence.reduce((s, x) => s + x, 0) / presence.length : 0;
  const variance = presence.length > 0 ? presence.reduce((s, x) => s + (x - p) * (x - p), 0) / presence.length : 0;
  const stabilityValue = clamp01(1 - 4 * variance); // boolean variance maxes at 0.25 → maps to 0
  const stabilitySignal: Signal = {
    name: "cross_scenario_stability",
    weight: measurable ? 0.15 : 0,
    value: measurable ? stabilityValue : 0,
    evidence: measurable
      ? `self-ref present in ${presence.reduce((s, x) => s + x, 0)}/${presence.length} lines`
      : "not_scorable (<2 lines)",
  };

  const signals = [selfRefSignal, addressSignal, quirkSignal, tabooSignal, stabilitySignal];
  return { score: weightedScore(signals), signals };
}

export function styleProxyScore(resultsForSpeaker: EvalResult[], profile: SpeakerProfile): ProxyScore {
  const texts = lineTexts(resultsForSpeaker);
  const lineCount = Math.max(1, texts.length);

  // 1. anachronism absence
  const allHits = texts.flatMap((t) => findAnachronisms(t));
  const anachronismSignal: Signal = {
    name: "anachronism_absence",
    weight: 0.5,
    value: allHits.length === 0 ? 1 : clamp01(1 - allHits.length / lineCount),
    evidence: allHits.length === 0 ? "no modern terms" : `modern terms: ${[...new Set(allHits)].join("、")}`,
  };

  // 2. register congruence vs the declared voice.register
  const markers = REGISTER_MARKERS[profile.register];
  const anyExpected = texts.some((t) => markers.expected.some((m) => t.includes(m)));
  const anyIncongruent = texts.some((t) => markers.incongruent.some((m) => t.includes(m)));
  const registerSignal: Signal = {
    name: "register_congruence",
    weight: 0.3,
    value: clamp01(0.5 + (anyExpected ? 0.5 : 0) - (anyIncongruent ? 0.5 : 0)),
    evidence: `register=${profile.register}; expected=${anyExpected}; incongruent=${anyIncongruent}`,
  };

  // 3. length appropriateness
  const meanLen = texts.reduce((s, t) => s + t.length, 0) / lineCount;
  const lengthValue = meanLen >= 8 && meanLen <= 120 ? 1 : meanLen < 8 ? clamp01(meanLen / 8) : clamp01(1 - (meanLen - 120) / 120);
  const lengthSignal: Signal = {
    name: "length_appropriateness",
    weight: 0.2,
    value: lengthValue,
    evidence: `mean line length ${meanLen.toFixed(1)} chars`,
  };

  const signals = [anachronismSignal, registerSignal, lengthSignal];
  return { score: weightedScore(signals), signals };
}
