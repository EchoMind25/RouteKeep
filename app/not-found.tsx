import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

// NFR accessibility: a real page for a wrong address, with a way back.
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center justify-items-start gap-5 px-4 py-12">
      <BrandMark />
      <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="text-fg-muted">The address may have changed, or the page may have been removed.</p>
      <Button asChild>
        <Link href="/">Go to the home page</Link>
      </Button>
    </main>
  );
}
