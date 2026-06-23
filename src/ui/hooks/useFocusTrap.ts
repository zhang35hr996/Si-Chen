/**
 * 真模态焦点限制（focus containment）。把 Tab / Shift+Tab 循环约束在容器内：从最后一个可聚焦元素 Tab
 * 回到第一个，从第一个 Shift+Tab 回到最后一个；禁用元素被排除；焦点一旦逸出容器即拉回。据此焦点永不抵达
 * GameShell 顶栏/面包屑/设置/国情/国库等背景控件。仅用于真模态面（PendingAudienceDrawer / ChengfengDispatch）；
 * 非模态的 AudiencePrompt 不用。
 *
 * 仅拦截「边界处」的 Tab（preventDefault + 手动聚焦环绕端）；容器内部的 Tab 放行（由浏览器/user-event 按
 * DOM 顺序移动）。监听挂在容器上：焦点在容器内时 keydown 冒泡至此。
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = focusableWithin(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus(); // 无可聚焦项：焦点留在对话容器，绝不外逸
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement;
      const outside = !container.contains(activeEl);
      if (e.shiftKey) {
        if (activeEl === first || outside) {
          e.preventDefault();
          last.focus(); // 从首元素 Shift+Tab → 环绕到末元素
        }
      } else if (activeEl === last || outside) {
        e.preventDefault();
        first.focus(); // 从末元素 Tab → 环绕到首元素
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, active]);
}
