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
  Platform,
} from "react-native";
import { useRouter } from "expo-router";

import { BlockDescriptor, BlockLayout, BlockType } from "../intervention/block-types";

type LabPayload = {
  layer?: {
    title?: string;
    theme?: string;
    goal?: string;
    alignment_notes?: string;
    duration_minutes?: number;
    options?: any[];
  };
  option?: {
    option_id?: string;
    label?: string;
    description?: string;
    duration_minutes?: number;
    why_it_helps?: string;
    principle?: string;
  };
  candidate?: {
    candidate_id?: string;
    title?: string;
    theme?: string;
    goal?: string;
    alignment_notes?: string;
    duration_minutes?: number;
  };
  blocks?: BlockDescriptor[];
  layout?: BlockLayout;
  reasoning?: string;
};

const SAMPLE = JSON.stringify(
  {
    layer: {
      title: "Reframe Your Story",
      theme: "Compassionate Narrative",
      goal: "Help the user reinterpret a stressful moment with kinder perspective.",
      alignment_notes:
        "A reflective letter keeps things internal while the role-play activates empathy through dialogue.",
      duration_minutes: 10,
    },
    option: {
      option_id: "X1",
      label: "Write a compassionate letter to yourself",
      description:
        "Write 8-10 sentences to yourself as if you were a kind mentor who saw everything you handled. Highlight what you got right, what you learned, and what small grace you deserve.",
      duration_minutes: 10,
      why_it_helps:
        "Letter writing slows down rumination and lets you name the support you needed in the moment.",
      principle: "self-compassion",
    },
    blocks: [
      {
        id: "block-intro",
        type: "instruction",
        title: "Reframe Your Story",
        prompt: "You'll write a compassionate letter to yourself about the moment you described.",
        details: ["Goal: reinterpret the moment with a kinder voice."],
        minutes: 10,
      },
      {
        id: "block-reflection",
        type: "reflection",
        title: "Write the letter",
        prompt: "Write 8-10 sentences to yourself as a kind mentor who saw what you handled.",
      },
      {
        id: "block-eval",
        type: "evaluation",
        title: "Wrap-up",
        prompt: "How helpful did this feel? Give it a rating and jot a takeaway.",
      },
    ],
    layout: {
      start_block_id: "block-intro",
      blocks: [
        {
          id: "block-intro",
          type: "instruction",
          title: "Reframe Your Story",
          prompt: "You'll write a compassionate letter to yourself about the moment you described.",
          details: ["Goal: reinterpret the moment with a kinder voice."],
          minutes: 10,
          next: "block-reflection",
        },
        {
          id: "block-reflection",
          type: "reflection",
          title: "Write the letter",
          prompt: "Write 8-10 sentences to yourself as a kind mentor who saw what you handled.",
          next: "block-eval",
        },
        {
          id: "block-eval",
          type: "evaluation",
          title: "Wrap-up",
          prompt: "How helpful did this feel? Give it a rating and jot a takeaway.",
        },
      ],
    },
  },
  null,
  2
);

const LAYER_CHOICES: Array<{ id: "cognitive" | "experiential"; label: string }> = [
  { id: "cognitive", label: "Cognitive" },
  { id: "experiential", label: "Experiential" },
];

const LAB_API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8787";
const LAB_BLOCK_TYPES: BlockType[] = [
  "instruction",
  "reflection",
  "voice",
  "visualization",
  "steps",
  "action_plan",
  "sketch",
  "sensory",
  "report",
  "timer",
  "evaluation",
  "container",
];

export default function InterventionLabScreen() {
  const router = useRouter();
  const [layerType, setLayerType] = useState<"cognitive" | "experiential">("cognitive");
  const [raw, setRaw] = useState<string>(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState<string>("");
  const [selectionReason, setSelectionReason] = useState<string | null>(null);
  const [ideaStatus, setIdeaStatus] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const parsed = useMemo<LabPayload | null>(() => {
    if (!raw.trim()) return null;
    try {
      const json = JSON.parse(raw);
      setError(null);
      return json;
    } catch (err: any) {
      setError(err?.message || "Invalid JSON");
      return null;
    }
  }, [raw]);

  const handleGenerateFromIdea = async () => {
    const statement = idea.trim();
    if (!statement) {
      Alert.alert("Need a description", "Write a short sentence about the activity you want.");
      setIdeaStatus("error");
      setSelectionReason(null);
      setIdeaError("Add a quick description so the lab knows what to build.");
      console.log("[intervention-lab] idea->json status: error (empty description)");
      return;
    }

    setIdeaStatus("working");
    setSelectionReason(null);
    setIdeaError(null);
    console.log("[intervention-lab] idea->json status: working");

    type RemoteBlock = {
      type?: BlockType;
      title?: string;
      subtitle?: string;
      prompt?: string;
      details?: string[];
      steps?: string[];
      minutes?: number;
    };

    let remotePlan: {
      reasoning?: string;
      layer_type?: "cognitive" | "experiential";
      blocks?: RemoteBlock[];
    } | null = null;
    let failureReason: string | null = null;

    try {
      const response = await fetch(`${LAB_API_BASE}/dev/intervention-lab/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: statement }),
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.blocks) && data.blocks.length > 0) {
          remotePlan = data;
        } else {
          console.warn("[intervention-lab] LLM response missing blocks", data);
          failureReason = "LLM did not return any blocks.";
        }
      } else {
        const textPreview = await response.text();
        failureReason = textPreview || `HTTP ${response.status}`;
        console.warn("[intervention-lab] LLM block generation failed", response.status, textPreview);
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      console.warn("[intervention-lab] LLM block generation error", error);
    }

    if (!remotePlan || !Array.isArray(remotePlan.blocks) || remotePlan.blocks.length === 0) {
      const message =
        failureReason?.trim() ||
        "The lab LLM couldn't map that description into a block sequence. Try rephrasing with a bit more detail or different verbs.";
      Alert.alert("Unable to generate blocks", message);
      setIdeaStatus("error");
      setIdeaError(message);
      console.log("[intervention-lab] idea->json status: error (llm no-output)", { idea: statement });
      return;
    }

    const finalBlocks: BlockDescriptor[] = remotePlan.blocks.map((block, index) => {
      const rawType = typeof block?.type === "string" ? (block.type as BlockType) : null;
      const resolvedType = rawType && LAB_BLOCK_TYPES.includes(rawType) ? rawType : "instruction";
      const promptText =
        typeof block?.prompt === "string" && block.prompt.trim()
          ? block.prompt.trim()
          : `Stay with the activity inspired by "${statement}".`;

      const detailList = Array.isArray(block?.details)
        ? block.details
            .filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
            .map((detail) => detail.trim())
        : [];

      const stepList = Array.isArray(block?.steps)
        ? block.steps
            .filter((step): step is string => typeof step === "string" && step.trim().length > 0)
            .map((step) => step.trim())
        : [];

      const descriptor: BlockDescriptor = {
        id: `block-llm-${index + 1}`,
        type: resolvedType,
        title: block?.title,
        subtitle: block?.subtitle,
        prompt: promptText,
        minutes:
          typeof block?.minutes === "number" && block.minutes > 0 ? block.minutes : undefined,
      };

      if (!descriptor.subtitle || descriptor.subtitle.trim().length === 0) {
        const readableType = resolvedType.replace(/_/g, " ");
        descriptor.subtitle = `This ${readableType} keeps the focus on "${statement}" and prepares you for the next move.`;
      }

      if (detailList.length > 0) {
        descriptor.details = detailList;
      }

      if (stepList.length > 0) {
        descriptor.steps = stepList;
      }

      return descriptor;
    });

    finalBlocks.forEach((block, index) => {
      block.next = finalBlocks[index + 1]?.id ?? null;
    });

    const blockTitles = finalBlocks.map((block) => block.title || "Intervention Block");

    const describeSequence = (titles: string[]) => {
      const soften = (value?: string) => {
        if (!value) return "the focus block";
        const trimmed = value.trim();
        if (!trimmed) return "the focus block";
        return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
      };

      if (!titles.length) {
        return `Stay focused on "${statement}" for the full 10 minutes.`;
      }
      if (titles.length === 1) {
        return `Spend the time on ${soften(titles[0])}.`;
      }
      if (titles.length === 2) {
        return `Start with ${titles[0] || "the first block"} and then shift into ${soften(titles[1])}.`;
      }
      const middle = titles.slice(0, -1).map((title) => title || "a supporting block");
      return `Move through ${middle.join(", ")}, and finish with ${soften(titles[titles.length - 1])}.`;
    };

    const reasonText =
      typeof remotePlan.reasoning === "string" && remotePlan.reasoning.trim()
        ? remotePlan.reasoning.trim()
        : (() => {
            const phrases = finalBlocks.map((block, index) => {
              const title = block.title || `Block ${index + 1}`;
              const explanation = block.subtitle || `This ${block.type.replace(/_/g, " ")} block keeps the idea moving.`;
              const opener =
                index === 0
                  ? "First"
                  : index === finalBlocks.length - 1
                  ? "Finally"
                  : "Then";
              return `${opener}, ${title} ${explanation}`;
            });
            return `${phrases.join(" ")} Together they create a coherent 10-minute flow for "${statement}".`;
          })();

    const optionDescription = `${describeSequence(
      blockTitles
    )} Keep it flowing so you can report back within 10 minutes.`;

    const inferredLayer =
      remotePlan.layer_type === "experiential" ? "experiential" : "cognitive";
    setLayerType(inferredLayer);

    const optionId = inferredLayer === "cognitive" ? "X1" : "Y1";

    const payload: LabPayload = {
      layer: {
        title: blockTitles[0] ? `${blockTitles[0]} Lab` : "Intervention Lab Flow",
        theme: "Intervention Lab",
        goal: `Prototype based on "${statement}" without leaving the lab context.`,
        alignment_notes: reasonText,
        duration_minutes: 10,
        options: [
          {
            option_id: optionId,
            label: blockTitles[0] || "Run this sequence",
            description: optionDescription,
            duration_minutes: 10,
            why_it_helps: reasonText,
            principle: inferredLayer === "cognitive" ? "self-guided reflection" : "experiential rehearsal",
          },
        ],
      },
      option: {
        option_id: optionId,
        label: blockTitles[0] || "Run this sequence",
        description: optionDescription,
        duration_minutes: 10,
        why_it_helps: reasonText,
        principle: inferredLayer === "cognitive" ? "self-guided reflection" : "experiential rehearsal",
      },
      candidate: {
        candidate_id: inferredLayer === "cognitive" ? "cog_lab_llm" : "exp_lab_llm",
        title: blockTitles[0] ? `${blockTitles[0]} Prototype` : "Intervention Lab Prototype",
        theme: "Intervention Lab Prototype",
        goal: `Follow through on "${statement}" within the lab environment.`,
        alignment_notes: reasonText,
        duration_minutes: 10,
      },
      blocks: finalBlocks,
      layout: {
        start_block_id: finalBlocks[0]?.id ?? "block-0",
        blocks: finalBlocks,
      },
      reasoning: reasonText,
    };

    setRaw(JSON.stringify(payload, null, 2));
    setError(null);
    setSelectionReason(reasonText);
    setIdeaStatus("ready");
    setIdeaError(null);
    console.log("[intervention-lab] idea->json status: ready (llm)", {
      layerType: inferredLayer,
      blockCount: finalBlocks.length,
    });
  };

  const handleLaunch = () => {
    if (!parsed?.layer || !parsed?.option) {
      Alert.alert(
        "Missing data",
        "Your JSON needs at least a `layer` object and an `option` object."
      );
      return;
    }

    const layout = parsed.layout
      ?? (Array.isArray(parsed.blocks) && parsed.blocks.length
        ? {
            start_block_id: parsed.blocks[0]?.id ?? "block-0",
            blocks: parsed.blocks,
          }
        : undefined);

    const payload = {
      layerType,
      layer: parsed.layer,
      candidate: parsed.candidate ?? null,
      option: parsed.option,
      summary: null,
      coherence: null,
      blocks: parsed.blocks,
      layout,
    };

    router.push({
      pathname: "/intervention/[layer]",
      params: {
        layer: layerType,
        data: encodeURIComponent(JSON.stringify(payload)),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Intervention Lab</Text>
          <Text style={styles.subheading}>
            Paste a layer+option JSON payload and launch the schema-driven activity runner. Use this
            to prototype new interventions without touching the production chat flow.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Layer Type</Text>
          <View style={styles.toggleGroup}>
            {LAYER_CHOICES.map((choice) => (
              <Pressable
                key={choice.id}
                accessibilityRole="button"
                onPress={() => setLayerType(choice.id)}
                style={({ pressed }) => [
                  styles.toggleChip,
                  layerType === choice.id && styles.toggleChipActive,
                  pressed && styles.toggleChipPressed,
                ]}
              >
                <Text
                  style={[
                    styles.toggleChipLabel,
                    layerType === choice.id && styles.toggleChipLabelActive,
                  ]}
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionHelp}>
            • Choose "Cognitive" for reflective/meta activities.{"\n"}• Choose "Experiential" for
            embodied/doing activities.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Describe an activity</Text>
          <Text style={styles.sectionHelp}>
            Prefer words over JSON? Describe the activity you want to try (e.g., "I want to record
            a pep talk about tomorrow's presentation"). We'll draft a layer+option payload and you
            can tweak it before launching.
          </Text>
          <TextInput
            style={styles.promptInput}
            multiline
            value={idea}
            onChangeText={(value) => {
              setIdea(value);
              setSelectionReason(null);
              setIdeaStatus("idle");
              setIdeaError(null);
            }}
            placeholder="Describe the intervention you'd like to prototype..."
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleGenerateFromIdea}
            style={({ pressed }) => [
              styles.exampleButton,
              pressed && styles.exampleButtonPressed,
            ]}
          >
            <Text style={styles.exampleButtonLabel}>Generate JSON from description</Text>
          </Pressable>
          {ideaStatus !== "idle" ? (
            <Text
              style={[
                styles.statusText,
                ideaStatus === "working" && styles.statusTextWorking,
              ideaStatus === "ready" && styles.statusTextReady,
                ideaStatus === "error" && styles.statusTextError,
              ]}
            >
              {ideaStatus === "working"
                ? "Generating JSON from description…"
                : ideaStatus === "ready"
                ? "JSON generation complete."
                : ideaError || "Unable to map that description to blocks."}
            </Text>
          ) : null}
          {selectionReason ? (
            <View style={styles.reasonCard}>
              <Text style={styles.reasonTitle}>Why these blocks</Text>
              <Text style={styles.reasonBody}>{selectionReason}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity JSON</Text>
          <Text style={styles.sectionHelp}>
            Must include a `layer` object (title, goal, etc.) and an `option` object (label,
            description, why_it_helps, principle). Option IDs (X1/X2 or Y1/Y2) help with logging but
            aren't required.
          </Text>
          <TextInput
            style={[styles.jsonInput, error && styles.jsonInputInvalid]}
            multiline
            value={raw}
            onChangeText={setRaw}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={'{ "layer": { ... }, "option": { ... } }'}
          />
          {error ? <Text style={styles.errorText}>JSON error: {error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setRaw(SAMPLE);
              setIdeaStatus("idle");
            }}
            style={({ pressed }) => [
              styles.exampleButton,
              pressed && styles.exampleButtonPressed,
            ]}
          >
            <Text style={styles.exampleButtonLabel}>Load sample payload</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Launch runner</Text>
          <Text style={styles.sectionHelp}>
            We'll encode the payload and open the same activity runner used in production. Any notes
            you enter will be logged to the console under <Text style={styles.codeLabel}>[intervention-completed]</Text>.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={handleLaunch}
            style={({ pressed }) => [
              styles.launchButton,
              pressed && styles.launchButtonPressed,
            ]}
          >
            <Text style={styles.launchButtonLabel}>Open Activity Runner</Text>
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
    paddingTop: 28,
    paddingBottom: 40,
    gap: 24,
  },
  header: {
    gap: 10,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "#ffffff",
    padding: 18,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  sectionHelp: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
  },
  toggleGroup: {
    flexDirection: "row",
    gap: 8,
  },
  toggleChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.3)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
  },
  toggleChipActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  toggleChipPressed: {
    opacity: 0.85,
  },
  toggleChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  toggleChipLabelActive: {
    color: "#f8fafc",
  },
  promptInput: {
    minHeight: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(248, 250, 252, 0.95)",
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#475569",
    fontStyle: "italic",
  },
  statusTextWorking: {
    color: "#2563eb",
  },
  statusTextReady: {
    color: "#15803d",
  },
  statusTextError: {
    color: "#b91c1c",
  },
  reasonCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
    backgroundColor: "rgba(219, 234, 254, 0.25)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  reasonTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  reasonBody: {
    fontSize: 13,
    lineHeight: 18,
    color: "#1e293b",
  },
  jsonInput: {
    minHeight: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.45)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 18,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
  },
  jsonInputInvalid: {
    borderColor: "#dc2626",
  },
  errorText: {
    fontSize: 12,
    color: "#dc2626",
  },
  exampleButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
    backgroundColor: "rgba(219, 234, 254, 0.4)",
  },
  exampleButtonPressed: {
    opacity: 0.85,
  },
  exampleButtonLabel: {
    fontSize: 13,
    color: "#1d4ed8",
    fontWeight: "600",
  },
  codeLabel: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    color: "#1f2937",
  },
  launchButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#1d4ed8",
  },
  launchButtonPressed: {
    opacity: 0.85,
  },
  launchButtonLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
  },
});
