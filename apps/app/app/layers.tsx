import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  buildSummaryImagePrompt,
  cacheLayeredImage,
  cacheUxPlan,
  getFlowState,
  getUxPlan,
  getLayeredPayload,
  getCachedLayeredImage,
  getUxPlanKeyForSessionStep,
  setUxPlanKeyForSessionStep,
  updateFlowState,
} from "./layered-store";
import { LinearGradient } from "expo-linear-gradient";
import MoodMeterWidget from "./mood-meter-widget";
import { Image as ExpoImage } from "expo-image";
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";

 

const resolveCachedImageUrl = (payload: any) => {
  const rawUrl =
    (typeof payload?.cached_url === "string" && payload.cached_url.trim()) ||
    (typeof payload?.url === "string" && payload.url.trim()) ||
    (typeof payload?.image?.url === "string" && payload.image.url.trim()) ||
    "";
  if (!rawUrl) return "";
  return rawUrl.startsWith("/") ? `${API_BASE}${rawUrl}` : rawUrl;
};

type LayerOption = {
  option_id?: string;
  label?: string;
  description?: string;
  duration_minutes?: number;
  why_it_helps?: string;
  principle?: string;
  micro_steps?: string[];
};

type CandidateStep = {
  title?: string;
  description?: string;
};

type DesignActivity = {
  title?: string;
  theme?: string;
  goal?: string;
  context_note?: string;
  description?: string;
  duration_minutes?: number;
  principle_tags?: string[];
  steps?: CandidateStep[];
};

type IntegrationScoreKey =
  | "theory_alignment_narrative_flow"
  | "theory_alignment_small_progress"
  | "theory_alignment_psych_alignment"
  | "theory_alignment_non_interference"
  | "personalization_specificity"
  | "personalization_non_retrievability"
  | "personalization_understandable"
  | "personalization_feasibility";

type IntegrationScores = Partial<Record<IntegrationScoreKey, number>> & Record<string, number | undefined>;
type IntegrationScoreNotes = Partial<Record<IntegrationScoreKey, string>> & Record<string, string | undefined>;

type CombinationOption = {
  option_id?: string;
  type?: "cognitive" | "experiential" | "blended";
  plan_title?: string;
  summary_recap?: string;
  coherence_notes?: string;
  planning_reasoning?: string[];
  total_duration_minutes?: number;
  blended_activity?: SupportLayer & { segments?: any[] };
  source_plan_ids?: string[];
  integration_scores?: IntegrationScores;
  integration_score_notes?: IntegrationScoreNotes;
  integration_reasoning?: string;
  total_score?: number;
};

type SupportLayer = {
  title?: string;
  theme?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
  segments?: CandidateStep[];
  options?: LayerOption[];
};

type LayeredCandidate = {
  candidate_id?: string;
  title?: string;
  theme?: string;
  description?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
  options?: LayerOption[];
  activity_steps?: CandidateStep[];
  reasoning?: string[];
  scores?: Record<string, number>;
  score_notes?: Record<string, string>;
};


const ensureArray = <T,>(value: T[] | T | undefined | null): T[] =>
  Array.isArray(value) ? value : [];

const formatPlanTitle = (title?: string | null, summary?: string | null) => {
  const base = typeof title === "string" ? title.trim() : "";
  if (!base) {
    const summarySentence = (summary || "")
      .split(/[.!?]/)
      .map((part) => part.trim())
      .find((part) => part.length >= 8);
    return summarySentence || "Personalized activity";
  }

  const hasConnector = /\+|\band\b|\s&\s/i.test(base);
  if (!hasConnector) return base;

  const summarySentence = (summary || "")
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 12 && part.length <= 70);
  if (summarySentence) return summarySentence;

  const segments = base.split(/\+|\band\b|\s&\s/i).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length) {
    const first = segments[0];
    return `${first} session`;
  }
  return base;
};

const THEME_TOKENS: Record<string, {
  baseColor: string;
  accentColor: string;
  cardTint: string;
  borderColor: string;
  chipBg: string;
  chipBorder: string;
  gradient: [string, string];
  emojiGradient: [string, string];
  stepChipBg: string;
  stepChipBorder: string;
}> = {
  calm: {
    baseColor: "#1d4ed8",
    accentColor: "#60a5fa",
    cardTint: "rgba(37, 99, 235, 0.04)",
    borderColor: "rgba(37, 99, 235, 0.18)",
    chipBg: "rgba(59, 130, 246, 0.18)",
    chipBorder: "rgba(37, 99, 235, 0.32)",
    gradient: ["#93c5fd", "#60a5fa"],
    emojiGradient: ["#e0f2fe", "#bfdbfe"],
    stepChipBg: "rgba(239, 246, 255, 0.95)",
    stepChipBorder: "rgba(37, 99, 235, 0.25)",
  },
  energy: {
    baseColor: "#f97316",
    accentColor: "#fb923c",
    cardTint: "rgba(251, 146, 60, 0.06)",
    borderColor: "rgba(249, 115, 22, 0.22)",
    chipBg: "rgba(251, 146, 60, 0.2)",
    chipBorder: "rgba(249, 115, 22, 0.35)",
    gradient: ["#fdba74", "#fb923c"],
    emojiGradient: ["#ffe4cc", "#ffd0a6"],
    stepChipBg: "rgba(255, 247, 237, 0.95)",
    stepChipBorder: "rgba(249, 115, 22, 0.3)",
  },
  grounding: {
    baseColor: "#0f766e",
    accentColor: "#14b8a6",
    cardTint: "rgba(20, 184, 166, 0.06)",
    borderColor: "rgba(15, 118, 110, 0.24)",
    chipBg: "rgba(20, 184, 166, 0.2)",
    chipBorder: "rgba(15, 118, 110, 0.32)",
    gradient: ["#5eead4", "#2dd4bf"],
    emojiGradient: ["#ccfbf1", "#99f6e4"],
    stepChipBg: "rgba(236, 253, 245, 0.95)",
    stepChipBorder: "rgba(15, 118, 110, 0.3)",
  },
  default: {
    baseColor: "#312e81",
    accentColor: "#6366f1",
    cardTint: "rgba(99, 102, 241, 0.05)",
    borderColor: "rgba(99, 102, 241, 0.2)",
    chipBg: "rgba(129, 140, 248, 0.2)",
    chipBorder: "rgba(79, 70, 229, 0.32)",
    gradient: ["#a5b4fc", "#818cf8"],
    emojiGradient: ["#ede9fe", "#ddd6fe"],
    stepChipBg: "rgba(237, 233, 254, 0.95)",
    stepChipBorder: "rgba(79, 70, 229, 0.28)",
  },
};

const resolveThemeTokens = (theme?: string) => {
  const normalized = typeof theme === "string" ? theme.toLowerCase() : "";
  if (normalized.includes("calm") || normalized.includes("harmony")) {
    return THEME_TOKENS.calm;
  }
  if (normalized.includes("energy") || normalized.includes("spark")) {
    return THEME_TOKENS.energy;
  }
  if (normalized.includes("ground") || normalized.includes("steady") || normalized.includes("earth")) {
    return THEME_TOKENS.grounding;
  }
  return THEME_TOKENS.default;
};

const pickStepGlyph = (text: string) => {
  const lower = text.toLowerCase();
  if (lower.includes("listen") || lower.includes("song") || lower.includes("music")) return "🎧";
  if (lower.includes("write") || lower.includes("note") || lower.includes("journal") || lower.includes("draft")) return "✍️";
  if (lower.includes("walk") || lower.includes("route") || lower.includes("map") || lower.includes("path")) return "📍";
  if (lower.includes("breath") || lower.includes("inhale") || lower.includes("exhale")) return "🌬️";
  if (lower.includes("call") || lower.includes("talk") || lower.includes("share")) return "💬";
  return "✨";
};

const FONT = {
  title: "PlusJakartaSans_700Bold",
  heading: "PlusJakartaSans_600SemiBold",
  medium: "PlusJakartaSans_500Medium",
  label: "Manrope_500Medium",
  body: "Nunito_400Regular",
  bodyBold: "Nunito_600SemiBold",
};

type LayeredPayload = {
  layered?: {
    summary_recap?: string;
    coherence_notes?: string;
    total_duration_minutes?: number;
    blended_activity?: SupportLayer;
    planning_reasoning?: string[];
    cognitive_candidates?: LayeredCandidate[];
    experiential_candidates?: LayeredCandidate[];
    cognitive_activities?: DesignActivity[];
    experiential_activities?: DesignActivity[];
    combination_options?: CombinationOption[];
    selected_combination_id?: string;
    cognitive_rubric?: RubricDimension[];
    experiential_rubric?: RubricDimension[];
    integration_rubric?: RubricDimension[];
    integration_scores?: IntegrationScores;
    integration_score_notes?: IntegrationScoreNotes;
    selected_ids?: { cognitive?: string; experiential?: string; combination?: string };
    cognitive_reasoning?: string[];
    experiential_reasoning?: string[];
    friendly_copy?: string;
  };
  summary?: string;
  userSummary?: string;
  intro?: string;
  summaryImageUrl?: string;
  generationLabel?: string;
  generationMs?: number;
  sessionId?: string;
};

type RubricDimension = {
  key: string;
  title: string;
  description?: string;
  anchors?: string;
  group?: string;
};

const formatMinutes = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  return `${value} min`;
};

const extractLeadSentence = (text?: string) => {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/(.+?[.!?])\s+/);
  return match ? match[1] : normalized;
};

const splitSentences = (text?: string | null, max = 2) => {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, max);
};

const normalizeOptionLabels = (text?: string | null) => {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\bcombo[_\s-]*a\b/gi, "Option 1")
    .replace(/\bcombo[_\s-]*b\b/gi, "Option 2")
    .replace(/\bcombo[_\s-]*c\b/gi, "Option 3")
    .replace(/\bcompared to ([ABC])\b/gi, (_match, label: string) => {
      const map: Record<string, string> = { A: "1", B: "2", C: "3" };
      const idx = map[String(label || "").toUpperCase()];
      return idx ? `compared to Option ${idx}` : "compared to another option";
    });
};

const composeWarmBlurb = ({
  lead,
  detail,
  fallback,
  maxSentences = 2,
}: {
  lead?: string;
  detail?: string | null;
  fallback?: string | null;
  maxSentences?: number;
}) => {
  const sentences: string[] = [];
  if (lead) {
    sentences.push(lead.trim());
  }
  const detailSentences = splitSentences(detail, maxSentences);
  if (detailSentences.length) {
    sentences.push(...detailSentences);
  } else if (fallback) {
    sentences.push(...splitSentences(fallback, maxSentences));
  }
  return sentences.slice(0, maxSentences).join(" ").trim();
};

const coerceCandidateSteps = (candidate?: LayeredCandidate | null): CandidateStep[] => {
  if (!candidate) return [];
  const directSteps = (candidate as any)?.activity_steps;
  if (Array.isArray(directSteps) && directSteps.length) {
    return directSteps;
  }
  const options = (candidate as any)?.options;
  if (Array.isArray(options) && options.length) {
    const derived: CandidateStep[] = [];
    options.forEach((option: LayerOption) => {
      if (Array.isArray(option?.micro_steps) && option.micro_steps.length) {
        option.micro_steps.forEach((micro, idx) => {
          derived.push({
            title: idx === 0 ? option.label : undefined,
            description: micro,
          });
        });
      } else if (option?.description) {
        derived.push({
          title: option.label,
          description: option.description,
        });
      }
    });
    if (derived.length) return derived;
  }
  return [];
};

type FinalInstruction = {
  title?: string | null;
  description: string;
};

const normalizeStepCopy = (value?: string | null) => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const extractPreviewText = (text?: string) => {
  if (!text) return "";
  const preview = extractLeadSentence(text);
  return preview || text.split(". ")[0] || text;
};

const splitActionText = (text: string): { verb: string; rest: string } => {
  const normalized = normalizeStepCopy(text);
  if (!normalized) return { verb: "", rest: "" };
  const match = normalized.match(/^([A-Za-z'’\-]+)/);
  if (!match) {
    return { verb: normalized.split(" ")[0] || "", rest: normalized.slice((normalized.split(" ")[0] || "").length).trim() };
  }
  const verb = match[1];
  const rest = normalized.slice(verb.length).trim();
  return { verb, rest };
};

const groupRubricDimensions = (rubric: RubricDimension[] = []) => {
  const groups: { name: string; items: RubricDimension[] }[] = [];
  rubric.forEach((dim) => {
    const name = dim.group || "Rubric";
    const existing = groups.find((entry) => entry.name === name);
    if (existing) {
      existing.items.push(dim);
    } else {
      groups.push({ name, items: [dim] });
    }
  });
  return groups;
};

const describeIntegrationChoice = ({
  blendedTitle,
  cognitiveTitle,
  experientialTitle,
  cognitiveId,
  experientialId,
}: {
  blendedTitle?: string | null;
  cognitiveTitle?: string | null;
  experientialTitle?: string | null;
  cognitiveId?: string;
  experientialId?: string;
}) => {
  const cogLabel = cognitiveTitle || cognitiveId || "";
  const expLabel = experientialTitle || experientialId || "";
  if (cogLabel && expLabel) {
    return `You have both a reflective option ("${cogLabel}") and an action option ("${expLabel}") so you can pick the path that fits without mixing them.`;
  }
  if (cogLabel) {
    return `This round sticks with the cognitive activity "${cogLabel}" so you can focus on the thinking step without extra layers.`;
  }
  if (expLabel) {
    return `This option runs the experiential activity "${expLabel}" directly—no blend, just the action sequence as written.`;
  }
  if (blendedTitle) {
    return `This option keeps "${blendedTitle}" intact as a single activity you can run as-is.`;
  }
  return null;
};

const renderIntegrationScores = (
  rubric: RubricDimension[] = [],
  scores: IntegrationScores = {},
  notes: IntegrationScoreNotes = {},
  summary?: string
) => {
  if (!rubric.length) return null;
  const grouped = groupRubricDimensions(rubric);
  return (
    <View style={styles.integrationCard}>
      <Text style={styles.integrationTitle}>Integration Check</Text>
      {summary ? <Text style={styles.integrationSummary}>{normalizeOptionLabels(summary)}</Text> : null}
      {grouped.map((group) => (
        <View key={group.name} style={styles.integrationGroup}>
          <Text style={styles.integrationGroupTitle}>{group.name}</Text>
          {group.items.map((dim) => (
            <View key={dim.key} style={styles.integrationRow}>
              <View style={styles.integrationLabelCol}>
                <Text style={styles.integrationLabel}>{dim.title}</Text>
                {dim.description ? (
                  <Text style={styles.integrationDescription}>{dim.description}</Text>
                ) : null}
              </View>
              <View style={styles.integrationScoreCol}>
                <Text style={styles.integrationScore}>{
                  typeof scores[dim.key] === "number" ? `${scores[dim.key]}/5` : "—"
                }</Text>
                {notes[dim.key] ? (
                  <Text style={styles.integrationNote}>{normalizeOptionLabels(notes[dim.key])}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
};

const renderInterventionComparisonTable = (
  options: CombinationOption[] = [],
  rubric: RubricDimension[] = [],
  formatTitle?: (title?: string | null, summary?: string | null) => string,
  selectedId?: string
) => {
  if (!options.length || !rubric.length) return null;
  const grouped = groupRubricDimensions(rubric);
  const columns = options.map((option, index) => {
    const title = formatTitle
      ? formatTitle(option?.plan_title, option?.summary_recap)
      : option?.plan_title;
    const steps: string[] = [];
    const optionSteps = Array.isArray(option?.blended_activity?.options)
      ? option?.blended_activity?.options
      : [];
    optionSteps.forEach((opt) => {
      const description = [
        opt?.description || "",
        ...(Array.isArray(opt?.micro_steps) ? opt.micro_steps : []),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (description) {
        steps.push(opt?.label ? `${opt.label}: ${description}` : description);
      }
    });
    return {
      id: option?.option_id || `intervention-${index}`,
      title: title || `Option ${String.fromCharCode(65 + index)}`,
      summary: option?.summary_recap,
      duration:
        option?.total_duration_minutes || option?.blended_activity?.duration_minutes || null,
      scores: option?.integration_scores || {},
      notes: option?.integration_score_notes || {},
      steps: steps.slice(0, 3),
    };
  });

  const activeColumnId = selectedId || columns[0]?.id;
  return (
    <View style={styles.interventionTableCard}>
      <Text style={styles.interventionTableHeading}>Intervention comparison</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.interventionTableScroll}
      >
        <View style={styles.interventionTableGrid}>
          <View style={[styles.interventionTableRow, styles.interventionTableHeaderRow]}>
            <View style={[styles.interventionTableCell, styles.interventionTableKeyCell]}>
              <Text style={styles.interventionTableKeyLabel}>Rubric</Text>
              <Text style={styles.interventionTableKeyHint}>What we’re checking</Text>
            </View>
            {columns.map((col) => (
              <View
                key={col.id}
                style={[
                  styles.interventionTableCell,
                  styles.interventionTableColumnCell,
                  col.id === activeColumnId && styles.interventionSelectedColumn,
                ]}
              >
                <Text style={styles.interventionTableTitle}>{col.title}</Text>
                {col.id === activeColumnId ? (
                  <Text style={styles.interventionSelectedBadge}>Selected</Text>
                ) : null}
                {col.duration ? (
                  <Text style={styles.interventionTableDuration}>
                    {formatMinutes(col.duration)}
                  </Text>
                ) : null}
                {col.summary ? (
                  <Text style={styles.interventionTableSummary}>{normalizeOptionLabels(col.summary)}</Text>
                ) : null}
                {col.steps?.length ? (
                  <View style={styles.interventionStepList}>
                    {col.steps.map((stepText, idx) => (
                      <View key={`${col.id}-step-${idx}`} style={styles.interventionStepRow}>
                        <Text style={styles.interventionStepBullet}>•</Text>
                        <Text style={styles.interventionStepText}>{stepText}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
          {grouped.map((group) => (
            <View key={group.name} style={styles.interventionGroupBlock}>
              <Text style={styles.interventionGroupTitle}>{group.name}</Text>
            {group.items.map((dim) => (
              <View key={dim.key} style={styles.interventionTableRow}>
                <View style={[styles.interventionTableCell, styles.interventionTableKeyCell]}>
                  <Text style={styles.interventionTableKeyLabel}>{dim.title}</Text>
                  {dim.description ? (
                    <Text style={styles.interventionTableKeyHint}>
                      {extractLeadSentence(dim.description)}
                    </Text>
                  ) : null}
                </View>
                  {columns.map((col) => {
                    const value = col.scores?.[dim.key];
                    const note = col.notes?.[dim.key];
                    return (
                      <View
                        key={`${col.id}-${dim.key}`}
                        style={[
                          styles.interventionTableCell,
                          styles.interventionTableColumnCell,
                          col.id === activeColumnId && styles.interventionSelectedColumn,
                        ]}
                      >
                        <Text style={styles.interventionScoreValue}>
                          {typeof value === "number" ? `${value}/5` : "—"}
                        </Text>
                        {note ? (
                          <Text style={styles.interventionScoreNote} numberOfLines={3}>
                            {note}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};
const renderCandidateList = (
  heading: string,
  candidates: LayeredCandidate[] = [],
  rubric: RubricDimension[] = [],
  selectedId?: string
) => {
  if (!candidates.length || !rubric.length) return null;
  return (
    <View style={styles.candidateListCard}>
      <Text style={styles.candidateSummaryHeading}>{heading}</Text>
      {candidates.map((candidate) => {
        if (!candidate) return null;
        const reasoning = Array.isArray(candidate.reasoning) ? candidate.reasoning : [];
        const isSelected = candidate?.candidate_id && candidate.candidate_id === selectedId;
        const previewSteps = coerceCandidateSteps(candidate).slice(0, 3);
        return (
          <View
            key={candidate?.candidate_id || candidate?.title}
            style={[styles.candidateSummaryCard, isSelected && styles.candidateSummarySelected]}
          >
            {isSelected ? <Text style={styles.candidateSelectedTag}>Selected</Text> : null}
            {candidate.title ? (
              <Text style={styles.candidateSummaryTitle}>{candidate.title}</Text>
            ) : null}
            {candidate.goal ? (
              <Text style={styles.candidateGoalText}>{candidate.goal}</Text>
            ) : null}
            {candidate.description ? (
              <Text style={styles.candidateSummaryNotes}>{candidate.description}</Text>
            ) : null}
            {candidate.alignment_notes ? (
              <Text style={styles.candidateSummaryNotes}>{candidate.alignment_notes}</Text>
            ) : null}
            {previewSteps.length ? (
              <View style={styles.candidateActions}>
                <Text style={styles.candidateActionsLabel}>What you’ll do</Text>
                {previewSteps.map((step, idx) => {
                  const summary =
                    (step?.title ? `${step.title}: ` : "") +
                    (step?.description || "").trim();
                  if (!summary.trim()) return null;
                  return (
                    <Text key={`${candidate?.candidate_id || idx}-step-${idx}`} style={styles.candidateActionText}>
                      • {summary}
                    </Text>
                  );
                })}
              </View>
            ) : null}
            {reasoning.length ? (
              <Text style={styles.candidateReasoningText}>{reasoning.join(" ")}</Text>
            ) : null}
            <View style={styles.candidateSummaryScores}>
              {groupRubricDimensions(rubric).map((group) => (
                <View key={`${heading}-${candidate?.candidate_id || "group"}-${group.name}`} style={styles.candidateScoreGroup}>
                  <Text style={styles.candidateScoreGroupTitle}>{group.name}</Text>
                  {group.items.map((dim) => (
                    <View
                      key={`${heading}-${candidate?.candidate_id || dim.key}-${dim.key}`}
                      style={styles.candidateSummaryScoreRow}
                    >
                      <View style={styles.candidateSummaryScoreHeader}>
                        <Text style={styles.candidateSummaryScoreLabel}>{dim.title}</Text>
                        <Text style={styles.candidateSummaryScoreValue}>
                          {typeof candidate.scores?.[dim.key] === "number"
                            ? `${candidate.scores?.[dim.key]}/5`
                            : "—"}
                        </Text>
                      </View>
                      {candidate.score_notes?.[dim.key] ? (
                        <Text style={styles.candidateSummaryScoreNote}>
                          {candidate.score_notes[dim.key]}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const renderDesignActivityList = (heading: string, activities: DesignActivity[] = []) => {
  if (!activities.length) return null;
  return (
    <View style={styles.designListCard}>
      <Text style={styles.designListHeading}>{heading}</Text>
      <View style={styles.designListGrid}>
        {activities.map((activity, index) => {
          const steps = Array.isArray(activity.steps) ? activity.steps.slice(0, 3) : [];
          const tags = Array.isArray(activity.principle_tags)
            ? activity.principle_tags.slice(0, 3)
            : [];
          return (
            <View key={`${heading}-design-${index}`} style={styles.designCard}>
              <View style={styles.designCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.designCardTitle}>{activity.title || `Idea ${index + 1}`}</Text>
                  {activity.theme ? (
                    <Text style={styles.designCardTheme}>{activity.theme}</Text>
                  ) : null}
                </View>
                {typeof activity.duration_minutes === "number" ? (
                  <Text style={styles.designCardDuration}>{formatMinutes(activity.duration_minutes)}</Text>
                ) : null}
              </View>
              {activity.context_note ? (
                <Text style={styles.designCardContext}>{activity.context_note}</Text>
              ) : null}
              {activity.goal ? (
                <Text style={styles.designCardGoal}>{activity.goal}</Text>
              ) : null}
              {tags.length ? (
                <View style={styles.designTagRow}>
                  {tags.map((tag) => (
                    <Text key={`${activity.title || index}-${tag}`} style={styles.designTag}>
                      {tag}
                    </Text>
                  ))}
                </View>
              ) : null}
              {steps.length ? (
                <View style={styles.designSteps}>
                  {steps.map((step, stepIdx) => {
                    const summary =
                      (step?.title ? `${step.title}: ` : "") + (step?.description || "");
                    return (
                      <Text key={`${activity.title || index}-step-${stepIdx}`} style={styles.designStepText}>
                        • {summary}
                      </Text>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const renderCombinationOptions = (
  options: CombinationOption[] = [],
  selectedId?: string,
  rubric: RubricDimension[] = [],
  describeSourcePlan?: (id?: string) => string | null,
  formatTitle?: (title?: string | null, summary?: string | null) => string
) => {
  if (!options.length) return null;
  return (
    <View style={styles.comboListCard}>
      <Text style={styles.designListHeading}>Intervention options</Text>
      <View style={styles.comboList}>
        {options.map((option, index) => {
          const isSelected = option?.option_id && option.option_id === selectedId;
          const displayTitle = formatTitle
            ? formatTitle(option?.plan_title, option?.summary_recap)
            : option?.plan_title;
          const flowLabel =
            option?.type === "cognitive"
              ? "Cognitive activity"
              : option?.type === "experiential"
              ? "Experiential activity"
              : "Activity flow";
          return (
            <View
              key={option?.option_id || `combo-${index}`}
              style={[styles.comboCard, isSelected && styles.comboCardSelected]}
            >
              <View style={styles.comboHeader}>
                <Text style={styles.comboTitle}>
                  {displayTitle || `Option ${String.fromCharCode(65 + index)}`}
                </Text>
                {isSelected ? <Text style={styles.comboBadge}>Selected</Text> : null}
              </View>
              {option.summary_recap ? (
                <Text style={styles.comboSummary}>{normalizeOptionLabels(option.summary_recap)}</Text>
              ) : null}
              {describeSourcePlan && Array.isArray(option.source_plan_ids) ? (
                (() => {
                  const sourceSummaries = option.source_plan_ids
                    .map((id) => describeSourcePlan(id))
                    .filter((text): text is string => Boolean(text && text.trim()));
                  return sourceSummaries.length ? (
                    <View style={styles.comboSources}>
                      {sourceSummaries.map((line, idx) => (
                        <Text key={`combo-${option?.option_id || index}-source-${idx}`} style={styles.comboSourceText}>
                          • {line}
                        </Text>
                      ))}
                    </View>
                  ) : null;
                })()
              ) : null}
              {Array.isArray(option.planning_reasoning) && option.planning_reasoning.length ? (
                <View style={styles.designSteps}>
                  {option.planning_reasoning.map((line, idx) => (
                    <Text key={`combo-${option?.option_id || index}-reason-${idx}`} style={styles.designStepText}>
                      • {normalizeOptionLabels(line)}
                    </Text>
                  ))}
                </View>
              ) : null}
              {option.integration_reasoning ? (
                <Text style={styles.comboReasoning}>{normalizeOptionLabels(option.integration_reasoning)}</Text>
              ) : null}
              <View style={styles.comboLayers}>
                {option.blended_activity?.options?.length ? (
                  <View style={styles.comboLayerSection}>
                    <Text style={styles.comboLayerHeading}>{flowLabel}</Text>
                    {option.blended_activity.options.slice(0, 2).map((opt, idx) => {
                      const blendedDescription = [opt?.description || "", ...(Array.isArray(opt?.micro_steps) ? opt.micro_steps : [])]
                        .filter(Boolean)
                        .join(" ")
                        .trim();
                      return (
                        <Text key={`combo-${option?.option_id || index}-blend-${idx}`} style={styles.comboLayerStep}>
                          • {opt.label ? `${opt.label}: ` : ""}{blendedDescription}
                        </Text>
                      );
                    })}
                  </View>
                ) : null}
              </View>
              {renderIntegrationScores(
                rubric,
                option.integration_scores || {},
                option.integration_score_notes || {},
                undefined
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default function LayersScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const paperMode = params?.paperMode === "1";
  const cachedPayload = useMemo(() => getLayeredPayload(params?.cacheKey), [params?.cacheKey]);
  const payload: LayeredPayload =
    cachedPayload ||
    (typeof params?.data === "string"
      ? (() => {
          try {
            return JSON.parse(params.data);
          } catch (err) {
            console.warn("Failed to parse layered support payload:", err);
            return {};
          }
        })()
      : (params?.data as any));

  const layered = payload?.layered ?? {};
  const sessionId =
    typeof payload?.sessionId === "string" && payload.sessionId.trim()
      ? payload.sessionId.trim()
      : "";
  const flowState = useMemo(() => getFlowState(sessionId), [sessionId]);
  const storedLayersUiState = flowState?.layersUiState || null;
  const summaryImageUrl =
    typeof payload?.summaryImageUrl === "string" ? payload.summaryImageUrl.trim() : "";
  const [showFriendlyDetails, setShowFriendlyDetails] = useState(false);
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [friendlyDetails, setFriendlyDetails] = useState<string | null>(
    typeof layered?.friendly_copy === "string" && layered.friendly_copy.trim()
      ? layered.friendly_copy.trim()
      : null
  );
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showMoodDetails, setShowMoodDetails] = useState(false);
  const [moodSelected, setMoodSelected] = useState<string[]>([]);
  const [moodOther, setMoodOther] = useState("");
  const [friendlyDetailsLoading, setFriendlyDetailsLoading] = useState(false);
  const [friendlyDetailsError, setFriendlyDetailsError] = useState<string | null>(null);
  const [showBuildDetails, setShowBuildDetails] = useState(false);
  const [finalStepImages, setFinalStepImages] = useState<
    Record<number, { status: "idle" | "loading" | "ready" | "error"; url?: string; prompt?: string; error?: string }>
  >({});
  const [uxPrefetchStatus, setUxPrefetchStatus] = useState<
    Record<number, { status: "idle" | "loading" | "ready" | "error"; startedAt?: number; elapsedMs?: number }>
  >({});
  const uxReadyChimePlayedRef = useRef(false);
  const finalStepImagesRef = useRef(finalStepImages);
  useEffect(() => {
    finalStepImagesRef.current = finalStepImages;
  }, [finalStepImages]);
  useEffect(() => {
    const id = setInterval(() => {
      setUxPrefetchStatus((prev) => {
        const next: typeof prev = { ...prev };
        Object.entries(prev).forEach(([key, value]) => {
          if (value?.status === "loading" && value.startedAt) {
            next[Number(key)] = {
              ...value,
              elapsedMs: Date.now() - value.startedAt,
            };
          }
        });
        return next;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);
  useLayoutEffect(() => {
    navigation.setOptions({ title: "Intervention" });
  }, [navigation]);
  useEffect(() => {
    if (!sessionId) {
      console.warn("[layers] missing sessionId in cached payload");
    }
  }, [sessionId]);
  const summaryRecap =
    layered?.summary_recap ||
    payload?.summary ||
    "Here’s a playful follow-up to keep momentum.";
  const userSummaryText =
    typeof payload?.userSummary === "string" ? payload.userSummary.trim() : "";
  const coherenceNotes =
    layered?.coherence_notes ||
    "This plan keeps one activity intact so you can choose the option that fits your energy right now.";
  const totalDuration = layered?.total_duration_minutes ?? 18;
  const combinationOptions = Array.isArray(layered?.combination_options)
    ? layered.combination_options
    : [];
  const selectedCombination =
    combinationOptions.find(
      (option) =>
        option?.option_id &&
        option.option_id === (layered?.selected_combination_id || combinationOptions[0]?.option_id)
    ) || combinationOptions[0] || null;
  const comparisonInterventions =
    combinationOptions.length > 0
      ? combinationOptions
      : selectedCombination
      ? [selectedCombination]
      : [];
  const blendedActivity =
    selectedCombination?.blended_activity || layered?.blended_activity || null;
  const blendedOptions = Array.isArray(blendedActivity?.options)
    ? blendedActivity.options
    : [];
  const blendedOption = blendedOptions[0] || null;
  const cognitiveRubric = layered?.cognitive_rubric ?? [];
  const experientialRubric = layered?.experiential_rubric ?? [];
  const cognitiveCandidates = Array.isArray(layered?.cognitive_candidates)
    ? layered.cognitive_candidates
    : [];
  const experientialCandidates = Array.isArray(layered?.experiential_candidates)
    ? layered.experiential_candidates
    : [];
  const cognitiveActivities = Array.isArray(layered?.cognitive_activities)
    ? layered.cognitive_activities
    : [];
  const experientialActivities = Array.isArray(layered?.experiential_activities)
    ? layered.experiential_activities
    : [];
  const selectedIds = layered?.selected_ids ?? {};
  const selectedCognitiveCandidate = useMemo(
    () =>
      cognitiveCandidates.find(
        (candidate) => candidate?.candidate_id && candidate.candidate_id === selectedIds?.cognitive
      ) || null,
    [cognitiveCandidates, selectedIds?.cognitive]
  );
  const selectedExperientialCandidate = useMemo(
    () =>
      experientialCandidates.find(
        (candidate) =>
          candidate?.candidate_id && candidate.candidate_id === selectedIds?.experiential
      ) || null,
    [experientialCandidates, selectedIds?.experiential]
  );
  const alternativeBlendOptions = useMemo(() => {
    if (!combinationOptions.length) return [];
    return combinationOptions.filter(
      (option) =>
        option?.option_id && option.option_id !== (selectedCombination?.option_id || "")
    );
  }, [combinationOptions, selectedCombination?.option_id]);
  const planningReasoning = Array.isArray(layered?.planning_reasoning)
    ? layered.planning_reasoning.filter(
        (line): line is string => typeof line === "string" && line.trim().length > 0
      )
    : [];
  const candidateLookup = useMemo(() => {
    const map = new Map<string, LayeredCandidate & { layer: "cog" | "exp" }>();
    cognitiveCandidates.forEach((candidate) => {
      if (candidate?.candidate_id) {
        map.set(candidate.candidate_id, { ...candidate, layer: "cog" });
      }
    });
    experientialCandidates.forEach((candidate) => {
      if (candidate?.candidate_id) {
        map.set(candidate.candidate_id, { ...candidate, layer: "exp" });
      }
    });
    return map;
  }, [cognitiveCandidates, experientialCandidates]);
  const alternativeBlendItems = useMemo(() => {
    return alternativeBlendOptions.slice(0, 3).map((option) => {
      const title =
        option?.plan_title ||
        option?.blended_activity?.title ||
        option?.blended_activity?.theme ||
        "Alternative activity";
      const steps = Array.isArray(option?.blended_activity?.options)
        ? option.blended_activity.options
            .map((stepOption, idx) => {
              const description = [
                stepOption?.description || "",
                ...(Array.isArray(stepOption?.micro_steps) ? stepOption.micro_steps : []),
              ]
                .filter((line) => typeof line === "string" && line.trim().length > 0)
                .join(" ")
                .trim();
              if (!description) return null;
              const stepLabel =
                typeof stepOption?.label === "string" && stepOption.label.trim().length > 0
                  ? stepOption.label.trim()
                  : `Step ${idx + 1}`;
              return `${stepLabel}: ${description}`;
            })
            .filter((line): line is string => Boolean(line))
        : [];
      const why =
        option?.integration_reasoning ||
        (Array.isArray(option?.planning_reasoning) ? option.planning_reasoning.join(" ") : "") ||
        "";
      return {
        id: option?.option_id || title,
        title,
        summary: option?.summary_recap || "",
        steps: steps.slice(0, 2),
        why,
      };
    });
  }, [alternativeBlendOptions]);
  const sourcePlanLookup = useMemo(() => {
    const map = new Map<string, string>();
    const register = (key?: string | null, summary?: string | null) => {
      const normalized = typeof key === "string" ? key.trim().toLowerCase() : "";
      if (!normalized) return;
      const friendly =
        typeof summary === "string" && summary.trim().length > 0
          ? summary.trim()
          : (typeof key === "string" ? key.trim() : normalized);
      if (!map.has(normalized)) {
        map.set(normalized, friendly);
      }
    };
    const registerActivity = (activity?: DesignActivity | null) => {
      if (!activity) return;
      const summary =
        activity.goal ||
        activity.context_note ||
        activity.theme ||
        (Array.isArray(activity.steps) && activity.steps[0]?.description) ||
        activity.description;
      register(activity.title, summary);
    };
    const registerCandidate = (candidate?: LayeredCandidate | null) => {
      if (!candidate) return;
      const summary =
        candidate.description ||
        candidate.goal ||
        candidate.alignment_notes ||
        (Array.isArray(candidate.activity_steps) ? candidate.activity_steps[0]?.description : undefined);
      register(candidate.candidate_id, summary);
      register(candidate.title, summary);
    };
    cognitiveActivities.forEach(registerActivity);
    experientialActivities.forEach(registerActivity);
    cognitiveCandidates.forEach(registerCandidate);
    experientialCandidates.forEach(registerCandidate);
    return map;
  }, [cognitiveActivities, experientialActivities, cognitiveCandidates, experientialCandidates]);

  const describeSourcePlan = useCallback(
    (id?: string) => {
      const normalized = typeof id === "string" ? id.trim().toLowerCase() : "";
      if (!normalized) return null;
      const entry = sourcePlanLookup.get(normalized);
      return entry || (typeof id === "string" ? id : null);
    },
    [sourcePlanLookup]
  );

  const friendlySummary = useMemo(() => {
    return (
      composeWarmBlurb({
        lead: summaryRecap,
        detail: planningReasoning[0] || blendedActivity?.goal,
        fallback: coherenceNotes,
      }) || summaryRecap
    );
  }, [summaryRecap, planningReasoning, blendedActivity?.goal, coherenceNotes]);

  const alignmentNarrative = useMemo(() => {
    const sources = [
      blendedActivity?.alignment_notes,
      selectedCognitiveCandidate?.alignment_notes,
      selectedExperientialCandidate?.alignment_notes,
    ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);
    if (!sources.length) return friendlySummary;
    return (
      composeWarmBlurb({
        lead: "Psych-wise, this meets you exactly where you said you were stuck.",
        detail: sources.join(" "),
        fallback: friendlySummary,
      }) || friendlySummary
    );
  }, [
    blendedActivity?.alignment_notes,
    friendlySummary,
    selectedCognitiveCandidate?.alignment_notes,
    selectedExperientialCandidate?.alignment_notes,
  ]);

  const whyMattersBlurb = alignmentNarrative;
  const whyEnjoyBlurb = useMemo(() => {
    const enjoymentSources = [
      selectedCognitiveCandidate?.description,
      selectedExperientialCandidate?.description,
      blendedOption?.why_it_helps,
      planningReasoning[1],
      blendedActivity?.goal,
    ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);
    return (
      composeWarmBlurb({
        lead: "It should feel light, concrete, and doable on the spot.",
        detail: enjoymentSources.join(" "),
        fallback: friendlySummary,
      }) || friendlySummary
    );
  }, [
    blendedActivity?.goal,
    blendedOption?.why_it_helps,
    friendlySummary,
    planningReasoning,
    selectedCognitiveCandidate?.description,
    selectedExperientialCandidate?.description,
  ]);
  const friendlyDetailPayload = useMemo(
    () => ({
      plan_title: blendedActivity?.title || "",
      summary_recap: summaryRecap || "",
      coherence_notes: coherenceNotes || "",
      planning_reasoning: planningReasoning,
      why_matters: whyMattersBlurb,
      why_feels_good: whyEnjoyBlurb,
      source_summaries: ensureArray(selectedCombination?.source_plan_ids)
        .map((id) => describeSourcePlan(id))
        .filter((line): line is string => Boolean(line)),
    }),
    [
      blendedActivity?.title,
      summaryRecap,
      coherenceNotes,
      planningReasoning,
      whyMattersBlurb,
      whyEnjoyBlurb,
      selectedCombination?.source_plan_ids,
      describeSourcePlan,
    ]
  );

  const requestFriendlyDetails = useCallback(
    async (payload: {
      plan_title: string;
      summary_recap: string;
      coherence_notes: string;
      planning_reasoning: string[];
      why_matters: string;
      why_feels_good: string;
      source_summaries: string[];
    }) => {
      if (friendlyDetails) return;
      setFriendlyDetailsLoading(true);
      setFriendlyDetailsError(null);
      try {
        const resp = await fetch(`${API_BASE}/layered-intervention/details`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const copy = typeof data?.friendly_copy === "string" ? data.friendly_copy.trim() : "";
        if (!copy) {
          throw new Error("No friendly copy returned");
        }
        setFriendlyDetails(copy);
      } catch (err: any) {
        console.warn("Friendly detail rewrite failed:", err);
        setFriendlyDetailsError(
          "Couldn’t load the extra context right now. Please try opening this again in a moment."
        );
      } finally {
        setFriendlyDetailsLoading(false);
      }
    },
    []
  );

  const blendedSegments = Array.isArray(blendedActivity?.segments)
    ? blendedActivity.segments
    : [];
  const integrationSummary = describeIntegrationChoice({
    blendedTitle: blendedActivity?.title,
    cognitiveTitle: selectedCognitiveCandidate?.title,
    experientialTitle: selectedExperientialCandidate?.title,
    cognitiveId: selectedIds?.cognitive,
    experientialId: selectedIds?.experiential,
  });
  const finalStepDuration = blendedActivity?.duration_minutes || totalDuration;
  const uxPlanCacheKeysRef = useRef<Record<number, string>>({});
  const uxPlanPrefetchingRef = useRef<Set<number>>(new Set());
  const [uxCtaStepIndex, setUxCtaStepIndex] = useState<number | null>(() => {
    const stored = storedLayersUiState?.uxCtaStepIndex;
    return typeof stored === "number" && Number.isFinite(stored) ? stored : null;
  });
  const [uxReadyDeferred, setUxReadyDeferred] = useState<boolean>(() =>
    Boolean(storedLayersUiState?.uxReadyDeferred)
  );
  useEffect(() => {
    if (!sessionId || !storedLayersUiState) return;
    const storedStep =
      typeof storedLayersUiState.uxCtaStepIndex === "number" &&
      Number.isFinite(storedLayersUiState.uxCtaStepIndex)
        ? storedLayersUiState.uxCtaStepIndex
        : null;
    const storedDeferred = Boolean(storedLayersUiState.uxReadyDeferred);
    setUxCtaStepIndex(storedStep);
    setUxReadyDeferred(storedDeferred);
  }, [
    sessionId,
    storedLayersUiState?.uxCtaStepIndex,
    storedLayersUiState?.uxReadyDeferred,
  ]);
  useEffect(() => {
    if (!sessionId) return;
    updateFlowState(sessionId, {
      layersUiState: {
        uxCtaStepIndex,
        uxReadyDeferred,
      },
    });
  }, [sessionId, uxCtaStepIndex, uxReadyDeferred]);
  useEffect(() => {
    if (uxCtaStepIndex == null) return;
    const status = uxPrefetchStatus[uxCtaStepIndex]?.status;
    if (status !== "ready") {
      uxReadyChimePlayedRef.current = false;
      return;
    }
    if (uxReadyChimePlayedRef.current) return;
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 784;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => {
        try {
          ctx.close();
        } catch {}
      };
      uxReadyChimePlayedRef.current = true;
    } catch (err) {
      console.warn("[layers] ux ready chime failed", err);
    }
  }, [uxCtaStepIndex, uxPrefetchStatus]);
  useEffect(() => {
    if (uxCtaStepIndex == null) {
      setUxReadyDeferred(false);
      return;
    }
    const status = uxPrefetchStatus[uxCtaStepIndex]?.status;
    if (status !== "ready") {
      setUxReadyDeferred(false);
    }
  }, [uxCtaStepIndex, uxPrefetchStatus]);
  const finalInstructionSteps = useMemo(() => {
    const sourceOptions = Array.isArray(selectedCombination?.blended_activity?.options)
      ? selectedCombination?.blended_activity?.options
      : blendedOptions;
    const perStepFallback =
      finalStepDuration && Array.isArray(sourceOptions) && sourceOptions.length
        ? Math.max(1, Math.round(finalStepDuration / sourceOptions.length))
        : null;
    return (sourceOptions || [])
      .slice(0, 2)
      .map((opt) => ({
        title: opt?.label || undefined,
        description: [opt?.description || "", ...(Array.isArray(opt?.micro_steps) ? opt.micro_steps : [])]
          .filter(Boolean)
          .join(" ")
          .trim(),
        microSteps: Array.isArray(opt?.micro_steps)
          ? opt.micro_steps.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
          : [],
        durationMinutes:
          typeof opt?.duration_minutes === "number" && !Number.isNaN(opt.duration_minutes)
            ? opt.duration_minutes
            : perStepFallback,
      }))
      .filter((step) => step.description);
  }, [selectedCombination?.blended_activity?.options, blendedOptions]);
  useEffect(() => {
    if (!finalInstructionSteps.length) return;
    finalInstructionSteps.forEach((step, idx) => {
      const cachedKey = getUxPlanKeyForSessionStep(sessionId || null, idx);
      if (cachedKey) {
        const cachedPlan = getUxPlan(cachedKey);
        if (cachedPlan) {
          uxPlanCacheKeysRef.current[idx] = cachedKey;
          setUxPrefetchStatus((prev) => ({
            ...prev,
            [idx]: { status: "ready", startedAt: prev[idx]?.startedAt, elapsedMs: prev[idx]?.elapsedMs },
          }));
          return;
        }
      }
      if (uxPlanCacheKeysRef.current[idx] || uxPlanPrefetchingRef.current.has(idx)) return;
      const combinedDescription = [
        finalInstructionSteps[0]?.description || "",
        finalInstructionSteps[1]?.description || "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      const uxSummary = [summaryRecap || "", combinedDescription].filter(Boolean).join(" ").trim();
      if (!uxSummary) return;
      console.log("[layers] ux prefetch start", {
        step: idx,
        descriptionPreview: uxSummary.slice(0, 160),
        sessionId: sessionId || null,
      });
      setUxPrefetchStatus((prev) => ({
        ...prev,
        [idx]: { status: "loading", startedAt: Date.now(), elapsedMs: 0 },
      }));
      uxPlanPrefetchingRef.current.add(idx);
      fetch(`${API_BASE}/dev/stress-support/intervention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: uxSummary,
          formats: ["planner"],
          sessionId: sessionId || undefined,
        }),
      })
        .then(async (resp) => {
          const text = await resp.text();
          if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}: ${text?.slice?.(0, 160)}`);
          }
          let data: any = {};
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error("Planner response not JSON");
          }
          if (!data?.spec) {
            throw new Error("Planner spec missing");
          }
          const specText = JSON.stringify(data.spec, null, 2);
          const spec = data.spec;
          const specModules = Array.isArray(spec?.modules) ? spec.modules : [];
          const hasAudio = specModules.some((m: any) => m?.id === "short_audio");
          const hasImage = specModules.some((m: any) => m?.id === "image");
          const hasStoryboard = specModules.some((m: any) => m?.id === "storyboard");
          const hasVideo = specModules.some((m: any) => m?.id === "dalle_video");
          const hasTimed = specModules.some((m: any) => m?.id === "timed_cues");

          const mediaBundle: Record<string, any> = {};
          const mediaJobs: Array<Promise<any>> = [];

          if (hasAudio) {
            mediaJobs.push(
              fetch(`${API_BASE}/dev/stress-support/intervention`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  summary: spec?.instruction || uxSummary,
                  formats: ["short_audio"],
                  sessionId: sessionId || undefined,
                }),
              })
                .then(async (resp) => {
                  const data = await resp.json();
                  const asset =
                    (Array.isArray(data?.assets) &&
                      data.assets.find((a: any) => a.type === "audio" || a.type === "music" || a.type === "ambient")) ||
                    null;
                  if (!asset) return;
                  mediaBundle.audioScript = asset?.audio_script;
                  mediaBundle.audioTone = asset?.audio_tone;
                  mediaBundle.voicePitch = asset?.voice_pitch;
                  mediaBundle.voiceRate = asset?.voice_rate;
                  mediaBundle.musicPrompt = asset?.music_prompt;
                  mediaBundle.musicChoice = asset?.music_choice;
                  mediaBundle.audioPurpose = asset?.purpose;
                  mediaBundle.audioRationale = asset?.explanation;
                })
                .catch((err) => {
                  console.warn("[layers] prefetch short_audio failed", err?.message || err);
                })
            );
          }

          if (hasTimed) {
            mediaJobs.push(
              fetch(`${API_BASE}/dev/stress-support/intervention`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  summary: spec?.instruction || uxSummary,
                  formats: ["timed_cues"],
                  sessionId: sessionId || undefined,
                }),
              })
                .then(async (resp) => {
                  const data = await resp.json();
                  const timerAsset =
                    (Array.isArray(data?.assets) && data.assets.find((a: any) => a.type === "timer")) || null;
                  if (!timerAsset) return;
                  mediaBundle.timerSteps = timerAsset?.timer_steps;
                  mediaBundle.timerScript = timerAsset?.audio_script;
                  mediaBundle.timerRationale = timerAsset?.explanation;
                  if (timerAsset?.audio_script) {
                    try {
                      const timedVoiceRate =
                        typeof timerAsset?.voice_rate === "number" && Number.isFinite(timerAsset.voice_rate)
                          ? Math.min(0.7, Math.max(0.5, timerAsset.voice_rate))
                          : 0.6;
                      const ttsResp = await fetch(`${API_BASE}/dev/media/tts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          text: timerAsset.audio_script,
                          speed: timedVoiceRate,
                          use_gpt_voice: true,
                          style: "calm, human, grounded guidance",
                        }),
                      });
                      const ttsData = await ttsResp.json();
                      if (ttsResp.ok && ttsData?.audio_url) {
                        mediaBundle.timerAudioUrl = ttsData.audio_url;
                        mediaBundle.timerAudioSource =
                          ttsData.voice_source === "gpt" || ttsData.voice_source === "generic"
                            ? ttsData.voice_source
                            : ttsData.used_gpt_voice === true
                            ? "gpt"
                            : "unknown";
                      }
                    } catch (err: any) {
                      console.warn("[layers] prefetch timed_cues tts failed", err?.message || err);
                    }
                  }
                })
                .catch((err) => {
                  console.warn("[layers] prefetch timed_cues failed", err?.message || err);
                })
            );
          }

          if (hasImage) {
            mediaJobs.push(
              fetch(`${API_BASE}/dev/media/image`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt: `${spec?.instruction || uxSummary} — reflect the user’s environment and situation (desk, home, commute, office), sharp focus, concrete real-world scene, high detail, no blur or haze, no faces, no text, cinematic still`,
                }),
              })
                .then(async (resp) => {
                  const data = await resp.json();
                  if (resp.ok && (data?.cached_url || data?.url || data?.image?.url)) {
                    const url = resolveCachedImageUrl(data);
                    if (url) {
                      mediaBundle.imageUrl = url;
                    }
                  }
                })
                .catch((err) => {
                  console.warn("[layers] prefetch image failed", err?.message || err);
                })
            );
          }

          if (hasStoryboard) {
            mediaJobs.push(
              fetch(`${API_BASE}/dev/stress-support/intervention`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  summary: spec?.instruction || uxSummary,
                  formats: ["storyboard"],
                  sessionId: sessionId || undefined,
                }),
              })
                .then(async (resp) => {
                  const data = await resp.json();
                  const asset =
                    (Array.isArray(data?.assets) &&
                      data.assets.find((a: any) => a.type === "storyboard")) ||
                    null;
                  const stepFrames = Array.isArray(data?.steps?.[0]?.asset?.frames)
                    ? data.steps[0].asset.frames
                    : Array.isArray(data?.step?.asset?.frames)
                      ? data.step.asset.frames
                      : [];
                  const frames = stepFrames.length ? stepFrames : Array.isArray(asset?.frames) ? asset.frames : [];
                  if (!frames.length) return;
                  mediaBundle.storyboardFrames = frames;
                  const imagePrompts = frames
                    .map((frame: any) =>
                      typeof frame === "object" && frame?.image_prompt
                        ? frame.image_prompt
                        : typeof frame === "string"
                          ? frame
                          : null
                    )
                    .filter(Boolean) as string[];
                  if (!imagePrompts.length) return;
                  const storyboardUrls: string[] = [];
                  for (const prompt of imagePrompts.slice(0, 3)) {
                    try {
                      const r = await fetch(`${API_BASE}/dev/media/image`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          prompt: `${prompt} — natural light, no faces, no text, cinematic still`,
                        }),
                      });
                      const d = await r.json();
                      if (r.ok && (d?.cached_url || d?.url || d?.image?.url)) {
                        const url = resolveCachedImageUrl(d);
                        if (url) storyboardUrls.push(url);
                      }
                    } catch (e) {
                      console.warn("[layers] prefetch storyboard image failed", e);
                    }
                  }
                  if (storyboardUrls.length) {
                    mediaBundle.storyboardImages = storyboardUrls;
                  }
                })
                .catch((err) => {
                  console.warn("[layers] prefetch storyboard failed", err?.message || err);
                })
            );
          }

          if (hasVideo) {
            mediaJobs.push(
              fetch(`${API_BASE}/dev/stress-support/intervention`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  summary: spec?.instruction || uxSummary,
                  formats: ["dalle_video"],
                  sessionId: sessionId || undefined,
                }),
              })
                .then(async (resp) => {
                  const data = await resp.json();
                  const asset =
                    (Array.isArray(data?.assets) &&
                      data.assets.find((a: any) => a.type === "video")) ||
                    null;
                  if (!asset) return;
                  const prompts = Array.isArray(asset?.prompts) ? asset.prompts : [];
                  const scriptLines = Array.isArray(asset?.script_lines)
                    ? asset.script_lines
                    : Array.isArray(asset?.script)
                      ? asset.script
                      : typeof asset?.script === "string"
                        ? asset.script.split("\n").filter(Boolean)
                        : [];
                  mediaBundle.videoPrompts = prompts;
                  mediaBundle.videoScript = scriptLines;
                  if (scriptLines.length) {
                    try {
                      const ttsResp = await fetch(`${API_BASE}/dev/media/tts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          text: scriptLines.join(". "),
                          speed: 0.95,
                          use_gpt_voice: true,
                          style: "gentle, supportive voiceover",
                        }),
                      });
                      const ttsData = await ttsResp.json();
                      if (ttsResp.ok && ttsData?.audio_url) {
                        mediaBundle.videoAudioUrl = ttsData.audio_url;
                        mediaBundle.videoAudioSource =
                          ttsData.voice_source === "gpt" || ttsData.voice_source === "generic"
                            ? ttsData.voice_source
                            : ttsData.used_gpt_voice === true
                            ? "gpt"
                            : "unknown";
                      }
                    } catch (e) {
                      console.warn("[layers] prefetch video voiceover failed", e);
                    }
                  }
                  if (!prompts.length) return;
                  const urls: string[] = [];
                  for (const prompt of prompts.slice(0, 4)) {
                    try {
                      const r = await fetch(`${API_BASE}/dev/media/image`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt }),
                      });
                      const d = await r.json();
                      if (r.ok && (d?.cached_url || d?.url || d?.image?.url)) {
                        const url = resolveCachedImageUrl(d);
                        if (url) urls.push(url);
                      }
                    } catch (e) {
                      console.warn("[layers] prefetch video frame failed", e);
                    }
                  }
                  if (urls.length) {
                    mediaBundle.videoUrls = urls;
                  }
                })
                .catch((err) => {
                  console.warn("[layers] prefetch video failed", err?.message || err);
                })
            );
          }

          if (mediaJobs.length) {
            await Promise.all(mediaJobs);
          }

          const cacheKey = cacheUxPlan({
            specText,
            description: uxSummary,
            generatedAt: new Date().toISOString(),
            media: mediaBundle,
          });
          uxPlanCacheKeysRef.current[idx] = cacheKey;
          setUxPlanKeyForSessionStep(sessionId || null, idx, cacheKey);
          console.log("[layers] ux plan prefetched", { step: idx, cacheKey });
          setUxPrefetchStatus((prev) => ({
            ...prev,
            [idx]: { status: "ready", startedAt: prev[idx]?.startedAt, elapsedMs: prev[idx]?.elapsedMs },
          }));
        })
        .catch((err: any) => {
          console.warn("[layers] ux plan prefetch failed", { step: idx, error: err?.message || err });
          setUxPrefetchStatus((prev) => ({
            ...prev,
            [idx]: { status: "error", startedAt: prev[idx]?.startedAt, elapsedMs: prev[idx]?.elapsedMs },
          }));
        })
        .finally(() => {
          console.log("[layers] ux prefetch done", {
            step: idx,
            cached: Boolean(uxPlanCacheKeysRef.current[idx]),
          });
          uxPlanPrefetchingRef.current.delete(idx);
        });
    });
  }, [finalInstructionSteps, sessionId, summaryRecap]);
  const finalStepSummary = useMemo(() => {
    if (selectedCombination?.summary_recap) {
      return selectedCombination.summary_recap;
    }
    const detailPieces = [
      selectedCognitiveCandidate?.description,
      selectedExperientialCandidate?.description,
      blendedActivity?.goal,
      friendlySummary,
    ]
      .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
      .join(" ");
    return (
      composeWarmBlurb({
        lead: friendlySummary,
        detail: detailPieces,
        fallback: friendlySummary,
      }) || friendlySummary
    );
  }, [
    blendedActivity?.goal,
    friendlySummary,
    selectedCognitiveCandidate?.description,
    selectedCombination?.summary_recap,
    selectedExperientialCandidate?.description,
  ]);
  const finalPlanTitle = useMemo(
    () => formatPlanTitle(blendedActivity?.title, summaryRecap),
    [blendedActivity?.title, summaryRecap]
  );
  const activityEmoji = useMemo(() => {
    const theme = (blendedActivity?.theme || blendedActivity?.title || "").toLowerCase();
    if (theme.includes("calm") || theme.includes("breath")) return "🌤️";
    if (theme.includes("energy") || theme.includes("action")) return "⚡️";
    if (theme.includes("play")) return "🎨";
    if (theme.includes("trust") || theme.includes("support")) return "🤝";
    return "✨";
  }, [blendedActivity?.theme, blendedActivity?.title]);
  const themeTokens = useMemo(
    () => resolveThemeTokens(blendedActivity?.theme || selectedCombination?.plan_title),
    [blendedActivity?.theme, selectedCombination?.plan_title]
  );
  const integrationRubric = layered?.integration_rubric ?? [];
  const integrationScores = layered?.integration_scores ?? {};
  const integrationScoreNotes = layered?.integration_score_notes ?? {};
  const selectedLayerType: "cognitive" | "experiential" | "blended" =
    selectedCombination?.type === "cognitive" || selectedCombination?.type === "experiential"
      ? selectedCombination.type
      : "blended";
  const generationLabel = useMemo(() => {
    if (typeof payload?.generationLabel === "string" && payload.generationLabel.trim()) {
      return payload.generationLabel;
    }
    if (typeof payload?.generationMs === "number" && payload.generationMs >= 0) {
      const seconds = Math.round(payload.generationMs / 1000);
      if (seconds < 60) {
        return `${seconds}s`;
      }
      const minutes = Math.floor(seconds / 60);
      const remaining = seconds % 60;
      return `${minutes}m ${remaining}s`;
    }
    return null;
  }, [payload?.generationLabel, payload?.generationMs]);

  const summaryImagePrompt = useMemo(
    () => buildSummaryImagePrompt(summaryRecap),
    [summaryRecap]
  );

  useEffect(() => {
    const prompt = summaryImagePrompt.trim();
    if (!prompt) return;
    if (summaryImageUrl) {
      console.log("[layers] final step image source: payload-url", {
        url: summaryImageUrl.slice(0, 80),
      });
      setFinalStepImages((prev) => ({
        ...prev,
        0: { status: "ready", url: summaryImageUrl, prompt },
      }));
      return;
    }
    const cachedUrl = getCachedLayeredImage(prompt);
    if (cachedUrl) {
      console.log("[layers] final step image source: cache-hit", {
        prompt: prompt.slice(0, 80),
        url: cachedUrl.slice(0, 80),
      });
      setFinalStepImages((prev) => ({
        ...prev,
        0: { status: "ready", url: cachedUrl, prompt },
      }));
      return;
    }
    console.log("[layers] final step image source: fallback-fetch", { prompt: prompt.slice(0, 80) });
    const pending = [{
      idx: 0,
      prompt,
    }];
    const filtered = pending.filter(({ idx, prompt }) => {
      const existing = finalStepImagesRef.current[idx];
      if (!prompt) return false;
      if (!existing) return true;
      if (existing.prompt && existing.prompt !== prompt) return true;
      return existing.status === "idle" || existing.status === "error";
    });

    if (pending.length) {
      console.log("[layers] final step images pending", pending.map((p) => ({ idx: p.idx, prompt: p.prompt?.slice(0, 80) })));
    } else {
      console.log("[layers] final step images already resolved");
    }

    filtered.forEach(({ idx, prompt }) => {
      setFinalStepImages((prev) => ({
        ...prev,
        [idx]: { status: "loading", prompt },
      }));
      console.log("[layers] final step image fetch start", { prompt: prompt.slice(0, 80) });
      fetch(`${API_BASE}/dev/media/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
        .then(async (resp) => {
          const text = await resp.text();
          const data = (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })();
          if (!resp.ok) {
            const detail = data?.detail || data?.error || `status ${resp.status}`;
            throw new Error(detail);
          }
          const url = resolveCachedImageUrl(data);
          if (!url) {
            throw new Error("No image returned");
          }
          console.log("[layers] final step image ready", { idx, prompt: prompt.slice(0, 80), url: url.slice(0, 80) });
          cacheLayeredImage(prompt, url);
          setFinalStepImages((prev) => ({
            ...prev,
            [idx]: { status: "ready", url, prompt },
          }));
        })
        .catch((err: any) => {
          console.warn("[layers] final step image failed", { idx, prompt: prompt.slice(0, 80), error: err?.message });
          setFinalStepImages((prev) => ({
            ...prev,
            [idx]: { status: "error", error: err?.message || "failed", prompt },
          }));
        });
    });
  }, [summaryImagePrompt, summaryImageUrl]);

  const handleLaunch = () => {
    if (!blendedActivity || !blendedOption) return;
    router.push({
      pathname: "/intervention/[layer]",
      params: {
        layer: selectedLayerType,
        data: encodeURIComponent(
          JSON.stringify({
            layerType: selectedLayerType,
            layer: blendedActivity,
            option: blendedOption,
            summary: summaryRecap,
            coherence: coherenceNotes,
          })
        ),
      },
    });
  };

  const handleToggleFriendlyDetails = () => {
    setShowFriendlyDetails((prev) => {
      const next = !prev;
      if (next && !friendlyDetails && !friendlyDetailsLoading) {
        requestFriendlyDetails(friendlyDetailPayload);
      }
      return next;
    });
  };
  const handleToggleSummaryDetails = () => {
    setShowSummaryDetails((prev) => !prev);
  };

  const handleStepNavigate = (stepIndex: number) => {
    const step = finalInstructionSteps[stepIndex];
    const minutes =
      step && typeof step.durationMinutes === "number" && !Number.isNaN(step.durationMinutes)
        ? String(step.durationMinutes)
        : null;
    const target = "/step1";
    const sharedImage = finalStepImages[0];
    const imageUrl =
      sharedImage?.status === "ready" && sharedImage?.url ? sharedImage.url : "";
    const imagePrompt =
      sharedImage?.status === "ready" && sharedImage?.prompt ? sharedImage.prompt : "";
    const combinedDescription = [
      step?.description || "",
      finalInstructionSteps[1]?.description || "",
    ]
      .filter(Boolean)
      .join(" ");
    const uiSpec = "";
    console.log("[layers] navigating to step detail", {
      target,
      minutes,
      title: step?.title || null,
      description: step?.description?.slice(0, 120) || null,
      hasImageUrl: Boolean(imageUrl),
      imagePromptPreview: imagePrompt?.slice(0, 160) || null,
      uiSpecPreview: uiSpec.slice(0, 160),
      combinedDescriptionPreview: combinedDescription.slice(0, 160),
    });
    router.push({
      pathname: target,
      params: {
        stepIndex: String(stepIndex),
        minutes: minutes || undefined,
        title: step?.title || undefined,
        description: step?.description || undefined,
        imageUrl: imageUrl || undefined,
        imagePrompt: imagePrompt || undefined,
        sessionId: sessionId || undefined,
        uiSpec,
        combinedDescription: combinedDescription || undefined,
        conversation: summaryRecap || undefined,
        uxCacheKey: uxPlanCacheKeysRef.current[stepIndex] || undefined,
        paperMode: paperMode ? "1" : undefined,
      },
    } as any);
  };
  const uxReadyForActiveCta =
    uxCtaStepIndex != null && uxPrefetchStatus[uxCtaStepIndex]?.status === "ready";
  const showUxReadyCenter = Boolean(uxReadyForActiveCta && !uxReadyDeferred);

  return (
    <SafeAreaView style={styles.safe}>
      {showUxReadyCenter && uxCtaStepIndex != null ? (
        <View pointerEvents="box-none" style={styles.uxReadyCenterOverlay}>
          <View pointerEvents="auto" style={styles.uxReadyCenterCard}>
            <Text style={styles.uxReadyCenterLabel}>Your interface is ready</Text>
            <Text style={styles.uxReadyCenterTitle}>
              Your personalized interface is ready whenever you want to open it.
            </Text>
            <View style={styles.uxReadyCenterActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setUxReadyDeferred(true);
                  handleStepNavigate(uxCtaStepIndex);
                }}
                style={({ pressed }) => [
                  styles.uxReadyCenterPrimary,
                  pressed && styles.uxReadyCenterPrimaryPressed,
                ]}
              >
                <Text style={styles.uxReadyCenterPrimaryText}>View activity</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setUxReadyDeferred(true)}
                style={({ pressed }) => [
                  styles.uxReadyCenterSecondary,
                  pressed && styles.uxReadyCenterPrimaryPressed,
                ]}
              >
                <Text style={styles.uxReadyCenterSecondaryText}>Later</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.container}>
        <View
          style={[
            styles.finalCard,
            {
              backgroundColor: themeTokens.cardTint,
              borderColor: themeTokens.borderColor,
              shadowColor: themeTokens.baseColor,
            },
          ]}
        >
          {blendedActivity && blendedOption ? (
            <>
              <View style={styles.finalHeader}>
                <View style={styles.finalHeaderLeft}>
                  <Text style={styles.layerLabel}>Do this next</Text>
                  <View>
                    <Text style={styles.layerTitle}>{finalPlanTitle}</Text>
                    <LinearGradient
                      colors={themeTokens.gradient}
                      style={styles.layerTitleUnderline}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                  </View>
                </View>
                <View style={styles.finalHeaderRight}>
                  <LinearGradient
                    colors={themeTokens.emojiGradient}
                    style={styles.headerEmojiBadge}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.headerEmoji}>{activityEmoji}</Text>
                  </LinearGradient>
                  {null}
                </View>
              </View>
              {finalInstructionSteps.length ? (
                <View style={styles.finalStepGrid}>
          {finalInstructionSteps.slice(0, 1).map((step, stepIndex) => {
            const action = splitActionText(step.description);
            const stepLabel = "Steps A & B";
            const glyph = pickStepGlyph(step.description);
            const sharedImage = finalStepImages[0];
            const imageUrl = sharedImage?.status === "ready" ? sharedImage.url : null;
            const isLoading = sharedImage?.status === "loading";
            const isError = sharedImage?.status === "error";
            const uxStatus = uxPrefetchStatus[stepIndex]?.status || "idle";
            const uxElapsed = uxPrefetchStatus[stepIndex]?.elapsedMs || 0;
            const uxReady = uxStatus === "ready";
            const uxWaiting = uxCtaStepIndex === stepIndex;
            const stepMinutes =
              typeof step.durationMinutes === "number" && !Number.isNaN(step.durationMinutes)
                ? step.durationMinutes
                : null;
            return (
              <View
                        key={`final-step-${stepIndex}`}
                        style={[
                          styles.finalStepCard,
                          {
                            borderColor: themeTokens.borderColor,
                            backgroundColor: themeTokens.cardTint,
                          },
                        ]}
                      >
                        {imageUrl ? (
                          <ExpoImage
                            source={{ uri: imageUrl }}
                            style={styles.finalStepImage}
                            contentFit="cover"
                          />
                        ) : (
                          <LinearGradient
                            colors={[themeTokens.gradient[0], themeTokens.gradient[1]]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.finalStepFallback}
                          />
                        )}
                          <LinearGradient
                            colors={["rgba(7,10,22,0.65)", "rgba(7,10,22,0.95)"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={styles.finalStepOverlay}
                          />
                        <View style={styles.finalStepContent}>
                          <View style={styles.finalStepDescriptionShell}>
                            <Text style={styles.finalStepText}>{step.description}</Text>
                            {finalInstructionSteps[1] ? (
                              <>
                                <View style={{ height: 10 }} />
                                <Text style={styles.finalStepText}>{finalInstructionSteps[1].description}</Text>
                              </>
                            ) : null}
                          </View>
                        {!uxWaiting ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              setUxCtaStepIndex(stepIndex);
                              setUxReadyDeferred(false);
                            }}
                            style={({ pressed }) => [
                              styles.finalStepCta,
                              pressed && styles.finalStepCtaPressed,
                            ]}
                          >
                            <Text style={styles.finalStepCtaText}>
                              {"Click here to do the activity"}
                            </Text>
                          </Pressable>
                        ) : uxReady && uxReadyDeferred ? (
                          <View style={styles.finalStepInlineBanner}>
                            <Text style={styles.finalStepInlineBannerTitle}>Your interface is ready.</Text>
                            <Text style={styles.finalStepInlineBannerBody}>
                              Your personalized interface is ready whenever you want to open it.
                            </Text>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => handleStepNavigate(stepIndex)}
                              style={({ pressed }) => [
                                styles.finalStepInlineBannerButton,
                                pressed && styles.finalStepInlineBannerButtonPressed,
                              ]}
                            >
                              <Text style={styles.finalStepInlineBannerButtonText}>View activity</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.finalStepInlineBanner}>
                            <Text style={styles.finalStepInlineBannerTitle}>
                              We are creating a personalized interface for you.
                            </Text>
                            <Text style={styles.finalStepInlineBannerBody}>
                              This usually takes about a minute, sometimes quicker. Multimodal elements can take a bit longer to load. Meanwhile, you can do optional activities below this card.
                            </Text>
                          </View>
                        )}
                          {isLoading ? (
                            <Text style={styles.finalStepStatus}>Painting your scene…</Text>
                          ) : null}
                          {isError ? (
                            <Text style={styles.finalStepStatusError}>
                              Visual not ready yet. We’ll keep the gradient until it arrives.
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {null}
              {/*
              <View style={styles.launchFinalWrap}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleLaunch}
                  style={({ pressed }) => [
                    styles.launchFinalButton,
                    pressed && styles.launchFinalButtonPressed,
                  ]}
                >
                  <Text style={styles.launchFinalLabel}>Start This Activity</Text>
                </Pressable>
              </View>
              */}
            </>
          ) : (
            <>
              <Text style={styles.layerTitle}>Blended activity unavailable</Text>
              <Text style={styles.optionDescription}>
                The final instructions couldn’t load. Try regenerating from your reflection summary.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/")}
                style={({ pressed }) => [
                  styles.restartButton,
                  pressed && styles.restartButtonPressed,
                ]}
              >
                <Text style={styles.restartLabel}>Back to Home</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.optionalBox}>
          <View style={styles.optionalHeader}>
            <Text style={styles.optionalTitle}>Optional activities</Text>
          </View>
        <Pressable
          accessibilityRole="button"
          onPress={handleToggleFriendlyDetails}
          style={({ pressed }) => [
            styles.detailAccordion,
            pressed && styles.optionCardPressed,
          ]}
        >
            <View style={styles.optionCardHeader}>
              <Text style={styles.detailAccordionLabel}>See why this activity fits right now</Text>
              <Text style={styles.optionToggle}>{showFriendlyDetails ? "Hide" : "Show"}</Text>
            </View>
            {showFriendlyDetails ? (
              friendlyDetailsLoading ? (
                <Text style={styles.optionRelevantText}>Crafting a quick explanation…</Text>
              ) : friendlyDetailsError ? (
                <Text style={styles.detailErrorText}>{friendlyDetailsError}</Text>
              ) : friendlyDetails ? (
                <View style={styles.detailAccordionBody}>
                  {friendlyDetails
                    .split(/\n+/)
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, idx) => (
                      <Text key={`friendly-line-${idx}`} style={styles.detailLine}>
                        {line}
                      </Text>
                    ))}
                </View>
              ) : (
                <Text style={styles.optionPlaceholder}>
                  No extra context available yet. Try again shortly.
                </Text>
              )
            ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowAlternatives((prev) => !prev)}
          style={({ pressed }) => [
            styles.detailAccordion,
            pressed && styles.optionCardPressed,
          ]}
        >
          <View style={styles.optionCardHeader}>
            <Text style={styles.detailAccordionLabel}>
              Explore other activities we considered but didn’t recommend
            </Text>
            <Text style={styles.optionToggle}>{showAlternatives ? "Hide" : "Show"}</Text>
          </View>
          {showAlternatives ? (
            <View style={styles.detailAccordionBody}>
              {alternativeBlendItems.length ? (
                <View style={styles.altSection}>
                  {alternativeBlendItems.map((item) => (
                    <View key={`alt-blend-${item.id}`} style={styles.altItem}>
                      <Text style={styles.altTitle}>{item.title}</Text>
                      {item.summary ? <Text style={styles.altWhy}>{normalizeOptionLabels(item.summary)}</Text> : null}
                      {item.steps?.length
                        ? item.steps.map((stepText, idx) => (
                            <Text key={`alt-blend-${item.id}-step-${idx}`} style={styles.altWhy}>
                              • {normalizeOptionLabels(stepText)}
                            </Text>
                          ))
                        : null}
                      {item.why ? <Text style={styles.altWhy}>{normalizeOptionLabels(item.why)}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.optionPlaceholder}>
                  No alternative activities were captured this time.
                </Text>
              )}
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowMoodDetails((prev) => !prev)}
          style={({ pressed }) => [
            styles.moodBox,
            pressed && styles.optionCardPressed,
          ]}
        >
          <View style={styles.optionCardHeader}>
            <Text style={styles.detailAccordionLabel}>Do a simple reflection on your mood</Text>
            <Text style={styles.optionToggle}>{showMoodDetails ? "Hide" : "Show"}</Text>
          </View>
          {showMoodDetails ? (
            <MoodMeterWidget
              selected={moodSelected}
              onToggle={(label) =>
                setMoodSelected((prev) =>
                  prev.includes(label)
                    ? prev.filter((item) => item !== label)
                    : [...prev, label]
                )
              }
              otherEmotions={moodOther}
              onOtherEmotionsChange={setMoodOther}
              showIntro={false}
              layout="two-column"
            />
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleToggleSummaryDetails}
          style={({ pressed }) => [
            styles.detailAccordion,
              pressed && styles.optionCardPressed,
            ]}
          >
            <View style={styles.optionCardHeader}>
              <Text style={styles.detailAccordionLabel}>Revisit summary</Text>
              <Text style={styles.optionToggle}>{showSummaryDetails ? "Hide" : "Show"}</Text>
            </View>
            {showSummaryDetails ? (
              <View style={styles.detailAccordionBody}>
                {userSummaryText ? (
                  <Text style={styles.detailLine}>{userSummaryText}</Text>
                ) : summaryRecap ? (
                  <Text style={styles.detailLine}>{summaryRecap}</Text>
                ) : (
                  <Text style={styles.optionPlaceholder}>No summary available right now.</Text>
                )}
              </View>
            ) : null}
        </Pressable>
        </View>

        {null}

        {/*
          Hidden for now: intervention options table
          {combinationOptions.length
            ? renderCombinationOptions(
                combinationOptions,
                selectedCombination?.option_id,
                integrationRubric,
                describeSourcePlan,
                formatPlanTitle
              )
            : null}
        */}

        {/*
          Hidden for now: cognitive activity ideas and candidates
          {cognitiveActivities.length
            ? renderDesignActivityList("Cognitive activity ideas", cognitiveActivities)
            : renderCandidateList(
                "Cognitive ideas (scored)",
                cognitiveCandidates,
                cognitiveRubric,
                selectedIds?.cognitive
              )}
        */}

        {/*
          Hidden for now: experiential activity ideas and candidates
          {experientialActivities.length
            ? renderDesignActivityList("Experiential activity ideas", experientialActivities)
            : renderCandidateList(
                "Experiential ideas (scored)",
                experientialCandidates,
                experientialRubric,
                selectedIds?.experiential
              )}
        */}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef2ff",
  },
  uxReadyCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 40,
    paddingHorizontal: 20,
  },
  uxReadyCenterCard: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
    ...Platform.select({
      web: { boxShadow: "0 18px 40px rgba(15,23,42,0.38)" },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.28,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      },
    }),
  },
  uxReadyCenterLabel: {
    fontSize: 12,
    color: "#93c5fd",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  uxReadyCenterTitle: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: "800",
    color: "#f8fafc",
    lineHeight: 32,
  },
  uxReadyCenterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  uxReadyCenterPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#2563eb",
    alignSelf: "flex-start",
  },
  uxReadyCenterPrimaryPressed: {
    opacity: 0.88,
  },
  uxReadyCenterPrimaryText: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
  },
  uxReadyCenterSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(191, 219, 254, 0.8)",
    backgroundColor: "rgba(30, 41, 59, 0.7)",
    alignSelf: "flex-start",
  },
  uxReadyCenterSecondaryText: {
    color: "#dbeafe",
    fontSize: 14,
    fontWeight: "600",
  },
  uxBanner: {
    marginTop: 16,
    marginHorizontal: 20,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 12,
    borderRadius: 16,
    backgroundColor: "#0f172a",
  },
  uxBannerTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  uxBannerBody: {
    marginTop: 6,
    color: "#cbd5f5",
    fontSize: 13,
    lineHeight: 18,
  },
  uxBannerButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#3b82f6",
  },
  uxBannerButtonPressed: {
    opacity: 0.85,
  },
  uxBannerButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  container: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 28,
    gap: 24,
  },
  header: {
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    color: "#334155",
  },
  coherenceTag: {
    borderRadius: 16,
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.18)",
    padding: 12,
    gap: 6,
  },
  coherenceLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.3,
  },
  coherenceText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#1e293b",
  },
  reasoningCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.25)",
    backgroundColor: "rgba(219, 234, 254, 0.45)",
    padding: 12,
    gap: 6,
  },
  reasoningHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
  },
  reasoningBullet: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  totalDuration: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
  },
  generationTime: {
    fontSize: 12,
    color: "#64748b",
  },
  finalCard: {
    borderRadius: 22,
    borderWidth: 1,
    backgroundColor: "#fff",
    padding: 20,
    gap: 14,
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  finalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  finalHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  finalHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  finalStepGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 10,
  },
  finalStepCard: {
    position: "relative",
    minHeight: 560,
    flex: 1,
    width: "48%",
    minWidth: 280,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    ...Platform.select({
      web: { boxShadow: "0 16px 32px rgba(15,23,42,0.18)" },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 10 },
        elevation: 5,
      },
    }),
  },
  finalStepCardPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.92,
  },
  finalStepImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.92,
  },
  finalStepFallback: {
    ...StyleSheet.absoluteFillObject,
  },
  finalStepOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  finalStepContent: {
    flex: 1,
    padding: 18,
    justifyContent: "flex-end",
    gap: 8,
  },
  finalStepInlineBanner: {
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(191, 219, 254, 0.5)",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  finalStepInlineBannerTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  finalStepInlineBannerBody: {
    color: "#dbeafe",
    fontSize: 13,
    lineHeight: 18,
  },
  finalStepInlineBannerButton: {
    marginTop: 2,
    alignSelf: "flex-start",
    borderRadius: 10,
    backgroundColor: "#2563eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  finalStepInlineBannerButtonPressed: {
    opacity: 0.88,
  },
  finalStepInlineBannerButtonText: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "700",
  },
  finalStepTopRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  finalStepLabelWrap: {
    position: "absolute",
    top: 16,
    left: 16,
    zIndex: 5,
  },
  finalStepMinutesWrap: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 5,
  },
  finalStepMinutesBadge: {
    fontSize: 13,
    fontWeight: "700",
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  finalStepLetter: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  finalStepLetterText: {
    color: "#0b1224",
    fontWeight: "800",
    fontSize: 16,
  },
  finalStepBadge: {
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "rgba(0,0,0,0.58)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    color: "#f8fafc",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    letterSpacing: 0.4,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    textTransform: "uppercase",
  },
  finalStepTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  finalStepDescriptionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  finalStepDescriptionShell: {
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    ...Platform.select({
      web: { backdropFilter: "blur(2px)" },
      default: {},
    }),
  },
  finalStepGlyph: {
    fontSize: 22,
    color: "#f8fafc",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  finalStepText: {
    color: "#f8fafc",
    fontSize: 16,
    lineHeight: 24,
    flex: 1,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  finalStepVerb: {
    fontWeight: "800",
    color: "#f8fafc",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  finalStepUnderline: {
    height: 3,
    width: 82,
    borderRadius: 999,
    marginTop: 6,
    marginBottom: 10,
  },
  finalStepStatus: {
    marginTop: 6,
    color: "#cbd5e1",
    fontSize: 13,
  },
  finalStepCta: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
  },
  finalStepCtaDisabled: {
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    borderColor: "rgba(148, 163, 184, 0.35)",
  },
  finalStepCtaPressed: {
    opacity: 0.85,
  },
  finalStepCtaText: {
    color: "#f8fafc",
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  finalStepStatusError: {
    marginTop: 6,
    color: "#fecdd3",
    fontSize: 13,
    fontWeight: "700",
  },
  integrationCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.18)",
    backgroundColor: "rgba(219, 234, 254, 0.45)",
    padding: 16,
    gap: 10,
    marginTop: 18,
  },
  integrationSummary: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
  },
  integrationGroup: {
    gap: 8,
    marginTop: 6,
  },
  integrationGroupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  integrationTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  integrationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  integrationLabelCol: {
    flex: 1,
    gap: 4,
  },
  integrationLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f1f4b",
  },
  integrationDescription: {
    fontSize: 12,
    color: "#334155",
  },
  integrationScoreCol: {
    width: 120,
    gap: 4,
    alignItems: "flex-end",
  },
  integrationScore: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  integrationNote: {
    fontSize: 12,
    color: "#1f2937",
    textAlign: "right",
  },
  interventionTableCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.18)",
    backgroundColor: "#fff",
    padding: 12,
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: "0px 12px 24px rgba(37, 99, 235, 0.12)",
      },
      default: {
        shadowColor: "#1d4ed8",
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      },
    }),
  },
  interventionTableHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  interventionTableScroll: {
    paddingBottom: 4,
    paddingRight: 8,
  },
  interventionTableGrid: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 1)",
  },
  interventionTableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderColor: "rgba(226, 232, 240, 1)",
  },
  interventionTableHeaderRow: {
    backgroundColor: "rgba(226, 232, 240, 0.35)",
  },
  interventionTableCell: {
    padding: 12,
    minWidth: 240,
    flex: 1,
    borderRightWidth: 1,
    borderColor: "rgba(226, 232, 240, 1)",
  },
  interventionTableKeyCell: {
    backgroundColor: "rgba(226, 232, 240, 0.35)",
    minWidth: 220,
    flexShrink: 0,
  },
  interventionTableColumnCell: {
    backgroundColor: "#ffffff",
  },
  interventionTableTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f1f4b",
  },
  interventionTableDuration: {
    fontSize: 12,
    color: "#334155",
    marginTop: 2,
  },
  interventionSelectedBadge: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "700",
    color: "#1d4ed8",
    paddingVertical: 2,
    paddingHorizontal: 8,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  interventionTableSummary: {
    fontSize: 12,
    color: "#475569",
    marginTop: 4,
    lineHeight: 16,
  },
  interventionTableKeyLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f1f4b",
  },
  interventionTableKeyHint: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
    lineHeight: 16,
  },
  interventionGroupBlock: {
    backgroundColor: "#ffffff",
  },
  interventionGroupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "rgba(226, 232, 240, 1)",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  interventionScoreValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e3a8a",
  },
  interventionScoreNote: {
    marginTop: 2,
    fontSize: 12,
    color: "#475569",
    lineHeight: 16,
  },
  interventionSelectedColumn: {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderColor: "rgba(59, 130, 246, 0.35)",
  },
  interventionStepList: {
    marginTop: 8,
    gap: 4,
  },
  interventionStepRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  interventionStepBullet: {
    fontSize: 12,
    color: "#0f1f4b",
    marginTop: 2,
  },
  interventionStepText: {
    flex: 1,
    fontSize: 12,
    color: "#1f2937",
    lineHeight: 16,
  },
  candidatesSection: {
    gap: 12,
    marginTop: 18,
  },
  candidatesHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  candidateCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 10,
  },
  candidateCardPressed: {
    opacity: 0.9,
  },
  candidateCardSelected: {
    borderColor: "#1d4ed8",
    backgroundColor: "rgba(191, 219, 254, 0.65)",
  },
  candidateCardStatic: {
    opacity: 0.95,
  },
  candidateHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  candidateTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f1f4b",
  },
  candidateMeta: {
    flexDirection: "row",
    gap: 8,
  },
  candidateBadge: {
    fontSize: 12,
    color: "#1d4ed8",
    fontWeight: "600",
  },
  candidateSelectedTag: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "700",
    color: "#0f1f4b",
    backgroundColor: "rgba(96, 165, 250, 0.35)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  candidateTheme: {
    fontSize: 13,
    color: "#1e3a8a",
    fontStyle: "italic",
  },
  candidateGoal: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  candidateAlignment: {
    fontSize: 12,
    color: "#1f2937",
  },
  reasoningList: {
    gap: 4,
    marginTop: 6,
  },
  candidateOptions: {
    gap: 8,
  },
  candidateOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1d2a6b",
  },
  candidateOptionDescription: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  candidateOptionWhy: {
    fontSize: 12,
    color: "#2563eb",
  },
  candidateOptionPrinciple: {
    fontSize: 12,
    color: "#0f172a",
    fontStyle: "italic",
  },
  candidateSummaryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.2)",
    backgroundColor: "#fff",
    padding: 16,
    gap: 12,
  },
  candidateListCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.18)",
    backgroundColor: "rgba(255,255,255,0.95)",
    padding: 16,
    gap: 12,
  },
  candidateSummarySelected: {
    borderColor: "#2563eb",
    backgroundColor: "rgba(219, 234, 254, 0.4)",
  },
  candidateSummaryHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  candidateSummaryTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f1f4b",
  },
  candidateGoalText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
  },
  candidateSummaryNotes: {
    fontSize: 13,
    color: "#1f2937",
  },
  candidateActions: {
    marginTop: 6,
    gap: 4,
  },
  candidateActionsLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  candidateActionText: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
  },
  candidateReasoningText: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  candidateSummaryScores: {
    gap: 6,
  },
  candidateScoreGroup: {
    gap: 6,
  },
  candidateScoreGroupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  candidateSummaryScoreRow: {
    gap: 4,
  },
  candidateSummaryScoreHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  candidateSummaryScoreLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  candidateSummaryScoreValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  candidateSummaryScoreNote: {
    fontSize: 12,
    color: "#1f2937",
  },
  candidateScores: {
    gap: 6,
  },
  candidateScoreRow: {
    gap: 4,
  },
  candidateScoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  candidateScoreLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  candidateScoreValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
  },
  candidateScoreNote: {
    flexBasis: "100%",
    fontSize: 12,
    color: "#1f2937",
  },
  layerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(30, 64, 175, 0.16)",
    backgroundColor: "#ffffff",
    padding: 18,
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: "0px 16px 26px rgba(15, 23, 42, 0.12)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 12 },
        elevation: 8,
      },
    }),
  },
  layerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  layerLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.3,
    fontFamily: FONT.label,
  },
  layerDuration: {
    fontSize: 12,
    color: "#64748b",
    fontFamily: FONT.label,
  },
  headerEmojiBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  headerEmoji: {
    fontSize: 20,
    fontFamily: FONT.title,
  },
  layerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: "#111c44",
    fontFamily: FONT.title,
  },
  optionDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: "#334155",
    fontFamily: FONT.body,
  },
  layerTitleUnderline: {
    height: 4,
    borderRadius: 999,
    marginTop: 6,
    width: 120,
  },
  layerTheme: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#334155",
    fontFamily: FONT.body,
  },
  layerGoal: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e40af",
    fontFamily: FONT.bodyBold,
  },
  layerAlignment: {
    fontSize: 13,
    color: "#1f2937",
    fontFamily: FONT.body,
  },
  optionPlainSummary: {
    fontSize: 15,
    color: "#0f1f4b",
    lineHeight: 22,
    marginTop: 4,
    fontFamily: FONT.body,
  },
  designListCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.15)",
    gap: 12,
  },
  designListHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  designListGrid: {
    gap: 12,
  },
  designCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.15)",
    backgroundColor: "#f8fbff",
    padding: 14,
    gap: 8,
  },
  designCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  designCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  designCardTheme: {
    fontSize: 13,
    color: "#1f3c88",
  },
  designCardDuration: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  designCardContext: {
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 20,
  },
  designCardGoal: {
    fontSize: 13,
    color: "#0f172a",
  },
  designTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  designTag: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  designSteps: {
    gap: 4,
  },
  designStepText: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
  },
  optionRelevant: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: "rgba(226, 232, 240, 0.7)",
    padding: 12,
    gap: 4,
  },
  optionCardPressed: {
    opacity: 0.9,
  },
  optionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionToggle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    fontFamily: FONT.label,
  },
  optionRelevantLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  optionRelevantText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
    fontFamily: FONT.body,
  },
  detailAccordion: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(191, 219, 254, 0.45)",
    gap: 6,
  },
  detailAccordionBody: {
    marginTop: 8,
    gap: 6,
  },
  altSection: {
    gap: 8,
    marginTop: 4,
  },
  altSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1e3a8a",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  altItem: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(219, 234, 254, 0.55)",
    gap: 4,
  },
  altTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: FONT.heading,
  },
  altSummary: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  altWhy: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 17,
    fontFamily: FONT.body,
  },
  detailAccordionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "none",
    letterSpacing: 0,
    fontFamily: FONT.heading,
  },
  detailLine: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
    fontFamily: FONT.body,
  },
  optionPlaceholder: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  optionalBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
    backgroundColor: "rgba(219, 234, 254, 0.35)",
    gap: 12,
  },
  optionalHeader: {
    gap: 4,
  },
  optionalTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d2a6b",
    fontFamily: FONT.heading,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  optionalSubtitle: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  moodBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(219, 234, 254, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
    gap: 10,
  },
  moodTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  moodSubtitle: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  optionEnjoyment: {
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    gap: 4,
  },
  optionEnjoymentLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  optionEnjoymentText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
    fontFamily: FONT.body,
  },
  detailErrorText: {
    fontSize: 13,
    color: "#b91c1c",
  },
  buildToggle: {
    marginTop: 16,
  },
  segmentCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.18)",
    backgroundColor: "#fff",
    padding: 16,
    gap: 10,
  },
  segmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  segmentHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  segmentHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  segmentBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  segmentDuration: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
    fontFamily: FONT.label,
  },
  segmentIllustration: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  segmentIllustrationEmoji: {
    fontSize: 18,
    fontFamily: FONT.title,
  },
  segmentTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f172a",
  },
  segmentDescription: {
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 20,
  },
  segmentPlanTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  segmentPlanContext: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
    marginTop: 4,
  },
  segmentInstructionList: {
    gap: 10,
  },
  segmentInstructionTextWrap: {
    flex: 1,
    gap: 4,
  },
  segmentInstructionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: FONT.bodyBold,
  },
  stepChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 8,
  },
  stepChipHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  stepChipIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepChipIconText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
    fontFamily: FONT.label,
  },
  stepChipText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
    fontFamily: FONT.body,
  },
  stepActionVerb: {
    fontWeight: "700",
    color: "#1d4ed8",
    fontFamily: FONT.bodyBold,
  },
  stepChipBodyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  stepChipGlyph: {
    fontSize: 16,
    fontFamily: FONT.label,
  },
  segmentEnjoyment: {
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: "rgba(226, 232, 240, 0.65)",
    padding: 10,
    gap: 4,
  },
  segmentEnjoymentLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  segmentEnjoymentText: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
  },
  segmentTechnique: {
    fontSize: 12,
    color: "#475569",
    fontStyle: "italic",
  },
  launchFinalWrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(15, 23, 42, 0.08)",
  },
  launchFinalButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: "#1d4ed8",
    paddingVertical: 12,
    alignItems: "center",
  },
  launchFinalButtonPressed: {
    opacity: 0.85,
  },
  launchFinalLabel: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: FONT.heading,
  },
  comboListCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.18)",
    backgroundColor: "#fff",
    padding: 16,
    gap: 12,
  },
  comboList: {
    gap: 12,
  },
  comboCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.4)",
    padding: 14,
    gap: 8,
    backgroundColor: "#f8fafc",
  },
  comboCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  comboHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  comboTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: FONT.heading,
  },
  comboBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#2563eb",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontFamily: FONT.label,
  },
  comboSummary: {
    fontSize: 14,
    color: "#1f2937",
    lineHeight: 20,
    fontFamily: FONT.body,
  },
  comboReasoning: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
    fontStyle: "italic",
    fontFamily: FONT.body,
  },
  comboSources: {
    marginTop: 4,
    gap: 2,
  },
  comboSourceText: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  comboLayers: {
    gap: 10,
    marginTop: 6,
  },
  comboLayerSection: {
    gap: 4,
  },
  comboLayerHeading: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT.heading,
  },
  comboLayerStep: {
    fontSize: 13,
    color: "#0f172a",
    lineHeight: 18,
    fontFamily: FONT.body,
  },
  restartButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "rgba(191, 219, 254, 0.45)",
  },
  restartButtonPressed: {
    opacity: 0.85,
  },
  restartLabel: {
    color: "#1d4ed8",
    fontSize: 14,
    fontWeight: "600",
  },
});
