import "server-only";
import { emailProvider } from "@/lib/env";
import type { MemberSession } from "@/lib/auth/session";
import { withRls } from "@/lib/db/rls";

export async function listServiceTypes(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx
      .selectFrom("service_types")
      .select(["id", "name", "category", "default_duration_min", "active"])
      .orderBy("category")
      .orderBy("name")
      .execute(),
  );
}

export async function listPlans(m: MemberSession, opts: { activeOnly?: boolean } = {}) {
  return withRls(m.claims, (tx) => {
    let q = tx
      .selectFrom("service_plans as p")
      .innerJoin("service_types as t", (j) => j.onRef("t.id", "=", "p.service_type_id").onRef("t.tenant_id", "=", "p.tenant_id"))
      .select([
        "p.id", "p.name", "p.price_cents", "p.initial_price_cents", "p.rrule", "p.billing_mode",
        "p.default_duration_min", "p.active", "p.service_type_id", "t.name as service_type_name", "t.category",
      ])
      .orderBy("p.active", "desc")
      .orderBy("p.name");
    if (opts.activeOnly) q = q.where("p.active", "=", true);
    return q.execute();
  });
}

export async function listProducts(m: MemberSession) {
  return withRls(m.claims, (tx) =>
    tx
      .selectFrom("products")
      .select(["id", "name", "kind", "epa_reg_no", "signal_word", "restricted_use", "default_mix_rate", "default_mix_unit", "default_amount_unit", "active"])
      .orderBy("active", "desc")
      .orderBy("name")
      .execute(),
  );
}

export async function listTechnicians(m: MemberSession, opts: { activeOnly?: boolean } = {}) {
  return withRls(m.claims, (tx) => {
    let q = tx
      .selectFrom("technicians")
      .select(["id", "display_name", "phone", "applicator_license_no", "license_expiry", "categories", "color_index", "active", "user_id"])
      .orderBy("active", "desc")
      .orderBy("display_name");
    if (opts.activeOnly) q = q.where("active", "=", true);
    return q.execute();
  });
}

export async function setupProgress(m: MemberSession) {
  return withRls(m.claims, async (tx) => {
    const count = async (table: "technicians" | "service_plans" | "products" | "customers" | "subscriptions") =>
      Number((await tx.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirstOrThrow()).n);
    const tenant = await tx.selectFrom("tenants").select(["stripe_charges_enabled", "messaging_live_at"]).executeTakeFirstOrThrow();
    return {
      technicians: await count("technicians"),
      plans: await count("service_plans"),
      products: await count("products"),
      customers: await count("customers"),
      subscriptions: await count("subscriptions"),
      stripeConnected: tenant.stripe_charges_enabled,
      emailOn: emailProvider() !== null,
      live: tenant.messaging_live_at !== null,
      // Only owners and admins can read imports; a failed read would end the transaction.
      imported: m.role === "owner" || m.role === "admin" ? Number((await tx.selectFrom("import_jobs").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "in", ["committed", "reconciled"]).executeTakeFirstOrThrow()).n) : 0,
      techLogins: Number((await tx.selectFrom("memberships").select((eb) => eb.fn.countAll<number>().as("n")).where("role", "=", "technician").executeTakeFirstOrThrow()).n),
      optimized: Number((await tx.selectFrom("routes").select((eb) => eb.fn.countAll<number>().as("n")).where("optimized_at", "is not", null).executeTakeFirstOrThrow()).n),
    };
  });
}
