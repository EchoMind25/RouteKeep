"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/layout";
import { exportStepAction, requestExportAction } from "./actions";

export function ExportPanel({ resumeId }: { resumeId: string | null }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An export this panel can pick up again (timeout or dropped connection), before the page refreshes.
  const [lastId, setLastId] = useState<string | null>(null);
  const carryOnId = lastId ?? resumeId;

  async function run(existing: string | null) {
    setRunning(true);
    setError(null);
    setLastId(null);
    let id: string | null = null;
    try {
      id = existing ?? (await requestExportAction()).id;
      for (;;) {
        const r = await exportStepAction({ id });
        if (!r.ok) {
          setError(r.message);
          if (r.resumable) setLastId(id);
          return;
        }
        setProgress({ done: r.step.done, total: r.step.total });
        if (r.step.status === "ready") {
          router.refresh();
          return;
        }
      }
    } catch {
      setLastId(id);
      setError("The connection dropped. Press Carry on to pick up where it stopped.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {progress && running ? (
        <p role="status" className="text-md">
          Building the file: part {progress.done} of {progress.total}…
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => run(null)} loading={running} disabled={running}>
          Export everything
        </Button>
        {carryOnId && !running ? (
          <Button variant="secondary" onClick={() => run(carryOnId)}>
            Carry on the last export
          </Button>
        ) : null}
      </div>
    </div>
  );
}
