"use client";

import { useEffect, useRef } from "react";
import s from "./landing.module.css";

// A few blocks of a neighborhood in 3D. When it scrolls into view the day's
// route draws itself, the truck drives it, and each stop pops up as the truck
// reaches it; scroll away and back and it plays again. Driven by script with
// the path's measured length, not CSS motion paths, so phones (iOS Safari
// included) play it the same as a desktop. Plain CSS 3D: nothing fetched.

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
// The tilted plane, houses and pins span about this much of the screen at full size.
const NATURAL_WIDTH = 690;
const NATURAL_HEIGHT = 520;
const DURATION = 4600;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function RouteScene({ steps }: { steps: { title: string; body: string }[] }) {
  const scene = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const truck = useRef<HTMLDivElement>(null);

  // Fit the scene to its column at any width.
  useEffect(() => {
    const box = wrap.current;
    const inner = fit.current;
    if (!box || !inner) return;
    const resize = () => {
      const k = Math.min(1, box.clientWidth / NATURAL_WIDTH);
      inner.style.transform = `scale(${k})`;
      box.style.height = `${Math.round(NATURAL_HEIGHT * k)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = scene.current;
    const box = wrap.current;
    const path = line.current;
    const car = truck.current;
    if (!el || !box || !path || !car || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const total = path.getTotalLength();
    // How far along the route each stop sits, found by sampling the path.
    const at = STOPS.map(([x, y]) => {
      let best = 0;
      let bestD = Infinity;
      for (let d = 0; d <= total; d += 4) {
        const p = path.getPointAtLength(d);
        const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    });
    const pins = Array.from(el.querySelectorAll<HTMLElement>("[data-pin]"));
    const nums = Array.from(el.querySelectorAll<HTMLElement>("[data-step]"));

    let frame = 0;
    let start = 0;
    let state: "idle" | "playing" | "done" = "idle";

    const draw = (progress: number) => {
      const d = total * progress;
      path.style.strokeDasharray = `${total}`;
      path.style.strokeDashoffset = `${total - d}`;
      const p = path.getPointAtLength(d);
      car.style.left = `${p.x}px`;
      car.style.top = `${p.y}px`;
      car.style.opacity = progress > 0 && progress < 1 ? "1" : "0";
      pins.forEach((pin, i) => pin.toggleAttribute("data-shown", d >= at[i]! - 2));
      nums.forEach((n, i) => n.toggleAttribute("data-lit", progress >= i / nums.length));
    };
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / DURATION);
      draw(ease(t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else state = "done";
    };
    const play = () => {
      cancelAnimationFrame(frame);
      start = 0;
      state = "playing";
      frame = requestAnimationFrame(tick);
    };

    el.setAttribute("data-armed", "");
    draw(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && state === "idle") play();
        // Fully out of sight: reset, so it plays again next time it comes into view.
        if (!entry.isIntersecting && state !== "playing") {
          state = "idle";
          draw(0);
        }
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeAttribute("data-armed");
    };
  }, []);

  return (
    <div ref={scene} className={`${s.scene} grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]`}>
      <div ref={wrap} className={`${s.isoWrap} relative w-full`} aria-hidden>
        <div ref={fit} className="absolute top-0 left-1/2 grid h-[520px] w-[690px] origin-top -translate-x-1/2 place-items-center">
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
              <path ref={line} d={ROUTE} className={s.routeLine} />
            </svg>
            <div ref={truck} className={s.truck} />
            {STOPS.map(([x, y], i) => (
              <div key={i} className={s.pin} style={{ left: x, top: y }}>
                <span data-pin className={s.pinBody}>
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
            <span data-step className={`${s.stepNum} grid size-10 place-items-center rounded-pill border text-md font-semibold tabular`} aria-hidden>
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
