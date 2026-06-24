/**
 * PR6 browser bundle boundary tests.
 *
 * Verifies by source-scanning that browser-facing files (main.tsx, client.ts,
 * schemas.ts, runtimeDeps.ts) do not import Node-only modules.
 *
 * These tests run in the node environment and check source files directly —
 * they don't require a browser or a built bundle.
 *
 * Covered files:
 *   src/main.tsx
 *   src/engine/knowledge/remote/client.ts
 *   src/engine/knowledge/remote/schemas.ts
 *   src/engine/dialogue/runtimeDeps.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

const FORBIDDEN_NODE_MODULES = [
  "better-sqlite3",
  "node:fs",
  "node:path",
  "node:crypto",
  "node:http",
  "node:os",
];

const FORBIDDEN_SERVER_MODULES = [
  "server/knowledge/host",
  "server/knowledge/relay",
  "server/knowledge/handler",
  "server/appServer",
  "server/llm",
];

const BROWSER_FILES: Array<{ label: string; path: string }> = [
  { label: "src/main.tsx", path: "src/main.tsx" },
  { label: "src/engine/knowledge/remote/client.ts", path: "src/engine/knowledge/remote/client.ts" },
  { label: "src/engine/knowledge/remote/schemas.ts", path: "src/engine/knowledge/remote/schemas.ts" },
  { label: "src/engine/dialogue/runtimeDeps.ts", path: "src/engine/dialogue/runtimeDeps.ts" },
];

describe("Browser boundary: no Node-only imports in browser-facing files", () => {
  for (const file of BROWSER_FILES) {
    it(`${file.label} has no forbidden Node-only module imports`, () => {
      const src = readSrc(file.path);
      for (const forbidden of FORBIDDEN_NODE_MODULES) {
        expect(src, `${file.label} must not import "${forbidden}"`).not.toContain(forbidden);
      }
    });

    it(`${file.label} has no server-module imports`, () => {
      const src = readSrc(file.path);
      for (const forbidden of FORBIDDEN_SERVER_MODULES) {
        expect(src, `${file.label} must not import "${forbidden}"`).not.toContain(forbidden);
      }
    });
  }
});

describe("main.tsx wires RemoteKnowledgeClient", () => {
  it("main.tsx imports RemoteKnowledgeClient", () => {
    const src = readSrc("src/main.tsx");
    expect(src).toContain("RemoteKnowledgeClient");
  });

  it("main.tsx sets knowledgeFailureMode to continue_without_knowledge", () => {
    const src = readSrc("src/main.tsx");
    expect(src).toContain("continue_without_knowledge");
  });

  it("main.tsx uses /api path (not hardcoded localhost port)", () => {
    const src = readSrc("src/main.tsx");
    expect(src).toContain('baseUrl: "/api"');
    expect(src).not.toContain("localhost:3001");
    expect(src).not.toContain("localhost:3000");
  });
});
