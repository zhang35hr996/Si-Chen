/**
 * haremDisciplineIncidents 跨字段一致性验证（PUNISH-4G-B）。
 * 在 stateSchema.ts 的 superRefine 中调用。
 */
import type { GameError } from "../infra/errors";
import { stateError } from "../infra/errors";

interface StateSlice {
  haremDisciplineIncidents: Array<{
    id: string;
    actorId: string;
    targetId: string;
    status: "pending_response" | "resolved";
    resolution?: string;
    resolvedAt?: unknown;
    courtEventId: string;
  }>;
  chronicle: Array<{ id: string }>;
  standing: Record<string, unknown>;
}

/**
 * 验证 haremDisciplineIncidents 跨字段约束：
 * 1. resolved 必须有 resolution 和 resolvedAt（schema level 已验，此处为二道防线）。
 * 2. courtEventId 必须在 chronicle 中存在。
 * 3. actorId 和 targetId 必须在 standing 中存在。
 * 4. 每个 id 唯一（无重复）。
 * 5. 最多一条 pending_response 存在于同一 targetId。
 */
export function validateHaremDisciplineLinks(data: StateSlice): GameError[] {
  const errors: GameError[] = [];
  const eventIds = new Set(data.chronicle.map((e) => e.id));
  const seenIds = new Set<string>();
  const pendingTargets = new Set<string>();

  for (const inc of data.haremDisciplineIncidents) {
    if (seenIds.has(inc.id)) {
      errors.push(stateError("HDI_DUPLICATE_ID", `haremDisciplineIncidents: duplicate id ${inc.id}`));
    }
    seenIds.add(inc.id);

    if (inc.status === "pending_response") {
      if (pendingTargets.has(inc.targetId)) {
        errors.push(
          stateError(
            "HDI_MULTI_PENDING",
            `haremDisciplineIncidents: targetId ${inc.targetId} has multiple pending_response incidents`,
          ),
        );
      }
      pendingTargets.add(inc.targetId);
    }

    if (!eventIds.has(inc.courtEventId)) {
      errors.push(
        stateError(
          "HDI_MISSING_EVENT",
          `haremDisciplineIncidents[id=${inc.id}]: courtEventId ${inc.courtEventId} not found in chronicle`,
        ),
      );
    }

    if (!(inc.actorId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_ACTOR",
          `haremDisciplineIncidents[id=${inc.id}]: actorId ${inc.actorId} not found in standing`,
        ),
      );
    }

    if (!(inc.targetId in data.standing)) {
      errors.push(
        stateError(
          "HDI_MISSING_TARGET",
          `haremDisciplineIncidents[id=${inc.id}]: targetId ${inc.targetId} not found in standing`,
        ),
      );
    }
  }

  return errors;
}
