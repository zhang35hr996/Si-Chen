/** 御书房·召见太医（1 行动点）。看诊区常驻；自孕中可流胎（红色二次确认）；承嗣不可弃另行提示；二者可共存。 */
import { useState } from "react";
import type { ConsultOption } from "../../store/physician";

export function PhysicianModal({
  selfCarrying,
  consortCarrying,
  physicianName,
  consults,
  onConsult,
  onPickConsort,
  onPickHeir,
  onAbort,
  onClose,
}: {
  selfCarrying: boolean;
  consortCarrying: boolean;
  physicianName: string;
  consults: ConsultOption[];
  onConsult: (key: "sovereign" | "taihou") => void;
  onPickConsort: () => void;
  onPickHeir: () => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleConsultClick = (opt: ConsultOption) => {
    if (opt.disabled) return;
    if (opt.key === "consort") { onPickConsort(); return; }
    if (opt.key === "heir") { onPickHeir(); return; }
    onConsult(opt.key);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="physician-modal" onClick={(e) => e.stopPropagation()}>
        <h2>太医院正请安</h2>

        {/* 看诊区：常驻，四类入口 */}
        <section className="physician-modal__consult">
          <p className="physician-modal__physician-name">院正：{physicianName}</p>
          <ul className="physician-modal__consult-list">
            {consults.map((opt) => (
              <li key={opt.key}>
                <button
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => handleConsultClick(opt)}
                  title={opt.disabled ? opt.disabledReason : undefined}
                >
                  {opt.label}
                  {opt.disabled && opt.disabledReason ? `（${opt.disabledReason}）` : ""}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* 自孕流胎入口（独立条件，与承嗣说明可共存） */}
        {selfCarrying && (
          <section className="physician-modal__abort">
            {confirming ? (
              <>
                <p className="physician-modal__warn">皇嗣是国家大事，可有不妥？此举不可挽回。</p>
                <button type="button" className="physician-modal__danger" onClick={onAbort}>
                  执意流胎
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  取消
                </button>
              </>
            ) : (
              <>
                <p>陛下凤体有孕，院正候旨。</p>
                <button
                  type="button"
                  className="physician-modal__danger"
                  onClick={() => setConfirming(true)}
                >
                  流胎
                </button>
              </>
            )}
          </section>
        )}

        {/* 承嗣说明（独立条件，与自孕流胎入口可共存） */}
        {consortCarrying && (
          <section className="physician-modal__consort-carrying">
            <p>皇嗣已承于承嗣君，承养不可弃，唯静候临盆。</p>
          </section>
        )}

        <button type="button" className="physician-modal__close" onClick={onClose}>
          退下
        </button>
      </div>
    </div>
  );
}
