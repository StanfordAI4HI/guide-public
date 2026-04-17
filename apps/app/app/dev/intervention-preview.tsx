import React from "react";
import { SafeAreaView, View, Text, Pressable, StyleSheet, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { cacheLayeredPayload } from "../layered-store";

export const options = {
  headerShown: false,
};

// Keep this off to match main-route UX; flip to true if you want paper preview again.
const ENABLE_PREVIEW_PAPER_MODE = false;

const TEST_PAYLOADS = [
  {
    label: "Calm reset",
    payload: {
      layered: {
        summary_recap: "A short recap of the reflection to ground the plan.",
        coherence_notes: "Kept to two concise steps so the user can start immediately.",
        total_duration_minutes: 20,
        blended_activity: {
          title: "Reset + next step",
          theme: "calm",
          duration_minutes: 20,
          options: [
            {
              label: "Step A",
              description:
                "Picture yourself a week from now after this stress eases. Jot a few lines about what feels different and why it matters.",
              micro_steps: [
                "Set a 90-second timer.",
                "Write 2–3 sentences in your own words.",
                "Optional: record a 15-second voice note.",
              ],
              duration_minutes: 10,
            },
            {
              label: "Step B",
              description:
                "Pick one supportive action you can do in the next 24 hours. Make it specific, simple, and tied to what you wrote.",
              micro_steps: [
                "List two possible actions.",
                "Choose one and give it a time/place.",
                "Send yourself a reminder or message someone involved.",
              ],
              duration_minutes: 10,
            },
          ],
          summary_recap:
            "A two-step flow: envision relief, then commit to one next action. Light, fast, and doable right now.",
        },
        selected_combination_id: "test-combo-1",
        source_plan_ids: ["test"],
      },
      summary: "Test summary for preview.",
      generationLabel: "Test payload",
    },
  },
  {
    label: "Energy boost",
    payload: {
      layered: {
        summary_recap: "Shift from stuck to steady momentum.",
        coherence_notes: "Lean on action cues and quick wins.",
        total_duration_minutes: 18,
        blended_activity: {
          title: "Spark + schedule",
          theme: "energy",
          duration_minutes: 18,
          options: [
            {
              label: "Step A",
              description:
                "Name one thing you care about finishing this week. Write two sentences about why it matters to you or someone you respect.",
              micro_steps: [
                "Tap 1 value: craft | honesty | support | growth.",
                "Write 2 sentences tying the value to the task.",
              ],
              duration_minutes: 8,
            },
            {
              label: "Step B",
              description:
                "Turn it into a 20–30 minute block. Pick a time, write the first 3 actions, and send yourself a calendar hold.",
              micro_steps: [
                "Choose a time in the next 48h.",
                "List the first 3 micro-actions.",
                "Create a hold or send a reminder.",
              ],
              duration_minutes: 10,
            },
          ],
          summary_recap: "Value-tethered focus plus a scheduled micro-block to break inertia.",
        },
        selected_combination_id: "test-combo-2",
        source_plan_ids: ["test"],
      },
      summary: "Test summary for preview.",
      generationLabel: "Test payload",
    },
  },
  {
    label: "Ground + gratitude",
    payload: {
      layered: {
        summary_recap: "Slow the pace and reconnect with a supportive mindset.",
        coherence_notes: "Gentle, reflective, and contained.",
        total_duration_minutes: 15,
        blended_activity: {
          title: "Ground + name one good thing",
          theme: "grounding",
          duration_minutes: 15,
          options: [
            {
              label: "Step A",
              description:
                "Do a 4-6-4 breath and write one sentence about what feels most tense right now.",
              micro_steps: [
                "Inhale 4, hold 6, exhale 4 (3 rounds).",
                "Write 1 sentence naming the tension.",
              ],
              duration_minutes: 7,
            },
            {
              label: "Step B",
              description:
                "Name one person or thing that’s quietly helping you. Send a 2-line note or promise a tiny action to honor it.",
              micro_steps: [
                "List two candidates; pick one.",
                "Draft a 2-line note or plan a 60-second acknowledgement.",
              ],
              duration_minutes: 8,
            },
          ],
          summary_recap: "Gentle breath + a gratitude/action prompt to shift tone.",
        },
        selected_combination_id: "test-combo-3",
        source_plan_ids: ["test"],
      },
      summary: "Test summary for preview.",
      generationLabel: "Test payload",
    },
  },
  {
    label: "Chatbot + video forced",
    payload: {
      layered: {
        summary_recap:
          "Force a guided conversational scaffold plus a short visual vignette so we can validate uncommon UX palette behavior.",
        coherence_notes: "Intentionally constrained to trigger chatbot and generated video in the UX planner.",
        total_duration_minutes: 16,
        blended_activity: {
          title: "Coach chat + 4-beat visual rehearsal",
          theme: "guided_support",
          duration_minutes: 16,
          options: [
            {
              label: "Step A",
              description:
                "You must include a chatbot module as the main support element. The chatbot should have a clear persona, a concrete first prompt, and guide the user through one immediate next step.",
              micro_steps: [
                "Explicitly include: chatbot, heading, voice_input.",
                "Do not replace chatbot with textbox-only interaction.",
              ],
              duration_minutes: 8,
            },
            {
              label: "Step B",
              description:
                "You must include a dalle_video module with 4 beats and short script lines that show grounding, release, reframe, and one next action. Keep one concrete user response at the end.",
              micro_steps: [
                "Explicitly include: dalle_video and textbox or voice_input.",
                "Make the final evidence capture concrete and short.",
              ],
              duration_minutes: 8,
            },
          ],
          summary_recap:
            "This preset is specifically for forcing uncommon modules: chatbot on Step A and generated video on Step B.",
        },
        selected_combination_id: "test-combo-chatbot-video",
        source_plan_ids: ["test"],
      },
      summary: "Test summary for preview.",
      generationLabel: "Forced uncommon UX",
    },
  },
  {
    label: "Timed cues + storyboard forced",
    payload: {
      layered: {
        summary_recap:
          "Force paced regulation and visual sequence modules for validation: timed cues and storyboard.",
        coherence_notes: "Uses explicit module constraints to drive uncommon output.",
        total_duration_minutes: 14,
        blended_activity: {
          title: "Paced reset + visual sequence",
          theme: "paced_guidance",
          duration_minutes: 14,
          options: [
            {
              label: "Step A",
              description:
                "You must include a timed_cues module with clear timer_steps and guided narration. The cues should be the primary interaction in this step.",
              micro_steps: [
                "Explicitly include: timed_cues, heading.",
                "Avoid using timer in this same step.",
              ],
              duration_minutes: 7,
            },
            {
              label: "Step B",
              description:
                "You must include a storyboard module with 3 cards and one-line guidance per card. End with a short response capture.",
              micro_steps: [
                "Explicitly include: storyboard, textbox or voice_input.",
                "Each frame should map to preparation, action, and follow-through.",
              ],
              duration_minutes: 7,
            },
          ],
          summary_recap:
            "This preset is for forcing timed_cues and storyboard in separate steps to test uncommon UX elements.",
        },
        selected_combination_id: "test-combo-timed-storyboard",
        source_plan_ids: ["test"],
      },
      summary: "Test summary for preview.",
      generationLabel: "Forced uncommon UX",
    },
  },
];

export default function InterventionPreviewScreen() {
  const router = useRouter();
  const [sessionId, setSessionId] = React.useState("");
  const [stepADescription, setStepADescription] = React.useState("");
  const [stepBDescription, setStepBDescription] = React.useState("");
  const [selectedLabel, setSelectedLabel] = React.useState(TEST_PAYLOADS[0].label);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (sessionId.trim()) return;
    const randomId = `preview_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setSessionId(randomId);
  }, [sessionId]);

  const handleLaunch = () => {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      setError("Enter a session id to attach this preview.");
      return;
    }
    const choice = TEST_PAYLOADS.find((item) => item.label === selectedLabel) || TEST_PAYLOADS[0];
    const stepA = stepADescription.trim();
    const stepB = stepBDescription.trim();
    const shouldOverride = stepA || stepB;
    const payload = shouldOverride
      ? {
          ...choice.payload,
          layered: {
            ...choice.payload.layered,
            blended_activity: {
              ...choice.payload.layered.blended_activity,
              options: (choice.payload.layered.blended_activity?.options || []).map((opt) => ({
                ...opt,
                description: opt?.label?.toLowerCase?.().includes("b") ? stepB || opt.description : stepA || opt.description,
                micro_steps: [],
              })),
            },
          },
        }
      : choice.payload;
    const cacheKey = cacheLayeredPayload({ ...payload, sessionId: trimmed } as any);
    router.push({
      pathname: "/layers",
      params: {
        cacheKey,
        paperMode: ENABLE_PREVIEW_PAPER_MODE ? "1" : undefined,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Intervention Test Preview</Text>
        <Text style={styles.copy}>
          Jump straight into a fixed intervention payload (Step A/B) without waiting for generation.
        </Text>
        <Text style={styles.label}>Preset</Text>
        <View style={styles.presetRow}>
          {TEST_PAYLOADS.map((entry) => {
            const active = selectedLabel === entry.label;
            return (
              <Pressable
                key={entry.label}
                accessibilityRole="button"
                onPress={() => setSelectedLabel(entry.label)}
                style={({ pressed }) => [
                  styles.presetChip,
                  active && styles.presetChipActive,
                  pressed && styles.presetChipPressed,
                ]}
              >
                <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.label}>Session id</Text>
        <TextInput
          value={sessionId}
          onChangeText={(value) => {
            setSessionId(value);
            if (error) setError(null);
          }}
          style={styles.input}
          placeholder="Paste an existing session id"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Step description override</Text>
        <TextInput
          value={stepADescription}
          onChangeText={setStepADescription}
          style={[styles.input, styles.textarea]}
          placeholder="Step A description override"
          placeholderTextColor="#94a3b8"
          multiline
        />
        <TextInput
          value={stepBDescription}
          onChangeText={setStepBDescription}
          style={[styles.input, styles.textarea]}
          placeholder="Step B description override"
          placeholderTextColor="#94a3b8"
          multiline
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={handleLaunch} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonLabel}>Open selected test intervention</Text>
        </Pressable>
        <Text style={styles.hint}>Variants: {TEST_PAYLOADS.map((p) => p.label).join(" • ")}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  container: {
    flex: 1,
    padding: 20,
    gap: 12,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0f172a",
  },
  copy: {
    fontSize: 16,
    color: "#334155",
    lineHeight: 22,
  },
  label: {
    marginTop: 12,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    color: "#64748b",
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetChip: {
    borderWidth: 1,
    borderColor: "#cbd5f5",
    backgroundColor: "#ffffff",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetChipActive: {
    backgroundColor: "#dbeafe",
    borderColor: "#2563eb",
  },
  presetChipPressed: {
    opacity: 0.9,
  },
  presetChipText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  presetChipTextActive: {
    color: "#1d4ed8",
  },
  textarea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonLabel: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    color: "#475569",
  },
});
