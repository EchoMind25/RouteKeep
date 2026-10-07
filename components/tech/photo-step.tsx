"use client";

import { Camera, Trash } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BlobEntry, Draft } from "@/lib/sync/client-store";
import type { SnapshotStop } from "@/lib/sync/protocol";
import { key } from "@/lib/sync/stop-draft";
import { useTech } from "./context";
import { useObjectUrl } from "./object-url";

// FR-TEC-09: photos are kept on the phone first and upload in the background.
// They are shrunk before saving: a 12-megapixel original is several megabytes,
// and a route's worth would crowd the phone and the upload.

const MAX_EDGE = 1600;

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.82));
  } catch {
    return file;
  }
}

export function PhotoStep({ stop, draft, blobs, onChange }: { stop: SnapshotStop; draft: Draft; blobs: Map<string, BlobEntry>; onChange: (photos: string[]) => void }) {
  const { store } = useTech();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const keys: string[] = [];
    for (const file of Array.from(files)) {
      const blob = await shrink(file);
      const k = key("photo");
      await store.putBlob({ key: k, appointmentId: stop.id, kind: "photo", blob, contentType: blob.type || "image/jpeg", capturedAt: new Date().toISOString(), uploadedAt: null });
      keys.push(k);
    }
    onChange([...draft.photos, ...keys]);
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  async function remove(k: string) {
    onChange(draft.photos.filter((p) => p !== k));
    await store.deleteBlob(k);
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="font-semibold">Photos</h2>
        <p className="text-sm text-fg-muted">Optional. Activity, damage, anything the office or the customer should see.</p>
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple className="sr-only" id="photo-input" onChange={(e) => void add(e.target.files)} />
      <Button asChild size="lg" variant="secondary" aria-busy={busy}>
        <label htmlFor="photo-input" className="cursor-pointer">
          <Camera size={20} aria-hidden /> {busy ? "Saving" : "Take a photo"}
        </label>
      </Button>
      {draft.photos.length ? (
        <ul className="grid grid-cols-3 gap-2" aria-label="Photos taken">
          {draft.photos.map((k, i) => (
            <Thumb key={k} blob={blobs.get(k)?.blob} label={`Photo ${i + 1}`} onRemove={() => void remove(k)} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Thumb({ blob, label, onRemove }: { blob: Blob | undefined; label: string; onRemove: () => void }) {
  const url = useObjectUrl(blob);
  return (
    <li className="relative aspect-square overflow-hidden rounded-control border border-line bg-sunken">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image cannot optimise it */}
      {url ? <img src={url} alt={label} className="size-full object-cover" /> : null}
      <button type="button" onClick={onRemove} className="absolute top-1 right-1 grid size-9 place-items-center rounded-pill bg-surface/90 text-fg shadow-raised" aria-label={`Remove ${label.toLowerCase()}`}>
        <Trash size={16} aria-hidden />
      </button>
    </li>
  );
}
