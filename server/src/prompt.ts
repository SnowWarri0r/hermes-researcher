import type { Plan } from "../../shared/types.ts";

function styleGuide(language?: string): string {
  const langRule = language
    ? `\n- **Write the ENTIRE report in ${language}.** All headings, prose, labels, and descriptions must be in ${language}. Code, URLs, and proper nouns stay as-is.`
    : "";

  return `## Style rules

- Produce a **standalone research report**, not a conversational reply.${langRule}
- Do not address the reader directly ("you", "your", "let me know"). Write in third person.
- Do not offer follow-ups, apologize for limitations, or narrate your process.
- Do not include a closing sign-off.
- Use Markdown: \`##\` / \`###\` headings, bullet / numbered lists, tables, fenced code blocks with language tags.
- Lead with a "## TL;DR" section (1–3 sentences of key findings), then detailed sections.
- Cite sources inline with Markdown links when making specific claims.`;
}

// ---------------------------------------------------------------------------
// 1. PLAN — produce structured research plan as JSON
// ---------------------------------------------------------------------------
export function planPrompt(opts: {
  goal: string;
  context: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\nAvailable toolsets: ${opts.toolsets.join(", ")}`
      : "";
  return `# Research planning

You are the **planner** for a multi-phase deep-research pipeline. Your job is to break down the user's goal into a research plan. You are NOT writing the report — a later phase does that.

## User goal

${opts.goal}
${opts.context ? `\n## User-provided context\n\n${opts.context}\n` : ""}${toolsetsBlock}

## Your output

Produce TWO parts:

### Part 1 — Short reasoning (Markdown, under 200 words)

Briefly explain how you're decomposing the task — what are the core axes of investigation, what's tricky, what's ambiguous.

### Part 2 — Structured plan (strict JSON inside a \`\`\`json fenced block)

\`\`\`json
{
  "sections": ["Section A", "Section B", "..."],
  "questions": [
    {"id": "Q1", "title": "short focus question", "approach": "1 sentence on what to look for / which sources to check"},
    {"id": "Q2", "title": "...", "approach": "..."}
  ]
}
\`\`\`

### Constraints on the plan

- **sections**: 3–7 sections that the final report should contain. First is typically "TL;DR". Think about what the reader actually needs, not what's easy to fill.
- **questions**: 3–6 focused research questions. Each question should be investigable independently (will be run in parallel).
- Titles should be specific ("How does verl handle rollout scaling?"), not vague ("Background on verl").
- If the user's goal is narrow or trivial (e.g. "what day is today"), produce 1 question and 2 sections — don't over-engineer.

Output JSON must parse exactly. Don't add trailing commas or comments.`;
}

// ---------------------------------------------------------------------------
// 2. RESEARCH — investigate a single question, produce findings
// ---------------------------------------------------------------------------
export function researchPrompt(opts: {
  goal: string;
  question: { id: string; title: string; approach: string };
  context: string;
}): string {
  return `# Research thread: ${opts.question.id}

You are a research worker investigating ONE specific question in service of a larger research task. Another worker is handling other questions in parallel; a later phase will synthesize everything into a final report.

## Overall research goal (for context only)

${opts.goal}
${opts.context ? `\n## User-provided context\n\n${opts.context}\n` : ""}

## Your focus question

**${opts.question.title}**

Approach hint: ${opts.question.approach}

## Your output

Produce a **findings document** — your raw discoveries on this question. NOT a polished report section. Use Markdown.

- Gather concrete facts, data, code/config examples, quotes, statistics
- Include every URL you relied on with inline Markdown links \`[title](url)\`
- Flag any information gaps or conflicting sources
- Note which specific details belong in the final report's TL;DR if this question's findings warrant it
- Cover depth, not breadth — go deep on this one question; don't drift into adjacent topics

Aim for 300–1500 words. If you truly can't find solid info, say so explicitly with "## Unresolved" — don't fabricate.`;
}

// ---------------------------------------------------------------------------
// 3. DRAFT — synthesize plan + findings into full report
// ---------------------------------------------------------------------------
export function draftPrompt(opts: {
  goal: string;
  context: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
  language?: string;
}): string {
  const findingsBlock = opts.findings
    .map(
      (f) => `### Findings for ${f.questionId}: ${f.title}\n\n${f.output}`
    )
    .join("\n\n---\n\n");

  return `# Report drafting

You are writing the FIRST DRAFT of a research report based on findings collected by parallel research workers.

## Original goal

${opts.goal}
${opts.context ? `\n## User-provided context\n\n${opts.context}\n` : ""}

## Planned sections

${opts.plan.sections.map((s) => `- ${s}`).join("\n")}

## Raw findings from research phase

${findingsBlock}

## Your job

Produce the full report in Markdown. Follow the planned sections. Integrate findings naturally — synthesize, don't just concatenate. Preserve important citations from the findings (as inline Markdown links).

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// 4. CRITIQUE — self-critique of the draft
// ---------------------------------------------------------------------------
export function critiquePrompt(opts: {
  goal: string;
  draft: string;
}): string {
  return `# Self-critique

You are acting as a **strict peer reviewer** of a research report draft. Your job is to find what's weak, not to praise it.

## Original goal

${opts.goal}

## Draft to review

${opts.draft}

## Your output

Produce a Markdown critique with these sections (skip sections that genuinely have no issues):

### Content gaps
- What important aspects of the goal are missing, under-developed, or glossed over?

### Weak claims
- Which assertions lack evidence, citations, or specificity?
- Which claims feel hand-wavy, clichéd, or AI-generated?

### Structural issues
- Is the TL;DR actually the TL;DR, or does it bury the lede?
- Are sections in a logical order? Redundant sections?
- Does any section need splitting or merging?

### Clarity / tone
- Any passages that read conversational, self-referential, or like filler?
- Overused hedge language ("it depends", "various factors") that should be replaced with concrete answers?

### Citation / accuracy
- Missing or suspicious citations?
- Any factual claims likely wrong that should be double-checked?

### Prioritized fix list
- Number the top 3–8 concrete changes that would most improve this report, in priority order.

Be direct. A perfect draft is rare — assume there are real issues to find.`;
}

// ---------------------------------------------------------------------------
// 5. REVISE — incorporate critique into final report
// ---------------------------------------------------------------------------
export function revisePrompt(opts: {
  goal: string;
  context: string;
  draft: string;
  critique: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nAvailable toolsets if needed for fact-checking: ${opts.toolsets.join(", ")}`
      : "";
  return `# Final revision

You are producing the FINAL version of a research report by applying a critique to an earlier draft.

## Original goal

${opts.goal}
${opts.context ? `\n## User-provided context\n\n${opts.context}\n` : ""}${toolsetsBlock}

## Current draft

${opts.draft}

## Critique to apply

${opts.critique}

## Your job

Produce the **final report** — complete Markdown, incorporating the critique's prioritized fix list. Address weak claims, fill content gaps, restructure if needed, tighten language.

### Hard rules

- Output ONLY the final report. Do NOT include a "changes applied" summary or meta-commentary.
- Do NOT mention the critique or the fact that this is a revision.
- The report should read as a freshly-written standalone document.
- If the critique flagged a factual claim as suspicious, either fix it with a better source or remove it.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// Quick mode — single-call standalone report (no pipeline)
// ---------------------------------------------------------------------------
export function directReportPrompt(opts: {
  goal: string;
  context: string;
  toolsets: string[];
  language?: string;
  priorReport?: string;
  followupMessage?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nAvailable toolsets: ${opts.toolsets.join(", ")}`
      : "";

  let p = `# Research task\n\n${opts.goal}`;
  if (opts.context) p += `\n\n## Context\n\n${opts.context}`;
  p += toolsetsBlock;

  if (opts.priorReport && opts.followupMessage) {
    p += `\n\n## Prior report\n\n${condensePriorReport(opts.priorReport)}`;
    p += `\n\n## Refinement request (INTERNAL — silently integrate, do not surface)\n\n${opts.followupMessage}`;
    p += `\n\n## Hard rules\n\n- Output the full new report.\n- Do NOT acknowledge this is a revision.`;
  }

  p += `\n\n${styleGuide(opts.language)}`;
  return p;
}

// ---------------------------------------------------------------------------
// Followup — produce a new pipeline turn based on a revision request
// ---------------------------------------------------------------------------
const MAX_PRIOR_REPORT_CHARS = 6000;

function condensePriorReport(report: string): string {
  if (report.length <= MAX_PRIOR_REPORT_CHARS) return report;

  // Extract headings + first sentence of each section as a structural summary
  const lines = report.split("\n");
  const summary: string[] = [];
  let charBudget = MAX_PRIOR_REPORT_CHARS;

  for (const line of lines) {
    if (charBudget <= 0) break;
    const trimmed = line.trim();
    // Always keep headings
    if (trimmed.startsWith("#")) {
      summary.push(line);
      charBudget -= line.length;
    }
    // Keep first non-empty line after a heading (topic sentence)
    else if (
      summary.length > 0 &&
      summary[summary.length - 1].trim().startsWith("#") &&
      trimmed.length > 0
    ) {
      summary.push(line);
      charBudget -= line.length;
    }
    // Keep bullet points (they carry structure)
    else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\./.test(trimmed)) {
      summary.push(line);
      charBudget -= line.length;
    }
  }

  return `[Condensed from ${report.length} chars — headings, topic sentences, and key points preserved]\n\n${summary.join("\n")}`;
}

export function followupContextPrompt(opts: {
  priorReport: string;
  followupMessage: string;
}): string {
  const condensed = condensePriorReport(opts.priorReport);

  return `### Prior report outline (condensed for context — not visible to final reader)

${condensed}

### User's refinement request (INTERNAL — silently integrate, do not surface)

${opts.followupMessage}

Produce the next version of the report. Integrate the refinement request naturally. Do NOT acknowledge this is a revision; do NOT describe what changed.`;
}

// Parse plan JSON out of an LLM response ------------------------------------
export function parsePlan(raw: string): Plan | null {
  const jsonBlock = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = jsonBlock ? jsonBlock[1] : raw;
  try {
    const parsed = JSON.parse(candidate);
    if (
      parsed &&
      Array.isArray(parsed.sections) &&
      Array.isArray(parsed.questions)
    ) {
      // Normalize
      const sections: string[] = parsed.sections
        .filter((s: unknown) => typeof s === "string")
        .slice(0, 10);
      const questions = parsed.questions
        .filter(
          (q: unknown) =>
            typeof q === "object" && q !== null && "title" in (q as object)
        )
        .slice(0, 8)
        .map((q: { id?: string; title: string; approach?: string }, i: number) => ({
          id: q.id || `Q${i + 1}`,
          title: String(q.title),
          approach: String(q.approach || "Search web and cite primary sources."),
        }));
      if (questions.length === 0) return null;
      return {
        sections: sections.length > 0 ? sections : ["TL;DR", "Details", "References"],
        questions,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}
