import { gestationRoll } from "../characters/gestation";

export const OFFICIAL_SURNAME_POOL: readonly string[] = [
  "王", "谢", "崔", "卢", "郑", "裴", "韦", "柳", "沈", "顾", "陆", "萧",
  "薛", "杜", "苏", "宋", "温", "秦", "江", "许", "徐", "韩", "杨", "周",
  "程", "林", "叶", "白", "孟", "方", "纪", "贺", "陶", "卫", "霍", "钟",
  "颜", "虞", "傅", "乔", "姜", "殷", "姚", "范", "邵", "赵", "陈",
  "司马", "上官", "欧阳", "诸葛", "长孙", "宇文", "皇甫", "公孙", "夏侯", "尉迟",
];

// 双字名为主，庄重；避用「郎」「卿」（official-naming-rule）。
export const OFFICIAL_GIVEN_NAME_POOL: readonly string[] = [
  "安石", "居正", "守仁", "守义", "守礼", "守正", "经邦", "济世", "治平", "安国",
  "定国", "辅国", "靖国", "兴国", "怀政", "秉政", "修政", "明政", "正则", "正言",
  "正度", "克明", "克勤", "克俭", "允中", "允正", "允文", "弘道", "弘文", "弘济",
  "弘毅", "弘正", "端方", "端谨", "端肃", "端正", "秉直", "秉正", "秉公", "秉义",
  "怀忠", "怀义", "怀信", "怀正", "敬之", "敬德", "敬义", "敬文", "慎行", "慎言",
  "文正", "文忠", "文肃", "文清", "书衡", "书正", "书远", "清献", "清端", "清正",
  "明允", "明道", "明礼", "明远", "知远", "知礼", "知章", "知政",
];

export function pickGivenName(seed: string): string {
  return OFFICIAL_GIVEN_NAME_POOL[gestationRoll(`given:${seed}`) % OFFICIAL_GIVEN_NAME_POOL.length]!;
}

/** 从姓氏池取一个未被占用的姓；从 hash 起点线性探查。 */
export function pickSurname(seed: string, used: ReadonlySet<string>): string {
  const n = OFFICIAL_SURNAME_POOL.length;
  const start = gestationRoll(`surname:${seed}`) % n;
  for (let i = 0; i < n; i++) {
    const s = OFFICIAL_SURNAME_POOL[(start + i) % n]!;
    if (!used.has(s)) return s;
  }
  return OFFICIAL_SURNAME_POOL[start]!; // 全占用兜底（不应发生：池 > K + 母家姓数）
}
