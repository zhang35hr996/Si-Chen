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

/** Pull 『…』-quoted lexemes out of free-form quirk strings; non-quoted quirks are ignored. */
export function extractQuirkLexemes(quirks: string[]): string[] {
  const out: string[] = [];
  for (const q of quirks) {
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

  // 2. player-address correctness (reuses the rank_title gate)
  const rankTitleFinding = hasFinding(resultsForSpeaker, "rank_title");
  const addressSignal: Signal = {
    name: "address_correctness",
    weight: 0.2,
    value: rankTitleFinding ? 0 : 1,
    evidence: rankTitleFinding ? "rank_title gate finding present" : `addresses player as ${profile.addressTerm}`,
  };

  // 3. checkable quirk adherence (only 『…』 lexemes are scorable)
  let quirkValue: number;
  let quirkEvidence: string;
  if (profile.quirkLexemes.length === 0) {
    quirkValue = 1;
    quirkEvidence = "not_scorable (no quoted quirk lexemes)";
  } else {
    const present = profile.quirkLexemes.filter((q) => texts.some((t) => t.includes(q)));
    quirkValue = present.length / profile.quirkLexemes.length;
    const missing = profile.quirkLexemes.filter((q) => !present.includes(q));
    quirkEvidence = missing.length === 0 ? "all quirk lexemes present" : `missing: ${missing.join("、")}`;
  }
  const quirkSignal: Signal = { name: "quirk_adherence", weight: 0.2, value: quirkValue, evidence: quirkEvidence };

  // 4. taboo avoidance
  const raisedTaboos = profile.tabooTopics.filter((t) => texts.some((line) => line.includes(t)));
  const tabooSignal: Signal = {
    name: "taboo_avoidance",
    weight: 0.15,
    value: raisedTaboos.length === 0 ? 1 : 0,
    evidence: raisedTaboos.length === 0 ? "no taboo topics surfaced" : `raised: ${raisedTaboos.join("、")}`,
  };

  // 5. cross-scenario stability — variance of own-self-ref presence across the speaker's lines
  const presence: number[] = texts.map((t) => (profile.selfRefs.some((s) => t.includes(s)) ? 1 : 0));
  const p = presence.length > 0 ? presence.reduce((s, x) => s + x, 0) / presence.length : 0;
  const variance = presence.length > 0 ? presence.reduce((s, x) => s + (x - p) * (x - p), 0) / presence.length : 0;
  const stabilityValue = clamp01(1 - 4 * variance); // boolean variance maxes at 0.25 → maps to 0
  const stabilitySignal: Signal = {
    name: "cross_scenario_stability",
    weight: 0.15,
    value: stabilityValue,
    evidence: presence.length <= 1 ? "single line (trivially stable)" : `self-ref present in ${presence.reduce((s, x) => s + x, 0)}/${presence.length} lines`,
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
