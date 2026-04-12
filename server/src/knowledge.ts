import { store, db } from "./db.ts";
import { hermesChat } from "./hermes.ts";
import { getModelForPhase } from "./settings.ts";

/**
 * After a task completes, extract key findings into the knowledge base.
 */
export async function extractKnowledge(taskId: string): Promise<void> {
  const task = store.getTask(taskId);
  if (!task || !task.result) return;

  const model = getModelForPhase("critique");

  try {
    const { content } = await hermesChat({
      message: `Extract key knowledge from this research report. Output JSON only.

## Topic: ${task.goal}

## Report (truncated)
${task.result.slice(0, 8000)}

## Output (strict JSON in a \`\`\`json block)
\`\`\`json
{
  "entries": [
    {
      "topic": "specific topic name",
      "summary": "2-4 sentence factual summary",
      "sources": ["https://url1"]
    }
  ]
}
\`\`\`

Rules:
- 2-6 entries, each a distinct finding
- Topics: specific, searchable, include key terms and synonyms
- Summaries: factual, no meta-commentary
- Extract URLs from the report`,
      model,
    });

    const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
    if (!jsonBlock) return;

    const parsed = JSON.parse(jsonBlock[1]);
    if (!Array.isArray(parsed.entries)) return;

    for (const entry of parsed.entries.slice(0, 6)) {
      if (!entry.topic || !entry.summary) continue;
      await upsertKnowledge({
        taskId,
        topic: String(entry.topic),
        summary: String(entry.summary),
        sources: Array.isArray(entry.sources)
          ? entry.sources.map(String).slice(0, 10)
          : [],
      });
    }
  } catch {
    // Non-critical
  }
}

/**
 * Extract knowledge from a single research phase output (more granular).
 */
export async function extractPhaseKnowledge(
  taskId: string,
  questionTitle: string,
  phaseOutput: string
): Promise<void> {
  if (!phaseOutput || phaseOutput.length < 200) return;

  const model = getModelForPhase("critique");

  try {
    const { content } = await hermesChat({
      message: `Extract 1-2 key factual findings from this research output. JSON only.

## Research question: ${questionTitle}

## Findings
${phaseOutput.slice(0, 4000)}

\`\`\`json
{
  "entries": [
    {"topic": "specific topic", "summary": "1-2 sentence finding", "sources": ["url"]}
  ]
}
\`\`\`

Be precise. Only extract if there's a concrete, reusable finding.`,
      model,
    });

    const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
    if (!jsonBlock) return;

    const parsed = JSON.parse(jsonBlock[1]);
    if (!Array.isArray(parsed.entries)) return;

    for (const entry of parsed.entries.slice(0, 2)) {
      if (!entry.topic || !entry.summary) continue;
      await upsertKnowledge({
        taskId,
        topic: String(entry.topic),
        summary: String(entry.summary),
        sources: Array.isArray(entry.sources) ? entry.sources.map(String).slice(0, 5) : [],
      });
    }
  } catch {
    // Non-critical
  }
}

/**
 * Insert or merge knowledge entry. If a similar topic exists, merge summaries.
 */
async function upsertKnowledge(opts: {
  taskId: string;
  topic: string;
  summary: string;
  sources: string[];
}): Promise<void> {
  // Check for existing similar entry via FTS5
  const existing = store.searchKnowledge(opts.topic, 1);
  if (
    existing.length > 0 &&
    topicSimilarity(existing[0].topic, opts.topic) > 0.5
  ) {
    // Merge: append new info to existing summary if it adds value
    const merged = existing[0];
    if (merged.summary.includes(opts.summary.slice(0, 50))) return; // already covered

    const combinedSummary =
      merged.summary.length + opts.summary.length < 600
        ? `${merged.summary} ${opts.summary}`
        : merged.summary; // don't bloat

    const combinedSources = [
      ...new Set([...merged.sources, ...opts.sources]),
    ].slice(0, 10);

    // Update in place
    db.prepare(
      `UPDATE knowledge SET summary = ?, sources = ? WHERE topic = ? AND task_id = ?`
    ).run(combinedSummary, JSON.stringify(combinedSources), merged.topic, merged.taskId);

    // Rebuild FTS for this row
    const row = db
      .prepare(`SELECT id FROM knowledge WHERE topic = ? AND task_id = ?`)
      .get(merged.topic, merged.taskId) as { id: number } | undefined;
    if (row) {
      db.prepare(`DELETE FROM knowledge_fts WHERE rowid = ?`).run(row.id);
      db.prepare(
        `INSERT INTO knowledge_fts (rowid, topic, summary) VALUES (?, ?, ?)`
      ).run(row.id, merged.topic, combinedSummary);
    }
    return;
  }

  // Insert new
  store.addKnowledge({
    taskId: opts.taskId,
    topic: opts.topic,
    summary: opts.summary,
    sources: opts.sources,
    createdAt: Date.now(),
  });
}

/**
 * Cheap topic similarity: Jaccard on lowercased word sets.
 */
function topicSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Expand a goal into better FTS5 search terms using a cheap LLM call.
 * Returns multiple keyword groups for broader recall.
 */
export async function expandSearchQuery(goal: string): Promise<string[]> {
  const model = getModelForPhase("plan");

  try {
    const { content } = await hermesChat({
      message: `Given this research goal, produce 3-5 search keyword groups for finding related prior research. Each group should be 2-4 words. Include synonyms and related terms in different languages if relevant.

Goal: ${goal}

Output one group per line, nothing else. Example:
reinforcement learning PPO
RL policy optimization
强化学习 策略优化`,
      model,
    });

    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.length < 100)
      .slice(0, 5);
  } catch {
    // Fallback: just use the goal itself
    return [goal.slice(0, 80)];
  }
}

/**
 * Search knowledge base with LLM-expanded queries for better recall.
 */
export async function searchPriorKnowledge(goal: string): Promise<string> {
  try {
    const queries = await expandSearchQuery(goal);
    const allResults = new Map<
      string,
      { topic: string; summary: string; sources: string[]; taskId: string }
    >();

    for (const q of queries) {
      const cleaned = q.replace(/[^\w\s\u4e00-\u9fff]/g, " ").trim();
      if (!cleaned) continue;
      try {
        const results = store.searchKnowledge(cleaned, 3);
        for (const r of results) {
          if (!allResults.has(r.topic)) {
            allResults.set(r.topic, r);
          }
        }
      } catch {
        // FTS5 query might fail on some inputs
      }
    }

    if (allResults.size === 0) return "";

    const entries = [...allResults.values()].slice(0, 6);
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

/**
 * List all knowledge entries (for management UI).
 */
export function listAllKnowledge(): {
  id: number;
  taskId: string;
  topic: string;
  summary: string;
  sources: string[];
  createdAt: number;
}[] {
  const rows = db
    .prepare(
      `SELECT id, task_id, topic, summary, sources, created_at
       FROM knowledge ORDER BY created_at DESC LIMIT 200`
    )
    .all() as {
    id: number;
    task_id: string;
    topic: string;
    summary: string;
    sources: string;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    topic: r.topic,
    summary: r.summary,
    sources: JSON.parse(r.sources),
    createdAt: r.created_at,
  }));
}

/**
 * Delete a knowledge entry.
 */
export function deleteKnowledgeEntry(id: number): void {
  db.prepare(`DELETE FROM knowledge_fts WHERE rowid = ?`).run(id);
  db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
}
