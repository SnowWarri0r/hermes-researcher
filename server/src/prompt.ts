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
// Budget: ~300 words output. This is a routing phase, not content.
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

Break down the user's goal into a research plan. You are NOT writing the report.

## User goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}${toolsetsBlock}

## Output format

1. **Reasoning** (under 100 words): how you're decomposing this.
2. **Plan JSON** in a \`\`\`json block:

\`\`\`json
{
  "sections": ["TL;DR", "Section B", "..."],
  "questions": [
    {"id": "Q1", "title": "specific question", "approach": "what to search/check"},
    {"id": "Q2", "title": "...", "approach": "..."}
  ]
}
\`\`\`

## Rules

- 3–7 sections. 3–6 questions. Each question independently investigable.
- If the goal is narrow/trivial, produce 1 question and 2 sections.
- Specific titles ("How does verl handle rollout?"), not vague ("Background").
- Valid JSON only.`;
}

// ---------------------------------------------------------------------------
// 2. RESEARCH — investigate ONE question. Budget: 300-800 words.
// ---------------------------------------------------------------------------
export function researchPrompt(opts: {
  goal: string;
  question: { id: string; title: string; approach: string };
  context: string;
}): string {
  return `# Research: ${opts.question.id} — ${opts.question.title}

Investigate this ONE question for a larger research task. Other workers handle other questions in parallel.

## Overall goal (context only)

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}

## Your question

**${opts.question.title}**

Approach: ${opts.question.approach}

## Output rules

- Produce raw **findings**, NOT a polished report section.
- Concrete facts, data, code examples, statistics. Cite URLs inline.
- Flag gaps or conflicting sources under "## Unresolved".
- **300–800 words max.** Be dense, not verbose. Every sentence should carry information.
- Do NOT repeat the question or goal in your output.`;
}

// ---------------------------------------------------------------------------
// Compress research findings for the draft phase
// ---------------------------------------------------------------------------
const MAX_FINDING_CHARS = 2000;

export function compressFindings(
  findings: { questionId: string; title: string; output: string }[]
): { questionId: string; title: string; output: string }[] {
  return findings.map((f) => {
    if (f.output.length <= MAX_FINDING_CHARS) return f;

    // Keep headings + first sentence per section + all bullet points + links
    const lines = f.output.split("\n");
    const kept: string[] = [];
    let budget = MAX_FINDING_CHARS;
    let afterHeading = false;

    for (const line of lines) {
      if (budget <= 0) break;
      const trimmed = line.trim();

      if (trimmed.startsWith("#")) {
        kept.push(line);
        budget -= line.length;
        afterHeading = true;
      } else if (afterHeading && trimmed.length > 0) {
        kept.push(line);
        budget -= line.length;
        afterHeading = false;
      } else if (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        /^\d+\./.test(trimmed)
      ) {
        kept.push(line);
        budget -= line.length;
      } else if (trimmed.match(/\[.*?\]\(https?:\/\//)) {
        kept.push(line);
        budget -= line.length;
      }
    }

    return {
      ...f,
      output: `[Condensed from ${f.output.length} chars]\n\n${kept.join("\n")}`,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. DRAFT — synthesize plan + compressed findings
// ---------------------------------------------------------------------------
export function draftPrompt(opts: {
  goal: string;
  context: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
  language?: string;
}): string {
  // Compress findings before injecting
  const compressed = compressFindings(opts.findings);
  const findingsBlock = compressed
    .map(
      (f) => `### ${f.questionId}: ${f.title}\n\n${f.output}`
    )
    .join("\n\n---\n\n");

  return `# Report drafting

Write a research report from these findings.

## Goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}

## Planned sections

${opts.plan.sections.map((s) => `- ${s}`).join("\n")}

## Research findings

${findingsBlock}

## Instructions

Synthesize findings into the planned sections. Preserve citations. Don't just concatenate — integrate.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// 4. CRITIQUE — budget: 300-500 words. Focused, not exhaustive.
// ---------------------------------------------------------------------------
export function critiquePrompt(opts: {
  goal: string;
  draft: string;
}): string {
  return `# Critique this report draft

## Goal it should address

${opts.goal}

## Draft

${opts.draft}

## Output

Produce a **concise** critique (300–500 words max). Focus on the top issues only:

1. **Content gaps** — what important aspects are missing?
2. **Weak claims** — which assertions lack evidence?
3. **Structure** — does the TL;DR actually summarize? Redundant sections?
4. **Citations** — missing or suspicious?

End with a **numbered priority fix list** (top 3–5 changes only). Skip categories with no real issues.

Be direct and specific. Don't pad with praise.`;
}

// Slim critique — used with conversation_history that already contains the draft
export function critiqueInstructionPrompt(opts: { goal: string }): string {
  return `# Critique the report I just produced

## Goal it should address

${opts.goal}

## Output

Produce a **concise** critique (300–500 words max). Focus on the top issues only:

1. **Content gaps** — what important aspects are missing?
2. **Weak claims** — which assertions lack evidence?
3. **Structure** — does the TL;DR actually summarize? Redundant sections?
4. **Citations** — missing or suspicious?

End with a **numbered priority fix list** (top 3–5 changes only). Skip categories with no real issues.

Be direct and specific. Don't pad with praise.`;
}

// ---------------------------------------------------------------------------
// 5. REVISE — incorporate critique
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
      ? `\n\nYou may use these toolsets for fact-checking if needed: ${opts.toolsets.join(", ")}`
      : "";

  return `# Final revision

Apply this critique to produce the final report.

## Goal

${opts.goal}${toolsetsBlock}

## Draft

${opts.draft}

## Critique

${opts.critique}

## Rules

- Output ONLY the final report. No meta-commentary about what changed.
- Address the priority fix list. Strengthen weak claims or remove them.
- The report must read as a standalone document.

${styleGuide(opts.language)}`;
}

// Slim revise — used with conversation_history that contains draft + critique
export function reviseInstructionPrompt(opts: {
  goal: string;
  toolsets: string[];
  language?: string;
}): string {
  const toolsetsBlock =
    opts.toolsets.length > 0
      ? `\n\nYou may use these toolsets for fact-checking if needed: ${opts.toolsets.join(", ")}`
      : "";

  return `# Final revision

Apply the critique above to produce the final report.

## Goal

${opts.goal}${toolsetsBlock}

## Rules

- Output ONLY the final report. No meta-commentary about what changed.
- Address the priority fix list. Strengthen weak claims or remove them.
- The report must read as a standalone document.

${styleGuide(opts.language)}`;
}

// ---------------------------------------------------------------------------
// Quick mode — single call
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
// Followup context
// ---------------------------------------------------------------------------
const MAX_PRIOR_REPORT_CHARS = 6000;

function condensePriorReport(report: string): string {
  if (report.length <= MAX_PRIOR_REPORT_CHARS) return report;

  const lines = report.split("\n");
  const summary: string[] = [];
  let charBudget = MAX_PRIOR_REPORT_CHARS;

  for (const line of lines) {
    if (charBudget <= 0) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      summary.push(line);
      charBudget -= line.length;
    } else if (
      summary.length > 0 &&
      summary[summary.length - 1].trim().startsWith("#") &&
      trimmed.length > 0
    ) {
      summary.push(line);
      charBudget -= line.length;
    } else if (
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      /^\d+\./.test(trimmed)
    ) {
      summary.push(line);
      charBudget -= line.length;
    }
  }

  return `[Condensed from ${report.length} chars]\n\n${summary.join("\n")}`;
}

export function followupContextPrompt(opts: {
  priorReport: string;
  followupMessage: string;
}): string {
  const condensed = condensePriorReport(opts.priorReport);

  return `### Prior report outline (condensed)

${condensed}

### Refinement request (INTERNAL — do not surface)

${opts.followupMessage}

Integrate the refinement naturally. Do NOT acknowledge this is a revision.`;
}

// ---------------------------------------------------------------------------
// Followup type detection — is this a minor tweak or a major revision?
// ---------------------------------------------------------------------------
export function isMinorRefinement(message: string): boolean {
  const lower = message.toLowerCase();
  const minorPatterns = [
    /fix\s+(typo|spelling|grammar|format)/,
    /改\s*(错字|格式|排版)/,
    /add\s+(a\s+)?link/,
    /加个?(链接|引用)/,
    /remove\s+(the\s+)?section/,
    /删(除|掉).{0,10}(章节|部分|段落)/,
    /rephrase/,
    /reword/,
    /换个说法/,
    /改写.{0,10}(句|段)/,
  ];
  return minorPatterns.some((p) => p.test(lower));
}

// ---------------------------------------------------------------------------
// Parse plan JSON
// ---------------------------------------------------------------------------
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
      const sections: string[] = parsed.sections
        .filter((s: unknown) => typeof s === "string")
        .slice(0, 10);
      const questions = parsed.questions
        .filter(
          (q: unknown) =>
            typeof q === "object" && q !== null && "title" in (q as object)
        )
        .slice(0, 8)
        .map(
          (
            q: { id?: string; title: string; approach?: string },
            i: number
          ) => ({
            id: q.id || `Q${i + 1}`,
            title: String(q.title),
            approach: String(
              q.approach || "Search web and cite primary sources."
            ),
          })
        );
      if (questions.length === 0) return null;
      return {
        sections:
          sections.length > 0
            ? sections
            : ["TL;DR", "Details", "References"],
        questions,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}
