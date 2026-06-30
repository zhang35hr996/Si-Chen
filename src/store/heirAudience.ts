/** 紫宸殿皇嗣召见互动：说话/陪玩（未开蒙）与询问功课（已开蒙）。纯逻辑，无副作用。 */
import { gestationRollRaw } from "../engine/characters/gestation";
import { heirStage, heirPortraitSet, isEnrolled, listHeirsBySex } from "../engine/characters/heirs";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

export interface HeirAudiencePlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: string;
  speakerName: string;
}

export interface HeirLessonResult {
  subject: "scholarship" | "martial" | "virtue";
  performance: "excellent" | "good" | "mixed" | "poor";
  reportLines: string[];
  portraitSet: string;
  speakerName: string;
}

const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
const SUBJECT_LABEL: Record<(typeof SUBJECTS)[number], string> = {
  scholarship: "学问", martial: "骑射", virtue: "品行",
};

function displayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

// ── buildHeirAudienceAction ───────────────────────────────────────────────────

export function buildHeirAudienceAction(
  state: GameState,
  heirId: string,
  action: "talk" | "play",
): HeirAudiencePlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || heir.lifecycle !== "alive") return null;

  const name = displayName(state, heir);
  const stage = heirStage(heir, state.calendar);
  const { sociability, curiosity, assertiveness } = heir.personality;
  const { closeness, favor, imperialFear } = heir;

  const highSoc = sociability >= 65;
  const highFear = imperialFear >= 60;
  const highClose = closeness >= 60;
  const highCuriosity = curiosity >= 65;

  let lines: string[];

  if (stage === "infant") {
    // 乳母场景，不使用乘风立绘
    lines = action === "play"
      ? [
          `乳母小心翼翼将${name}抱至御前，${name}睁着乌溜溜的眼睛四处张望，见了陛下似乎十分高兴，咧嘴笑了。`,
          `陛下伸出手指，${name}一把攥住不放，小拳头用力得紧，满殿嬉笑，称赞小殿下与陛下亲厚。`,
        ]
      : [
          `乳母抱着${name}前来，${name}歪着头望着陛下，嘴里咿咿呀呀，像是在请安。`,
          `陛下轻声说话，${name}反而安静下来，专注地听着，偶尔发出几声软软的回应。`,
        ];
  } else if (stage === "toddler") {
    if (action === "play") {
      lines = highSoc
        ? [
            `${name}迈着小短腿扑进来，拉住陛下的衣袖便不放手，奶声奶气道："母皇陪我玩！"`,
            highCuriosity
              ? `陛下逗弄了半晌${name}，${name}问了一个又一个稀奇问题，精力旺得让陛下也叹服。`
              : `陛下陪着${name}在殿中嬉闹，笑声传了老远，${name}玩得满头大汗，意犹未尽。`,
          ]
        : highFear
        ? [
            `${name}怯生生地跟在乳母身后，不敢抬头，乳母取了玩具来，${name}才勉强抬眼去看。`,
            `陛下躬身陪${name}玩了一阵，${name}渐渐放开些，末了轻轻喊了声"母皇"，便又低下头去。`,
          ]
        : [
            `${name}只在殿角自己摆弄玩物，等陛下走近了，才小心翼翼地把最喜欢的那件递过来，似乎想要一起玩。`,
            `陛下接过，${name}眼睛一亮，扬起小脸，咯咯笑了许久。`,
          ];
    } else {
      // talk
      lines = highFear
        ? [
            `${name}被乳母牵来，垂头行了礼，偷眼瞧了瞧陛下，声音细若蚊鸣："儿……给母皇请安。"`,
            `陛下温言问了几句，${name}答得十分小心，生怕说错了话，手指悄悄揪紧了衣角。`,
          ]
        : favor >= 60
        ? [
            `${name}一见陛下便扑了上来，拽着衣袖不撒手，叽叽喳喳说了一通宫里的趣事，字字句句都透着亲近。`,
            `陛下应着，${name}越说越起劲，末了还仰头问了个古灵精怪的问题，哄得陛下不由失笑。`,
          ]
        : [
            `${name}跟在乳母身后走进来，见了陛下先行了礼，只安静地站着，等候陛下开口。`,
            `陛下问起这两日做了什么，${name}缓缓答了，话虽不多，却字字认真。`,
          ];
    }
  } else {
    // schooling
    if (action === "play") {
      lines = highSoc
        ? [
            `${name}得了召见，进来便先行礼，起身却忍不住偷笑，问母皇今日可否不考功课。`,
            highCuriosity
              ? `陛下笑应了，${name}果然七嘴八舌，什么都想问，一时问起御花园的仙鹤，一时又问起边关的地名。`
              : `与皇帝下了一局棋，${name}抓耳挠腮却还是输了，心服口服，向母皇拱手讨教，认真极了。`,
          ]
        : highFear
        ? [
            `${name}进来请安，听闻今日只是闲谈，神色才松动了一些，规规矩矩跟在陛下身后。`,
            `陛下问${name}想做什么，${name}迟疑了片刻，才小声说了个愿望，说完立刻低下头，像是怕说错了。`,
          ]
        : [
            `${name}今日放松许多，陛下与之信步走了一圈，${name}偶尔指着什么说上几句，倒比平日话多了些。`,
            highClose
              ? `末了${name}不知想到什么，拉了拉陛下的袖子，凑在耳边说了一件小事，难得的亲昵。`
              : `离去前${name}行了礼，道了声"多谢母皇"，语气平静，却步子轻快了不少。`,
          ];
    } else {
      // talk
      lines = highFear
        ? [
            `${name}入殿请安，应对周到，一举一动都合规矩，只是眉眼紧绷，每句话都斟酌再三才出口。`,
            `陛下问了几件近事，${name}一一作答，答完便垂手等着，始终没敢抬起头来看陛下。`,
          ]
        : highSoc
        ? [
            `${name}进来行礼，话匣子一开便收不住，今日宫里的趣事、功课上想到的疑问都一并倒出来，兴致勃勃。`,
            `陛下听罢，颔首笑问了两句，${name}立刻来了精神，一句接着一句，半点不见拘束。`,
          ]
        : assertiveness >= 65
        ? [
            `${name}进来请安，落座后主动说起这几日所想，说到兴头上声音也拔高了些，颇有几分认真。`,
            `陛下问了一个问题，${name}略一思忖便给出了自己的见解，言辞之间并不闪烁，自有一股笃定。`,
          ]
        : highClose
        ? [
            `${name}请安后，没等陛下发问，便把这两日遇到的事讲给陛下听，絮絮叨叨，亲厚之情溢于言表。`,
            `陛下认真听了，给了几句回应，${name}眉眼弯弯，尽是孺慕之情。`,
          ]
        : [
            `${name}规规矩矩进来请安，举止已有几分皇家气度，应对从容。`,
            `陛下问起近日起居，${name}一一作答，眉宇间难掩孺慕之情。`,
          ];
    }
  }

  return {
    effects: [{ type: "heir_audience", heirId, action }],
    lines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}

// ── resolveHeirLessonPerformance ──────────────────────────────────────────────

export function resolveHeirLessonPerformance(
  state: GameState,
  heirId: string,
): HeirLessonResult | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || heir.lifecycle !== "alive" || !isEnrolled(heir, state.calendar)) return null;

  const seed = `lesson:${state.rngSeed}:${heirId}:${state.calendar.dayIndex}`;
  const subjectIndex = gestationRollRaw(seed + ":subject") % 3;
  const subject = SUBJECTS[subjectIndex]!;
  const subjectValue = heir.education[subject];

  const { talent, diligence, neglect, personality: { curiosity, restraint, guile } } = heir;

  // Deterministic noise in range [-10, +10]
  const noise = (gestationRollRaw(seed + ":noise") % 21) - 10;

  const score =
    subjectValue * 0.45 +
    talent * 0.20 +
    diligence * 0.20 +
    curiosity * 0.10 +
    restraint * 0.05 -
    neglect * 0.15 +
    noise;

  const performance: HeirLessonResult["performance"] =
    score >= 75 ? "excellent" :
    score >= 55 ? "good" :
    score >= 35 ? "mixed" :
    "poor";

  const name = displayName(state, heir);
  const perfLabel: Record<HeirLessonResult["performance"], string> = {
    excellent: "出色", good: "稳健", mixed: "尚可", poor: "欠佳",
  };

  const maskedWeakness = guile >= 65 && performance !== "excellent";

  const reportLines = [
    `陛下考较${name}的${SUBJECT_LABEL[subject]}，${name}${
      maskedWeakness ? "思路灵活，应答间巧妙回避了不熟之处，" : ""
    }表现${perfLabel[performance]}。`,
    performance === "excellent"
      ? `${name}引经据典，条理清晰，先生在旁亦频频点头，颇为赞许。`
      : performance === "good"
      ? `${name}回答得当，偶有疏漏，总体仍见用功。`
      : performance === "mixed"
      ? `${name}勉力应答，有几处明显生疏，尚需加倍温习。`
      : `${name}支吾许久，答得颇为吃力，功课显然生疏。`,
  ];

  return {
    subject,
    performance,
    reportLines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}

// ── buildHeirLessonResponseReaction ──────────────────────────────────────────

/** 功课应对结束后的皇嗣反应台词（由父层在应用 effect 前构造，以便清除召见态后仍可播放）。 */
export function buildHeirLessonResponseReaction(
  state: GameState,
  heirId: string,
  performance: HeirLessonResult["performance"],
  response: "praise" | "admonish" | "neutral",
): HeirAudiencePlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || heir.lifecycle !== "alive") return null;

  const name = displayName(state, heir);
  const { assertiveness, guile } = heir.personality;
  const { imperialFear, closeness } = heir;

  const highFear = imperialFear >= 60;
  const highAssert = assertiveness >= 65;
  const highGuile = guile >= 65;
  const highClose = closeness >= 60;

  let lines: string[];

  if (response === "praise") {
    if (performance === "excellent") {
      lines = highAssert
        ? [
            `${name}从容谢恩，眉间却仍难掩几分自得，十分满意自己的答案。`,
          ]
        : highClose
        ? [
            `${name}展颜一笑，低声道："儿臣不敢当，往后还要更加用功。"言辞谦逊，眼中却有掩不住的喜色。`,
          ]
        : [
            `${name}恭谨谢恩，应答有礼，举止稳重，颇见涵养。`,
          ];
    } else if (highGuile) {
      lines = [
        `${name}欠身谢恩，面上没有慌乱，从容道："多谢母皇鼓励，儿臣仍需精进。"`,
      ];
    } else if (highFear) {
      lines = [
        `${name}受宠若惊，连声谢恩，低头的姿态仍带着小心翼翼，须臾才抬起脸来，显得有些不知所措。`,
      ];
    } else {
      lines = [
        `${name}谢了恩，轻轻抬起头来，嘴角微弯，显然在竭力压住心中的高兴。`,
      ];
    }
  } else if (response === "admonish") {
    if (highAssert && !highFear) {
      lines = [
        `${name}低头领训，神色平静，却隐约透出一丝不服，退下时步子依旧沉稳，没有半分委屈的模样。`,
      ];
    } else if (highFear) {
      lines = [
        `${name}脸色一白，连声请罪，答应回去加倍温习，声音已带了几分哽咽，不敢抬头。`,
      ];
    } else if (performance === "excellent") {
      lines = [
        `${name}显然没料到会受训，愣了片刻，随即低头应是，神情间有些茫然，却不敢辩解。`,
      ];
    } else {
      lines = [
        `${name}垂首领训，承认过失，许诺会加倍用功，态度恭顺，只是眉心微皱，显见是心里不好受。`,
      ];
    }
  } else {
    // neutral
    if (highFear) {
      lines = [
        `${name}摸不准皇帝心意，退下时仍显得惴惴不安，回头望了一眼，神色颇为忐忑。`,
      ];
    } else if (highAssert) {
      lines = [
        `${name}施礼告退，神情平静，似是早已预料到这样的结果，并不因此懈怠或慌乱。`,
      ];
    } else {
      lines = [
        `${name}恭谨退下，面上波澜不惊，只是走出几步后，悄悄松了口气。`,
      ];
    }
  }

  return {
    effects: [],
    lines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}
