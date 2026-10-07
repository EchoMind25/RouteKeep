"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { BRAND } from "@/lib/brand";
import s from "./landing.module.css";

// The hero's three real screens (dispatch board, technician app, service
// record) held in depth. The pointer tilts the set a few degrees; nothing
// moves for visitors who ask for reduced motion.
export function HeroStage() {
  const rig = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rig.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--ry", `${-18 + x * 14}deg`);
        el.style.setProperty("--rx", `${10 - y * 10}deg`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className={`${s.stage} relative mx-auto w-full max-w-[640px] pb-[18%] lg:max-w-none`}>
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
          <picture className={`${s.layer} ${s.paper} block`}>
            <Image src="/landing/record.webp" alt="A service record PDF with the business license and every product applied" width={900} height={776} sizes="20vw" className="block h-auto w-full" />
          </picture>
          <picture className={`${s.layer} ${s.phone} block`}>
            <source srcSet="/landing/tech-dark.webp" media="(prefers-color-scheme: dark)" />
            <Image src="/landing/tech-light.webp" alt="The technician app showing today's stops, saved on the phone" width={600} height={1298} sizes="18vw" className="block h-auto w-full" />
          </picture>
        </div>
      </div>
    </div>
  );
}
