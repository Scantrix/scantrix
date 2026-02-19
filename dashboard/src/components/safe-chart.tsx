"use client";

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Positive seed dimensions fed to `ResponsiveContainer`'s
 * `initialDimension` prop so the very first render cycle never
 * produces the "width(-1) height(-1)" warning.  The real
 * dimensions from `ResizeObserver` replace these on the next frame.
 */
const INITIAL_DIMENSION = { width: 1, height: 1 } as const;

interface SafeChartProps {
  /** Fixed pixel height for the chart container. */
  height: number;
  /** Single Recharts chart element (AreaChart, BarChart, PieChart, etc.). */
  children: ReactElement;
  /** Optional CSS class for the outer wrapper. */
  className?: string;
}

/**
 * SSR-safe wrapper around Recharts' {@link ResponsiveContainer}.
 *
 * Defers rendering until the outer `<div>` has positive width and
 * height — preventing the "width(-1) height(-1)" warning that
 * occurs when {@link ResizeObserver} fires before CSS layout
 * during Next.js hydration.
 *
 * Defence layers:
 *  1. Render nothing on the server (state starts `false`).
 *  2. After mount, poll with rAF until the container is > 0 × 0.
 *  3. Provide positive `initialDimension` to avoid the first-render
 *     warning from Recharts' default `{ width: -1, height: -1 }`.
 *  4. Pass `minWidth` / `minHeight` as a final safeguard.
 *
 * @example
 * ```tsx
 * <SafeChart height={320}>
 *   <AreaChart data={data}>…</AreaChart>
 * </SafeChart>
 * ```
 */
export function SafeChart({ height, children, className }: SafeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const checkSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height: h } = el.getBoundingClientRect();
    if (width > 0 && h > 0) {
      setReady(true);
    } else {
      requestAnimationFrame(checkSize);
    }
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(checkSize);
    return () => cancelAnimationFrame(frameId);
  }, [checkSize]);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%", height }}>
      {ready && (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={1}
          minHeight={1}
          initialDimension={INITIAL_DIMENSION}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
