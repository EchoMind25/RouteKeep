import { randomUUID } from "node:crypto";
import pg from "pg";

// Direct database setup for specs that need an exact day of work (dispatch,
// performance). Each call creates its own business, so specs never share or
// disturb data. Runs as the local superuser, like supabase/seed.sql.

const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? `postgresql://postgres@127.0.0.1:${process.env.RK_PGPORT ?? 54329}/routekeep`;

export const OFFICE = { lat: 40.2969, lng: -111.6946 };

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.routekeep.test`;
}

export interface SeedStop {
  name: string;
  lat: number;
  lng: number;
  /** Index into `techs`, or null for no technician. */
  tech: number | null;
  window?: [string, string];
  status?: "scheduled" | "unscheduled" | "skipped";
  /** Defaults to the seeded day; null only for unscheduled work. */
  date?: string | null;
  /** Geocoder confidence; below 0.8 the board asks for a pin check. */
  confidence?: number;
  durationMin?: number;
}

export interface SeededDay {
  email: string;
  tenantId: string;
  techIds: string[];
  /** Sign-in emails for technicians given a login (`techLogins`), by tech index. */
  techEmails: (string | null)[];
  stopIds: string[];
  customerIds: string[];
  propertyIds: string[];
  productIds: string[];
}

export interface SeedProduct {
  name: string;
  kind?: "pesticide" | "minimum_risk" | "fertilizer" | "other";
  epaRegNo?: string | null;
  signalWord?: "caution" | "warning" | "danger" | "danger_poison" | null;
  restrictedUse?: boolean;
}

export async function seedDispatchDay(opts: {
  date: string;
  techs: string[];
  stops: SeedStop[];
  officeLocation?: { lat: number; lng: number } | null;
  /** Indexes of technicians who get their own login. */
  techLogins?: number[];
  products?: SeedProduct[];
}): Promise<SeededDay> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const email = uniqueEmail("dispatch");
  const userId = randomUUID();
  const tenantId = randomUUID();
  const techIds = opts.techs.map(() => randomUUID());
  const customerIds = opts.stops.map(() => randomUUID());
  const propertyIds = opts.stops.map(() => randomUUID());
  const stopIds = opts.stops.map(() => randomUUID());
  const office = opts.officeLocation === undefined ? OFFICE : opts.officeLocation;
  const techEmails = opts.techs.map((_, i) => (opts.techLogins?.includes(i) ? uniqueEmail(`tech${i}`) : null));
  const techUserIds = techEmails.map((e) => (e ? randomUUID() : null));
  const productIds = (opts.products ?? []).map(() => randomUUID());
  try {
    await client.query("begin");
    await client.query("insert into auth.users (id, email, aud, role, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now())", [userId, email]);
    await client.query(
      "insert into public.tenants (id, name, timezone, state, business_license_no, plan, created_by) values ($1, 'Dispatch Test Pest', 'America/Denver', 'UT', 'UT-BUS-0001', 'pro', $2)",
      [tenantId, userId],
    );
    await client.query(
      `insert into public.offices (tenant_id, name, address_line1, city, region, postal_code, is_primary, location)
       values ($1, 'Dispatch Test Pest', '100 N Main St', 'Orem', 'UT', '84057', true,
               case when $2::float8 is null then null else extensions.st_setsrid(extensions.st_makepoint($3, $2), 4326)::extensions.geography end)`,
      [tenantId, office?.lat ?? null, office?.lng ?? null],
    );
    await client.query("insert into public.memberships (tenant_id, user_id, role, email, display_name) values ($1, $2, 'owner', $3, 'Dispatch Owner')", [tenantId, userId, email]);
    for (const [i, name] of opts.techs.entries()) {
      const login = techUserIds[i];
      if (login) {
        await client.query("insert into auth.users (id, email, aud, role, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now())", [login, techEmails[i]]);
        await client.query("insert into public.memberships (tenant_id, user_id, role, email, display_name) values ($1, $2, 'technician', $3, $4)", [tenantId, login, techEmails[i], name]);
      }
      await client.query(
        "insert into public.technicians (id, tenant_id, user_id, display_name, applicator_license_no, license_expiry, color_index) values ($1, $2, $3, $4, $5, current_date + 400, $6)",
        [techIds[i], tenantId, login, name, `UT-APP-${1000 + i}`, i % 12],
      );
    }
    for (const [i, p] of (opts.products ?? []).entries()) {
      const kind = p.kind ?? "pesticide";
      await client.query(
        `insert into public.products (id, tenant_id, name, kind, epa_reg_no, signal_word, restricted_use, default_mix_rate, default_mix_unit, default_amount_unit)
         values ($1, $2, $3, $4, $5, $6, $7, 0.5, 'fl_oz_per_gal', 'gal')`,
        [productIds[i], tenantId, p.name, kind, p.epaRegNo === undefined ? (kind === "pesticide" ? `0-${200 + i}` : null) : p.epaRegNo, p.signalWord === undefined ? "caution" : p.signalWord, p.restrictedUse ?? false],
      );
    }
    // A new business starts with default service types; use its general pest service.
    const type = await client.query<{ id: string }>(
      `select id from public.service_types where tenant_id = $1 and category = 'pest' order by lower(name) = 'general pest' desc, created_at limit 1`,
      [tenantId],
    );
    const typeId =
      type.rows[0]?.id ??
      (await client.query<{ id: string }>("insert into public.service_types (tenant_id, name, category) values ($1, 'General pest', 'pest') returning id", [tenantId])).rows[0]!.id;

    const s = opts.stops;
    // Lane stops start numbered in the order given, so every spec knows the starting order.
    const counters = new Map<number, number>();
    const sequence = s.map((x) => {
      if (x.tech === null || (x.status ?? "scheduled") !== "scheduled" || (x.date !== undefined && x.date !== opts.date)) return null;
      const n = (counters.get(x.tech) ?? 0) + 1;
      counters.set(x.tech, n);
      return n;
    });
    await client.query(
      `insert into public.customers (id, tenant_id, first_name, last_name, display_name)
       select id, $1, split_part(name, ' ', 1), nullif(substr(name, length(split_part(name, ' ', 1)) + 2), ''), name
       from unnest($2::uuid[], $3::text[]) as t(id, name)`,
      [tenantId, customerIds, s.map((x) => x.name)],
    );
    await client.query(
      `insert into public.properties (id, tenant_id, customer_id, address_line1, city, region, postal_code, location, geocode_confidence, geocode_source, geocoded_at)
       select id, $1, customer_id, (100 + n)::text || ' E Test St', 'Orem', 'UT', '84057',
              extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, confidence, 'test', now()
       from unnest($2::uuid[], $3::uuid[], $4::float8[], $5::float8[], $6::numeric[]) with ordinality as t(id, customer_id, lat, lng, confidence, n)`,
      [tenantId, propertyIds, customerIds, s.map((x) => x.lat), s.map((x) => x.lng), s.map((x) => x.confidence ?? 0.95)],
    );
    await client.query(
      `insert into public.appointments (id, tenant_id, customer_id, property_id, service_type_id, technician_id, status, local_date,
                                        window_start, window_end, tz, duration_min, skip_reason, sequence)
       select id, $1, customer_id, property_id, $2, technician_id, status, local_date, window_start, window_end, 'America/Denver', duration,
              case when status = 'skipped' then 'Customer not home' end, seq
       from unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::date[], $9::time[], $10::time[], $11::int[], $12::int[])
         as t(id, customer_id, property_id, technician_id, status, local_date, window_start, window_end, duration, seq)`,
      [
        tenantId,
        typeId,
        stopIds,
        customerIds,
        propertyIds,
        s.map((x) => (x.tech === null ? null : techIds[x.tech])),
        s.map((x) => x.status ?? "scheduled"),
        s.map((x) => (x.status === "unscheduled" ? null : x.date === undefined ? opts.date : x.date)),
        s.map((x) => x.window?.[0] ?? null),
        s.map((x) => x.window?.[1] ?? null),
        s.map((x) => x.durationMin ?? 30),
        sequence,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  return { email, tenantId, techIds, techEmails, stopIds, customerIds, propertyIds, productIds };
}

/** Runs one statement as the local superuser (assertions and setup in specs). */
export async function adminQuery<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Today's date where the seeded businesses are (America/Denver). */
export function denverToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Reads back a lane in the order every screen shows it (sequence, window, id). */
export async function laneOrder(techId: string, date: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const r = await client.query<{ id: string }>(
      `select id from public.appointments
       where technician_id = $1 and local_date = $2 and status in ('scheduled', 'in_progress', 'completed')
       order by sequence asc nulls last, window_start asc nulls last, id`,
      [techId, date],
    );
    return r.rows.map((x) => x.id);
  } finally {
    await client.end();
  }
}

/** A YYYY-MM-DD date plus n days. */
export function addDaysTo(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
