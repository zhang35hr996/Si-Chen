/**
 * Canonical consistency validator — pure functions that power `knowledge:validate`.
 *
 * All functions are exported so tests can call the real production logic directly
 * instead of re-implementing it.  The CLI in tools/knowledge-validate.ts reads
 * files, calls these functions, and exits with a non-zero code on errors.
 *
 * Security invariants:
 *  - No file paths, API keys, or secrets in returned messages.
 *  - All inputs are pure data; no I/O here.
 */
import { extractHeadingAnchor } from "../ingestion/markdown";
import type { CharacterRank } from "../../content/schemas";

export interface ValidationFinding {
  kind: "error" | "warning";
  code: string;
  message: string;
}

export interface RankValidationInput {
  ranks: CharacterRank[];
}

export interface DocumentValidationInput {
  /** Document source content (raw Markdown with YAML frontmatter). */
  content: string;
  /** Short label for messages (filename, not full path). */
  label: string;
  /** True for production corpus files; false for test fixtures. */
  requireAnchors: boolean;
}

// ── Rank registry validation ────────────────────────────────────────────────

/**
 * Validate canonical rank integrity:
 * - All IDs are unique
 * - All non-deprecated names are unique
 * - All orders are unique within each domain
 * - Alias global uniqueness: no term appears in both a name and another rank's alias/deprecatedAlias
 */
export function validateCanonicalRanks(ranks: CharacterRank[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  const ids = new Map<string, string>();
  const activeNames = new Map<string, string>();
  const ordersByDomain = new Map<string, Map<number, string>>();
  const termRegistry = new Map<string, { rankId: string; kind: string }>();

  for (const rank of ranks) {
    // ID uniqueness
    if (ids.has(rank.id)) {
      findings.push({ kind: "error", code: "DUPLICATE_RANK_ID", message: `Duplicate rank id: ${rank.id}` });
    }
    ids.set(rank.id, rank.name);

    // Name uniqueness (active ranks only)
    if (!rank.deprecated) {
      if (activeNames.has(rank.name)) {
        findings.push({ kind: "error", code: "DUPLICATE_RANK_NAME", message: `Duplicate non-deprecated rank name: ${rank.name}` });
      }
      activeNames.set(rank.name, rank.id);
    }

    // Order uniqueness per domain
    if (!ordersByDomain.has(rank.domain)) ordersByDomain.set(rank.domain, new Map());
    const domainOrders = ordersByDomain.get(rank.domain)!;
    if (domainOrders.has(rank.order)) {
      findings.push({
        kind: "error",
        code: "DUPLICATE_RANK_ORDER",
        message: `Duplicate order ${rank.order} in domain "${rank.domain}": ${rank.id} and ${domainOrders.get(rank.order)}`,
      });
    }
    domainOrders.set(rank.order, rank.id);

    // Build term registry for cross-rank alias checks
    const register = (term: string, kind: string) => {
      const existing = termRegistry.get(term);
      if (existing && existing.rankId !== rank.id) {
        findings.push({
          kind: "error",
          code: "AMBIGUOUS_TERM",
          message: `Term "${term}" (${kind}) on rank ${rank.id} conflicts with ${existing.kind} on rank ${existing.rankId}`,
        });
      } else {
        termRegistry.set(term, { rankId: rank.id, kind });
      }
    };

    register(rank.name, "name");
    for (const alias of rank.aliases) register(alias, "alias");
    for (const da of rank.deprecatedAliases) register(da, "deprecatedAlias");

    // Intra-rank: alias duplication inside the same rank
    const intraTerms = new Set<string>();
    for (const term of [rank.name, ...rank.aliases, ...rank.deprecatedAliases]) {
      if (intraTerms.has(term)) {
        findings.push({ kind: "error", code: "INTRA_RANK_DUPLICATE", message: `Term "${term}" appears more than once on rank ${rank.id}` });
      }
      intraTerms.add(term);
    }

    // Alias must not overlap with deprecatedAlias on the same rank
    const aliasSet = new Set(rank.aliases);
    for (const da of rank.deprecatedAliases) {
      if (aliasSet.has(da)) {
        findings.push({
          kind: "error",
          code: "ALIAS_DEPRECATED_CONFLICT",
          message: `"${da}" appears in both aliases and deprecatedAliases on rank ${rank.id}`,
        });
      }
    }
  }

  return findings;
}

// ── Document-level validation ────────────────────────────────────────────────

/**
 * Validate a single Markdown lore document:
 * - All H2/H3 headings must carry a stable {#anchor} (when requireAnchors=true)
 * - No duplicate anchors within the document
 * - Anchor format is valid (starts with letter, only [a-z0-9-])
 * - No forbidden placeholder keywords in body text
 */
export function validateLoreDocument(input: DocumentValidationInput): ValidationFinding[] {
  const { content, label, requireAnchors } = input;
  const findings: ValidationFinding[] = [];

  const FORBIDDEN = ["TODO", "TBD", "【待定】", "暂定原则"];
  const seenAnchors = new Set<string>();
  let inBody = false;
  let frontmatterClosed = false;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Frontmatter boundary detection
    if (i === 0 && line.trimEnd() === "---") continue;
    if (!frontmatterClosed && line.trimEnd() === "---") {
      frontmatterClosed = true;
      inBody = true;
      continue;
    }
    if (!inBody) continue;

    // Check headings
    const h2m = /^## (.+)/.exec(line);
    const h3m = /^### (.+)/.exec(line);
    const headingRaw = h2m?.[1] ?? h3m?.[1];
    if (headingRaw !== undefined) {
      const { anchor, text } = extractHeadingAnchor(headingRaw.trim());

      if (anchor !== undefined) {
        // Validate anchor format (redundant with regex, but explicit)
        if (!/^[a-z][a-z0-9-]*$/.test(anchor)) {
          findings.push({
            kind: "error",
            code: "INVALID_ANCHOR_FORMAT",
            message: `${label}: anchor "${anchor}" has invalid format (must match [a-z][a-z0-9-]*)`,
          });
        }
        // Duplicate anchor within document
        if (seenAnchors.has(anchor)) {
          findings.push({
            kind: "error",
            code: "DUPLICATE_ANCHOR",
            message: `${label}: duplicate anchor {#${anchor}}`,
          });
        }
        seenAnchors.add(anchor);
      } else if (requireAnchors) {
        // Production heading without anchor
        findings.push({
          kind: "error",
          code: "MISSING_ANCHOR",
          message: `${label}: heading "${text}" has no stable {#anchor-id}`,
        });
      }
    }

    // Forbidden keywords in body
    for (const kw of FORBIDDEN) {
      if (line.includes(kw)) {
        findings.push({
          kind: "error",
          code: "FORBIDDEN_KEYWORD",
          message: `${label}:${i + 1}: forbidden keyword "${kw}" in production corpus`,
        });
        break; // one per line
      }
    }
  }

  return findings;
}

/**
 * Scan lore body text for usage of deprecated terms.
 * Returns a finding for each deprecated term found in the text.
 */
export function validateLoreBodyForDeprecatedTerms(
  bodyText: string,
  label: string,
  deprecatedTerms: string[],
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const term of deprecatedTerms) {
    if (bodyText.includes(term)) {
      findings.push({
        kind: "error",
        code: "DEPRECATED_TERM_IN_LORE",
        message: `${label}: deprecated term "${term}" found in lore body`,
      });
    }
  }
  return findings;
}

/**
 * Collect all deprecated terms from rank data:
 * - deprecatedAliases from all ranks
 * - name of any rank with deprecated: true
 */
export function collectDeprecatedTerms(ranks: CharacterRank[]): string[] {
  const terms: string[] = [];
  for (const rank of ranks) {
    terms.push(...rank.deprecatedAliases);
    if (rank.deprecated) terms.push(rank.name);
  }
  return [...new Set(terms)];
}
