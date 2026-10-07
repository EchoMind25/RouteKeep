"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { initialFormState } from "@/lib/forms";
import { removeLogoAction, uploadLogoAction } from "./actions";

// FR-BRD-02: upload, preview, remove.
export function LogoForm({
  hasLogo,
  version,
  readOnly,
}: {
  hasLogo: boolean;
  version: string;
  readOnly: boolean;
}) {
  const [state, action] = useActionState(uploadLogoAction, initialFormState);
  // A look at the chosen file before it is saved; it never leaves the browser.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(
    () => () => (preview ? URL.revokeObjectURL(preview) : undefined),
    [preview],
  );
  return (
    <section
      aria-labelledby="logo-title"
      className="grid max-w-2xl gap-4 border-t border-line pt-8"
    >
      <div className="grid gap-1">
        <h2 id="logo-title" className="text-md font-semibold">
          Logo on invoices
        </h2>
        <p className="text-sm text-fg-muted">
          PNG or JPEG, up to 1 MB. Shown at the top of every invoice your
          customers get.
        </p>
      </div>
      {state.message ? (
        <Alert tone={state.ok ? "success" : "danger"}>{state.message}</Alert>
      ) : null}
      {hasLogo ? (
        <div className="grid w-fit place-items-center rounded-panel border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in file; next/image cannot fetch it */}
          <img
            src={`/api/branding/logo?v=${version}`}
            alt="Your current logo"
            className="max-h-16 max-w-56 object-contain"
          />
        </div>
      ) : null}
      {preview ? (
        <div className="grid gap-2">
          <p className="text-sm text-fg-muted">
            Not saved yet. This is how it will sit on the invoice.
          </p>
          <div className="grid w-fit place-items-center rounded-panel border border-dashed border-line-strong bg-surface p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local file the browser holds */}
            <img
              src={preview}
              alt="Logo you picked, not saved yet"
              className="max-h-16 max-w-56 object-contain"
            />
          </div>
        </div>
      ) : null}
      {readOnly ? (
        <p className="text-sm text-fg-muted">
          Only the owner or an admin can change the logo.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {/* React clears the file input after each submit, so the preview goes too. */}
          <form
            action={action}
            onSubmit={() => setPreview(null)}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="grid gap-1.5 font-medium">
              {hasLogo ? "Replace logo" : "Logo file"}
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg"
                required
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  setPreview(
                    file && /^image\/(png|jpeg)$/.test(file.type)
                      ? URL.createObjectURL(file)
                      : null,
                  );
                }}
                className="text-sm file:mr-3 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:font-medium"
              />
            </label>
            <SubmitButton variant="secondary" pendingLabel="Uploading">
              Upload
            </SubmitButton>
          </form>
          {hasLogo ? (
            <form action={removeLogoAction}>
              <Button type="submit" variant="ghost">
                Remove
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}
