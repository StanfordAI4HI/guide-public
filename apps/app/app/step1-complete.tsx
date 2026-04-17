import React, { useEffect } from "react";
import { SafeAreaView, View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { updateFlowState } from "./layered-store";

export const options = {
  headerShown: false,
};

export default function StepOneCompleteScreen() {
  const params = useLocalSearchParams();
  const sessionId =
    typeof params?.sessionId === "string" && params.sessionId.trim()
      ? params.sessionId.trim()
      : "";
  const stepIndex =
    typeof params?.stepIndex === "string" && params.stepIndex.trim()
      ? params.stepIndex.trim()
      : "0";
  useEffect(() => {
    if (!sessionId) return;
    updateFlowState(sessionId, {
      step1Complete: {
        completedAt: Date.now(),
        stepIndex,
      },
    });
  }, [sessionId, stepIndex]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Thank you for completing your personalized activity.</Text>
        <Text style={styles.subtitle}>
          You have reached the final page. There are no further questions. You can close the browser now.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#e8ecff",
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
  },
  subtitle: {
    maxWidth: 760,
    fontSize: 17,
    lineHeight: 25,
    color: "#334155",
    textAlign: "center",
  },
});
