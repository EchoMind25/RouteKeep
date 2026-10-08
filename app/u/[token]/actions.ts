"use server";

import { sql } from "kysely";
import { redirect } from "next/navigation";
import { withAnon } from "@/lib/db/rls";
import { appSecret } from "@/lib/env";
import { verify } from "@/lib/messaging/signed";

export async function unsubscribeAction(data: FormData) {
  const token = String(data.get("token") ?? "");
  const secret = appSecret();
  const v = secret ? verify<{ t: string; c: string }>(token, secret) : null;
  if (!v) redirect(`/u/${encodeURIComponent(token)}`);
  await withAnon((tx) => sql`select app.unsubscribe_email(${v.t}::uuid, ${v.c}::uuid)`.execute(tx));
  redirect(`/u/${encodeURIComponent(token)}?done=1`);
}
