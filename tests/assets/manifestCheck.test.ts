import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetManifestSchema, type AssetManifest } from "../../src/engine/assets/manifest";
import { checkManifest } from "../../tools/validate-manifest";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const realManifest = (): AssetManifest =>
  assetManifestSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "assets", "manifest.json"), "utf8")),
  );

const allPaths = (manifest: AssetManifest): Set<string> =>
  new Set(Object.values(manifest.entries).map((e) => e.path));

describe("assetManifestSchema", () => {
  it("accepts the real manifest and rejects malformed keys/kinds", () => {
    expect(assetManifestSchema.safeParse(realManifest()).success).toBe(true);
    expect(
      assetManifestSchema.safeParse({
        version: 1,
        entries: { "Bad Key": { path: "x.svg", kind: "portrait", placeholder: true } },
      }).success,
    ).toBe(false);
    expect(
      assetManifestSchema.safeParse({
        version: 1,
        entries: { "ui.x": { path: "x.svg", kind: "sprite", placeholder: true } },
      }).success,
    ).toBe(false);
  });
});

describe("checkManifest", () => {
  it("real manifest + complete disk + real content = zero errors", () => {
    const manifest = realManifest();
    const result = checkManifest(manifest, allPaths(manifest), db);
    expect(result.errors).toEqual([]);
    expect(result.entryCount).toBe(6);
    expect(result.placeholderCount).toBe(6);
  });

  it("manifest path missing on disk is an error", () => {
    const manifest = realManifest();
    const disk = allPaths(manifest);
    disk.delete("backgrounds/yuhuayuan.png");
    const result = checkManifest(manifest, disk, db);
    expect(result.errors.some((e) => e.code === "ASSET_FILE_MISSING")).toBe(true);
  });

  it("content-referenced key absent from manifest is an error", () => {
    const manifest = realManifest();
    delete manifest.entries["portrait.consort.neutral"]; // shared by all 侍君
    const result = checkManifest(manifest, allPaths(manifest), db);
    expect(
      result.errors.some(
        (e) => e.code === "MISSING_ASSET_KEY" && e.message.includes("portrait.consort.neutral"),
      ),
    ).toBe(true);
  });

  it("content-referenced key with the wrong kind is an error", () => {
    const manifest = realManifest();
    manifest.entries["bg.yuhuayuan"]!.kind = "ui";
    const result = checkManifest(manifest, allPaths(manifest), db);
    expect(result.errors.some((e) => e.code === "ASSET_KIND_MISMATCH")).toBe(true);
  });

  it("orphan disk files are warnings, not errors", () => {
    const manifest = realManifest();
    const disk = allPaths(manifest);
    disk.add("portraits/old_character/neutral.svg");
    const result = checkManifest(manifest, disk, db);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((e) => e.code === "ORPHAN_FILE")).toBe(true);
  });
});
