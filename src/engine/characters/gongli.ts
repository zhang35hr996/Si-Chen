/**
 * 侍君贴身宫隶（确定性派生，不落存档）。名字取自 lilangNames 的无姓二字名池，
 * 立绘取自 gongli1–6。同一侍君固定 2 名、互不相同（设计 §5.1）。
 */
import { fnv1a64Hex } from "../save/canonical";
import { MALE_ATTENDANT_RESERVED_CHARS } from "./lilangNames";

export interface GongliAttendant {
  name: string;
  /** 立绘集 id，如 "gongli3"；对应 manifest portrait.gongli3.neutral。 */
  portraitSet: string;
}

const GONGLI_PORTRAITS = 6;

function hashInt(s: string): number {
  return parseInt(fnv1a64Hex(s).slice(0, 8), 16);
}

/** 某侍君的 2 名贴身宫隶（确定性，互不相同）。 */
export function attendantsOf(rngSeed: number, consortId: string): [GongliAttendant, GongliAttendant] {
  const pool = MALE_ATTENDANT_RESERVED_CHARS;
  const n = pool.length;
  const i0 = hashInt(`${rngSeed}:${consortId}:gongli:0`) % n;
  let i1 = hashInt(`${rngSeed}:${consortId}:gongli:1`) % n;
  if (i1 === i0) i1 = (i1 + 1) % n;
  const make = (idx: number, slot: number): GongliAttendant => ({
    name: pool[idx]!,
    portraitSet: `gongli${1 + (hashInt(`${rngSeed}:${consortId}:gongli:portrait:${slot}`) % GONGLI_PORTRAITS)}`,
  });
  return [make(i0, 0), make(i1, 1)];
}

/** 缺席时由哪名宫隶禀告：按 dayIndex 在 2 名间择一（当日稳定，跨日可换）。 */
export function reportingAttendant(rngSeed: number, consortId: string, dayIndex: number): GongliAttendant {
  return attendantsOf(rngSeed, consortId)[dayIndex % 2]!;
}
