import { SyncHttpError, type SyncProvider } from "@/lib/providers/sync";
import type { TechStore } from "./client-store";

// Moves work between the device and the server whenever it can (FR-TEC-01,
// FR-TEC-05). Nothing waits on it: every screen reads the device copy, and a
// failed sync only means "try again later".

export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  error: string | null;
  /** The session ended; queued work stays until the technician signs in again. */
  signedOut: boolean;
  notLinked: boolean;
}

const INITIAL: SyncState = { online: true, syncing: false, lastSyncAt: null, error: null, signedOut: false, notLinked: false };
const BATCH = 50;
const PERIOD_MS = 60_000;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];

export class SyncEngine {
  private state: SyncState = INITIAL;
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private detach: (() => void) | null = null;

  constructor(
    private readonly store: TechStore,
    private readonly provider: SyncProvider,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  static readonly initial = INITIAL;

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  start() {
    const onOnline = () => {
      this.set({ online: true });
      void this.syncNow();
    };
    const onOffline = () => this.set({ online: false });
    const onVisible = () => {
      if (document.visibilityState === "visible") void this.syncNow();
      else void this.store.flush();
    };
    const onHide = () => void this.store.flush();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    this.detach = () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
    };
    this.set({ online: navigator.onLine });
    void this.syncNow();
  }

  stop() {
    this.detach?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** After a local change: sync soon, once, however many changes arrive. */
  request() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), 800);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  async syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    if (!navigator.onLine) {
      this.set({ online: false });
      this.schedule(PERIOD_MS);
      return;
    }
    this.running = true;
    this.set({ syncing: true });
    try {
      // Up first, so the snapshot that follows already includes this device's work.
      for (let round = 0; round < 20; round++) {
        const batch = this.store.getState().outbox.slice(0, BATCH);
        if (batch.length === 0) break;
        let results;
        try {
          results = await this.provider.push(batch.map((b) => b.mutation));
        } catch (error) {
          await this.store.noteFailure(error instanceof Error ? error.message : "Upload failed");
          throw error;
        }
        await this.store.settle(results);
        // The server is struggling with something; leave the rest for the next round.
        if (results.some((r) => r.status === "retry")) break;
      }
      await this.store.saveSnapshot(await this.provider.pull());
      this.failures = 0;
      this.set({ online: true, lastSyncAt: new Date().toISOString(), error: null, signedOut: false, notLinked: false });
      this.schedule(PERIOD_MS);
    } catch (error) {
      this.failures++;
      if (error instanceof SyncHttpError && error.status === 401) this.set({ signedOut: true, error: error.message });
      else if (error instanceof SyncHttpError && error.status === 409) this.set({ notLinked: true, error: error.message });
      // fetch rejects with a TypeError when the network is down: that is "offline", not a fault.
      else if (error instanceof TypeError) this.set({ online: false, error: null });
      else this.set({ error: error instanceof Error ? error.message : "Sync failed" });
      this.schedule(BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)]!);
    } finally {
      this.running = false;
      this.set({ syncing: false });
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    }
  }
}
