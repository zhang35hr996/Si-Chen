/**
 * 乘风汇报系统：每行动点约 15% 概率触发一条后宫趣闻，不消耗行动点。
 * 汇报内容写入相关侍君的记忆，供日后对话引用。
 */
import { gestationRoll } from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import type { DecreeReaction } from "./empressDecree";

export const GOSSIP_CHANCE = 15; // 每行动点 15%

export interface GossipPlan {
  effects: EventEffect[];
  beat: DecreeReaction;
}

/** 取活跃侍君（不在冷宫、不在长门宫、未亡故）。 */
function activeConsorts(db: ContentDB, state: GameState) {
  return Object.values(db.characters).filter((c) => {
    if (c.kind !== "consort" || c.id === "shen_zhibai") return false;
    if (c.defaultLocation === "changmengong") return false;
    const st = state.standing[c.id];
    return !st || st.lifecycle !== "deceased";
  });
}

/** 取位分较高的侍君（order >= 120 算高位）。 */
function highRankedConsorts(db: ContentDB, state: GameState) {
  return activeConsorts(db, state).filter((c) => {
    const st = state.standing[c.id] ?? c.initialStanding;
    if (!st) return false;
    const rank = db.ranks[st.rank];
    return rank && rank.domain === "harem" && rank.order >= 120;
  });
}

/** 取位分较低的侍君（order < 120）。 */
function lowRankedConsorts(db: ContentDB, state: GameState) {
  return activeConsorts(db, state).filter((c) => {
    const st = state.standing[c.id] ?? c.initialStanding;
    if (!st) return false;
    const rank = db.ranks[st.rank];
    return rank && rank.domain === "harem" && rank.order < 120;
  });
}

function pickOne<T>(arr: T[], seed: number): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[gestationRoll(String(seed)) % arr.length];
}

function displayName(db: ContentDB, state: GameState, charId: string): string {
  const c = db.characters[charId];
  if (!c) return charId;
  const st = state.standing[charId] ?? c.initialStanding;
  return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
}

function rankName(db: ContentDB, state: GameState, charId: string): string {
  const c = db.characters[charId];
  if (!c) return "";
  const st = state.standing[charId] ?? c.initialStanding;
  if (!st) return "";
  return db.ranks[st.rank]?.name ?? "";
}

/** 御花园冲突：高位侍君罚低位侍君跪宫门。 */
function gossipGardenConflict(db: ContentDB, state: GameState, seed: string): GossipPlan | null {
  const high = highRankedConsorts(db, state);
  const low = lowRankedConsorts(db, state);
  if (high.length === 0 || low.length === 0) return null;
  const charA = pickOne(high, gestationRoll(`${seed}:a`));
  const charB = pickOne(low, gestationRoll(`${seed}:b`));
  if (!charA || !charB || charA.id === charB.id) return null;

  const nameA = displayName(db, state, charA.id);
  const nameB = displayName(db, state, charB.id);
  const locA = db.locations[charA.defaultLocation]?.name ?? "宫中";

  const line = `陛下，臣听闻${nameA}在御花园遇见了${nameB}，闹了些不愉快，罚${nameB}跪在${locA}门口一个时辰。${nameB}回宫的时候看着都有些可怜呢。`;

  return {
    effects: [
      {
        type: "memory",
        char: charA.id,
        entry: {
          kind: "event",
          summary: `在御花园与${nameB}起了冲突，罚其跪宫门一个时辰。`,
          salience: 55,
          tags: ["conflict", "punish"],
          participants: [charA.id, charB.id],
          protected: false,
        },
      },
      {
        type: "memory",
        char: charB.id,
        entry: {
          kind: "event",
          summary: `御花园遇${nameA}，被责罚跪宫门一个时辰。`,
          salience: 65,
          tags: ["conflict", "humiliated"],
          participants: [charA.id, charB.id],
          protected: false,
        },
      },
    ],
    beat: { speakerId: "cheng_feng", lines: [line] },
  };
}

/** 凤后斥责侍君：皇后以礼仪有失为由申斥一名侍君。 */
function gossipEmpressScold(db: ContentDB, state: GameState, seed: string): GossipPlan | null {
  const targets = activeConsorts(db, state).filter((c) => {
    const st = state.standing[c.id] ?? c.initialStanding;
    if (!st) return false;
    const rank = db.ranks[st.rank];
    return rank && rank.domain === "harem" && rank.order <= 134;
  });
  if (targets.length === 0) return null;
  const charB = pickOne(targets, gestationRoll(`${seed}:target`));
  if (!charB) return null;

  const nameB = displayName(db, state, charB.id);
  const rankB = rankName(db, state, charB.id);

  const line = `陛下，听闻皇后娘娘斥责${nameB}在宫中言行失仪，冒犯尊上，训诫了一番。${nameB}领训之后回宫，臣瞧着神色有些难看。`;

  return {
    effects: [
      {
        type: "memory",
        char: charB.id,
        entry: {
          kind: "event",
          summary: `凤后因言行失仪之由斥责${rankB}，当众受训，颜面有损。`,
          salience: 60,
          tags: ["empress", "scolded"],
          participants: ["shen_zhibai", charB.id],
          protected: false,
        },
      },
      {
        type: "memory",
        char: "shen_zhibai",
        entry: {
          kind: "event",
          summary: `以失仪为由申斥${nameB}，整肃后宫风气。`,
          salience: 45,
          tags: ["empress", "discipline"],
          participants: ["shen_zhibai", charB.id],
          protected: false,
        },
      },
    ],
    beat: { speakerId: "cheng_feng", lines: [line] },
  };
}

/** 侍君争宠：两名侍君在宫道相遇，高位者令低位者回避。 */
function gossipYieldPath(db: ContentDB, state: GameState, seed: string): GossipPlan | null {
  const high = highRankedConsorts(db, state);
  const low = lowRankedConsorts(db, state);
  if (high.length === 0 || low.length === 0) return null;
  const charA = pickOne(high, gestationRoll(`${seed}:a`));
  const charB = pickOne(low, gestationRoll(`${seed}:b`));
  if (!charA || !charB || charA.id === charB.id) return null;

  const nameA = displayName(db, state, charA.id);
  const nameB = displayName(db, state, charB.id);

  const line = `陛下，臣路过宫道，见${nameA}和${nameB}迎面碰上了。${nameA}叫${nameB}让路，${nameB}候在墙边等了好一会儿，臣看着都有些替${nameB}捏把汗。`;

  return {
    effects: [
      {
        type: "memory",
        char: charB.id,
        entry: {
          kind: "event",
          summary: `在宫道被${nameA}呵令让路，候立墙边，颇感委屈。`,
          salience: 50,
          tags: ["conflict", "yield"],
          participants: [charA.id, charB.id],
          protected: false,
        },
      },
    ],
    beat: { speakerId: "cheng_feng", lines: [line] },
  };
}

/** 侍君郁郁：一名侍君近来神色黯然。 */
function gossipDowncast(db: ContentDB, state: GameState, seed: string): GossipPlan | null {
  const candidates = activeConsorts(db, state).filter((c) => {
    const st = state.standing[c.id] ?? c.initialStanding;
    return st && (st.favor ?? 50) < 40;
  });
  if (candidates.length === 0) return null;
  const char = pickOne(candidates, gestationRoll(`${seed}:pick`));
  if (!char) return null;

  const name = displayName(db, state, char.id);
  const line = `陛下，臣见${name}近来神色郁郁，瞧着眼眶都是红的，也不知是有什么委屈。陛下若有空，或许可去看看她——嗯，看看他。`;

  return {
    effects: [
      {
        type: "memory",
        char: char.id,
        entry: {
          kind: "opinion",
          summary: `近日郁郁寡欢，宫人皆知，乘风也留意到了。`,
          salience: 45,
          tags: ["mood", "neglect"],
          participants: [char.id],
          protected: false,
        },
      },
    ],
    beat: { speakerId: "cheng_feng", lines: [line] },
  };
}

const GOSSIP_BUILDERS = [
  gossipGardenConflict,
  gossipEmpressScold,
  gossipYieldPath,
  gossipDowncast,
];

/**
 * 含 15% 概率门：每行动点调用一次。
 * 命中后随机选一条模板，若无合适角色则静默放弃（不报错）。
 */
export function buildChengFengGossip(db: ContentDB, state: GameState, seedKey: string): GossipPlan | null {
  if (gestationRoll(`chengfeng:gate:${seedKey}`) % 100 >= GOSSIP_CHANCE) return null;
  const idx = gestationRoll(`chengfeng:pick:${seedKey}`) % GOSSIP_BUILDERS.length;
  return GOSSIP_BUILDERS[idx]!(db, state, `chengfeng:${seedKey}`);
}

/** 乘风询问陛下去看哪位侍君（进入后宫地图时触发，无记忆效果）。 */
export function chengFengHaremGreeting(): DecreeReaction {
  return {
    speakerId: "cheng_feng",
    lines: ["不知陛下今日想去看哪位侍君呢？"],
    backgroundKey: "bg.hougong",
  };
}
