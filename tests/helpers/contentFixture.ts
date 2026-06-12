/** Load the real shipped content/ once for engine tests. */
import { join } from "node:path";
import { loadContent, type ContentDB } from "../../src/engine/content/loader";
import { readContentDir } from "../../tools/validate-content";

let cached: ContentDB | null = null;

export function loadRealContent(): ContentDB {
  if (cached) return cached;
  const { raw, parseErrors } = readContentDir(join(process.cwd(), "content"));
  if (parseErrors.length > 0) {
    throw new Error(parseErrors.map((e) => e.message).join("\n"));
  }
  const result = loadContent(raw);
  if (!result.ok) {
    throw new Error(result.error.map((e) => e.message).join("\n"));
  }
  cached = result.value;
  return cached;
}
