export type TrapId =
  | "overgeneralizing"
  | "catastrophizing"
  | "labeling"
  | "negative_feeling_or_emotion"
  | "all_or_nothing"
  | "fortune_telling"
  | "mind_reading"
  | "personalizing"
  | "not_distorted"
  | "disqualifying_positive"
  | "should_statements"
  | "emotional_reasoning"
  | "blaming"
  | "comparing_and_despairing";

export type TrapMetadata = {
  id: TrapId;
  label: string;
  description: string;
  example: string;
  baseScore: number; // normalized 0-100 from dataset frequency
  synonyms?: string[];
};

// Canonical set derived from thinking_traps.jsonl (deduped variants, frequencies merged).
export const TRAPS: TrapMetadata[] = [
  {
    id: "overgeneralizing",
    label: "Overgeneralizing",
    description: "Jumping from one event to a sweeping conclusion.",
    example: "They did not text me back. Nobody ever texts me back.",
    baseScore: 100,
    synonyms: ["overgeneralization"],
  },
  {
    id: "catastrophizing",
    label: "Catastrophizing",
    description: "Leaping to the worst-case outcome.",
    example: "If I mess this up, everything will fall apart.",
    baseScore: 96,
  },
  {
    id: "labeling",
    label: "Labeling",
    description: "Reducing yourself or others to a fixed negative label.",
    example: "I said something embarrassing. I am such a loser.",
    baseScore: 90,
  },
  {
    id: "negative_feeling_or_emotion",
    label: "Negative Feeling or Emotion",
    description: "Getting stuck on distressing feelings tied to the thought.",
    example: "I feel awful and cannot shake this feeling.",
    baseScore: 88,
  },
  {
    id: "all_or_nothing",
    label: "All-or-nothing Thinking",
    description: "Seeing situations in extremes with no middle ground.",
    example: "If it is not perfect, it is a total failure.",
    baseScore: 84,
  },
  {
    id: "fortune_telling",
    label: "Fortune Telling",
    description: "Predicting a negative outcome as certain.",
    example: "I will embarrass myself in that meeting.",
    baseScore: 74,
  },
  {
    id: "mind_reading",
    label: "Mind Reading",
    description: "Assuming you know what others think about you.",
    example: "Everyone will look down on me for being late.",
    baseScore: 71,
  },
  {
    id: "personalizing",
    label: "Personalizing",
    description: "Taking things too personally or assuming it is about you.",
    example: "He was quiet today. I must have done something wrong.",
    baseScore: 70,
    synonyms: ["personalization"],
  },
  {
    id: "not_distorted",
    label: "Not Distorted",
    description: "The thought may be realistic or proportionate.",
    example: "This might be a fair concern; check the facts first.",
    baseScore: 67,
  },
  {
    id: "disqualifying_positive",
    label: "Disqualifying the Positive",
    description: "Downplaying positives or dismissing compliments.",
    example: "They praised me, but they were just being polite.",
    baseScore: 52,
    synonyms: ["disqualifying the positive"],
  },
  {
    id: "should_statements",
    label: "Should Statements",
    description: "Rigid rules about how you or others must act.",
    example: "I should have handled that perfectly.",
    baseScore: 47,
  },
  {
    id: "emotional_reasoning",
    label: "Emotional Reasoning",
    description: "Believing feelings are facts.",
    example: "I feel anxious, so this must be dangerous.",
    baseScore: 43,
  },
  {
    id: "blaming",
    label: "Blaming",
    description: "Assigning all fault to yourself or others without balance.",
    example: "It went wrong, so it is all my fault.",
    baseScore: 35,
  },
  {
    id: "comparing_and_despairing",
    label: "Comparing and Despairing",
    description: "Unfavorable comparisons that ignore context.",
    example: "They are doing great and I am far behind.",
    baseScore: 24,
    synonyms: ["comparing", "comparing and despairing"],
  },
];

export const TRAP_LOOKUP: Record<TrapId, TrapMetadata> = TRAPS.reduce((acc, trap) => {
  acc[trap.id] = trap;
  return acc;
}, {} as Record<TrapId, TrapMetadata>);

export type TrapScore = {
  id: TrapId;
  percent: number; // 0-100 after normalization
};

// Normalize arbitrary scores to 0-100 with a floor to avoid all zeros.
export function normalizeTrapScores(raw: Record<string, number>, floor = 5): TrapScore[] {
  const entries = Object.entries(raw).filter(([, v]) => typeof v === "number" && !Number.isNaN(v));
  if (!entries.length) {
    return TRAPS.map((trap) => ({ id: trap.id, percent: trap.baseScore }));
  }

  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return TRAPS.map((trap) => {
    const match = entries.find(([key]) => canonicalizeTrapId(key) === trap.id);
    const rawVal = match ? match[1] : min;
    const scaled = ((rawVal - min) / range) * 100;
    const percent = Math.max(floor, Math.round(scaled));
    return { id: trap.id, percent };
  }).sort((a, b) => b.percent - a.percent);
}

// Maps variant labels to canonical ids.
export function canonicalizeTrapId(label: string): TrapId | null {
  const normalized = label.trim().toLowerCase();
  const direct = TRAPS.find((trap) => trap.label.toLowerCase() === normalized || trap.id === normalized);
  if (direct) return direct.id;
  const viaSyn = TRAPS.find((trap) => trap.synonyms?.some((syn) => syn.toLowerCase() === normalized));
  return viaSyn ? viaSyn.id : null;
}

export default function TrapMetadataRoute() {
  return null;
}
