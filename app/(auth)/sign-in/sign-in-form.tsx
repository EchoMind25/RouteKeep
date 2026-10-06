"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form-status";
import { Alert } from "@/components/ui/layout";
import { startSignIn, verifyCode, type SignInState } from "./actions";

export function SignInForm({ local, demoAccounts }: { local: boolean; demoAccounts: { email: string; label: string }[] }) {
  const [emailState, emailAction] = useActionState<SignInState, FormData>(startSignIn, { step: "email" });
  const [codeState, codeAction] = useActionState<SignInState, FormData>(verifyCode, { step: "code" });
  const onCodeStep = emailState.step === "code";

  if (onCodeStep) {
    return (
      <form action={codeAction} className="grid gap-5">
        <p className="text-fg-muted">
          We sent a 6-digit code to <strong className="font-semibold text-fg">{emailState.email}</strong>. It expires in a few minutes.
        </p>
        <input type="hidden" name="email" value={emailState.email} />
        <Field label="Sign-in code" error={codeState.error}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="max-w-40 tabular tracking-[0.3em]" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Checking">Sign in</SubmitButton>
          <Button variant="link" type="button" onClick={() => window.location.reload()}>
            Use a different email
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-8">
      <form action={emailAction} className="grid gap-5">
        <Field label="Work email" hint={local ? undefined : "We email you a one-time code. No password to remember."} error={emailState.error}>
          <Input name="email" type="email" autoComplete="email" required autoFocus defaultValue={emailState.email} />
        </Field>
        <div>
          <SubmitButton pendingLabel={local ? "Signing in" : "Sending code"}>{local ? "Sign in" : "Email me a code"}</SubmitButton>
        </div>
      </form>

      {local ? (
        <div className="grid gap-3">
          <Alert tone="warning" title="Local development sign-in">
            No password and no email. This only works against a database on this machine and is refused on hosted deploys.
          </Alert>
          {demoAccounts.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-sm text-fg-muted">Demo business accounts</p>
              <div className="flex flex-wrap gap-2">
                {demoAccounts.map((a) => (
                  <form key={a.email} action={emailAction}>
                    <input type="hidden" name="email" value={a.email} />
                    <Button variant="secondary" size="sm" type="submit">
                      {a.label}
                    </Button>
                  </form>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
