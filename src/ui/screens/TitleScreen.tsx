export function TitleScreen({
  onNewGame,
  onContinue,
  canContinue,
  continueError,
}: {
  onNewGame: () => void;
  onContinue: () => void;
  canContinue: boolean;
  continueError?: string | null;
}) {
  return (
    <main className="title-screen">
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
