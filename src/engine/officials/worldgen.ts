/**
 * 开局官员世界的确定性生成（spec §6/§7）：官职席位 → 官员 → 家族 → 核心家族成员 →
 * 侍君母族关联 → 亲缘索引。纯函数：同一 (db, rngSeed) 必得同一结果；查询/UI 不消耗随机数。
 *
 * 随机流隔离：所有种子串以 `off:${rngSeed}` 前缀，与孕育/殿选/进献等其它系统的随机流互不
 * 干扰（gestationRoll 为字符串哈希，前缀唯一即隔离）——新增官员系统不会令既有随机结果漂移。
 *
 * 母系硬约束：官员恒为女性（无 sex 字段即女性）；内卿/男郎为男性 FamilyMember，绝不挂 postId。
 * 亲缘以正式有向边落库（含对称反向边），绝不靠姓名临时推断。
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

/** 闭区间 [min,max] 内的确定性年龄（max<min 时回退 min）。 */
function ageInRange(seed: string, min: number, max: number): number {
  if (max <= min) return min;
  return min + (gestationRoll(seed) % (max - min + 1));
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
 *  famId 为裸家族 id（如 fam_0001，用于派生 person id）；seed 为随机种子串（含 off: 前缀）。 */
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
  const num = famId.slice(4); // "0001"
  const childMax = Math.max(MEMBER_MIN_AGE + 1, headAge - PARENT_CHILD_MIN_GAP);

  // 上一代家主/母亲（~65%）
  if (gestationRoll(`${seed}:mat:p`) % 100 < 65) {
    const id = `person_${num}_mat`;
    const age = headAge + (PARENT_CHILD_MIN_GAP + (gestationRoll(`${seed}:mat:age`) % 15)); // +16..+30
    members[id] = { id, familyId: famId, name: surname + pickFemaleGiven(`${seed}:mat:n`), surname, sex: "female", age, role: "matriarch" };
    kin.parentChild(id, headId, "female");
    personIds.push(id);
  }

  // 内卿（官员正室，男性，赘入；可异姓）（~70%）
  if (gestationRoll(`${seed}:nei:p`) % 100 < 70) {
    const id = `person_${num}_nei`;
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
    const id = `person_${num}_dau${d}`;
    const age = ageInRange(`${seed}:dau:${d}:age`, MEMBER_MIN_AGE, childMax);
    members[id] = { id, familyId: famId, name: surname + pickFemaleGiven(`${seed}:dau:${d}:n`), surname, sex: "female", age, role: "daughter" };
    kin.parentChild(headId, id, "female");
    childIds.push(id);
    personIds.push(id);
  }

  // 男郎 0–3
  const sons = gestationRoll(`${seed}:son:c`) % 4;
  for (let s = 0; s < sons; s++) {
    const id = `person_${num}_son${s}`;
    const age = ageInRange(`${seed}:son:${s}:age`, MEMBER_MIN_AGE, childMax);
    const sonSurname = surname; // 子女默认归母族（同姓）
    members[id] = { id, familyId: famId, name: sonSurname + pickMaleGiven(`${seed}:son:${s}:n`), surname: sonSurname, sex: "male", age, role: "son" };
    kin.parentChild(headId, id, "male");
    childIds.push(id);
    personIds.push(id);
  }

  // 官员姐妹（~35%，仅作同胞，不再连上一代以免年龄矛盾）
  if (gestationRoll(`${seed}:sis:p`) % 100 < 35) {
    const id = `person_${num}_sis`;
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

function familyAttributes(fam: string, gradeOrder: number): { influence: number; imperialFavor: number } {
  const influence = clampPct(Math.round((gradeOrder / 18) * 70) + 15 + ((gestationRoll(`${fam}:inf`) % 11) - 5));
  const imperialFavor = clampPct(50 + ((gestationRoll(`${fam}:fav`) % 31) - 15));
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
  const nonCommoner = Object.values(db.officialPosts).filter((p) => p.gradeOrder > 0);

  // ── 1) 收集 authored 侍君母族（按 surname 分组；validation 已保证同姓→同 postId） ──
  const consorts = Object.values(db.characters)
    .filter((c): c is CharacterContent => c.kind === "consort" && !!c.maternalClan && !!c.profile.surname)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const groups = new Map<string, { postId: string; consorts: CharacterContent[] }>();
  for (const c of consorts) {
    const surname = c.profile.surname!;
    const g = groups.get(surname);
    if (g) g.consorts.push(c);
    else groups.set(surname, { postId: c.maternalClan!.postId, consorts: [c] });
  }

  let famIndex = 0;
  const buildFamily = (
    surname: string,
    post: OfficialPost | null,
    linkedConsorts: CharacterContent[],
  ): void => {
    famIndex += 1;
    const fam = `fam_${pad4(famIndex)}`;
    const headId = `official_${fam}`;
    usedSurnames.add(surname);

    // 官员年龄：须长于最年长 linked 侍君至少 PARENT_CHILD_MIN_GAP 岁。
    const maxConsortAge = linkedConsorts.reduce((m, c) => Math.max(m, c.profile.age), 0);
    const minHeadAge = Math.max(OFFICIAL_MIN_AGE, maxConsortAge + PARENT_CHILD_MIN_GAP);
    const headAge = ageInRange(`${S}:${fam}:age`, minHeadAge, Math.min(OFFICIAL_MAX_AGE, Math.max(minHeadAge, minHeadAge + 14)));
    const gradeOrder = post?.gradeOrder ?? 0;

    officials[headId] = {
      id: headId,
      surname,
      givenName: pickGivenName(`${S}:${fam}:given`),
      postId: post?.id ?? null,
      loyalty: 40 + (gestationRoll(`${S}:${fam}:loy`) % 56),
      age: headAge,
      familyId: fam,
      status: "active",
      appointedAt,
    };
    if (post) occupy(book, post.id);

    const childIds: string[] = [];
    for (const c of linkedConsorts) {
      // 侍君为帝王男性侍御（女尊礼法），出身官员家族即官员之男（子）。
      consortBirthFamily[c.id] = fam;
      kin.parentChild(headId, c.id, "male");
      childIds.push(c.id);
    }

    const personIds = generateMembers(fam, `${S}:${fam}`, surname, headId, headAge, childIds, familyMembers, kin);

    const { influence, imperialFavor } = familyAttributes(`${S}:${fam}`, gradeOrder);
    officialFamilies[fam] = {
      id: fam,
      surname,
      influence,
      imperialFavor,
      memberIds: [headId, ...personIds, ...linkedConsorts.map((c) => c.id)],
    };
  };

  // ── 2) authored 母族（稳定顺序：按首位侍君 id） ──
  const orderedGroups = [...groups.entries()].sort((a, b) => (a[1].consorts[0]!.id < b[1].consorts[0]!.id ? -1 : 1));
  for (const [surname, g] of orderedGroups) {
    const post = db.officialPosts[g.postId] ?? null;
    buildFamily(surname, post, g.consorts);
  }

  // ── 3) 无关联填充家族 ──
  for (let u = 0; u < UNLINKED_FAMILY_COUNT; u++) {
    const surname = pickSurname(`${S}:u:${u}`, usedSurnames);
    const post = pickPostWithSeat(`${S}:u:${u}:post`, nonCommoner, book);
    buildFamily(surname, post, []);
  }

  return { officials, officialFamilies, familyMembers, kinship: kin.edges, consortBirthFamily };
}
