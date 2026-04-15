import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Lightweight dark-themed tooltip.
 * - Immediate on hover (no browser delay)
 * - Multi-line content via \n
 * - Auto-flips above/below based on viewport space
 */
export function Tooltip({
  content,
  children,
  className = "",
}: {
  content: string | ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPlacement(rect.top < 200 ? "bottom" : "top");
  }, [show]);

  const lines = typeof content === "string" ? content.split("\n") : null;

  return (
    <span
      ref={triggerRef}
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          className={`absolute left-1/2 -translate-x-1/2 z-50 min-w-[200px] max-w-[360px] pointer-events-none
            bg-abyss border border-charcoal-light rounded-md px-3 py-2 text-[11px] text-parchment
            shadow-xl font-sans whitespace-normal
            ${placement === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
        >
          {lines
            ? lines.map((line, i) => (
                <span key={i} className="block leading-relaxed">
                  {line || "\u00a0"}
                </span>
              ))
            : content}
        </span>
      )}
    </span>
  );
}
