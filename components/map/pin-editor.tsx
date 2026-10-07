"use client";

import { LockSimple } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { useActionState, useState } from "react";
import { confirmPinAction } from "@/app/(office)/customers/[id]/properties/[propertyId]/pin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { CONFIRM_THRESHOLD } from "@/lib/providers/geocoder";
import type { LatLng } from "./pin-map";

const PinMap = dynamic(() => import("./pin-map").then((m) => m.PinMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-sunken" aria-hidden />,
});

const fixed = (n: number) => n.toFixed(6);

export function PinEditor(props: {
  customerId: string;
  propertyId: string;
  version: number;
  date: string | null;
  pin: LatLng | null;
  center: LatLng;
  confidence: number | null;
  source: string | null;
  confirmed: boolean;
  locked: boolean;
  styleUrl: string;
}) {
  const [state, action] = useActionState(confirmPinAction, initialFormState);
  const e = state.errors ?? {};
  const [pin, setPin] = useState<LatLng | null>(props.pin);
  const [lat, setLat] = useState(state.values?.lat ?? (props.pin ? fixed(props.pin.lat) : ""));
  const [lng, setLng] = useState(state.values?.lng ?? (props.pin ? fixed(props.pin.lng) : ""));
  // R-BUG-05: a locked pin does not move until someone says so.
  const [unlocked, setUnlocked] = useState(!props.locked);

  const place = (p: LatLng) => {
    setPin(p);
    setLat(fixed(p.lat));
    setLng(fixed(p.lng));
  };
  const typed = (nextLat: string, nextLng: string) => {
    const a = Number(nextLat);
    const b = Number(nextLng);
    if (nextLat.trim() && nextLng.trim() && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) setPin({ lat: a, lng: b });
  };
  const moved = pin !== null && (props.pin === null || fixed(pin.lat) !== fixed(props.pin.lat) || fixed(pin.lng) !== fixed(props.pin.lng));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-3">
        {!props.styleUrl ? (
          <Alert tone="warning" title="No street map is set up">
            The pin shows on a blank background, so check the coordinates against the address before confirming. The owner can turn on a street map in the deployment settings.
          </Alert>
        ) : null}
        <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-panel border border-line" role="region" aria-label="Map: drag the pin onto the building">
          <PinMap pin={pin} center={props.center} movable={unlocked} onMove={place} styleUrl={props.styleUrl} />
        </div>
      </div>

      <form action={action} className="grid gap-5 rounded-panel border border-line bg-surface p-5" noValidate>
        {state.message ? <Alert tone="danger">{state.message}</Alert> : null}
        <input type="hidden" name="customerId" value={props.customerId} />
        <input type="hidden" name="propertyId" value={props.propertyId} />
        <input type="hidden" name="version" value={props.version} />
        {props.date ? <input type="hidden" name="date" value={props.date} /> : null}

        <div className="grid gap-2">
          <h2 className="font-semibold">Where this pin came from</h2>
          <div className="flex flex-wrap gap-1.5">
            {props.pin === null ? (
              <Badge tone="warning">No pin yet</Badge>
            ) : props.source === "manual" ? (
              <Badge>Placed by hand</Badge>
            ) : props.confidence !== null ? (
              <Badge tone={props.confidence < CONFIRM_THRESHOLD ? "warning" : "neutral"}>Address lookup, {Math.round(props.confidence * 100)}% sure</Badge>
            ) : (
              <Badge>Address lookup</Badge>
            )}
            {props.confirmed ? <Badge tone="success">Confirmed</Badge> : null}
            {props.locked ? (
              <Badge tone="success">
                <LockSimple size={12} aria-hidden /> Locked
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-fg-muted">
            {props.pin === null
              ? "Click the map where the building is, or move the map so the crosshair is on it and use the button."
              : unlocked
                ? "Drag the pin onto the building, or click the map where it is."
                : "This pin is locked: address changes and imports never move it."}
          </p>
          {!unlocked ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setUnlocked(true)}>
                Move this pin
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={e.lat}>
            <Input
              name="lat"
              inputMode="decimal"
              value={lat}
              readOnly={!unlocked}
              onChange={(ev) => {
                setLat(ev.target.value);
                typed(ev.target.value, lng);
              }}
            />
          </Field>
          <Field label="Longitude" error={e.lng}>
            <Input
              name="lng"
              inputMode="decimal"
              value={lng}
              readOnly={!unlocked}
              onChange={(ev) => {
                setLng(ev.target.value);
                typed(lat, ev.target.value);
              }}
            />
          </Field>
        </div>

        <Checkbox
          name="lock"
          label="Lock this pin"
          hint="A later address change or import keeps the pin here and flags it for a check instead."
          defaultChecked={state.values ? state.values.lock === "on" : true}
        />

        <div>
          <SubmitButton pendingLabel="Saving" disabled={pin === null}>
            {moved ? "Save and confirm pin" : "Confirm pin"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
