/**
 * Knowledge adapter for location content JSON.
 *
 * Extracts the public `description` field from LocationContent as a knowledge
 * chunk.  Only the static, author-written description is extracted; dynamic
 * state (characters present, events, etc.) is never indexed here.
 *
 * Deliberately excluded:
 *  - connections / travelCost (map topology, not world knowledge)
 *  - zone / entry / position (runtime navigation, not lore)
 *  - actionEventId (scripted event refs)
 *  - backgroundKey / ambience (art assets)
 *  - subLocations (only static descriptions are safe to extract here)
 */
import type { KnowledgeChunkInput, KnowledgeSourceAdapter } from "../model";

/** Shape we care about — subset of LocationContent. */
interface LocationLike {
  id: string;
  name: string;
  description: string;
  subLocations?: Array<{ id: string; name: string; description: string }>;
}

function isLocationLike(source: unknown): source is LocationLike {
  if (typeof source !== "object" || source === null) return false;
  const s = source as Record<string, unknown>;
  return (
    typeof s["id"] === "string" &&
    typeof s["name"] === "string" &&
    typeof s["description"] === "string" &&
    s["description"].trim().length > 0
  );
}

export const locationAdapter: KnowledgeSourceAdapter<LocationLike> = {
  canHandle(source: unknown, _sourcePath: string): source is LocationLike {
    return isLocationLike(source);
  },

  extract(source: LocationLike, sourcePath: string): KnowledgeChunkInput[] {
    const chunks: KnowledgeChunkInput[] = [];

    // Main location description
    const desc = source.description.trim();
    if (desc.length > 0) {
      chunks.push({
        id: `location:${source.id}`,
        sourceType: "location",
        title: source.name,
        text: desc,
        tags: [],
        entityIds: [],
        locationIds: [source.id],
        visibility: "public",
        sourcePath,
      });
    }

    // Sub-location descriptions (static only)
    for (const sub of source.subLocations ?? []) {
      const subDesc = sub.description.trim();
      if (subDesc.length === 0) continue;
      chunks.push({
        id: `location:${source.id}:${sub.id}`,
        sourceType: "location",
        title: `${source.name} — ${sub.name}`,
        text: subDesc,
        tags: [],
        entityIds: [],
        locationIds: [source.id, sub.id],
        visibility: "public",
        sourcePath,
      });
    }

    return chunks;
  },
};
