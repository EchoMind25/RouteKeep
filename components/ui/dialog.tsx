"use client";

import { X } from "@phosphor-icons/react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  onCloseAutoFocus,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** For dialogs opened from code rather than a trigger: put focus back on the opener. */
  onCloseAutoFocus?: ComponentProps<typeof D.Content>["onCloseAutoFocus"];
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-fg/40" />
      <D.Content
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto",
          "rounded-panel border border-line bg-surface p-6 shadow-overlay",
          className,
        )}
      >
        <div className="grid gap-1 pr-8">
          <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
          {description ? <D.Description className="text-sm text-fg-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        {children}
        <D.Close className="absolute top-2 right-2 grid size-11 place-items-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg" aria-label="Close">
          <X size={18} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
