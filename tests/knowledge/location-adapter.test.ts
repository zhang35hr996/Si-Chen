import { describe, expect, it } from "vitest";
import { locationAdapter } from "../../src/engine/knowledge/ingestion/location-adapter";

const baseLocation = {
  id: "xuanzhengdian",
  name: "宣政殿",
  description: "晴日里，金瓦映着白光，整座殿宇如同悬在天际。丹陛巍巍，百官列班。",
};

describe("locationAdapter.canHandle", () => {
  it("accepts a valid location-like object", () => {
    expect(locationAdapter.canHandle(baseLocation, "test.json")).toBe(true);
  });

  it("rejects objects without description", () => {
    expect(locationAdapter.canHandle({ id: "x", name: "X" }, "test.json")).toBe(false);
  });

  it("rejects objects with empty description", () => {
    expect(locationAdapter.canHandle({ ...baseLocation, description: "   " }, "test.json")).toBe(false);
  });

  it("rejects null", () => {
    expect(locationAdapter.canHandle(null, "test.json")).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(locationAdapter.canHandle("string", "test.json")).toBe(false);
  });
});

describe("locationAdapter.extract", () => {
  it("produces a chunk with sourceType=location", () => {
    const chunks = locationAdapter.extract(baseLocation, "content/locations/xuanzhengdian.json");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sourceType).toBe("location");
  });

  it("sets title to location name", () => {
    const chunks = locationAdapter.extract(baseLocation, "test.json");
    expect(chunks[0]!.title).toBe("宣政殿");
  });

  it("sets text to location description", () => {
    const chunks = locationAdapter.extract(baseLocation, "test.json");
    expect(chunks[0]!.text).toContain("金瓦");
  });

  it("includes locationId in the chunk", () => {
    const chunks = locationAdapter.extract(baseLocation, "test.json");
    expect(chunks[0]!.locationIds).toContain("xuanzhengdian");
  });

  it("sets visibility to public", () => {
    const chunks = locationAdapter.extract(baseLocation, "test.json");
    expect(chunks[0]!.visibility).toBe("public");
  });

  it("generates stable chunk ID", () => {
    const chunks = locationAdapter.extract(baseLocation, "test.json");
    expect(chunks[0]!.id).toBe("location:xuanzhengdian");
  });

  it("preserves provenance path", () => {
    const sp = "content/locations/xuanzhengdian.json";
    const chunks = locationAdapter.extract(baseLocation, sp);
    expect(chunks[0]!.sourcePath).toBe(sp);
  });

  it("does NOT extract hidden or private fields", () => {
    const locationWithExtras = {
      ...baseLocation,
      connections: ["kunninggong"],
      travelCost: { ap: 1 },
      backgroundKey: "bg.xzd",
    };
    const chunks = locationAdapter.extract(
      locationWithExtras as Parameters<typeof locationAdapter.extract>[0],
      "test.json",
    );
    // Only description → 1 chunk; no separate chunks for other fields
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).not.toContain("bg.");
    expect(chunks[0]!.text).not.toContain("kunninggong");
  });

  it("extracts sub-location descriptions too", () => {
    const locationWithSubs = {
      ...baseLocation,
      subLocations: [
        { id: "xzd_east", name: "东配殿", description: "东配殿用于侯见官员。" },
        { id: "xzd_west", name: "西配殿", description: "西配殿存放朝仪器物。" },
      ],
    };
    const chunks = locationAdapter.extract(locationWithSubs, "test.json");
    expect(chunks).toHaveLength(3); // main + 2 sub-locations
    const subChunk = chunks.find((c) => c.id === "location:xuanzhengdian:xzd_east");
    expect(subChunk).toBeDefined();
    expect(subChunk!.locationIds).toContain("xzd_east");
    expect(subChunk!.locationIds).toContain("xuanzhengdian");
  });
});
