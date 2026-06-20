/**
 * 登基开场（新游戏后、进入游戏前）。背景 cg/dengji；先输入年号（恰好两中文字），
 * 确认后播登基叙事（尊太后入慈宁宫·封皇后入坤宁宫·群臣高呼万岁·天下同庆），
 * 「开始」→ onConfirm(年号)。纯叙事，不改游戏状态。
 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";

export function isValidEraName(s: string): boolean {
  return /^[一-鿿]{2}$/.test(s);
}

export function CoronationScreen({
  registry,
  onConfirm,
}: {
  registry: AssetRegistry;
  onConfirm: (era: string) => void;
}) {
  const bg = registry.background("bg.dengji");
  const [phase, setPhase] = useState<"era" | "ceremony">("era");
  const [era, setEra] = useState("");
  const valid = isValidEraName(era);

  return (
    <main
      className="coronation"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      {phase === "era" ? (
        <div className="coronation__panel">
          <p className="coronation__narrative">妘朝的第五位皇帝登基，改年号为——</p>
          <input
            className="coronation__input"
            value={era}
            maxLength={2}
            placeholder="请输入年号（两字）"
            onChange={(e) => setEra(e.target.value)}
          />
          <button type="button" disabled={!valid} onClick={() => setPhase("ceremony")}>
            确认年号
          </button>
        </div>
      ) : (
        <div className="coronation__panel">
          <p className="coronation__narrative">
            尊皇太后入慈宁宫，封皇后入坤宁宫。
            <br />
            群臣高呼万岁，行三跪九叩之礼。普天同庆，天下归心。
          </p>
          <p className="coronation__era">{`${era}元年正始`}</p>
          <button type="button" onClick={() => onConfirm(era)}>
            开始
          </button>
        </div>
      )}
    </main>
  );
}
