/**
 * 太医院正（常驻女官，确定性派生，不落存档）。姓名取官员姓名池（姓+名），
 * 立绘取 official1–official8（设计 §4.3）。仿 gongli.ts 的派生方式。
 */
import { fnv1a64Hex } from "../save/canonical";
import { pickSurname, pickGivenName } from "../officials/namePool";

export interface CourtPhysician {
  name: string;
  /** 立绘集 id，如 "official3"；对应 manifest portrait.official3.neutral。 */
  portraitSet: string;
}

const OFFICIAL_PORTRAITS = 8;

function hashInt(s: string): number {
  return parseInt(fnv1a64Hex(s).slice(0, 8), 16);
}

/** 常驻太医院正（确定性，按 rngSeed 派生姓名 + 立绘）。 */
export function courtPhysician(rngSeed: number): CourtPhysician {
  const surname = pickSurname(`${rngSeed}:taiyi`, new Set());
  const given = pickGivenName(`${rngSeed}:taiyi`);
  const portraitSet = `official${1 + (hashInt(`${rngSeed}:taiyi:portrait`) % OFFICIAL_PORTRAITS)}`;
  return { name: `${surname}${given}`, portraitSet };
}
