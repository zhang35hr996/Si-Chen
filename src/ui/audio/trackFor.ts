export type TrackId = "main" | "hougong" | "jiaowai" | "market" | "wenqing";

/** 场景 → BGM 曲目。view=map 时按所看 board；其余按 playerLocation 的 zone。 */
export function trackFor(input: { view: string; board?: string; zone?: string }): TrackId {
  const { view, board, zone } = input;
  if (view === "title") return "main";
  if (view === "courtyard") return "hougong";
  const key = view === "map" ? board : zone;
  if (key === "hougong") return "hougong";
  if (key === "jingcheng") return "market";
  if (key === "jingjiao") return "jiaowai";
  return "wenqing";
}
