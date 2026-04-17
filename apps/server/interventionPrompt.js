const { CORE_CHAT_INSTRUCTION } = require('./prompts');
const {
  CANDIDATE_RUBRIC,
  SELECTION_RUBRIC,
  formatRubricForPrompt,
} = require('./interventionRubrics');

const CANDIDATE_RUBRIC_TEXT = formatRubricForPrompt(CANDIDATE_RUBRIC);
const SELECTION_RUBRIC_TEXT = formatRubricForPrompt(SELECTION_RUBRIC);

const INTERVENTION_CANDIDATE_PROMPT = `
${CORE_CHAT_INSTRUCTION}

Stage: Brainstorm exactly one distinct 20-minute self-support plan based on the completed reflection.

Rubric dimensions (score each 1-5 with short justification; 3 = solid baseline; 5 = exceptional and rare):
${CANDIDATE_RUBRIC_TEXT}

Guidance:
• You will be called repeatedly; each call supplies "candidate_number", "slot_id", previously accepted "existing_candidates", and optional "feedback". When feedback appears, address every issue explicitly in the next response.
• "existing_candidates" includes summaries plus their high-scoring dimensions and top activity labels. Choose a new psychological route or experiential hook that is not redundant with those entries.
• The new plan must feel meaningfully different from every entry in "existing_candidates" (choose a new mechanism, modality, tone, or experiential hook).
• Keep activities feasible on a phone or laptop in ~20 minutes. Use the provided "slot_id" as a fallback for "plan_id" if you do not invent one.
• Scoring discipline: provide an integer 1, 2, 3, 4, or 5 for every rubric key. 3 represents a solid baseline; only award 4 with clear supporting evidence; 5 requires an outstanding, well-justified case.
• Populate the "scores" object with ALL of the following keys (exact spelling):
  {"conceptual_mechanism", "cognitive_experiential_mix", "engagement_diversity", "emotional_safety", "feasibility_context", "potential_complementarity", "lived_experience_coverage", "overall_promise"}.
• Ensure "score_notes" contains the same keys with 10–20 word justifications; never leave blanks or add extra keys.

Output JSON only:
{
  "candidate": {
    "plan_id": "candidate_a",
    "plan_title": "...",
    "summary": "...",
    "activities": [
      { "label": "...", "description": "...", "duration_minutes": 3 }
    ],
    "rationale": "...",
    "scores": { "conceptual_mechanism": 3, ... },
    "score_notes": { "conceptual_mechanism": "...", ... }
  }
}
`;

const INTERVENTION_SELECTION_PROMPT = `
${CORE_CHAT_INSTRUCTION}

Stage: Select or hybridize from the brainstormed candidates to deliver the final 20-minute plan.

Rubric dimensions (score final plan 1-5 with notes; 3 = solid baseline; 5 = exceptional and rare):
${SELECTION_RUBRIC_TEXT}

Input: reflection context + five candidate plans (with rationales and scores).

What to do:
1. Evaluate the candidates using the rubric. You may select one candidate fully or assemble a hybrid plan.
2. Provide selection_reasoning (4–6 sentences) that references specific session insights and explains the choice.
3. Output the final plan with:
   - plan_title
   - summary: 2–3 sentences grounding the plan in the reflection.
   - activities: ordered list of 2–5 items. Each requires label, description, duration_minutes, and reasoning (2–3 sentences tying it to the user’s needs). Encourage creative yet feasible modalities.
   - source_plan_ids: array of plan_id values that contributed to the final plan.
   - scores: object mapping each selection rubric key to an integer 1–5. Required keys (exact spelling): {"conceptual_integration", "narrative_flow", "cognitive_experiential_rhythm", "engagement_synergy", "emotional_trajectory", "agency_micromastery", "situational_adaptability", "reflective_closure"}.
   - score_notes: object mapping the same keys to concise 10–20 word justifications.
4. Keep total duration ≈20 minutes. Maintain a warm, supportive tone without therapeutic claims.
5. If "feedback" is provided in the input, resolve every noted issue before responding.

Output JSON only:
{
  "plan_title": "...",
  "summary": "...",
  "selection_reasoning": "...",
  "activities": [
    { "label": "...", "description": "...", "duration_minutes": 3, "reasoning": "..." },
    ...
  ],
  "source_plan_ids": ["candidate_a", ...],
  "scores": { "personal_fit": 5, ... },
  "score_notes": { "personal_fit": "...", ... }
}
`;

module.exports = {
  INTERVENTION_CANDIDATE_PROMPT: INTERVENTION_CANDIDATE_PROMPT.trim(),
  INTERVENTION_SELECTION_PROMPT: INTERVENTION_SELECTION_PROMPT.trim(),
  CANDIDATE_RUBRIC,
  SELECTION_RUBRIC,
};
