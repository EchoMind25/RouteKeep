"use client";

import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

// A small action menu (Radix DropdownMenu): arrow keys, type-ahead and Escape
// come with it. Used where a drag has to have a single-pointer alternative
// (WCAG 2.5.7).

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;

export function MenuContent({ children, className, ...props }: { children: ReactNode; className?: string } & Pick<ComponentProps<typeof M.Content>, "onCloseAutoFocus" | "align">) {
  return (
    <M.Portal>
      <M.Content
        align="end"
        sideOffset={4}
        className={cn("z-50 min-w-48 max-w-72 rounded-control border border-line bg-surface p-1 shadow-overlay", className)}
        {...props}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-3 pt-2 pb-1 text-xs font-semibold text-fg-muted">{children}</M.Label>;
}

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2 rounded-control px-3 py-1.5 text-sm text-fg outline-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:text-fg-muted data-[highlighted]:bg-sunken",
        className,
      )}
      {...props}
    />
  );
}
