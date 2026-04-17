const CANDIDATE_RUBRIC = [
  {
    key: 'conceptual_mechanism',
    title: 'Conceptual Clarity & Mechanism',
    description:
      'Is the core idea psychologically sound, clearly targeting a mechanism of change (e.g., reappraisal, acceptance, values alignment, self-compassion)? Does it convey a distinct purpose users can intuitively grasp?',
    anchors:
      '1 = Fuzzy or motivational cliché · 2 = Aim stated but mechanism shaky · 3 = Plausible, evidence-aligned idea · 4 = Strong mechanism tied to user context · 5 = Exceptional clarity with explicit mechanism and rationale (rare).',
  },
  {
    key: 'cognitive_experiential_mix',
    title: 'Cognitive–Experiential Integration',
    description:
      'Does it balance reflection (“think”) and enactment (“do”) in a way that feels complete within ~20 minutes? Strong candidates invite both mental insight and a brief embodied, sensory, or creative act.',
    anchors:
      '1 = Purely text or discussion · 2 = Minor experiential nod · 3 = Balanced but modest reflection/action mix · 4 = Strong interplay with clear experiential lift · 5 = Immersive thought–action synergy that feels unique (rare).',
  },
  {
    key: 'engagement_diversity',
    title: 'Engagement Diversity & Novelty',
    description:
      'Does it introduce an engaging, curiosity-evoking element—something beyond journaling or reading—such as choice, story remixing, imagery, movement, audio, or micro-mission tasks that feel fresh yet purposeful?',
    anchors:
      '1 = Familiar writing-only task · 2 = Slight twist yet still standard · 3 = Noticeable variation but expected · 4 = Strongly distinctive, curiosity-sparking format · 5 = Bold, multisensory or interactive experience that remains purposeful (rare).',
  },
  {
    key: 'emotional_safety',
    title: 'Emotional Resonance & Safety',
    description:
      'Does it invite genuine feeling without risk of overwhelm? Users should feel emotionally touched, not destabilized; warmth and containment are key.',
    anchors:
      '1 = Unsafe or potentially distressing (drop) · 2 = Uneven containment · 3 = Generally safe but muted · 4 = Warm resonance with mindful guardrails · 5 = Deeply supportive, emotionally steady container (rare).',
  },
  {
    key: 'feasibility_context',
    title: 'Feasibility & Device Readiness',
    description:
      'Is the activity clearly doable on the anticipated device and context (e.g., mobile in short breaks, laptop during quiet time)? Strong candidates respect attention limits and technological realities.',
    anchors:
      '1 = Needs props/setup · 2 = Possible with notable friction · 3 = Feasible but requires attention · 4 = Smooth execution with minor caveats · 5 = Effortless, self-contained, and context-adaptive (rare).',
  },
  {
    key: 'potential_complementarity',
    title: 'Potential Complementarity',
    description:
      'Could this candidate meaningfully combine with others—creating contrast or synergy (e.g., reflective + active, cognitive + sensory) that could enhance the final flow?',
    anchors:
      '1 = Rigid or redundant · 2 = Overlaps existing angle · 3 = Neutral fit · 4 = Likely to pair well with specific contrasts · 5 = Clear synergy that would elevate a hybrid (rare).',
  },
  {
    key: 'lived_experience_coverage',
    title: 'Coverage of Lived-Experience Themes',
    description:
      'Does it address a distinct facet of the user’s lived experience surfaced in reflection (agency, emotion, social context, self-worth, uncertainty)?',
    anchors:
      '1 = Misses session themes · 2 = Light relevance only · 3 = Covers a familiar need · 4 = Tackles a meaningful but under-served theme · 5 = Adds crucial, differentiated coverage that rounds out the set (rare).',
  },
  {
    key: 'overall_promise',
    title: 'Overall Promise',
    description:
      'Taking all dimensions together, does this feel like a “keeper”? Consider originality, grounding, and emotional appeal. High scores indicate readiness for hybridization or direct use.',
    anchors:
      '1 = Drop immediately · 2 = Needs substantial overhaul · 3 = Reworkable but not unique · 4 = Worth advancing with tweaks · 5 = High-priority keeper with standout potential (rare).',
  },
];

const SELECTION_RUBRIC = [
  {
    key: 'conceptual_integration',
    title: 'Conceptual Integration',
    description:
      'Do the merged elements reinforce the same psychological logic (e.g., coping reframe → action → reflection) without theoretical clashes? The user should experience one coherent rationale throughout.',
    anchors:
      '1 = Conflicting or fragmented · 2 = Partial alignment with notable clashes · 3 = Mostly aligned but uneven · 4 = Strong through-line with minor tension · 5 = Seamless synthesis that amplifies the mechanism (rare).',
  },
  {
    key: 'narrative_flow',
    title: 'Narrative Coherence & Flow',
    description:
      'Does the hybrid unfold like a short, purposeful arc—orientation, engagement, resolution—where each step feels necessary and leads naturally to the next?',
    anchors:
      '1 = Choppy or disjointed · 2 = Loose ordering without purpose · 3 = Logical order but weak transitions · 4 = Strong flow with intentional pacing · 5 = Story-like arc with memorable continuity (rare).',
  },
  {
    key: 'cognitive_experiential_rhythm',
    title: 'Cognitive–Experiential Rhythm',
    description:
      'Is there a lively pacing between reflective and active moments? The rhythm should keep energy moving—neither dense introspection nor hollow action—but an alternating pattern that sustains focus.',
    anchors:
      '1 = Monotone or repetitive · 2 = Slight variation but stagnant · 3 = Functional yet predictable · 4 = Engaging alternation with good pacing · 5 = Dynamic rhythm that feels energizing and purposeful (rare).',
  },
  {
    key: 'engagement_synergy',
    title: 'Engagement Richness & Novelty',
    description:
      'Does combining the pieces elevate engagement—mixing sensory, narrative, or choice-based elements to create curiosity and delight without breaking coherence? The experience should feel richer than any single part.',
    anchors:
      '1 = Flat, text-heavy composite · 2 = Adds pieces but little lift · 3 = Some variation yet forgettable · 4 = Rich engagement with clear lift over inputs · 5 = Strikingly novel, multimodal flow that remains coherent (rare).',
  },
  {
    key: 'emotional_trajectory',
    title: 'Emotional Trajectory & Safety',
    description:
      'Does the emotional arc build intentionally—opening, deepening, and resolving in a contained way so users feel both moved and safe?',
    anchors:
      '1 = Abrupt or destabilizing · 2 = Emotional swings without closure · 3 = Mild affect with uneven closure · 4 = Intentional build and release with minor rough spots · 5 = Balanced intensity and containment producing emotional clarity (rare).',
  },
  {
    key: 'agency_micromastery',
    title: 'Agency & Micro-Mastery',
    description:
      'By the end, does the user experience a sense of agency or micro-success—something they created, realized, or achieved that signals competence?',
    anchors:
      '1 = Passive experience · 2 = Token choice without payoff · 3 = Some choice but limited ownership · 4 = Noticeable micro-win with guidance · 5 = Clear micro-achievement reinforcing capability and self-trust (rare).',
  },
  {
    key: 'situational_adaptability',
    title: 'Feasibility & Situational Adaptability',
    description:
      'Is the final hybrid realistically executable within ~20 minutes across devices and everyday conditions (e.g., short break, commute, limited privacy or bandwidth)? Does it adjust gracefully to user context?',
    anchors:
      '1 = Unrealistic or context-blind · 2 = Works in narrow scenario · 3 = Works in ideal settings · 4 = Generally practical with minor caveats · 5 = Effortless and context-aware across diverse situations (rare).',
  },
  {
    key: 'reflective_closure',
    title: 'Reflective Closure & Future Anchoring',
    description:
      'Does the ending consolidate meaning and prompt continuity—helping users articulate an insight, intention, or value connection that extends beyond the session?',
    anchors:
      '1 = Abrupt or generic end · 2 = Basic summary with little relevance · 3 = Some summary but no carry-through · 4 = Solid closure with minor gaps · 5 = Memorable closure that bridges to real-world application (rare).',
  },
];

function formatRubricForPrompt(rubric) {
  const body = rubric
    .map(
      (item, index) =>
        `${index + 1}. ${item.title} — ${item.description}\n   Score guidance: ${item.anchors}`,
    )
    .join('\n');
  return `${body}\n\nScoring discipline: Provide an integer 1–5 for every dimension. Treat 3 as the default “solid” score. Only award 4 when there is clear, specific evidence, and reserve 5 for truly exceptional cases with explicit justification.`;
}

module.exports = {
  CANDIDATE_RUBRIC,
  SELECTION_RUBRIC,
  formatRubricForPrompt,
};
