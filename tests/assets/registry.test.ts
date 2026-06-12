import { describe, expect, it } from "vitest";
import type { AssetManifest } from "../../src/engine/assets/manifest";
import { AssetRegistry, BUILTIN_FALLBACK_URLS } from "../../src/engine/assets/registry";
import { createLogger } from "../../src/engine/infra/logger";

const manifest: AssetManifest = {
  version: 1,
  entries: {
    "portrait.char_a.neutral": { path: "portraits/char_a/neutral.svg", kind: "portrait", placeholder: true },
    "portrait.char_a.smile": { path: "portraits/char_a/smile.svg", kind: "portrait", placeholder: false },
    "bg.loc_a": { path: "backgrounds/loc_a.svg", kind: "background", placeholder: true },
    "map.palace": { path: "map/palace.svg", kind: "map", placeholder: true },
  },
};

const make = () => {
  const logger = createLogger({ now: () => 0 });
  return { registry: new AssetRegistry(manifest, { logger }), logger };
};

describe("AssetRegistry.resolve", () => {
  it("resolves an existing key: url joined with baseUrl, no fallback", () => {
    const { registry, logger } = make();
    const asset = registry.portrait("char_a", "smile");
    expect(asset).toEqual({
      key: "portrait.char_a.smile",
      url: "/assets/portraits/char_a/smile.svg",
      kind: "portrait",
      isFallback: false,
      isPlaceholder: false,
    });
    expect(logger.entries()).toHaveLength(0); // clean resolves log nothing
  });

  it("missing expression falls back to the set's neutral, flagged + logged once", () => {
    const { registry, logger } = make();
    const asset = registry.portrait("char_a", "worried");
    expect(asset.url).toBe("/assets/portraits/char_a/neutral.svg");
    expect(asset.isFallback).toBe(true);
    expect(asset.key).toBe("portrait.char_a.worried"); // requested key preserved
    expect(logger.entries()).toHaveLength(1);
    expect(logger.entries()[0]?.message).toContain("AssetError:ASSET_MISSING");
  });

  it("missing whole portrait set falls back to the built-in silhouette", () => {
    const { registry } = make();
    const asset = registry.portrait("char_ghost", "smile");
    expect(asset.url).toBe(BUILTIN_FALLBACK_URLS.portrait);
    expect(asset.url.startsWith("data:image/svg+xml,")).toBe(true); // cannot be missing
    expect(asset.isFallback).toBe(true);
    expect(asset.isPlaceholder).toBe(true);
  });

  it("missing background falls back to the built-in gradient", () => {
    const { registry } = make();
    const asset = registry.background("bg.loc_ghost");
    expect(asset.url).toBe(BUILTIN_FALLBACK_URLS.background);
    expect(asset.isFallback).toBe(true);
  });

  it("wrong kind: a background key requested as portrait is a mismatch + fallback", () => {
    const { registry, logger } = make();
    const asset = registry.resolve("bg.loc_a", "portrait");
    expect(asset.url).toBe(BUILTIN_FALLBACK_URLS.portrait);
    expect(asset.isFallback).toBe(true);
    const messages = logger.entries().map((e) => e.message);
    expect(messages.some((m) => m.includes("ASSET_KIND_MISMATCH"))).toBe(true);
    expect(messages.some((m) => m.includes("ASSET_MISSING"))).toBe(true);
  });

  it("diagnostics are deduplicated: same miss twice logs once", () => {
    const { registry, logger } = make();
    registry.portrait("char_ghost", "smile");
    registry.portrait("char_ghost", "smile");
    expect(logger.entries()).toHaveLength(1);
  });

  it("never throws, even with an empty manifest and weird keys", () => {
    const registry = new AssetRegistry({ version: 1, entries: {} });
    for (const key of ["", "portrait", "a.b.c.d", "portrait.x.neutral", "🐉"]) {
      const asset = registry.resolve(key, "ui");
      expect(asset.url.length).toBeGreaterThan(0);
    }
  });

  it("neutral itself missing goes straight to builtin (no self-loop)", () => {
    const { registry } = make();
    const asset = registry.portrait("char_ghost", "neutral");
    expect(asset.url).toBe(BUILTIN_FALLBACK_URLS.portrait);
  });
});
