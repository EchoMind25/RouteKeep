"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { FIELDS, type ColumnMap } from "@/lib/import/customers";
import { commitStepAction, rollbackImportAction, saveMappingAction, startImportAction } from "./actions";

export function UploadForm() {
  const [state, action] = useActionState(startImportAction, initialFormState);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      <label className="grid gap-1.5 font-medium">
        Customer list (CSV)
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:font-medium"
        />
      </label>
      <p className="text-sm text-fg-muted">
        Export your customer list from the software you use now, or save your spreadsheet as CSV. Nothing is added until you have checked every row and pressed Import.
      </p>
      <div>
        <SubmitButton pendingLabel="Reading the file">Upload and match columns</SubmitButton>
      </div>
    </form>
  );
}

export function MappingForm({ id, headers, map, sample, readOnly }: { id: string; headers: string[]; map: ColumnMap; sample: string[][]; readOnly: boolean }) {
  const [state, action] = useActionState(saveMappingAction, initialFormState);
  const [save, setSave] = useState(false);
  const column = (h: string | undefined) => (h ? headers.indexOf(h) : -1);
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="id" value={id} />
      {state.message ? <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert> : null}
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        {FIELDS.map((f) => {
          const k = column(map[f.key]);
          const example = k >= 0 ? sample.find((r) => r[k])?.[k] : undefined;
          return (
            <Field key={f.key} label={f.label} optional={!("required" in f && f.required)} hint={example ? `Example: ${example}` : "hint" in f ? f.hint : undefined}>
              <Select name={`map.${f.key}`} defaultValue={map[f.key] ?? ""} disabled={readOnly}>
                <option value="">Not in this file</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
      {!readOnly ? (
        <div className="grid gap-3">
          <Checkbox name="savePreset" label="Remember these matches for the next file with the same columns" defaultChecked={save} onChange={(e) => setSave(e.currentTarget.checked)} />
          {save ? (
            <Field label="Name for these matches" className="max-w-sm">
              <Input name="presetName" placeholder="Our old software, customers" />
            </Field>
          ) : null}
          <div>
            <SubmitButton pendingLabel="Checking every row">Check every row</SubmitButton>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function CommitPanel({ id, toImport, started }: { id: string; toImport: number; started: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      // Each step imports a small batch in its own request; a closed tab can pick up where it stopped.
      for (;;) {
        const r = await commitStepAction({ id });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        setDone(r.progress.done);
        if (r.progress.finished) {
          router.refresh();
          return;
        }
      }
    } catch {
      setError("The connection dropped. Press Import again to carry on where it stopped. Nothing is added twice.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {running || done !== null ? (
        <p className="text-md" role="status">
          {done ?? 0} of {toImport} imported{running ? "…" : "."}
        </p>
      ) : null}
      <div>
        <Button onClick={run} loading={running} disabled={running}>
          {started ? "Carry on importing" : `Import ${toImport} ${toImport === 1 ? "customer" : "customers"}`}
        </Button>
      </div>
    </div>
  );
}

export function RollbackButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    const r = await rollbackImportAction({ id });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) {
      setMessage({ tone: "danger", text: r.message });
      return;
    }
    const { removed, kept } = r.result;
    setMessage(
      kept.length
        ? { tone: "warning", text: `${removed} removed. ${kept.length} kept because you have already worked with them: ${kept.map((k) => `${k.name} (${k.why})`).join("; ")}.` }
        : { tone: "success", text: `Import undone. ${removed} ${removed === 1 ? "customer" : "customers"} removed with their addresses, plans and visits.` },
    );
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-md">Remove the customers this import added, with their plans and upcoming visits?</p>
          <Button variant="danger" onClick={run} loading={busy}>
            Yes, undo the import
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Keep it
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Undo this import
          </Button>
        </div>
      )}
    </div>
  );
}
