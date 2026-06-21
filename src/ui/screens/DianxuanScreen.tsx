import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import {
  describeRaiseHead, describeTalent, recommendRank, pickableRanks,
  type Candidate,
} from "../../store/grandSelection";

interface KeptPick { candidate: Candidate; rank: string }

export function DianxuanScreen({ registry, db, candidates, onDone }: {
  registry: AssetRegistry;
  db: ContentDB;
  store: GameStore;
  candidates: Candidate[];
  year: number;
  onDone: (kept: KeptPick[], leftEarly: boolean, reviewedCount: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [kept, setKept] = useState<KeptPick[]>([]);
  const [reveal, setReveal] = useState<string | null>(null); // 抬头/才艺旁白
  const [pickingRank, setPickingRank] = useState(false);

  const bg = registry.resolveVariant("bg.tiyuandian", "day", "background");
  const cur = candidates[idx];

  if (!cur) return null;

  const portrait = registry.portrait(cur.content.portraitSet, "neutral");
  const ranks = pickableRanks(db);
  const recommended = recommendRank(cur.grade);
  const recommendedName = db.ranks[recommended]?.name ?? "更衣";

  const isLast = idx >= candidates.length - 1;

  /** 进入下一位；若已是最后一位则结束殿选（leftEarly=false，已全部审阅）。 */
  const goNext = (nextKept: KeptPick[]) => {
    if (isLast) { onDone(nextKept, false, idx + 1); return; }
    setKept(nextKept);
    setReveal(null);
    setPickingRank(false);
    setIdx((i) => i + 1);
  };

  const pass = () => goNext(kept);                                   // 撂牌子
  const keep = (rank: string) => goNext([...kept, { candidate: cur, rank }]); // 留牌子定位分

  return (
    <main className="dialogue-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <img className="dialogue-screen__portrait" src={portrait.url} alt={cur.content.profile.name}
           data-fallback={portrait.isFallback || undefined} />
      <section className="dialogue-screen__box">
        <p className="dialogue-screen__speaker">礼官</p>
        <p className="dialogue-screen__line">{cur.announce}</p>
        <p className="dialogue-screen__line">秀男上前行礼：参见陛下、太后、皇后，吾皇万福金安。</p>
        {reveal && <p className="dialogue-screen__line">{reveal}</p>}

        {!pickingRank ? (
          <div className="dialogue-screen__choices">
            <button type="button" onClick={() => setReveal(describeRaiseHead(cur.content))}>抬起头来</button>
            <button type="button" onClick={() => setReveal(describeTalent(cur.content))}>问才艺</button>
            <button type="button" onClick={() => setPickingRank(true)}>留牌子</button>
            <button type="button" onClick={pass}>撂牌子</button>
            <button type="button" onClick={() => onDone(kept, true, idx)}>离开体元殿</button>
          </div>
        ) : (
          <div className="dialogue-screen__choices">
            <p className="dialogue-screen__line">皇后：陛下，臣侍觉得封为{recommendedName}比较合适。</p>
            {ranks.map((r) => (
              <button key={r.id} type="button" onClick={() => keep(r.id)}>
                {r.name}{r.id === recommended ? "（皇后所荐）" : ""}
              </button>
            ))}
            <button type="button" onClick={() => setPickingRank(false)}>再想想</button>
          </div>
        )}
      </section>
    </main>
  );
}
