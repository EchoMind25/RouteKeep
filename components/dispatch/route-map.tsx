"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/map/maplibre";
import { blankStyle, cssVar, currentScheme, subscribeScheme } from "@/components/map/style";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Map, { Layer, Marker, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  lane: string;
  colorIndex: number | null;
  number: number;
  name: string;
  flagged: boolean;
}

export interface MapRoute {
  lane: string;
  colorIndex: number | null;
  coords: [number, number][];
}

interface Palette {
  route: string[];
  canvas: string;
  surface: string;
  fg: string;
  muted: string;
  danger: string;
}

function readPalette(): Palette {
  const v = cssVar;
  return {
    route: Array.from({ length: 12 }, (_, i) => v(`--rk-route-${i}`)),
    canvas: v("--rk-sunken"),
    surface: v("--rk-surface"),
    fg: v("--rk-fg"),
    muted: v("--rk-line-strong"),
    danger: v("--rk-danger"),
  };
}

export function RouteMap(props: {
  stops: MapStop[];
  routes: MapRoute[];
  start: { lat: number; lng: number } | null;
  selectedId: string | null;
  selectedLane: string | null;
  onSelect: (id: string) => void;
  styleUrl: string;
  fitKey: string;
}) {
  const ref = useRef<MapRef>(null);
  const scheme = useSyncExternalStore(subscribeScheme, currentScheme, () => null);
  // Colors come from the design tokens on the page, so the map follows light and dark.
  const palette = useMemo(() => (scheme ? readPalette() : null), [scheme]);
  // A street style that fails to load falls back to the plain background;
  // a device without WebGL 2 gets a message instead of a broken canvas.
  const [styleFailed, setStyleFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const color = (i: number | null) => (palette && i !== null ? palette.route[i % 12]! : (palette?.muted ?? "#7f8792"));

  const stopData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: props.stops.map((s) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          color: color(s.colorIndex),
          selected: s.id === props.selectedId,
          dim: props.selectedLane !== null && s.lane !== props.selectedLane,
          flagged: s.flagged,
        },
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.stops, props.selectedId, props.selectedLane, palette],
  );

  const routeData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: props.routes
        .filter((r) => r.coords.length > 1)
        .map((r) => ({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: r.coords },
          properties: { color: color(r.colorIndex), dim: props.selectedLane !== null && r.lane !== props.selectedLane },
        })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.routes, props.selectedLane, palette],
  );

  // Fit the day once the map has its real size, and again when the day
  // changes; never on a selection or a reorder (R-BUG-06: no viewport resets).
  const fitted = useRef<string | null>(null);
  const fit = (stops: MapStop[]) => {
    const map = ref.current;
    if (!map || stops.length === 0) return;
    const lngs = stops.map((s) => s.lng);
    const lats = stops.map((s) => s.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, duration: 0, maxZoom: 14 },
    );
    fitted.current = props.fitKey;
  };
  useEffect(() => {
    if (fitted.current !== null && fitted.current !== props.fitKey) fit(props.stops);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  // Bring a selected stop into view only if it is off screen.
  useEffect(() => {
    const map = ref.current;
    const s = props.stops.find((x) => x.id === props.selectedId);
    if (!map || !s) return;
    if (!map.getBounds().contains([s.lng, s.lat])) map.easeTo({ center: [s.lng, s.lat], duration: 300 });
  }, [props.selectedId, props.stops]);

  if (unsupported) {
    return <div className="grid h-full place-items-center bg-sunken p-6 text-center text-sm text-fg-muted">This browser cannot draw the map (it needs WebGL 2). The lists still work.</div>;
  }
  if (!palette) return <div className="h-full w-full bg-sunken" aria-hidden />;
  const useStreets = props.styleUrl !== "" && !styleFailed;

  // Stop numbers (FR-DSP-05) for the route in focus; for every route only on a light day, where they stay legible.
  const numbered = props.stops.filter((s) => (props.selectedLane ? s.lane === props.selectedLane : props.stops.length <= 40));

  return (
    <Map
      ref={ref}
      initialViewState={{ longitude: -111.75, latitude: 40.35, zoom: 9.5 }}
      mapStyle={useStreets ? props.styleUrl : blankStyle(palette.canvas)}
      interactiveLayerIds={["stops"]}
      onClick={(e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") props.onSelect(id);
      }}
      onError={(e) => {
        const map = ref.current;
        if (e.error?.name === "GPUInitializationError" || !map) setUnsupported(true);
        else if (useStreets && !map.isStyleLoaded()) setStyleFailed(true);
        // A missing tile or an offline moment is not worth an alarm; the pins are local.
        else console.warn("map:", e.error?.message);
      }}
      onLoad={() => {
        // The container settles its size after layout; fit to the settled size.
        ref.current?.resize();
        fit(props.stops);
      }}
      cursor="auto"
      attributionControl={useStreets ? undefined : false}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      <Source id="routes" type="geojson" data={routeData}>
        <Layer
          id="route-lines"
          type="line"
          layout={{ "line-join": "round", "line-cap": "round" }}
          paint={{ "line-color": ["get", "color"], "line-width": 3, "line-opacity": ["case", ["get", "dim"], 0.15, 0.85] }}
        />
      </Source>
      <Source id="stops-src" type="geojson" data={stopData}>
        <Layer
          id="flagged"
          type="circle"
          filter={["==", ["get", "flagged"], true]}
          paint={{ "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": palette.danger, "circle-stroke-width": 2.5 }}
        />
        <Layer
          id="stops"
          type="circle"
          paint={{
            "circle-radius": ["case", ["get", "selected"], 9, 6],
            "circle-color": ["get", "color"],
            "circle-opacity": ["case", ["get", "dim"], 0.25, 1],
            "circle-stroke-color": ["case", ["get", "selected"], palette.fg, palette.surface],
            "circle-stroke-width": ["case", ["get", "selected"], 3, 1.5],
          }}
        />
      </Source>
      {props.start ? (
        <Marker longitude={props.start.lng} latitude={props.start.lat} anchor="center">
          <span className="grid size-6 place-items-center rounded-control border-2 border-surface bg-fg text-[10px] font-bold text-canvas" title="Office">
            HQ
          </span>
        </Marker>
      ) : null}
      {styleFailed ? (
        <p className="absolute top-2 left-2 rounded-control bg-surface px-2 py-1 text-xs text-fg-muted shadow-raised">Street map unavailable. Showing stops only.</p>
      ) : null}
      {numbered.map((s) => (
        <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="bottom" offset={[0, -6]}>
          <button
            type="button"
            onClick={() => props.onSelect(s.id)}
            aria-label={`Stop ${s.number}, ${s.name}`}
            className="grid h-5 min-w-5 place-items-center rounded-pill border border-surface px-1 text-[11px] leading-none font-bold tabular shadow-raised"
            style={{ backgroundColor: color(s.colorIndex), color: s.colorIndex !== null ? `var(--rk-route-ink-${s.colorIndex % 12})` : "var(--rk-surface)" }}
          >
            {s.number}
          </button>
        </Marker>
      ))}
    </Map>
  );
}
