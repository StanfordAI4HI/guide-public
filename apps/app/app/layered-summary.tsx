import React, { useMemo } from "react";
import { SafeAreaView, StyleSheet, View, Text, ScrollView, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

type LayerOption = {
  option_id?: string;
  label?: string;
  description?: string;
  duration_minutes?: number;
  why_it_helps?: string;
  principle?: string;
};

type LayeredCandidate = {
  candidate_id?: string;
  title?: string;
  theme?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
  options?: LayerOption[];
};

type SupportLayer = {
  title?: string;
  theme?: string;
  goal?: string;
  alignment_notes?: string;
  duration_minutes?: number;
  options?: LayerOption[];
};

type LayerSelectionBundle = {
  layer?: SupportLayer | null;
  candidate?: LayeredCandidate | null;
  option?: LayerOption | null;
};

type LayeredSummaryPayload = {
  summary?: string;
  coherence?: string;
  totalDuration?: number;
  selections?: {
    cognitive?: LayerSelectionBundle | null;
    experiential?: LayerSelectionBundle | null;
  };
};

const formatMinutes = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value} min`;
};

const SelectionCard = ({
  label,
  bundle,
  onLaunch,
}: {
  label: string;
  bundle?: LayerSelectionBundle | null;
  onLaunch?: () => void;
}) => {
  const layer = bundle?.layer ?? null;
  const candidate = bundle?.candidate ?? null;
  const option = bundle?.option ?? null;

  if (!layer || !option) {
    return (
      <View style={styles.selectionCard}>
        <Text style={styles.selectionLabel}>{label}</Text>
        <Text style={styles.selectionMissing}>
          No activity selected yet. Go back to choose your favourite option.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.selectionCard}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionLabel}>{label}</Text>
        <View style={styles.selectionMeta}>
          {!!layer.duration_minutes && (
            <Text style={styles.selectionBadge}>{formatMinutes(layer.duration_minutes)}</Text>
          )}
          {candidate?.candidate_id ? (
            <Text style={styles.selectionBadge}>#{candidate.candidate_id}</Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.selectionTitle}>
        {layer.title || candidate?.title || "Activity Bundle"}
      </Text>
      {layer.theme || candidate?.theme ? (
        <Text style={styles.selectionTheme}>{layer.theme || candidate?.theme}</Text>
      ) : null}
      {layer.goal || candidate?.goal ? (
        <Text style={styles.selectionGoal}>{layer.goal || candidate?.goal}</Text>
      ) : null}
      {layer.alignment_notes || candidate?.alignment_notes ? (
        <Text style={styles.selectionAlignment}>
          {layer.alignment_notes || candidate?.alignment_notes}
        </Text>
      ) : null}
      <View style={styles.selectionChoiceCard}>
        <View style={styles.selectionChoiceHeader}>
          <Text style={styles.selectionChoiceBadge}>{option.option_id || "Option"}</Text>
          {!!option.duration_minutes && (
            <Text style={styles.selectionChoiceDuration}>{formatMinutes(option.duration_minutes)}</Text>
          )}
        </View>
        <Text style={styles.selectionChoiceLabel}>{option.label || "Playful moment"}</Text>
        {option.description ? (
          <Text style={styles.selectionOptionDescription}>{option.description}</Text>
        ) : null}
        {option.why_it_helps ? (
          <Text style={styles.selectionOptionWhy}>{option.why_it_helps}</Text>
        ) : null}
      {option.principle ? (
        <Text style={styles.selectionOptionPrinciple}>Technique: {option.principle}</Text>
      ) : null}
    </View>
      {onLaunch ? (
        <Pressable
          accessibilityRole="button"
          onPress={onLaunch}
          style={({ pressed }) => [
            styles.launchButton,
            pressed && styles.launchButtonPressed,
          ]}
        >
          <Text style={styles.launchButtonLabel}>Do this activity</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

export default function LayeredSummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const payload: LayeredSummaryPayload = useMemo(() => {
    if (typeof params?.data !== "string") {
      return (params?.data as LayeredSummaryPayload) ?? {};
    }
    try {
      return JSON.parse(params.data);
    } catch (err) {
      console.warn("Failed to parse layered summary payload:", err);
      return {};
    }
  }, [params]);

  const cognitiveSelection = payload?.selections?.cognitive ?? null;
  const experientialSelection = payload?.selections?.experiential ?? null;
  const summaryCopy =
    payload?.summary || "Here’s the playful game plan you chose to keep momentum going.";
  const coherenceCopy =
    payload?.coherence ||
    "These layers pair together so the insight you gained carries into an embodied action.";
  const totalDurationLabel = formatMinutes(payload?.totalDuration ?? undefined);

  const handleLaunch = (layerType: "cognitive" | "experiential", bundle?: LayerSelectionBundle | null) => {
    if (!bundle?.layer || !bundle?.option) {
      Alert.alert("Choose an activity", "Please select an option for this layer first." );
      return;
    }

    const data = {
      layerType,
      layer: bundle.layer,
      candidate: bundle.candidate,
      option: bundle.option,
      summary: summaryCopy,
      coherence: coherenceCopy,
    };

    router.push({
      pathname: "/intervention/[layer]",
      params: {
        layer: layerType,
        data: encodeURIComponent(JSON.stringify(data)),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Your Playful Picks</Text>
          <Text style={styles.subheading}>{summaryCopy}</Text>
          <View style={styles.coherencePill}>
            <Text style={styles.coherenceLabel}>How it fits together</Text>
            <Text style={styles.coherenceText}>{coherenceCopy}</Text>
          </View>
          <Text style={styles.totalDuration}>
            Total playful time • {totalDurationLabel}
          </Text>
        </View>

        <SelectionCard
          label="Cognitive Layer"
          bundle={cognitiveSelection}
          onLaunch={() => handleLaunch("cognitive", cognitiveSelection)}
        />
        <SelectionCard
          label="Experiential Layer"
          bundle={experientialSelection}
          onLaunch={() => handleLaunch("experiential", experientialSelection)}
        />

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.footerButton,
              styles.footerButtonSecondary,
              pressed && styles.footerButtonPressed,
            ]}
          >
            <Text style={styles.footerButtonSecondaryLabel}>Adjust selections</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/")}
            style={({ pressed }) => [
              styles.footerButton,
              styles.footerButtonPrimary,
              pressed && styles.footerButtonPressed,
            ]}
          >
            <Text style={styles.footerButtonPrimaryLabel}>Start a New Reflection</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#eef2ff",
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
  coherencePill: {
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
  totalDuration: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
  },
  selectionCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(30, 64, 175, 0.16)",
    backgroundColor: "#ffffff",
    padding: 18,
    gap: 12,
  },
  selectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.3,
  },
  selectionMeta: {
    flexDirection: "row",
    gap: 8,
  },
  selectionBadge: {
    fontSize: 12,
    color: "#1d4ed8",
    fontWeight: "600",
  },
  selectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111c44",
  },
  selectionTheme: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#334155",
  },
  selectionGoal: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e40af",
  },
  selectionAlignment: {
    fontSize: 13,
    color: "#1f2937",
  },
  selectionChoiceCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.22)",
    backgroundColor: "rgba(219, 234, 254, 0.5)",
    padding: 14,
    gap: 8,
  },
  selectionChoiceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectionChoiceBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.5,
  },
  selectionChoiceDuration: {
    fontSize: 12,
    color: "#0f172a",
    fontWeight: "600",
  },
  selectionChoiceLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1d2a6b",
  },
  selectionOptionDescription: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  selectionOptionWhy: {
    fontSize: 12,
    color: "#2563eb",
  },
  selectionOptionPrinciple: {
    fontSize: 12,
    color: "#0f172a",
    fontStyle: "italic",
  },
  launchButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#1d4ed8",
  },
  launchButtonPressed: {
    opacity: 0.85,
  },
  launchButtonLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f8fafc",
  },
  selectionMissing: {
    fontSize: 13,
    color: "#475569",
  },
  footer: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(37, 99, 235, 0.12)",
    paddingTop: 18,
  },
  footerButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  footerButtonPrimary: {
    backgroundColor: "#1d4ed8",
  },
  footerButtonSecondary: {
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
    backgroundColor: "rgba(191, 219, 254, 0.45)",
  },
  footerButtonPressed: {
    opacity: 0.85,
  },
  footerButtonPrimaryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f8fafc",
  },
  footerButtonSecondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1d4ed8",
  },
});
