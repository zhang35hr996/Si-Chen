import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { ChamberId } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import {
  describeRaiseHead, describeTalent, recommendRank, pickableRanks,
  type Candidate,
} from "../../store/grandSelection";
import { autoAssignResidence, buildRelocate } from "../../store/relocate";
import { RelocateModal } from "../components/RelocateModal";

interface KeptPick { candidate: Candidate; rank: string }
type ResidenceStage = "none" | "prompt" | "auto_result";

const CHAMBER_NAMES: Record<ChamberId, string> = {
  main: "主殿",
  east_side: "东侧殿",
  west_side: "西侧殿",
  east_annex: "东偏殿",
  west_annex: "西偏殿",
};

export function DianxuanScreen({ registry, db, store, candidates, onDone }: {
  registry: AssetRegistry;
  db: ContentDB;
  store: GameStore;
  candidates: Candidate[];
  year: number;
  /**
   * 殿选结束回调。reviewedCount = 玩家已「决定」（留/撂）的秀男数：
   * 全部看完=candidates.length；中途离场=idx（当前这位未决，留在未审阅池）。
   * 调用方据此取未审阅者：candidates.slice(reviewedCount)。
   */
  onDone: (kept: KeptPick[], leftEarly: boolean, reviewedCount: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [kept, setKept] = useState<KeptPick[]>([]);
  const [reveal, setReveal] = useState<string | null>(null); // 抬头/才艺旁白或业务错误
  const [pickingRank, setPickingRank] = useState(false);
  const [pendingKeep, setPendingKeep] = useState<KeptPick | null>(null);
  const [residenceStage, setResidenceStage] = useState<ResidenceStage>("none");
  const [manualResidenceOpen, setManualResidenceOpen] = useState(false);
  const [empressLine, setEmpressLine] = useState<string | null>(null);

  const bg = registry.resolveVariant("bg.tiyuandian", "day", "background");
  const cur = candidates[idx];

  if (!cur) return null;

  const state = store.getState();
  const runtimeDb: ContentDB = {
    ...db,
    characters: { ...db.characters, ...state.generatedConsorts },
  };
  const portrait = registry.portrait(cur.content.portraitSet, "neutral");
  const empress = runtimeDb.characters.shen_zhibai;
  const empressPortrait = empress ? registry.portrait(empress.portraitSet, "neutral") : null;
  const ranks = pickableRanks(db);
  const recommended = recommendRank(cur.grade);
  const recommendedName = db.ranks[recommended]?.name ?? "更衣";

  const isLast = idx >= candidates.length - 1;

  const identityLabel = (pick: KeptPick): string => {
    const surname = pick.candidate.content.profile.name.slice(0, 1);
    return `${surname}${db.ranks[pick.rank]?.name ?? "侍君"}`;
  };

  /** 进入下一位；若已是最后一位则结束殿选（leftEarly=false，已全部审阅）。 */
  const goNext = (nextKept: KeptPick[]) => {
    if (isLast) { onDone(nextKept, false, idx + 1); return; }
    setKept(nextKept);
    setReveal(null);
    setPickingRank(false);
    setPendingKeep(null);
    setResidenceStage("none");
    setManualResidenceOpen(false);
    setEmpressLine(null);
    setIdx((i) => i + 1);
  };

  const pass = () => goNext(kept); // 撂牌子

  /**
   * 定位分时先把这一位原子入册，使搬迁弹窗和空室规划器都能使用正式 standing。
   * App 在殿选结束时会再次提交整批；addGeneratedConsort 对同内容/同位分重复提交幂等，
   * 不会覆盖此处随后写入的 residence/chamber。
   */
  const keep = (rank: string) => {
    const pick: KeptPick = { candidate: cur, rank };
    const committed = store.commitDaxuanSelections(db, [pick]);
    if (!committed.ok) {
      setReveal("留牌入册时出了岔子，请重新选择位分。");
      return;
    }
    setPendingKeep(pick);
    setPickingRank(false);
    setResidenceStage("prompt");
    setReveal(null);
  };

  const finishPendingKeep = () => {
    if (!pendingKeep) return;
    goNext([...kept, pendingKeep]);
  };

  const applyResidence = (location: string, chamber: ChamberId): boolean => {
    if (!pendingKeep) return false;
    const latestState = store.getState();
    const latestDb: ContentDB = {
      ...db,
      characters: { ...db.characters, ...latestState.generatedConsorts },
    };
    const effects = buildRelocate(
      latestDb,
      latestState,
      pendingKeep.candidate.content.id,
      location,
      chamber,
    );
    if (!effects) return false;
    return store.applyEffects(latestDb, effects).ok;
  };

  const letEmpressAssign = () => {
    if (!pendingKeep) return;
    const latestState = store.getState();
    const latestDb: ContentDB = {
      ...db,
      characters: { ...db.characters, ...latestState.generatedConsorts },
    };
    const assignment = autoAssignResidence(latestDb, latestState, pendingKeep.rank);
    const label = identityLabel(pendingKeep);
    if (!assignment) {
      setEmpressLine(`宫中的宫室还需要洒扫，${label}先暂住储秀宫吧。`);
      setResidenceStage("auto_result");
      return;
    }
    if (!applyResidence(assignment.location, assignment.chamber)) {
      setReveal("宫务册上出了岔子，住处尚未安排，请重新选择。");
      return;
    }
    const palaceName = db.locations[assignment.location]?.name ?? assignment.location;
    setEmpressLine(`那么${label}就先住${palaceName}的${CHAMBER_NAMES[assignment.chamber]}吧。`);
    setResidenceStage("auto_result");
  };

  const showingEmpress = residenceStage === "prompt" || residenceStage === "auto_result";
  const shownPortrait = showingEmpress && empressPortrait ? empressPortrait : portrait;
  const shownName = showingEmpress ? (empress?.profile.name ?? "皇后") : cur.content.profile.name;

  return (
    <>
      <main className="dialogue-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
        <img className="dialogue-screen__portrait" src={shownPortrait.url} alt={shownName}
             data-fallback={shownPortrait.isFallback || undefined} />
        <section className="dialogue-screen__box">
          {residenceStage === "none" ? (
            <>
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
            </>
          ) : residenceStage === "prompt" && pendingKeep ? (
            <>
              <p className="dialogue-screen__speaker">皇后</p>
              <p className="dialogue-screen__line">
                陛下，{identityLabel(pendingKeep)}既已留牌，是否现在给他安排住处？
              </p>
              {reveal && <p className="dialogue-screen__line">{reveal}</p>}
              <div className="dialogue-screen__choices">
                <button type="button" onClick={() => setManualResidenceOpen(true)}>是</button>
                <button type="button" onClick={letEmpressAssign}>由皇后安排</button>
              </div>
            </>
          ) : (
            <>
              <p className="dialogue-screen__speaker">皇后</p>
              <p className="dialogue-screen__line">{empressLine}</p>
              <div className="dialogue-screen__choices">
                <button type="button" onClick={finishPendingKeep}>知道了</button>
              </div>
            </>
          )}
        </section>
      </main>

      {manualResidenceOpen && pendingKeep && (
        <RelocateModal
          db={runtimeDb}
          state={store.getState()}
          character={pendingKeep.candidate.content}
          onRelocate={(location, chamber) => {
            if (!applyResidence(location, chamber)) {
              setReveal("宫室安排未能落下，请重新选择。");
              return;
            }
            setManualResidenceOpen(false);
            finishPendingKeep();
          }}
          onClose={() => setManualResidenceOpen(false)}
        />
      )}
    </>
  );
}
