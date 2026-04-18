import type { Plan } from "../../shared/types.ts";

function styleGuide(language?: string): string {
  const langRule = language
    ? `\n- **Write the ENTIRE report in ${language}.** All headings, prose, labels, and descriptions must be in ${language}. Code, URLs, and proper nouns stay as-is.`
    : "";

  return `## Style rules

- Produce a **standalone research report** — an analyst's synthesis, not a news summary.${langRule}
- Do not address the reader directly ("you", "your", "let me know"). Write in third person.
- Do not offer follow-ups, apologize for limitations, or narrate your process.
- Do not include a closing sign-off.
- Use Markdown: \`##\` / \`###\` headings, bullet / numbered lists, tables, fenced code blocks with language tags.
- Lead with a "## TL;DR" section (1–3 sentences distilling the **main thesis**, not a topic list).
- Cite sources inline with Markdown links when making specific claims.

## Anti-patterns to avoid

- ❌ **Running account / 流水账**: "source A reported X. source B reported Y. source C reported Z." — this is aggregation, not analysis.
- ❌ **Each section = one source**: sections should be **themes** that cut across sources, not one-source-per-section.
- ❌ **Passive reporting**: "the article says..." / "some users discussed..." — make claims with authority.
- ❌ **Hedging without cause**: avoid "may", "might", "could potentially" unless the evidence genuinely warrants it.
- ❌ **Bullet-list-everything**: prose paragraphs for analysis; bullets only for discrete enumerable items.

## Required analytical moves

- **Signal vs noise**: explicitly call out what's new/important vs hype/repetition.
- **Cross-source synthesis**: when two or more sources touch a theme, combine their evidence into one paragraph. Cite all of them.
- **Contradictions**: if sources disagree, name the disagreement and take a stance when evidence permits.
- **Weak signals / implications**: go beyond what's literally in the findings — what does this mean for the reader, practically?
- **Numbers over adjectives**: prefer "58% improvement, 401 upvotes, $12M raise" over "significant", "popular", "well-funded".`;
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

Decompose the user's goal into a structured research plan. You are the planner, NOT the researcher — produce questions for other workers to investigate in parallel.

## User goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}${toolsetsBlock}

## Output format

1. **Reasoning** (under 150 words): identify the core dimensions of this goal (e.g. technical mechanism, comparative analysis, practical constraints, risk factors). Explain how you're splitting them into non-overlapping questions.
2. **Plan JSON** in a \`\`\`json block:

\`\`\`json
{
  "sections": ["TL;DR", "Section B", "..."],
  "questions": [
    {"id": "Q1", "title": "specific question", "approach": "concrete search strategy + data sources"},
    {"id": "Q2", "title": "...", "approach": "..."}
  ]
}
\`\`\`

## Rules for good questions

- **Non-overlapping**: each question covers a distinct angle. No two questions should return similar search results.
- **Actionable**: each question must be answerable by searching the web, reading docs, or running code. Avoid meta-questions like "What is the background?" or "Why is this important?"
- **Specific**: "What are the latency/throughput benchmarks of vLLM vs TGI on A100?" not "Compare inference frameworks".
- **Approach must be concrete**: name specific search queries, websites, APIs, or data sources. "Search GitHub issues for memory leak reports" not "investigate issues".
- **Cover multiple dimensions**: consider what/how/why/comparison/tradeoff/risk angles as appropriate for the goal.

## Rules for plan structure

- 3–7 sections. 3–6 questions.
- If the goal is narrow/trivial, produce 1 question and 2 sections.
- Sections should map to report headings, not mirror questions 1:1.
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

You are an analyst writing a synthesized report — not a news aggregator.

## Goal

${opts.goal}
${opts.context ? `\n## Context\n\n${opts.context}\n` : ""}

## Planned sections

${opts.plan.sections.map((s) => `- ${s}`).join("\n")}

## Research findings (raw input from parallel investigations)

${findingsBlock}

## How to synthesize

1. **Read all findings first**. Identify 3-5 **themes or insights** that cut across them.
2. **Each section = a theme, NOT a question**. If research question Q2 covered "Hugging Face models" and Q3 covered "arXiv papers", but both reveal "open models are pivoting to agent capabilities", that's ONE section, not two.
3. **Lead each section with the insight**, then support with evidence from multiple findings.
4. **TL;DR states the thesis** — what's the ONE most important takeaway the reader should walk away with? Not "we investigated X, Y, Z".
5. **Don't waste prose restating findings**. The reader will read your synthesis, not the raw findings — add interpretation, connections, and implications the findings didn't state directly.

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

1. **Running-account detection (流水账)** — are sections organized "one-source-per-section" instead of by theme? Does the draft just summarize each finding in sequence without synthesis? This is the #1 problem to flag.
2. **Weak thesis** — does the TL;DR state a clear takeaway, or just list what was investigated?
3. **Missing analysis** — where does the draft restate findings without adding interpretation, cross-source connection, or implications?
4. **Content gaps** — what important aspects are missing?
5. **Weak claims** — assertions that lack evidence or overhedge ("may", "could", "some").
6. **Citations** — missing on specific claims, or suspicious sources.

End with a **numbered priority fix list** (top 3–5 changes). For each, specify: which section needs work, what's wrong, and what the revised section should do differently.

Be direct and specific. Don't pad with praise.`;
}

// Slim critique — used with conversation_history that already contains the draft
export function critiqueInstructionPrompt(opts: { goal: string }): string {
  return `# Critique the report I just produced

## Goal it should address

${opts.goal}

## Output

Produce a **concise** critique (300–500 words max). Focus on the top issues only:

1. **Running-account detection (流水账)** — are sections organized "one-source-per-section" instead of by theme? Does the draft just summarize each finding in sequence without synthesis? This is the #1 problem to flag.
2. **Weak thesis** — does the TL;DR state a clear takeaway, or just list what was investigated?
3. **Missing analysis** — where does the draft restate findings without adding interpretation, cross-source connection, or implications?
4. **Content gaps** — what important aspects are missing?
5. **Weak claims** — assertions that lack evidence or overhedge ("may", "could", "some").
6. **Citations** — missing on specific claims, or suspicious sources.

End with a **numbered priority fix list** (top 3–5 changes). For each, specify: which section needs work, what's wrong, and what the revised section should do differently.

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
// B. Research adequacy gate — evaluate if findings cover the plan
// ---------------------------------------------------------------------------
export function researchAdequacyPrompt(opts: {
  goal: string;
  plan: Plan;
  findings: { questionId: string; title: string; output: string }[];
}): string {
  const findingsSummary = opts.findings
    .map((f) => `### ${f.questionId}: ${f.title}\n${f.output.slice(0, 600)}`)
    .join("\n\n");

  return `# Research adequacy check

Evaluate whether the research findings adequately cover the planned questions.

## Goal
${opts.goal}

## Planned questions
${opts.plan.questions.map((q) => `- ${q.id}: ${q.title}`).join("\n")}

## Findings (condensed)
${findingsSummary}

## Output (strict JSON)
\`\`\`json
{
  "adequate": true/false,
  "gaps": [
    {"questionId": "Q2", "issue": "only surface-level stats, no mechanism explanation"},
    {"questionId": "NEW", "title": "new question to investigate", "approach": "how to investigate"}
  ]
}
\`\`\`

Rules:
- "adequate" = true if ≥80% of questions have substantive findings (not just rephrased questions)
- Only flag real gaps — missing data, contradictions, or critical uncovered angles
- Max 3 gaps. If findings are good enough, return {"adequate": true, "gaps": []}
- NEW questions only if a critical angle was missed entirely`;
}

// ---------------------------------------------------------------------------
// D. Report quality self-evaluation — score after revise
// ---------------------------------------------------------------------------
export function reportQualityPrompt(opts: {
  goal: string;
  report: string;
}): string {
  return `# Report quality evaluation

Score this research report on a 1-10 scale.

## Goal
${opts.goal}

## Report
${opts.report.slice(0, 8000)}

## Output (strict JSON)
\`\`\`json
{
  "score": 7,
  "pass": true,
  "issues": ["issue 1 if any"]
}
\`\`\`

## Scoring guide
- 1-4: Major gaps, wrong information, or doesn't address the goal → pass=false
- 5-6: Addresses the goal but thin on evidence or missing key aspects → pass=false
- 7-8: Solid coverage with citations, minor improvements possible → pass=true
- 9-10: Exceptional depth and rigor → pass=true

Rules:
- Be honest, not generous. Most first drafts score 5-7.
- "pass" = true means acceptable to deliver. false means needs another revision.
- Max 3 issues, each under 20 words. Focus on fixable problems.
- If score ≥ 7, set pass=true even if minor issues exist.`;
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
