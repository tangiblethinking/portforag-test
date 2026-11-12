/**
 * Mobile composer anchoring. iOS Safari keeps the layout viewport (window.innerHeight) when the keyboard opens or the
 * toolbars show, and only the visual viewport shrinks/pans, so `position: fixed; bottom: 0` (or 100dvh) can sit behind
 * the keyboard or below the visible screen. These insets place the fixed bar at the bottom of what is actually visible.
 */
export const KEYBOARD_PX = 40; // a bottom gap above this means the on-screen keyboard (not just toolbar jitter) is open

export type ViewportInsets = { top: number; height: number; bottom: number; keyboard: boolean };

export function viewportInsets(innerHeight: number, vv?: { height: number; offsetTop: number } | null): ViewportInsets {
  const height = vv ? vv.height : innerHeight;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  // gap between the bottom of the visual viewport and the bottom of the layout viewport
  const bottom = Math.max(0, Math.round(innerHeight - height - top));
  return { top: Math.round(top), height: Math.round(height), bottom, keyboard: bottom > KEYBOARD_PX };
}

/** Publishes the insets as CSS variables on <html> (--vv-top, --vv-height, --vv-bottom; data-kb) and keeps them current. */
export function trackVisualViewport(root: HTMLElement = document.documentElement): () => void {
  const vv = window.visualViewport;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const i = viewportInsets(window.innerHeight, vv);
    root.style.setProperty("--vv-top", `${i.top}px`);
    root.style.setProperty("--vv-height", `${i.height}px`);
    root.style.setProperty("--vv-bottom", `${i.bottom}px`);
    root.dataset.kb = i.keyboard ? "open" : "closed";
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
  apply();
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    for (const p of ["--vv-top", "--vv-height", "--vv-bottom"]) root.style.removeProperty(p);
    delete root.dataset.kb;
  };
}
