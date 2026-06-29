import type { GameState, ParentPair, PersonId } from "../../state/types";

export function getBiologicalParents(state: GameState, characterId: string): ParentPair | undefined {
  const p = state.parentage[characterId];
  return p ? { motherId: p.biologicalMotherId, fatherId: p.biologicalFatherId } : undefined;
}

export function getLegalParents(state: GameState, characterId: string): ParentPair | undefined {
  const p = state.parentage[characterId];
  return p ? { motherId: p.legalMotherId, fatherId: p.legalFatherId } : undefined;
}

function childrenBy(state: GameState, parentId: PersonId, link: "bio" | "legal"): string[] {
  const out: string[] = [];
  for (const [childId, p] of Object.entries(state.parentage)) {
    const m = link === "bio" ? p.biologicalMotherId : p.legalMotherId;
    const f = link === "bio" ? p.biologicalFatherId : p.legalFatherId;
    if (m === parentId || f === parentId) out.push(childId);
  }
  return out.sort();
}

export function getBiologicalChildren(state: GameState, parentId: PersonId): string[] {
  return childrenBy(state, parentId, "bio");
}
export function getLegalChildren(state: GameState, parentId: PersonId): string[] {
  return childrenBy(state, parentId, "legal");
}

export function getBiologicalAncestors(
  state: GameState, characterId: string, maxDepth = Infinity,
): PersonId[] {
  const visited = new Set<PersonId>([characterId]);
  const out: PersonId[] = [];
  let frontier: PersonId[] = [characterId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: PersonId[] = [];
    for (const id of frontier) {
      const p = state.parentage[id];
      if (!p) continue;
      // 母系优先：mother 先于 father
      for (const parent of [p.biologicalMotherId, p.biologicalFatherId]) {
        if (parent == null || visited.has(parent)) continue;
        visited.add(parent);
        out.push(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }
  return out;
}

export function getLegalDescendants(
  state: GameState, parentId: PersonId, maxDepth = Infinity,
): string[] {
  const visited = new Set<PersonId>([parentId]);
  const out: string[] = [];
  let frontier: PersonId[] = [parentId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const gen: string[] = [];
    for (const id of frontier) {
      for (const child of getLegalChildren(state, id)) {
        if (visited.has(child)) continue;
        visited.add(child);
        gen.push(child);
      }
    }
    gen.sort();
    out.push(...gen);
    frontier = gen;
  }
  return out;
}
