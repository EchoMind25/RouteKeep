import { Car, FlagCheckered, ListNumbers, Path, Warning, Wrench } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { routeHealthSummary, type RouteHealth as Health } from "@/lib/domain/route-health";
import { formatTime } from "@/lib/ui/format";

// FR-DSP-05, FR-DSP-06: a compact per-lane strip on the dispatch board. Every
// figure has a text label, so nothing depends on colour; the warning tint only
// reinforces the words. Fed by the board's existing estimates, no queries.

export function RouteHealth({ health, laneName }: { health: Health; laneName: string }) {
  const finish = health.finish ? formatTime(health.finish) : null;
  const risk = health.lateCount > 0;
  return (
    <div className="border-b border-line bg-sunken px-4 py-2">
      <p className="sr-only">
        {laneName}: {routeHealthSummary(health, finish)}
      </p>
      <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted tabular">
        <li className="flex items-center gap-1.5">
          <ListNumbers size={14} /> {health.stops} {health.stops === 1 ? "stop" : "stops"}
        </li>
        <li className="flex items-center gap-1.5">
          <Car size={14} /> {health.driveMin} min driving
        </li>
        <li className="flex items-center gap-1.5">
          <Wrench size={14} /> {health.serviceMin} min service
        </li>
        <li className="flex items-center gap-1.5">
          <FlagCheckered size={14} /> {finish ? `Done about ${finish}` : "Finish unknown"}
        </li>
        <li className={cn("flex items-center gap-1.5", risk && "font-semibold text-warning")}>
          <Warning size={14} weight={risk ? "fill" : "regular"} /> {risk ? `${health.lateCount} at risk of missing window` : "None at risk"}
        </li>
        <li className={cn("flex items-center gap-1.5", health.longLegCount > 0 && "font-semibold text-warning")}>
          <Path size={14} /> {health.longLegCount ? `${health.longLegCount} long ${health.longLegCount === 1 ? "leg" : "legs"}` : "No long legs"}
        </li>
      </ul>
    </div>
  );
}
