/**
 * Embedding client — calls any OpenAI-compatible /v1/embeddings endpoint.
 * Config is read from settings.json (editable via Settings UI).
 * Falls back to env vars, then disables gracefully.
 */

import { loadSettings } from "./settings.ts";

export interface EmbeddingConfig {
  endpoint: string;   // base URL, e.g. "https://ark.cn-beijing.volces.com/api/v3"
  apiKey: string;
  model: string;      // e.g. "ep-20260404142400-s2jc4" or "text-embedding-3-small"
  dimensions: number; // vector size, must match model output
}

function getConfig(): EmbeddingConfig {
  const settings = loadSettings();
  return {
    endpoint:
      settings.embedding?.endpoint ||
      process.env.EMBEDDING_ENDPOINT ||
      "",
    apiKey:
      settings.embedding?.apiKey ||
      process.env.EMBEDDING_API_KEY ||
      "",
    model:
      settings.embedding?.model ||
      process.env.EMBEDDING_MODEL ||
      "text-embedding-3-small",
    dimensions:
      settings.embedding?.dimensions ||
      Number(process.env.EMBEDDING_DIMENSIONS) ||
      1536,
  };
}

export function getEmbeddingDimensions(): number {
  return getConfig().dimensions;
}

function isConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.endpoint && c.apiKey);
}

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!isConfigured()) return null;
  const c = getConfig();

  try {
    const base = c.endpoint.replace(/\/$/, "");
    // Support endpoints that already include /v1 or not
    const url = base.endsWith("/v1")
      ? `${base}/embeddings`
      : `${base}/v1/embeddings`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000),
        model: c.model,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      data: { embedding: number[] }[];
    };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

export async function getEmbeddings(
  texts: string[]
): Promise<(number[] | null)[]> {
  if (!isConfigured() || texts.length === 0) return texts.map(() => null);
  const c = getConfig();

  try {
    const base = c.endpoint.replace(/\/$/, "");
    const url = base.endsWith("/v1")
      ? `${base}/embeddings`
      : `${base}/v1/embeddings`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        input: texts.map((t) => t.slice(0, 8000)),
        model: c.model,
      }),
    });

    if (!res.ok) return texts.map(() => null);

    const data = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    const result: (number[] | null)[] = texts.map(() => null);
    for (const item of data.data) {
      result[item.index] = item.embedding;
    }
    return result;
  } catch {
    return texts.map(() => null);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export { isConfigured as isEmbeddingConfigured };
