export type DemographicProfile = {
  gender_identity: string;
  gender_self_describe: string;
  race: string;
  hispanic_origin: string;
  age: string;
};

const runtimeEnv =
  ((globalThis as any)?.process?.env ?? {}) as Record<string, string | undefined>;

const GENDER_IDENTITY_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not: "Prefer not to answer",
  self_describe: "Self-described",
};

const RACE_LABELS: Record<string, string> = {
  african_american: "African American",
  american_indian: "American Indian or Alaska Native",
  asian: "Asian",
  pacific_islander: "Native Hawaiian or Other Pacific Islander",
  white: "White",
  more_than_one: "More than one race",
  prefer_not: "Prefer not to answer",
};

const HISPANIC_LABELS: Record<string, string> = {
  yes: "Hispanic or Latino",
  no: "Not Hispanic or Latino",
  prefer_not: "Hispanic origin undisclosed",
};

export const DEMOGRAPHIC_DEFAULTS: DemographicProfile = {
  gender_identity: "prefer_not",
  gender_self_describe: "",
  race: "prefer_not",
  hispanic_origin: "prefer_not",
  age: "25",
};

// Set EXPO_PUBLIC_ENABLE_DEMOGRAPHICS=false to skip the intake view.
export const DEMOGRAPHIC_COLLECTION_ENABLED =
  runtimeEnv.EXPO_PUBLIC_ENABLE_DEMOGRAPHICS !== "false";

export function normalizeDemographics(
  value?: Partial<DemographicProfile> | null
): DemographicProfile {
  return {
    gender_identity: (value?.gender_identity ?? "").trim(),
    gender_self_describe: (value?.gender_self_describe ?? "").trim(),
    race: (value?.race ?? "").trim(),
    hispanic_origin: (value?.hispanic_origin ?? "").trim(),
    age: (value?.age ?? "").trim(),
  };
}

export function validateDemographics(profile: DemographicProfile): string | null {
  if (!profile.gender_identity || !profile.race || !profile.hispanic_origin || !profile.age) {
    return "Please answer each question to continue.";
  }
  if (profile.age !== "prefer_not" && !/^\d{1,3}$/.test(profile.age)) {
    return "Age should be a whole number.";
  }
  if (profile.gender_identity === "self_describe" && !profile.gender_self_describe.trim()) {
    return "Please share how you self-describe your gender.";
  }
  return null;
}

export function serializeDemographics(profile: DemographicProfile): string {
  return encodeURIComponent(JSON.stringify(normalizeDemographics(profile)));
}

export function deserializeDemographics(
  param?: string | string[]
): DemographicProfile {
  if (!param) {
    return DEMOGRAPHIC_DEFAULTS;
  }

  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) {
    return DEMOGRAPHIC_DEFAULTS;
  }

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    return normalizeDemographics(parsed);
  } catch (err) {
    console.warn("Failed to parse demographics payload:", err);
    return DEMOGRAPHIC_DEFAULTS;
  }
}

function resolveLabel(map: Record<string, string>, value: string): string {
  return map[value] || "";
}

export function formatGenderIdentity(profile: DemographicProfile): string {
  const normalized = normalizeDemographics(profile);
  if (normalized.gender_identity === "self_describe") {
    return normalized.gender_self_describe || "Self-described gender";
  }
  return resolveLabel(GENDER_IDENTITY_LABELS, normalized.gender_identity);
}

export function formatRace(profile: DemographicProfile): string {
  const normalized = normalizeDemographics(profile);
  return resolveLabel(RACE_LABELS, normalized.race);
}

export function formatHispanicOrigin(profile: DemographicProfile): string {
  const normalized = normalizeDemographics(profile);
  return resolveLabel(HISPANIC_LABELS, normalized.hispanic_origin);
}

export function describeDemographicProfile(profile: DemographicProfile): {
  normalized: DemographicProfile;
  genderText: string;
  raceText: string;
  hispanicText: string;
  ageText: string;
  summaryParts: string[];
  summary: string;
} {
  const normalized = normalizeDemographics(profile);
  const genderText = formatGenderIdentity(normalized);
  const raceText = formatRace(normalized);
  const hispanicText = formatHispanicOrigin(normalized);
  const ageText = /^\d{1,3}$/.test(normalized.age) ? `age ${normalized.age}` : "";
  const summaryParts = [genderText, raceText, hispanicText, ageText].filter(Boolean);
  return {
    normalized,
    genderText,
    raceText,
    hispanicText,
    ageText,
    summaryParts,
    summary: summaryParts.join(", "),
  };
}

// Not a route component; prevent Expo Router warnings.
export default {};
