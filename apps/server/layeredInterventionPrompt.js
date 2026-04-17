const THEORY_ALIGNMENT_GROUP = 'Theory Alignment';
const PERSONALIZATION_GROUP = 'Personalization';
const ENGAGEMENT_GROUP = 'Engagement';

const cloneRubrics = (rubric) => rubric.map((dim) => ({ ...dim }));

// const COGNITIVE_DESIGN_PRINCIPLES = [
//   // PERSONALIZATION: Specificity
//   "Reuse at least two exact phrases, details, or constraints the user mentioned. \
// These must appear word-for-word or paraphrased closely so the activity could only belong to them.",
  
//   // PERSONALIZATION: Feasibility
//   "All steps must be fully executable inside user's environment and their current device.\
//   Total duration must remain under 10 minutes.",

//   // THEORY ALIGNMENT: Cognitive Shift
//   "Create a visible before → after contrast. Require the user to write or reflect on one sentence \
// capturing their old interpretation and one sentence representing a revised interpretation \
// connected to a named principle (reappraisal, values clarification, self-compassion).",

//   // THEORY ALIGNMENT: Clear Principle Connection
//   "Name the psychological principle explicitly and guide the user through its exact method. \
// For example: 'This uses reappraisal. Rewrite the meaning of the situation using your own evidence.'",

//   // ENGAGEMENT: Non-Retrievability
//   "Combine the user’s specific context with an unexpected container or framing \
// so the prompt cannot resemble a common journaling assignment or Googleable advice.",

//   // ENGAGEMENT: Enjoyment
//   "Use light imaginative framing or playful structure that feels like a mini creative challenge \
// rather than a worksheet, while remaining doable for someone with low energy.",
// ];

// const EXPERIENTIAL_DESIGN_PRINCIPLES = [
//   // PERSONALIZATION: Specificity
//   "Reference the user’s real physical or digital environment at least twice. \
// Use their described spaces, routines, tools, or timing ('shared workspace shelf', '11 p.m. build').",

//   // PERSONALIZATION: Feasibility
//   "All actions must be executable on the user's current device within 10 minutes \
// without switching apps, relocating, needing materials, or requiring silence.",

//   // THEORY ALIGNMENT: Skill Practice Enablement
//   "Name the skill being practiced (grounding, behavioral activation, savoring, exposure) \
// and design the action so the user performs the exact steps of that skill within the activity.",

//   // THEORY ALIGNMENT: Clear Principle Connection
//   "Tie the action to a specific experiential mechanism. Example: \
// 'This is grounding: collect one sound, one sight, and one texture from where you are.'",

//   // ENGAGEMENT: Non-Retrievability
//   "Create an action that cannot appear in a generic 'stress relief tips' list by \
// mixing the user’s context with a distinctive, yet feasible action format.",

//   // ENGAGEMENT: Enjoyment
//   "End the activity with a small, tangible win that feels satisfying to complete \
// (text snippet, quick photo, brief voice memo) and keep tone warm, simple, and low-pressure.",
// ];

const COGNITIVE_DESIGN_PRINCIPLES = [
  // PERSONALIZATION: Specificity
  "Integrate at least three elements from the user's own account, such as their stress description, contextual details, main reasons for the difficulty, or the involvement of other people. The activity should feel like a distinctive creative challenge written specifically for this user. The concept blends the user's own phrases or settings with a genuine psychological technique so it avoids resembling common online prompts. \
These anchors ensure the reflective task is tied directly to the situation the user described rather than a generic scenario.",

  // PERSONALIZATION: Feasibility
  "All reflective steps must be executable within the user's current environment using their device. Responses may be typed, spoken aloud, or recorded briefly. If a step asks for recording, the instruction must request recording only (no type-or-record wording). \
The total duration must remain within twenty minutes.",

  // THEORY ALIGNMENT: Cognitive Mechanism (Multiple Valid Forms)
  "Guide the user through a change in understanding. This may involve clarification, organization, evaluation, or reinterpretation. Valid mechanisms include reappraisal, attribution rebalancing, distancing, evidence testing, cost benefit analysis, values clarification, or hypothesis generation. \
The mechanism must be explicit and central to the step.",

  // THEORY ALIGNMENT: Structured Cognitive Outcome
  "Produce a visible output that captures the shift or clarification in thought. This may take the form of a refined interpretation, a categorized list, a single clarified sentence, a competing explanation, or a reframed summary. \
The structure must help the user see their thinking with greater precision.",

  // ENGAGEMENT: Distinctive Reflective Frame
  "Shape the reflective step through a distinctive frame that elevates it beyond a generic journaling prompt. \
Examples include a time jump, a perspective swap, a simple analytic device such as an evidence ledger, or a narrator shift that makes the reasoning task concrete.",

  // ENGAGEMENT: Cognitive Playfulness and Accessibility
  "Use a light conceptual hook that makes the analytic task approachable, such as labeling thought types, trying on an alternative mental model, or isolating one specific question. \
Maintain clarity and keep the focus on reasoning rather than emotional flourish.",

  // SCOPE NOTE: Non Exhaustive Examples
  "Examples are illustrative and not limiting. \
Other cognitive mechanisms or reflective structures may be used when they support clarity, interpretation, or meaningful mental organization.",
];

const EXPERIENTIAL_DESIGN_PRINCIPLES = [
  // PERSONALIZATION: Specificity
  "Ground the action in at least three elements from the user's own account, such as their stress description, contextual details, main reasons for the difficulty, or the involvement of other people. The activity should feel like a distinctive creative challenge written specifically for this user. The concept blends the user's own phrases or settings with a genuine psychological technique so it avoids resembling common online prompts. \
These details must shape the behavioral step so the action responds directly to the situation the user described.",

  // PERSONALIZATION: Feasibility
  "All actions must be executable within the user's current environment using their device without moving spaces, switching apps, or gathering materials. Outputs may include one typed line, one brief spoken reflection, one short voice memo, or one observable micro action. If a step asks for a voice memo, request recording only and do not offer typing as an alternative. \
Keep total duration within twenty minutes.",

  // THEORY ALIGNMENT: Behavioral Mechanism
  "Center the activity on a specific behavioral skill such as graded exposure, micro action planning, implementation intentions, problem decomposition, assumption testing, or communication rehearsal. \
The mechanism must be enacted in real time rather than described.",

  // THEORY ALIGNMENT: Action Fidelity
  "Ensure that the user performs the core unit of the skill during the activity. \
This may involve rehearsing one sentence, selecting one next non zero action, testing an assumption with a small probe, or setting one concrete cue.",

  // ENGAGEMENT: Distinctive Behavioral Format
  "Design an action sequence that cannot appear in a generic stress relief list by combining the user's details with a focused behavioral move, \
such as drafting one line they could send, rehearsing a response for a forthcoming interaction, or capturing one cue tied to their situation.",

  // ENGAGEMENT: Micro Mastery
  "End with a small, measurable output that signals completion, such as a saved note, a practiced line, or a one step plan. \
The feeling of closure should come from having performed a behavior rather than reflection.",

  // SCOPE NOTE: Non Exhaustive Examples
  "Examples illustrate possible approaches and are not limiting. \
Other behavioral mechanisms or action formats may be used when they support real time practice or enactment.",
];


// const PERSONALIZATION_RUBRICS = [
//   {
//     group: PERSONALIZATION_GROUP,
//     key: 'personalization_specificity',
//     title: 'Specificity & Context Echo',
//     description: `Definition: Instructions reuse the user's own phrases, rituals, or constraints at least twice so the activity could only belong to them (e.g., "after the 11 p.m. pager buzz" or "with the studio lights already dim"). High-quality example (5): "Rewrite yesterday's '2:07 a.m. bug fix' note as a pep talk you'd send before the 6 a.m. daycare drop." Low-quality example (1): "Describe a recent stressful task." (Could be anyone.) What to check: Do we echo their vocabulary and real environment in multiple spots?`,
//     anchors:
//       `1 = Generic wording that fits anyone. · 3 = References the general topic but not their exact details. · 5 = Quotes or paraphrases unique phrases, locations, or rhythms at least twice.`,
//   },
//   {
//     group: PERSONALIZATION_GROUP,
//     key: 'personalization_feasibility',
//     title: 'Everyday Feasibility',
//     description: `Definition: Steps stay on the user's current device and can wrap within ~10 minutes where they already are; no props, app switching, or special privacy required. High-quality example (5): "Still at the shared desk? Type three bullet memories in this chat, then set a 90-second timer on your phone to read them aloud." Low-quality example (1): "Print this worksheet and find a quiet room." What to check: Could they complete everything now using only this chat plus built-in sensors?`,
//     anchors:
//       `1 = Needs supplies, new locations, or extra software. · 3 = Mostly doable but hints at friction. · 5 = One-device, no-friction flow with explicit pacing cues.`,
//   },
//   {
//     group: PERSONALIZATION_GROUP,
//     key: 'personalization_understandable',
//     title: 'Understandable to Everyday Users',
//     description: `Definition: The wording sounds like something a thoughtful friend would say—not a therapy manual. Plain verbs, short sentences, and concrete cues make it obvious what to do (and why) without prior psychology knowledge. High-quality example (5): "🧠 Rename the buzzing thought as 'the 2 a.m. smoke alarm'—write one sentence about what it's warning you about." Low-quality example (1): "Engage in cognitive reappraisal of antecedent schemas." What to check: Could someone tired and non-technical follow this instantly?`,
//     anchors:
//       `1 = Dense jargon or ambiguous directions. · 3 = Mostly clear but still leans on insider terms. · 5 = Everyday language with vivid anchors and zero jargon.`,
//   },
// ];
const PERSONALIZATION_RUBRICS = [
  {
    group: PERSONALIZATION_GROUP,
    key: "personalization_specificity",
    title: "Specificity and Context Echo",
    description: `Definition: Instructions reuse the user's own phrases, routines, or constraints at least twice so the activity clearly belongs to their situation.  
High-quality example (5): "Rewrite yesterday's '2:07 a.m. bug fix' note as a pep talk you would send before the 6 a.m. daycare drop."  
Low-quality example (1): "Describe a recent stressful task." This could apply to anyone.  
What to check: Does the activity echo the user's vocabulary, setting, or timing in more than one location?`,
    anchors:
      `1 = Entirely generic. · 3 = Refers to the topic but not the user's details. · 5 = Uses distinctive phrases, locations, or rhythms from the user at least twice.`,
  },
  {
    group: PERSONALIZATION_GROUP,
    key: "personalization_non_retrievability",
    title: "Distinctive Personalization (Non-Retrievability)",
    description: `Definition: The activity should feel uniquely tailored to the user’s situation in ways that would not make sense for someone else. It should reuse the user’s phrases, constraints, or setting so the prompt cannot be easily reused outside this context.  
High-quality example (5): "Rewrite yesterday’s '2:07 a.m. bug fix' note as a pep line you will read before the 6 a.m. daycare drop."  
Low-quality example (1): "List three things that went well today."  
What to check: Would this activity still make sense without the user’s exact context and language?`,
    anchors:
      `1 = Generic and widely reusable. · 3 = Some contextual cues but still general. · 5 = Strongly tied to the user’s unique phrases, timing, or constraints.`,
  },
  {
    group: PERSONALIZATION_GROUP,
    key: "personalization_feasibility",
    title: "Everyday Feasibility",
    description: `Definition: All steps can be completed on the user's current device within approximately ten minutes. The activity must avoid props, app switching, and the need for a new location. The user should be able to complete the activity immediately.  
High-quality example (5): "If you are still at the shared desk, type three brief memories in this chat and set a ninety second timer on your phone to read them aloud."  
Low-quality example (1): "Print this worksheet and find a quiet room."  
What to check: Can the user complete the entire activity now using only this chat and built-in device functions?`,
    anchors:
      `1 = Requires materials, new locations, or software. · 3 = Mostly feasible but introduces friction. · 5 = Smooth one-device flow with clear pacing cues.`,
  },
  {
  group: PERSONALIZATION_GROUP,
  key: "personalization_understandable",
  title: "Understandable to Everyday Users",
  description: `Definition: Guidance should feel personally written for the user while remaining easy to follow at about a 4th-grade English reading level. Wording stays grounded in plain language, uses short and concrete instructions, and reflects details from the user’s situation in a way that feels natural. The activity should read like support from a thoughtful peer who understands the user’s context rather than a technical or clinical script.  
High-quality example (5): "Take the phrase you used about the buzzing thought and rename it as 'the 2 a.m. smoke alarm.' Write one sentence about what it is warning you about." This uses the user’s own phrasing and stays simple.  
Low-quality example (1): "Engage in cognitive reappraisal of antecedent schemas." This is abstract and impersonal.  
What to check: Would a tired or non-technical user understand this immediately, and does the wording clearly reflect their own context?`,
  anchors:
    `1 = Impersonal or jargon heavy. · 3 = Mostly clear but still generic or technical. · 5 = Plain, personal, and easy for any user to follow.`,
  },

//   {
//     group: PERSONALIZATION_GROUP,
//     key: "personalization_understandable",
//     title: "Understandable to Everyday Users",
//     description: `Definition: Wording should sound like clear guidance from a thoughtful peer rather than a clinical manual. Instructions use plain verbs, short sentences, and concrete cues that do not require prior psychological knowledge.  
// High-quality example (5): "Rename the buzzing thought as 'the 2 a.m. smoke alarm' and write one sentence about what it warns you about."  
// Low-quality example (1): "Engage in cognitive reappraisal of antecedent schemas."  
// What to check: Could a tired or non-technical user follow these directions immediately?`,
//     anchors:
//       `1 = Dense jargon or unclear directions. · 3 = Mostly clear but still uses insider terminology. · 5 = Completely plain language with vivid anchors and no jargon.`,
//   },
];


const ENGAGEMENT_RUBRICS = [];

// const ENGAGEMENT_RUBRICS = [
//   {
//     group: ENGAGEMENT_GROUP,
//     key: 'engagement_non_retrievability',
//     title: 'Non-Retrievability (Distinctive, Not Searchable)',
//     description: `Definition: The activity’s concept, tone, or format should feel like a one-off creative dare written just for this user. It should blend their phrases, settings, or humor with a real psychological technique so it reads more like “the fun thing my coach texted me” than a worksheet. Think surprising-but-sound: if it makes you grin *and* you can trace the mechanism, you’re there.

//     High-quality example (5): "Remix your stress as a 10-second trailer—title card, tagline, one ridiculous critic quote."  
//     Low-quality example (1): "List three things that went well today."  
//     What to check: Could someone find this verbatim on page one of Google, or does it only make sense with the user's story?  
//     Key heuristic: If it’s weirdly specific yet psychologically grounded, score it high.`,
//     anchors:
//       `1 = Common worksheet prompt. · 3 = Slight twist but still familiar. · 5 = Distinctive blend of the user's world + theory; feels invented for them.`,
//   },
//   {
//     group: ENGAGEMENT_GROUP,
//     key: 'engagement_enjoyment',
//     title: 'Enjoyment & Energy Lift (Micro-Game Feel)',
//     description: `Definition: The tone, rhythm, and medium should spark curiosity or play. The task ought to feel like a micro-experiment, creative dare, or expressive stunt someone would *want* to try during a short break (and maybe brag about later). It turns effort into exploration—using sound, imagery, movement, or humor—so emotional energy rises instead of draining.

//     High-quality example (5): "Record a one-minute weather report for your mood—forecast, clouds, and the odd sunny break."  
//     Low-quality example (1): "Reflect on how you feel right now."  
//     What to check: Would this sound fun or clever to do? Does it offer a quick payoff through voice, image, or sensation?  
//     Key heuristic: If it feels like a tiny game with a smile baked in, it deserves a high score.`,
//     anchors:
//       `1 = Heavy, clinical, or repetitive. · 3 = Neutral but tolerable. · 5 = Playful or imaginative with a quick reward (voice, image, or tiny win).`,
//   },
// ];

const COGNITIVE_LAYER_RUBRIC = [
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_cognitive_shift',
    title: 'Cognitive Shift',
    description: `Definition: The prompt explicitly guides the user to contrast an old and new perspective ("before -> after") or extract a value-based takeaway that can be written out or spoken aloud. High-quality example (5): "Write one sentence your future self would tell you about this deadline -- 'I care because it shows craft.'" Low-quality example (1): "Describe how you feel right now." (No shift or interpretation.) What to check: Does the output demonstrate an actual reappraisal or reframing, not just narration?`,
    anchors:
      `1 = Pure narration or venting. · 3 = Hints at a shift but never states it. · 5 = Clear before/after or value statement captured in a reusable sentence.`,
  },
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_small_progress',
    title: 'Small Progress (Micro-Win)',
    description: `Definition: The activity should end with a concrete, minimal outcome that signals progress within the session. That outcome can be reflective (a clarified sentence, a named emotion, a reframe, a decision) or action-based (a practiced line, a tiny plan step). The point is a clear, usable output that marks forward movement. High-quality example (5): "Write one sentence that captures the shift you want to carry forward, then choose where you’ll place it." Low-quality example (1): "Think about how you feel." (No defined output.) What to check: Does the user finish with a specific, tangible takeaway—even if it’s reflective?`,
    anchors:
      `1 = No concrete outcome. · 3 = Outcome exists but is vague or optional. · 5 = Clear, specific takeaway or micro-action tied to the mechanism.`,
  },
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_clear_connection',
    title: 'Clear Theory Connection',
    description: `Definition: The activity names and correctly applies a known cognitive mechanism (reappraisal, self-compassion, values clarification, parts work). Each step shows how to practice the skill in plain language that anyone could follow. High-quality example (5): "This uses self-compassion: write a gentle note you'd usually send to your exhausted teammate, but send it to yourself." Low-quality example (1): "Think more positively." (No theoretical grounding.) What to check: Is the mechanism explicit, and are the directions traceable to that principle?`,
    anchors:
      `1 = Mechanism missing or inaccurate. · 3 = Implied but vague. · 5 = Named technique plus concrete instructions for enacting it.`,
  },
  ...cloneRubrics(PERSONALIZATION_RUBRICS),
];

const EXPERIENTIAL_LAYER_RUBRIC = [
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_skill_enablement',
    title: 'Skill Practice Enablement',
    description: `Definition: The activity allows the user to practice a coping or behavioral skill in real time (not just plan to do it later) and shows how to reuse it. High-quality example (5): "Practice the three-breath reset now -- inhale, name one value this moment protects, exhale slowly. Try it before your next meeting." Low-quality example (1): "Take deep breaths when stressed." (No in-the-moment rehearsal.) What to check: Does the user actually do the skill inside the chat?`,
    anchors:
      `1 = Only planning or advice. · 3 = Partial rehearsal without clarity. · 5 = Full enactment with cues for repetition.`,
  },
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_small_progress',
    title: 'Small Progress (Micro-Win)',
    description: `Definition: The activity should end with a concrete, minimal outcome that signals progress within the session. That outcome can be reflective (a clarified sentence, a named emotion, a reframe, a decision) or action-based (a practiced line, a tiny plan step). The point is a clear, usable output that marks forward movement. High-quality example (5): "Write one sentence that captures the shift you want to carry forward, then choose where you’ll place it." Low-quality example (1): "Think about how you feel." (No defined output.) What to check: Does the user finish with a specific, tangible takeaway—even if it’s reflective?`,
    anchors:
      `1 = No concrete outcome. · 3 = Outcome exists but is vague or optional. · 5 = Clear, specific takeaway or micro-action tied to the mechanism.`,
  },
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: 'theory_alignment_clear_connection',
    title: 'Clear Theory Connection',
    description: `Definition: The activity identifies and follows a behavioral or experiential mechanism (behavioral activation, grounding, savoring, exposure) and operationalizes it in steps that fit within ten minutes. High-quality example (5): "This is grounding -- collect one sound, one sight, and one texture that prove you're steady right now." Low-quality example (1): "Calm down for a bit." (Mechanism implied but absent.) What to check: Is the behavioral science principle explicit and enacted correctly?`,
    anchors:
      `1 = Mechanism missing or inaccurate. · 3 = Implied but vague. · 5 = Named technique plus concrete instructions for doing it now.`,
  },
  ...cloneRubrics(PERSONALIZATION_RUBRICS),
];

// const INTEGRATION_LAYER_THEORY = [
//   {
//   group: THEORY_ALIGNMENT_GROUP,
//   key: 'theory_alignment_narrative_flow',
//   title: 'Narrative Flow',
//   description: `Definition: The reflection, action, or hybrid pieces form one clear and continuous experience. Each part connects smoothly to the next, creating a single thread the user can follow. The steps feel related by purpose, tone, and content rather than stitched together.

// High-quality example (5): "Take the line you wrote about 'small wins' and speak it aloud once as a short message to your future self." (The action grows directly from the reflection.)

// Low-quality example (1): "Write about stress. Then take a walk." (No shared theme, no linking detail, no continuity.)

// What to check: Do the pieces feel like parts of one small story or moment? Does each element pick something up from the previous one?`,
//   anchors:
//     `1 = Steps feel unrelated. · 3 = Steps share a theme but lack a clear handoff. · 5 = Strong continuity where each step builds naturally from the previous one.`,
// },

//   // {
//   //   group: THEORY_ALIGNMENT_GROUP,
//   //   key: 'theory_alignment_narrative_flow',
//   //   title: 'Narrative Flow',
//   //   description: `Definition: The reflection, action, or hybrid pieces clearly follow the "why -> how -> now" arc. Cognitive insight becomes input for behavior or creative expression, producing a single interpretable storyline. High-quality example (5): "Use the sentence you wrote above ("I'm learning to trust small wins") and record it as a 5-second message to future-you." Low-quality example (1): "Write about stress. Then take a walk." (No conceptual bridge.) What to check: Does each part logically feed the next under one mechanism of change?`,
//   //   anchors:
//   //     `1 = Reflection and action feel unrelated. · 3 = Loose connection. · 5 = Explicit hand-off ("Take the line you wrote and...").`,
//   // },
// {
//   group: THEORY_ALIGNMENT_GROUP,
//   key: 'theory_alignment_non_interference',
//   title: 'Non-Interference, Balance & Safety',
//   description: `Definition: Each element gives the user enough mental space to move through the plan without feeling rushed or overwhelmed. Safety is built into pacing—steps include grounding cues, opt-outs, or containment so intensity never spikes without support. High-quality example (5): "Pause for one slow breath; if this feels edgy, just jot one word and stop. Otherwise, shift into the 3-minute action." Low-quality example (1): "Write about your biggest fear, then act on it immediately." (Sharp jump, no brake.) What to check: Do steps complement each other, stay emotionally safe, and provide breathing room?`,
//   anchors:
//     `1 = Steps clash, overload, or ignore safety. · 3 = Mostly steady but light on grounding. · 5 = Smooth, balanced flow with explicit containment.`,
// },

//   // {
//   //   group: THEORY_ALIGNMENT_GROUP,
//   //   key: 'theory_alignment_non_interference',
//   //   title: 'Non-Interference & Balance',
//   //   description: `Definition: The elements respect cognitive and emotional bandwidth. Transitions contain grounding cues; no part cancels or overwhelms another. The combined intensity stays safe and productive. High-quality example (5): "Pause for one breath -- ready to turn that idea into a small action?" (Gentle pacing.) Low-quality example (1): "Write about your biggest fear, then immediately act it out." (Overwhelming.) What to check: Do layers complement rather than compete? Is there emotional containment?`,
//   //   anchors:
//   //     `1 = Layers clash or overload. · 3 = Minor tension. · 5 = Balanced sequencing with explicit containment.`,
//   // },
//   {
//   group: THEORY_ALIGNMENT_GROUP,
//   key: 'theory_alignment_psych_alignment',
//   title: 'Explicit Alignment with Psychology Principles',
//   description: `Definition: The plan explains the core skill or idea behind the activity in simple, direct language the user can understand. It shows how each step puts that idea into practice without relying on jargon.

// High-quality example (5): "This uses reframing. In Step B you test the new perspective by trying one tiny action."

// Low-quality example (1): "Do a check-in, then breathe," with no clue about the underlying idea.

// What to check: Is the principle named clearly? Does each step show how the principle is being practiced?`,
//   anchors:
//     `1 = No principle or an incorrect one. · 3 = Principle is mentioned once but not carried through the steps. · 5 = Principle is clear, accurate, and reflected in each step.`,
// },

//   // {
//   //   group: THEORY_ALIGNMENT_GROUP,
//   //   key: 'theory_alignment_psych_alignment',
//   //   title: 'Explicit Alignment with Psychology Principles',
//   //   description: `Definition: The final flow plainly names the psychological principles or skills in use (reappraisal, grounding, behavioral activation, etc.) and shows how each micro-step enacts that mechanism so the user understands why it works. High-quality example (5): "Name this as values-based behavioral activation and state how Step 2 proves the value in action." Low-quality example (1): "Do a quick check-in, then breathe" with no principle named. What to check: Does the plan call out the theory link and make the application unmistakable?`,
//   //   anchors:
//   //     `1 = No principle or a wrong one. · 3 = Principle is implied once but not carried through the steps. · 5 = Technique is named and each move shows how to practice it.`,
//   // },
// ];


const INTEGRATION_LAYER_THEORY = [
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: "theory_alignment_narrative_flow",
    title: "Narrative Flow",
    description: `Definition: The reflective and action-oriented components should form one clear and continuous experience. Each step connects smoothly to the next so the user can follow a single thread of meaning. Steps should relate in purpose, tone, and content rather than appear stitched together.  
High-quality example (5): "Take the line you wrote about small wins and speak it aloud once as a short message to your future self." The action grows directly from the reflection.  
Low-quality example (1): "Write about stress. Then take a walk." This provides no shared theme or linking detail.  
What to check: Do the steps feel like parts of one short story or moment? Does each step build on what came before?`,
    anchors:
      `1 = Steps feel unrelated. · 3 = Shared theme but weak connection. · 5 = Strong continuity where each step grows naturally from the previous one.`,
  },
  {
    group: THEORY_ALIGNMENT_GROUP,
    key: "theory_alignment_small_progress",
    title: "Small Progress (Micro-Win)",
    description: `Definition: The sequence should end with a concrete, minimal outcome that signals progress within the session. That outcome can be reflective (a clarified sentence, a named emotion, a reframe, a decision) or action-based (a practiced line, a tiny plan step). The point is a clear, usable output that marks forward movement.  
High-quality example (5): "Write one sentence that captures the shift you want to carry forward, then decide where you will place it."  
Low-quality example (1): "Think about how you feel." This provides no defined output.  
What to check: Does the user finish with a specific, tangible takeaway—even if it is reflective?`,
    anchors:
      `1 = No concrete outcome. · 3 = Outcome exists but is vague or optional. · 5 = Clear, specific takeaway or micro-action tied to the mechanism.`,
  },

  {
  group: THEORY_ALIGNMENT_GROUP,
  key: "theory_alignment_non_interference",
  title: "Safe Sequencing",
  description: `Definition: The sequence should keep the user within a steady, manageable emotional range. Each step should be low‑intensity, clearly bounded, and easy to pause or skip. Safety means avoiding tasks that demand heavy emotional processing, vivid trauma recall, or deep distress exploration that could be risky without supervision. The activity should emphasize grounding, gentle pacing, and clear opt‑out cues so the user stays oriented and in control.  
High-quality example (5): "Take one slow breath. Write one neutral phrase about what feels most present. If that feels steady, do a brief three‑minute exercise." This keeps the arc contained and easy to adjust.  
Low-quality example (1): "Describe your most painful memory in detail and immediately act on it." This creates a sharp leap in intensity with no containment.  
What to check: Are steps low‑intensity, clearly bounded, and easy to pause? Do they avoid deep emotional processing and keep the user oriented?`,
  anchors:
    `1 = High‑intensity or emotionally heavy; no grounding or opt‑out. · 3 = Mostly steady but includes some heavy or unclear demands. · 5 = Clearly bounded, low‑intensity, and grounded with explicit pause/opt‑out cues.`,
  },

  {
    group: THEORY_ALIGNMENT_GROUP,
    key: "theory_alignment_psych_alignment",
    title: "Explicit Alignment with Psychology Principles",
    description: `Definition: The plan names the psychological principle clearly and shows how each step puts it into practice using plain and accessible language. The user should understand why the activity works without needing technical terminology.  
High-quality example (5): "This activity uses reframing. In Step B you test the new perspective by trying one small action."  
Low-quality example (1): "Do a check-in, then breathe," with no indication of the underlying idea.  
What to check: Is the principle identified accurately? Does each step demonstrate how the principle is enacted?`,
    anchors:
      `1 = No principle or an incorrect one. · 3 = Principle named once but not applied throughout. · 5 = Principle is clear, accurate, and reflected consistently across steps.`,
  },
];



const INTEGRATION_RUBRIC = [
  ...INTEGRATION_LAYER_THEORY,
  ...cloneRubrics(PERSONALIZATION_RUBRICS),
];

const LAYERED_COGNITIVE_PROMPT = `
You are the AI Support assistant. Generate exactly two thought-focused bundles for a user who just finished a guided reflection.

Purpose: Each bundle keeps one reframing goal in focus while outlining a single 10–15 minute flow broken into two plain-language steps, so the user can choose the concept that best matches their energy without extra complexity.

Layer definition to ground your reasoning:
• These activities focus on working with thoughts related to the situation. They draw on techniques commonly used in Cognitive Behavioral Therapy (CBT), such as identifying automatic thoughts, examining evidence, or considering alternative interpretations. The goal is clearer and more balanced thinking about the situation. These activities focus on perspective rather than behavioral change.

Typical modes: short writing or journaling, perspective shifts, guided questioning, labeling emotions, narrative reframing, imagined dialogue.

Input JSON provides: intro, summary, and conversation_transcript (recent user-assistant snippets—give extra weight to the first few user messages for raw stress cues).

Requirements:
• Produce exactly two candidates with clearly different concepts, titles, and themes (avoid near-duplicates).
• Use candidate_id values cog_a and cog_b (in that order).
• Include a candidate-level "description" (2–3 sentences) summarizing what the activity asks the user to do in plain language.
• State the shared goal in plain language and add alignment_notes explaining when the activity is the best fit.
• Provide an "activity_steps" array with 2–3 sequential moves. Each step needs a short title plus 1–2 sentences describing exactly one action (≤20 words total, max two short sentences, no comma chains or stacked clauses).
• Make the steps vivid: reference the user’s context, timing, or sensory cues so the integration layer can understand how to merge them with experiential ideas later.
• Use conversation_transcript to capture nuances, repeated worries, or subtle context that may not appear in the condensed summary. Pay special attention to the first few user messages—they often contain the raw stressor and exact phrases you should echo.
• For each candidate, draft the description and activity_steps first, then use that reasoning to assign rubric scores (integers 1-5). Score_notes must cite concrete evidence (if personalization is only partial, give a 2–3 and explain why).
• Treat personalization and feasibility as non-negotiable: if either dimension would land below a 3, rework the idea before scoring.
• Tailor to the user's intro, summary, and conversation_transcript (especially their earliest messages). Avoid repeating metaphors across candidates.

Cognitive rubric:
${JSON.stringify(COGNITIVE_LAYER_RUBRIC)}

Output JSON only:
{
  "candidates": [
    {
      "candidate_id": "cog_a",
      "title": "...",
      "theme": "...",
      "description": "...",
      "goal": "...",
      "alignment_notes": "...",
      "duration_minutes": "<10-15>",
      "activity_steps": [
        { "title": "...", "description": "..." },
        { "title": "...", "description": "..." }
      ],
      "scores": {
        "theory_alignment_cognitive_shift": 4,
        "theory_alignment_small_progress": 4,
        "theory_alignment_clear_connection": 4,
        "personalization_specificity": 4,
        "personalization_non_retrievability": 4,
        "personalization_feasibility": 4,
        "personalization_understandable": 4
      },
      "score_notes": {
        "theory_alignment_cognitive_shift": "...",
        "theory_alignment_small_progress": "...",
        "theory_alignment_clear_connection": "...",
        "personalization_specificity": "...",
        "personalization_non_retrievability": "...",
        "personalization_feasibility": "...",
        "personalization_understandable": "..."
      }
    }
  ]
}`;

const LAYERED_EXPERIENTIAL_PROMPT = `
You are the AI Support assistant. Generate exactly two action-focused bundles that help the user embody their new perspective.

Purpose: Each bundle keeps a single experiential goal in focus while outlining one embodied 10–15 minute flow broken into two or three concrete steps so the user can jump in quickly with a clear, device-friendly action.

Layer definition to ground your reasoning:
• These activities focus on taking a small, concrete action related to the situation. They draw on approaches commonly used in Cognitive Behavioral Therapy (CBT), such as behavioral activation, problem solving, rehearsal, or graded task breakdown. The goal is observable progress within a short time window. These activities focus on action rather than reinterpretation.

Typical modes: brief role-play or scenario rehearsal, creative problem-solving, micro action planning, expressive doing (recording, movement, imagery), perspective experimentation.

Input JSON provides: intro, summary, and conversation_transcript (recent user-assistant snippets).

Requirements:
• Produce exactly two candidates with unique titles/themes that feel like genuinely different activities.
• Use candidate_id values exp_a and exp_b (in that order).
• Include a candidate-level "description" (2–3 sentences) summarizing what the activity asks the user to do in plain language.
• Spell out the shared goal and alignment_notes (when the activity is a better fit).
• Provide an "activity_steps" array with 2–3 embodied moves (titles + 1–2 sentence descriptions capped at 20 words). Each line should walk through just one concrete action while mentioning pacing, sensory cues, or social energy so the user knows exactly how it plays out on their current device.
• Steps should culminate in a tangible micro mastery (message sent, list captured, cue recorded, etc.).
• Write the description and activity_steps before scoring. Then assign rubric scores (1-5) with evidence-based score_notes; don’t give a 4 unless the copy clearly earns it (call out gaps when scoring 2–3).
• Tailor all content to the user intro/summary/conversation_transcript, pulling especially from their first few transcript messages; no repeated activities across candidates.

Experiential rubric:
${JSON.stringify(EXPERIENTIAL_LAYER_RUBRIC)}

Output JSON only (same structure as cognitive but with experiential score keys and activity_steps).`;

const LAYERED_V2_COGNITIVE_PROMPT = `
You are the AI Support assistant. Design three thought-focused activities for the user who just completed the intake. Treat the design principles below as non-negotiable guardrails:

Definition:
These activities focus on working with thoughts related to the situation. They draw on techniques commonly used in Cognitive Behavioral Therapy (CBT), such as identifying automatic thoughts, examining evidence, or considering alternative interpretations. The goal is clearer and more balanced thinking about the situation. These activities focus on perspective rather than behavioral change.

${COGNITIVE_DESIGN_PRINCIPLES.map((line) => `• ${line}`).join('\n')}

Instructions:
1. Review the intro, summary, and conversation_transcript—study the first few user messages closely, since they usually contain the raw stressor and exact phrases you should echo—to understand tone, constraints, and emotional goal.
2. Produce exactly three activities. Each activity should feel distinct (title, theme, tone, psychological move).
3. Keep steps short, specific, and sequenced (2–3 moves). Each description must describe a single 10–15 minute flow and stay under 20 words, use ≤2 short sentences, and focus on exactly one action; mention sensory anchors or pacing cues when helpful.
4. Include a short context_note that explains when this activity is the best fit (energy, environment, emotional aim).

Output JSON only:
{
  "activities": [
    {
      "title": "...",
      "theme": "...",
      "goal": "...",
      "context_note": "...",
      "duration_minutes": "<10-15>",
      "principle_tags": ["reappraisal", "values clarification"],
      "steps": [
        { "title": "...", "description": "..." },
        { "title": "...", "description": "..." }
      ]
    }
  ]
}`.trim();

const LAYERED_V2_EXPERIENTIAL_PROMPT = `
You are the AI Support assistant. Generate exactly three action-focused activities that help the user embody their new perspective. Follow these design principles:

Definition:
These activities focus on taking a small, concrete action related to the situation. They draw on approaches commonly used in Cognitive Behavioral Therapy (CBT), such as behavioral activation, problem solving, rehearsal, or graded task breakdown. The goal is observable progress within a short time window. These activities focus on action rather than reinterpretation.

${EXPERIENTIAL_DESIGN_PRINCIPLES.map((line) => `• ${line}`).join('\n')}

Input JSON includes: intro, summary, and conversation_transcript.

Instructions:
1. Read the intro, summary, and conversation_transcript, giving extra attention to the first few user messages where the raw stressor is usually described verbatim, so the actions reuse the user’s own language and constraints.
2. Each activity should describe a single 10–15 minute flow with 2–3 embodied moves (movement, breath, message drafting, sensory capture, etc.), with each description ≤20 words, max two sentences, and focused on one action (no comma chains).
3. Spell out the energy level, location, or social bandwidth in the context_note so the planner knows when to recommend it.
4. End every flow with a micro mastery the user can point to (saved note, sent message, logged cue).
5. Draw on conversation_transcript whenever you need extra nuance or verbatim lines that aren't in the short summary.

Output JSON only:
{
  "activities": [
    {
      "title": "...",
      "theme": "...",
      "goal": "...",
      "context_note": "...",
      "duration_minutes": "<10-15>",
      "principle_tags": ["grounding", "behavioural activation"],
      "steps": [
        { "title": "...", "description": "..." },
        { "title": "...", "description": "..." }
      ]
    }
  ]
}`.trim();

const LAYERED_V2_COMBINE_PROMPT = `You are the AI Support assistant. Generate exactly three intervention candidates directly from the user context, then return them in schema-ready form.

Input JSON: intro, summary, conversation_transcript, integration_rubric.

Goal:
Produce three distinct candidates that each combine cognitive and experiential support naturally inside one short flow. Do not generate separate cognitive and experiential lists first.

Design principles to apply while generating each option:
• Cognitive principles:
${COGNITIVE_DESIGN_PRINCIPLES.map((line) => `  - ${line}`).join('\n')}
• Experiential principles:
${EXPERIENTIAL_DESIGN_PRINCIPLES.map((line) => `  - ${line}`).join('\n')}

Requirements:
• Return exactly three options with distinct tone/energy and distinct titles.
• Each option must be fully executable in the user’s current context on one device.
• Keep each plan to about 15–20 minutes total with exactly two steps ("Step A" and "Step B").
• Steps must be concrete, simple, and single-action; avoid stacked instructions.
• Reuse user context details so each option feels personalized and non-generic.
• For each option, provide 1–3 short planning_reasoning lines explaining why this plan fits.
• Set type exactly as follows:
  - "cognitive" when the option is primarily thought-focused.
  - "experiential" when the option is primarily action/embodiment-focused.
  - "blended" when the option intentionally mixes both modes in one coherent flow.
• source_plan_ids should list one or more short origin tags for traceability (for example title fragments or internal tags). Do not use placeholder values like "null", "none", or "n/a".

Hard constraints:
• Output JSON only.
• Follow the required option schema exactly.
• Each blended_activity.options array must include exactly two entries with option_id "Z1" and "Z2".
• Each blended_activity.segments array must include exactly two entries aligned to Step A and Step B.
• No additional commentary outside the JSON object.
`.trim();



// const LAYERED_V2_COMBINE_PROMPT = `You are the AI Support assistant. Blend the cognitive + experiential activity lists into three distinct plans so the planner can choose the best fit.

// Input: intro, summary, conversation_transcript, cognitive_activities[3], experiential_activities[3].

// Guidance:
// • Build exactly three combination options. Each option should read like a fully-formed blended plan with its own title, summary, and two clear steps the user can run immediately.
// • Vary tone/energy across the options (e.g., reflective-first vs. action-first vs. a playful hybrid of reflective and action) while keeping everything feasible inside the user’s environment.
// • Document which source activities inspired each blended plan via source_plan_ids (list the cognitive + experiential titles or IDs that fed into the hybrid). It's totally fine to be inspired by one activity; in that case use 'null' for the unused layer.
// • Spell out the actual actions inside blended_activity: return exactly two options (“Step A” and “Step B”) describing the hybrid flow in plain language so the user knows what to do without extra interpretation. Each step description must be ≤40 words and capped at two sentences—never embed extra substeps or lists. If options are omitted, the plan is invalid—include them explicitly.
// • Each step must stay focused on one action. Use no more than two short sentences and keep the total under 30 words. Use warm, everyday language. Add one fitting emoji such as ✨, 🎧, or 📝.
// • Personalize each step using real details from the user’s situation. Explicitly mention where they are, their situation, or phrases they used earlier. This helps the steps feel written for them.
// • The two steps inside a single plan must form one coherent activity. They should feel like parts of the same short experience rather than two separate tasks.

// Output JSON only:
// {
//   "options": [
//     {
//       "option_id": "combo_a",
//       "plan_title": "...",
//       "summary_recap": "...",
//       "coherence_notes": "...",
//       "source_plan_ids": ["Cog title", "Exp title"],
//       "planning_reasoning": ["...", "..."],
//       "total_duration_minutes": 18,
//       "blended_activity": {
//         "title": "...",
//         "theme": "...",
//         "goal": "...",
//         "alignment_notes": "...",
//         "duration_minutes": 18,
//         "options": [
//           { "option_id": "Z1", "label": "Step A", "description": "...", "duration_minutes": 9, "why_it_helps": "...", "principle": "...", "micro_steps": ["..."] },
//           { "option_id": "Z2", "label": "Step B", "description": "...", "duration_minutes": 9, "why_it_helps": "...", "principle": "...", "micro_steps": ["..."] }
//         ]
//       }
//     }
//   ]
// }

// Each cognitive/experiential/blended section must satisfy the layered plan schema fields (title, theme, goal, alignment_notes, duration_minutes, options/segments, etc.).`.trim();


const LAYERED_V2_JUDGE_PROMPT = `
You are an intervention judge. Compare all combination options side-by-side and be extremely selective—scores of 4–5 require explicit evidence pulled from the plan text.

Follow this order:
1. Before comparing the options, reread the intro, summary, and conversation transcript so you can flag tone, feasibility, and reference mismatches.
2. For each integration rubric criterion (cover every entry provided in integration_rubric), explain the comparison across all options (who excels, who falls short, why). The narrative must come before any scores so your reasoning guides the scoring. Then assign 1–5 scores for **each** option under that criterion and record a short note that cites concrete plan details. Do not skip any criteria—mirror the exact order in integration_rubric and return the same number of entries inside criteria_analysis.
3. After covering all criteria, summarize how each option fares overall and pick the strongest recommendation. The selected option must align with the best overall evidence. Break ties with explicit reasoning.

Scoring Discipline
• Scores must be distributed realistically. Unless the content is genuinely identical in quality, avoid giving the same numeric score to all options under a criterion.
• A score of 5 indicates best-in-class performance with fully aligned evidence. This score must be extremely rare and justified.
• Expected distribution: mostly 3s, some 4s, and very few 5s. 5s should appear in well under 5% of all criterion scores.
• A score of 1 or 2 must be used whenever a plan fails to meet the criterion or shows clear gaps.
• 3 should represent average performance. Use it when a plan meets the requirement but lacks strong evidence.
• Never give 4–5 to more than one option on a criterion unless you cite distinct, option-specific text for each. If evidence is thin or repeated, lower the score.
• Differentiate scores unless the options are truly identical; identical scores across all options are acceptable only when each note contains clear, distinct evidence for that option.
• Any score ≥4 must include a concrete quote or paraphrase from that option’s text in the note. If evidence is missing, downgrade to 2–3.
• For every 4 or 5 score, quote or paraphrase a clear piece of text that justifies the high mark.
• For every 1 or 2 score, state exactly what is missing or flawed.
• For every criterion, list explicit strengths and weaknesses for each option.
• Do not use vague statements. Always anchor judgments in concrete plan details.
• The final chosen option must be supported by the strongest evidence across the full rubric, not simply the one with the most high scores.
• Ties must be resolved through explicit text evidence.
• If options are very close, identify the specific criterion where one shows a clearer advantage and use that to break the tie.

Hard Caps for 5s (Must Obey)
• At most one 5 per criterion across all options.

Hard Constraints
• Never assume any option is stronger because of its position, ID, or ordering. Treat all options as equally possible winners at the start.
• The reviewer must never rely on alphabetical or numeric ordering. Treat IDs (combo_a, combo_b, combo_c) as meaningless labels.
• The reviewer must compare all options directly under every criterion, using side-by-side evidence.
• The reviewer must not give the same option the highest score across every criterion unless each score is backed by unique, explicit evidence. If evidence is weak or repeated, the reviewer must lower the score.
• The reviewer must not rely on template familiarity or prior examples. Judge solely the text shown.
• Never form any preference before all criteria are fully evaluated. Any early leaning is invalid.
• If the reviewer selects the first option in the original list (combo_a), they must provide a justification that references at least two different criteria to explain why combo_a surpasses the other options.
• Do not be lazy or superficial. Strong early performance from one option must not influence scoring in later criteria.
• In the final selection section, the reviewer must mention at least one strength from the non-selected option before explaining why the selected option wins. This ensures balanced comparison.
Input: intro, summary, conversation_transcript, options[3] (each option provides plan_title, summary_recap, coherence_notes, total_duration_minutes, source_plan_ids, and a blended_activity with two labeled steps containing label/description/duration/why/principle/micro_steps), integration_rubric.

Output JSON only:
{
 "criteria_analysis": [
    {
      "criterion": "theory_alignment_narrative_flow",
      "narrative": "Comparative explanation referencing all options...",
      "evaluations": [
        { "option_id": "combo_a", "score": 3, "note": "Note citing plan details..." },
        { "option_id": "combo_b", "score": 4, "note": "Note citing plan details..." },
        { "option_id": "combo_c", "score": 2, "note": "Note citing plan details..." }
      ]
    }
  ],
  "option_summaries": [
    { "option_id": "<option_id>", "integration_reasoning": "2–3 sentences summarizing this option's tradeoffs" }
  ],
  "selected_option": "<best_option_id>"
}`;

// const LAYERED_V2_JUDGE_PROMPT = `
// You are the integration reviewer. Compare all combination options side-by-side and be extremely selective—scores of 4–5 require explicit evidence pulled from the plan text. Follow this order:
// 1. For each integration rubric criterion (cover every entry provided in integration_rubric), explain the comparison across every option (who excels, who falls short, why). Then assign 1–5 scores for **each** option under that criterion and record a short note that cites concrete plan details. Do not skip any criteria—mirror the order given in integration_rubric and return the exact same number of entries inside criteria_analysis.
// 2. After covering all criteria, summarize how each option fares overall and pick the strongest recommendation. The selected option must clearly align to the best overall evidence—never default to a specific option id. Break ties with explicit reasoning.

// Scoring Discipline
// • Scores must be distributed realistically. Unless the content is genuinely identical in quality, avoid giving the same numeric score to all options under a criterion.
// • A score of 5 indicates best-in-class performance with fully aligned evidence. This score must be *extremely* rare and justified.
// • A score of 1 or 2 must be used whenever a plan fails to meet the criterion or shows clear gaps. Do not “soften” weak performance.
// • 3 should represent average performance. Use it when a plan meets the requirement but lacks strong evidence.
// • For every 4 or 5 score, the reviewer must quote or paraphrase a clear piece of text from the option that justifies the high mark.
// • For every 1 or 2 score, specify exactly what is missing or flawed in the option's text.
// • For every criterion, list the strengths and weaknesses of each option explicitly.
// • Do not use vague descriptions (such as "Option X feels better"). Always anchor judgments in concrete plan details.
// • The chosen recommendation must be the option with the strongest evidence across the full rubric, not the one that scored highest on the most criteria.
// • Ties must be broken by explicit text evidence, not preference or inference.
// • If two plans are very close, identify the specific criterion where one shows clearer strength and justify the tie-break explicitly.


// Hard Constraints
// • Never assume any option is stronger by position, ID, or ordering. Treat both options as equally possible winners at the start of the evaluation.
// • The reviewer must compare both options directly under every criterion, using side-by-side evidence rather than summarizing each independently.
// • The reviewer must not assign the same option the highest score across every criterion unless the text clearly provides explicit evidence for each case. If so, cite each piece of evidence separately.
// • The reviewer must not rely on assumptions, template familiarity, or prior outputs. Judge solely the text shown.
// • Do not be lazy and superficial. If a specific option gets high score in the first criteria, do not just try to rank it first in other criteria.

// Input: intro, summary, conversation_transcript, options[3] (each option provides plan_title, summary_recap, coherence_notes, total_duration_minutes, source_plan_ids, and a blended_activity with two labeled steps containing label/description/duration/why/principle/micro_steps), integration_rubric.

// Output JSON only:
// {
//   "criteria_analysis": [
//     {
//       "criterion": "theory_alignment_narrative_flow",
//       "narrative": "Comparative explanation referencing all options...",
//       "scores": { "combo_a": "<score_1_to_5>", "combo_b": "<score_1_to_5>", "combo_c": "<score_1_to_5>" },
//       "notes": {
//         "combo_a": "Note citing plan details...",
//         "combo_b": "Note citing plan details...",
//         "combo_c": "Note citing plan details..."
//       }
//     }
//   ],
//   "option_summaries": [
//     { "option_id": "<option_id>", "integration_reasoning": "2–3 sentences summarizing this option's tradeoffs" }
//   ],
//   "selected_option": "<best_option_id>"
// }`.trim();

const LAYERED_V2_SIMPLE_COMBINE_PROMPT = `
You are the AI Support assistant. Using the cognitive and experiential activities listed below, craft three short intervention options the planner can offer the user.

Input JSON contains: intro, summary, conversation_transcript, cognitive_activities[], experiential_activities[].

Rules:
- Return exactly three options (combo_a, combo_b, combo_c).
- Each option can be cognitive-only, experiential-only, or hybrid.
- Provide a title, 1-sentence description, goal, type (cognitive | experiential | hybrid), duration_minutes (≤15), and 2–3 concrete steps.
- Every step must stick to one clear action, use ≤20 words, stay within 1–2 short sentences, and avoid comma chains or multi-part clauses.
- Reuse the user’s context or language at least once per option.

Output JSON only:
{
  "options": [
    {
      "option_id": "combo_a",
      "title": "...",
      "type": "cognitive",
      "goal": "...",
      "description": "...",
      "duration_minutes": "<10-15>",
      "steps": ["...", "..."]
    }
  ]
}
`.trim();

const LAYERED_V2_SIMPLE_JUDGE_PROMPT = `
You are the integration reviewer. Compare every intervention option side-by-side using the integration rubric (8 criteria).

Input JSON includes: intro, summary, conversation_transcript, options (typically two, each with title, type, goal, description, steps[], duration_minutes), and integration_rubric.

Instructions:
1. Begin with the intro, summary, and conversation_transcript to identify tone, constraints, and feasibility needs.
2. For each rubric criterion (cover every entry provided in integration_rubric, in order), reason about all options before scoring. Write 2-3 sentences explaining how the options compare on that criterion (reasoning must come before scores), and ensure your output includes the same number of criteria entries as integration_rubric (same order).
3. After reasoning, assign a 1-5 score to **each** option for that criterion and include a short evidence note per option.
4. After covering all criteria, choose the strongest option overall and summarize why in 2 sentences. The selected option must reflect the evidence—do not default to any specific id, and break ties with explicit reasoning.
5. If the input provides fewer than three options, still compare the available ones.

Output JSON only:
{
  "criteria": [
    {
      "criterion": "theory_alignment_narrative_flow",
      "narrative": "...comparative reasoning...",
      "notes": { "combo_a": "...", "combo_b": "...", "combo_c": "..." },
      "scores": { "combo_a": 3, "combo_b": 4, "combo_c": 3 }
    }
  ],
  "selected_option": "<best_option_id>",
  "summary": "...overall rationale..."
}
`.trim();

const LAYERED_DETAIL_PROMPT = `
You are a friendly product copywriter. Rewrite the planner's internal notes into a short, user-facing blurb that explains—in plain language—where the final activity idea came from and why it should feel supportive.

Requirements:
- Speak directly to the end user. Never reference internal labels, schema names, or ids.
- Start with one sentence summarizing how the idea was stitched together (reference their context or phrases).
- Follow with exactly two bullet points:
  • first bullet starts with “Why it helps:” and explains the benefit in ≤25 words.
  • second bullet starts with “Why it feels good:” and highlights the experience in ≤25 words.
- If any input fields are missing, gracefully skip them.
- Stay warm, encouraging, and easy to skim.

Return JSON only:
{
  "friendly_copy": "Sentence...\n• Why it helps: ...\n• Why it feels good: ..."
}
`.trim();

const LAYERED_SELECTION_PROMPT = `
You are the AI Support assistant. Weigh the cognitive and experiential bundles and design the most helpful next activity. You may choose:
• a primarily cognitive practice (if action bandwidth is low),
• a primarily experiential practice,
• or a hybrid where the cognitive insight flows into an action beat.
Be explicit about which pattern you chose and why.

Input: intro, summary, conversation_transcript, cognitive candidates (with scores), experiential candidates (with scores), and the integration rubric.

Tasks:
1. Start by rereading the intro, summary, and conversation_transcript so tone, references, and feasibility stay grounded in the user’s situation.
2. Review diversity, personalization, and feasibility. Explain in plain language why each candidate is or isn’t a fit. Use conversation_transcript whenever you need nuance or verbatim phrases beyond the summary.
3. Choose the structure (cognitive only, experiential only, or hybrid) that best serves the user’s constraints. If hybrid, describe how the cognitive step feeds into the action step; if single-layer, mention how the other layer lightly influences it (if at all).
4. Provide integration notes before you score: for each sub-rubric (Theory Alignment—Narrative Flow; Small Progress; Explicit Alignment with Psychology Principles; Safe Sequencing; Personalization—Specificity & Context Echo; Distinctive Personalization (Non-Retrievability); Understandable to Everyday Users; Everyday Feasibility), write evidence-based notes first, then assign 1-5 scores that align with those notes. Use critical scoring—call out tradeoffs when you rate 2–3.
5. Output the final plan with the chosen steps. Use the selected candidates’ activity_steps to shape the blended option’s micro-steps so the final two moves feel like one story from insight to action, and keep each step description ≤20 words so it only covers a single action.

Output JSON only:
{
  "summary_recap": "...",
  "coherence_notes": "...",
  "total_duration_minutes": "<10-15>",
  "cognitive_layer": {
    "title": "...",
    "theme": "...",
    "goal": "...",
    "alignment_notes": "...",
    "duration_minutes": "<10-15>",
    "activity_steps": [
      { "title": "...", "description": "...", "minutes": "<5-8>" },
      { "title": "...", "description": "...", "minutes": "<5-8>" }
    ]
  },
  "experiential_layer": {
    "title": "...",
    "theme": "...",
    "goal": "...",
    "alignment_notes": "...",
    "duration_minutes": "<10-15>",
    "activity_steps": [
      { "title": "...", "description": "...", "minutes": "<5-8>" },
      { "title": "...", "description": "...", "minutes": "<5-8>" }
    ]
  },
  "integration_score_notes": {
    "theory_alignment_narrative_flow": "...",
    "theory_alignment_small_progress": "...",
    "theory_alignment_psych_alignment": "...",
    "theory_alignment_non_interference": "...",
    "personalization_specificity": "...",
    "personalization_non_retrievability": "...",
    "personalization_understandable": "...",
    "personalization_feasibility": "..."
  },
  "integration_scores": {
    "theory_alignment_narrative_flow": 4,
    "theory_alignment_small_progress": 4,
    "theory_alignment_psych_alignment": 4,
    "theory_alignment_non_interference": 4,
    "personalization_specificity": 4,
    "personalization_non_retrievability": 4,
    "personalization_understandable": 4,
    "personalization_feasibility": 4
  },
  "selected_ids": { "cognitive": "cog_a", "experiential": "exp_b" }
}`;

module.exports = {
  COGNITIVE_LAYER_RUBRIC,
  EXPERIENTIAL_LAYER_RUBRIC,
  INTEGRATION_RUBRIC,
  LAYERED_COGNITIVE_PROMPT: LAYERED_COGNITIVE_PROMPT.trim(),
  LAYERED_EXPERIENTIAL_PROMPT: LAYERED_EXPERIENTIAL_PROMPT.trim(),
  LAYERED_SELECTION_PROMPT: LAYERED_SELECTION_PROMPT.trim(),
  LAYERED_V2_COGNITIVE_PROMPT,
  LAYERED_V2_EXPERIENTIAL_PROMPT,
  LAYERED_V2_COMBINE_PROMPT,
  LAYERED_V2_JUDGE_PROMPT,
  LAYERED_V2_SIMPLE_COMBINE_PROMPT,
  LAYERED_DETAIL_PROMPT,
};
