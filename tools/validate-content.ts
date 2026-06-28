/**
 * Content validator CLI (skeleton-plan §3): reads content/, runs the loader,
 * prints every collected error, exits nonzero on any problem. Runs in CI.
 *
 *   npm run validate-content
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatErrorTag, type GameError } from "../src/engine/infra/errors";
import { loadContent, type RawContent, type RawFile } from "../src/engine/content/loader";
import { contentError } from "../src/engine/infra/errors";

export interface DiskContent {
  raw: RawContent;
  /** JSON parse failures — reported alongside loader errors. */
  parseErrors: GameError[];
}

export function readContentDir(rootDir: string): DiskContent {
  const parseErrors: GameError[] = [];

  const readJson = (path: string): RawFile => {
    const source = relative(rootDir, path) || path;
    try {
      return { source: `content/${source}`, data: JSON.parse(readFileSync(path, "utf8")) as unknown };
    } catch (cause) {
      parseErrors.push(
        contentError("SCHEMA", `content/${source}: not valid JSON (${String(cause)})`, {
          context: { file: `content/${source}` },
          cause,
        }),
      );
      return { source: `content/${source}`, data: null };
    }
  };

  const readDir = (dir: string): RawFile[] => {
    const full = join(rootDir, dir);
    return readdirSync(full)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readJson(join(full, name)));
  };

  const eventTemplatesDir = join(rootDir, "event-templates");
  const eventTemplates = existsSync(eventTemplatesDir) ? readDir("event-templates") : [];

  return {
    raw: {
      world: readJson(join(rootDir, "world.json")),
      lexicon: readJson(join(rootDir, "lexicon.json")),
      characters: readDir("characters"),
      locations: readDir("locations"),
      events: readDir("events"),
      scenes: readDir("scenes"),
      items: readJson(join(rootDir, "items.json")),
      eventTemplates,
    },
    parseErrors,
  };
}

function main(): void {
  const rootDir = join(process.cwd(), "content");
  const { raw, parseErrors } = readContentDir(rootDir);
  const result = loadContent(raw);

  const errors = [...parseErrors, ...(result.ok ? [] : result.error)];
  if (errors.length > 0) {
    console.error(`✖ content validation failed with ${errors.length} error(s):\n`);
    for (const error of errors) {
      console.error(`  ${formatErrorTag(error)}  ${error.message}`);
    }
    process.exit(1);
  }

  if (!result.ok) {
    console.error("✖ loader returned no ContentDB despite zero errors");
    process.exit(1);
    return;
  }
  const db = result.value;
  console.log(
    `✓ content OK (version ${db.contentVersion}): ` +
      `${Object.keys(db.characters).length} characters, ` +
      `${Object.keys(db.locations).length} locations, ` +
      `${Object.keys(db.events).length} events, ` +
      `${Object.keys(db.scenes).length} scenes, ` +
      `${Object.keys(db.ranks).length} ranks, ` +
      `${Object.keys(db.templates).length} event templates`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
