"use client";

import { CaretDown, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { missingRecordFields } from "@/lib/domain/records";
import {
  AMOUNT_UNITS,
  AREA_UNITS,
  MIX_UNITS,
  amountLabel,
  areaLabel,
  formatNumber,
  isAmountUnit,
  isAreaUnit,
  isMixUnit,
  mixLabel,
  mixPreview,
  type AmountUnit,
  type AreaUnit,
  type MixUnit,
} from "@/lib/domain/units";
import type { ApplicationEntry, SnapshotInfo } from "@/lib/sync/client-store";
import type { SnapshotProduct, SnapshotStop } from "@/lib/sync/protocol";
import { needsStatement, recordFor } from "@/lib/sync/stop-draft";

// One product applied at a stop (FR-TEC-06, CR-01, R-BUG-07). Every number is
// paired with a unit picked from a list, and the line under the mix rate says
// in plain words what the numbers mean, so 0.06 can never be read as 6%.

const SITES = ["Foundation perimeter", "Entry points", "Eaves", "Garage", "Interior baseboards", "Crawlspace", "Attic", "Lawn", "Shrub beds", "Trees"];
const PESTS = ["Ants", "Spiders", "Wasps", "Earwigs", "Crickets", "Cockroaches", "Mice", "Rats", "Mosquitoes", "Broadleaf weeds", "Grubs", "Aphids"];

const input = "h-12 w-full rounded-control border border-line-strong bg-surface px-3 text-md tabular";

export function ApplicationEditor(props: {
  entry: ApplicationEntry;
  product: SnapshotProduct | undefined;
  stop: SnapshotStop;
  info: SnapshotInfo;
  expanded: boolean;
  onToggle: () => void;
  onChange: (entry: ApplicationEntry) => void;
  onRemove: () => void;
}) {
  const { entry, product, stop, info, expanded, onToggle, onChange, onRemove } = props;
  const id = useId();
  const set = (patch: Partial<ApplicationEntry>) => onChange({ ...entry, ...patch });
  const missing = missingRecordFields(recordFor(entry, stop, product, info));
  const name = product?.name ?? "Product no longer in the catalog";

  const rate = Number(entry.mixRate);
  const total = Number(entry.totalAmount);
  const area = Number(entry.areaTreated);
  let preview: string | null = null;
  let previewHint: string | null = null;
  if (isMixUnit(entry.mixUnit) && rate > 0) {
    try {
      preview = mixPreview(
        { rate, unit: entry.mixUnit as MixUnit },
        {
          finishedMix: total > 0 && isAmountUnit(entry.amountUnit) ? { value: total, unit: entry.amountUnit as AmountUnit } : undefined,
          area: area > 0 && isAreaUnit(entry.areaUnit) ? { value: area, unit: entry.areaUnit as AreaUnit } : undefined,
        },
      );
    } catch (error) {
      previewHint = error instanceof Error ? error.message : null;
    }
  }

  const summary = [
    rate > 0 && isMixUnit(entry.mixUnit) ? `${formatNumber(rate)} ${mixLabel(entry.mixUnit as MixUnit)}` : null,
    total > 0 && isAmountUnit(entry.amountUnit) ? `${formatNumber(total)} ${amountLabel(entry.amountUnit as AmountUnit)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className={cn("rounded-panel border bg-surface", missing.length ? "border-warning/50" : "border-line")} aria-labelledby={`${id}-name`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span id={`${id}-name`} className="truncate font-semibold">
            {name}
          </span>
          <span className="truncate text-sm text-fg-muted">{product?.epaRegNo ? `EPA ${product.epaRegNo}` : product?.kind === "minimum_risk" ? "Minimum risk" : ""}{summary ? ` · ${summary}` : ""}</span>
          {missing.length ? (
            <span>
              <Badge tone="warning">
                <WarningCircle size={12} aria-hidden /> {missing.length === 1 ? `Missing ${missing[0]!.toLowerCase()}` : `${missing.length} fields missing`}
              </Badge>
            </span>
          ) : null}
        </span>
        <CaretDown size={20} aria-hidden className={cn("shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="grid gap-5 border-t border-line px-4 py-4">
          <div className="grid gap-1">
            <label className="font-semibold" htmlFor={`${id}-mix`}>
              Mix rate
            </label>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
              <input id={`${id}-mix`} inputMode="decimal" value={entry.mixRate} onChange={(e) => set({ mixRate: e.target.value })} className={input} />
              <select aria-label="Mix rate unit" value={entry.mixUnit} onChange={(e) => set({ mixUnit: e.target.value })} className={input}>
                {MIX_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {mixLabel(u)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1">
            <label className="font-semibold" htmlFor={`${id}-total`}>
              Total applied
            </label>
            <span className="text-sm text-fg-muted">Finished mix for sprays; product itself for granules and baits.</span>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
              <input id={`${id}-total`} inputMode="decimal" value={entry.totalAmount} onChange={(e) => set({ totalAmount: e.target.value })} className={input} />
              <select aria-label="Total applied unit" value={entry.amountUnit} onChange={(e) => set({ amountUnit: e.target.value })} className={input}>
                {AMOUNT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {amountLabel(u)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* R-BUG-07: the numbers, read back in words before anyone moves on. */}
          {preview ? (
            <p className="rounded-control bg-accent-soft px-3 py-2 text-accent" aria-live="polite">
              {preview}
            </p>
          ) : previewHint ? (
            <p className="text-sm text-fg-muted" aria-live="polite">
              {previewHint}
            </p>
          ) : null}

          <div className="grid gap-1">
            <label className="font-semibold" htmlFor={`${id}-area`}>
              Area treated
            </label>
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
              <input id={`${id}-area`} inputMode="decimal" value={entry.areaTreated} onChange={(e) => set({ areaTreated: e.target.value })} className={input} />
              <select aria-label="Area treated unit" value={entry.areaUnit} onChange={(e) => set({ areaUnit: e.target.value })} className={input}>
                {AREA_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {areaLabel(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {stop.sqFt ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => set({ areaTreated: String(stop.sqFt), areaUnit: "sq_ft" })}>
                  Home: {formatNumber(stop.sqFt)} sq ft
                </Button>
              ) : null}
              {stop.lawnSqFt ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => set({ areaTreated: String(stop.lawnSqFt), areaUnit: "sq_ft" })}>
                  Lawn: {formatNumber(stop.lawnSqFt)} sq ft
                </Button>
              ) : null}
            </div>
          </div>

          <ChipPicker label="Target sites" options={SITES} value={entry.targetSites} onChange={(targetSites) => set({ targetSites })} />
          <ChipPicker label="Target pests" options={PESTS} value={entry.targetPests} onChange={(targetPests) => set({ targetPests })} />

          <label className="grid gap-1">
            <span className="font-semibold">Time applied</span>
            <input type="time" value={entry.appliedTime} onChange={(e) => set({ appliedTime: e.target.value })} className={cn(input, "max-w-40")} />
          </label>

          {needsStatement(product) ? (
            // FR-REC-05: restricted-use products with a Danger signal word.
            <label className={cn("flex items-start gap-3 rounded-control border px-4 py-3", entry.customerStatement ? "border-success/40 bg-success-soft" : "border-danger/40 bg-danger-soft")}>
              <input
                type="checkbox"
                checked={entry.customerStatement}
                onChange={(e) => set({ customerStatement: e.target.checked, customerStatementAt: e.target.checked ? new Date().toISOString() : null })}
                className="mt-1 size-6 shrink-0 accent-accent"
              />
              <span>The customer received the written statement for this restricted-use product before it was applied.</span>
            </label>
          ) : null}

          {missing.length ? (
            <p className="text-sm text-warning">
              Still needed: {missing.join(", ")}.
            </p>
          ) : null}

          <div>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <Trash size={16} aria-hidden /> Remove {name}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ChipPicker({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  const [other, setOther] = useState("");
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const add = () => {
    const v = other.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setOther("");
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {all.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value.includes(v)}
            onClick={() => toggle(v)}
            className={cn("min-h-11 rounded-pill border px-3 text-sm font-medium", value.includes(v) ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface text-fg")}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          aria-label={`Other ${label.toLowerCase()}`}
          placeholder="Other"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-3"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!other.trim()} aria-label={`Add other ${label.toLowerCase()}`}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </div>
    </fieldset>
  );
}
