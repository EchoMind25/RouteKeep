import "server-only";
import { z } from "zod";
import { localAuthBlockReason } from "@/lib/auth/local-guard";

// The only module that reads server configuration (PRD section 18). Parsed on
// first use, not at import, so `next build` works without secrets.

const schema = z
  .object({
    AUTH_MODE: z.enum(["supabase", "local"]).default("supabase"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    APP_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    LOCAL_AUTH_SECRET: z.string().min(32, "LOCAL_AUTH_SECRET needs at least 32 characters").optional(),
    GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
    // D-07. Only the built-in estimate exists so far; the Google and VROOM
    // adapters are added once there is an account or server to verify them against.
    ROUTE_OPTIMIZER: z.enum(["estimate", "google", "vroom"]).default("estimate"),
    // D-07 (revised 2026-10-07): the AI route planner. Without a key the
    // button is hidden and the built-in solver is all there is.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    // Tests point this at a local stand-in for the model API; unset in production.
    ANTHROPIC_BASE_URL: z.url().optional(),
    ROUTE_AI_MODEL: z.string().min(1).default("claude-fable-5-1"),
    ROUTE_AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
    // Each step stops starting new model turns after this long (D-04).
    ROUTE_AI_STEP_MS: z.coerce.number().int().min(1000).max(50_000).default(15_000),
    // FR-TEC-09: where photos and signatures go. Defaults to Supabase Storage,
    // or to files on this machine when AUTH_MODE=local (development and tests).
    STORAGE_PROVIDER: z.enum(["supabase", "local"]).optional(),
    STORAGE_BUCKET: z.string().min(3).max(63).default("attachments"),
    LOCAL_STORAGE_DIR: z.string().min(1).default(".local/storage"),
    // M6: signs portal sessions and unsubscribe links. At least 32 characters.
    // In local development LOCAL_AUTH_SECRET stands in when it is unset.
    APP_SECRET: z.string().min(32, "APP_SECRET needs at least 32 characters").optional(),
    // M6, D-10: how email leaves. "log" writes each email to LOCAL_MAIL_DIR
    // (development and tests only); "resend" sends through Resend.
    EMAIL_PROVIDER: z.enum(["log", "resend"]).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    LOCAL_MAIL_DIR: z.string().min(1).default(".local/mail"),
    // Shared secret for /api/cron, for a scheduler that is not Inngest.
    CRON_SECRET: z.string().min(24).optional(),
    NETLIFY: z.string().optional(),
    CONTEXT: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.AUTH_MODE === "supabase") {
      for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
        if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when AUTH_MODE=supabase` });
      }
    } else {
      if (!e.LOCAL_AUTH_SECRET) {
        ctx.addIssue({ code: "custom", path: ["LOCAL_AUTH_SECRET"], message: "LOCAL_AUTH_SECRET is required when AUTH_MODE=local" });
      }
      const blocked = localAuthBlockReason({ databaseUrl: e.DATABASE_URL, netlify: e.NETLIFY, context: e.CONTEXT });
      if (blocked) ctx.addIssue({ code: "custom", path: ["AUTH_MODE"], message: blocked });
    }
    if (e.EMAIL_PROVIDER === "log") {
      const blocked = localAuthBlockReason({ databaseUrl: e.DATABASE_URL, netlify: e.NETLIFY, context: e.CONTEXT });
      if (blocked) ctx.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: blocked.replace("Local sign-in", "Writing email to local files") });
    }
    if (e.EMAIL_PROVIDER === "resend" && (!e.RESEND_API_KEY || !e.EMAIL_FROM)) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM" });
    }
    // Files on this machine are for development only, with the same guard as local sign-in.
    if (e.STORAGE_PROVIDER === "local") {
      const blocked = localAuthBlockReason({ databaseUrl: e.DATABASE_URL, netlify: e.NETLIFY, context: e.CONTEXT });
      if (blocked) ctx.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: blocked.replace("Local sign-in", "Local file storage") });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid configuration: ${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** The storage adapter in effect: explicit, or local files exactly when sign-in is local. */
export function storageProvider(e: Env = env()): "supabase" | "local" {
  return e.STORAGE_PROVIDER ?? (e.AUTH_MODE === "local" ? "local" : "supabase");
}

export function parseEnvForTest(source: Record<string, string | undefined>) {
  return schema.safeParse(source);
}

/** M6: the secret for portal sessions and unsubscribe links, or null when none is configured. */
export function appSecret(): string | null {
  const e = env();
  return e.APP_SECRET ?? (e.AUTH_MODE === "local" ? (e.LOCAL_AUTH_SECRET ?? null) : null);
}

/** M6: the email provider in use: the configured one, "log" in local development, or none. */
export function emailProvider(): "log" | "resend" | null {
  const e = env();
  return e.EMAIL_PROVIDER ?? (e.AUTH_MODE === "local" ? "log" : null);
}
