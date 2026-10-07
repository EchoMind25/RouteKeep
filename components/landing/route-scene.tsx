"use client";

import { useEffect, useRef } from "react";
import s from "./landing.module.css";

// A few blocks of a neighborhood in 3D. When it scrolls into view the day's
// route draws itself, the truck drives it, and each stop pops up in order.
// Plain CSS 3D: no library, nothing fetched.

const ROUTE = "M 80 440 L 80 240 L 240 240 L 240 80 L 400 80 L 400 320 L 320 320 L 320 400";
const STOPS: [number, number][] = [
  [80, 330],
  [160, 240],
  [240, 150],
  [330, 80],
  [400, 210],
  [360, 320],
  [320, 400],
];
// [column, row, height] for each house: a block or two left as yards and parks.
const HOUSES: [number, number, number][] = [
  [0, 0, 26], [1, 0, 34], [2, 0, 20], [3, 0, 30], [5, 0, 24],
  [0, 1, 18], [1, 1, 30], [3, 1, 38], [4, 1, 22], [5, 1, 28],
  [0, 2, 32], [2, 2, 24], [3, 2, 18], [4, 2, 34],
  [0, 3, 22], [1, 3, 28], [2, 3, 36], [4, 3, 20], [5, 3, 30],
  [1, 4, 20], [3, 4, 26], [4, 4, 32], [5, 4, 18],
  [0, 5, 30], [2, 5, 22], [3, 5, 34], [5, 5, 26],
];

export function RouteScene({ steps }: { steps: { title: string; body: string }[] }) {
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scene.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    // Already on screen when the page loads: show it finished rather than replay.
    if (rect.top < window.innerHeight && rect.bottom > 0) return;
    el.setAttribute("data-armed", "");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.setAttribute("data-on", "");
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scene} className={`${s.scene} grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]`}>
      <div className={`${s.isoWrap} -my-16 h-[420px] sm:h-[520px]`} aria-hidden>
        <div className="scale-[0.62] sm:scale-90 lg:scale-100">
          <div className={s.plane}>
            {Array.from({ length: 36 }, (_, k) => {
              const c = k % 6;
              const r = Math.floor(k / 6);
              const house = HOUSES.find(([hc, hr]) => hc === c && hr === r);
              return (
                <div key={k} className={s.block} style={{ left: 8 + c * 80, top: 8 + r * 80 }}>
                  {house ? (
                    <div className={s.house} style={{ ["--h" as string]: `${house[2]}px` }}>
                      <div className={s.wallS} />
                      <div className={s.wallE} />
                      <div className={s.roof} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <svg className={s.routeSvg} viewBox="0 0 480 480" width="480" height="480">
              <path d={ROUTE} pathLength={1} className={s.routeLine} />
            </svg>
            <div className={s.truck} style={{ offsetPath: `path('${ROUTE}')` }} />
            {STOPS.map(([x, y], i) => (
              <div key={i} className={s.pin} style={{ left: x, top: y }}>
                <span className={s.pinBody} style={{ ["--i" as string]: i }}>
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ol className="grid gap-7">
        {steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4">
            <span className={`${s.stepNum} grid size-10 place-items-center rounded-pill border text-md font-semibold tabular`} style={{ ["--i" as string]: i }} aria-hidden>
              {i + 1}
            </span>
            <div className="grid gap-1">
              <h3 className="text-xl font-semibold tracking-tight">{step.title}</h3>
              <p className="max-w-[46ch] text-md text-fg-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
