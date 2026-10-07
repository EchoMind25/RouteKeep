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
    // FR-TEC-09: where photos and signatures go. Defaults to Supabase Storage,
    // or to files on this machine when AUTH_MODE=local (development and tests).
    STORAGE_PROVIDER: z.enum(["supabase", "local"]).optional(),
    STORAGE_BUCKET: z.string().min(3).max(63).default("attachments"),
    LOCAL_STORAGE_DIR: z.string().min(1).default(".local/storage"),
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
