import type { AssetRegistry } from "../../engine/assets/registry";

export function TitleScreen({
  registry,
  onNewGame,
  onContinue,
  canContinue,
  continueError,
}: {
  registry: AssetRegistry;
  onNewGame: () => void;
  onContinue: () => void;
  canContinue: boolean;
  continueError?: string | null;
}) {
  const opening = registry.background("bg.game_start");
  return (
    <main
      className="title-screen"
      style={{
        // 开篇立绘垫底，上覆暗纹光晕保证「凤司晨」与按钮清晰可读。
        backgroundImage:
          `radial-gradient(ellipse at 50% 32%, rgba(20, 14, 11, 0.55) 0%, transparent 60%), ` +
          `radial-gradient(ellipse at 50% 120%, rgba(120, 40, 28, 0.22), transparent 55%), ` +
          `url("${opening.url}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      data-fallback={opening.isFallback || undefined}
    >
      <h1 className="title-screen__name">凤司晨</h1>
      <nav className="title-screen__menu">
        <button type="button" className="title-screen__button" onClick={onNewGame}>
          新游戏
        </button>
        <button
          type="button"
          className="title-screen__button"
          disabled={!canContinue}
          title={canContinue ? "读取自动存档" : "暂无自动存档"}
          onClick={onContinue}
        >
          继续
        </button>
        {continueError && <p className="title-screen__note">{continueError}</p>}
        <p className="title-screen__note">骨架构建中 — PR 10 / 12</p>
      </nav>
    </main>
  );
}
