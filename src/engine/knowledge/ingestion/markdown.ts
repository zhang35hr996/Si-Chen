/**
 * Markdown lore document ingestion.
 *
 * Each document has a YAML-like frontmatter block (between --- delimiters)
 * followed by Markdown body.  The body is split into semantic chunks at
 * level-2 (##) and level-3 (###) headings.
 *
 * Chunking rules:
 *  - Content before the first heading → "_intro" chunk (if non-empty).
 *  - Each heading + its body text → one chunk (inherits document metadata).
 *  - If a section body exceeds ~400 characters, it is split at paragraph
 *    boundaries (blank lines) deterministically.  Never splits mid-sentence.
 *  - Empty sections (no text after trimming) are discarded.
 *  - Stable ID = "${docId}#${headingText}" (or "${docId}#${headingText}:${n}"
 *    for split sub-chunks).  The intro uses "${docId}#_intro".
 *
 * Frontmatter format (YAML-subset, no external dependency):
 * ```
 * ---
 * id: etiquette.confinement
 * sourceType: etiquette
 * title: 禁足期间的宫廷礼制
 * tags:
 *   - etiquette
 * entityIds: []
 * locationIds: []
 * visibility: public
 * validFromYear: 3      # optional — all three required together
 * validFromMonth: 1
 * validFromPeriod: early
 * validUntilYear: 10
 * validUntilMonth: 12
 * validUntilPeriod: late
 * ---
 * ```
 */
import { makeGameTime } from "../../calendar/time";
import { contentError, type GameError } from "../../infra/errors";
import { err, ok, type Result } from "../../infra/result";
import { knowledgeFrontmatterSchema, type KnowledgeFrontmatter } from "../schema";
import type { KnowledgeChunkInput } from "../model";

/** Approximate soft limit for a single chunk body (characters, not tokens). */
const CHUNK_SOFT_LIMIT = 800;

/** Minimum text length to form a standalone chunk. */
const MIN_CHUNK_LENGTH = 10;

export function parseMarkdownLore(
  content: string,
  sourcePath: string,
): Result<KnowledgeChunkInput[], GameError[]> {
  const errors: GameError[] = [];

  // ── 1. Split frontmatter and body ────────────────────────────────────
  const fmResult = splitFrontmatter(content, sourcePath);
  if (!fmResult.ok) {
    return err([fmResult.error]);
  }
  const { rawFrontmatter, body } = fmResult.value;

  // ── 2. Parse frontmatter ─────────────────────────────────────────────
  const fmDataResult = parseFrontmatterYaml(rawFrontmatter, sourcePath);
  if (!fmDataResult.ok) {
    return err([fmDataResult.error]);
  }
  const fmData = fmDataResult.value;

  const fmParsed = knowledgeFrontmatterSchema.safeParse(fmData);
  if (!fmParsed.success) {
    const issues = fmParsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    errors.push(
      contentError("SCHEMA", `[knowledge] ${sourcePath}: frontmatter invalid: ${issues}`),
    );
    return err(errors);
  }
  const fm = fmParsed.data;

  // ── 3. Build shared metadata ──────────────────────────────────────────
  const validFrom = buildGameTime(
    fm.validFromYear,
    fm.validFromMonth,
    fm.validFromPeriod,
    "validFrom",
    sourcePath,
    errors,
  );
  const validUntil = buildGameTime(
    fm.validUntilYear,
    fm.validUntilMonth,
    fm.validUntilPeriod,
    "validUntil",
    sourcePath,
    errors,
  );
  if (errors.length > 0) return err(errors);

  // ── 4. Semantic splitting ─────────────────────────────────────────────
  const sections = splitIntoSections(body);
  const inputs: KnowledgeChunkInput[] = [];

  for (const section of sections) {
    const text = section.text.trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;

    const headingKey = section.heading ?? "_intro";
    const paragraphs = splitParagraphs(text);

    if (paragraphs.length === 0) continue;

    // Group paragraphs into sub-chunks that stay under CHUNK_SOFT_LIMIT
    const subChunks = groupParagraphsIntoSubChunks(paragraphs, CHUNK_SOFT_LIMIT);

    subChunks.forEach((chunkText, idx) => {
      const trimmed = chunkText.trim();
      if (trimmed.length < MIN_CHUNK_LENGTH) return;

      const id =
        subChunks.length === 1
          ? `${fm.id}#${headingKey}`
          : `${fm.id}#${headingKey}:${idx}`;

      const chunkTitle =
        section.heading !== undefined
          ? `${fm.title} — ${section.heading}`
          : fm.title;

      inputs.push({
        id,
        sourceType: fm.sourceType,
        title: chunkTitle,
        text: trimmed,
        tags: [...fm.tags],
        entityIds: [...fm.entityIds],
        locationIds: [...fm.locationIds],
        ...(validFrom !== undefined ? { validFrom } : {}),
        ...(validUntil !== undefined ? { validUntil } : {}),
        visibility: fm.visibility,
        sourcePath,
      });
    });
  }

  if (inputs.length === 0) {
    errors.push(
      contentError(
        "EMPTY_DOCUMENT",
        `[knowledge] ${sourcePath}: no extractable chunks (all sections empty or too short)`,
      ),
    );
    return err(errors);
  }

  return ok(inputs);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface FrontmatterSplit {
  rawFrontmatter: string;
  body: string;
}

function splitFrontmatter(
  content: string,
  sourcePath: string,
): Result<FrontmatterSplit, GameError> {
  const lines = content.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return err(
      contentError(
        "MISSING_FRONTMATTER",
        `[knowledge] ${sourcePath}: document must start with ---`,
      ),
    );
  }
  const closingIdx = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (closingIdx === -1) {
    return err(
      contentError(
        "MISSING_FRONTMATTER",
        `[knowledge] ${sourcePath}: no closing --- found for frontmatter`,
      ),
    );
  }
  const rawFrontmatter = lines.slice(1, closingIdx).join("\n");
  const body = lines.slice(closingIdx + 1).join("\n");
  return ok({ rawFrontmatter, body });
}

interface Section {
  heading: string | undefined; // undefined = intro
  text: string;
}

/** Split Markdown body into sections by ## and ### headings. */
function splitIntoSections(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | undefined = undefined;
  let currentLines: string[] = [];

  const flush = (): void => {
    sections.push({ heading: currentHeading, text: currentLines.join("\n") });
  };

  for (const line of lines) {
    const h2 = /^## (.+)/.exec(line);
    const h3 = /^### (.+)/.exec(line);
    const heading = (h2 ?? h3)?.[1]?.trim();
    if (heading !== undefined) {
      flush();
      currentHeading = heading;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

/** Split text into paragraphs at blank lines. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Group paragraphs into sub-chunks.  Each sub-chunk stays under softLimit
 * characters where possible; a single paragraph that exceeds softLimit is
 * kept as one chunk (never split mid-sentence).
 */
function groupParagraphsIntoSubChunks(
  paragraphs: string[],
  softLimit: number,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const para of paragraphs) {
    if (currentLen > 0 && currentLen + para.length + 2 > softLimit) {
      chunks.push(current.join("\n\n"));
      current = [para];
      currentLen = para.length;
    } else {
      current.push(para);
      currentLen += para.length + (currentLen > 0 ? 2 : 0);
    }
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }
  return chunks;
}

// ── Frontmatter YAML parser ───────────────────────────────────────────────────

/**
 * Minimal YAML-subset parser for knowledge frontmatter.
 * Handles: scalars, arrays (block and inline `[]`), and integer values.
 * No external dependency.
 */
function parseFrontmatterYaml(
  raw: string,
  sourcePath: string,
): Result<Record<string, unknown>, GameError> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    i++;

    // Skip blank lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trimEnd();
    const restTrimmed = rest.trim();

    if (key === "") continue;

    // Inline empty array
    if (restTrimmed === "[]") {
      result[key] = [];
      continue;
    }

    // Block array — next lines start with "  -"
    if (restTrimmed === "") {
      const items: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        const itemMatch = /^ {2}-\s*(.*)$/.exec(next) ?? /^\s*-\s*(.*)$/.exec(next);
        if (itemMatch) {
          items.push(itemMatch[1]!.trim());
          i++;
        } else {
          break;
        }
      }
      if (items.length > 0) {
        // Try to parse as numbers; fall back to strings
        result[key] = items.map((v) => parseScalar(v));
      }
      continue;
    }

    // Inline value
    result[key] = parseScalar(restTrimmed);
  }

  // Validate that we got at least some expected keys
  if (Object.keys(result).length === 0) {
    return err(
      contentError(
        "EMPTY_FRONTMATTER",
        `[knowledge] ${sourcePath}: frontmatter parsed to empty object`,
      ),
    );
  }

  return ok(result);
}

function parseScalar(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  const n = Number(v);
  if (!isNaN(n) && v !== "") return n;
  // Strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Build a GameTime from flat frontmatter fields. Returns undefined if all absent; errors if partial. */
function buildGameTime(
  year: number | undefined,
  month: number | undefined,
  period: KnowledgeFrontmatter["validFromPeriod"],
  fieldPrefix: string,
  sourcePath: string,
  errors: GameError[],
) {
  const defined = [year, month, period].filter((v) => v !== undefined).length;
  if (defined === 0) return undefined;
  if (defined < 3) {
    errors.push(
      contentError(
        "PARTIAL_GAME_TIME",
        `[knowledge] ${sourcePath}: ${fieldPrefix} requires year, month, and period together`,
      ),
    );
    return undefined;
  }
  return makeGameTime(year!, month!, period!);
}
