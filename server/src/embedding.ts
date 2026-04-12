/**
 * Embedding client — calls any OpenAI-compatible /v1/embeddings endpoint.
 * Falls back gracefully: if not configured, returns null and callers use FTS5.
 */

const EMBEDDING_ENDPOINT =
  process.env.EMBEDDING_ENDPOINT || process.env.HERMES_ENDPOINT || "";
const EMBEDDING_API_KEY =
  process.env.EMBEDDING_API_KEY || process.env.HERMES_API_KEY || "";
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";

function isConfigured(): boolean {
  return Boolean(EMBEDDING_ENDPOINT && EMBEDDING_API_KEY);
}

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!isConfigured()) return null;

  try {
    const res = await fetch(
      `${EMBEDDING_ENDPOINT.replace(/\/$/, "")}/v1/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${EMBEDDING_API_KEY}`,
        },
        body: JSON.stringify({
          input: text.slice(0, 8000),
          model: EMBEDDING_MODEL,
        }),
      }
    );

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

  try {
    const res = await fetch(
      `${EMBEDDING_ENDPOINT.replace(/\/$/, "")}/v1/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${EMBEDDING_API_KEY}`,
        },
        body: JSON.stringify({
          input: texts.map((t) => t.slice(0, 8000)),
          model: EMBEDDING_MODEL,
        }),
      }
    );

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
