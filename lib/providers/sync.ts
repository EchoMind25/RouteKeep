import { SYNC_PROTOCOL, type Mutation, type MutationResult, type Snapshot, type UploadResponse } from "@/lib/sync/protocol";

// D-06, NFR-07: how the technician app reaches the server. The built-in
// adapter talks to our own API and needs no third party. A PowerSync adapter
// (D-06's first choice) can replace it behind this interface once the owner
// has a PowerSync account; the device store and the stop flow do not change.

export class SyncHttpError extends Error {
  override name = "SyncHttpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SyncProvider {
  readonly name: string;
  /** Today's and tomorrow's route and everything a stop needs. */
  pull(): Promise<Snapshot>;
  /** Sends queued work in order; one answer per mutation. */
  push(mutations: Mutation[]): Promise<MutationResult[]>;
}

async function failure(response: Response): Promise<SyncHttpError> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new SyncHttpError(response.status, body?.error ?? `The server answered ${response.status}.`);
}

export const httpSync: SyncProvider = {
  name: "routekeep",
  async pull() {
    const response = await fetch("/api/tech/sync", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as Snapshot;
  },
  async push(mutations) {
    const response = await fetch("/api/tech/upload", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: SYNC_PROTOCOL, mutations }),
    });
    if (!response.ok) throw await failure(response);
    return ((await response.json()) as UploadResponse).results;
  },
};
