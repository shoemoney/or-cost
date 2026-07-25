import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { normalizeModel } from "./pricing.js";
import type { Generation } from "./pricing.js";
import type { KeyInfo, Model, RawModel } from "./types.js";

const API = "https://openrouter.ai/api/v1";
const CACHE_DIR = join(tmpdir(), "or-cost");
const CACHE_FILE = join(CACHE_DIR, "models.json");
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch with rate-limit manners: honor Retry-After on 429, otherwise back off
 * exponentially (1s, 2s, 4s). 4xx other than 429 fail immediately — retrying a
 * bad key just burns the limit faster.
 */
async function request(path: string, apiKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { "HTTP-Referer": "https://github.com/shoemoney/or-cost" };
  if (apiKey !== undefined) headers["Authorization"] = `Bearer ${apiKey}`;

  let lastError = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${API}${path}`, { headers });
    if (res.ok) return await res.json();

    lastError = res.statusText === "" ? `${res.status}` : `${res.status} ${res.statusText}`;
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(
        `OPENROUTER_API_KEY was rejected (${res.status}) — check the key at https://openrouter.ai/keys`,
        res.status,
      );
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS - 1) {
      throw new ApiError(`GET ${path} failed: ${lastError}`, res.status);
    }

    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * 2 ** attempt;
    process.stderr.write(`  rate limited (${res.status}), retrying in ${waitMs / 1000}s\n`);
    await sleep(waitMs);
  }
  throw new ApiError(`GET ${path} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`, 429);
}

interface CacheEntry {
  fetchedAt: number;
  data: RawModel[];
}

async function readCache(): Promise<RawModel[] | null> {
  try {
    const entry = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Partial<CacheEntry>;
    // A corrupt or legacy entry must look like a cache miss, not poison every command.
    if (typeof entry?.fetchedAt !== "number" || !Array.isArray(entry.data)) return null;
    const age = Date.now() - entry.fetchedAt;
    if (age < 0 || age > CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

async function writeCache(data: RawModel[]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEntry));
  } catch {
    // A cold cache is slower, not broken.
  }
}

/** Public catalog — no API key required. Cached for an hour. */
export async function fetchModels(opts: { inputRatio?: number | undefined; noCache?: boolean | undefined } = {}): Promise<Model[]> {
  let raw = opts.noCache === true ? null : await readCache();
  if (raw === null) {
    const body = (await request("/models")) as { data?: RawModel[] };
    raw = body.data ?? [];
    await writeCache(raw);
  }
  return raw.map((m) => normalizeModel(m, opts.inputRatio));
}

export async function fetchKeyInfo(apiKey: string): Promise<KeyInfo> {
  const body = (await request("/auth/key", apiKey)) as {
    data?: {
      label?: string;
      usage?: number;
      limit?: number | null;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
    };
  };
  const d = body.data ?? {};
  return {
    label: d.label ?? "(unlabeled key)",
    usage: d.usage ?? 0,
    limit: d.limit ?? null,
    limitRemaining: d.limit_remaining ?? null,
    isFreeTier: d.is_free_tier ?? false,
  };
}

/**
 * Per-generation detail. OpenRouter exposes this one id at a time, so callers
 * supply ids they already have (from their own logs or a chat completion
 * response) — there is no public "list my generations" endpoint.
 */
export async function fetchGeneration(apiKey: string, id: string): Promise<Generation> {
  const body = (await request(`/generation?id=${encodeURIComponent(id)}`, apiKey)) as {
    data?: Generation;
  };
  return body.data ?? {};
}

export async function fetchGenerations(apiKey: string, ids: readonly string[]): Promise<Generation[]> {
  const out: Generation[] = [];
  for (const id of ids) {
    try {
      out.push(await fetchGeneration(apiKey, id));
    } catch (err) {
      process.stderr.write(`  skipping ${id}: ${(err as Error).message}\n`);
    }
  }
  return out;
}
