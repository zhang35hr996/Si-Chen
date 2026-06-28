/** 文昭殿：在读皇嗣名册（左）+ 科目选择·旁听·询问先生（右）。日间开馆，否则显示散学提示。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { heirAge, heirPortraitSet, isWenzhaoStudent, isWenzhaodianOpen, listHeirsBySex } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { courseLabel } from "../../store/heirEducation";
import { sovereignGestationDisplay } from "../format/gestationDisplay";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

type Subject = "scholarship" | "martial" | "virtue";
const SUBJECTS: Subject[] = ["scholarship", "martial", "virtue"];

export function WenzhaodianScreen({
  db, store, registry, onOpenMap, onOpenSettings, onLesson, onTutorReport, onOpenResources, onOpenStorehouse,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onLesson: (heirId: string, subject: Subject) => void;
  onTutorReport: (heirId: string) => void;
  onOpenResources?: () => void;
  onOpenStorehouse?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["wenzhaodian"]!;
  const tod = timeOfDay(state.calendar);
  const background = registry.resolveVariant(location.backgroundKey, tod, "background");
  const isOpen = isWenzhaodianOpen(state.calendar);
  const canAct = state.calendar.ap >= 1;

  const students = [
    ...listHeirsBySex(state.resources.bloodline.heirs, "daughter"),
    ...listHeirsBySex(state.resources.bloodline.heirs, "son"),
  ].filter((r) => isWenzhaoStudent(r.heir, state.calendar));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject>("scholarship");

  const selected = students.find((r) => r.heir.id === selectedId);

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      pregnancyMonth={sovereignGestationDisplay(state)?.month ?? undefined}
      onBack={onOpenMap}
      onOpenSettings={onOpenSettings}
      onOpenResources={onOpenResources}
      onOpenStorehouse={onOpenStorehouse}
    >
      <main className="location-screen wenzhao-screen">
        <section
          className="location-screen__stage"
          style={{ backgroundImage: `url("${background.url}")` }}
          data-fallback={background.isFallback || undefined}
        >
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
        </section>
        {!isOpen ? (
          <section className="location-screen__roster">
            <p className="location-screen__empty">已届散学，皇嗣们暂时不在殿中，请日间前来。</p>
          </section>
        ) : (
          <div className="wenzhao-screen__body">
            <section className="wenzhao-screen__roster">
              <h2>在读皇嗣</h2>
              {students.length === 0 ? (
                <p className="location-screen__empty">尚无皇嗣开蒙就读。</p>
              ) : (
                students.map(({ heir, name }) => (
                  <div
                    key={heir.id}
                    className={`roster-row${selectedId === heir.id ? " roster-row--selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(heir.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(heir.id)}
                  >
                    <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}　{heirAge(heir, state.calendar)}岁</span>
                  </div>
                ))
              )}
            </section>
            {selected ? (
              <section className="wenzhao-screen__detail">
                <div
                  className="wenzhao-screen__portrait"
                  style={{ backgroundImage: `url("${registry.portrait(heirPortraitSet(selected.heir, state.calendar), "neutral").url}")` }}
                />
                <h2>{selected.name}{selected.heir.givenName ? `·${selected.heir.givenName}` : ""}　{heirAge(selected.heir, state.calendar)}岁</h2>
                <div className="wenzhao-screen__education">
                  {SUBJECTS.map((s) => (
                    <span key={s}>{courseLabel(selected.heir.sex, s)}：{selected.heir.education[s]}</span>
                  ))}
                </div>
                <div className="wenzhao-screen__subject-picker">
                  {SUBJECTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={selectedSubject === s ? "btn-selected" : undefined}
                      onClick={() => setSelectedSubject(s)}
                    >
                      {courseLabel(selected.heir.sex, s)}
                    </button>
                  ))}
                </div>
                <div className="wenzhao-screen__actions">
                  <button
                    type="button"
                    disabled={!canAct}
                    onClick={() => { onLesson(selected.heir.id, selectedSubject); setSelectedId(null); }}
                  >
                    旁听{courseLabel(selected.heir.sex, selectedSubject)}课
                  </button>
                  <button
                    type="button"
                    disabled={!canAct}
                    onClick={() => { onTutorReport(selected.heir.id); setSelectedId(null); }}
                  >
                    询问先生
                  </button>
                </div>
              </section>
            ) : (
              <section className="wenzhao-screen__detail wenzhao-screen__detail--placeholder">
                <p>选择左侧皇嗣可旁听授课或询问先生。</p>
              </section>
            )}
          </div>
        )}
      </main>
    </GameShell>
  );
}
