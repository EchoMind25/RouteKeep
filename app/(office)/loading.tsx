import { Skeleton } from "@/components/ui/layout";

// NFR accessibility: say a page is loading instead of leaving a blank screen.
export default function Loading() {
  return (
    <div className="grid gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="grid gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-panel" />
      <Skeleton className="h-64 w-full rounded-panel" />
    </div>
  );
}
