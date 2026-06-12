export function TitleScreen({ onNewGame }: { onNewGame: () => void }) {
  return (
    <main className="title-screen">
      <h1 className="title-screen__name">凤司晨</h1>
      <nav className="title-screen__menu">
        <button type="button" className="title-screen__button" onClick={onNewGame}>
          新游戏
        </button>
        <button type="button" className="title-screen__button" disabled title="存档系统于 PR 10 接入">
          继续
        </button>
        <p className="title-screen__note">骨架构建中 — PR 4 / 12</p>
      </nav>
    </main>
  );
}
