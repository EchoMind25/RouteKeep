"use client";

import { Eraser } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BlobEntry, Draft } from "@/lib/sync/client-store";
import type { SnapshotStop } from "@/lib/sync/protocol";
import { key } from "@/lib/sync/stop-draft";
import { useTech } from "./context";
import { useObjectUrl } from "./object-url";

// The customer's signature, kept on the phone with everything else (FR-TEC-09).
// Optional: often nobody is home.

export function SignatureStep({ stop, draft, blobs, onChange }: { stop: SnapshotStop; draft: Draft; blobs: Map<string, BlobEntry>; onChange: (signature: Draft["signature"]) => void }) {
  const { store } = useTech();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [name, setName] = useState(draft.signature?.signerName ?? "");
  const saved = useObjectUrl(draft.signature ? blobs.get(draft.signature.key)?.blob : undefined);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
  }, [saved]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  async function save() {
    const c = canvas.current;
    if (!c || !dirty.current) return;
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
    if (!blob) return;
    const k = draft.signature?.key ?? key("signature");
    await store.putBlob({ key: k, appointmentId: stop.id, kind: "signature", blob, contentType: "image/png", capturedAt: new Date().toISOString(), uploadedAt: null });
    onChange({ key: k, signerName: name });
  }

  async function clear() {
    if (draft.signature) await store.deleteBlob(draft.signature.key);
    onChange(null);
    dirty.current = false;
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-semibold">Customer signature</h2>
        <p className="text-sm text-fg-muted">Optional. Skip it when nobody is home.</p>
      </div>
      <label className="grid gap-1">
        <span className="font-medium">Signed by</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (draft.signature) onChange({ ...draft.signature, signerName: e.target.value });
          }}
          autoComplete="off"
          className="h-12 rounded-control border border-line-strong bg-surface px-3 text-md"
        />
      </label>
      {saved ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image cannot optimise it
        <img src={saved} alt={`Signature${name ? ` of ${name}` : ""}`} className="h-48 w-full rounded-control border border-line bg-surface object-contain" />
      ) : (
        <canvas
          ref={canvas}
          aria-label="Signature pad: sign with a finger"
          className="h-48 w-full touch-none rounded-control border-2 border-dashed border-line-strong bg-surface text-fg"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext("2d")!;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            dirty.current = true;
          }}
          onPointerUp={() => {
            drawing.current = false;
            void save();
          }}
        />
      )}
      <div>
        <Button type="button" variant="secondary" onClick={() => void clear()}>
          <Eraser size={18} aria-hidden /> Clear signature
        </Button>
      </div>
    </div>
  );
}
