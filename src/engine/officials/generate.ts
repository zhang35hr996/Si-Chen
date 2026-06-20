import { gestationRoll } from "../characters/gestation";
import type { ContentDB } from "../content/loader";
import type { Official } from "../state/types";
import { pickGivenName, pickSurname } from "./namePool";

const UNLINKED_COUNT = 8;

export function generateOfficials(db: ContentDB, rngSeed: number): Record<string, Official> {
  const officials: Record<string, Official> = {};
  const used = new Set<string>();

  // 母家主：每个 (有 surname + maternalClan) 的姓一名，postId 取该姓侍君（首个）的 maternalClan.postId
  // id 用首个侍君 id 派生（ASCII snake_case，合 idSchema）
  const headInfo = new Map<string, { postId: string; consortId: string }>();
  for (const c of Object.values(db.characters)) {
    if (c.kind !== "consort" || !c.maternalClan || !c.profile.surname) continue;
    if (!headInfo.has(c.profile.surname)) headInfo.set(c.profile.surname, { postId: c.maternalClan.postId, consortId: c.id });
  }
  for (const [surname, { postId, consortId }] of headInfo) {
    const id = `official_head_${consortId}`;
    officials[id] = {
      id, surname, postId,
      givenName: pickGivenName(`${rngSeed}:${surname}`),
      loyalty: gestationRoll(`loyal:${rngSeed}:${surname}`),
    };
    used.add(surname);
  }

  // 无关联官员：K 名填充朝堂
  const nonCommoner = Object.values(db.officialPosts).filter((p) => p.gradeOrder > 0);
  for (let i = 0; i < UNLINKED_COUNT; i++) {
    const surname = pickSurname(`${rngSeed}:${i}`, used);
    used.add(surname);
    const post = nonCommoner[gestationRoll(`post:${rngSeed}:${i}`) % nonCommoner.length]!;
    const id = `official_${String(i + 1).padStart(6, "0")}`;
    officials[id] = {
      id, surname, postId: post.id,
      givenName: pickGivenName(`${rngSeed}:u${i}`),
      loyalty: gestationRoll(`loyal:${rngSeed}:u${i}`),
    };
  }
  return officials;
}
