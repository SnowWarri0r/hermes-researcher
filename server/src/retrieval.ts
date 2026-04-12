/**
 * Hybrid retrieval: vector search + FTS5 keyword search, fused with
 * Reciprocal Rank Fusion (RRF), then optionally LLM-reranked.
 */
import { store } from "./db.ts";
import { getEmbedding, isEmbeddingConfigured } from "./embedding.ts";
import { hermesChat } from "./hermes.ts";
import { getModelForPhase } from "./settings.ts";

interface KnowledgeResult {
  topic: string;
  summary: string;
  sources: string[];
  taskId: string;
  score: number;
}

const RRF_K = 60; // RRF constant — standard value from the original paper

/**
 * Reciprocal Rank Fusion: merge ranked lists from different retrieval methods.
 * score(doc) = sum( 1 / (k + rank_i) ) for each list i where doc appears.
 */
function rrfFuse(
  ...rankedLists: KnowledgeResult[][]
): KnowledgeResult[] {
  const scores = new Map<string, { result: KnowledgeResult; score: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const key = `${item.taskId}:${item.topic}`;
      const rrfScore = 1 / (RRF_K + rank + 1);

      const existing = scores.get(key);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(key, { result: item, score: rrfScore });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ ...s.result, score: s.score }));
}

/**
 * Vector retrieval — returns ranked list.
 */
async function vectorRetrieve(
  query: string,
  limit: number
): Promise<KnowledgeResult[]> {
  if (!isEmbeddingConfigured()) return [];

  const embedding = await getEmbedding(query);
  if (!embedding) return [];

  return store.searchKnowledgeByVector(embedding, limit, 0.2);
}

/**
 * FTS5 keyword retrieval — multiple query variants for better recall.
 */
function keywordRetrieve(
  query: string,
  limit: number
): KnowledgeResult[] {
  const results = new Map<string, KnowledgeResult>();

  // Try multiple query strategies
  const queries = [
    // Original query
    query.slice(0, 100),
    // Individual significant words (>2 chars)
    ...query
      .split(/[\s,，。.;；!！?？]+/)
      .filter((w) => w.length > 2)
      .slice(0, 5),
  ];

  for (const q of queries) {
    const cleaned = q.replace(/[^\w\s\u4e00-\u9fff]/g, " ").trim();
    if (!cleaned) continue;
    try {
      for (const r of store.searchKnowledge(cleaned, limit)) {
        const key = `${r.taskId}:${r.topic}`;
        if (!results.has(key)) {
          results.set(key, { ...r, score: 0 });
        }
      }
    } catch {
      // FTS5 can fail on some inputs
    }
  }

  // FTS5 results are already ranked by BM25
  return [...results.values()].slice(0, limit);
}

/**
 * LLM reranker: given a query and candidate results, rerank by relevance.
 * Uses a cheap model. Returns indices in relevance order.
 */
async function llmRerank(
  goal: string,
  candidates: KnowledgeResult[],
  topK: number
): Promise<KnowledgeResult[]> {
  if (candidates.length <= topK) return candidates;

  const model = getModelForPhase("plan"); // cheapest

  try {
    const candidateList = candidates
      .map((c, i) => `[${i}] ${c.topic}: ${c.summary.slice(0, 150)}`)
      .join("\n");

    const { content } = await hermesChat({
      message: `Given this research goal, rank these knowledge entries by relevance. Return ONLY a comma-separated list of indices (most relevant first). No explanation.

Goal: ${goal}

Entries:
${candidateList}

Output (e.g.): 3,1,5,0`,
      model,
    });

    const indices = content
      .replace(/[^0-9,]/g, "")
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n >= 0 && n < candidates.length);

    // Deduplicate while preserving order
    const seen = new Set<number>();
    const reranked: KnowledgeResult[] = [];
    for (const idx of indices) {
      if (!seen.has(idx)) {
        seen.add(idx);
        reranked.push(candidates[idx]);
      }
      if (reranked.length >= topK) break;
    }

    return reranked;
  } catch {
    // Rerank failed — return top-K by original score
    return candidates.slice(0, topK);
  }
}

/**
 * Main retrieval function: hybrid search + RRF fusion + LLM rerank.
 */
export async function retrieveKnowledge(
  goal: string,
  opts?: { limit?: number; rerank?: boolean }
): Promise<KnowledgeResult[]> {
  const limit = opts?.limit ?? 6;
  const shouldRerank = opts?.rerank ?? true;
  const retrievalLimit = limit * 3; // over-fetch for fusion + reranking

  // Run vector + keyword retrieval in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    vectorRetrieve(goal, retrievalLimit),
    Promise.resolve(keywordRetrieve(goal, retrievalLimit)),
  ]);

  // Nothing found at all
  if (vectorResults.length === 0 && keywordResults.length === 0) {
    return [];
  }

  // RRF fusion
  const fused = rrfFuse(vectorResults, keywordResults);

  if (fused.length === 0) return [];

  // LLM rerank if enabled and we have enough candidates to be worth it
  if (shouldRerank && fused.length > limit) {
    return llmRerank(goal, fused.slice(0, limit * 2), limit);
  }

  return fused.slice(0, limit);
}

/**
 * Format retrieved knowledge for injection into prompts.
 */
export async function searchPriorKnowledge(goal: string): Promise<string> {
  try {
    const entries = await retrieveKnowledge(goal, { limit: 6, rerank: true });

    if (entries.length === 0) return "";

    const block = entries
      .map(
        (r) =>
          `- **${r.topic}**: ${r.summary}${
            r.sources.length > 0
              ? ` (sources: ${r.sources.slice(0, 2).join(", ")})`
              : ""
          }`
      )
      .join("\n");

    return `\n\n## Prior knowledge (from previous research)\n\n${block}\n\nBuild on these findings. Don't re-research known topics — go deeper or verify if outdated.`;
  } catch {
    return "";
  }
}
