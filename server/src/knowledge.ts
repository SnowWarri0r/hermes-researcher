import { store } from "./db.ts";
import { hermesChat } from "./hermes.ts";
import { getModelForPhase } from "./settings.ts";

/**
 * After a task completes, extract key findings into the knowledge base.
 * Uses a cheap model call to summarize.
 */
export async function extractKnowledge(taskId: string): Promise<void> {
  const task = store.getTask(taskId);
  if (!task || !task.result) return;

  // Use critique model (cheap) for extraction
  const model = getModelForPhase("critique");

  try {
    const { content } = await hermesChat({
      message: `Extract key knowledge from this research report for a knowledge base. Output JSON only.

## Report topic
${task.goal}

## Report
${task.result.slice(0, 8000)}

## Output format (strict JSON in a \`\`\`json block)
\`\`\`json
{
  "entries": [
    {
      "topic": "specific topic name",
      "summary": "2-4 sentence summary of key finding",
      "sources": ["https://url1", "https://url2"]
    }
  ]
}
\`\`\`

Rules:
- 2-6 entries, each about a distinct finding
- Topics should be specific and searchable
- Extract URLs from the report as sources
- Summaries should be factual, not meta ("this report covers...")`,
      model,
    });

    const jsonBlock = content.match(/```json\s*([\s\S]*?)```/i);
    if (!jsonBlock) return;

    const parsed = JSON.parse(jsonBlock[1]);
    if (!Array.isArray(parsed.entries)) return;

    for (const entry of parsed.entries.slice(0, 6)) {
      if (!entry.topic || !entry.summary) continue;
      store.addKnowledge({
        taskId,
        topic: String(entry.topic),
        summary: String(entry.summary),
        sources: Array.isArray(entry.sources)
          ? entry.sources.map(String).slice(0, 10)
          : [],
        createdAt: Date.now(),
      });
    }
  } catch {
    // Non-critical — don't fail the task if extraction fails
  }
}

/**
 * Search knowledge base for relevant prior research on a goal.
 * Returns a context block to inject into the plan prompt.
 */
export function searchPriorKnowledge(goal: string): string {
  try {
    // Use first ~100 chars as FTS query, cleaned of special chars
    const query = goal
      .slice(0, 100)
      .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
      .trim();
    if (!query) return "";

    const results = store.searchKnowledge(query, 5);
    if (results.length === 0) return "";

    const block = results
      .map(
        (r) =>
          `- **${r.topic}**: ${r.summary}${
            r.sources.length > 0
              ? ` (sources: ${r.sources.slice(0, 3).join(", ")})`
              : ""
          }`
      )
      .join("\n");

    return `\n\n## Prior knowledge (from previous research tasks)\n\n${block}\n\nBuild on these findings where relevant. Don't re-research what's already known — go deeper or verify if outdated.`;
  } catch {
    return "";
  }
}
