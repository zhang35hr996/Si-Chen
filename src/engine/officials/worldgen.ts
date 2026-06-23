/**
 * 开局官员世界的确定性生成（spec §6/§7）：官职席位 → 官员 → 家族 → 核心家族成员 →
 * 侍君母族关联 → 亲缘索引。纯函数：同一 (db, rngSeed) 必得同一结果；查询/UI 不消耗随机数。
 *
 * 家族身份：authored 侍君经显式 `maternalClan.familyId` 分组（绝不按姓名推断；不同 familyId
 * 可同姓）。authored 家族 runtime id 直接复用该稳定 familyId；无关联随机家族用确定性
 * `fam_gen_NNNN`（与 authored id 去碰撞）。
 *
 * 随机流隔离：所有种子串以 `off:${rngSeed}` 前缀，与孕育/殿选/进献等其它系统互不干扰。
 *
 * 母系硬约束：官员恒为女性；内卿/男郎为男性 FamilyMember，绝不挂 postId。亲缘以正式有向边
 * 落库（含对称反向边）。家族成员归属唯一真相是各人物的 familyId/birthFamilyId（无 memberIds）。
 */
import type { GameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { CharacterContent, OfficialPost } from "../content/schemas";
import type {
  FamilyMember,
  KinshipRelation,
  Official,
  OfficialFamily,
} from "../state/types";
import { gestationRoll } from "../characters/gestation";
import { ARISTOCRATIC_MALE_GIVEN_NAME_POOL, ARISTOCRATIC_SURNAME_POOL } from "../characters/shijunNames";
import {
  MEMBER_MIN_AGE,
  OFFICIAL_MAX_AGE,
  OFFICIAL_MIN_AGE,
  PARENT_CHILD_MAX_GAP,
  PARENT_CHILD_MIN_GAP,
  SPOUSE_MAX_GAP,
} from "./constraints";
import { OFFICIAL_GIVEN_NAME_POOL, pickGivenName, pickSurname } from "./namePool";

/** 无侍君关联的填充家族数（充实朝堂）。 */
export const UNLINKED_FAMILY_COUNT = 8;

export interface OfficialWorld {
  officials: Record<string, Official>;
  officialFamilies: Record<string, OfficialFamily>;
  familyMembers: Record<string, FamilyMember>;
  kinship: KinshipRelation[];
  /** 侍君 charId → 母族 familyId（写入 standing.birthFamilyId）。 */
  consortBirthFamily: Record<string, string>;
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));
const pad4 = (n: number): string => String(n).padStart(4, "0");
const famSuffix = (famId: string): string => (famId.startsWith("fam_") ? famId.slice(4) : famId);

/** 闭区间 [min,max] 内的确定性年龄。min>max 视为生成约束错误（调用方应已 guard）。 */
function ageInRange(seed: string, min: number, max: number): number {
  if (max < min) throw new Error(`ageInRange: empty range [${min}, ${max}] (seed ${seed})`);
  return min + (gestationRoll(seed) % (max - min + 1));
}

/** 品级对应的最低官员年龄（高品官最低年龄更高；不过度设计）。 */
function minOfficialAgeForGrade(gradeOrder: number): number {
  return Math.min(OFFICIAL_MAX_AGE, OFFICIAL_MIN_AGE + Math.round((gradeOrder / 18) * 18));
}

function pickMaleGiven(seed: string): string {
  return ARISTOCRATIC_MALE_GIVEN_NAME_POOL[gestationRoll(seed) % ARISTOCRATIC_MALE_GIVEN_NAME_POOL.length]!;
}

function pickFemaleGiven(seed: string): string {
  return OFFICIAL_GIVEN_NAME_POOL[gestationRoll(seed) % OFFICIAL_GIVEN_NAME_POOL.length]!;
}

/** 亲缘边累加器：去重（同 from/to/type 仅一条），对称关系两向都落。 */
class KinIndex {
  private readonly seen = new Set<string>();
  readonly edges: KinshipRelation[] = [];
  private add(from: string, to: string, type: KinshipRelation["type"]): void {
    const key = `${from}|${to}|${type}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.edges.push({ fromPersonId: from, toPersonId: to, type });
  }
  /** 母↔女/子：child 的母亲是 parent；parent 视 child 为 daughter/son。 */
  parentChild(parentId: string, childId: string, childSex: "female" | "male"): void {
    this.add(childId, parentId, "mother");
    this.add(parentId, childId, childSex === "female" ? "daughter" : "son");
  }
  /** 对称关系（同胞/配偶）：两向等价边。 */
  symmetric(a: string, b: string, type: "sibling" | "spouse"): void {
    this.add(a, b, type);
    this.add(b, a, type);
  }
}

interface SeatBook {
  occupancy: Record<string, number>;
}

function occupy(book: SeatBook, postId: string): void {
  book.occupancy[postId] = (book.occupancy[postId] ?? 0) + 1;
}

/** 从有品级官职中取一个尚有空席者（线性探查保证确定性与不超额）。无空席则 null。 */
function pickPostWithSeat(seed: string, posts: OfficialPost[], book: SeatBook): OfficialPost | null {
  const n = posts.length;
  if (n === 0) return null;
  const start = gestationRoll(seed) % n;
  for (let i = 0; i < n; i++) {
    const post = posts[(start + i) % n]!;
    if ((book.occupancy[post.id] ?? 0) < post.seatCount) return post;
  }
  return null;
}

/** 生成一族核心成员（母亲/内卿/女儿/男郎/姐妹）。返回 person ids（不含官员本人/侍君）。
 *  famId 为家族 runtime id（派生 person id）；seed 为随机种子串（含 off: 前缀）。 */
function generateMembers(
  famId: string,
  seed: string,
  surname: string,
  headId: string,
  headAge: number,
  childIds: string[], // 已含 linked 侍君 id，供同胞连边
  members: Record<string, FamilyMember>,
  kin: KinIndex,
): string[] {
  const personIds: string[] = [];
  const sfx = famSuffix(famId);
  const childMin = Math.max(MEMBER_MIN_AGE, headAge - PARENT_CHILD_MAX_GAP);
  const childMax = headAge - PARENT_CHILD_MIN_GAP;
  if (childMin > childMax) {
    throw new Error(`generateMembers: no valid child age for head age ${headAge} (family ${famId})`);
  }

  // 上一代家主/母亲（~65%）
  if (gestationRoll(`${seed}:mat:p`) % 100 < 65) {
    const id = `person_${sfx}_mat`;
    const age = headAge + (PARENT_CHILD_MIN_GAP + (gestationRoll(`${seed}:mat:age`) % 15)); // +16..+30
    members[id] = { id, familyId: famId, name: surname + pickFemaleGiven(`${seed}:mat:n`), surname, sex: "female", age, role: "matriarch" };
    kin.parentChild(id, headId, "female");
    personIds.push(id);
  }

  // 内卿（官员正室，男性，赘入；可异姓）（~70%）
  if (gestationRoll(`${seed}:nei:p`) % 100 < 70) {
    const id = `person_${sfx}_nei`;
    const delta = (gestationRoll(`${seed}:nei:age`) % (2 * SPOUSE_MAX_GAP + 1)) - SPOUSE_MAX_GAP;
    const age = Math.max(20, headAge + delta);
    const neiSurname = ARISTOCRATIC_SURNAME_POOL[gestationRoll(`${seed}:nei:s`) % ARISTOCRATIC_SURNAME_POOL.length]!;
    members[id] = { id, familyId: famId, name: neiSurname + pickMaleGiven(`${seed}:nei:n`), surname: neiSurname, sex: "male", age, role: "consort_in" };
    kin.symmetric(headId, id, "spouse");
    personIds.push(id);
  }

  // 女儿 0–3
  const daughters = gestationRoll(`${seed}:dau:c`) % 4;
  for (let d = 0; d < daughters; d++) {
    const id = `person_${sfx}_dau${d}`;
    const age = ageInRange(`${seed}:dau:${d}:age`, childMin, childMax);
    members[id] = { id, familyId: famId, name: surname + pickFemaleGiven(`${seed}:dau:${d}:n`), surname, sex: "female", age, role: "daughter" };
    kin.parentChild(headId, id, "female");
    childIds.push(id);
    personIds.push(id);
  }

  // 男郎 0–3
  const sons = gestationRoll(`${seed}:son:c`) % 4;
  for (let s = 0; s < sons; s++) {
    const id = `person_${sfx}_son${s}`;
    const age = ageInRange(`${seed}:son:${s}:age`, childMin, childMax);
    members[id] = { id, familyId: famId, name: surname + pickMaleGiven(`${seed}:son:${s}:n`), surname, sex: "male", age, role: "son" };
    kin.parentChild(headId, id, "male");
    childIds.push(id);
    personIds.push(id);
  }

  // 官员姐妹（~35%，仅作同胞，不再连上一代以免年龄矛盾）
  if (gestationRoll(`${seed}:sis:p`) % 100 < 35) {
    const id = `person_${sfx}_sis`;
    const age = Math.max(18, headAge + ((gestationRoll(`${seed}:sis:age`) % 21) - 10));
    members[id] = { id, familyId: famId, name: surname + pickFemaleGiven(`${seed}:sis:n`), surname, sex: "female", age, role: "sister" };
    kin.symmetric(headId, id, "sibling");
    personIds.push(id);
  }

  // 同胞连边：官员所有子女（含 linked 侍君）两两互为 sibling
  for (let i = 0; i < childIds.length; i++) {
    for (let j = i + 1; j < childIds.length; j++) {
      kin.symmetric(childIds[i]!, childIds[j]!, "sibling");
    }
  }

  return personIds;
}

function familyAttributes(seed: string, gradeOrder: number): { influence: number; imperialFavor: number } {
  const influence = clampPct(Math.round((gradeOrder / 18) * 70) + 15 + ((gestationRoll(`${seed}:inf`) % 11) - 5));
  const imperialFavor = clampPct(50 + ((gestationRoll(`${seed}:fav`) % 31) - 15));
  return { influence, imperialFavor };
}

export function generateOfficialWorld(db: ContentDB, rngSeed: number, appointedAt: GameTime): OfficialWorld {
  const S = `off:${rngSeed}`;
  const officials: Record<string, Official> = {};
  const officialFamilies: Record<string, OfficialFamily> = {};
  const familyMembers: Record<string, FamilyMember> = {};
  const consortBirthFamily: Record<string, string> = {};
  const kin = new KinIndex();
  const book: SeatBook = { occupancy: {} };
  const usedSurnames = new Set<string>();
  const usedFamilyIds = new Set<string>();
  const nonCommoner = Object.values(db.officialPosts).filter((p) => p.gradeOrder > 0);

  const buildFamily = (
    famId: string,
    surname: string,
    post: OfficialPost | null,
    linkedConsorts: CharacterContent[],
  ): void => {
    usedFamilyIds.add(famId);
    usedSurnames.add(surname);
    const headId = `official_${famId}`;
    const gradeOrder = post?.gradeOrder ?? 0;
    const seed = `${S}:${famId}`;

    // 官员年龄窗口：满足品级最低年龄、且对所有 linked 侍君母女年龄差 ∈ [MIN_GAP, MAX_GAP]、≤ 上限。
    const minByGrade = minOfficialAgeForGrade(gradeOrder);
    let lo = Math.max(OFFICIAL_MIN_AGE, minByGrade);
    let hi = OFFICIAL_MAX_AGE;
    if (linkedConsorts.length > 0) {
      const maxConsortAge = Math.max(...linkedConsorts.map((c) => c.profile.age));
      const minConsortAge = Math.min(...linkedConsorts.map((c) => c.profile.age));
      lo = Math.max(lo, maxConsortAge + PARENT_CHILD_MIN_GAP);
      hi = Math.min(hi, minConsortAge + PARENT_CHILD_MAX_GAP);
    }
    if (lo > hi) {
      throw new Error(
        `generateOfficialWorld: family ${famId} has no valid head age (lo ${lo} > hi ${hi}); ` +
          `check authored consort ages vs ${surname} head grade ${gradeOrder}`,
      );
    }
    const headAge = ageInRange(`${seed}:age`, lo, hi);

    officials[headId] = {
      id: headId,
      surname,
      givenName: pickGivenName(`${seed}:given`),
      postId: post?.id ?? null,
      loyalty: 40 + (gestationRoll(`${seed}:loy`) % 56),
      age: headAge,
      familyId: famId,
      status: "active",
      appointedAt,
    };
    if (post) {
      // 防御：即便绕过 ContentLoader 校验，也不静默产生超额世界。
      if ((book.occupancy[post.id] ?? 0) >= post.seatCount) {
        throw new Error(`generateOfficialWorld: post ${post.id} over seatCount ${post.seatCount} (family ${famId})`);
      }
      occupy(book, post.id);
    }

    const childIds: string[] = [];
    for (const c of linkedConsorts) {
      // 侍君为帝王男性侍御（女尊礼法），出身官员家族即官员之男（子）。
      consortBirthFamily[c.id] = famId;
      kin.parentChild(headId, c.id, "male");
      childIds.push(c.id);
    }

    generateMembers(famId, seed, surname, headId, headAge, childIds, familyMembers, kin);

    const { influence, imperialFavor } = familyAttributes(seed, gradeOrder);
    officialFamilies[famId] = { id: famId, surname, influence, imperialFavor };
  };

  // ── 1) authored 母族：按 maternalClan.familyId 分组（绝不按 surname） ──
  const consorts = Object.values(db.characters)
    .filter((c): c is CharacterContent => c.kind === "consort" && !!c.maternalClan && !!c.profile.surname)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const groups = new Map<string, { postId: string; surname: string; consorts: CharacterContent[] }>();
  for (const c of consorts) {
    const familyId = c.maternalClan!.familyId;
    const g = groups.get(familyId);
    if (g) g.consorts.push(c);
    else groups.set(familyId, { postId: c.maternalClan!.postId, surname: c.profile.surname!, consorts: [c] });
  }
  // 稳定顺序：按 familyId（显式 id，不依赖排序漂移）。
  for (const familyId of [...groups.keys()].sort()) {
    const g = groups.get(familyId)!;
    buildFamily(familyId, g.surname, db.officialPosts[g.postId] ?? null, g.consorts);
  }

  // ── 2) 无关联填充家族（确定性 id，与 authored 去碰撞） ──
  let genIndex = 0;
  for (let u = 0; u < UNLINKED_FAMILY_COUNT; u++) {
    let famId: string;
    do {
      genIndex += 1;
      famId = `fam_gen_${pad4(genIndex)}`;
    } while (usedFamilyIds.has(famId));
    const surname = pickSurname(`${S}:u:${u}`, usedSurnames);
    const post = pickPostWithSeat(`${S}:u:${u}:post`, nonCommoner, book);
    buildFamily(famId, surname, post, []);
  }

  return { officials, officialFamilies, familyMembers, kinship: kin.edges, consortBirthFamily };
}
