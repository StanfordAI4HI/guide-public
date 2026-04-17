import React, { useMemo, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { BlockDescriptor, BlockLayout } from "./block-types";

type LayerOption = {
  option_id?: string;
  label?: string;
  description?: string;
  duration_minutes?: number;
  why_it_helps?: string;
  principle?: string;
};

type SupportLayer = {
  title?: string;
  theme?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
  options?: LayerOption[];
};

type LayeredCandidate = {
  candidate_id?: string;
  title?: string;
  theme?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
};

type RunnerPayload = {
  layerType?: "cognitive" | "experiential" | "blended";
  layer?: SupportLayer | null;
  candidate?: LayeredCandidate | null;
  option?: LayerOption | null;
  summary?: string;
  coherence?: string;
  blocks?: BlockDescriptor[];
  layout?: BlockLayout;
};

type PrimitiveId =
  | "text_reflection"
  | "voice_expression"
  | "visualization_prompt"
  | "action_planning"
  | "sensory_capture";

const KEYWORD_MAP: Array<{
  primitive: PrimitiveId;
  keywords: string[];
  principles?: string[];
  layerBias?: "cognitive" | "experiential";
}> = [
  {
    primitive: "text_reflection",
    keywords: ["write", "journal", "note", "letter", "script", "compose", "respond", "story"],
    principles: [
      "self-compassion",
      "values clarification",
      "cognitive restructuring",
      "reappraisal",
      "cognitive defusion",
    ],
    layerBias: "cognitive",
  },
  {
    primitive: "voice_expression",
    keywords: ["record", "voice", "say", "speak", "audio", "out loud", "dialogue"],
    principles: ["exposure", "role-play", "communication rehearsal", "chair work"],
  },
  {
    primitive: "visualization_prompt",
    keywords: ["imagine", "visualize", "picture", "see", "scene", "movie", "future you"],
    principles: ["savoring", "guided imagery", "visualization"],
  },
  {
    primitive: "action_planning",
    keywords: ["plan", "steps", "experiment", "try", "schedule", "practice", "goal", "commit"],
    principles: ["implementation intentions", "problem-solving", "behavioural activation"],
    layerBias: "experiential",
  },
  {
    primitive: "sensory_capture",
    keywords: ["photo", "capture", "clip", "observe", "notice", "recording", "snapshot", "sound"],
    principles: ["mindfulness", "sensory grounding", "savoring"],
    layerBias: "experiential",
  },
];

const formatMinutes = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value} min`;
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
);

const SectionCard = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.sectionCard}>{children}</View>
);

export default function InterventionRunnerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const routeLayerParam = typeof params?.layer === "string" ? params.layer : undefined;

  const payload: RunnerPayload = useMemo(() => {
    const raw = typeof params?.data === "string" ? params.data : "";
    if (!raw) return {};
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch (err) {
      console.warn("Failed to parse intervention payload:", err);
      return {};
    }
  }, [params]);

  const routeLayerType: "cognitive" | "experiential" | "blended" =
    routeLayerParam === "experiential" || routeLayerParam === "blended"
      ? (routeLayerParam as "experiential" | "blended")
      : "cognitive";
  const layerType: "cognitive" | "experiential" | "blended" =
    payload?.layerType === "experiential" ||
    payload?.layerType === "blended" ||
    payload?.layerType === "cognitive"
      ? payload.layerType
      : routeLayerType;
  const option = payload?.option ?? null;
  const layer = payload?.layer ?? null;

  const candidate = payload?.candidate ?? null;

  const lowerText = [
    option?.label,
    option?.description,
    option?.why_it_helps,
    option?.principle,
  ]
    .join(" ")
    .toLowerCase();

  const detectedPrimitives = useMemo(() => {
    const primitives = new Set<PrimitiveId>();
    KEYWORD_MAP.forEach(({ primitive, keywords, principles = [], layerBias }) => {
      if (layerBias && layerType !== "blended" && layerBias !== layerType) return;
      const matchesKeyword = keywords.some((keyword) => lowerText.includes(keyword));
      const principleMatches = principles.some((principle) =>
        (option?.principle || "").toLowerCase().includes(principle)
      );
      if (matchesKeyword || principleMatches) {
        primitives.add(primitive);
      }
    });
    if (primitives.size === 0) {
      primitives.add(layerType === "cognitive" ? "text_reflection" : "action_planning");
    }
    return Array.from(primitives);
  }, [layerType, lowerText, option?.principle]);

  const [textReflectionEntry, setTextReflectionEntry] = useState("");
  const [voiceNotes, setVoiceNotes] = useState("");
  const [visualizationNotes, setVisualizationNotes] = useState("");
  const [actionGoal, setActionGoal] = useState("");
  const [actionStep, setActionStep] = useState("");
  const [actionSupport, setActionSupport] = useState("");
  const [actionWhen, setActionWhen] = useState("");
  const [sensoryNotes, setSensoryNotes] = useState("");
  const [sketchNotes, setSketchNotes] = useState("");
  const [reportNotes, setReportNotes] = useState("");
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({});
  const [rating, setRating] = useState<number | null>(null);
  const [evaluationNotes, setEvaluationNotes] = useState("");
  const [completed, setCompleted] = useState(false);

  const blockPlan: BlockDescriptor[] = useMemo(() => {
    const normalizeBlock = (block: BlockDescriptor, fallbackId?: string, depth = 0): BlockDescriptor => {
      const id = block.id || fallbackId || `block-${depth}-${Math.random().toString(36).slice(2, 6)}`;
      const prompt = block.prompt ?? (block.props?.prompt as string | undefined);
      const details = block.details ?? (Array.isArray(block.props?.details) ? (block.props?.details as string[]) : undefined);
      const minutes = block.minutes ?? (typeof block.props?.minutes === "number" ? block.props.minutes : undefined);
      const steps = block.steps ?? (Array.isArray(block.props?.steps) ? (block.props?.steps as string[]) : undefined);
      const children = block.children?.map((child, childIndex) => normalizeBlock(child, `${id}-child-${childIndex}`, depth + 1));
      return {
        ...block,
        id,
        prompt,
        details,
        minutes,
        steps,
        children,
      };
    };

    if (payload?.layout?.blocks?.length) {
      const layout = payload.layout;
      const nodeMap = new Map<string, BlockDescriptor>();
      layout.blocks.forEach((node) => {
        nodeMap.set(node.id, node);
      });

      const cloneNode = (node: BlockDescriptor): BlockDescriptor => {
        const prompt = node.prompt ?? (node.props?.prompt as string | undefined);
        const details = node.details ?? (Array.isArray(node.props?.details) ? (node.props?.details as string[]) : undefined);
        const minutes = node.minutes ?? (typeof node.props?.minutes === "number" ? node.props.minutes : undefined);
        const steps = node.steps ?? (Array.isArray(node.props?.steps) ? (node.props?.steps as string[]) : undefined);
        const children = node.children?.map((child, idx) => {
          const resolved = child.id ? nodeMap.get(child.id) ?? child : child;
          return cloneNode(resolved);
        });
        return {
          ...node,
          prompt,
          details,
          minutes,
          steps,
          children,
        };
      };

      const visited = new Set<string>();
      const order: BlockDescriptor[] = [];

      const walk = (nodeId?: string | null) => {
        if (!nodeId) return;
        const node = nodeMap.get(nodeId);
        if (!node || visited.has(nodeId)) return;
        visited.add(nodeId);
        const cloned = cloneNode(node);
        order.push(cloned);
        if (node.next) {
          walk(node.next);
        }
      };

      walk(layout.start_block_id);
      layout.blocks.forEach((node) => {
        if (!visited.has(node.id)) {
          walk(node.id);
        }
      });

      return order.map((block, index) => normalizeBlock(block, `block-${index}`));
    }

    if (Array.isArray(payload?.blocks) && payload.blocks.length > 0) {
      return payload.blocks.map((block, index) => normalizeBlock(block, `block-${index}`));
    }

    let counter = 0;
    const nextId = (prefix: string) => `${prefix}-${counter++}`;

    const fallbackBlocks: BlockDescriptor[] = [];
    fallbackBlocks.push(
      normalizeBlock(
        {
          id: nextId("instruction"),
          type: "instruction",
          title: layer?.title || option?.label || "Activity Overview",
          prompt: option?.description,
          details: [option?.why_it_helps || "", layer?.goal || ""].filter(Boolean) as string[],
          minutes: option?.duration_minutes || 10,
        }
      )
    );

    detectedPrimitives.forEach((primitive) => {
      const id = nextId(`primitive-${primitive}`);
      switch (primitive) {
        case "text_reflection":
          fallbackBlocks.push(
            normalizeBlock({
              id,
              type: "reflection",
              title: "Write a reflection",
              prompt: option?.description || "Capture a few sentences about what stands out right now.",
            })
          );
          break;
        case "voice_expression":
          fallbackBlocks.push(
            normalizeBlock({
              id,
              type: "voice",
              title: "Voice expression",
              prompt: "Speak the new perspective out loud, then jot key phrases below.",
            })
          );
          break;
        case "visualization_prompt":
          fallbackBlocks.push(
            normalizeBlock({
              id,
              type: "visualization",
              title: "Visualization",
              prompt: "Close your eyes for a minute and imagine this moment with your new outlook.",
              minutes: 2,
            })
          );
          break;
        case "action_planning":
          fallbackBlocks.push(
            normalizeBlock({
              id,
              type: "action_plan",
              title: "Plan a micro action",
              prompt: "Turn this insight into a tiny next step you can try within 24 hours.",
            })
          );
          break;
        case "sensory_capture":
          fallbackBlocks.push(
            normalizeBlock({
              id,
              type: "sensory",
              title: "Sensory snapshot",
              prompt: "Capture or describe a sensory cue that represents the shift.",
            })
          );
          break;
        default:
          break;
      }
    });

    fallbackBlocks.push(
      normalizeBlock({
        id: nextId("evaluation"),
        type: "evaluation",
        title: "Wrap-up",
        prompt: "How helpful was this activity? Give it a rating and jot a quick note.",
      })
    );

    return fallbackBlocks;
  }, [
    detectedPrimitives,
    layer?.goal,
    layer?.title,
    option?.description,
    option?.duration_minutes,
    option?.label,
    option?.why_it_helps,
    payload?.blocks,
    payload?.layout,
  ]);
  const renderBlock = (block: BlockDescriptor, index: number): React.ReactNode => {
    const key = block.id ?? `block-${index}`;
    const promptText = block.prompt ?? (block.props?.prompt as string | undefined);
    const detailList = block.details ?? (Array.isArray(block.props?.details) ? (block.props?.details as string[]) : undefined);
    const minuteValue = block.minutes ?? (typeof block.props?.minutes === "number" ? block.props.minutes : undefined);
    const stepList = block.steps ?? (Array.isArray(block.props?.steps) ? (block.props?.steps as string[]) : undefined);
    const childElements = block.children?.map((child, childIndex) => (
      <React.Fragment key={`${key}-child-${child.id ?? childIndex}`}>
        {renderBlock(child, childIndex)}
      </React.Fragment>
    ));

    switch (block.type) {
      case "instruction":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Activity Overview"}</SectionTitle>
            {block.subtitle ? <Text style={styles.sectionBody}>{block.subtitle}</Text> : null}
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            {detailList?.map((detail, detailIndex) => (
              <Text key={`${key}-detail-${detailIndex}`} style={styles.sectionBody}>
                • {detail}
              </Text>
            ))}
            {minuteValue ? (
              <Text style={styles.sectionMeta}>Approx. {formatMinutes(minuteValue)}</Text>
            ) : null}
            {childElements}
          </SectionCard>
        );
      case "reflection":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Reflect"}</SectionTitle>
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Capture your thoughts here..."
              value={textReflectionEntry}
              onChangeText={setTextReflectionEntry}
            />
            {childElements}
          </SectionCard>
        );
      case "voice":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Voice Expression"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Speak the new perspective aloud (record if you’d like) and jot the highlights."}
            </Text>
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Key phrases or takeaways from what you said..."
              value={voiceNotes}
              onChangeText={setVoiceNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "visualization":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Visualization"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Close your eyes and imagine the moment with your new outlook."}
            </Text>
            {minuteValue ? (
              <Text style={styles.sectionMeta}>Suggested time: {formatMinutes(minuteValue)}</Text>
            ) : null}
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="What did you picture? How did it feel?"
              value={visualizationNotes}
              onChangeText={setVisualizationNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "steps":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Step-by-step"}</SectionTitle>
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            <View style={styles.stepList}>
              {(stepList || []).map((step, stepIndex) => {
                const stepKey = `${key}-step-${stepIndex}`;
                const checked = stepChecks[stepKey] ?? false;
                return (
                  <Pressable
                    key={stepKey}
                    accessibilityRole="button"
                    onPress={() => setStepChecks((prev) => ({ ...prev, [stepKey]: !checked }))}
                    style={({ pressed }) => [styles.stepRow, pressed && styles.stepRowPressed]}
                  >
                    <View style={[styles.stepCheckbox, checked && styles.stepCheckboxChecked]}>
                      {checked ? <Text style={styles.stepCheckboxMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.stepLabel}>{step}</Text>
                  </Pressable>
                );
              })}
            </View>
            {childElements}
          </SectionCard>
        );
      case "action_plan":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Action Plan"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Turn this insight into a tiny next step you can try soon."}
            </Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Goal or intention</Text>
              <TextInput
                style={styles.singleLineInput}
                placeholder="e.g., Reach out to Jamie with a kinder reframe"
                value={actionGoal}
                onChangeText={setActionGoal}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>First micro-step</Text>
              <TextInput
                style={styles.singleLineInput}
                placeholder="What will you do first?"
                value={actionStep}
                onChangeText={setActionStep}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Support or reminder</Text>
              <TextInput
                style={styles.singleLineInput}
                placeholder="Who/what helps you follow through?"
                value={actionSupport}
                onChangeText={setActionSupport}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>When will you try it?</Text>
              <TextInput
                style={styles.singleLineInput}
                placeholder="Add time / context"
                value={actionWhen}
                onChangeText={setActionWhen}
              />
            </View>
            {childElements}
          </SectionCard>
        );
      case "sensory":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Sensory snapshot"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Capture or describe a sensory cue that represents the shift."}
            </Text>
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Describe what you observed, heard, or captured..."
              value={sensoryNotes}
              onChangeText={setSensoryNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "sketch":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Sketch"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Sketch or map out the idea visually. If you draw on paper, note the highlights below."}
            </Text>
            <View style={styles.sketchPadPlaceholder}>
              <Text style={styles.sketchPadText}>
                Sketch space — use paper or tablet, then note key details.
              </Text>
            </View>
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Describe your sketch, or paste a link to it..."
              value={sketchNotes}
              onChangeText={setSketchNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "report":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Report back"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "Summarize what happened, any blockers, and what support you might need."}
            </Text>
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Share the details here..."
              value={reportNotes}
              onChangeText={setReportNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "timer":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Timer"}</SectionTitle>
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            {minuteValue ? (
              <View style={styles.timerBadge}>
                <Text style={styles.timerBadgeLabel}>{formatMinutes(minuteValue)}</Text>
              </View>
            ) : null}
            {childElements}
          </SectionCard>
        );
      case "evaluation":
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Wrap-up"}</SectionTitle>
            <Text style={styles.sectionBody}>
              {promptText || "How helpful did this feel? Rate it and jot a note."}
            </Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={`${key}-rating-${value}`}
                  accessibilityRole="button"
                  onPress={() => setRating(value)}
                  style={[styles.ratingChip, rating === value && styles.ratingChipActive]}
                >
                  <Text style={[styles.ratingChipLabel, rating === value && styles.ratingChipLabelActive]}>
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.multilineInput}
              multiline
              placeholder="Reflection, learnings, or notes..."
              value={evaluationNotes}
              onChangeText={setEvaluationNotes}
            />
            {childElements}
          </SectionCard>
        );
      case "container":
        return (
          <SectionCard key={key}>
            {block.title ? <SectionTitle>{block.title}</SectionTitle> : null}
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            {childElements}
          </SectionCard>
        );
      default:
        return (
          <SectionCard key={key}>
            <SectionTitle>{block.title || "Activity"}</SectionTitle>
            {promptText ? <Text style={styles.sectionBody}>{promptText}</Text> : null}
            <Text style={styles.sectionBody}>
              Unsupported block type: {block.type}. Update the lab renderer to handle this block.
            </Text>
            {childElements}
          </SectionCard>
        );
    }
  };
  const handleComplete = () => {
    if (!option) return;
    const completionPayload = {
      layerType,
      optionId: option.option_id,
      primitives: detectedPrimitives,
      blocks: blockPlan,
      outputs: {
        textReflection: textReflectionEntry,
        voiceSummary: voiceNotes,
        visualizationSummary: visualizationNotes,
        actionPlan: {
          goal: actionGoal,
          firstStep: actionStep,
          support: actionSupport,
          when: actionWhen,
        },
        steps: stepChecks,
        sensorySummary: sensoryNotes,
        sketchNotes,
        reportNotes,
        evaluation: {
          rating,
          note: evaluationNotes,
        },
      },
    };
    console.log("[intervention-completed]", completionPayload);
    setCompleted(true);
    Alert.alert("Nice work!", "Your activity notes are saved for this session.");
  };

  const layerLabel = layerType === "cognitive" ? "Cognitive Layer" : "Experiential Layer";
  if (!layer || !option) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.optionTitle}>Activity not found</Text>
          <Text style={styles.optionDescription}>
            This activity could not be loaded. Please go back and select it again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.backButtonLabel}>Back</Text>
          </Pressable>
          <Text style={styles.layerBadge}>{layerLabel}</Text>
          <Text style={styles.optionTitle}>{option.label || "Selected Activity"}</Text>
          {layer.goal ? <Text style={styles.goalText}>{layer.goal}</Text> : null}
          {option.description ? (
            <Text style={styles.optionDescription}>{option.description}</Text>
          ) : null}
          {option.why_it_helps ? (
            <Text style={styles.optionWhy}>{option.why_it_helps}</Text>
          ) : null}
          <View style={styles.metaRow}>
            {!!option.duration_minutes && (
              <Text style={styles.metaBadge}>{formatMinutes(option.duration_minutes)}</Text>
            )}
            {option.option_id ? (
              <Text style={styles.metaBadge}>#{option.option_id}</Text>
            ) : null}
            {option.principle ? (
              <Text style={styles.metaBadge}>Technique: {option.principle}</Text>
            ) : null}
          </View>
        </View>

        {candidate?.alignment_notes ? (
          <SectionCard>
            <SectionTitle>Why this bundle fits</SectionTitle>
            <Text style={styles.sectionBody}>{candidate.alignment_notes}</Text>
          </SectionCard>
        ) : null}

        {blockPlan.map((block, index) => renderBlock(block, index))}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={handleComplete}
            style={({ pressed }) => [
              styles.completeButton,
              pressed && styles.completeButtonPressed,
            ]}
          >
            <Text style={styles.completeButtonLabel}>
              {completed ? "Activity Logged" : "Mark Activity Complete"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f1f5ff",
  },
  container: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 28,
    gap: 18,
  },
  header: {
    gap: 12,
  },
  backButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
  },
  backButtonPressed: {
    opacity: 0.8,
  },
  backButtonLabel: {
    fontSize: 13,
    color: "#1d4ed8",
    fontWeight: "600",
  },
  layerBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(30, 64, 175, 0.12)",
    color: "#1d4ed8",
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  optionTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#132f74",
  },
  goalText: {
    fontSize: 15,
    color: "#1f2937",
    fontWeight: "600",
  },
  optionDescription: {
    fontSize: 14,
    color: "#334155",
    lineHeight: 20,
  },
  optionWhy: {
    fontSize: 13,
    color: "#2563eb",
    fontStyle: "italic",
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metaBadge: {
    backgroundColor: "rgba(191, 219, 254, 0.65)",
    color: "#1d4ed8",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  sectionBody: {
    fontSize: 14,
    color: "#334155",
    lineHeight: 20,
  },
  sectionMeta: {
    fontSize: 12,
    color: "#64748b",
    fontStyle: "italic",
  },
  multilineInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.45)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#f8fafc",
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  singleLineInput: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.45)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#f8fafc",
    fontSize: 14,
    color: "#0f172a",
  },
  ratingRow: {
    flexDirection: "row",
    gap: 10,
  },
  ratingChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.45)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ratingChipActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  ratingChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  ratingChipLabelActive: {
    color: "#ffffff",
  },
  stepList: {
    gap: 10,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  stepRowPressed: {
    opacity: 0.85,
  },
  stepCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepCheckboxChecked: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  stepCheckboxMark: {
    color: "#ffffff",
    fontWeight: "700",
  },
  stepLabel: {
    fontSize: 14,
    color: "#334155",
    flex: 1,
  },
  sketchPadPlaceholder: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248, 250, 252, 0.7)",
  },
  sketchPadText: {
    fontSize: 13,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 18,
  },
  timerBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
  },
  timerBadgeLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  actions: {
    gap: 12,
    marginTop: 6,
  },
  completeButton: {
    borderRadius: 999,
    backgroundColor: "#1d4ed8",
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: "center",
  },
  completeButtonPressed: {
    opacity: 0.85,
  },
  completeButtonLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  errorHeading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  errorCopy: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
  },
  errorButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#1d4ed8",
  },
  errorButtonPressed: {
    opacity: 0.85,
  },
  errorButtonLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
