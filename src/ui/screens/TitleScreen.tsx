/**
 * PR 1 scope: the title screen exists and renders; 新游戏 is wired up in PR 2
 * when GameState + calendar land (skeleton-plan §12).
 */
export function TitleScreen() {
  return (
    <main className="title-screen">
      <h1 className="title-screen__name">凤司晨</h1>
      <nav className="title-screen__menu">
        <button type="button" className="title-screen__button" disabled>
          新游戏
        </button>
        <button type="button" className="title-screen__button" disabled>
          继续
        </button>
        <p className="title-screen__note">骨架构建中 — PR 1 / 12</p>
      </nav>
    </main>
  );
}
