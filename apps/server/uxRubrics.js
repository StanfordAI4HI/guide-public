const UX_FUNCTIONAL_GROUP = "Functional Fit";
const UX_INTERACTIVE_GROUP = "Interactive Clarity";
const UX_EMOTIONAL_GROUP = "Emotional Experience";
const PERSONALIZATION_GROUP = "Personalization";

const cloneRubrics = (rubrics = []) =>
  rubrics.map((item) => ({ ...item }));

const UX_RUBRIC = [
  {
    group: UX_FUNCTIONAL_GROUP,
    key: "query_interface_consistency",
    title: "Query Interface Consistency and Sequencing",
    description: `Definition: The extent to which the overall structure of the interface directly reflects the user's request and presents modules in a purposeful, stepwise order. This rubric evaluates macro-level alignment and flow, not micro-level wording or visual polish.
High-quality example (5): "User asks for a short reframing task. The interface opens with a brief context reminder, then one focused cognitive prompt, then a completion action."
Low-quality example (1): "User asks for reframing. The interface opens with a timer and unrelated breathing audio before presenting the reflection step."
What to check:
• Does the first visible screen match the user's request?
• Is there a clear beginning, middle, and end?
• Are modules ordered to support cognitive progression?
• Is the flow free of structural detours?`,
    anchors:
      "1 = Structurally mismatched and disordered · 2 = Partial alignment with awkward flow · 3 = Mostly aligned but sequencing could improve · 4 = Strong structural alignment and progression · 5 = Precisely aligned, intentional, and logically sequenced.",
  },
{
  group: UX_FUNCTIONAL_GROUP,
  key: "task_efficiency",
  title: "Task Efficiency and Input Burden",
  description: `Definition: The degree to which the task can be completed with minimal friction, minimal typing, and within the intended time window. This rubric evaluates effort cost and feasibility, not wording quality or structural logic.

High-quality example (5): "Two short steps, one brief typed response, finished in under 10 minutes without leaving the interface."

Low-quality example (1): "Multiple screens, long free-text entries, repeated confirmations, or external app switching required."

What to check:
• Total number of screens or transitions.
• Length and frequency of required typing.
• Whether structured options reduce typing when appropriate.
• Whether the activity fits the intended dose.
• Whether everything can be completed in-place.`,
  anchors:
    "1 = High friction and high effort · 2 = Noticeable burden or context switching · 3 = Moderate but acceptable effort · 4 = Low friction and efficient · 5 = Highly streamlined and fully self-contained.",
},

  {
    group: UX_INTERACTIVE_GROUP,
    key: "usability",
    title: "Usability",
    description: `Definition: The clarity and actionability of interactive controls at each step. This rubric focuses on affordances, navigation, and feedback rather than content structure or aesthetic tone.
High-quality example (5): "Primary action button is visually dominant. Labels are unambiguous. System confirms each input."
Low-quality example (1): "Ambiguous buttons, hidden controls, unclear next steps, or inconsistent gestures."
What to check:
• Visibility of the primary action.
• Specificity of button and control labels.
• Clear indication of what happens next.
• Immediate feedback after user input.
• Consistency of interaction patterns.`,
    anchors:
      "1 = Confusing and error prone · 2 = Some ambiguity in controls · 3 = Usable with minor friction · 4 = Clear and reliable · 5 = Intuitive and immediately actionable.",
  },
  {
    group: UX_INTERACTIVE_GROUP,
    key: "information_clarity",
    title: "Information Clarity",
    description: `Definition: The extent to which written content and layout reduce cognitive load through clear structure and scannable presentation. This rubric evaluates information organization, not personalization or tone.
High-quality example (5): "Short headline, brief instruction, grouped options, clear visual spacing."
Low-quality example (1): "Dense paragraphs, buried instructions, inconsistent tone, or overlapping messages."
What to check:
• Sentence length and chunking.
• Logical grouping of related content.
• Visual separation between sections.
• Avoidance of redundant or competing instructions.`,
    anchors:
      "1 = Dense and cognitively heavy · 2 = Some clutter or ambiguity · 3 = Understandable with effort · 4 = Well structured and readable · 5 = Exceptionally clear and lightweight.",
  },
  {
    group: UX_EMOTIONAL_GROUP,
    key: "interaction_satisfaction",
    title: "Interaction Satisfaction, Visual Coherence, and Closure",
    description: `Definition: The overall experiential quality once the activity ends, including emotional comfort, visual harmony, and clarity of completion. This rubric evaluates the end state and holistic feel, not task structure or content clarity.
High-quality example (5): "Clear completion message, smooth transition, consistent visual tone, and a reassuring sense of finish."
Low-quality example (1): "Ends abruptly with no confirmation, visual inconsistency, or unresolved states."
What to check:
• Clear indication the task is complete.
• Smoothness of transitions.
• Consistency of typography, spacing, and tone.
• Absence of unresolved or broken UI states.
• Whether the ending reinforces accomplishment.`,
    anchors:
      "1 = Abrupt, visually inconsistent, or unresolved · 2 = Weak closure or rough visual quality · 3 = Acceptable completion and coherence · 4 = Smooth and cohesive · 5 = Polished, reassuring, and clearly complete.",
  },
];


// Personalization rubrics reframed as UX qualities
const PERSONALIZATION_RUBRICS = [
  {
    group: PERSONALIZATION_GROUP,
    key: "personalization_specificity",
    title: "Context Specific Interface Fit",
    description: `Definition: The extent to which the interface visibly incorporates the user's specific situation through wording, examples, or UI choices. This rubric evaluates contextual grounding, not reading level.
High-quality example (5): "The prompt and button labels reuse the user’s phrase about the late night bug fix and reference the upcoming morning deadline."
Low-quality example (1): "Generic prompts that could belong to any user."
What to check:
• Are the user's phrases reused accurately?
• Are contextual constraints reflected?
• Is the situation referenced more than once?
• Does the interface feel moment-specific?`,
    anchors:
      "1 = Fully generic · 3 = Topic-level alignment only · 5 = Repeated, concrete contextual grounding.",
  },
  {
    group: PERSONALIZATION_GROUP,
    key: "personalization_understandable",
    title: "Plain Language and Local Framing",
    description: `Definition: The degree to which instructions use simple, everyday language while reflecting the user's own framing. This rubric evaluates vocabulary level and linguistic accessibility, not layout or personalization depth.
High-quality example (5): "Uses the user's own words and explains the step in one short, concrete sentence."
Low-quality example (1): "Abstract or technical phrasing disconnected from the user’s language."
What to check:
• Short, concrete sentences.
• Everyday vocabulary.
• No abstract or technical phrasing.
• Clear action in one pass.
• Language that mirrors the user's framing.`,
    anchors:
      "1 = Jargon-heavy and abstract · 3 = Mostly clear but somewhat complex · 5 = Very simple, direct, and grounded in user language.",
  },
];

// Full UX rubric including personalization as UX dimensions
const UX_FULL_RUBRIC = [...UX_RUBRIC, ...cloneRubrics(PERSONALIZATION_RUBRICS)];

const formatUxRubricForPrompt = (rubric = []) =>
  rubric
    .map(
      (item, index) =>
        `${index + 1}. [${item.group}] ${item.title} (${item.key})\n${item.description}\nAnchors: ${item.anchors}`,
    )
    .join('\n\n');

const UX_FULL_RUBRIC_TEXT = formatUxRubricForPrompt(UX_FULL_RUBRIC);

module.exports = {
  UX_FULL_RUBRIC,
  UX_FULL_RUBRIC_TEXT,
};
