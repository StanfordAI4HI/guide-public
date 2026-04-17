// Canonical 13 thinking traps with definitions/examples/tips (from Sharma et al., Table 6)
const TRAPS = [
  {
    id: 'all_or_nothing',
    label: 'All-or-Nothing Thinking',
    description: 'Thinking in extremes.',
    example: '“If it isn’t perfect, I failed. There’s no such thing as ‘good enough’.”',
    tip: 'Things in life are rarely black and white. Focus on what’s positive or neutral about the situation.',
  },
  {
    id: 'overgeneralizing',
    label: 'Overgeneralizing',
    description: 'Jumping to conclusions based on one experience.',
    example: '“They didn’t text me back. Nobody ever texts me back.”',
    tip: 'Recall times when things went well for you. Imagine what it would be like for things to go well next time.',
  },
  {
    id: 'labeling',
    label: 'Labeling',
    description: 'Defining a person based on one action or characteristic.',
    example: '“I said something embarrassing. I’m such a loser.”',
    tip: 'Consider all different aspects of a person.',
  },
  {
    id: 'fortune_telling',
    label: 'Fortune Telling',
    description: 'Trying to predict the future.',
    example: '“I’m late for the meeting. I’ll make a fool of myself.”',
    tip: 'Be curious about what’s going to happen next. Focus on what you can control and let go of what you can’t.',
  },
  {
    id: 'mind_reading',
    label: 'Mind Reading',
    description: 'Assuming you know what someone else is thinking.',
    example: '“She didn’t say hello. She must be mad at me.”',
    tip: 'Try to imagine other, less negative possibilities. Try asking the person what they’re thinking, rather than just assuming.',
  },
  {
    id: 'emotional_reasoning',
    label: 'Emotional Reasoning',
    description: 'Treating your feelings like facts.',
    example: '“I woke up feeling anxious. I just know something bad is going to happen today.”',
    tip: 'Consider all the information you have.',
  },
  {
    id: 'should_statements',
    label: 'Should Statements',
    description: 'Setting unrealistic expectations for yourself.',
    example: '“I shouldn’t need to ask for help. I should be independent.”',
    tip: 'Think about where your unrealistic expectations came from. Let your mistakes be an opportunity to learn and grow.',
  },
  {
    id: 'personalizing',
    label: 'Personalizing',
    description: 'Taking things personally or making them about you.',
    example: '“He’s quiet today. I wonder what I did wrong.”',
    tip: 'Think about all the other things that could be affecting someone’s behavior.',
  },
  {
    id: 'disqualifying_positive',
    label: 'Disqualifying the Positive',
    description: 'When something good happens, you ignore it or think it doesn’t count.',
    example: '“I only won because I got lucky.”',
    tip: 'Go out of your way to notice the positive side.',
  },
  {
    id: 'catastrophizing',
    label: 'Catastrophizing',
    description: 'Focusing on the worst-case scenario.',
    example: '“My boss asked if I had a few minutes to talk. I’m going to get fired!”',
    tip: 'Keep in mind that worst-case scenarios are very unlikely. Try to remind yourself of all the more likely, less severe things that could happen.',
  },
  {
    id: 'comparing_and_despairing',
    label: 'Comparing and Despairing',
    description: 'Comparing your worst to someone else’s best.',
    example: '“My niece’s birthday party had twice the amount of people!”',
    tip: 'Remember that what you see on social media and in public is everyone showing off their best.',
  },
  {
    id: 'blaming',
    label: 'Blaming',
    description: 'Giving away your own power to other people.',
    example: '“It’s not my fault I yelled. You made me angry!”',
    tip: 'Take responsibility for whatever you can—no more, no less.',
  },
  {
    id: 'negative_feeling_or_emotion',
    label: 'Negative Feeling or Emotion',
    description: 'Having a negative feeling or emotion which isn’t a thinking trap.',
    example: '“I am feeling lonely.”',
    tip: 'Negative emotions are normal; focus on what you can control and positives you can be grateful for.',
  },
];

const TRAP_LOOKUP = TRAPS.reduce((acc, trap) => {
  acc[trap.id] = trap;
  acc[trap.label.toLowerCase()] = trap;
  return acc;
}, {});

const ALIASES = {
  'all-or-nothing thinking': 'all_or_nothing',
  'all or nothing': 'all_or_nothing',
  overgeneralization: 'overgeneralizing',
  overgeneralizing: 'overgeneralizing',
  'fortune telling': 'fortune_telling',
  'mind reading': 'mind_reading',
  'emotional reasoning': 'emotional_reasoning',
  'should statements': 'should_statements',
  personalizing: 'personalizing',
  personalization: 'personalizing',
  'disqualifying the positive': 'disqualifying_positive',
  catastrophizing: 'catastrophizing',
  'comparing and despairing': 'comparing_and_despairing',
  comparing: 'comparing_and_despairing',
  blaming: 'blaming',
  'negative feeling or emotion': 'negative_feeling_or_emotion',
  'negative feeling': 'negative_feeling_or_emotion',
  'negative emotion': 'negative_feeling_or_emotion',
};

function canonicalizeTrapId(label) {
  if (!label || typeof label !== 'string') return null;
  const normalized = label.trim().toLowerCase();
  if (TRAP_LOOKUP[normalized]) return TRAP_LOOKUP[normalized].id;
  if (ALIASES[normalized]) return ALIASES[normalized];
  return null;
}

function normalizeTrapScores(raw, floor = 1) {
  // Convert raw model outputs into percentage-of-total probabilities (sum to ~100)
  if (!raw || typeof raw !== 'object') {
    return TRAPS.map((trap) => ({ id: trap.id, percent: 0 }));
  }

  const entries = Object.entries(raw).filter(([, v]) => typeof v === 'number' && !Number.isNaN(v));
  if (!entries.length) return TRAPS.map((trap) => ({ id: trap.id, percent: 0 }));

  const mapped = entries
    .map(([k, v]) => [canonicalizeTrapId(k) || k, v])
    .filter(([k]) => canonicalizeTrapId(k));

  if (!mapped.length) return TRAPS.map((trap) => ({ id: trap.id, percent: 0 }));

  const totals = mapped.reduce((sum, [, v]) => sum + Math.max(0, v), 0);
  const total = totals > 0 ? totals : 1;

  // initial percentages
  const rawPercents = TRAPS.map((trap) => {
    const match = mapped.find(([key]) => key === trap.id);
    const rawVal = match ? Math.max(0, match[1]) : 0;
    const percent = match ? (rawVal / total) * 100 : 0;
    return { id: trap.id, percent };
  });

  // round and enforce a small floor only for traps that appeared
  const rounded = rawPercents.map((item) => {
    const hasScore = mapped.find(([key]) => key === item.id);
    if (!hasScore) return { ...item, percent: 0 };
    return { ...item, percent: Math.max(floor, Math.round(item.percent)) };
  });

  // renormalize to sum ~100 to avoid bars exceeding 100%
  const sumRounded = rounded.reduce((s, r) => s + r.percent, 0) || 1;
  const normalized = rounded.map((r) => ({
    id: r.id,
    percent: Math.round((r.percent / sumRounded) * 100),
  }));

  // adjust rounding error to hit exactly 100
  const diff = 100 - normalized.reduce((s, r) => s + r.percent, 0);
  if (diff !== 0) {
    const maxIdx = normalized.findIndex((r) => r.percent === Math.max(...normalized.map((n) => n.percent)));
    if (maxIdx >= 0) normalized[maxIdx].percent = Math.max(floor, normalized[maxIdx].percent + diff);
  }

  return normalized.sort((a, b) => b.percent - a.percent);
}

module.exports = {
  TRAPS,
  TRAP_LOOKUP,
  canonicalizeTrapId,
  normalizeTrapScores,
};
