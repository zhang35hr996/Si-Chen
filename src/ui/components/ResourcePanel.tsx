/**
 * 国情（§七）：只读宽抽屉，朝局/后宫/血脉分组，标签 + 数字 + 进度条。
 * 仅展示当前 state 模型既有字段；属性体系 realignment 属独立数据任务，本次不引入新数值。
 */
import type { GameState } from "../../engine/state/types";
import { Drawer } from "./Drawer";

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat__label">{label}</span>
      <span className="profile-stat__bar">
        <span className="profile-stat__fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="profile-stat__val">{value}</span>
    </div>
  );
}

export function ResourcePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const { court, harem, bloodline } = state.resources;
  return (
    <Drawer title="国情" subtitle="朝野上下，尽在圣览" onClose={onClose}>
      <div className="profile-section">
        <h3 className="profile-h">朝局</h3>
        <Bar label="圣威" value={court.authority} />
        <Bar label="民心" value={court.publicSupport} />
        <Bar label="派系压力" value={court.factionPressure} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">后宫</h3>
        <Bar label="和睦" value={harem.harmony} />
        <Bar label="妒意" value={harem.jealousy} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">血脉</h3>
        <Bar label="宗嗣合法性" value={bloodline.legitimacy} />
      </div>
    </Drawer>
  );
}
