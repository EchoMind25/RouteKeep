import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env, storageProvider } from "@/lib/env";
import { publicEnv } from "@/lib/public-env";

// Where photos, signatures and generated documents are kept (D-02, FR-TEC-09,
// NFR-07). Paths are built by the server from ids it trusts; a provider never
// sees a path a client chose.

export interface StoredFile {
  body: Uint8Array;
  contentType: string;
}

export interface StorageProvider {
  readonly name: string;
  /** Writes the file; writing the same path again replaces it (uploads are retried). */
  put(path: string, body: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<StoredFile | null>;
}

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Development and tests only (lib/env.ts refuses it anywhere but this machine). */
export function localDiskStorage(dir: string): StorageProvider {
  const root = resolve(dir);
  const fileFor = (path: string) => {
    const file = resolve(root, path);
    if (!file.startsWith(root + sep)) throw new Error("Refusing a storage path outside the storage directory");
    return file;
  };
  return {
    name: "local",
    async put(path, body) {
      const file = fileFor(path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async get(path) {
      try {
        const body = new Uint8Array(await readFile(fileFor(path)));
        return { body, contentType: TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Supabase Storage, private bucket, service role (server only, ENG-08).
 * Not yet exercised against a hosted project: docs/DEPLOY.md says how to check it.
 */
export function supabaseStorage(url: string, serviceKey: string, bucket: string): StorageProvider {
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    name: "supabase",
    async put(path, body, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, body, { contentType, upsert: true });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async get(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) return null;
      return { body: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
    },
  };
}

let cached: StorageProvider | undefined;

export function storage(): StorageProvider {
  if (cached) return cached;
  const e = env();
  if (storageProvider(e) === "local") {
    cached = localDiskStorage(e.LOCAL_STORAGE_DIR);
  } else {
    if (!publicEnv.supabaseUrl || !e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Storage needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    cached = supabaseStorage(publicEnv.supabaseUrl, e.SUPABASE_SERVICE_ROLE_KEY, e.STORAGE_BUCKET);
  }
  return cached;
}
