"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/map/maplibre";
import { Crosshair, MapPin } from "@phosphor-icons/react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Map, { Marker, NavigationControl, type MapLayerMouseEvent, type MapRef, type MarkerDragEvent } from "react-map-gl/maplibre";
import { Button } from "@/components/ui/button";
import { blankStyle, cssVar, currentScheme, subscribeScheme } from "./style";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * One draggable pin (FR-CRM-02). Three ways to place it: drag it, click the
 * map, or move the map under the crosshair (arrow keys work once the map has
 * focus) and press the button, which is the keyboard path.
 */
export function PinMap({ pin, center, movable, onMove, styleUrl }: { pin: LatLng | null; center: LatLng; movable: boolean; onMove: (p: LatLng) => void; styleUrl: string }) {
  const ref = useRef<MapRef>(null);
  const scheme = useSyncExternalStore(subscribeScheme, currentScheme, () => null);
  const background = useMemo(() => (scheme ? cssVar("--rk-sunken") : null), [scheme]);
  const [styleFailed, setStyleFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  if (unsupported) {
    return <div className="grid h-full place-items-center bg-sunken p-6 text-center text-sm text-fg-muted">This browser cannot draw the map (it needs WebGL 2). Enter the coordinates instead.</div>;
  }
  if (!background) return <div className="h-full w-full bg-sunken" aria-hidden />;
  const useStreets = styleUrl !== "" && !styleFailed;
  const start = pin ?? center;

  return (
    <Map
      ref={ref}
      initialViewState={{ longitude: start.lng, latitude: start.lat, zoom: pin ? 16 : 11 }}
      mapStyle={useStreets ? styleUrl : blankStyle(background)}
      attributionControl={useStreets ? undefined : false}
      onClick={(e: MapLayerMouseEvent) => movable && onMove({ lat: e.lngLat.lat, lng: e.lngLat.lng })}
      onError={(e) => {
        const map = ref.current;
        if (e.error?.name === "GPUInitializationError" || !map) setUnsupported(true);
        else if (useStreets && !map.isStyleLoaded()) setStyleFailed(true);
        else console.warn("map:", e.error?.message);
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      {pin ? (
        <Marker
          longitude={pin.lng}
          latitude={pin.lat}
          anchor="bottom"
          draggable={movable}
          onDragEnd={(e: MarkerDragEvent) => onMove({ lat: e.lngLat.lat, lng: e.lngLat.lng })}
        >
          <MapPin size={40} weight="fill" className="text-accent drop-shadow-md" aria-hidden />
        </Marker>
      ) : null}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-fg/70" aria-hidden>
        <Crosshair size={28} />
      </div>
      {movable ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shadow-raised"
            onClick={() => {
              const c = ref.current?.getCenter();
              if (c) onMove({ lat: c.lat, lng: c.lng });
            }}
          >
            Put the pin at the crosshair
          </Button>
        </div>
      ) : null}
      {styleFailed ? (
        <p className="absolute top-2 left-2 rounded-control bg-surface px-2 py-1 text-xs text-fg-muted shadow-raised">Street map unavailable.</p>
      ) : null}
    </Map>
  );
}
