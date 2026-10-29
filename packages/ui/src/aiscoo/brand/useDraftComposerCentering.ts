import { useLayoutEffect, useRef } from "react";

const TOP_SPACE_PROPERTY = "--aiscoo-draft-top-space";

export function resolveDraftComposerTopSpace({
  viewportHeight,
  leadingHeight,
}: {
  viewportHeight: number;
  leadingHeight: number;
}): number {
  return Math.max(52, viewportHeight / 2 - leadingHeight);
}

export function useDraftComposerCentering() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const viewport = ref.current?.closest<HTMLElement>('[data-v4-timeline-scroll="true"]');
    const layout = viewport?.firstElementChild;
    if (!viewport || !(layout instanceof HTMLElement)) return;
    const before = window.getComputedStyle(layout, "::before");
    if (before.content === "none" || before.content === "normal") return;
    const composer = layout.querySelector<HTMLElement>(".chat-composer-input-surface");
    if (!composer) return;

    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const layoutRect = layout.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const currentTopSpace = Number.parseFloat(window.getComputedStyle(layout, "::before").height);
      const leadingHeight =
        composerRect.top - layoutRect.top - currentTopSpace + composerRect.height / 2;
      const nextTopSpace = resolveDraftComposerTopSpace({
        viewportHeight: viewportRect.height,
        leadingHeight,
      });
      const value = `${nextTopSpace}px`;
      if (layout.style.getPropertyValue(TOP_SPACE_PROPERTY) !== value) {
        layout.style.setProperty(TOP_SPACE_PROPERTY, value);
      }
    };

    // 横幅和输入高度会改变中心位置，观察它们的实际尺寸，避免固定偏移再次把输入框推低。
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(composer);
    for (const child of layout.children) observer.observe(child);
    const composerRegion = composer.closest(".chat-composer-region");
    if (composerRegion) observer.observe(composerRegion);
    measure();
    return () => {
      observer.disconnect();
      layout.style.removeProperty(TOP_SPACE_PROPERTY);
    };
  }, []);

  return ref;
}
