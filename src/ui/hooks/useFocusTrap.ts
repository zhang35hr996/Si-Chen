/**
 * 真模态焦点限制（focus containment）。把 Tab / Shift+Tab 循环约束在容器内，并在焦点已逸出（如点击不可聚焦
 * 背景后落到 body）时立即拉回——故焦点永不抵达 GameShell 顶栏/面包屑/设置/国情/国库等背景控件。禁用元素被排除。
 *
 * 实现：在 **document 捕获阶段** 同时挂 `keydown`（边界环绕 + 逸出后按方向拉回首/末）与 `focusin`（任何外部得焦
 * 立即拉回容器内）。容器级监听做不到这点：焦点真正离开容器后，事件从外部元素派发、不再冒泡经容器。
 *
 * 业务交接安全：乘风选定谕令时容器随即卸载；卸载后焦点落 body 触发 focusin，但此时 container.isConnected 已为
 * false → 守卫直接返回，绝不把焦点从下一个业务模态抢回。仅用于真模态面（PendingAudienceDrawer / ChengfengDispatch）；
 * 非模态的 AudiencePrompt 不用。
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

    const onFocusIn = (event: FocusEvent) => {
      if (!container.isConnected) return; // 容器正在卸载（业务交接）：不抢下一个模态的焦点
      if (!container.contains(event.target as Node)) {
        const items = focusableWithin(container);
        (items[0] ?? container).focus(); // 外部得焦 → 立即拉回容器内
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (!container.isConnected) return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (!container.contains(current)) {
        // 焦点已在容器外：Tab → 首项，Shift+Tab → 末项
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus(); // 从首项 Shift+Tab → 环绕到末项
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus(); // 从末项 Tab → 环绕到首项
      }
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [containerRef, active]);
}
