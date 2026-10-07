"use client";

import { CheckCircle } from "@phosphor-icons/react";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { BRAND } from "@/lib/brand";
import s from "./landing.module.css";

// The hero's three pieces of one day, held in depth: the office's dispatch
// board, the technician's phone and the record the customer gets. Each carries
// a numbered label so a first-time visitor knows what they are looking at.
// A mouse tilts the set; on a phone it tilts as the page scrolls. Nothing
// moves for visitors who ask for reduced motion.

const RECORD: [string, string][] = [
  ["Customer", "Marisol Quintero, Orem"],
  ["Product", "Perimeter concentrate"],
  ["EPA no.", "279-3206"],
  ["Mix rate", "0.5 fl oz per gal"],
  ["Applied", "1.5 gal, foundation"],
  ["Applicator", "A. Sorensen, UT-APP-1000"],
];

export function HeroStage() {
  const rig = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rig.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const set = (ry: number, rx: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty("--ry", `${ry}deg`);
        el.style.setProperty("--rx", `${rx}deg`);
      });
    };
    if (window.matchMedia("(pointer: fine)").matches) {
      const onMove = (event: PointerEvent) => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        set(-18 + x * 14, 10 - y * 10);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove);
      };
    }
    // Touch screens have no hover: the set turns toward the reader as they scroll past it.
    const onScroll = () => {
      const box = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, 1 - (box.top + box.height / 2) / window.innerHeight));
      set(-16 + t * 18, 12 - t * 10);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className={`${s.stage} relative mx-auto w-full max-w-[640px] px-[4%] pt-8 pb-[22%] lg:max-w-none lg:px-0`}>
      <div className={s.float}>
        <div ref={rig} className={s.rig}>
          <picture className={`${s.layer} ${s.board} block`}>
            <source srcSet="/landing/board-dark.webp" media="(prefers-color-scheme: dark)" />
            <Image
              src="/landing/board-light.webp"
              alt={`The ${BRAND.name} dispatch board: each technician's route listed beside a map, stops numbered the same in both`}
              width={1600}
              height={1000}
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="block h-auto w-full"
            />
          </picture>
          <figure className={`${s.layer} ${s.paper} grid gap-2 p-[4%]`} aria-label="A service record, the page the customer gets after each visit">
            <div className="border-b border-line pb-1.5">
              <p className="text-[clamp(9px,1.6vw,13px)] leading-tight font-semibold">Timpanogos Pest &amp; Lawn</p>
              <p className="text-[clamp(7px,1.1vw,10px)] leading-tight text-fg-muted">License UT-BUS-4471</p>
            </div>
            <p className="text-[clamp(10px,1.9vw,16px)] leading-none font-semibold tracking-tight">Service record</p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[clamp(7px,1.1vw,10.5px)] leading-snug">
              {RECORD.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="truncate">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="flex items-center gap-1 text-[clamp(7px,1.1vw,10.5px)] font-medium text-success">
              <CheckCircle weight="fill" aria-hidden className="size-[1.2em]" /> Signed by the customer
            </p>
          </figure>
          <picture className={`${s.layer} ${s.phone} block`}>
            <source srcSet="/landing/tech-dark.webp" media="(prefers-color-scheme: dark)" />
            <Image src="/landing/tech-light.webp" alt="The technician app showing today's stops, saved on the phone" width={600} height={1298} sizes="(min-width: 1024px) 18vw, 30vw" className="block h-auto w-full" />
          </picture>
        </div>
      </div>
      {/* Labels sit outside the 3D set so they stay flat and readable. */}
      <ol className="pointer-events-none" aria-label="What you are looking at">
        <li className={`${s.tag} top-0 left-[8%]`}>
          <span className={s.tagNum}>1</span> The office plans the day
        </li>
        <li className={`${s.tag} right-[2%] -bottom-1 sm:right-[4%] lg:bottom-[12%]`}>
          <span className={s.tagNum}>2</span> Techs work it, signal or not
        </li>
        <li className={`${s.tag} bottom-[8%] left-0`}>
          <span className={s.tagNum}>3</span> Customers get the record
        </li>
      </ol>
    </div>
  );
}
