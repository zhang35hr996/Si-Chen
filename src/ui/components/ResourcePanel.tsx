/**
 * 国情（§七）：只读宽抽屉，皇帝/朝局分组，明面/暗属性分组，使用形容词标签。
 */
import type { GameState } from "../../engine/state/types";
import { Drawer } from "./Drawer";
import { DescriptorStat } from "./DescriptorStat";
import { formatCoins } from "../screens/StorehouseScreen";

function NumberLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="attr-line">
      <span className="attr-line__label">{label}</span>
      <span className="attr-line__value">{value}</span>
    </div>
  );
}

export function ResourcePanel({ state, onClose }: { state: GameState; onClose: () => void }) {
  const { sovereign, nation } = state.resources;
  return (
    <Drawer title="国情" subtitle="朝野上下，尽在圣览" onClose={onClose}>
      <div className="profile-section">
        <h3 className="profile-h">皇帝 · 明面</h3>
        <DescriptorStat label="健康" scale="health" value={sovereign.health} />
        <DescriptorStat label="勤政" scale="diligence" value={sovereign.diligence} />
        <DescriptorStat label="威望" scale="prestige" value={sovereign.prestige} />
        <DescriptorStat label="武力" scale="martial" value={sovereign.martial} />
        <DescriptorStat label="政略" scale="statecraft" value={sovereign.statecraft} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">皇帝 · 暗属性</h3>
        <DescriptorStat label="暴戾" scale="cruelty" value={sovereign.cruelty} />
        <DescriptorStat label="皇权安全" scale="regimeSecurity" value={sovereign.regimeSecurity} />
        <NumberLine label="疲劳" value={sovereign.fatigue} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">国家 · 明面</h3>
        <DescriptorStat label="军力" scale="military" value={nation.military} />
        <div className="attr-line">
          <span className="attr-line__label">国库</span>
          <span className="attr-line__value">{formatCoins(nation.treasury)} 两</span>
        </div>
        <DescriptorStat label="民心" scale="publicSupport" value={nation.publicSupport} />
        <DescriptorStat label="生产力" scale="productivity" value={nation.productivity} />
        <DescriptorStat label="朝政" scale="governance" value={nation.governance} />
      </div>
      <div className="profile-section">
        <h3 className="profile-h">国家 · 暗属性</h3>
        <DescriptorStat label="外戚权势" scale="clanPowerNation" value={nation.consortClanPower} />
        <DescriptorStat label="大臣忠心" scale="loyalty" value={nation.ministerLoyalty} />
        <DescriptorStat label="贪腐" scale="corruption" value={nation.corruption} />
        <DescriptorStat label="宗室不满" scale="clanDiscontent" value={nation.clanDiscontent} />
        <DescriptorStat label="谣言热度" scale="rumor" value={nation.rumor} />
      </div>
    </Drawer>
  );
}
