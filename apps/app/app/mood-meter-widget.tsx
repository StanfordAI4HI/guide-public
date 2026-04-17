import React, { useMemo } from "react";
import { StyleSheet, Text, View, Pressable, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const QUADRANTS = [
  { label: "High energy / Pleasant", color: "#fcd34d" },
  { label: "High energy / Unpleasant", color: "#fb7185" },
  { label: "Low energy / Unpleasant", color: "#64748b" },
  { label: "Low energy / Pleasant", color: "#7dd3fc" },
];

const QUADRANT_EMOTIONS = {
  top: ["Excited", "Energized", "Inspired", "Motivated"],
  upperRight: ["Overwhelmed", "Stressed", "Frustrated", "Anxious"],
  bottom: ["Tired", "Drained", "Low", "Discouraged"],
  lowerLeft: ["Calm", "Content", "Relaxed", "Steady"],
};

const EMOTIONS = [
  ...QUADRANT_EMOTIONS.top,
  ...QUADRANT_EMOTIONS.upperRight,
  ...QUADRANT_EMOTIONS.bottom,
  ...QUADRANT_EMOTIONS.lowerLeft,
];

const EMOTION_COLOR: Record<string, string> = {
  Excited: "#fde68a",
  Energized: "#fde68a",
  Inspired: "#fde68a",
  Motivated: "#fde68a",
  Overwhelmed: "#fb7185",
  Stressed: "#fb7185",
  Frustrated: "#fb7185",
  Anxious: "#fb7185",
  Tired: "#94a3b8",
  Drained: "#94a3b8",
  Low: "#94a3b8",
  Discouraged: "#94a3b8",
  Calm: "#a7f3d0",
  Content: "#a7f3d0",
  Relaxed: "#a7f3d0",
  Steady: "#a7f3d0",
};

const emotionColor = (label: string) => EMOTION_COLOR[label] || "#e2e8f0";

const EMOJI: Record<string, string> = {
  Excited: "✨",
  Energized: "⚡",
  Inspired: "💡",
  Motivated: "🚀",
  Overwhelmed: "🌪️",
  Stressed: "🔥",
  Frustrated: "😤",
  Anxious: "🫨",
  Tired: "😴",
  Drained: "🫗",
  Low: "🌧️",
  Discouraged: "🪫",
  Calm: "🌿",
  Content: "😊",
  Relaxed: "🧘",
  Steady: "🪵",
};

type MoodMeterWidgetProps = {
  selected: string[];
  onToggle: (label: string) => void;
  otherEmotions: string;
  onOtherEmotionsChange: (value: string) => void;
  showIntro?: boolean;
  layout?: "stacked" | "two-column";
};

export default function MoodMeterWidget({
  selected,
  onToggle,
  otherEmotions,
  onOtherEmotionsChange,
  showIntro = true,
  layout = "stacked",
}: MoodMeterWidgetProps) {
  const wheelPositions = useMemo(() => {
    const center = 210;
    const radius = 155;
    const angleSets = [
      [288, 306, 324, 342],
      [18, 36, 54, 72],
      [108, 126, 144, 162],
      [198, 216, 234, 252],
    ];
    const map: Record<string, { x: number; y: number }> = {};
    const groups = [
      { items: QUADRANT_EMOTIONS.top, angles: angleSets[0] },
      { items: QUADRANT_EMOTIONS.upperRight, angles: angleSets[1] },
      { items: QUADRANT_EMOTIONS.bottom, angles: angleSets[2] },
      { items: QUADRANT_EMOTIONS.lowerLeft, angles: angleSets[3] },
    ];
    const yOffset: Record<string, number> = {
      Anxious: 14,
      Tired: 14,
      Excited: -14,
      Steady: -14,
    };
    groups.forEach((group) => {
      group.items.forEach((label, idx) => {
        const angle = group.angles[idx] ?? 0;
        const rad = (angle * Math.PI) / 180;
        map[label] = {
          x: center + radius * Math.cos(rad),
          y: center + radius * Math.sin(rad) + (yOffset[label] || 0),
        };
      });
    });
    return EMOTIONS.map((label) => map[label] || { x: center, y: center });
  }, []);

  return (
    <View style={styles.container}>
      {showIntro ? (
        <>
          <Text style={styles.title}>Take a Moment to Check In</Text>
          <Text style={styles.subtitle}>
            Take a moment to notice what’s here before we begin. Select any feelings that fit.
          </Text>
        </>
      ) : null}

      <View style={layout === "two-column" ? styles.twoColumn : styles.stacked}>
        <View style={styles.leftColumn}>
          {showIntro ? null : null}
          <Text style={styles.leftSubtitle}>
            Tap any feelings in the circle that fit how you feel right now (you can choose more than one).
          </Text>
          <View style={styles.selectionBox}>
            <Text style={styles.selectionTitle}>Selected emotions</Text>
            {selected.length ? (
              <View style={styles.selectionRow}>
                {selected.map((emotion) => (
                  <View key={`sel-${emotion}`} style={styles.selectionChip}>
                    <Text style={styles.selectionText}>{emotion}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.selectionEmpty}>No emotions selected yet.</Text>
            )}
          </View>

          <View style={styles.otherEmotions}>
            <Text style={styles.otherTitle}>Any other emotions you are feeling?</Text>
            <TextInput
              value={otherEmotions}
              onChangeText={onOtherEmotionsChange}
              placeholder="Type here…"
              placeholderTextColor="#94a3b8"
              style={styles.otherInput}
            />
          </View>
        </View>
        <View style={styles.rightColumn}>
          <View style={styles.wheelWrap}>
            <View style={styles.wheel}>
              <LinearGradient
                colors={[
                  "rgba(252, 211, 77, 0.35)",
                  "rgba(251, 113, 133, 0.35)",
                  "rgba(100, 116, 139, 0.35)",
                  "rgba(125, 211, 252, 0.35)",
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.wheelGlow}
              />
              <View style={[styles.quadrantBlock, styles.quadrantTopLeft]} />
              <View style={[styles.quadrantBlock, styles.quadrantTopRight]} />
              <View style={[styles.quadrantBlock, styles.quadrantBottomRight]} />
              <View style={[styles.quadrantBlock, styles.quadrantBottomLeft]} />
              <View style={styles.wheelCenter}>
                <Text style={styles.centerTitle}>Select all</Text>
                <Text style={styles.centerSubtitle}>that feel true</Text>
              </View>
              {EMOTIONS.map((emotion, idx) => {
                const selectedState = selected.includes(emotion);
                const pos = wheelPositions[idx];
                const chipColor = emotionColor(emotion);
                return (
                  <Pressable
                    key={emotion}
                    onPress={() => onToggle(emotion)}
                    style={({ pressed }) => [
                      styles.wheelChip,
                      {
                        left: pos.x,
                        top: pos.y,
                        borderColor: chipColor,
                        backgroundColor: selectedState ? chipColor : "rgba(255,255,255,0.9)",
                      },
                      pressed && styles.emotionPressed,
                    ]}
                  >
                    <Text style={styles.wheelChipEmoji}>{EMOJI[emotion] || "✨"}</Text>
                    <Text style={[styles.wheelChipText, selectedState && styles.wheelChipTextSelected]}>
                      {emotion}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.quadrantLegend}>
              {QUADRANTS.map((quad) => (
                <View key={quad.label} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: quad.color }]} />
                  <Text style={styles.legendText}>{quad.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 18 },
  twoColumn: {
    flexDirection: "row",
    gap: 18,
    alignItems: "flex-start",
  },
  stacked: {
    gap: 18,
  },
  leftColumn: {
    flexBasis: 300,
    flexShrink: 0,
    gap: 12,
    marginLeft: 0,
    paddingLeft: 6,
  },
  rightColumn: {
    flex: 1,
    alignItems: "center",
  },
  leftTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  leftSubtitle: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  title: { fontSize: 26, fontWeight: "800", color: "#0f172a" },
  subtitle: { fontSize: 15, color: "#475569", maxWidth: 640 },
  wheelWrap: { gap: 14 },
  wheel: {
    width: 420,
    height: 420,
    alignSelf: "center",
    borderRadius: 210,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  wheelGlow: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 8,
    bottom: 8,
    borderRadius: 200,
  },
  quadrantBlock: {
    position: "absolute",
    width: "50%",
    height: "50%",
    opacity: 0.95,
  },
  quadrantTopLeft: { top: 0, left: 0, backgroundColor: "#fcd34d" },
  quadrantTopRight: { top: 0, right: 0, backgroundColor: "#fb7185" },
  quadrantBottomRight: { bottom: 0, right: 0, backgroundColor: "#64748b" },
  quadrantBottomLeft: { bottom: 0, left: 0, backgroundColor: "#7dd3fc" },
  wheelCenter: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 150,
    height: 150,
    marginLeft: -75,
    marginTop: -75,
    borderRadius: 75,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  centerTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  centerSubtitle: { fontSize: 12, color: "#475569", textAlign: "center", marginTop: 2 },
  wheelChip: {
    position: "absolute",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    transform: [{ translateX: -50 }, { translateY: -16 }],
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 90,
    maxWidth: 132,
  },
  wheelChipEmoji: { fontSize: 11 },
  wheelChipText: {
    color: "#0f172a",
    fontSize: 10,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "center",
  },
  wheelChipTextSelected: { color: "#0f172a" },
  emotionPressed: { opacity: 0.85 },
  quadrantLegend: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 11, color: "#475569", fontWeight: "600" },
  selectionBox: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
    backgroundColor: "rgba(219, 234, 254, 0.35)",
    gap: 8,
  },
  selectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  selectionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selectionChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "#e0e7ff",
  },
  selectionText: { color: "#1e3a8a", fontSize: 12, fontWeight: "700" },
  selectionEmpty: { color: "#64748b", fontSize: 12 },
  otherEmotions: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
    backgroundColor: "rgba(219, 234, 254, 0.35)",
    gap: 6,
  },
  otherTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  otherInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.35)",
    backgroundColor: "rgba(219, 234, 254, 0.6)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
