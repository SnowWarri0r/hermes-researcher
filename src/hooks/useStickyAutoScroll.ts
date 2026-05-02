import { useCallback, useEffect, useRef } from "react";

/**
 * Auto-scroll a scrollable container to the bottom on dependency change,
 * but only when the user has not scrolled up. As soon as the user scrolls
 * away from the bottom, "stickiness" is dropped and auto-follow stops.
 * Stickiness re-engages when they scroll back to (near) the bottom.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useStickyAutoScroll(ref, [text, streaming]);
 *   <div ref={ref} className="overflow-y-auto"> ... </div>
 *
 * Or via callback to scroll an arbitrary container that you can locate
 * yourself (e.g. when the scroll target is a parent reached via DOM walk).
 */
export function useStickyAutoScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  deps: unknown[],
  options: { threshold?: number } = {},
) {
  const threshold = options.threshold ?? 32;
  const stickyRef = useRef(true);

  // Watch user scrolls — flip stickiness when they pull away or return.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance <= threshold;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef, threshold]);

  // After deps change, scroll to bottom if still sticky.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Variant: scroll target is a sentinel element (anchor at the bottom of
 * the content) and the scroll container is the nearest ancestor with
 * vertical overflow. Used when the streaming content lives inside an
 * arbitrarily-nested scroll panel that isn't easy to ref directly.
 */
export function useStickyScrollIntoView(
  anchorRef: React.RefObject<HTMLElement | null>,
  deps: unknown[],
  options: { threshold?: number } = {},
) {
  const threshold = options.threshold ?? 32;
  const stickyRef = useRef(true);
  const containerRef = useRef<HTMLElement | null>(null);

  // Locate the scrolling ancestor once the anchor mounts.
  useEffect(() => {
    let el = anchorRef.current?.parentElement ?? null;
    while (el) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
        containerRef.current = el;
        break;
      }
      el = el.parentElement;
    }
  }, [anchorRef]);

  // Track sticky state on the resolved container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance <= threshold;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  const scrollNow = useCallback(() => {
    const el = containerRef.current;
    if (!el || !stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // After deps change, scroll only if still sticky.
  useEffect(() => {
    scrollNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
