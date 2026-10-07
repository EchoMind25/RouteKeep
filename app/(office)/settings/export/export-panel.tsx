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

  async function run(existing: string | null) {
    setRunning(true);
    setError(null);
    try {
      const id = existing ?? (await requestExportAction()).id;
      for (;;) {
        const r = await exportStepAction({ id });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        setProgress({ done: r.step.done, total: r.step.total });
        if (r.step.status === "ready") {
          router.refresh();
          return;
        }
      }
    } catch {
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
        {resumeId && !running ? (
          <Button variant="secondary" onClick={() => run(resumeId)}>
            Carry on the last export
          </Button>
        ) : null}
      </div>
    </div>
  );
}
