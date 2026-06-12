/**
 * The browser content source must agree with the disk source the CLI uses —
 * same loader, same ContentDB.
 */
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { loadRealContent } from "../helpers/contentFixture";

describe("viteSource", () => {
  it("loads the same ContentDB as the disk reader", () => {
    const viaGlob = loadGameContent();
    expect(viaGlob.ok).toBe(true);
    if (!viaGlob.ok) return;
    const viaDisk = loadRealContent();
    expect(viaGlob.value.contentVersion).toBe(viaDisk.contentVersion);
    expect(Object.keys(viaGlob.value.characters).sort()).toEqual(
      Object.keys(viaDisk.characters).sort(),
    );
    expect(viaGlob.value).toEqual(viaDisk);
  });
});
