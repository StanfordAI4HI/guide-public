import React, { useMemo, useEffect, useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getFlowState, updateFlowState } from "./layered-store";

export default function FinalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const sessionId =
    typeof params?.sessionId === "string" && params.sessionId.trim()
      ? params.sessionId.trim()
      : "";
  const storedFinal = useMemo(() => {
    if (!sessionId) return null;
    const flow = getFlowState(sessionId);
    return flow?.finalPayload || null;
  }, [sessionId]);
  const parsed =
    typeof params?.data === "string"
      ? (() => {
          try {
            return JSON.parse(params.data);
          } catch (err) {
            console.warn("Failed to parse intervention data:", err);
            return {};
          }
        })()
      : params?.data || storedFinal;

  useEffect(() => {
    if (!sessionId || !parsed) return;
    updateFlowState(sessionId, { finalPayload: parsed });
  }, [parsed, sessionId]);

  const plan = parsed?.plan;
  const planTitle = plan?.plan_title || "Twenty-Minute Reset Plan";
  const summaryText =
    plan?.summary ||
    "Here’s a routine to help you integrate what surfaced in this reflection.";
  const activities = Array.isArray(plan?.activities) ? plan.activities : [];
  const selectionReasoning = plan?.selection_reasoning || "";
  const sourcePlanIds = Array.isArray(plan?.source_plan_ids) ? plan.source_plan_ids : [];
  const candidates = Array.isArray(plan?.candidates) ? plan.candidates : [];
  const candidateRubric = Array.isArray(plan?.candidate_rubric) ? plan.candidate_rubric : [];
  const selectionRubric = Array.isArray(plan?.selection_rubric) ? plan.selection_rubric : [];
  const finalScores = plan?.scores || {};
  const finalScoreNotes = plan?.score_notes || {};
  const decisionAvailable =
    Boolean(selectionReasoning) || candidates.length > 0 || selectionRubric.length > 0;
  const [showDecisionDetails, setShowDecisionDetails] = useState(false);

  const formatScore = (value?: number) =>
    typeof value === "number" && !Number.isNaN(value) ? `${value}/5` : "—";

  const formatDuration = (value?: number) =>
    typeof value === "number" && !Number.isNaN(value) ? `${value} min` : null;

  const totalPlanDuration = activities.reduce((total: number, activity: any) => {
    const duration = Number(activity?.duration_minutes);
    return Number.isFinite(duration) && duration > 0 ? total + Math.round(duration) : total;
  }, 0);
  const totalDurationLabel = totalPlanDuration > 0 ? `${totalPlanDuration} min` : null;
  const primaryActivity = activities[0] || null;

  const normalizeDescriptionSegments = (text?: string) => {
    if (!text) return [];
    return text
      .split(/(?:[\n\r]+|•|\u2022)/)
      .map((segment) => segment.replace(/^\d+[.)]\s*/, "").trim())
      .filter(Boolean);
  };

  const renderScoreBlock = (
    rubric: any[] | undefined,
    scores?: Record<string, number>,
    notes?: Record<string, string>,
    variant: "primary" | "compact" = "primary"
  ) => {
    if (!rubric || rubric.length === 0) return null;
    const hasDetail = rubric.some(
      (dim) => typeof scores?.[dim.key] === "number" || !!notes?.[dim.key]
    );
    if (!hasDetail) return null;
    const groups: { name: string; items: any[] }[] = [];
    rubric.forEach((dim) => {
      const name = dim.group || "Rubric";
      const existing = groups.find((entry) => entry.name === name);
      if (existing) {
        existing.items.push(dim);
      } else {
        groups.push({ name, items: [dim] });
      }
    });
    return (
      <View
        style={[
          styles.scoreBlock,
          variant === "compact" && styles.scoreBlockCompact,
        ]}
      >
        {groups.map((group) => (
          <View key={group.name} style={styles.scoreGroup}>
            <Text style={styles.scoreGroupTitle}>{group.name}</Text>
            {group.items.map((dim) => (
              <View key={dim.key || dim.title} style={styles.scoreRow}>
                <View style={styles.scoreLabelColumn}>
                  <Text style={styles.scoreDimTitle}>{dim.title}</Text>
                  <Text style={styles.scoreDimDescription}>{dim.description}</Text>
                  <Text style={styles.scoreDimAnchors}>{dim.anchors}</Text>
                </View>
                <View style={styles.scoreValueColumn}>
                  <Text style={styles.scoreValue}>{formatScore(scores?.[dim.key])}</Text>
                  {!!notes?.[dim.key] && (
                    <Text style={styles.scoreNote}>{notes?.[dim.key]}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {primaryActivity ? (
          <View style={styles.heroCard}>
            <View style={styles.heroHeader}>
              <Text style={styles.heroBadge}>Final Activity</Text>
              {totalDurationLabel ? (
                <Text style={styles.heroDuration}>{totalDurationLabel}</Text>
              ) : null}
            </View>
            <Text style={styles.heroTitle}>{primaryActivity.label || planTitle}</Text>
            {plan?.theme ? (
              <Text style={styles.heroSubtitle}>{plan.theme}</Text>
            ) : (
              <Text style={styles.heroSubtitle}>{planTitle}</Text>
            )}
            <Text style={styles.heroSummary}>{summaryText}</Text>
            {primaryActivity.description ? (
              <Text style={styles.heroDescription}>{primaryActivity.description}</Text>
            ) : null}
            {primaryActivity.reasoning ? (
              <View style={styles.heroCallout}>
                <Text style={styles.heroCalloutTitle}>Why this helps</Text>
                <Text style={styles.heroCalloutText}>{primaryActivity.reasoning}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            styles.planDecisionContainer,
            showDecisionDetails && styles.planDecisionSplit,
          ]}
        >
          <View
            style={[
              styles.planColumn,
              showDecisionDetails && styles.planColumnSplit,
            ]}
          >
            <View style={styles.card}>
              <Text style={styles.heading}>{planTitle}</Text>
              <Text style={styles.subheading}>{summaryText}</Text>

              {activities.length > 0 ? (
                <View style={styles.activityList}>
                  {activities.map((activity: any, idx: number) => {
                    const descriptionSegments = normalizeDescriptionSegments(activity?.description);
                    return (
                      <View key={`${activity?.label || idx}`} style={styles.activityCard}>
                        <View style={styles.activityHeader}>
                          <Text style={styles.activityBadge}>Step {idx + 1}</Text>
                          {formatDuration(activity?.duration_minutes) ? (
                            <Text style={styles.activityDuration}>
                              {formatDuration(activity?.duration_minutes)}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.activityTitle}>
                          {activity?.label || `Do this next`}
                        </Text>
                        {descriptionSegments.length > 0 ? (
                          <View style={styles.activityDescriptionList}>
                            {descriptionSegments.map((segment, segmentIndex) => (
                              <View
                                key={`${activity?.label || idx}-segment-${segmentIndex}`}
                                style={styles.activityBulletRow}
                              >
                                <Text style={styles.activityBullet}>•</Text>
                                <Text style={styles.activityDescription}>{segment}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.activityDescription}>{activity?.description}</Text>
                        )}
                        {activity?.reasoning ? (
                          <View style={styles.activityWhy}>
                            <Text style={styles.activityWhyLabel}>Why it helps</Text>
                            <Text style={styles.activityWhyText}>{activity.reasoning}</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Quick Start</Text>
                  <Text style={styles.sectionText}>
                    Take a few deep breaths, jot down the most important insight from your
                    reflection, and choose one supportive action you can do right now.
                  </Text>
                </View>
              )}

              {decisionAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowDecisionDetails((prev) => !prev)}
                  style={({ pressed }) => [
                    styles.decisionButton,
                    pressed && styles.decisionButtonPressed,
                  ]}
                >
                  <Text style={styles.decisionButtonText}>
                    {showDecisionDetails ? "Hide why we picked this" : "Why we picked this plan"}
                  </Text>
                </Pressable>
              ) : null}

              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  Ready for another check-in or want to capture new thoughts?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/")}
                  style={({ pressed }) => [
                    styles.restartButton,
                    pressed && styles.restartButtonPressed,
                  ]}
                >
                  <Text style={styles.restartLabel}>Start a New Reflection</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {showDecisionDetails && decisionAvailable ? (
            <View style={[styles.decisionPanel, styles.decisionPanelActive]}>
              <ScrollView
                style={styles.decisionScrollView}
                contentContainerStyle={styles.decisionScroll}
              >
                <Text style={styles.decisionTitle}>How this plan was chosen</Text>
                {selectionReasoning ? (
                  <Text style={styles.decisionParagraph}>{selectionReasoning}</Text>
                ) : null}

                {renderScoreBlock(selectionRubric, finalScores, finalScoreNotes, "compact")}

                {!!sourcePlanIds.length && (
                  <Text style={styles.decisionTagline}>
                    Final plan draws from: {sourcePlanIds.join(", ")}
                  </Text>
                )}

                {!!candidates.length && (
                  <Text style={styles.decisionSubtitle}>Candidate Plans Considered</Text>
                )}
                {candidates.map((candidate: any, candidateIdx: number) => (
                  <View
                    key={candidate?.plan_id || candidate?.plan_title || `candidate-${candidateIdx}`}
                    style={styles.candidateCard}
                  >
                    <Text style={styles.candidateTitle}>
                      {candidate?.plan_title || candidate?.plan_id || "Candidate"}
                    </Text>
                    {candidate?.summary ? (
                      <Text style={styles.candidateSummary}>{candidate.summary}</Text>
                    ) : null}
                    {candidate?.rationale ? (
                      <Text style={styles.candidateRationale}>{candidate.rationale}</Text>
                    ) : null}
                    {renderScoreBlock(
                      candidateRubric,
                      candidate?.scores,
                      candidate?.score_notes,
                      "compact"
                    )}
                    {Array.isArray(candidate?.activities) && candidate.activities.length > 0 ? (
                      <View style={styles.candidateActivities}>
                        {candidate.activities.map((activity: any, idx: number) => (
                          <View
                            key={`${candidate?.plan_id || "candidate"}-activity-${idx}`}
                            style={styles.candidateActivityItem}
                          >
                            <Text style={styles.candidateActivityLabel}>{activity?.label}</Text>
                            <Text style={styles.candidateActivityDescription}>
                              {activity?.description}
                            </Text>
                            {typeof activity?.duration_minutes === "number" ? (
                              <Text style={styles.candidateActivityDuration}>
                                {activity.duration_minutes} min
                              </Text>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowDecisionDetails(false)}
                  style={({ pressed }) => [
                    styles.closeDecisionButton,
                    pressed && styles.closeDecisionButtonPressed,
                  ]}
                >
                  <Text style={styles.closeDecisionLabel}>Close</Text>
                </Pressable>
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#e5ecff",
  },
  container: {
    flexGrow: 1,
    alignItems: "center",
    padding: 24,
    gap: 24,
  },
  heroCard: {
    width: "100%",
    maxWidth: 1120,
    backgroundColor: "#f7f9ff",
    borderRadius: 32,
    paddingVertical: 28,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.18)",
    gap: 14,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroBadge: {
    textTransform: "uppercase",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#1d4ed8",
  },
  heroDuration: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f1f4b",
  },
  heroSubtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  heroSummary: {
    fontSize: 16,
    color: "#111827",
    lineHeight: 23,
  },
  heroDescription: {
    fontSize: 15,
    color: "#1f2937",
    lineHeight: 22,
  },
  heroCallout: {
    marginTop: 4,
    backgroundColor: "#e1ecff",
    borderRadius: 18,
    padding: 16,
    gap: 6,
  },
  heroCalloutTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    letterSpacing: 0.4,
  },
  heroCalloutText: {
    fontSize: 15,
    color: "#0f172a",
    lineHeight: 22,
  },
  planDecisionContainer: {
    width: "100%",
    maxWidth: 1120,
    gap: 20,
  },
  planDecisionSplit: {
    ...Platform.select({
      web: {
        flexDirection: "row",
        alignItems: "flex-start",
      },
      default: {
        flexDirection: "column",
      },
    }),
  },
  planColumn: {
    flex: 1,
    minWidth: 0,
  },
  planColumnSplit: {
    ...Platform.select({
      web: {
        minWidth: 0,
      },
      default: {},
    }),
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    gap: 18,
    ...Platform.select({
      web: {
        boxShadow: "0px 16px 35px rgba(15, 23, 42, 0.12)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.16,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 8,
      },
    }),
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0f172a",
  },
  subheading: {
    fontSize: 16,
    color: "#334155",
    lineHeight: 22,
  },
  section: {
    backgroundColor: "#f1f5ff",
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    gap: 6,
  },
  activityList: {
    gap: 16,
  },
  activityCard: {
    backgroundColor: "#f1f5ff",
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.08)",
  },
  activityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  activityBadge: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    color: "#1d4ed8",
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  activityDuration: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
  },
  activityTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  activityDescriptionList: {
    gap: 8,
  },
  activityBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  activityBullet: {
    color: "#1d4ed8",
    fontSize: 18,
    lineHeight: 20,
  },
  activityDescription: {
    flex: 1,
    fontSize: 15,
    color: "#0f172a",
    lineHeight: 22,
  },
  activityWhy: {
    backgroundColor: "#e0edff",
    borderRadius: 16,
    padding: 12,
    gap: 4,
  },
  activityWhyLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  activityWhyText: {
    fontSize: 14,
    color: "#0f172a",
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  sectionText: {
    fontSize: 15,
    color: "#0f172a",
    lineHeight: 22,
  },
  sectionReasoning: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 19,
    fontStyle: "italic",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.08)",
    paddingTop: 18,
    gap: 12,
  },
  footerText: {
    fontSize: 15,
    color: "#334155",
  },
  restartButton: {
    backgroundColor: "#2563eb",
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
  },
  restartButtonPressed: {
    opacity: 0.85,
  },
  restartLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  decisionButton: {
    backgroundColor: "rgba(79, 70, 229, 0.12)",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.25)",
    alignSelf: "flex-start",
  },
  decisionButtonPressed: {
    opacity: 0.85,
  },
  decisionButtonText: {
    color: "#1d4ed8",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  decisionPanel: {
    width: "100%",
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(30, 64, 175, 0.18)",
    marginTop: 20,
    ...Platform.select({
      web: {
        boxShadow: "0px 18px 34px rgba(30, 41, 59, 0.16)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOpacity: 0.15,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 12 },
        elevation: 12,
      },
    }),
  },
  decisionPanelActive: {
    ...Platform.select({
      web: {
        flex: 1,
        maxWidth: 420,
        marginTop: 0,
        marginLeft: 24,
      },
      default: {},
    }),
  },
  decisionScrollView: {
    flex: 1,
  },
  decisionScroll: {
    padding: 18,
    gap: 14,
  },
  decisionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
  },
  decisionParagraph: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  decisionTagline: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic",
  },
  decisionSubtitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  candidateCard: {
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.18)",
    borderRadius: 14,
    padding: 14,
    gap: 6,
    backgroundColor: "rgba(241, 245, 255, 0.65)",
  },
  candidateTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e40af",
  },
  candidateSummary: {
    fontSize: 14,
    color: "#475569",
  },
  candidateRationale: {
    fontSize: 13,
    color: "#1f2937",
    lineHeight: 18,
  },
  candidateActivities: {
    marginTop: 6,
    gap: 6,
  },
  candidateActivityItem: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  candidateActivityLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1d4ed8",
  },
  candidateActivityDescription: {
    fontSize: 13,
    color: "#1f2937",
    marginTop: 2,
  },
  candidateActivityDuration: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
  },
  scoreBlock: {
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#f8fbff",
    gap: 12,
    marginTop: 10,
  },
  scoreBlockCompact: {
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
  },
  scoreGroup: {
    gap: 8,
  },
  scoreGroupTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  scoreLabelColumn: {
    flex: 1,
    gap: 4,
  },
  scoreValueColumn: {
    width: 120,
    alignItems: "flex-end",
    gap: 4,
  },
  scoreDimTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e3a8a",
  },
  scoreDimDescription: {
    fontSize: 13,
    color: "#334155",
  },
  scoreDimAnchors: {
    fontSize: 12,
    color: "#64748b",
    fontStyle: "italic",
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  scoreNote: {
    fontSize: 12,
    color: "#475569",
    textAlign: "right",
  },
  closeDecisionButton: {
    alignSelf: "center",
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#1e3a8a",
  },
  closeDecisionButtonPressed: {
    opacity: 0.85,
  },
  closeDecisionLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
});
