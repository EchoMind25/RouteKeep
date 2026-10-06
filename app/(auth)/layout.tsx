import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-8 sm:px-8">
      <div className="mx-auto grid w-full max-w-xl gap-10">
        <BrandMark />
        <main>{children}</main>
      </div>
    </div>
  );
}
