/**
 * Manifest validator (DESIGN §6.3): manifest paths exist on disk; every
 * content-referenced asset key exists in the manifest with the right kind;
 * orphan files are reported; prints the placeholder report (% real art).
 *
 *   npm run validate-manifest
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assetManifestSchema, backgroundKeyOf, portraitKey, type AssetManifest } from "../src/engine/assets/manifest";
import { loadContent, type ContentDB } from "../src/engine/content/loader";
import { assetError, contentError, formatErrorTag, type GameError } from "../src/engine/infra/errors";
import { readContentDir } from "./validate-content";

/** Asset keys the UI itself depends on (not derivable from content files). */
export const REQUIRED_UI_KEYS: { key: string; kind: "map" | "ui" }[] = [
  { key: "map.palace", kind: "map" },
];

export interface ManifestCheckResult {
  errors: GameError[];
  warnings: GameError[];
  placeholderCount: number;
  entryCount: number;
}

export function checkManifest(
  manifest: AssetManifest,
  diskPaths: ReadonlySet<string>,
  db: ContentDB,
): ManifestCheckResult {
  const errors: GameError[] = [];
  const warnings: GameError[] = [];

  // 1. every manifest path exists on disk
  for (const [key, entry] of Object.entries(manifest.entries)) {
    if (!diskPaths.has(entry.path)) {
      errors.push(
        assetError("ASSET_FILE_MISSING", `manifest key "${key}" points to missing file "${entry.path}"`, {
          context: { key, path: entry.path },
        }),
      );
    }
  }

  // 2. every content-referenced key exists with the right kind
  const require = (key: string, kind: string, referencedBy: string) => {
    const entry = manifest.entries[key];
    if (!entry) {
      errors.push(
        contentError("MISSING_ASSET_KEY", `${referencedBy} references asset "${key}" not in manifest`, {
          context: { key, referencedBy },
        }),
      );
    } else if (entry.kind !== kind) {
      errors.push(
        assetError("ASSET_KIND_MISMATCH", `"${key}" is kind "${entry.kind}", ${referencedBy} expects "${kind}"`, {
          context: { key, referencedBy, expected: kind, actual: entry.kind },
        }),
      );
    }
  };

  for (const character of Object.values(db.characters)) {
    for (const expression of character.expressions) {
      require(portraitKey(character.portraitSet, expression), "portrait", `character "${character.id}"`);
    }
  }
  for (const location of Object.values(db.locations)) {
    require(location.backgroundKey, "background", `location "${location.id}"`);
    if (location.backgroundKey !== backgroundKeyOf(location.id)) {
      warnings.push(
        assetError(
          "ASSET_NAMING",
          `location "${location.id}" backgroundKey "${location.backgroundKey}" deviates from convention "${backgroundKeyOf(location.id)}"`,
          { severity: "warn", context: { locationId: location.id } },
        ),
      );
    }
  }
  for (const { key, kind } of REQUIRED_UI_KEYS) {
    require(key, kind, "ui");
  }

  // 3. orphan files on disk that no manifest entry claims
  const claimed = new Set(Object.values(manifest.entries).map((e) => e.path));
  for (const path of diskPaths) {
    if (!claimed.has(path)) {
      warnings.push(
        assetError("ORPHAN_FILE", `file "${path}" exists on disk but no manifest entry claims it`, {
          severity: "warn",
          context: { path },
        }),
      );
    }
  }

  const placeholderCount = Object.values(manifest.entries).filter((e) => e.placeholder).length;
  return { errors, warnings, placeholderCount, entryCount: Object.keys(manifest.entries).length };
}

function walkFiles(root: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.add(relative(root, full).split("\\").join("/"));
    }
  };
  try {
    walk(root);
  } catch {
    // missing dir → empty set; every manifest path will then error
  }
  return out;
}

function main(): void {
  const manifest = assetManifestSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "assets", "manifest.json"), "utf8")),
  );
  const { raw, parseErrors } = readContentDir(join(process.cwd(), "content"));
  const content = loadContent(raw);
  if (parseErrors.length > 0 || !content.ok) {
    console.error("✖ content/ must be valid before the manifest can be checked (run validate-content)");
    process.exit(1);
    return;
  }

  const diskPaths = walkFiles(join(process.cwd(), "public", "assets"));
  const result = checkManifest(manifest, diskPaths, content.value);

  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${formatErrorTag(warning)}  ${warning.message}`);
  }
  if (result.errors.length > 0) {
    console.error(`✖ manifest validation failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) {
      console.error(`  ${formatErrorTag(error)}  ${error.message}`);
    }
    process.exit(1);
    return;
  }
  const real = result.entryCount - result.placeholderCount;
  console.log(
    `✓ manifest OK: ${result.entryCount} entries, ${result.placeholderCount} placeholder / ${real} real ` +
      `(${Math.round((real / Math.max(1, result.entryCount)) * 100)}% real art)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
