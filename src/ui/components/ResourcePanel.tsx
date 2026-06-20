/**
 * 国情（§七）：只读宽抽屉，皇帝/朝局分组，标签 + 数字 + 进度条。
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
  const { sovereign, nation } = state.resources;
  return (
    <Drawer title="国情" subtitle="朝野上下，尽在圣览" onClose={onClose}>
      <div className="profile-section">
        <h3 className="profile-h">皇帝</h3>
        <Bar label="健康" value={sovereign.health} />
        <Bar label="勤政" value={sovereign.diligence} />
        <Bar label="威望" value={sovereign.prestige} />
        <Bar label="武力" value={sovereign.martial} />
        <Bar label="政略" value={sovereign.statecraft} />
        <Bar label="暴戾" value={sovereign.cruelty} />
        <Bar label="疲劳" value={sovereign.fatigue} />
        <Bar label="皇权安全" value={sovereign.regimeSecurity} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">国家</h3>
        <Bar label="军力" value={nation.military} />
        <Bar label="国库" value={nation.treasury} />
        <Bar label="民心" value={nation.publicSupport} />
        <Bar label="生产力" value={nation.productivity} />
        <Bar label="朝政" value={nation.governance} />
        <Bar label="外戚权势" value={nation.consortClanPower} />
        <Bar label="大臣忠心" value={nation.ministerLoyalty} />
        <Bar label="贪腐" value={nation.corruption} />
        <Bar label="宗室不满" value={nation.clanDiscontent} />
        <Bar label="谣言热度" value={nation.rumor} />
      </div>
    </Drawer>
  );
}
