/**
 * Embedding client — supports multiple providers natively.
 * No external proxy needed for Volcengine/Doubao.
 */

import { loadSettings } from "./settings.ts";
import type { EmbeddingSettings, EmbeddingProvider } from "../../shared/types.ts";

function getConfig(): EmbeddingSettings {
  const settings = loadSettings();
  return {
    provider: settings.embedding?.provider || "openai",
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
      "",
    dimensions:
      settings.embedding?.dimensions ||
      Number(process.env.EMBEDDING_DIMENSIONS) ||
      1536,
  };
}

export function getEmbeddingDimensions(): number {
  return getConfig().dimensions || 1536;
}

function isConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.endpoint && c.apiKey && c.model);
}

export { isConfigured as isEmbeddingConfigured };

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function callOpenAI(
  c: EmbeddingSettings,
  texts: string[]
): Promise<number[][]> {
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

  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  const result: number[][] = new Array(texts.length);
  for (const item of data.data) {
    result[item.index] = item.embedding;
  }
  return result;
}

async function callVolcengine(
  c: EmbeddingSettings,
  texts: string[]
): Promise<number[][]> {
  // Volcengine Doubao multimodal embedding API
  // Endpoint: https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal
  const base = c.endpoint.replace(/\/$/, "");
  const url = base.includes("/embeddings")
    ? base
    : `${base}/api/v3/embeddings/multimodal`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      model: c.model,
      input: texts.map((text) => ({ type: "text", text: text.slice(0, 8000) })),
    }),
  });

  if (!res.ok) throw new Error(`Volcengine API error: ${res.status}`);

  const data = (await res.json()) as {
    data: { embedding: number[] }[] | { embedding: number[] };
  };

  const rawItems = Array.isArray(data.data) ? data.data : [data.data];
  return rawItems.map((item) => item.embedding);
}

async function callOllama(
  c: EmbeddingSettings,
  texts: string[]
): Promise<number[][]> {
  // Ollama uses /api/embed (not OpenAI format)
  const base = c.endpoint.replace(/\/$/, "");
  const url = `${base}/api/embed`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: c.model,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });

  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);

  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

const PROVIDERS: Record<
  EmbeddingProvider,
  (c: EmbeddingSettings, texts: string[]) => Promise<number[][]>
> = {
  openai: callOpenAI,
  volcengine: callVolcengine,
  ollama: callOllama,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!isConfigured()) return null;
  const c = getConfig();
  try {
    const results = await PROVIDERS[c.provider](c, [text]);
    return results[0] ?? null;
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
    const results = await PROVIDERS[c.provider](c, texts);
    return results.map((r) => r ?? null);
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
