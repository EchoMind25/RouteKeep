import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Mutation, MutationResult, Snapshot, SnapshotMix, SnapshotProduct, SnapshotStop } from "./protocol";

// The technician's device copy (FR-TEC-02, FR-TEC-04, ENG-09, NFR-01).
//
// IndexedDB holds everything; an in-memory mirror serves React. Every change
// is written through at once, and anything still in flight is flushed when
// the page is hidden, so killing the app at any step loses nothing (R-BUG-01).
// Only this browser profile ever holds the data, and signing out deletes it.

export type StepId = "checklist" | "products" | "photos" | "signature" | "payment" | "review";
export const STEPS: { id: StepId; label: string }[] = [
  { id: "checklist", label: "Checklist" },
  { id: "products", label: "Products" },
  { id: "photos", label: "Photos" },
  { id: "signature", label: "Signature" },
  { id: "payment", label: "Payment" },
  { id: "review", label: "Complete" },
];

/** One product as the technician is typing it; numbers stay text until sent. */
export interface ApplicationEntry {
  key: string;
  productId: string;
  mixRate: string;
  mixUnit: string;
  totalAmount: string;
  amountUnit: string;
  areaTreated: string;
  areaUnit: string;
  targetSites: string[];
  targetPests: string[];
  /** "HH:MM" on the stop's day, in the business's time zone. */
  appliedTime: string;
  capturedAt: string;
  customerStatement: boolean;
  customerStatementAt: string | null;
}

export interface Draft {
  appointmentId: string;
  /** The day the device had the visit on; sent with every mutation. */
  date: string;
  step: StepId;
  arrivedAt: string | null;
  checklist: Record<string, boolean>;
  notes: string;
  applications: ApplicationEntry[];
  photos: string[];
  signature: { key: string; signerName: string } | null;
  payment: { method: "invoice_later" | "cash" | "check"; amount: string; checkNumber: string; key: string };
  /** Set when the stop is queued as complete or skipped. */
  completedAt: string | null;
  skippedAt: string | null;
  /** The server refused the completion; the stop is open again with this message. */
  rejection: string | null;
  updatedAt: string;
}

export interface OutboxEntry {
  seq?: number;
  key: string;
  /** Null for a mutation about the whole day (running late). */
  appointmentId: string | null;
  mutation: Mutation;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface Notice {
  key: string;
  appointmentId: string | null;
  status: "conflict" | "rejected";
  message: string;
  at: string;
}

export interface BlobEntry {
  key: string;
  appointmentId: string;
  kind: "photo" | "signature";
  blob: Blob;
  contentType: string;
  capturedAt: string;
  /** Set when its stop is completed or skipped: only then is it sent (a photo deleted before that never leaves the phone). */
  ready: boolean;
  uploadedAt: string | null;
}

export type SnapshotInfo = Omit<Snapshot, "stops" | "products" | "lastMixes">;

interface TechDB extends DBSchema {
  meta: { key: string; value: { key: string; value: unknown } };
  stops: { key: string; value: SnapshotStop; indexes: { date: string } };
  products: { key: string; value: SnapshotProduct };
  mixes: { key: string; value: { propertyId: string; mixes: SnapshotMix[] } };
  drafts: { key: string; value: Draft };
  outbox: { key: number; value: OutboxEntry; indexes: { key: string; appointmentId: string } };
  notices: { key: string; value: Notice };
  blobs: { key: string; value: BlobEntry; indexes: { appointmentId: string } };
}

const DB_NAME = "routeverde-tech";

function open(): Promise<IDBPDatabase<TechDB>> {
  return openDB<TechDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("meta", { keyPath: "key" });
      db.createObjectStore("stops", { keyPath: "id" }).createIndex("date", "date");
      db.createObjectStore("products", { keyPath: "id" });
      db.createObjectStore("mixes", { keyPath: "propertyId" });
      db.createObjectStore("drafts", { keyPath: "appointmentId" });
      const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      outbox.createIndex("key", "key", { unique: true });
      outbox.createIndex("appointmentId", "appointmentId");
      db.createObjectStore("notices", { keyPath: "key" });
      db.createObjectStore("blobs", { keyPath: "key" }).createIndex("appointmentId", "appointmentId");
    },
  });
}

export interface TechState {
  ready: boolean;
  info: SnapshotInfo | null;
  stops: SnapshotStop[];
  products: SnapshotProduct[];
  mixes: Map<string, SnapshotMix[]>;
  drafts: Map<string, Draft>;
  outbox: OutboxEntry[];
  notices: Notice[];
  blobs: Map<string, BlobEntry>;
  /** FR-INV-07: days whose truck check was submitted on this phone, so the card stays done between upload and the next snapshot. */
  countsDone: string[];
}

const EMPTY: TechState = { ready: false, info: null, stops: [], products: [], mixes: new Map(), drafts: new Map(), outbox: [], notices: [], blobs: new Map(), countsDone: [] };

export function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** A stop is the device's to keep while it has unsent work or an open draft. */
function hasLocalWork(state: Pick<TechState, "drafts" | "outbox">, id: string): boolean {
  const draft = state.drafts.get(id);
  return state.outbox.some((o) => o.appointmentId === id) || Boolean(draft && !draft.completedAt && !draft.skippedAt && (draft.arrivedAt || draft.applications.length));
}

export class TechStore {
  private db: Promise<IDBPDatabase<TechDB>> | null = null;
  private state: TechState = EMPTY;
  private listeners = new Set<() => void>();
  private pendingWrites = new Set<Promise<unknown>>();

  constructor(private readonly userId: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<TechState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
    return p;
  }

  /** Waits for every write in flight; called when the page is being hidden. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
  }

  private async conn() {
    this.db ??= open();
    return this.db;
  }

  /** Loads the device copy. A different login on this browser starts from nothing (shared phones). */
  async load(): Promise<void> {
    const db = await this.conn();
    const owner = (await db.get("meta", "owner"))?.value;
    if (owner !== this.userId) {
      const tx = db.transaction(["meta", "stops", "products", "mixes", "drafts", "outbox", "notices", "blobs"], "readwrite");
      await Promise.all([...tx.objectStoreNames].map((n) => tx.objectStore(n).clear()));
      await tx.objectStore("meta").put({ key: "owner", value: this.userId });
      await tx.done;
    }
    const [info, stops, products, mixes, drafts, outbox, notices, blobs, countsDone] = await Promise.all([
      db.get("meta", "info"),
      db.getAll("stops"),
      db.getAll("products"),
      db.getAll("mixes"),
      db.getAll("drafts"),
      db.getAll("outbox"),
      db.getAll("notices"),
      db.getAll("blobs"),
      db.get("meta", "countsDone"),
    ]);
    this.set({
      ready: true,
      info: (info?.value as SnapshotInfo | undefined) ?? null,
      stops,
      products,
      mixes: new Map(mixes.map((m) => [m.propertyId, m.mixes])),
      drafts: new Map(drafts.map((d) => [d.appointmentId, d])),
      outbox: outbox.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
      notices,
      blobs: new Map(blobs.map((b) => [b.key, b])),
      countsDone: Array.isArray(countsDone?.value) ? (countsDone.value as string[]) : [],
    });
  }

  /** Server wins on schedule fields: a fresh snapshot replaces the route, except stops with work not yet sent. */
  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const db = await this.conn();
    const keep = this.state.stops.filter((s) => hasLocalWork(this.state, s.id) && !snapshot.stops.some((n) => n.id === s.id));
    const stops = [...snapshot.stops, ...keep];
    const { stops: _s, products, lastMixes, ...info } = snapshot;
    const mixes = Object.entries(lastMixes).map(([propertyId, list]) => ({ propertyId, mixes: list }));
    // Drafts the server has caught up with are done.
    const finished = [...this.state.drafts.values()].filter((d) => {
      const server = snapshot.stops.find((s) => s.id === d.appointmentId);
      const sent = !this.state.outbox.some((o) => o.appointmentId === d.appointmentId);
      return sent && (d.completedAt || d.skippedAt) && (!server || server.status === "completed");
    });
    // Their files go too, once sent; a file never marked ready was deleted from the stop or never needed.
    const done = new Set(finished.map((d) => d.appointmentId));
    const released = [...this.state.blobs.values()].filter((b) => done.has(b.appointmentId) && (b.uploadedAt || !b.ready));
    const tx = db.transaction(["meta", "stops", "products", "mixes", "drafts", "blobs"], "readwrite");
    await Promise.all([
      tx.objectStore("stops").clear().then(() => Promise.all(stops.map((s) => tx.objectStore("stops").put(s)))),
      tx.objectStore("products").clear().then(() => Promise.all(products.map((p) => tx.objectStore("products").put(p)))),
      tx.objectStore("mixes").clear().then(() => Promise.all(mixes.map((m) => tx.objectStore("mixes").put(m)))),
      tx.objectStore("meta").put({ key: "info", value: info }),
      ...finished.map((d) => tx.objectStore("drafts").delete(d.appointmentId)),
      ...released.map((b) => tx.objectStore("blobs").delete(b.key)),
    ]);
    await tx.done;
    const drafts = new Map(this.state.drafts);
    for (const d of finished) drafts.delete(d.appointmentId);
    const blobs = new Map(this.state.blobs);
    for (const b of released) blobs.delete(b.key);
    this.set({ info, stops, products, mixes: new Map(mixes.map((m) => [m.propertyId, m.mixes])), drafts, blobs });
  }

  /** ENG-09: written on every change, not on submit. */
  putDraft(draft: Draft): Promise<void> {
    const next = { ...draft, updatedAt: new Date().toISOString() };
    const drafts = new Map(this.state.drafts);
    drafts.set(next.appointmentId, next);
    this.set({ drafts });
    return this.track(this.conn().then((db) => db.put("drafts", next).then(() => undefined)));
  }

  /**
   * Saves a draft and queues its upload in one transaction: both happen or
   * neither, so a stop can never look finished with nothing queued to send.
   */
  async record(draft: Draft, mutation: Mutation, readyBlobs: readonly string[] = []): Promise<void> {
    const next = { ...draft, updatedAt: new Date().toISOString() };
    const entry: OutboxEntry = { key: mutation.key, appointmentId: "appointmentId" in mutation ? mutation.appointmentId : null, mutation, createdAt: new Date().toISOString(), attempts: 0, lastError: null };
    const ready = readyBlobs.flatMap((k) => (this.state.blobs.has(k) ? [{ ...this.state.blobs.get(k)!, ready: true }] : []));
    const db = await this.conn();
    const write = (async () => {
      const tx = db.transaction(["drafts", "outbox", "blobs"], "readwrite");
      await tx.objectStore("drafts").put(next);
      const seq = await tx.objectStore("outbox").add(entry);
      for (const b of ready) await tx.objectStore("blobs").put(b);
      await tx.done;
      return seq;
    })();
    const seq = await this.track(write);
    const drafts = new Map(this.state.drafts);
    drafts.set(next.appointmentId, next);
    const blobs = new Map(this.state.blobs);
    for (const b of ready) blobs.set(b.key, b);
    this.set({ drafts, blobs, outbox: [...this.state.outbox, { ...entry, seq }] });
  }

  /** Files that are finished and not yet sent, oldest first. */
  pendingBlobs(): BlobEntry[] {
    return [...this.state.blobs.values()].filter((b) => b.ready && !b.uploadedAt).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  }

  /** The server will never take this file (its visit is gone, or the type is refused): stop sending it, and say so. */
  async markRejected(key: string, message: string): Promise<void> {
    const entry = this.state.blobs.get(key);
    if (!entry) return;
    const db = await this.conn();
    const stuck = { ...entry, ready: false };
    const notice: Notice = { key: `file-${key}`, appointmentId: entry.appointmentId, status: "rejected", message, at: new Date().toISOString() };
    const tx = db.transaction(["blobs", "notices"], "readwrite");
    await tx.objectStore("blobs").put(stuck);
    await tx.objectStore("notices").put(notice);
    await tx.done;
    const blobs = new Map(this.state.blobs);
    blobs.set(key, stuck);
    this.set({ blobs, notices: [...this.state.notices, notice] });
  }

  /** A file reached the server. Once its stop is finished here too, the phone lets go of it. */
  async markUploaded(key: string): Promise<void> {
    const entry = this.state.blobs.get(key);
    if (!entry) return;
    const db = await this.conn();
    const blobs = new Map(this.state.blobs);
    if (this.state.drafts.has(entry.appointmentId)) {
      const uploaded = { ...entry, uploadedAt: new Date().toISOString() };
      await db.put("blobs", uploaded);
      blobs.set(key, uploaded);
    } else {
      await db.delete("blobs", key);
      blobs.delete(key);
    }
    this.set({ blobs });
  }

  async enqueue(mutation: Mutation): Promise<void> {
    const entry: OutboxEntry = { key: mutation.key, appointmentId: "appointmentId" in mutation ? mutation.appointmentId : null, mutation, createdAt: new Date().toISOString(), attempts: 0, lastError: null };
    const db = await this.conn();
    const seq = await this.track(db.add("outbox", entry));
    this.set({ outbox: [...this.state.outbox, { ...entry, seq }] });
  }

  /** FR-INV-07: queues the truck count and remembers the day as done, in one transaction. Works offline. */
  async submitCount(mutation: Extract<Mutation, { kind: "stock_count" }>): Promise<void> {
    const entry: OutboxEntry = { key: mutation.key, appointmentId: null, mutation, createdAt: new Date().toISOString(), attempts: 0, lastError: null };
    const countsDone = [...new Set([...this.state.countsDone, mutation.date])].slice(-7);
    const db = await this.conn();
    const write = (async () => {
      const tx = db.transaction(["outbox", "meta"], "readwrite");
      const seq = await tx.objectStore("outbox").add(entry);
      await tx.objectStore("meta").put({ key: "countsDone", value: countsDone });
      await tx.done;
      return seq;
    })();
    const seq = await this.track(write);
    this.set({ outbox: [...this.state.outbox, { ...entry, seq }], countsDone });
  }

  /** Records the server's answers: settled entries leave the queue; problems become notices. */
  async settle(results: MutationResult[], error?: string): Promise<void> {
    const db = await this.conn();
    const tx = db.transaction(["outbox", "notices", "drafts", "meta"], "readwrite");
    const outbox = [...this.state.outbox];
    const notices = [...this.state.notices];
    const drafts = new Map(this.state.drafts);
    let countsDone = this.state.countsDone;
    for (const r of results) {
      const i = outbox.findIndex((o) => o.key === r.key);
      if (i < 0) continue;
      const entry = outbox[i]!;
      if (r.status === "retry") {
        const updated = { ...entry, attempts: entry.attempts + 1, lastError: r.message ?? error ?? null };
        outbox[i] = updated;
        await tx.objectStore("outbox").put(updated);
        continue;
      }
      outbox.splice(i, 1);
      await tx.objectStore("outbox").delete(entry.seq!);
      if (r.status === "conflict" || r.status === "rejected") {
        const notice: Notice = { key: r.key, appointmentId: entry.appointmentId, status: r.status, message: r.message ?? "", at: new Date().toISOString() };
        notices.push(notice);
        await tx.objectStore("notices").put(notice);
      }
      // FR-INV-07: a refused truck check is open again so it can be redone.
      if (r.status === "rejected" && entry.mutation.kind === "stock_count") {
        const date = entry.mutation.date;
        countsDone = countsDone.filter((d) => d !== date);
        await tx.objectStore("meta").put({ key: "countsDone", value: countsDone });
      }
      // A refused completion reopens the stop so the technician can fix it.
      if (r.status === "rejected" && entry.mutation.kind === "complete" && entry.appointmentId) {
        const draft = drafts.get(entry.appointmentId);
        if (draft) {
          const reopened = { ...draft, completedAt: null, step: "review" as const, rejection: r.message ?? "The office could not accept this stop.", updatedAt: new Date().toISOString() };
          drafts.set(entry.appointmentId, reopened);
          await tx.objectStore("drafts").put(reopened);
        }
      }
    }
    await tx.done;
    this.set({ outbox, notices, drafts, countsDone });
  }

  /** Marks the whole queue as tried once more (network failure: nothing reached the server). */
  async noteFailure(message: string): Promise<void> {
    const db = await this.conn();
    const outbox = this.state.outbox.map((o) => ({ ...o, attempts: o.attempts + 1, lastError: message }));
    const tx = db.transaction("outbox", "readwrite");
    await Promise.all(outbox.map((o) => tx.store.put(o)));
    await tx.done;
    this.set({ outbox });
  }

  async dismissNotice(key: string): Promise<void> {
    const db = await this.conn();
    await db.delete("notices", key);
    this.set({ notices: this.state.notices.filter((n) => n.key !== key) });
  }

  async putBlob(entry: BlobEntry): Promise<void> {
    const db = await this.conn();
    await this.track(db.put("blobs", entry));
    const blobs = new Map(this.state.blobs);
    blobs.set(entry.key, entry);
    this.set({ blobs });
  }

  async deleteBlob(key: string): Promise<void> {
    const db = await this.conn();
    await db.delete("blobs", key);
    const blobs = new Map(this.state.blobs);
    blobs.delete(key);
    this.set({ blobs });
  }

  /** Lets go of the database so it can be deleted (sign out). */
  async close(): Promise<void> {
    if (!this.db) return;
    (await this.db).close();
    this.db = null;
  }

  /** Sign out: nothing about customers stays on the device. */
  static async wipe(): Promise<void> {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
}
