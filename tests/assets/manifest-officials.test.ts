import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetManifestSchema } from "../../src/engine/assets/manifest";

const raw = JSON.parse(readFileSync(join(process.cwd(), "assets", "manifest.json"), "utf8"));

describe("official portraits", () => {
  it("registers official1..official8 neutral portraits", () => {
    const m = assetManifestSchema.parse(raw);
    for (let i = 1; i <= 8; i++) {
      expect(m.entries[`portrait.official${i}.neutral`]).toBeTruthy();
    }
  });
});
