import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { shopShelf, priceOf, type ShopId } from "../../store/shop";
import { formatCoins } from "../format";

export function ShopScreen({ db, store, registry, shopId, onClose }: {
  db: ContentDB; store: GameStore; registry: AssetRegistry; shopId: ShopId; onClose: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[shopId];
  const bg = location?.backgroundKey
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  const shelf = shopShelf(db, shopId, state.calendar.dayIndex, state.rngSeed);
  const coins = state.resources.nation.treasury;
  return (
    <main className="shop-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <header className="hud">
        <span className="hud__time">{location?.name} · 铜钱：{formatCoins(coins)} 两</span>
        <button type="button" className="hud__button" onClick={onClose}>返回</button>
      </header>
      <section className="shop-screen__shelf">
        {shelf.map((id) => {
          const item = db.items[id]!;
          const price = priceOf(item, `${shopId}:${state.calendar.dayIndex}`);
          const affordable = coins >= price;
          return (
            <div key={id} className="shop-screen__row">
              <span className="shop-screen__name">{item.name}</span>
              <span className="shop-screen__price">{formatCoins(price)} 两</span>
              <button type="button" disabled={!affordable} onClick={() => store.buyItem(id, price)}>购买</button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
