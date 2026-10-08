import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import Stripe from "stripe";

// M4 stage 2: a stand-in for Stripe's API on 127.0.0.1:3198, so payments are
// tested end to end with no account, no key and nothing leaving the machine
// (playwright.config.ts points the app here with STRIPE_API_BASE). It answers
// only the calls RouteKeep makes, records each request (connected account
// header, idempotency key, parameters) for the test to check, plays Stripe's
// hosted pages as plain forms, and sends signed webhooks back to the app the
// way Stripe would. It is a model of Stripe's behaviour for these calls, not
// a copy of anything of Stripe's.

export const STANDIN_PORT = 3198;
export const WEBHOOK_SECRET = "whsec_e2e_not_a_real_secret";

type Obj = Record<string, unknown>;
export interface Recorded {
  method: string;
  path: string;
  account: string | null;
  idempotencyKey: string | null;
  body: Obj;
}

/** Stripe's form encoding (a[b][0][c]=v) back into objects; numeric keys stay object keys. */
function parseForm(raw: string): Obj {
  const out: Obj = {};
  for (const pair of raw.split("&").filter(Boolean)) {
    const [k, v = ""] = pair.split("=").map((s) => decodeURIComponent(s.replace(/\+/g, " "))) as [string, string?];
    const keys = k.replace(/\]/g, "").split("[");
    let node = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) node[key] = v;
      else node = (node[key] ??= {}) as Obj;
    });
  }
  return out;
}

export class StripeStandIn {
  readonly requests: Recorded[] = [];
  readonly delivered: { id: string; type: string; status: number; payload: string }[] = [];
  private server!: Server;
  private n = 0;
  private idem = new Map<string, { status: number; body: unknown }>();
  accounts = new Map<string, Obj>();
  sessions = new Map<string, Obj>();
  intents = new Map<string, Obj & { account: string }>();
  setups = new Map<string, Obj>();
  methods = new Map<string, Obj & { decline?: string }>();
  refunds = new Map<string, Obj & { account: string }>();
  detached: string[] = [];
  private signer = new Stripe("sk_test_signer_only");

  constructor(private appBase: string) {}

  // Unique across runs: earlier runs' businesses keep their account ids in the database.
  private run = Math.random().toString(36).slice(2, 8);

  id(prefix: string) {
    return `${prefix}_e2e${this.run}${++this.n}`;
  }

  async start() {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve) => this.server.listen(STANDIN_PORT, "127.0.0.1", resolve));
  }

  async stop() {
    await new Promise((resolve) => this.server.close(resolve));
  }

  calls(path: RegExp, method = "POST") {
    return this.requests.filter((r) => r.method === method && path.test(r.path));
  }

  /** Sends an event to the app, signed like Stripe signs it. */
  async deliver(type: string, object: Obj, account: string, opts: { id?: string } = {}) {
    const event = { id: opts.id ?? this.id("evt"), object: "event", api_version: "2026-09-30.endive", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: null, type, account, data: { object } };
    const payload = JSON.stringify(event);
    const status = await this.post(payload, this.signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }));
    this.delivered.push({ id: event.id, type, status, payload });
    return { status, payload };
  }

  async post(payload: string, signature: string) {
    const r = await fetch(`${this.appBase}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload });
    return r.status;
  }

  signature(payload: string) {
    return this.signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  }

  /** A payment Stripe took that the app never heard about (a lost webhook). */
  addIntent(account: string, intent: Obj) {
    const pi = { id: this.id("pi"), object: "payment_intent", created: Math.floor(Date.now() / 1000), currency: "usd", last_payment_error: null, payment_method_types: ["card"], ...intent, account };
    this.intents.set(pi.id, pi);
    return pi;
  }

  private local(url: string) {
    const u = new URL(url);
    return `${this.appBase}${u.pathname}${u.search}`;
  }

  private send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "request-id": `req_${this.n}` });
    res.end(JSON.stringify(body));
  }

  private page(res: ServerResponse, title: string, body: string) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`);
  }

  private redirect(res: ServerResponse, to: string) {
    res.writeHead(303, { location: to });
    res.end();
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url!, `http://127.0.0.1:${STANDIN_PORT}`);
    const path = url.pathname;
    const method = req.method!;
    const account = (req.headers["stripe-account"] as string | undefined) ?? null;
    const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const body = method === "GET" ? parseForm(url.search.slice(1)) : parseForm(raw);
    if (path.startsWith("/v1/")) this.requests.push({ method, path, account, idempotencyKey: key, body });

    // Stripe replays the first answer for a repeated idempotency key.
    const idemKey = key ? `${account}|${key}` : null;
    if (idemKey && this.idem.has(idemKey)) {
      const prior = this.idem.get(idemKey)!;
      return this.send(res, prior.status, prior.body);
    }
    const reply = (status: number, out: unknown) => {
      if (idemKey) this.idem.set(idemKey, { status, body: out });
      this.send(res, status, out);
    };
    let m: RegExpExecArray | null;

    // --- Connect ---------------------------------------------------------------
    if (method === "POST" && path === "/v1/accounts") {
      const a = { id: this.id("acct"), object: "account", type: body.type, charges_enabled: false, details_submitted: false, metadata: body.metadata ?? {} };
      this.accounts.set(a.id, a);
      return reply(200, a);
    }
    if (method === "GET" && (m = /^\/v1\/accounts\/(acct_\w+)$/.exec(path))) return reply(200, this.accounts.get(m[1]!) ?? {});
    if (method === "POST" && path === "/v1/account_links") {
      const back = encodeURIComponent(String(body.return_url));
      return reply(200, { object: "account_link", url: `http://127.0.0.1:${STANDIN_PORT}/onboard/${body.account}?back=${back}` });
    }
    if (method === "GET" && (m = /^\/onboard\/(acct_\w+)$/.exec(path))) {
      // Onboarding finished in one step: details in, charges on.
      Object.assign(this.accounts.get(m[1]!)!, { charges_enabled: true, details_submitted: true });
      return this.redirect(res, this.local(url.searchParams.get("back")!));
    }

    // --- Customers and Checkout --------------------------------------------------
    if (method === "POST" && path === "/v1/customers") return reply(200, { id: this.id("cus"), object: "customer", email: body.email ?? null, metadata: body.metadata ?? {} });
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const id = this.id("cs");
      const items = (body.line_items as Obj | undefined)?.["0"] as Obj | undefined;
      const amount = items ? Number(((items.price_data as Obj).unit_amount as string) ?? 0) * Number(items.quantity ?? 1) : null;
      const s = {
        id,
        object: "checkout.session",
        mode: body.mode,
        status: "open",
        payment_status: "unpaid",
        url: `http://127.0.0.1:${STANDIN_PORT}/pay/${id}`,
        customer: body.customer,
        amount_total: amount,
        metadata: body.metadata ?? {},
        payment_intent: null,
        setup_intent: null,
        success_url: body.success_url,
        cancel_url: body.cancel_url,
        params: body,
        account,
      };
      this.sessions.set(id, s);
      return reply(200, s);
    }
    if ((m = /^\/v1\/checkout\/sessions\/(cs_\w+)(\/expire)?$/.exec(path))) {
      const s = this.sessions.get(m[1]!)!;
      if (m[2] && method === "POST") {
        if (s.status !== "open") return reply(400, { error: { type: "invalid_request_error", message: "Only open sessions can be expired." } });
        s.status = "expired";
        await this.deliver("checkout.session.expired", s, account!);
      }
      return reply(200, s);
    }
    if ((m = /^\/pay\/(cs_\w+)$/.exec(path))) {
      const s = this.sessions.get(m[1]!)!;
      return this.page(
        res,
        s.mode === "setup" ? "Stand-in: save a payment method" : "Stand-in: pay",
        s.mode === "setup"
          ? `<p>${((s.params as Obj).custom_text as Obj | undefined)?.submit ? String((((s.params as Obj).custom_text as Obj).submit as Obj).message) : ""}</p>
             <form method="post" action="/pay/${s.id}/card"><button>Save card</button></form>
             <form method="post" action="/pay/${s.id}/decline"><button>Save a card that will be declined</button></form>`
          : `<p>Amount ${s.amount_total}</p>
             <form method="post" action="/pay/${s.id}/card"><button>Pay by card</button></form>
             <form method="post" action="/pay/${s.id}/bank"><button>Pay by bank</button></form>`,
      );
    }
    if (method === "POST" && (m = /^\/pay\/(cs_\w+)\/(card|bank|decline)$/.exec(path))) {
      const s = this.sessions.get(m[1]!)!;
      const acct = String(s.account);
      const how = m[2]!;
      s.status = "complete";
      if (s.mode === "setup") {
        const pm = { id: this.id("pm"), object: "payment_method", type: "card", card: { brand: "visa", last4: how === "decline" ? "0341" : "4242", exp_month: 12, exp_year: 2030 }, ...(how === "decline" ? { decline: "insufficient_funds" } : {}) };
        this.methods.set(pm.id, pm);
        const si = { id: this.id("seti"), object: "setup_intent", status: "succeeded", payment_method: pm.id, mandate: null, created: Math.floor(Date.now() / 1000), metadata: ((s.params as Obj).setup_intent_data as Obj | undefined)?.metadata ?? {} };
        this.setups.set(si.id, si);
        s.setup_intent = si.id;
        await this.deliver("checkout.session.completed", s, acct);
      } else {
        const paid = how === "card";
        const pi = this.addIntent(acct, {
          amount: s.amount_total,
          amount_received: paid ? s.amount_total : 0,
          status: paid ? "succeeded" : "processing",
          payment_method_types: [paid ? "card" : "us_bank_account"],
          metadata: ((s.params as Obj).payment_intent_data as Obj | undefined)?.metadata ?? {},
        });
        s.payment_intent = pi.id;
        s.payment_status = paid ? "paid" : "unpaid";
        await this.deliver("checkout.session.completed", s, acct);
        await this.deliver(paid ? "payment_intent.succeeded" : "payment_intent.processing", pi, acct);
      }
      return this.redirect(res, this.local(String(s.success_url)));
    }

    // --- Saved methods and charges ------------------------------------------------
    if (method === "GET" && (m = /^\/v1\/setup_intents\/(seti_\w+)$/.exec(path))) {
      const si = this.setups.get(m[1]!)!;
      return reply(200, { ...si, payment_method: this.methods.get(String(si.payment_method)) });
    }
    if (method === "POST" && (m = /^\/v1\/payment_methods\/(pm_\w+)\/detach$/.exec(path))) {
      this.detached.push(m[1]!);
      return reply(200, { ...this.methods.get(m[1]!), customer: null });
    }
    if (method === "POST" && path === "/v1/payment_intents") {
      const pm = this.methods.get(String(body.payment_method));
      const declined = pm?.decline;
      const pi = this.addIntent(account!, {
        amount: Number(body.amount),
        amount_received: declined ? 0 : Number(body.amount),
        status: declined ? "requires_payment_method" : "succeeded",
        payment_method: body.payment_method,
        metadata: body.metadata ?? {},
        last_payment_error: declined ? { type: "card_error", code: "card_declined", decline_code: declined, message: "Declined" } : null,
      });
      if (declined) return reply(402, { error: { type: "card_error", code: "card_declined", decline_code: declined, message: "Your card was declined.", payment_intent: pi } });
      return reply(200, pi);
    }
    if (method === "GET" && path === "/v1/payment_intents") return reply(200, { object: "list", url: path, has_more: false, data: [...this.intents.values()].filter((p) => p.account === account) });
    if (method === "GET" && (m = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(path))) return reply(200, this.intents.get(m[1]!) ?? {});
    if (method === "POST" && path === "/v1/refunds") {
      const r = { id: this.id("re"), object: "refund", amount: Number(body.amount), payment_intent: body.payment_intent, status: "succeeded", metadata: body.metadata ?? {}, account: account! };
      this.refunds.set(r.id, r);
      // Stripe also tells the webhook; the app must not post it twice.
      setTimeout(() => void this.deliver("refund.created", r, account!), 50);
      return reply(200, r);
    }
    if (method === "GET" && path === "/v1/refunds") return reply(200, { object: "list", url: path, has_more: false, data: [...this.refunds.values()].filter((r) => r.account === account) });

    return reply(404, { error: { type: "invalid_request_error", message: `Stand-in has no ${method} ${path}` } });
  }
}
