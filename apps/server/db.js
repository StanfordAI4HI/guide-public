const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'support.db');
const DB_PATH = process.env.SUPPORT_DB_PATH || DEFAULT_DB_PATH;

const DATABASE_URL = process.env.DATABASE_URL;
const SQLITE_FLAG = String(process.env.FORCE_SQLITE || process.env.USE_SQLITE || '')
  .trim()
  .toLowerCase();
let usePostgres = Boolean(DATABASE_URL) && SQLITE_FLAG !== 'true' && SQLITE_FLAG !== '1';
const sqliteFallbackEnabled = (() => {
  const raw = String(process.env.ALLOW_SQLITE_FALLBACK || '').toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  return (process.env.NODE_ENV || '').toLowerCase() !== 'production';
})();

let Database = usePostgres ? null : require('better-sqlite3');
let PgPoolCtor = null;
if (usePostgres) {
  ({ Pool: PgPoolCtor } = require('pg'));
}

const POSTGRES_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_user_message_at TIMESTAMPTZ,
    last_summary_at TIMESTAMPTZ,
    participant_id TEXT,
    student_id TEXT,
    utorid TEXT,
    utoronto_email TEXT,
    gender_identity TEXT,
    gender_self_describe TEXT,
    race TEXT,
    hispanic_origin TEXT,
    age TEXT,
    study_condition INTEGER,
    condition_started_at TIMESTAMPTZ,
    condition_time_spent_ms BIGINT,
    total_time_spent_ms BIGINT,
    is_finished BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    voice_input_used BOOLEAN DEFAULT FALSE,
    ai_voice_enabled BOOLEAN DEFAULT FALSE
  )`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS participant_id TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS student_id TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS utorid TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS utoronto_email TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS gender_identity TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS gender_self_describe TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS race TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS hispanic_origin TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS age TEXT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS study_condition INTEGER`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS condition_started_at TIMESTAMPTZ`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS condition_time_spent_ms BIGINT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_time_spent_ms BIGINT`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS is_finished BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS voice_input_used BOOLEAN`,
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS ai_voice_enabled BOOLEAN`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS session_summaries (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS session_logs (
    id SERIAL PRIMARY KEY,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    data_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS session_interventions (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    plan_title TEXT,
    summary TEXT,
    selection_reasoning TEXT,
    source_plan_ids_json TEXT,
    activities_json TEXT,
    scores_json TEXT,
    score_notes_json TEXT,
    candidate_rubric_json TEXT,
    selection_rubric_json TEXT,
    cognitive_candidates_json TEXT,
    experiential_candidates_json TEXT,
    step_one_json TEXT,
    step_two_json TEXT,
    card_json TEXT,
    generation_ms DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE session_interventions ADD COLUMN IF NOT EXISTS step_one_json TEXT`,
  `ALTER TABLE session_interventions ADD COLUMN IF NOT EXISTS step_two_json TEXT`,
  `ALTER TABLE session_interventions ADD COLUMN IF NOT EXISTS card_json TEXT`,
  `CREATE TABLE IF NOT EXISTS session_ux_plans (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    summary TEXT,
    focus TEXT,
    conversation TEXT,
    candidates_json TEXT,
    selected_index INTEGER,
    selected_spec_json TEXT,
    rubric_json TEXT,
    fallback_intervention INTEGER DEFAULT 0,
    generation_ms DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE session_ux_plans ADD COLUMN IF NOT EXISTS fallback_intervention INTEGER DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_session_ux_plans_session_id ON session_ux_plans(session_id)`,
  `CREATE TABLE IF NOT EXISTS session_ux_submissions (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    ux_plan_id INTEGER,
    spec_json TEXT,
    modules_json TEXT,
    responses_json TEXT,
    media_json TEXT,
    mood_emotions_json TEXT,
    mood_other_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE session_ux_submissions ADD COLUMN IF NOT EXISTS mood_emotions_json TEXT`,
  `ALTER TABLE session_ux_submissions ADD COLUMN IF NOT EXISTS mood_other_text TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_session_ux_submissions_session_id ON session_ux_submissions(session_id)`,
  `CREATE TABLE IF NOT EXISTS session_ux_module_counts (
    session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
    heading_count INTEGER NOT NULL DEFAULT 0,
    textbox_count INTEGER NOT NULL DEFAULT 0,
    list_textbox_count INTEGER NOT NULL DEFAULT 0,
    mcq_count INTEGER NOT NULL DEFAULT 0,
    short_audio_count INTEGER NOT NULL DEFAULT 0,
    voice_input_count INTEGER NOT NULL DEFAULT 0,
    photo_input_count INTEGER NOT NULL DEFAULT 0,
    chatbot_count INTEGER NOT NULL DEFAULT 0,
    image_count INTEGER NOT NULL DEFAULT 0,
    storyboard_count INTEGER NOT NULL DEFAULT 0,
    dalle_video_count INTEGER NOT NULL DEFAULT 0,
    timer_count INTEGER NOT NULL DEFAULT 0,
    timed_cues_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS heading_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS textbox_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS list_textbox_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS mcq_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS short_audio_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS voice_input_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS photo_input_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS chatbot_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS image_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS storyboard_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS dalle_video_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS timer_count INTEGER DEFAULT 0`,
  `ALTER TABLE session_ux_module_counts ADD COLUMN IF NOT EXISTS timed_cues_count INTEGER DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS session_cognitive_reframe_steps (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    payload_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, step_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_cognitive_reframe_steps_session_id ON session_cognitive_reframe_steps(session_id)`,
  `CREATE TABLE IF NOT EXISTS session_pre_study_steps (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    payload_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, step_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_pre_study_steps_session_id ON session_pre_study_steps(session_id)`,
  `CREATE TABLE IF NOT EXISTS session_intervention_candidates (
    id SERIAL PRIMARY KEY,
    intervention_id INTEGER NOT NULL REFERENCES session_interventions(id) ON DELETE CASCADE,
    plan_id TEXT,
    plan_title TEXT,
    summary TEXT,
    rationale TEXT,
    layer TEXT,
    candidate_id TEXT,
    candidate_index INTEGER,
    activities_json TEXT,
    scores_json TEXT,
    score_notes_json TEXT,
    raw_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE session_intervention_candidates ADD COLUMN IF NOT EXISTS layer TEXT`,
  `ALTER TABLE session_intervention_candidates ADD COLUMN IF NOT EXISTS candidate_id TEXT`,
  `ALTER TABLE session_intervention_candidates ADD COLUMN IF NOT EXISTS candidate_index INTEGER`,
  `ALTER TABLE session_intervention_candidates ADD COLUMN IF NOT EXISTS raw_json TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_session_interventions_session_id ON session_interventions(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intervention_candidates_intervention_id ON session_intervention_candidates(intervention_id)`
];

let sqliteDbInstance = null;
let pgPool = null;
let pgSchemaInitPromise = null;

const UX_MODULE_IDS = [
  'heading',
  'textbox',
  'list_textbox',
  'mcq',
  'short_audio',
  'voice_input',
  'photo_input',
  'chatbot',
  'image',
  'storyboard',
  'dalle_video',
  'timer',
  'timed_cues',
];

const UX_MODULE_COUNT_COLUMNS = UX_MODULE_IDS.map((id) => `${id}_count`);

function serializeJSON(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.error('Failed to serialize JSON payload for db', err);
    return null;
  }
}

function parseJSON(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function buildUxModuleCounts(modules) {
  const counts = UX_MODULE_COUNT_COLUMNS.reduce((acc, col) => {
    acc[col] = 0;
    return acc;
  }, {});
  if (!Array.isArray(modules) || modules.length === 0) return counts;
  const known = new Set(UX_MODULE_IDS);
  modules.forEach((entry) => {
    const moduleId =
      typeof entry === 'string'
        ? entry.trim()
        : entry && typeof entry === 'object' && typeof entry.id === 'string'
          ? entry.id.trim()
          : '';
    if (!moduleId || !known.has(moduleId)) return;
    const col = `${moduleId}_count`;
    counts[col] = (counts[col] || 0) + 1;
  });
  return counts;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getLatestPreStudyPayload(steps, stepKey) {
  if (!Array.isArray(steps) || !stepKey) return null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const row = steps[i];
    if (row?.step_key === stepKey) {
      return row?.payload && typeof row.payload === 'object' ? row.payload : null;
    }
  }
  return null;
}

function computeStressMindsetTotalFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const explicit = toFiniteNumber(payload.stress_mindset_total_score);
  if (explicit != null) return explicit;

  const rawAnswers = Array.isArray(payload.appraisal_answers) ? payload.appraisal_answers : null;
  if (!rawAnswers || rawAnswers.length === 0) return null;

  const reverseIndices = Array.isArray(payload.stress_mindset_reverse_item_indices)
    ? payload.stress_mindset_reverse_item_indices
        .map((v) => toFiniteNumber(v))
        .filter((v) => Number.isInteger(v))
    : [0, 2, 4, 6];
  const reverseSet = new Set(reverseIndices);

  let total = 0;
  for (let i = 0; i < rawAnswers.length; i += 1) {
    const raw = toFiniteNumber(rawAnswers[i]);
    if (raw == null) return null;
    const scored = reverseSet.has(i) ? 4 - raw : raw;
    total += scored;
  }
  return total;
}

function computePssTotalFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const explicit = toFiniteNumber(payload.pss_total_score);
  if (explicit != null) return explicit;

  const rawAnswers = Array.isArray(payload.pss_answers) ? payload.pss_answers : null;
  if (!rawAnswers || rawAnswers.length === 0) return null;

  const reverseIndices = Array.isArray(payload.pss_reverse_item_indices)
    ? payload.pss_reverse_item_indices
        .map((v) => toFiniteNumber(v))
        .filter((v) => Number.isInteger(v))
    : [3, 4, 6, 7];
  const reverseSet = new Set(reverseIndices);

  let total = 0;
  for (let i = 0; i < rawAnswers.length; i += 1) {
    const raw = toFiniteNumber(rawAnswers[i]);
    if (raw == null) return null;
    const scored = reverseSet.has(i) ? 4 - raw : raw;
    total += scored;
  }
  return total;
}

function computeStudyMetrics(preStudySteps) {
  const preStress = getLatestPreStudyPayload(preStudySteps, 'pre_stress');
  const postStudy = getLatestPreStudyPayload(preStudySteps, 'post_study');

  const stressPreRating = toFiniteNumber(preStress?.stress_level);
  const stressPostRating = toFiniteNumber(postStudy?.stress_rating);
  const stressDifferencePreMinusPost =
    stressPreRating != null && stressPostRating != null
      ? stressPreRating - stressPostRating
      : null;

  const stressMindsetPreTotal = computeStressMindsetTotalFromPayload(preStress);
  const stressMindsetPostTotal = computeStressMindsetTotalFromPayload(postStudy);
  const stressMindsetDifferencePreMinusPost =
    stressMindsetPreTotal != null && stressMindsetPostTotal != null
      ? stressMindsetPreTotal - stressMindsetPostTotal
      : null;

  return {
    stress_pre_rating: stressPreRating,
    stress_post_rating: stressPostRating,
    stress_difference_pre_minus_post: stressDifferencePreMinusPost,
    stress_mindset_pre_total: stressMindsetPreTotal,
    stress_mindset_post_total: stressMindsetPostTotal,
    stress_mindset_difference_pre_minus_post: stressMindsetDifferencePreMinusPost,
  };
}

function computePostPersonalization(postStudy) {
  const itemFieldNames = [
    'personalized_specific_situation',
    'system_understood_situation',
    'reflected_shared_information',
    'use_similar_activity_again',
    'recommend_activity_to_others',
    'activity_length_appropriate',
    'enjoyed_taking_part',
  ];
  if (!postStudy || typeof postStudy !== 'object') {
    return { answers: null, mean: null, item_scores: null };
  }
  const answers = Array.isArray(postStudy.personalization_answers)
    ? postStudy.personalization_answers.map((v) => toFiniteNumber(v))
    : null;
  if (!answers || answers.length === 0 || answers.some((v) => v == null)) {
    return {
      answers: answers || null,
      mean: null,
      item_scores: itemFieldNames.reduce((acc, key, idx) => {
        acc[key] = answers?.[idx] ?? null;
        return acc;
      }, {}),
    };
  }
  const sum = answers.reduce((acc, v) => acc + v, 0);
  return {
    answers,
    mean: Number((sum / answers.length).toFixed(4)),
    item_scores: itemFieldNames.reduce((acc, key, idx) => {
      acc[key] = answers[idx] ?? null;
      return acc;
    }, {}),
  };
}

function computePostUeq(postStudy) {
  if (!postStudy || typeof postStudy !== 'object') {
    return {
      raw_answers: null,
      ueq_scores: null,
      pragmatic_mean: null,
      hedonic_mean: null,
      overall_mean: null,
    };
  }
  const rawAnswers = Array.isArray(postStudy.ux_semantic_answers)
    ? postStudy.ux_semantic_answers.map((v) => toFiniteNumber(v))
    : null;
  const ueqScores = Array.isArray(postStudy.ux_ueq_scores)
    ? postStudy.ux_ueq_scores.map((v) => toFiniteNumber(v))
    : null;

  return {
    raw_answers: rawAnswers,
    ueq_scores: ueqScores,
    pragmatic_mean: toFiniteNumber(postStudy.ux_ueq_pragmatic_mean),
    hedonic_mean: toFiniteNumber(postStudy.ux_ueq_hedonic_mean),
    overall_mean: toFiniteNumber(postStudy.ux_ueq_overall_mean),
  };
}

function computeStudyOutcomes(preStudySteps, condition) {
  const preDemographics = getLatestPreStudyPayload(preStudySteps, 'pre_demographics');
  const prePss = getLatestPreStudyPayload(preStudySteps, 'pre_pss');
  const preAttentionCheck = getLatestPreStudyPayload(preStudySteps, 'pre_attention_check');
  const preStress = getLatestPreStudyPayload(preStudySteps, 'pre_stress');
  const postStudy = getLatestPreStudyPayload(preStudySteps, 'post_study');
  const stressMetrics = computeStudyMetrics(preStudySteps);
  const personalization = computePostPersonalization(postStudy);
  const ueq = computePostUeq(postStudy);
  const postAttention = toFiniteNumber(postStudy?.post_attention);
  const postAttentionCheck =
    typeof postStudy?.post_attention_check === 'boolean'
      ? postStudy.post_attention_check
      : postAttention != null
        ? postAttention === 5
        : null;

  return {
    condition: condition == null ? null : Number(condition),
    demographics: {
      participant_id:
        preDemographics?.participant_id ||
        prePss?.participant_id ||
        prePss?.student_id ||
        prePss?.prolific_id ||
        postStudy?.participant_id ||
        null,
      student_id: preDemographics?.student_id || prePss?.student_id || prePss?.prolific_id || null,
      utorid: preDemographics?.utorid || prePss?.utorid || null,
      utoronto_email: preDemographics?.utoronto_email || prePss?.utoronto_email || null,
      gender_identity: preDemographics?.gender_identity || null,
      gender_self_describe: preDemographics?.gender_self_describe || null,
      race: preDemographics?.race || null,
      hispanic_origin: preDemographics?.hispanic_origin || null,
      age: preDemographics?.age || null,
    },
    pre_post: {
      has_pre_stress: Boolean(preStress),
      has_post_study: Boolean(postStudy),
    },
    pre_measures: {
      pss_total_score: computePssTotalFromPayload(prePss),
      attention_check_correct_count:
        typeof preAttentionCheck?.attention_passed === 'number' ? preAttentionCheck.attention_passed : null,
      attention_check_item_count: Array.isArray(preAttentionCheck?.attention_items)
        ? preAttentionCheck.attention_items.length
        : null,
      attention_check_answers: Array.isArray(preAttentionCheck?.attention_answers)
        ? preAttentionCheck.attention_answers.map((v) => toFiniteNumber(v))
        : null,
    },
    stress: {
      pre: stressMetrics.stress_pre_rating,
      post: stressMetrics.stress_post_rating,
      difference_pre_minus_post: stressMetrics.stress_difference_pre_minus_post,
    },
    stress_mindset: {
      pre_total: stressMetrics.stress_mindset_pre_total,
      post_total: stressMetrics.stress_mindset_post_total,
      difference_pre_minus_post: stressMetrics.stress_mindset_difference_pre_minus_post,
    },
    post_personalization: personalization,
    post_attention: {
      post_attention: postAttention,
      post_attention_check: postAttentionCheck,
    },
    post_ueq: ueq,
    post_qualitative: {
      activity_effect_text: postStudy?.activity_effect_text || null,
      tailoring_text: postStudy?.tailoring_text || null,
      helpful_aspects: postStudy?.helpful_aspects || null,
      not_helpful_aspects: postStudy?.not_helpful_aspects || null,
      improvement_suggestions: postStudy?.improvement_suggestions || null,
      technical_issues: postStudy?.technical_issues || null,
      completion_code: postStudy?.completion_code || null,
    },
  };
}

function ensureChatSessionColumnsSQLite(db) {
  const expected = new Map([
    ['participant_id', 'TEXT'],
    ['student_id', 'TEXT'],
    ['utorid', 'TEXT'],
    ['utoronto_email', 'TEXT'],
    ['gender_identity', 'TEXT'],
    ['gender_self_describe', 'TEXT'],
    ['race', 'TEXT'],
    ['hispanic_origin', 'TEXT'],
    ['age', 'TEXT'],
    ['study_condition', 'INTEGER'],
    ['condition_started_at', 'TEXT'],
    ['condition_time_spent_ms', 'INTEGER'],
    ['total_time_spent_ms', 'INTEGER'],
    ['is_finished', 'INTEGER'],
    ['completed_at', 'TEXT'],
    ['voice_input_used', 'INTEGER'],
    ['ai_voice_enabled', 'INTEGER'],
  ]);
  const rows = db.prepare('PRAGMA table_info(chat_sessions)').all();
  const existing = new Set(rows.map((row) => row.name));
  for (const [col, type] of expected.entries()) {
    if (!existing.has(col)) {
      db.prepare(`ALTER TABLE chat_sessions ADD COLUMN ${col} ${type}`).run();
    }
  }
}

function ensureSessionInterventionColumnsSQLite(db) {
  const expected = new Map([
    ['step_one_json', 'TEXT'],
    ['step_two_json', 'TEXT'],
    ['card_json', 'TEXT'],
  ]);
  const rows = db.prepare('PRAGMA table_info(session_interventions)').all();
  const existing = new Set(rows.map((row) => row.name));
  for (const [col, type] of expected.entries()) {
    if (!existing.has(col)) {
      db.prepare(`ALTER TABLE session_interventions ADD COLUMN ${col} ${type}`).run();
    }
  }
}

function updateInterventionCardImageSQLite(sessionId, image = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const row = db
    .prepare('SELECT id, card_json FROM session_interventions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(resolvedSessionId);
  if (!row?.id) return false;
  const card = parseJSON(row.card_json, {}) || {};
  const nextCard = {
    ...card,
    image_url: typeof image.image_url === 'string' ? image.image_url : card.image_url || null,
    image_prompt:
      typeof image.image_prompt === 'string' ? image.image_prompt : card.image_prompt || null,
  };
  db.prepare('UPDATE session_interventions SET card_json = ? WHERE id = ?').run(
    serializeJSON(nextCard),
    row.id
  );
  return true;
}

function ensureInterventionCandidateColumnsSQLite(db) {
  const expected = new Map([
    ['layer', 'TEXT'],
    ['candidate_id', 'TEXT'],
    ['candidate_index', 'INTEGER'],
    ['raw_json', 'TEXT'],
  ]);
  const rows = db.prepare('PRAGMA table_info(session_intervention_candidates)').all();
  const existing = new Set(rows.map((row) => row.name));
  for (const [col, type] of expected.entries()) {
    if (!existing.has(col)) {
      db.prepare(`ALTER TABLE session_intervention_candidates ADD COLUMN ${col} ${type}`).run();
    }
  }
}

function ensureSessionUxSubmissionColumnsSQLite(db) {
  if (!db) return;
  try {
    db.prepare('ALTER TABLE session_ux_submissions ADD COLUMN mood_emotions_json TEXT').run();
  } catch (err) {}
  try {
    db.prepare('ALTER TABLE session_ux_submissions ADD COLUMN mood_other_text TEXT').run();
  } catch (err) {}
}

function ensureSessionUxPlanColumnsSQLite(db) {
  if (!db) return;
  try {
    db.prepare('ALTER TABLE session_ux_plans ADD COLUMN fallback_intervention INTEGER DEFAULT 0').run();
  } catch (err) {}
}

function ensureSessionUxModuleCountColumnsSQLite(db) {
  if (!db) return;
  const expected = new Map([
    ['heading_count', 'INTEGER DEFAULT 0'],
    ['textbox_count', 'INTEGER DEFAULT 0'],
    ['list_textbox_count', 'INTEGER DEFAULT 0'],
    ['mcq_count', 'INTEGER DEFAULT 0'],
    ['short_audio_count', 'INTEGER DEFAULT 0'],
    ['voice_input_count', 'INTEGER DEFAULT 0'],
    ['photo_input_count', 'INTEGER DEFAULT 0'],
    ['chatbot_count', 'INTEGER DEFAULT 0'],
    ['image_count', 'INTEGER DEFAULT 0'],
    ['storyboard_count', 'INTEGER DEFAULT 0'],
    ['dalle_video_count', 'INTEGER DEFAULT 0'],
    ['timer_count', 'INTEGER DEFAULT 0'],
    ['timed_cues_count', 'INTEGER DEFAULT 0'],
    ['created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
    ['updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP'],
  ]);
  const rows = db.prepare('PRAGMA table_info(session_ux_module_counts)').all();
  const existing = new Set(rows.map((row) => row.name));
  for (const [col, type] of expected.entries()) {
    if (!existing.has(col)) {
      db.prepare(`ALTER TABLE session_ux_module_counts ADD COLUMN ${col} ${type}`).run();
    }
  }
}

function createSessionId() {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeProfileValue(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function normalizeConditionValue(value) {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(num)) return null;
  const n = Math.trunc(num);
  return n === 1 || n === 2 ? n : null;
}

function normalizeDurationMsValue(value) {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.trunc(num);
}

function coerceDate(value) {
  if (!value) return value;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function getSQLiteDb() {
  if (!Database) {
    Database = require('better-sqlite3');
  }
  if (sqliteDbInstance) return sqliteDbInstance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  sqliteDbInstance = new Database(DB_PATH);
  sqliteDbInstance.pragma('journal_mode = WAL');
  sqliteDbInstance.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_user_message_at TEXT,
      last_summary_at TEXT,
      participant_id TEXT,
      student_id TEXT,
      utorid TEXT,
      utoronto_email TEXT,
      gender_identity TEXT,
      gender_self_describe TEXT,
      race TEXT,
      hispanic_origin TEXT,
      age TEXT,
      study_condition INTEGER,
      condition_started_at TEXT,
      condition_time_spent_ms INTEGER,
      total_time_spent_ms INTEGER,
      is_finished INTEGER DEFAULT 0,
      completed_at TEXT,
      voice_input_used INTEGER DEFAULT 0,
      ai_voice_enabled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS session_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      event TEXT NOT NULL,
      data_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_logs_created_at ON session_logs(created_at);
    CREATE TABLE IF NOT EXISTS session_interventions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      plan_title TEXT,
      summary TEXT,
      selection_reasoning TEXT,
      source_plan_ids_json TEXT,
      activities_json TEXT,
      scores_json TEXT,
      score_notes_json TEXT,
      candidate_rubric_json TEXT,
      selection_rubric_json TEXT,
      cognitive_candidates_json TEXT,
      experiential_candidates_json TEXT,
      step_one_json TEXT,
      step_two_json TEXT,
      card_json TEXT,
      generation_ms REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS session_ux_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      summary TEXT,
      focus TEXT,
      conversation TEXT,
      candidates_json TEXT,
      selected_index INTEGER,
      selected_spec_json TEXT,
      rubric_json TEXT,
      fallback_intervention INTEGER DEFAULT 0,
      generation_ms REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_ux_plans_session_id ON session_ux_plans(session_id);
    CREATE TABLE IF NOT EXISTS session_ux_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      ux_plan_id INTEGER,
      spec_json TEXT,
      modules_json TEXT,
      responses_json TEXT,
      media_json TEXT,
      mood_emotions_json TEXT,
      mood_other_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_ux_submissions_session_id ON session_ux_submissions(session_id);
    CREATE TABLE IF NOT EXISTS session_ux_module_counts (
      session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
      heading_count INTEGER NOT NULL DEFAULT 0,
      textbox_count INTEGER NOT NULL DEFAULT 0,
      list_textbox_count INTEGER NOT NULL DEFAULT 0,
      mcq_count INTEGER NOT NULL DEFAULT 0,
      short_audio_count INTEGER NOT NULL DEFAULT 0,
      voice_input_count INTEGER NOT NULL DEFAULT 0,
      photo_input_count INTEGER NOT NULL DEFAULT 0,
      chatbot_count INTEGER NOT NULL DEFAULT 0,
      image_count INTEGER NOT NULL DEFAULT 0,
      storyboard_count INTEGER NOT NULL DEFAULT 0,
      dalle_video_count INTEGER NOT NULL DEFAULT 0,
      timer_count INTEGER NOT NULL DEFAULT 0,
      timed_cues_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS session_cognitive_reframe_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_session_cognitive_reframe_steps_session_id ON session_cognitive_reframe_steps(session_id);
    CREATE TABLE IF NOT EXISTS session_pre_study_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_session_pre_study_steps_session_id ON session_pre_study_steps(session_id);
    CREATE TABLE IF NOT EXISTS session_intervention_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intervention_id INTEGER NOT NULL REFERENCES session_interventions(id) ON DELETE CASCADE,
      plan_id TEXT,
      plan_title TEXT,
      summary TEXT,
      rationale TEXT,
      layer TEXT,
      candidate_id TEXT,
      candidate_index INTEGER,
      activities_json TEXT,
      scores_json TEXT,
      score_notes_json TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_interventions_session_id ON session_interventions(session_id);
    CREATE INDEX IF NOT EXISTS idx_intervention_candidates_intervention_id ON session_intervention_candidates(intervention_id);
  `);
  try {
    ensureChatSessionColumnsSQLite(sqliteDbInstance);
    ensureSessionInterventionColumnsSQLite(sqliteDbInstance);
    ensureInterventionCandidateColumnsSQLite(sqliteDbInstance);
    ensureSessionUxSubmissionColumnsSQLite(sqliteDbInstance);
    ensureSessionUxPlanColumnsSQLite(sqliteDbInstance);
    ensureSessionUxModuleCountColumnsSQLite(sqliteDbInstance);
  } catch (err) {
    console.warn('Failed to ensure SQLite columns', err?.message || err);
  }
  return sqliteDbInstance;
}

async function getPgPool() {
  if (!usePostgres) {
    throw new Error('Postgres driver is disabled; falling back to SQLite');
  }
  if (pgPool) return pgPool;
  if (!PgPoolCtor) {
    ({ Pool: PgPoolCtor } = require('pg'));
  }
  const config = {
    connectionString: DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX || process.env.PGPOOLSIZE || 10) || 10,
  };
  const sslEnv = process.env.DATABASE_SSL;
  if (sslEnv) {
    const normalized = sslEnv.toLowerCase();
    if (normalized === 'false' || normalized === '0') {
      config.ssl = false;
    } else {
      config.ssl =
        normalized === 'strict'
          ? { rejectUnauthorized: true }
          : { rejectUnauthorized: false };
    }
  } else if (process.env.NODE_ENV === 'production') {
    config.ssl = { rejectUnauthorized: false };
  }
  pgPool = new PgPoolCtor(config);
  pgPool.on('error', (err) => {
    console.error('Postgres pool error', err);
  });
  return pgPool;
}

async function ensurePgSchema() {
  if (!usePostgres) return;
  if (pgSchemaInitPromise) {
    return pgSchemaInitPromise;
  }
  pgSchemaInitPromise = (async () => {
    const pool = await getPgPool();
    for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
      await pool.query(statement);
    }
  })();
  try {
    await pgSchemaInitPromise;
  } catch (err) {
    pgSchemaInitPromise = null;
    throw err;
  }
}

function ensureSessionSQLite(sessionId) {
  const db = getSQLiteDb();
  const candidate = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (candidate) {
    const existing = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(candidate);
    if (existing?.id) {
      db.prepare('UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(candidate);
      return existing.id;
    }
    try {
      db.prepare('INSERT INTO chat_sessions (id) VALUES (?)').run(candidate);
      return candidate;
    } catch (err) {
      console.error('Failed to insert provided session id, generating new one instead', err?.message || err);
    }
  }
  const newId = createSessionId();
  db.prepare('INSERT INTO chat_sessions (id) VALUES (?)').run(newId);
  return newId;
}

async function ensureSessionPostgres(sessionId) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const candidate = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (candidate) {
    const existing = await pool.query('SELECT id FROM chat_sessions WHERE id = $1', [candidate]);
    if (existing?.rowCount) {
      await pool.query('UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1', [candidate]);
      return candidate;
    }
    try {
      await pool.query('INSERT INTO chat_sessions (id) VALUES ($1)', [candidate]);
      return candidate;
    } catch (err) {
      console.error('Failed to insert provided session id, generating new one instead', err?.message || err);
    }
  }
  const newId = createSessionId();
  await pool.query('INSERT INTO chat_sessions (id) VALUES ($1)', [newId]);
  return newId;
}

function recordMessageSQLite(sessionId, role, content) {
  if (!role || !content) return sessionId;
  const db = getSQLiteDb();
  const id = ensureSessionSQLite(sessionId);
  db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)').run(
    id,
    role,
    content
  );
  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  if (role === 'user') {
    updates.push('last_user_message_at = CURRENT_TIMESTAMP');
  }
  updates.push(`total_time_spent_ms = CASE
    WHEN total_time_spent_ms IS NULL OR CAST((julianday(CURRENT_TIMESTAMP) - julianday(created_at)) * 86400000 AS INTEGER) > total_time_spent_ms
      THEN CAST((julianday(CURRENT_TIMESTAMP) - julianday(created_at)) * 86400000 AS INTEGER)
    ELSE total_time_spent_ms
  END`);
  updates.push(`condition_started_at = CASE
    WHEN study_condition IS NOT NULL THEN COALESCE(condition_started_at, CURRENT_TIMESTAMP)
    ELSE condition_started_at
  END`);
  updates.push(`condition_time_spent_ms = CASE
    WHEN study_condition IS NOT NULL THEN
      CASE
        WHEN condition_time_spent_ms IS NULL OR CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(condition_started_at, created_at))) * 86400000 AS INTEGER) > condition_time_spent_ms
          THEN CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(condition_started_at, created_at))) * 86400000 AS INTEGER)
        ELSE condition_time_spent_ms
      END
    ELSE condition_time_spent_ms
  END`);
  db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(id);
  return id;
}

async function recordMessagePostgres(sessionId, role, content) {
  if (!role || !content) return sessionId;
  await ensurePgSchema();
  const pool = await getPgPool();
  const id = await ensureSessionPostgres(sessionId);
  await pool.query(
    'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
    [id, role, content]
  );
  const updates = ['updated_at = NOW()'];
  if (role === 'user') {
    updates.push('last_user_message_at = NOW()');
  }
  updates.push(`total_time_spent_ms = CASE
    WHEN total_time_spent_ms IS NULL OR CAST(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS BIGINT) > total_time_spent_ms
      THEN CAST(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS BIGINT)
    ELSE total_time_spent_ms
  END`);
  updates.push(`condition_started_at = CASE
    WHEN study_condition IS NOT NULL THEN COALESCE(condition_started_at, NOW())
    ELSE condition_started_at
  END`);
  updates.push(`condition_time_spent_ms = CASE
    WHEN study_condition IS NOT NULL THEN
      CASE
        WHEN condition_time_spent_ms IS NULL OR CAST(EXTRACT(EPOCH FROM (NOW() - COALESCE(condition_started_at, created_at))) * 1000 AS BIGINT) > condition_time_spent_ms
          THEN CAST(EXTRACT(EPOCH FROM (NOW() - COALESCE(condition_started_at, created_at))) * 1000 AS BIGINT)
        ELSE condition_time_spent_ms
      END
    ELSE condition_time_spent_ms
  END`);
  await pool.query(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = $1`, [id]);
  return id;
}

function recordSummarySQLite(sessionId, summary) {
  if (!summary) return sessionId;
  const db = getSQLiteDb();
  const id = ensureSessionSQLite(sessionId);
  db.prepare('INSERT INTO session_summaries (session_id, summary) VALUES (?, ?)').run(id, summary);
  db.prepare(
    'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP, last_summary_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(id);
  return id;
}

async function recordSummaryPostgres(sessionId, summary) {
  if (!summary) return sessionId;
  await ensurePgSchema();
  const pool = await getPgPool();
  const id = await ensureSessionPostgres(sessionId);
  await pool.query('INSERT INTO session_summaries (session_id, summary) VALUES ($1, $2)', [
    id,
    summary,
  ]);
  await pool.query(
    'UPDATE chat_sessions SET updated_at = NOW(), last_summary_at = NOW() WHERE id = $1',
    [id]
  );
  return id;
}

function recordSessionLogSQLite(sessionId, entry = {}) {
  const db = getSQLiteDb();
  const event = typeof entry?.event === 'string' ? entry.event.trim() : '';
  if (!event) return null;
  const resolvedSessionId =
    typeof sessionId === 'string' && sessionId.trim() ? ensureSessionSQLite(sessionId) : null;
  const data = entry?.data && typeof entry.data === 'object' ? entry.data : {};
  const createdAt =
    typeof entry?.created_at === 'string' && entry.created_at.trim()
      ? entry.created_at.trim()
      : new Date().toISOString();
  const insert = db
    .prepare(
      `
      INSERT INTO session_logs (
        session_id,
        event,
        data_json,
        created_at
      ) VALUES (?, ?, ?, ?)
    `
    )
    .run(resolvedSessionId, event, serializeJSON(data || {}), createdAt);
  return { id: insert.lastInsertRowid, session_id: resolvedSessionId };
}

async function recordSessionLogPostgres(sessionId, entry = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const event = typeof entry?.event === 'string' ? entry.event.trim() : '';
  if (!event) return null;
  const resolvedSessionId =
    typeof sessionId === 'string' && sessionId.trim() ? await ensureSessionPostgres(sessionId) : null;
  const data = entry?.data && typeof entry.data === 'object' ? entry.data : {};
  const createdAt =
    typeof entry?.created_at === 'string' && entry.created_at.trim()
      ? entry.created_at.trim()
      : new Date().toISOString();
  const insert = await pool.query(
    `
      INSERT INTO session_logs (
        session_id,
        event,
        data_json,
        created_at
      ) VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [resolvedSessionId, event, serializeJSON(data || {}), createdAt]
  );
  return { id: insert.rows[0]?.id, session_id: resolvedSessionId };
}

function listSessionsSQLite(limit = 50) {
  const db = getSQLiteDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db
    .prepare(
      `
      SELECT
        s.id,
        s.created_at,
        s.updated_at,
        s.last_user_message_at,
        s.last_summary_at,
        s.participant_id,
        s.student_id,
        s.utorid,
        s.utoronto_email,
        s.condition_started_at,
        s.condition_time_spent_ms,
        s.total_time_spent_ms,
        s.study_condition,
        (
          SELECT COALESCE(
            NULLIF(json_extract(pps.payload_json, '$.prolific_id'), ''),
            NULLIF(json_extract(pps.payload_json, '$.participant_id'), '')
          )
          FROM session_pre_study_steps pps
          WHERE pps.session_id = s.id
            AND pps.step_key = 'pre_pss'
          ORDER BY pps.updated_at DESC, pps.created_at DESC
          LIMIT 1
        ) AS prolific_id,
        (
          SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id
        ) AS message_count,
        (
          SELECT content FROM chat_messages m
          WHERE m.session_id = s.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message_preview
      FROM chat_sessions s
      ORDER BY s.updated_at DESC
      LIMIT ?
    `
    )
    .all(safeLimit);
}

async function listSessionsPostgres(limit = 50) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pool.query(
    `
      SELECT
        s.id,
        s.created_at,
        s.updated_at,
        s.last_user_message_at,
        s.last_summary_at,
        s.participant_id,
        s.student_id,
        s.utorid,
        s.utoronto_email,
        s.condition_started_at,
        s.condition_time_spent_ms,
        s.total_time_spent_ms,
        s.study_condition,
        (
          SELECT COALESCE(
            NULLIF((pps.payload_json::jsonb ->> 'prolific_id'), ''),
            NULLIF((pps.payload_json::jsonb ->> 'participant_id'), '')
          )
          FROM session_pre_study_steps pps
          WHERE pps.session_id = s.id
            AND pps.step_key = 'pre_pss'
          ORDER BY pps.updated_at DESC, pps.created_at DESC
          LIMIT 1
        ) AS prolific_id,
        (
          SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id
        ) AS message_count,
        (
          SELECT content FROM chat_messages m
          WHERE m.session_id = s.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message_preview
      FROM chat_sessions s
      ORDER BY s.updated_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );
  return rows.map((row) => ({
    id: row.id,
    created_at: coerceDate(row.created_at),
    updated_at: coerceDate(row.updated_at),
    last_user_message_at: coerceDate(row.last_user_message_at),
    last_summary_at: coerceDate(row.last_summary_at),
    participant_id: row.participant_id || null,
    student_id: row.student_id || null,
    utorid: row.utorid || null,
    utoronto_email: row.utoronto_email || null,
    prolific_id: row.prolific_id || row.participant_id || null,
    condition_started_at: coerceDate(row.condition_started_at),
    condition_time_spent_ms:
      row.condition_time_spent_ms == null ? null : Number(row.condition_time_spent_ms),
    total_time_spent_ms:
      row.total_time_spent_ms == null ? null : Number(row.total_time_spent_ms),
    study_condition:
      row.study_condition == null ? null : Number(row.study_condition),
    message_count: Number(row.message_count || 0),
    last_message_preview: row.last_message_preview || '',
  }));
}

function getSessionSQLite(sessionId) {
  if (!sessionId) return null;
  const db = getSQLiteDb();
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  const messages = db
    .prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId);
  const summaries = db
    .prepare(
      'SELECT id, summary, created_at FROM session_summaries WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId);
  const logs = db
    .prepare(
      'SELECT id, event, data_json, created_at FROM session_logs WHERE session_id = ? ORDER BY created_at ASC'
    )
    .all(sessionId)
    .map((row) => ({
      id: row.id,
      event: row.event,
      data: parseJSON(row.data_json, {}),
      created_at: row.created_at,
    }));
  const interventionStmt = db.prepare(
    'SELECT * FROM session_interventions WHERE session_id = ? ORDER BY created_at DESC'
  );
  const candidateStmt = db.prepare(
    'SELECT * FROM session_intervention_candidates WHERE intervention_id = ? ORDER BY created_at ASC'
  );
  const uxPlanStmt = db.prepare(
    'SELECT * FROM session_ux_plans WHERE session_id = ? ORDER BY created_at DESC'
  );
  const interventions = interventionStmt.all(sessionId).map((row) => ({
    id: row.id,
    plan_title: row.plan_title,
    summary: row.summary,
    selection_reasoning: row.selection_reasoning,
    source_plan_ids: parseJSON(row.source_plan_ids_json, []),
    activities: parseJSON(row.activities_json, []),
    scores: parseJSON(row.scores_json, {}),
    score_notes: parseJSON(row.score_notes_json, {}),
    candidate_rubric: parseJSON(row.candidate_rubric_json, []),
    selection_rubric: parseJSON(row.selection_rubric_json, []),
    cognitive_candidates: parseJSON(row.cognitive_candidates_json, []),
    experiential_candidates: parseJSON(row.experiential_candidates_json, []),
    step_one: parseJSON(row.step_one_json, null),
    step_two: parseJSON(row.step_two_json, null),
    card: parseJSON(row.card_json, null),
    generation_ms: typeof row.generation_ms === 'number' ? row.generation_ms : null,
    created_at: row.created_at,
    candidates: candidateStmt
      .all(row.id)
      .map((candidate) => ({
        id: candidate.id,
        plan_id: candidate.plan_id,
        plan_title: candidate.plan_title,
        summary: candidate.summary,
        rationale: candidate.rationale,
        layer: candidate.layer,
        candidate_id: candidate.candidate_id,
        candidate_index: candidate.candidate_index,
        activities: parseJSON(candidate.activities_json, []),
        scores: parseJSON(candidate.scores_json, {}),
        score_notes: parseJSON(candidate.score_notes_json, {}),
        raw: parseJSON(candidate.raw_json, null),
        created_at: candidate.created_at,
      })),
  }));
  const ux_plans = uxPlanStmt.all(sessionId).map((row) => ({
    id: row.id,
    summary: row.summary,
    focus: row.focus,
    conversation: row.conversation,
    candidates: parseJSON(row.candidates_json, []),
    selected_index:
      typeof row.selected_index === 'number' ? row.selected_index : null,
    selected_spec: parseJSON(row.selected_spec_json, null),
    rubric: parseJSON(row.rubric_json, []),
    fallback_intervention:
      typeof row.fallback_intervention === 'number' && Number.isFinite(row.fallback_intervention)
        ? Number(row.fallback_intervention)
        : 0,
    generation_ms: typeof row.generation_ms === 'number' ? row.generation_ms : null,
    created_at: row.created_at,
  }));
  const uxSubmissionStmt = db.prepare(
    'SELECT * FROM session_ux_submissions WHERE session_id = ? ORDER BY created_at DESC'
  );
  const uxModuleCounts = db
    .prepare('SELECT * FROM session_ux_module_counts WHERE session_id = ?')
    .get(sessionId);
  const ux_submissions = uxSubmissionStmt.all(sessionId).map((row) => ({
    id: row.id,
    ux_plan_id: row.ux_plan_id == null ? null : Number(row.ux_plan_id),
    spec: parseJSON(row.spec_json, null),
    modules: parseJSON(row.modules_json, []),
    responses: parseJSON(row.responses_json, []),
    media: parseJSON(row.media_json, null),
    mood_emotions: parseJSON(row.mood_emotions_json, null),
    mood_other: row.mood_other_text || null,
    created_at: row.created_at,
  }));
  const cognitiveStmt = db.prepare(
    'SELECT * FROM session_cognitive_reframe_steps WHERE session_id = ? ORDER BY created_at ASC'
  );
  const preStudyStmt = db.prepare(
    'SELECT * FROM session_pre_study_steps WHERE session_id = ? ORDER BY created_at ASC'
  );
  const cognitive_reframe_steps = cognitiveStmt.all(sessionId).map((row) => ({
    id: row.id,
    step_key: row.step_key,
    payload: parseJSON(row.payload_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const pre_study_steps = preStudyStmt.all(sessionId).map((row) => ({
    id: row.id,
    step_key: row.step_key,
    payload: parseJSON(row.payload_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const study_metrics = computeStudyMetrics(pre_study_steps);
  const study_outcomes = computeStudyOutcomes(pre_study_steps, session?.study_condition);
  return {
    study_outcomes,
    session,
    messages,
    summaries,
    logs,
    interventions,
    ux_plans,
    ux_submissions,
    ux_module_counts: uxModuleCounts || null,
    cognitive_reframe_steps,
    pre_study_steps,
    study_metrics,
  };
}

function exportAllSessionsSQLite() {
  const db = getSQLiteDb();
  const ids = db
    .prepare(
      `SELECT id
       FROM chat_sessions
       ORDER BY created_at ASC`
    )
    .all();
  return ids
    .map((row) => {
      try {
        return getSessionSQLite(row.id);
      } catch (err) {
        console.error('Failed to export session (sqlite)', row.id, err?.message || err);
        return null;
      }
    })
    .filter(Boolean);
}

async function getSessionPostgres(sessionId) {
  if (!sessionId) return null;
  await ensurePgSchema();
  const pool = await getPgPool();
  const { rows: sessionRows } = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [
    sessionId,
  ]);
  if (sessionRows.length === 0) {
    return null;
  }
  const session = sessionRows[0];
  const { rows: messageRows } = await pool.query(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  const { rows: summaryRows } = await pool.query(
    'SELECT id, summary, created_at FROM session_summaries WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  const { rows: logRows } = await pool.query(
    'SELECT id, event, data_json, created_at FROM session_logs WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  const { rows: interventionRows } = await pool.query(
    'SELECT * FROM session_interventions WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
  const { rows: uxPlanRows } = await pool.query(
    'SELECT * FROM session_ux_plans WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
  const { rows: uxSubmissionRows } = await pool.query(
    'SELECT * FROM session_ux_submissions WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
  const { rows: uxModuleCountRows } = await pool.query(
    'SELECT * FROM session_ux_module_counts WHERE session_id = $1',
    [sessionId]
  );
  const { rows: cognitiveRows } = await pool.query(
    'SELECT * FROM session_cognitive_reframe_steps WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  const { rows: preStudyRows } = await pool.query(
    'SELECT * FROM session_pre_study_steps WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  const interventionIds = interventionRows.map((row) => row.id);
  let candidateMap = new Map();
  if (interventionIds.length > 0) {
    const { rows: candidateRows } = await pool.query(
      'SELECT * FROM session_intervention_candidates WHERE intervention_id = ANY($1::int[]) ORDER BY created_at ASC',
      [interventionIds]
    );
    candidateMap = candidateRows.reduce((map, row) => {
      if (!map.has(row.intervention_id)) {
        map.set(row.intervention_id, []);
      }
      map.get(row.intervention_id).push({
        id: row.id,
        plan_id: row.plan_id,
        plan_title: row.plan_title,
        summary: row.summary,
        rationale: row.rationale,
        layer: row.layer,
        candidate_id: row.candidate_id,
        candidate_index: row.candidate_index,
        activities: parseJSON(row.activities_json, []),
        scores: parseJSON(row.scores_json, {}),
        score_notes: parseJSON(row.score_notes_json, {}),
        raw: parseJSON(row.raw_json, null),
        created_at: coerceDate(row.created_at),
      });
      return map;
    }, new Map());
  }
  const interventions = interventionRows.map((row) => ({
    id: row.id,
    plan_title: row.plan_title,
    summary: row.summary,
    selection_reasoning: row.selection_reasoning,
    source_plan_ids: parseJSON(row.source_plan_ids_json, []),
    activities: parseJSON(row.activities_json, []),
    scores: parseJSON(row.scores_json, {}),
    score_notes: parseJSON(row.score_notes_json, {}),
    candidate_rubric: parseJSON(row.candidate_rubric_json, []),
    selection_rubric: parseJSON(row.selection_rubric_json, []),
    cognitive_candidates: parseJSON(row.cognitive_candidates_json, []),
    experiential_candidates: parseJSON(row.experiential_candidates_json, []),
    step_one: parseJSON(row.step_one_json, null),
    step_two: parseJSON(row.step_two_json, null),
    card: parseJSON(row.card_json, null),
    generation_ms:
      row.generation_ms == null ? null : Number(row.generation_ms),
    created_at: coerceDate(row.created_at),
    candidates: candidateMap.get(row.id) || [],
  }));
  const ux_plans = uxPlanRows.map((row) => ({
    id: row.id,
    summary: row.summary,
    focus: row.focus,
    conversation: row.conversation,
    candidates: parseJSON(row.candidates_json, []),
    selected_index: row.selected_index == null ? null : Number(row.selected_index),
    selected_spec: parseJSON(row.selected_spec_json, null),
    rubric: parseJSON(row.rubric_json, []),
    fallback_intervention:
      row.fallback_intervention == null ? 0 : Number(row.fallback_intervention) ? 1 : 0,
    generation_ms:
      row.generation_ms == null ? null : Number(row.generation_ms),
    created_at: coerceDate(row.created_at),
  }));
  const ux_submissions = uxSubmissionRows.map((row) => ({
    id: row.id,
    ux_plan_id: row.ux_plan_id == null ? null : Number(row.ux_plan_id),
    spec: parseJSON(row.spec_json, null),
    modules: parseJSON(row.modules_json, []),
    responses: parseJSON(row.responses_json, []),
    media: parseJSON(row.media_json, null),
    mood_emotions: parseJSON(row.mood_emotions_json, null),
    mood_other: row.mood_other_text || null,
    created_at: coerceDate(row.created_at),
  }));
  const cognitive_reframe_steps = cognitiveRows.map((row) => ({
    id: row.id,
    step_key: row.step_key,
    payload: parseJSON(row.payload_json, {}),
    created_at: coerceDate(row.created_at),
    updated_at: coerceDate(row.updated_at),
  }));
  const pre_study_steps = preStudyRows.map((row) => ({
    id: row.id,
    step_key: row.step_key,
    payload: parseJSON(row.payload_json, {}),
    created_at: coerceDate(row.created_at),
    updated_at: coerceDate(row.updated_at),
  }));
  const study_metrics = computeStudyMetrics(pre_study_steps);
  const study_outcomes = computeStudyOutcomes(pre_study_steps, session?.study_condition);
  return {
    study_outcomes,
    session: {
      ...session,
      created_at: coerceDate(session.created_at),
      updated_at: coerceDate(session.updated_at),
      last_user_message_at: coerceDate(session.last_user_message_at),
      last_summary_at: coerceDate(session.last_summary_at),
    },
    messages: messageRows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: coerceDate(row.created_at),
    })),
    summaries: summaryRows.map((row) => ({
      id: row.id,
      summary: row.summary,
      created_at: coerceDate(row.created_at),
    })),
    logs: logRows.map((row) => ({
      id: row.id,
      event: row.event,
      data: parseJSON(row.data_json, {}),
      created_at: coerceDate(row.created_at),
    })),
    interventions,
    ux_plans,
    ux_submissions,
    ux_module_counts: uxModuleCountRows[0]
      ? {
          ...uxModuleCountRows[0],
          created_at: coerceDate(uxModuleCountRows[0].created_at),
          updated_at: coerceDate(uxModuleCountRows[0].updated_at),
        }
      : null,
    cognitive_reframe_steps,
    pre_study_steps,
    study_metrics,
  };
}

async function exportAllSessionsPostgres() {
  await ensurePgSchema();
  const pool = await getPgPool();
  const { rows } = await pool.query(
    `SELECT id
     FROM chat_sessions
     ORDER BY created_at ASC`
  );
  const exports = [];
  for (const row of rows) {
    try {
      const record = await getSessionPostgres(row.id);
      if (record) {
        exports.push(record);
      }
    } catch (err) {
      console.error('Failed to export session (postgres)', row.id, err?.message || err);
    }
  }
  return exports;
}

function recordInterventionResultSQLite(sessionId, result = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const candidates = ensureArray(result.candidates);
  const run = db.transaction(() => {
    const interventionStmt = db.prepare(`
      INSERT INTO session_interventions (
        session_id,
        plan_title,
        summary,
        selection_reasoning,
        source_plan_ids_json,
        activities_json,
        scores_json,
        score_notes_json,
        candidate_rubric_json,
        selection_rubric_json,
        cognitive_candidates_json,
        experiential_candidates_json,
        step_one_json,
        step_two_json,
        card_json,
        generation_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const interventionResult = interventionStmt.run(
      resolvedSessionId,
      result.plan_title || null,
      result.summary || null,
      result.selection_reasoning || null,
      serializeJSON(result.source_plan_ids || []),
      serializeJSON(result.activities || []),
      serializeJSON(result.scores || {}),
      serializeJSON(result.score_notes || {}),
      serializeJSON(result.candidate_rubric || []),
      serializeJSON(result.selection_rubric || []),
      serializeJSON(result.cognitive_candidates || []),
      serializeJSON(result.experiential_candidates || []),
      serializeJSON(result.step_one || null),
      serializeJSON(result.step_two || null),
      serializeJSON(result.card || null),
      Number.isFinite(result.generation_ms) ? Number(result.generation_ms) : null
    );
    const interventionId = interventionResult.lastInsertRowid;
    if (!interventionId) {
      throw new Error('Failed to insert intervention record');
    }
    if (candidates.length > 0) {
      const candidateStmt = db.prepare(`
        INSERT INTO session_intervention_candidates (
          intervention_id,
          plan_id,
          plan_title,
          summary,
          rationale,
          layer,
          candidate_id,
          candidate_index,
          activities_json,
          scores_json,
          score_notes_json,
          raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      candidates.forEach((candidate) => {
        candidateStmt.run(
          interventionId,
          candidate?.plan_id || null,
          candidate?.plan_title || null,
          candidate?.summary || null,
          candidate?.rationale || null,
          candidate?.layer || null,
          candidate?.candidate_id || null,
          Number.isFinite(candidate?.candidate_index)
            ? Number(candidate.candidate_index)
            : null,
          serializeJSON(candidate?.activities || []),
          serializeJSON(candidate?.scores || {}),
          serializeJSON(candidate?.score_notes || {}),
          serializeJSON(candidate?.raw || candidate || {})
        );
      });
    }
    return { interventionId, sessionId: resolvedSessionId };
  });
  return run();
}

async function recordInterventionResultPostgres(sessionId, result = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const candidates = ensureArray(result.candidates);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `
        INSERT INTO session_interventions (
          session_id,
          plan_title,
          summary,
          selection_reasoning,
          source_plan_ids_json,
          activities_json,
          scores_json,
          score_notes_json,
          candidate_rubric_json,
          selection_rubric_json,
          cognitive_candidates_json,
          experiential_candidates_json,
          step_one_json,
          step_two_json,
          card_json,
          generation_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `,
      [
        resolvedSessionId,
        result.plan_title || null,
        result.summary || null,
        result.selection_reasoning || null,
        serializeJSON(result.source_plan_ids || []),
        serializeJSON(result.activities || []),
        serializeJSON(result.scores || {}),
        serializeJSON(result.score_notes || {}),
        serializeJSON(result.candidate_rubric || []),
        serializeJSON(result.selection_rubric || []),
        serializeJSON(result.cognitive_candidates || []),
        serializeJSON(result.experiential_candidates || []),
        serializeJSON(result.step_one || null),
        serializeJSON(result.step_two || null),
        serializeJSON(result.card || null),
        Number.isFinite(result.generation_ms) ? Number(result.generation_ms) : null,
      ]
    );
    const interventionId = insertResult.rows[0]?.id;
    if (!interventionId) {
      throw new Error('Failed to insert intervention record');
    }
    if (candidates.length > 0) {
      for (const candidate of candidates) {
        await client.query(
          `
            INSERT INTO session_intervention_candidates (
              intervention_id,
              plan_id,
              plan_title,
              summary,
              rationale,
              layer,
              candidate_id,
              candidate_index,
              activities_json,
              scores_json,
              score_notes_json,
              raw_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `,
          [
            interventionId,
            candidate?.plan_id || null,
            candidate?.plan_title || null,
            candidate?.summary || null,
            candidate?.rationale || null,
            candidate?.layer || null,
            candidate?.candidate_id || null,
            Number.isFinite(candidate?.candidate_index)
              ? Number(candidate.candidate_index)
              : null,
            serializeJSON(candidate?.activities || []),
            serializeJSON(candidate?.scores || {}),
            serializeJSON(candidate?.score_notes || {}),
            serializeJSON(candidate?.raw || candidate || {}),
          ]
        );
      }
    }
    await client.query('COMMIT');
    return { interventionId, sessionId: resolvedSessionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateInterventionCardImagePostgres(sessionId, image = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const { rows } = await pool.query(
    'SELECT id, card_json FROM session_interventions WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [resolvedSessionId]
  );
  const row = rows[0];
  if (!row?.id) return false;
  const card = parseJSON(row.card_json, {}) || {};
  const nextCard = {
    ...card,
    image_url: typeof image.image_url === 'string' ? image.image_url : card.image_url || null,
    image_prompt:
      typeof image.image_prompt === 'string' ? image.image_prompt : card.image_prompt || null,
  };
  await pool.query('UPDATE session_interventions SET card_json = $1 WHERE id = $2', [
    serializeJSON(nextCard),
    row.id,
  ]);
  return true;
}

function updateSessionDemographicsSQLite(sessionId, profile = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  db.prepare(
    `
    UPDATE chat_sessions
    SET
      participant_id = COALESCE(?, participant_id),
      student_id = COALESCE(?, student_id),
      utorid = COALESCE(?, utorid),
      utoronto_email = COALESCE(?, utoronto_email),
      gender_identity = COALESCE(?, gender_identity),
      gender_self_describe = COALESCE(?, gender_self_describe),
      race = COALESCE(?, race),
      hispanic_origin = COALESCE(?, hispanic_origin),
      age = COALESCE(?, age),
      study_condition = COALESCE(?, study_condition),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(
    normalizeProfileValue(profile.participant_id),
    normalizeProfileValue(profile.student_id),
    normalizeProfileValue(profile.utorid),
    normalizeProfileValue(profile.utoronto_email),
    normalizeProfileValue(profile.gender_identity),
    normalizeProfileValue(profile.gender_self_describe),
    normalizeProfileValue(profile.race),
    normalizeProfileValue(profile.hispanic_origin),
    normalizeProfileValue(profile.age),
    normalizeConditionValue(profile.study_condition ?? profile.condition),
    resolvedSessionId
  );
  return resolvedSessionId;
}

async function updateSessionDemographicsPostgres(sessionId, profile = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  await pool.query(
    `
      UPDATE chat_sessions
      SET
        participant_id = COALESCE($2, participant_id),
        student_id = COALESCE($3, student_id),
        utorid = COALESCE($4, utorid),
        utoronto_email = COALESCE($5, utoronto_email),
        gender_identity = COALESCE($6, gender_identity),
        gender_self_describe = COALESCE($7, gender_self_describe),
        race = COALESCE($8, race),
        hispanic_origin = COALESCE($9, hispanic_origin),
        age = COALESCE($10, age),
        study_condition = COALESCE($11, study_condition),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      resolvedSessionId,
      normalizeProfileValue(profile.participant_id),
      normalizeProfileValue(profile.student_id),
      normalizeProfileValue(profile.utorid),
      normalizeProfileValue(profile.utoronto_email),
      normalizeProfileValue(profile.gender_identity),
      normalizeProfileValue(profile.gender_self_describe),
      normalizeProfileValue(profile.race),
      normalizeProfileValue(profile.hispanic_origin),
      normalizeProfileValue(profile.age),
      normalizeConditionValue(profile.study_condition ?? profile.condition),
    ]
  );
  return resolvedSessionId;
}

function updateSessionVoiceFlagsSQLite(sessionId, flags = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const voiceInput = flags.voice_input_used === true ? 1 : null;
  const aiVoice = flags.ai_voice_enabled === true ? 1 : null;
  db.prepare(
    `
    UPDATE chat_sessions
    SET
      voice_input_used = CASE WHEN ? = 1 THEN 1 ELSE voice_input_used END,
      ai_voice_enabled = CASE WHEN ? = 1 THEN 1 ELSE ai_voice_enabled END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(voiceInput, aiVoice, resolvedSessionId);
  return resolvedSessionId;
}

async function updateSessionVoiceFlagsPostgres(sessionId, flags = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const voiceInput = flags.voice_input_used === true;
  const aiVoice = flags.ai_voice_enabled === true;
  await pool.query(
    `
      UPDATE chat_sessions
      SET
        voice_input_used = CASE WHEN $2 = TRUE THEN TRUE ELSE voice_input_used END,
        ai_voice_enabled = CASE WHEN $3 = TRUE THEN TRUE ELSE ai_voice_enabled END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [resolvedSessionId, voiceInput, aiVoice]
  );
  return resolvedSessionId;
}

function updateSessionTimingSQLite(sessionId, timing = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const condition = normalizeConditionValue(timing.condition);
  const durationMs = normalizeDurationMsValue(timing.total_time_spent_ms);
  const completed = timing.completed === true ? 1 : 0;
  db.prepare(
    `
    UPDATE chat_sessions
    SET
      study_condition = COALESCE(?, study_condition),
      condition_started_at = CASE
        WHEN ? IS NOT NULL THEN COALESCE(condition_started_at, CURRENT_TIMESTAMP)
        ELSE condition_started_at
      END,
      condition_time_spent_ms = CASE
        WHEN ? = 1 THEN
          CASE
            WHEN condition_time_spent_ms IS NULL OR CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(condition_started_at, created_at))) * 86400000 AS INTEGER) > condition_time_spent_ms
              THEN CAST((julianday(CURRENT_TIMESTAMP) - julianday(COALESCE(condition_started_at, created_at))) * 86400000 AS INTEGER)
            ELSE condition_time_spent_ms
          END
        ELSE condition_time_spent_ms
      END,
      total_time_spent_ms = CASE
        WHEN ? IS NOT NULL THEN
          CASE
            WHEN total_time_spent_ms IS NULL OR ? > total_time_spent_ms THEN ?
            ELSE total_time_spent_ms
          END
        ELSE
          CASE
            WHEN total_time_spent_ms IS NULL OR CAST((julianday(CURRENT_TIMESTAMP) - julianday(created_at)) * 86400000 AS INTEGER) > total_time_spent_ms
              THEN CAST((julianday(CURRENT_TIMESTAMP) - julianday(created_at)) * 86400000 AS INTEGER)
            ELSE total_time_spent_ms
          END
      END,
      completed_at = CASE
        WHEN ? = 1 THEN COALESCE(completed_at, CURRENT_TIMESTAMP)
        ELSE completed_at
      END,
      is_finished = CASE
        WHEN ? = 1 THEN 1
        ELSE COALESCE(is_finished, 0)
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(
    condition,
    condition,
    completed,
    durationMs,
    durationMs,
    durationMs,
    completed,
    completed,
    resolvedSessionId
  );
  return resolvedSessionId;
}

async function updateSessionTimingPostgres(sessionId, timing = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const condition = normalizeConditionValue(timing.condition);
  const durationMs = normalizeDurationMsValue(timing.total_time_spent_ms);
  const completed = timing.completed === true;
  await pool.query(
    `
      UPDATE chat_sessions
      SET
        study_condition = COALESCE($2::INTEGER, study_condition),
        condition_started_at = CASE
          WHEN $2::INTEGER IS NOT NULL THEN COALESCE(condition_started_at, NOW())
          ELSE condition_started_at
        END,
        condition_time_spent_ms = CASE
          WHEN $4::BOOLEAN = TRUE THEN
            CASE
              WHEN condition_time_spent_ms IS NULL OR CAST(EXTRACT(EPOCH FROM (NOW() - COALESCE(condition_started_at, created_at))) * 1000 AS BIGINT) > condition_time_spent_ms
                THEN CAST(EXTRACT(EPOCH FROM (NOW() - COALESCE(condition_started_at, created_at))) * 1000 AS BIGINT)
              ELSE condition_time_spent_ms
            END
          ELSE
            condition_time_spent_ms
        END,
        total_time_spent_ms = CASE
          WHEN $3::BIGINT IS NOT NULL THEN
            CASE
              WHEN total_time_spent_ms IS NULL OR $3::BIGINT > total_time_spent_ms THEN $3::BIGINT
              ELSE total_time_spent_ms
            END
          ELSE
            CASE
              WHEN total_time_spent_ms IS NULL OR CAST(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS BIGINT) > total_time_spent_ms
                THEN CAST(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000 AS BIGINT)
              ELSE total_time_spent_ms
            END
        END,
        completed_at = CASE
          WHEN $4::BOOLEAN = TRUE THEN COALESCE(completed_at, NOW())
          ELSE completed_at
        END,
        is_finished = CASE
          WHEN $4::BOOLEAN = TRUE THEN TRUE
          ELSE COALESCE(is_finished, FALSE)
        END,
        updated_at = NOW()
      WHERE id = $1
    `,
    [resolvedSessionId, condition, durationMs, completed]
  );
  return resolvedSessionId;
}

function recordUxPlannerResultSQLite(sessionId, result = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const stmt = db.prepare(`
    INSERT INTO session_ux_plans (
      session_id,
      summary,
      focus,
      conversation,
      candidates_json,
      selected_index,
      selected_spec_json,
      rubric_json,
      fallback_intervention,
      generation_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insert = stmt.run(
    resolvedSessionId,
    result.summary || null,
    result.focus || null,
    result.conversation || null,
    serializeJSON(result.candidates || []),
    Number.isFinite(result.selected_index) ? Number(result.selected_index) : null,
    serializeJSON(result.selected_spec || null),
    serializeJSON(result.rubric || []),
    Number(result.fallback_intervention) ? 1 : 0,
    Number.isFinite(result.generation_ms) ? Number(result.generation_ms) : null
  );
  return { id: insert.lastInsertRowid, sessionId: resolvedSessionId };
}

async function recordUxPlannerResultPostgres(sessionId, result = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const insert = await pool.query(
    `
      INSERT INTO session_ux_plans (
        session_id,
        summary,
        focus,
        conversation,
        candidates_json,
        selected_index,
        selected_spec_json,
        rubric_json,
        fallback_intervention,
        generation_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `,
    [
      resolvedSessionId,
      result.summary || null,
      result.focus || null,
      result.conversation || null,
      serializeJSON(result.candidates || []),
      Number.isFinite(result.selected_index) ? Number(result.selected_index) : null,
      serializeJSON(result.selected_spec || null),
      serializeJSON(result.rubric || []),
      Number(result.fallback_intervention) ? 1 : 0,
      Number.isFinite(result.generation_ms) ? Number(result.generation_ms) : null,
    ]
  );
  return { id: insert.rows[0]?.id, sessionId: resolvedSessionId };
}

function recordUxSubmissionSQLite(sessionId, result = {}) {
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  const moduleCounts = buildUxModuleCounts(result.modules || []);
  const stmt = db.prepare(`
    INSERT INTO session_ux_submissions (
      session_id,
      ux_plan_id,
      spec_json,
      modules_json,
      responses_json,
      media_json,
      mood_emotions_json,
      mood_other_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insert = stmt.run(
    resolvedSessionId,
    Number.isFinite(result.ux_plan_id) ? Number(result.ux_plan_id) : null,
    serializeJSON(result.spec || null),
    serializeJSON(result.modules || []),
    serializeJSON(result.responses || []),
    serializeJSON(result.media || null),
    serializeJSON(result.mood_emotions || null),
    result.mood_other || null
  );
  const upsertSql = `
    INSERT INTO session_ux_module_counts (
      session_id,
      ${UX_MODULE_COUNT_COLUMNS.join(', ')},
      updated_at
    ) VALUES (?, ${UX_MODULE_COUNT_COLUMNS.map(() => '?').join(', ')}, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id) DO UPDATE SET
      ${UX_MODULE_COUNT_COLUMNS.map((col) => `${col} = excluded.${col}`).join(', ')},
      updated_at = CURRENT_TIMESTAMP
  `;
  db.prepare(upsertSql).run(
    resolvedSessionId,
    ...UX_MODULE_COUNT_COLUMNS.map((col) => moduleCounts[col] || 0)
  );
  return { id: insert.lastInsertRowid, sessionId: resolvedSessionId };
}

async function recordUxSubmissionPostgres(sessionId, result = {}) {
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  const moduleCounts = buildUxModuleCounts(result.modules || []);
  const insert = await pool.query(
    `
      INSERT INTO session_ux_submissions (
        session_id,
        ux_plan_id,
        spec_json,
        modules_json,
        responses_json,
        media_json,
        mood_emotions_json,
        mood_other_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `,
    [
      resolvedSessionId,
      Number.isFinite(result.ux_plan_id) ? Number(result.ux_plan_id) : null,
      serializeJSON(result.spec || null),
      serializeJSON(result.modules || []),
      serializeJSON(result.responses || []),
      serializeJSON(result.media || null),
      serializeJSON(result.mood_emotions || null),
      result.mood_other || null,
    ]
  );
  await pool.query(
    `
      INSERT INTO session_ux_module_counts (
        session_id,
        ${UX_MODULE_COUNT_COLUMNS.join(', ')},
        updated_at
      ) VALUES ($1, ${UX_MODULE_COUNT_COLUMNS.map((_, idx) => `$${idx + 2}`).join(', ')}, NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        ${UX_MODULE_COUNT_COLUMNS.map((col) => `${col} = EXCLUDED.${col}`).join(', ')},
        updated_at = NOW()
    `,
    [resolvedSessionId, ...UX_MODULE_COUNT_COLUMNS.map((col) => moduleCounts[col] || 0)]
  );
  return { id: insert.rows[0]?.id, sessionId: resolvedSessionId };
}

async function ensureSession(sessionId) {
  return withDriver(
    () => ensureSessionPostgres(sessionId),
    () => ensureSessionSQLite(sessionId),
    'ensureSession'
  );
}

async function recordMessage(sessionId, role, content) {
  return withDriver(
    () => recordMessagePostgres(sessionId, role, content),
    () => recordMessageSQLite(sessionId, role, content),
    'recordMessage'
  );
}

async function recordSummary(sessionId, summary) {
  return withDriver(
    () => recordSummaryPostgres(sessionId, summary),
    () => recordSummarySQLite(sessionId, summary),
    'recordSummary'
  );
}

async function recordSessionLog(sessionId, entry = {}) {
  return withDriver(
    () => recordSessionLogPostgres(sessionId, entry),
    () => recordSessionLogSQLite(sessionId, entry),
    'recordSessionLog'
  );
}

async function listSessions(limit = 50) {
  return withDriver(
    () => listSessionsPostgres(limit),
    () => listSessionsSQLite(limit),
    'listSessions'
  );
}

async function getSession(sessionId) {
  return withDriver(
    () => getSessionPostgres(sessionId),
    () => getSessionSQLite(sessionId),
    'getSession'
  );
}

async function exportAllSessions() {
  return withDriver(
    () => exportAllSessionsPostgres(),
    () => exportAllSessionsSQLite(),
    'exportAllSessions'
  );
}

async function recordInterventionResult(sessionId, result = {}) {
  return withDriver(
    () => recordInterventionResultPostgres(sessionId, result),
    () => recordInterventionResultSQLite(sessionId, result),
    'recordInterventionResult'
  );
}

async function updateInterventionCardImage(sessionId, image = {}) {
  return withDriver(
    () => updateInterventionCardImagePostgres(sessionId, image),
    () => updateInterventionCardImageSQLite(sessionId, image),
    'updateInterventionCardImage'
  );
}

async function recordUxPlannerResult(sessionId, result = {}) {
  return withDriver(
    () => recordUxPlannerResultPostgres(sessionId, result),
    () => recordUxPlannerResultSQLite(sessionId, result),
    'recordUxPlannerResult'
  );
}

async function recordUxSubmission(sessionId, result = {}) {
  return withDriver(
    () => recordUxSubmissionPostgres(sessionId, result),
    () => recordUxSubmissionSQLite(sessionId, result),
    'recordUxSubmission'
  );
}

function recordCognitiveReframeStepSQLite(sessionId, stepKey, payload = {}) {
  if (!stepKey || typeof stepKey !== 'string') return null;
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  db.prepare(
    `
      INSERT INTO session_cognitive_reframe_steps (
        session_id, step_key, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, step_key)
      DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(resolvedSessionId, stepKey.trim(), serializeJSON(payload || {}));
  return resolvedSessionId;
}

async function recordCognitiveReframeStepPostgres(sessionId, stepKey, payload = {}) {
  if (!stepKey || typeof stepKey !== 'string') return null;
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  await pool.query(
    `
      INSERT INTO session_cognitive_reframe_steps (
        session_id, step_key, payload_json, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (session_id, step_key)
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        updated_at = NOW()
    `,
    [resolvedSessionId, stepKey.trim(), serializeJSON(payload || {})]
  );
  return resolvedSessionId;
}

async function recordCognitiveReframeStep(sessionId, stepKey, payload = {}) {
  return withDriver(
    () => recordCognitiveReframeStepPostgres(sessionId, stepKey, payload),
    () => recordCognitiveReframeStepSQLite(sessionId, stepKey, payload),
    'recordCognitiveReframeStep'
  );
}

function recordPreStudyStepSQLite(sessionId, stepKey, payload = {}) {
  if (!stepKey || typeof stepKey !== 'string') return null;
  const db = getSQLiteDb();
  const resolvedSessionId = ensureSessionSQLite(sessionId);
  db.prepare(
    `
      INSERT INTO session_pre_study_steps (
        session_id, step_key, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, step_key)
      DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = CURRENT_TIMESTAMP
    `
  ).run(resolvedSessionId, stepKey.trim(), serializeJSON(payload || {}));
  return resolvedSessionId;
}

async function recordPreStudyStepPostgres(sessionId, stepKey, payload = {}) {
  if (!stepKey || typeof stepKey !== 'string') return null;
  await ensurePgSchema();
  const pool = await getPgPool();
  const resolvedSessionId = await ensureSessionPostgres(sessionId);
  await pool.query(
    `
      INSERT INTO session_pre_study_steps (
        session_id, step_key, payload_json, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (session_id, step_key)
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        updated_at = NOW()
    `,
    [resolvedSessionId, stepKey.trim(), serializeJSON(payload || {})]
  );
  return resolvedSessionId;
}

async function recordPreStudyStep(sessionId, stepKey, payload = {}) {
  return withDriver(
    () => recordPreStudyStepPostgres(sessionId, stepKey, payload),
    () => recordPreStudyStepSQLite(sessionId, stepKey, payload),
    'recordPreStudyStep'
  );
}

async function updateSessionDemographics(sessionId, profile = {}) {
  return withDriver(
    () => updateSessionDemographicsPostgres(sessionId, profile),
    () => updateSessionDemographicsSQLite(sessionId, profile),
    'updateSessionDemographics'
  );
}

async function updateSessionVoiceFlags(sessionId, flags = {}) {
  return withDriver(
    () => updateSessionVoiceFlagsPostgres(sessionId, flags),
    () => updateSessionVoiceFlagsSQLite(sessionId, flags),
    'updateSessionVoiceFlags'
  );
}

async function updateSessionTiming(sessionId, timing = {}) {
  return withDriver(
    () => updateSessionTimingPostgres(sessionId, timing),
    () => updateSessionTimingSQLite(sessionId, timing),
    'updateSessionTiming'
  );
}

function shouldFallbackToSQLite() {
  if (!usePostgres) return false;
  return sqliteFallbackEnabled;
}

async function withDriver(postgresFn, sqliteFn, contextLabel = 'db operation') {
  if (!usePostgres) {
    return sqliteFn();
  }
  try {
    return await postgresFn();
  } catch (err) {
    if (shouldFallbackToSQLite()) {
      console.warn(
        `Postgres unavailable during ${contextLabel}; falling back to SQLite`,
        err?.message || err
      );
      usePostgres = false;
      pgPool = null;
      pgSchemaInitPromise = null;
      return sqliteFn();
    }
    throw err;
  }
}

module.exports = {
  ensureSession,
  recordMessage,
  recordSummary,
  recordSessionLog,
  listSessions,
  getSession,
  recordInterventionResult,
  updateInterventionCardImage,
  recordUxPlannerResult,
  recordUxSubmission,
  recordCognitiveReframeStep,
  recordPreStudyStep,
  updateSessionDemographics,
  updateSessionVoiceFlags,
  updateSessionTiming,
  exportAllSessions,
};
