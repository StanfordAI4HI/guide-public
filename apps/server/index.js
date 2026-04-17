// index.js (CommonJS)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  CORE_CHAT_INSTRUCTION,
  EVALUATION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  ACKNOWLEDGMENT_SYSTEM_PROMPT,
  CONTROL_SYSTEM_PROMPT,
  AUTO_USER_SYSTEM_PROMPT,
  SAFETY_CHECK_PROMPT,
} = require('./prompts');
const {
  INTERVENTION_CANDIDATE_PROMPT,
  INTERVENTION_SELECTION_PROMPT,
  CANDIDATE_RUBRIC,
  SELECTION_RUBRIC,
} = require('./interventionPrompt');
const { UX_FULL_RUBRIC_TEXT } = require('./uxRubrics');
const { UX_FULL_RUBRIC } = require('./uxRubrics');
const {
  COGNITIVE_LAYER_RUBRIC,
  EXPERIENTIAL_LAYER_RUBRIC,
  INTEGRATION_RUBRIC,
  LAYERED_COGNITIVE_PROMPT,
  LAYERED_EXPERIENTIAL_PROMPT,
  LAYERED_SELECTION_PROMPT,
  LAYERED_V2_COMBINE_PROMPT,
  LAYERED_V2_JUDGE_PROMPT,
  LAYERED_DETAIL_PROMPT,
} = require('./layeredInterventionPrompt');
const sessionStore = require('./db');
const { generateImage } = require('./imageGen');
const { synthesizeSpeech } = require('./tts');
const { classifyThinkingTrap, TRAPS: TRAP_LIST } = require('./thinkingTraps');
const { generateReframe, assistReframe } = require('./reframeGenerator');

const MEDIA_CACHE_DIR = path.join(__dirname, 'data', 'media-cache');

function ensureMediaCacheDir() {
  try {
    fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
  } catch (err) {
    console.warn('Failed to create media cache dir', err?.message || err);
  }
}

function getMediaCachePath(fileName) {
  return path.join(MEDIA_CACHE_DIR, fileName);
}

function inferImageExtension(contentType, fallback = 'png') {
  if (!contentType || typeof contentType !== 'string') return fallback;
  const lower = contentType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  return fallback;
}

async function cacheImageFromUrl(url) {
  if (!url) return null;
  ensureMediaCacheDir();
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`image fetch failed ${resp.status}`);
  }
  const contentType = resp.headers.get('content-type') || '';
  const ext = inferImageExtension(contentType, 'png');
  const fileName = `${hash}.${ext}`;
  const filePath = getMediaCachePath(fileName);
  if (fs.existsSync(filePath)) {
    return `/media/cache/${fileName}`;
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return `/media/cache/${fileName}`;
}

async function cacheImageFromB64(b64) {
  if (!b64) return null;
  ensureMediaCacheDir();
  const hash = crypto.createHash('sha256').update(b64).digest('hex');
  const fileName = `${hash}.png`;
  const filePath = getMediaCachePath(fileName);
  if (fs.existsSync(filePath)) {
    return `/media/cache/${fileName}`;
  }
  const buffer = Buffer.from(b64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return `/media/cache/${fileName}`;
}

const UX_PALETTE = [
  'UX palette. Compose intervention experiences from a bounded set of modules. Select only modules that clearly support the current activity. Keep flow coherent and time-bounded (~10 minutes).',
  'Global quality rules: descriptive fields >=1 informative sentence. Any GPT-facing prompt/script >=3 informative sentences and grounded in user context without parroting prior text.',
  'Use/selection intent:',
  '- heading: framing/orientation; set expectations before action. Avoid stacking headings.',
  '- mcq: lightweight branching or prioritization; 3-5 options; allow_multiple true/false.',
  '- textbox: short free-form capture; avoid long forms.',
  '- list_textbox: structured decomposition into multiple entries.',
  '- voice_input: spoken reflection/rehearsal (20-60s) when typing is burdensome.',
  '- photo_input: visual evidence/context when image capture is relevant.',
  '- chatbot: short adaptive scaffold (3-6 turns), not open-ended therapy-like chat.',
  '- image: static visual anchor for mood/focus (no text in image).',
  '- storyboard: narrative progression in 2-4 cards.',
  '- dalle_video: modeled vignette in exactly 4 beats with short per-beat script/captions.',
  '- short_audio: guided audio in ~45-120s for quick regulation/reframing.',
  '- timer: time-boxed action and follow-up reflection.',
  '- timed_cues: paced stepwise guidance (e.g., breathing/micro-steps) with a clear what/why/how intro before the cues start.',
  'Element-specific generation guidance:',
  '- heading: warm headline that names the beat. Params: text.',
  '- mcq: concise question + 3-5 options; include allow_multiple. Params: question, options, allow_multiple, purpose.',
  '- textbox: concise question + placeholder. Params: question, placeholder, allow_voice, purpose.',
  '- list_textbox: overall prompt + per-item labels/placeholders. Params: prompt, items[].label, items[].placeholder, purpose.',
  '- voice_input: recording invite tied to context. Ask for recording only (no typing alternatives). Params: prompt, purpose.',
  '- photo_input: concrete capture instruction. Params: prompt, accept_camera_gallery, purpose.',
  '- chatbot: first prompt must acknowledge user context, state identity/purpose, and immediately give the first task step. Params: persona, first_prompt, conversation_state, purpose.',
  '- image: prompt should describe supportive visual tone/scene relevance; avoid text/faces. Params: prompt, purpose.',
  '- storyboard: 2-4 frames, each with title + one-line text + image_prompt. Params: frames[].title, frames[].line, frames[].image_prompt, purpose.',
  '- dalle_video: exactly 4 prompts and 4 script lines; each beat should move grounding -> release -> reframe -> next step. Params: prompts[], script[], purpose.',
  '- short_audio: 45-120s script with tone/voice hints plus user-facing purpose and rationale. Params: script, tone, voice_pitch, voice_rate, purpose, rationale.',
  '- timer: include seconds, clear action during countdown, and post-timer report prompt/placeholder. Params: seconds, text, action, report_prompt, report_placeholder, purpose.',
  '- timed_cues: include timer_steps (label+seconds), audio_script, and a user-facing purpose that clearly says what is about to happen, why it helps now, and how to follow the cues. Keep narration slow and guided, with gentle pacing and short pauses between cue lines. Prefer voice_rate 0.5-0.7 (target 0.6). Params: timer_steps, audio_script, purpose.',
  'Composition constraints:',
  '- Do not combine timer and timed_cues in the same activity.',
  '- Keep typing burden low; prefer concise responses and choice-based interactions where possible.',
  '- If module id is voice_input, all user-facing copy must ask for recording only and must not suggest typing as an alternative.',
  '- If evidence capture is required, end the final screen with exactly one of textbox, voice_input, or photo_input.',
  '- Ground prompts in user conversation context and keep copy user-friendly.',
].join('\n');

const LAB_BLOCK_TYPES = [
  'instruction',
  'reflection',
  'voice',
  'visualization',
  'steps',
  'action_plan',
  'sketch',
  'sensory',
  'report',
  'timer',
  'evaluation',
  'container',
];

const LAB_BLOCK_GENERATION_PROMPT = `
You are the Intervention Lab planner. Transform the designer's quick idea into a short stack of interactive blocks the app can render.

Return valid JSON with this shape:
{
  "reasoning": "2-3 sentences explaining how the blocks support the idea",
  "layer_type": "cognitive" | "experiential" (optional but preferred),
  "blocks": [
    {
      "type": one of [${LAB_BLOCK_TYPES.join(', ')}],
      "title": "short headline",
      "subtitle": "1-2 sentences explaining why this block helps",
      "prompt": "brief actionable instruction",
      "details": ["optional bullet", "optional bullet"],
      "steps": ["optional step 1", "optional step 2"],
      "minutes": optional number of minutes between 1 and 20
    }
  ]
}

Guidelines:
- Produce 2-6 blocks that can be completed inside the chat within ~10 minutes.
- Keep prompts actionable and concise.
- Only include steps when the block type is "steps".
- Minutes are optional; include them only when they help.
- You may repeat block types if helpful.
- Ensure reasoning references the user's idea and, in order, explains why each block was chosen.
- Subtitle must clearly justify the block's role in the flow (no generic phrasing).
`;

const STRESS_SUMMARY_SEEDS = [
  'Juggling a product launch while covering for a teammate on leave has stretched me thin. I am waking up in the night thinking about what I missed, and I feel guilty when I log off to help family.',
  'My classes, part-time job, and internship all collide this month. I keep re-reading my to-do list and feel like I am failing everyone, even when I am working late into the night.',
  'Caring for my dad after his surgery while keeping up with remote work leaves me on edge. Every notification makes me jump, and I am not sure how to ask my manager for space.',
  'We are moving apartments and childcare fell through this week. The boxes everywhere make me feel behind, and my partner and I keep snapping at each other about what to pack first.',
  'I have been studying for a certification exam while onboarding to a new role. My brain feels foggy, and small mistakes make me panic that I am not ready for either.',
];

const STRESS_SUMMARY_PROMPT = `
You draft short stress summaries for realistic everyday situations.

Return JSON:
{
  "summary": "2-3 sentences about a believable stressful moment with concrete details."
}

Guidelines:
- Mix work, caretaking, school, or home logistics stressors.
- Keep language plain and grounded in one person’s experience.
- Avoid safety concerns or crises; stay with mild-to-moderate stress.
`;

const STRESS_INTERVENTION_PROMPT_AUDIO = `
You design a single short audio-based support focused on reframing and motivation (not breathing). The requested medium will be short_audio. Bind the support to that medium—no substitutions or fallbacks.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 15,
  "step": {
    "title": "Step 1",
    "minutes": 8,
    "medium": "short_audio",
    "instruction": "plain text fallback describing the reframe or motivation",
    "asset": {
      "type": "audio|music|ambient",
      "audio_script": "warm, specific, 6-9 sentences that reframe the situation and give a motivating nudge",
      "audio_tone": "GPT-like: calm peer, upbeat coach, or gentle guide — match to summary/focus",
      "voice_pitch": 1.05,
      "voice_rate": 1.05,
      "music_prompt": "one-line background music/ambience suggestion (e.g., soft piano, rain) — keep it audible but not overpowering",
      "music_choice": "one of: piano | rain | white_noise",
      "duration_seconds": 60,
      "purpose": "1 sentence telling the user why to listen right now (user-facing)",
      "explanation": "3-4 sentences explaining why this tone/pitch/rate/music choice fits the summary/focus"
    }
  },
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- Use the requested medium (short_audio) as asset.type (audio).
- The audio_script must reframe the stressor, offer a short motivational message, and keep it to ~60–90 seconds. Include a brief closing reassurance.
- Populate audio fields: audio_script, audio_tone, voice_pitch (0.7–1.3), voice_rate (0.7–1.3), music_prompt, music_choice (piano|rain|white_noise), duration_seconds (~60s), purpose (1 user-facing sentence), explanation. Choose pitch/rate to vary vibe (steadier/slower if overwhelmed; brighter/faster if energizing) and keep music audible but not overpowering.
- Keep total time ~15 minutes with one main step.
- Avoid jargon; keep instructions concrete and runnable at a desk/phone.
`;

const STRESS_INTERVENTION_PROMPT_SLIDES = `
You design a single short support presented as 2-3 slides/cards. The requested medium is slides. No other modalities.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 15,
  "step": {
    "title": "Step 1",
    "minutes": 8,
    "medium": "slides",
    "instruction": "plain text fallback",
    "asset": {
      "type": "slide",
      "slides": [
        { "title": "Slide 1 title", "line": "one supportive line", "image_prompt": "abstract/texture/light-based, no faces, no text", "style": "optional style cue" }
      ],
      "duration_seconds": 60,
      "explanation": "2 sentences explaining why these slides/themes fit the summary/focus"
    }
  },
  "assets": [
    { "type": "slide", "slides": ["Slide 1 title: short supportive line", "Slide 2 title: short supportive line"] }
  ],
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- Produce 2-3 slides max; keep copy to headline + one line.
- For each slide, include an image_prompt (abstract/texture/light scenes; no faces/text/logos). Image should pair with the slide idea, not literal text.
- Match tone to the summary/focus (e.g., calm, encouraging, directive).
- Keep total time ~15 minutes with one main step.
- Avoid jargon; keep instructions concrete and runnable at a desk/phone.
`;

const STRESS_INTERVENTION_PROMPT_IMAGE = `
You design a single short visual support (generated image). The requested medium is images. No audio/video.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 10,
  "step": {
    "title": "Step 1",
    "minutes": 3,
    "medium": "images",
    "instruction": "plain text fallback describing how to use the image (10-20 words)",
    "asset": {
      "type": "image",
      "prompt": "concise, style-rich prompt for a generated image; no text in image",
      "style": "optional style cue",
      "aspect": "1:1 or 3:2",
      "explanation": "1-2 sentences on why this image fits the summary/focus"
    }
  },
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
"source": "llm"
}

Rules:
- Avoid faces, text, logos. Prefer nature/abstract/objects/light scenes that align with the stress summary (calm or energizing as needed).
- Keep prompt specific: mood, palette, composition, lighting, lens; no overlong prose.
- Keep total time ~10 minutes with one main step.
`;

const STRESS_INTERVENTION_PROMPT_STORYBOARD = `
You design a short storyboard of slide-like beats (stress management tips). The requested medium is storyboard. No audio/video generation here. Think of exactly 2 cards with a clear title and a 1–2 sentence line that incorporates the user’s context from the summary. Always include BOTH the storyboard frames AND per-frame image prompts.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 10,
  "step": {
    "title": "Step 1",
    "minutes": 4,
    "medium": "storyboard",
    "instruction": "plain text fallback describing how to use these beats (10-20 words)",
    "asset": {
      "type": "storyboard",
      "frames": [
        { "title": "Card 1 title", "line": "1–2 full sentences grounded in the user context", "image_prompt": "abstract/texture/light-based, no faces/text" },
        { "title": "Card 2 title", "line": "1–2 full sentences grounded in the user context", "image_prompt": "abstract/texture/light-based, no faces/text" }
      ],
      "explanation": "1-2 sentences on why these visuals help the summary/focus"
    }
  },
"assets": [
  { "type": "storyboard", "frames": ["..."], "explanation": "..." },
  { "type": "image", "prompt": "per-frame image prompt 1", "aspect": "4:3" },
  { "type": "image", "prompt": "per-frame image prompt 2", "aspect": "4:3" }
],
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- 2-3 frames max; each frame is a stress-tip card (headline + 1–2 full sentences). Avoid narration or story dialogue.
- Each line must reference the user’s context from the summary (situation, setting, or key concern).
- For each frame, include an image_prompt (abstract/texture/light scenes; no faces/text/logos) that pairs with the frame idea, not literal text.
- Keep total time ~10 minutes with one main step.
`;

const STRESS_INTERVENTION_PROMPT_TIMED = `
You design a short timed-cues support (pacing timer) focused on guided breathing. The requested medium is timed_cues. Include both pacing cues (timer_steps) and a matching short audio_script that narrates the cues. No video.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 10,
  "step": {
    "title": "Step 1",
    "minutes": 4,
    "medium": "timed_cues",
    "instruction": "plain text fallback describing how to follow the cues (10-20 words)",
    "asset": {
      "type": "timer",
      "timer_steps": [
        { "label": "Inhale", "duration_seconds": 4 },
        { "label": "Hold", "duration_seconds": 2 },
        { "label": "Exhale", "duration_seconds": 6 }
      ],
      "audio_script": "40-90 seconds of slow, guided breathing narration that calls out the cues and counts with brief pauses. Warm, simple, runnable at a desk.",
      "audio_tone": "e.g., calm peer",
      "voice_pitch": 1.0,
      "voice_rate": 0.6,
      "explanation": "1-2 sentences on why this pacing helps the summary/focus"
    }
  },
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- Provide 3-6 timer_steps max; keep total under 5 minutes for the main step.
- Labels should be short action cues; durations >0 seconds.
- Keep it breathing-focused (e.g., inhale/hold/exhale or box breathing), with one short explainer of why this pacing helps.
- Avoid jargon; keep instructions runnable at a desk/phone.
- Keep delivery slow and guided. Use short cue phrases and natural pauses so users can follow in real time.
- Choose voice_rate in the 0.5-0.7 range (default target 0.6) to keep pacing slow and easy to follow.
- In the audio_script: when you are counting a sequence, use numerals (“1, 2, 3, 4…”). For non-counting words, spell them out normally.
`;

const STRESS_INTERVENTION_PROMPT_MOTION = `
You design a brief calming motion support. The requested medium is calming_motion. Think "soft animated visual + short overlay text".

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 5,
  "step": {
    "title": "Step 1",
    "minutes": 3,
    "medium": "calming_motion",
    "instruction": "one-line fallback on how to watch the calming motion",
    "asset": {
      "type": "motion",
      "prompt": "1-2 lines describing the mood and colors (e.g., \"soft teal gradients with slow breathing pulses\")",
      "overlay": ["short calming headline", "one line cue to follow the breathing visual"]
    }
  },
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- Keep overlay short and reassuring; no faces or judging words.
- Focus on simple breathing/grounding; this is ambient, not instruction-heavy.
`;

const UX_PLANNER_GENERATE_PROMPT = `
You are a UX planner. Given conversation context and a freeform description of an activity, generate THREE candidate UX plans. Do NOT score them yet.
You will receive: summary, focus, conversation, and intervention_steps (ordered step list). Use intervention_steps as concrete task context when present.

Available blocks (id -> params). All descriptive fields must be >=1 informative sentence; any prompt/script sent to GPT must be >=3 informative sentences:
- heading: { "text": "short heading (>=1 sentence)" }
- textbox: { "question": ">=1 sentence", "placeholder": ">=1 sentence", "allow_voice": true|false, "purpose": "1-2 short user-facing sentences: how this step can help and what to do now" }
- list_textbox: { "prompt": ">=1 sentence", "items": [{ "label": ">=1 sentence", "placeholder": ">=1 sentence" }, ...], "purpose": "1-2 short user-facing sentences: how this step can help and what to do now" }
- voice_input: { "prompt": "recording invite, >=3 sentences (GPT-facing). Must ask for recording only and must not mention typing alternatives", "purpose": "1-2 short user-facing sentences: how recording can help and what to say in the recording" }
- photo_input: { "prompt": "what to snap, >=1 sentence", "accept_camera_gallery": true|false, "purpose": "1-2 short user-facing sentences: how this photo can help and what to capture" }
- mcq: { "question": ">=1 sentence", "options": ["opt1","opt2","opt3"], "allow_multiple": true|false, "purpose": "1-2 short user-facing sentences: how this choice can help and what to pick now" }
- timer: { "seconds": number, "text": "timer instruction, >=1 sentence", "action": "task to do while it runs (mention duration), >=1 sentence", "report_prompt": "post-timer reflection question, >=1 sentence", "report_placeholder": "input placeholder, >=1 sentence", "purpose": "1-2 short user-facing sentences: how this timed step can support you and what to do now" }
- timed_cues: { "timer_steps": [{ "label": "Inhale", "duration_seconds": 4 }, ...], "audio_script": "40-90s slow guided narration, >=3 sentences (GPT-facing), with brief pauses and short cue lines that can be followed in real time", "purpose": "1-2 short user-facing sentences that begin with a clear transition (for example, 'Now we will...') and include: what will happen, how this can help right now, and exactly how to follow the breathing/cue pattern" }
- short_audio: { "script": "6-9 sentences (>=3), GPT-facing", "tone": "e.g., calm peer", "voice_pitch": 0.7-1.3, "voice_rate": 0.7-1.3, "purpose": "1-2 short user-facing sentences: how listening can help right now and what to do while listening", "rationale": "1-2 sentences explaining what this audio covers" }
- image: { "prompt": "visual prompt, >=3 sentences, no text/faces, GPT-facing", "purpose": "1-2 short user-facing sentences: how viewing this image can help and what to notice" }
- storyboard: { "frames": [{ "title": "Card 1", "line": ">=1 sentence", "image_prompt": "no faces/text, >=3 sentences, GPT-facing" }, ...], "purpose": "1-2 short user-facing sentences: how these cards can help and what to take from them" }
- dalle_video: { "prompts": ["beat1 prompt >=3 sentences", "beat2 prompt >=3 sentences", "beat3 prompt >=3 sentences", "beat4 prompt >=3 sentences"], "script": ["caption1 (>=1 sentence)",...4], "purpose": "1-2 short user-facing sentences: how this video can help and what to do while watching" }
- chatbot: { "persona": "must start with 'You are the Activity Coach chatbot for this exercise.' then state purpose/goal and coaching style; >=3 sentences (GPT-facing)", "first_prompt": "must acknowledge user context, state identity/purpose, and immediately give the first task step; >=3 sentences (GPT-facing)", "conversation_state": [{ "role": "user|assistant", "content": "..." }, ...], "purpose": "1-2 short user-facing sentences: how this chat can help and what to share" }

Return JSON exactly:
{
  "best_spec": {
    "title": "short plan title",
    "minutes": number,
    "evidence": "what to capture at the end (>=1 sentence)",
    "instruction": "plain text summary/flow (>=1 sentence)",
    "modules": [
      { "id": "heading", ...params },
      { "id": "<one of the blocks above>", ...params },
      ...
    ],
    "steps": ["short step/beat summaries"],
    "explanation": "2-4 sentences explaining why this sequence fits the description and how it flows"
  },
  "candidates": [
    {
      "spec": { ...same shape as best_spec... },
      "interface_description": "2-4 sentences describing how this UX would look/flow for the user",
      "scores": {
        "query_interface_consistency": 1-5,
        "task_efficiency": 1-5,
        "usability": 1-5,
        "information_clarity": 1-5,
        "interaction_satisfaction": 1-5,
        "personalization_specificity": 1-5,
        "personalization_understandable": 1-5
      },
      "score_notes": {
        "query_interface_consistency": "one-line why this score",
        "task_efficiency": "...",
        "usability": "...",
        "information_clarity": "...",
        "interaction_satisfaction": "...",
        "personalization_specificity": "...",
        "personalization_understandable": "..."
      },
      "why": "brief rationale for this candidate"
    },
    { ...two more... }
  ]
}

Guidelines:
- Choose 3-6 modules that best fit the description; do not include all by default.
- Order modules to form a sensible flow (e.g., heading -> prompt/question -> choice -> action/timer -> reflection).
- Keep copy concise; keep options 2-4 words; keep prompts concrete.
- Avoid too much writing. Keep total required typing short: default to brief responses, prefer choices/audio/timers where suitable, and include at most one longer free-text response.
- For every non-heading module, always generate "purpose" text in simple 4th-grade English. Keep it user-facing, kind, and practical.
- Assume users arrive directly from chat; the first actionable module should orient them quickly with one clear "what to do now" cue.
- Purpose text must be exactly 1-2 short sentences and include both, in this order:
  1) what the user should do now,
  2) how this step can/might help right now (use can/may/might).
- Keep the tone non-definitive and future-oriented for benefits (can/may/might). Avoid guaranteed or confirmatory claims.
- Keep instructions clear but light: concrete action wording, without over-directing or adding rigid completion expectations.
- Do not use generic labels like "Timer", "Short audio", or "Image" as purpose text.
- Avoid repeating the same question/prompt across modules; vary wording so each textbox/choice feels distinct and progresses the flow.
- Target a total duration of about 10 minutes (roughly 8–12 minutes) for the full activity.
- IMPORTANT: If evidence is required, the very last module must collect that evidence, using exactly ONE of these: textbox, voice_input, or photo_input. Do not include more than one evidence capture module, and do not put any modules after it.
- IMPORTANT: If a module is voice_input, never use wording like "record or type". Voice-input instructions must request recording only.
- Do not include both short_audio and timed_cues in the same activity.
- For timer, always include an "action" that tells the user what to do during the countdown (specific, doable, 1 sentence) and reference the duration in the copy (e.g., "for 90 seconds" or "for 2 minutes").
- Prefer richer support modules first (short_audio, storyboard, dalle_video, timed_cues) when they clearly fit the intervention and context. Timer is also valid when countdown pacing helps the task.
- For timed_cues, write the audio_script in a slow guided style: short cue lines, natural pauses, and easy pacing users can follow live.
- For timed_cues voice pacing, prefer voice_rate in the 0.5-0.7 range (target 0.6) when generating timed-cues assets.
- If the description mentions visuals, prefer storyboard or dalle_video; if pacing/breathing, include timed_cues/timer; if reassurance, include short_audio; always consider a reflection textbox near the end.
- You must include at least one interactive/supportive element from [short_audio, storyboard, dalle_video, timed_cues, timer]; prefer 1-2 max.
- Avoid faces/text in image prompts; keep tones warm and runnable at desk/phone.
- Use any provided conversation context to personalize prompts and wording.
- Use intervention_steps as the concrete sequence of what the user is trying to do; align module flow and copy to those steps.
- Provide an interface_description for every candidate (2-4 sentences) and a brief "why" for the candidate.

Return JSON exactly:
{
  "candidates": [
    {
      "spec": { ...same shape as best_spec... },
      "interface_description": "2-4 sentences describing how this UX would look/flow for the user",
      "why": "brief rationale for this candidate"
    },
    { ...two more... }
  ]
}
`;

const UX_PLANNER_SCORE_PROMPT = `
You are a UX evaluation judge. Score THREE candidate UX plans and select the strongest.
You will receive: summary, focus, conversation, intervention_steps, and candidates. Use intervention_steps as the target task sequence when judging task fit.

Use this rubric exactly as written (do not paraphrase or omit any parts):
${UX_FULL_RUBRIC_TEXT}

Scoring discipline:
- Provide an integer 1–5 for every dimension.
- Treat 3 as the default “solid” score.
- Only award 4 when there is clear, specific evidence.
- Reserve 5 for truly exceptional cases with explicit justification.
- Provide fuller explanations for each score (2–3 sentences per criterion).
- Do not assume earlier candidates are better. The candidates are shuffled.
- Score each candidate independently before comparing them.
- Choose best_index only after scoring all candidates; it must be the strongest by the rubric, not by position.
- Penalize candidates that drift from intervention_steps or miss key task transitions in that sequence.
- Prefer candidates whose purpose text frames benefits in non-definitive language (can/may/might) instead of guaranteed outcomes.
- Reward clear, practical action cues in modules, but do not reward over-instructional or rigid tone.

Return JSON exactly:
{
  "best_index": 0,
  "candidates": [
    {
      "scores": {
        "query_interface_consistency": 1-5,
        "task_efficiency": 1-5,
        "usability": 1-5,
        "information_clarity": 1-5,
        "interaction_satisfaction": 1-5,
        "personalization_specificity": 1-5,
        "personalization_understandable": 1-5
      },
      "score_notes": {
        "query_interface_consistency": "2-3 sentences",
        "task_efficiency": "...",
        "usability": "...",
        "information_clarity": "...",
        "interaction_satisfaction": "...",
        "personalization_specificity": "...",
        "personalization_understandable": "..."
      }
    },
    { ...two more... }
  ]
}
`;

const NO_JUDGE_INTERVENTION_PROMPT_SUFFIX = `
Using the provided user context (intro, summary, and conversation transcript), generate one appropriate stress-reduction intervention the user can do now. Keep it practical, personalized, and feasible on one device in the user's current setting, with clear concise steps and realistic pacing. Return exactly ONE option in the options array and follow the required schema.
`.trim();

const NO_JUDGE_UX_PROMPT_SUFFIX = `
Using the provided user context (summary, conversation, and intervention steps), generate one appropriate UX activity flow for stress reduction that feels clear, feasible, and supportive for immediate use. Keep the flow concise, practical, and within the expected session length. Return exactly ONE candidate in "candidates" and follow the required schema.
`.trim();

const STRESS_INTERVENTION_PROMPT_DALLE_VIDEO = `
You design a short four-beat script (text only) for a calming DALL·E-style video. The requested medium is dalle_video. Include a concrete background image prompt for each beat (real, grounded scenes; no abstract textures). The four beats must form a clear stress-management arc: grounding, release, reframing, and a forward-looking closeout.

Return JSON exactly in this shape:
{
  "title": "short plan title",
  "focus": "goal",
  "duration_minutes": 12,
  "step": {
    "title": "Step 1",
    "minutes": 8,
    "medium": "dalle_video",
    "instruction": "plain text fallback describing how to watch a short four-beat video",
    "asset": {
      "type": "video",
      "purpose": "1-2 short user-facing sentences explaining why to watch now and what to do while watching",
      "script_lines": [
        "Beat 1 description in 1-2 sentences",
        "Beat 2 description in 1-2 sentences",
        "Beat 3 description in 1-2 sentences",
        "Beat 4 description in 1-2 sentences"
      ],
      "prompts": [
        "Beat 1 background image prompt — concrete, real-world scene, natural light, no text",
        "Beat 2 background image prompt — concrete, real-world scene, natural light, no text",
        "Beat 3 background image prompt — concrete, real-world scene, natural light, no text",
        "Beat 4 background image prompt — concrete, real-world scene, natural light, no text"
      ],
      "duration_seconds": 60,
      "explanation": "2 sentences explaining how these four beats help the summary/focus"
    }
  },
  "wrap_up": "one-sentence closeout",
  "encouragement": "friendly motivation",
  "source": "llm"
}

Rules:
- Exactly four beats; each 10–15 seconds of guidance/visual idea. No more, no less.
- Keep language visual and directive, but avoid camera jargon. Write as if describing what appears.
- The script_lines and purpose must be personalized using the user's context in the summary. Reference at least one concrete contextual detail without repeating the summary verbatim.
- Include per-beat background prompts (4 total). Prompts must be concrete/recognizable (parks, desks, kitchens, sidewalks), natural light, and avoid abstract textures, text, or logos.
- Enforce a stress arc: Beat 1 grounding (sense/body), Beat 2 tension release, Beat 3 reframe/affirm, Beat 4 next-step commitment + calm exit.
- Keep total time short (~1 minute of video) with one main step.
`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const STRESS_AUDIO_FORMATS = ['short_audio'];
const STRESS_SLIDE_FORMATS = ['slides'];
const STRESS_IMAGE_FORMATS = ['images'];
const STRESS_STORYBOARD_FORMATS = ['storyboard'];
const STRESS_TIMER_FORMATS = ['timed_cues', 'timer'];
const STRESS_MOTION_FORMATS = ['calming_motion'];
const STRESS_DALLE_VIDEO_FORMATS = ['dalle_video'];
const STRESS_PLANNER_FORMATS = ['planner'];
const STRESS_FORMATS = [
  ...STRESS_AUDIO_FORMATS,
  ...STRESS_SLIDE_FORMATS,
  ...STRESS_IMAGE_FORMATS,
  ...STRESS_STORYBOARD_FORMATS,
  ...STRESS_TIMER_FORMATS,
  ...STRESS_MOTION_FORMATS,
  ...STRESS_DALLE_VIDEO_FORMATS,
  ...STRESS_PLANNER_FORMATS,
];
const STRESS_ASSET_TYPES_AUDIO = ['audio', 'music', 'ambient'];
const STRESS_ASSET_TYPES_SLIDES = ['slide', 'image'];
const STRESS_ASSET_TYPES_IMAGE = ['image'];
const STRESS_ASSET_TYPES_STORYBOARD = ['storyboard', 'image'];
const STRESS_ASSET_TYPES_TIMER = ['timer'];
const STRESS_ASSET_TYPES_MOTION = ['motion'];
const STRESS_ASSET_TYPES_VIDEO = ['video'];
const STRESS_ASSET_TYPES = [
  ...STRESS_ASSET_TYPES_AUDIO,
  ...STRESS_ASSET_TYPES_SLIDES,
  ...STRESS_ASSET_TYPES_IMAGE,
  ...STRESS_ASSET_TYPES_STORYBOARD,
  ...STRESS_ASSET_TYPES_TIMER,
  ...STRESS_ASSET_TYPES_MOTION,
  ...STRESS_ASSET_TYPES_VIDEO,
];

app.get('/', (req, res) => {
  res.type('html').send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>AI Support API</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #0f172a; line-height: 1.5; }
          h1 { margin-bottom: 0.5rem; }
          code { background: #f1f5f9; padding: 2px 4px; border-radius: 4px; }
          ul { padding-left: 1.2rem; }
        </style>
      </head>
      <body>
        <h1>AI Support API</h1>
        <p>The backend is running. Use these endpoints from the Expo client or tools like curl/Postman:</p>
        <ul>
          <li><code>POST /chat</code> &mdash; chat with the assistant</li>
          <li><code>POST /layered-intervention</code> &mdash; generate layered plans</li>
          <li><code>GET /sessions</code> &mdash; list sessions</li>
          <li><code>GET /dev/sessions</code> &mdash; dev browser for session data</li>
          <li><code>POST /dev/thinking-traps/classify</code> &mdash; classify thinking traps (retrieval + completion)</li>
        </ul>
        <p>Point the mobile/web app’s <code>API_BASE</code> at <code>${req.protocol}://${req.get('host')}</code> to use this deployment.</p>
      </body>
    </html>
  `);
});

app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 20000);
  const initial = {
    ts: new Date().toISOString(),
    event: 'log-stream:connected',
  };
  res.write(`data: ${JSON.stringify(initial)}\n\n`);
  logSubscribers.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    logSubscribers.delete(res);
  });
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_LLM_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1';
const INTERVENTION_MODEL = process.env.OPENAI_INTERVENTION_MODEL || DEFAULT_LLM_MODEL;
const CONVERSATION_MODEL = process.env.OPENAI_CONVERSATION_MODEL || 'gpt-4.1';
const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || CONVERSATION_MODEL;
const STRESS_SUPPORT_MODEL = process.env.OPENAI_STRESS_SUPPORT_MODEL || INTERVENTION_MODEL;
console.log('[llm] model config', {
  default: DEFAULT_LLM_MODEL,
  intervention: INTERVENTION_MODEL,
  conversation: CONVERSATION_MODEL,
  summary: SUMMARY_MODEL,
  stress_support: STRESS_SUPPORT_MODEL,
});
const MAX_FOLLOW_UPS_PER_STEP = Number(process.env.MAX_FOLLOW_UPS_PER_STEP || 1);
const CANDIDATE_TARGET_COUNT = 5;
const MAX_CANDIDATE_RETRIES = 3;
const MAX_SELECTION_RETRIES = 3;
const MAX_COMBINE_RETRIES = 3;
const MAX_STRUCTURED_JUDGE_ATTEMPTS = 3;
const USE_LAYERED_INTERVENTION_V2 =
  typeof process.env.LAYERED_INTERVENTION_V2 === 'string'
    ? process.env.LAYERED_INTERVENTION_V2 !== '0'
    : true;

function shuffleArray(list = []) {
  const arr = Array.isArray(list) ? [...list] : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function chooseTopWithRandomTie(options = []) {
  if (!Array.isArray(options) || !options.length) return null;
  let maxScore = -Infinity;
  options.forEach((opt) => {
    const score = Number(opt?.total_score || 0);
    if (score > maxScore) {
      maxScore = score;
    }
  });
  const top = options.filter((opt) => Number(opt?.total_score || 0) === maxScore);
  if (!top.length) return options[0] || null;
  const idx = Math.floor(Math.random() * top.length);
  return top[idx] || null;
}

function pickRandom(list = []) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function parseBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function buildBaselineIntegrationScores(rubric = [], note = 'Fallback baseline score due to judge failure.') {
  const scores = {};
  const notes = {};
  (rubric || []).forEach((item) => {
    if (!item?.key) return;
    scores[item.key] = 3;
    notes[item.key] = note;
  });
  return { scores, notes };
}

function validateJudgeDifferentiation(criteriaEntries = []) {
  const issues = [];
  criteriaEntries.forEach((entry) => {
    const criterion = entry?.criterion || 'criterion';
    const evaluations = Array.isArray(entry?.evaluations) ? entry.evaluations : [];
    const scores = evaluations.reduce((acc, item) => {
      const optionId = cleanString(item?.option_id, '');
      if (!optionId) return acc;
      acc[optionId] = item?.score;
      return acc;
    }, {});
    const notes = evaluations.reduce((acc, item) => {
      const optionId = cleanString(item?.option_id, '');
      if (!optionId) return acc;
      acc[optionId] = cleanString(item?.note, '');
      return acc;
    }, {});
    const values = Object.values(scores)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    const uniques = new Set(values);
    if (uniques.size <= 1 && values.length > 1) {
      const noteValues = Object.values(notes || {}).filter(
        (n) => typeof n === 'string' && n.trim().length >= 24
      );
      const distinctNotes = new Set(
        noteValues.map((n) => n.trim().toLowerCase())
      );
      if (distinctNotes.size <= 1) {
        issues.push(`${criterion}: identical scores across options without distinct justification`);
      }
    }
    Object.entries(scores).forEach(([optionId, value]) => {
      const numeric = Number(value);
      if (numeric >= 4) {
        const note = notes?.[optionId];
        if (typeof note !== 'string' || note.trim().length < 16) {
          issues.push(`${criterion} ${optionId}: high score lacks specific evidence`);
        }
      }
    });
  });
  return issues;
}

const normalizeCriterionToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const INTEGRATION_CRITERION_LOOKUP = (() => {
  const map = new Map();
  (Array.isArray(INTEGRATION_RUBRIC) ? INTEGRATION_RUBRIC : []).forEach((dimension) => {
    const canonicalKey = dimension?.key;
    if (!canonicalKey) return;
    const title = typeof dimension?.title === 'string' ? dimension.title : '';
    const tokens = [
      canonicalKey,
      canonicalKey.toLowerCase(),
      normalizeCriterionToken(canonicalKey),
      title,
      title.toLowerCase(),
      normalizeCriterionToken(title),
    ].filter(Boolean);
    tokens.forEach((token) => {
      if (!token || map.has(token)) return;
      map.set(token, canonicalKey);
    });
  });
  return map;
})();

const INTEGRATION_RUBRIC_KEYS = (Array.isArray(INTEGRATION_RUBRIC) ? INTEGRATION_RUBRIC : [])
  .map((dimension) => dimension?.key)
  .filter(Boolean);

function requireCompleteIntegrationScores(options = [], contextLabel = 'integration_check') {
  if (!INTEGRATION_RUBRIC_KEYS.length || !Array.isArray(options) || !options.length) return;
  const issues = [];
  options.forEach((option) => {
    const optionId = option?.option_id || option?.plan_title || 'option';
    const scores = option?.integration_scores || {};
    const notes = option?.integration_score_notes || {};
    const missingScores = INTEGRATION_RUBRIC_KEYS.filter(
      (key) => !Number.isFinite(Number(scores[key]))
    );
    const missingNotes = INTEGRATION_RUBRIC_KEYS.filter((key) => {
      const note = notes[key];
      return typeof note !== 'string' || !note.trim();
    });
    if (missingScores.length || missingNotes.length) {
      const parts = [];
      if (missingScores.length) {
        parts.push(`scores missing [${missingScores.join(', ')}]`);
      }
      if (missingNotes.length) {
        parts.push(`notes missing [${missingNotes.join(', ')}]`);
      }
      issues.push(`${optionId}: ${parts.join('; ')}`);
    }
  });
  if (issues.length) {
    const error = new Error(`Incomplete integration coverage (${contextLabel}): ${issues.join('; ')}`);
    error.code = 'INCOMPLETE_INTEGRATION_SCORES';
    throw error;
  }
}

function resolveIntegrationCriterionKey(label) {
  if (!label) return null;
  const trimmed = String(label).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const slug = normalizeCriterionToken(trimmed);
  return (
    INTEGRATION_CRITERION_LOOKUP.get(trimmed) ||
    INTEGRATION_CRITERION_LOOKUP.get(lower) ||
    INTEGRATION_CRITERION_LOOKUP.get(slug) ||
    null
  );
}

const normalizeOptionToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[`"'’‘“”]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

function buildJudgeOptionIdLookup(options = []) {
  const map = new Map();
  const register = (token, canonical) => {
    if (!token || !canonical) return;
    const normalized = normalizeOptionToken(token);
    if (!normalized || map.has(normalized)) return;
    map.set(normalized, canonical);
  };

  (Array.isArray(options) ? options : []).forEach((option) => {
    const canonical = cleanString(option?.option_id, '');
    if (!canonical) return;
    register(canonical, canonical);
    register(canonical.toLowerCase(), canonical);

    const normalizedCanonical = normalizeOptionToken(canonical);
    register(normalizedCanonical, canonical);

    const m = normalizedCanonical.match(/(?:combo|option|candidate)_?([a-z0-9]+)$/);
    if (m?.[1]) {
      const suffix = m[1];
      register(suffix, canonical);
      register(`combo_${suffix}`, canonical);
      register(`option_${suffix}`, canonical);
      register(`candidate_${suffix}`, canonical);
      register(`combo ${suffix}`, canonical);
      register(`option ${suffix}`, canonical);
      register(`candidate ${suffix}`, canonical);
    }
  });

  return map;
}

function resolveJudgeOptionId(label, optionLookup) {
  if (!label) return null;
  const lookup = optionLookup instanceof Map ? optionLookup : new Map();
  const trimmed = String(label).trim();
  if (!trimmed) return null;
  return (
    lookup.get(trimmed) ||
    lookup.get(trimmed.toLowerCase()) ||
    lookup.get(normalizeOptionToken(trimmed)) ||
    null
  );
}

const makeLayerOptionsSchema = (
  optionCodes,
  { minItems = 1, maxItems = 1, minMinutes = 8, maxMinutes = 10, requireMicroSteps = false } = {}
) => ({
  type: 'array',
  minItems,
  maxItems,
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'option_id',
      'label',
      'description',
      'duration_minutes',
      'why_it_helps',
      'principle',
      'micro_steps',
    ],
    properties: {
      option_id: optionCodes?.length
        ? { type: 'string', enum: optionCodes }
        : { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      duration_minutes: { type: 'number', minimum: minMinutes, maximum: maxMinutes },
      why_it_helps: { type: 'string', minLength: 1 },
      principle: { type: 'string', minLength: 1 },
      micro_steps: {
        type: 'array',
        minItems: requireMicroSteps ? 1 : 0,
        maxItems: 1,
        items: { type: 'string', minLength: 1 },
      },
    },
  },
});

const BLENDED_SEGMENT_SCHEMA = {
  type: 'array',
  minItems: 2,
  maxItems: 4,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['segment_id', 'label', 'description', 'duration_minutes', 'principle', 'source'],
    properties: {
      segment_id: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      duration_minutes: { type: 'number', minimum: 2, maximum: 12 },
      principle: { type: 'string', minLength: 1 },
      source: { type: 'string', minLength: 1 },
    },
  },
};

const LAYERED_V2_JUDGE_SCHEMA = {
  name: 'layered_v2_integration_judge',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['criteria_analysis', 'option_summaries', 'selected_option'],
    properties: {
      selected_option: { type: 'string', minLength: 1 },
      criteria_analysis: {
        type: 'array',
        minItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'narrative', 'evaluations'],
          properties: {
            criterion: { type: 'string', minLength: 1 },
            narrative: { type: 'string', minLength: 24 },
            evaluations: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['option_id', 'score', 'note'],
                properties: {
                  option_id: { type: 'string', minLength: 1 },
                  score: { type: 'integer', minimum: 1, maximum: 5 },
                  note: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
      },
      option_summaries: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['option_id', 'integration_reasoning'],
          properties: {
            option_id: { type: 'string', minLength: 1 },
            integration_reasoning: { type: 'string', minLength: 24 },
          },
        },
      },
    },
  },
};

const makeLayeredV2CombineSchema = (optionCount = 3) => ({
  name: 'layered_v2_combination_options',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['options'],
    properties: {
      options: {
        type: 'array',
        minItems: optionCount,
        maxItems: optionCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'option_id',
            // type is optional; defaulted in normalization to avoid schema failures when omitted
            'plan_title',
            'summary_recap',
            'coherence_notes',
            'planning_reasoning',
            'source_plan_ids',
            'total_duration_minutes',
            'blended_activity',
          ],
          properties: {
            option_id: { type: 'string', minLength: 1 },
            plan_title: { type: 'string', minLength: 1 },
            summary_recap: { type: 'string', minLength: 1 },
            coherence_notes: { type: 'string', minLength: 1 },
            planning_reasoning: {
              type: 'array',
              minItems: 0,
              maxItems: 4,
              items: { type: 'string', minLength: 12 },
            },
            source_plan_ids: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            total_duration_minutes: { type: 'number', minimum: 12, maximum: 24 },
            blended_activity: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title',
                'theme',
                'goal',
                'alignment_notes',
                'duration_minutes',
                'options',
                'segments',
              ],
              properties: {
                title: { type: 'string', minLength: 1 },
                theme: { type: 'string', minLength: 1 },
                goal: { type: 'string', minLength: 1 },
                alignment_notes: { type: 'string', minLength: 1 },
                duration_minutes: { type: 'number', minimum: 15, maximum: 20 },
                options: makeLayerOptionsSchema(['Z1', 'Z2'], {
                  minItems: 2,
                  maxItems: 2,
                  minMinutes: 6,
                  maxMinutes: 12,
                  requireMicroSteps: false,
                }),
                segments: BLENDED_SEGMENT_SCHEMA,
              },
            },
          },
        },
      },
    },
  },
});
const LAYERED_V2_COMBINE_SCHEMA = makeLayeredV2CombineSchema(3);

const LAYERED_CANDIDATE_SCHEMA = (rubricKeys, idPrefix) => ({
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'candidate_id',
      'title',
      'theme',
      'goal',
      'description',
      'duration_minutes',
      'activity_steps',
      'alignment_notes',
      'reasoning',
      'scores',
      'score_notes',
    ],
    properties: {
      candidate_id: { type: 'string', enum: [`${idPrefix}_a`, `${idPrefix}_b`] },
      title: { type: 'string', minLength: 1 },
      theme: { type: 'string', minLength: 1 },
      goal: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      alignment_notes: { type: 'string', minLength: 1 },
      duration_minutes: { type: 'number', minimum: 8, maximum: 10 },
      activity_steps: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description'],
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
          },
        },
      },
      reasoning: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: { type: 'string', minLength: 16 },
      },
      scores: {
        type: 'object',
        additionalProperties: false,
        required: rubricKeys,
        properties: rubricKeys.reduce((acc, key) => {
          acc[key] = { type: 'integer', minimum: 1, maximum: 5 };
          return acc;
        }, {}),
      },
      score_notes: {
        type: 'object',
        additionalProperties: false,
        required: rubricKeys,
        properties: rubricKeys.reduce((acc, key) => {
          acc[key] = { type: 'string', minLength: 8 };
          return acc;
        }, {}),
      },
    },
  },
});

const LAYERED_PLAN_SCHEMA = {
  name: 'layered_support_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary_recap',
      'coherence_notes',
      'total_duration_minutes',
      'blended_activity',
      'planning_reasoning',
      'integration_scores',
      'integration_score_notes',
      'selected_ids'
    ],
    properties: {
      summary_recap: { type: 'string', minLength: 1 },
      coherence_notes: { type: 'string', minLength: 1 },
      total_duration_minutes: { type: 'number', minimum: 15, maximum: 20 },
      planning_reasoning: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: { type: 'string', minLength: 16 },
      },
      blended_activity: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'theme',
          'goal',
          'alignment_notes',
          'duration_minutes',
          'options',
          'segments'
        ],
        properties: {
          title: { type: 'string', minLength: 1 },
          theme: { type: 'string', minLength: 1 },
          goal: { type: 'string', minLength: 1 },
          alignment_notes: { type: 'string', minLength: 1 },
          duration_minutes: { type: 'number', minimum: 15, maximum: 20 },
          options: makeLayerOptionsSchema(['Z1'], { minMinutes: 15, maxMinutes: 20, requireMicroSteps: true }),
          segments: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['segment_id', 'label', 'description', 'duration_minutes', 'principle', 'source'],
              properties: {
                segment_id: { type: 'string', minLength: 1 },
                label: { type: 'string', minLength: 1 },
                description: { type: 'string', minLength: 1 },
                duration_minutes: { type: 'number', minimum: 3, maximum: 10 },
                principle: { type: 'string', minLength: 1 },
                source: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
      integration_scores: {
        type: 'object',
        additionalProperties: false,
        required: [
          'theory_alignment_narrative_flow',
          'theory_alignment_small_progress',
          'theory_alignment_psych_alignment',
          'theory_alignment_non_interference',
          'personalization_specificity',
          'personalization_non_retrievability',
          'personalization_understandable',
          'personalization_feasibility',
        ],
        properties: {
          theory_alignment_narrative_flow: { type: 'integer', minimum: 1, maximum: 5 },
          theory_alignment_small_progress: { type: 'integer', minimum: 1, maximum: 5 },
          theory_alignment_psych_alignment: { type: 'integer', minimum: 1, maximum: 5 },
          theory_alignment_non_interference: { type: 'integer', minimum: 1, maximum: 5 },
          personalization_specificity: { type: 'integer', minimum: 1, maximum: 5 },
          personalization_non_retrievability: { type: 'integer', minimum: 1, maximum: 5 },
          personalization_understandable: { type: 'integer', minimum: 1, maximum: 5 },
          personalization_feasibility: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
      integration_score_notes: {
        type: 'object',
        additionalProperties: false,
        required: [
          'theory_alignment_narrative_flow',
          'theory_alignment_small_progress',
          'theory_alignment_psych_alignment',
          'theory_alignment_non_interference',
          'personalization_specificity',
          'personalization_non_retrievability',
          'personalization_understandable',
          'personalization_feasibility',
        ],
        properties: {
          theory_alignment_narrative_flow: { type: 'string', minLength: 8 },
          theory_alignment_small_progress: { type: 'string', minLength: 8 },
          theory_alignment_psych_alignment: { type: 'string', minLength: 8 },
          theory_alignment_non_interference: { type: 'string', minLength: 8 },
          personalization_specificity: { type: 'string', minLength: 8 },
          personalization_non_retrievability: { type: 'string', minLength: 8 },
          personalization_understandable: { type: 'string', minLength: 8 },
          personalization_feasibility: { type: 'string', minLength: 8 },
        },
      },
      selected_ids: {
        type: 'object',
        additionalProperties: false,
        required: ['cognitive', 'experiential'],
        properties: {
          cognitive: { type: 'string', minLength: 1 },
          experiential: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const CANDIDATE_JSON_SCHEMA = {
  name: 'candidate_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidate'],
    properties: {
      candidate: {
        type: 'object',
        additionalProperties: false,
        required: [
          'plan_id',
          'plan_title',
          'summary',
          'activities',
          'rationale',
          'scores',
          'score_notes'
        ],
        properties: {
          plan_id: { type: 'string', minLength: 1 },
          plan_title: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
          rationale: { type: 'string', minLength: 1 },
          activities: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'description', 'duration_minutes', 'reasoning'],
              properties: {
                label: { type: 'string', minLength: 1 },
                description: { type: 'string', minLength: 1 },
                duration_minutes: { type: 'number', minimum: 1 },
                reasoning: { type: 'string' }
              }
            }
          },
          scores: {
            type: 'object',
            additionalProperties: false,
            required: [
              'conceptual_mechanism',
              'cognitive_experiential_mix',
              'engagement_diversity',
              'emotional_safety',
              'feasibility_context',
              'potential_complementarity',
              'lived_experience_coverage',
              'overall_promise'
            ],
            properties: {
              conceptual_mechanism: { type: 'integer', minimum: 1, maximum: 5 },
              cognitive_experiential_mix: { type: 'integer', minimum: 1, maximum: 5 },
              engagement_diversity: { type: 'integer', minimum: 1, maximum: 5 },
              emotional_safety: { type: 'integer', minimum: 1, maximum: 5 },
              feasibility_context: { type: 'integer', minimum: 1, maximum: 5 },
              potential_complementarity: { type: 'integer', minimum: 1, maximum: 5 },
              lived_experience_coverage: { type: 'integer', minimum: 1, maximum: 5 },
              overall_promise: { type: 'integer', minimum: 1, maximum: 5 }
            }
          },
          score_notes: {
            type: 'object',
            additionalProperties: false,
            required: [
              'conceptual_mechanism',
              'cognitive_experiential_mix',
              'engagement_diversity',
              'emotional_safety',
              'feasibility_context',
              'potential_complementarity',
              'lived_experience_coverage',
              'overall_promise'
            ],
            properties: {
              conceptual_mechanism: { type: 'string', minLength: 8 },
              cognitive_experiential_mix: { type: 'string', minLength: 8 },
              engagement_diversity: { type: 'string', minLength: 8 },
              emotional_safety: { type: 'string', minLength: 8 },
              feasibility_context: { type: 'string', minLength: 8 },
              potential_complementarity: { type: 'string', minLength: 8 },
              lived_experience_coverage: { type: 'string', minLength: 8 },
              overall_promise: { type: 'string', minLength: 8 }
            }
          }
        }
      }
    }
  }
};

const FINAL_PLAN_JSON_SCHEMA = {
  name: 'final_plan_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'plan_title',
      'summary',
      'selection_reasoning',
      'activities',
      'source_plan_ids',
      'scores',
      'score_notes'
    ],
    properties: {
      plan_title: { type: 'string', minLength: 1 },
      summary: { type: 'string', minLength: 1 },
      selection_reasoning: { type: 'string', minLength: 1 },
      source_plan_ids: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 }
      },
      activities: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'description', 'duration_minutes', 'reasoning'],
          properties: {
            label: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
            duration_minutes: { type: 'number', minimum: 1 },
            reasoning: { type: 'string', minLength: 1 }
          }
        }
      },
      scores: {
        type: 'object',
        additionalProperties: false,
        required: [
          'conceptual_integration',
          'narrative_flow',
          'cognitive_experiential_rhythm',
          'engagement_synergy',
          'emotional_trajectory',
          'agency_micromastery',
          'situational_adaptability',
          'reflective_closure'
        ],
        properties: {
          conceptual_integration: { type: 'integer', minimum: 1, maximum: 5 },
          narrative_flow: { type: 'integer', minimum: 1, maximum: 5 },
          cognitive_experiential_rhythm: { type: 'integer', minimum: 1, maximum: 5 },
          engagement_synergy: { type: 'integer', minimum: 1, maximum: 5 },
          emotional_trajectory: { type: 'integer', minimum: 1, maximum: 5 },
          agency_micromastery: { type: 'integer', minimum: 1, maximum: 5 },
          situational_adaptability: { type: 'integer', minimum: 1, maximum: 5 },
          reflective_closure: { type: 'integer', minimum: 1, maximum: 5 }
        }
      },
      score_notes: {
        type: 'object',
        additionalProperties: false,
        required: [
          'conceptual_integration',
          'narrative_flow',
          'cognitive_experiential_rhythm',
          'engagement_synergy',
          'emotional_trajectory',
          'agency_micromastery',
          'situational_adaptability',
          'reflective_closure'
        ],
        properties: {
          conceptual_integration: { type: 'string', minLength: 8 },
          narrative_flow: { type: 'string', minLength: 8 },
          cognitive_experiential_rhythm: { type: 'string', minLength: 8 },
          engagement_synergy: { type: 'string', minLength: 8 },
          emotional_trajectory: { type: 'string', minLength: 8 },
          agency_micromastery: { type: 'string', minLength: 8 },
          situational_adaptability: { type: 'string', minLength: 8 },
          reflective_closure: { type: 'string', minLength: 8 }
        }
      }
    }
  }
};

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const logSubscribers = new Set();

function broadcastLogEntry(entry) {
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  logSubscribers.forEach((res) => {
    try {
      res.write(payload);
    } catch (err) {
      logSubscribers.delete(res);
    }
  });
}

function appendLog(event, data = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      event,
      data
    };
    fs.appendFile(
      LOG_FILE,
      `${JSON.stringify(entry)}\n`,
      (err) => {
        if (err) {
          console.error('Failed to write log entry', err);
        }
      }
    );
    const sessionIdFromData = (() => {
      const candidates = [
        data?.sessionId,
        data?.session_id,
        data?.session,
        data?.payload?.sessionId,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
      return null;
    })();
    if (sessionIdFromData) {
      sessionStore
        .recordSessionLog(sessionIdFromData, {
          event,
          data,
          created_at: entry.ts,
        })
        .catch((err) => {
          console.error('Failed to persist log entry to DB', err?.message || err);
        });
    }
    broadcastLogEntry(entry);
  } catch (err) {
    console.error('Failed to persist log entry', err);
  }
}

function generateLocalSessionId() {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function resolveSessionId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  try {
    return await sessionStore.ensureSession(normalized || null);
  } catch (err) {
    console.error('Failed to persist chat session metadata', err);
    return normalized || generateLocalSessionId();
  }
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (err) {
    return null;
  }
}

function summarizeMessagesForLog(messages) {
  return (messages || []).map((msg, idx) => ({
    idx,
    role: msg?.role,
    contentPreview: String(msg?.content || '')
      .replace(/\s+/g, ' ')
      .slice(0, 200)
  }));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

function normalizeStringArray(value) {
  return ensureArray(value)
    .map((entry) => (isNonEmptyString(entry) ? entry.trim() : ''))
    .filter(Boolean);
}

function buildLayeredInterventionRecord(result = {}) {
  if (!result || typeof result !== 'object') return null;
  const computeFinalSteps = (payload = {}) => {
    const combinationOptions = Array.isArray(payload.combination_options)
      ? payload.combination_options
      : [];
    const selectedCombination =
      combinationOptions.find(
        (option) =>
          option?.option_id &&
          option.option_id === (payload?.selected_combination_id || combinationOptions[0]?.option_id)
      ) || combinationOptions[0] || null;
    const blendedActivity =
      selectedCombination?.blended_activity || payload?.blended_activity || null;
    const blendedOptions = Array.isArray(blendedActivity?.options)
      ? blendedActivity.options
      : [];
    const sourceOptions = Array.isArray(selectedCombination?.blended_activity?.options)
      ? selectedCombination.blended_activity.options
      : blendedOptions;
    const duration =
      (typeof blendedActivity?.duration_minutes === 'number' &&
        !Number.isNaN(blendedActivity.duration_minutes)
        ? blendedActivity.duration_minutes
        : null) ||
      (typeof payload?.total_duration_minutes === 'number' &&
        !Number.isNaN(payload.total_duration_minutes)
        ? payload.total_duration_minutes
        : null);
    const perStepFallback =
      duration && Array.isArray(sourceOptions) && sourceOptions.length
        ? Math.max(1, Math.round(duration / sourceOptions.length))
        : null;
    const steps = (sourceOptions || [])
      .slice(0, 2)
      .map((opt) => {
        const microSteps = Array.isArray(opt?.micro_steps)
          ? opt.micro_steps.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const description = [opt?.description || '', ...microSteps]
          .filter(Boolean)
          .join(' ')
          .trim();
        if (!description) return null;
        return {
          title: typeof opt?.label === 'string' ? opt.label.trim() : null,
          description,
          micro_steps: microSteps,
          duration_minutes:
            typeof opt?.duration_minutes === 'number' && !Number.isNaN(opt.duration_minutes)
              ? opt.duration_minutes
              : perStepFallback,
        };
      })
      .filter(Boolean);
    return { blendedActivity, selectedCombination, steps, duration };
  };
  const blended = result.blended_activity || {};
  const planTitle =
    (isNonEmptyString(result.plan_title) && result.plan_title.trim()) ||
    (isNonEmptyString(blended.title) && blended.title.trim()) ||
    'Layered Support Plan';
  const summary =
    (isNonEmptyString(result.summary_recap) && result.summary_recap.trim()) ||
    (isNonEmptyString(blended.goal) && blended.goal.trim()) ||
    '';
  const planningReasoning = normalizeStringArray(result.planning_reasoning).join(' ');
  const selectionReasoning =
    (isNonEmptyString(result.coherence_notes) && result.coherence_notes.trim()) ||
    planningReasoning ||
    '';
  const activities = Array.isArray(result.activities)
    ? result.activities
    : Array.isArray(blended.segments)
    ? blended.segments
    : blended && Object.keys(blended).length > 0
    ? [blended]
    : [];
  const sourceIds = new Set(normalizeStringArray(result.source_plan_ids));
  if (isNonEmptyString(result.selected_combination_id)) {
    sourceIds.add(result.selected_combination_id.trim());
  }
  const selectedMap = result.selected_ids;
  if (selectedMap && typeof selectedMap === 'object') {
    Object.values(selectedMap).forEach((value) => {
      if (isNonEmptyString(value)) {
        sourceIds.add(value.trim());
      } else if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (isNonEmptyString(entry)) {
            sourceIds.add(entry.trim());
          }
        });
      }
    });
  }
  const candidates = [];
  const addCandidate = (candidate = {}, layerTag = 'blended', index = 0) => {
    if (!candidate || typeof candidate !== 'object') return;
    const candidate_id =
      (isNonEmptyString(candidate.candidate_id) && candidate.candidate_id.trim()) ||
      (isNonEmptyString(candidate.plan_id) && candidate.plan_id.trim()) ||
      (isNonEmptyString(candidate.option_id) && candidate.option_id.trim()) ||
      null;
    const plan_id =
      (isNonEmptyString(candidate.plan_id) && candidate.plan_id.trim()) || candidate_id || null;
    const plan_title =
      (isNonEmptyString(candidate.plan_title) && candidate.plan_title.trim()) ||
      (isNonEmptyString(candidate.title) && candidate.title.trim()) ||
      null;
    const summaryText =
      (isNonEmptyString(candidate.summary) && candidate.summary.trim()) ||
      (isNonEmptyString(candidate.summary_recap) && candidate.summary_recap.trim()) ||
      (isNonEmptyString(candidate.description) && candidate.description.trim()) ||
      (isNonEmptyString(candidate.goal) && candidate.goal.trim()) ||
      '';
    const rationale =
      (isNonEmptyString(candidate.rationale) && candidate.rationale.trim()) ||
      (isNonEmptyString(candidate.coherence_notes) && candidate.coherence_notes.trim()) ||
      (isNonEmptyString(candidate.alignment_notes) && candidate.alignment_notes.trim()) ||
      normalizeStringArray(candidate.reasoning).join(' ') ||
      '';
    const activitiesList =
      (Array.isArray(candidate.activities) && candidate.activities) ||
      (Array.isArray(candidate.activity_steps) && candidate.activity_steps) ||
      (Array.isArray(candidate.steps) && candidate.steps) ||
      (Array.isArray(candidate?.blended_activity?.segments) && candidate.blended_activity.segments) ||
      [];
    const scores = candidate.scores || candidate.integration_scores || {};
    const score_notes = candidate.score_notes || candidate.integration_score_notes || {};
    candidates.push({
      plan_id,
      plan_title,
      summary: summaryText,
      rationale,
      activities: activitiesList,
      scores,
      score_notes,
      layer: layerTag,
      candidate_id,
      candidate_index: index,
      index,
      raw: candidate,
    });
  };
  ensureArray(result.combination_options).forEach((candidate, idx) => addCandidate(candidate, 'blended', idx));
  const cognitiveCandidateList =
    ensureArray(result.cognitive_candidates && result.cognitive_candidates.length
      ? result.cognitive_candidates
      : result.cognitive_activities).map((candidate, idx) => ({
        ...candidate,
        layer: 'cognitive',
        candidate_id:
          (isNonEmptyString(candidate?.candidate_id) && candidate.candidate_id) || `cog_${idx + 1}`,
      }));
  const experientialCandidateList =
    ensureArray(result.experiential_candidates && result.experiential_candidates.length
      ? result.experiential_candidates
      : result.experiential_activities).map((candidate, idx) => ({
        ...candidate,
        layer: 'experiential',
        candidate_id:
          (isNonEmptyString(candidate?.candidate_id) && candidate.candidate_id) || `exp_${idx + 1}`,
      }));
  cognitiveCandidateList.forEach((candidate, idx) => addCandidate(candidate, 'cognitive', idx));
  experientialCandidateList.forEach((candidate, idx) => addCandidate(candidate, 'experiential', idx));

  const { blendedActivity, steps, duration } = computeFinalSteps(result);
  const summaryRecap =
    (isNonEmptyString(result.summary_recap) && result.summary_recap.trim()) ||
    (isNonEmptyString(result.summary) && result.summary.trim()) ||
    summary ||
    '';
  const card = {
    title: planTitle,
    summary_recap: summaryRecap || null,
    duration_minutes: duration,
    theme:
      (isNonEmptyString(blendedActivity?.theme) && blendedActivity.theme.trim()) || null,
    goal:
      (isNonEmptyString(blendedActivity?.goal) && blendedActivity.goal.trim()) || null,
    alignment_notes:
      (isNonEmptyString(blendedActivity?.alignment_notes) && blendedActivity.alignment_notes.trim()) ||
      null,
    step_one: steps && steps[0] ? steps[0] : null,
    step_two: steps && steps[1] ? steps[1] : null,
    image_prompt: summaryRecap || null,
  };

  return {
    plan_title: planTitle,
    summary,
    selection_reasoning: selectionReasoning,
    source_plan_ids: Array.from(sourceIds),
    activities,
    scores: result.integration_scores || result.scores || {},
    score_notes: result.integration_score_notes || result.score_notes || {},
    candidate_rubric: result.integration_rubric || [],
    selection_rubric: result.integration_rubric || [],
    candidates,
    cognitive_candidates: cognitiveCandidateList,
    experiential_candidates: experientialCandidateList,
    step_one: steps && steps[0] ? steps[0] : null,
    step_two: steps && steps[1] ? steps[1] : null,
    card,
  };
}

async function persistLayeredInterventionResult(sessionId, payload) {
  if (!sessionId || !payload) return;
  try {
    const recordPayload = buildLayeredInterventionRecord(payload);
    if (!recordPayload) return;
    await sessionStore.recordInterventionResult(sessionId, recordPayload);
    appendLog('db:layered-intervention:persisted', {
      sessionId,
      blendedCount: Array.isArray(recordPayload.candidates)
        ? recordPayload.candidates.length
        : 0,
      cognitiveCount: Array.isArray(recordPayload.cognitive_candidates)
        ? recordPayload.cognitive_candidates.length
        : 0,
      experientialCount: Array.isArray(recordPayload.experiential_candidates)
        ? recordPayload.experiential_candidates.length
        : 0,
    });
  } catch (err) {
    console.error('Failed to persist layered intervention result', err?.message || err);
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function previewText(value, max = 200) {
  if (typeof value === 'string') return value.slice(0, max);
  if (value == null) return '';
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function objectEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value);
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return JSON.stringify(
      { error: 'Unable to serialize value', message: err?.message || String(err) },
      null,
      2
    );
  }
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDurationMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '—';
  const totalSeconds = Math.floor(num / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getEnvironmentLabel() {
  if (process.env.FLY_APP_NAME || process.env.FLY_REGION || process.env.FLY_MACHINE_ID) {
    return 'Fly.io';
  }
  return 'Local development';
}

function renderDevPage(title, body, environmentLabel = getEnvironmentLabel()) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
          h1, h2 { margin-bottom: 0.5rem; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 24px; background: #fff; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 14px; }
          th { background: #e2e8f0; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; }
          tr:nth-child(even) td { background: #f8fafc; }
          a { color: #2563eb; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .meta { margin-bottom: 16px; font-size: 14px; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 12px; margin-left: 8px; border: 1px solid #bfdbfe; }
          .env { margin-bottom: 10px; font-size: 14px; color: #334155; }
          pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
          .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
          .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        </style>
      </head>
      <body>
        <div class="env">Environment: <span class="badge">${escapeHtml(environmentLabel)}</span></div>
        ${body}
      </body>
    </html>
  `;
}

async function recordSessionMessageSafe(sessionId, role, content) {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!sessionId || !trimmed) return;
  try {
    await sessionStore.recordMessage(sessionId, role, trimmed);
  } catch (err) {
    console.error('Failed to persist session message', err?.message || err);
  }
}

async function recordAssistantResponse(sessionId, message, followUpQuestion) {
  await recordSessionMessageSafe(sessionId, 'assistant', message);
  if (followUpQuestion) {
    await recordSessionMessageSafe(sessionId, 'assistant', followUpQuestion);
  }
}

function sanitizeActivities(rawList, { requireReasoning = false } = {}) {
  const list = ensureArray(rawList);
  const errors = [];
  const activities = list.map((item, index) => {
    const label = String(item?.label || '').trim();
    if (!label) {
      errors.push(`Activity ${index + 1} is missing a label.`);
    }

    const description = String(item?.description || '').trim();
    if (!description) {
      errors.push(`Activity ${index + 1} requires a contextual description.`);
    }

    let duration = Number(item?.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`Activity ${index + 1} needs a positive duration_minutes (received "${item?.duration_minutes ?? 'missing'}").`);
      duration = null;
    } else {
      duration = Math.round(duration);
    }

    const reasoningRaw = item?.reasoning;
    const reasoning = typeof reasoningRaw === 'string' ? reasoningRaw.trim() : '';
    if (requireReasoning && !reasoning) {
      errors.push(`Activity ${index + 1} must include a reasoning field tying it to user needs.`);
    }

    const sanitized = {
      label,
      description,
      duration_minutes: duration,
    };

    if (reasoning) {
      sanitized.reasoning = reasoning;
    }

    const sourcesRaw = item?.inspiration_sources;
    if (Array.isArray(sourcesRaw)) {
      const cleanedSources = sourcesRaw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
      if (cleanedSources.length === 0 && sourcesRaw.length > 0) {
        errors.push(`Activity ${index + 1} inspiration_sources must contain non-empty strings.`);
      } else if (cleanedSources.length > 0) {
        sanitized.inspiration_sources = cleanedSources;
      }
    } else if (typeof sourcesRaw === 'string') {
      const cleaned = sourcesRaw.trim();
      if (cleaned) {
        sanitized.inspiration_sources = [cleaned];
      } else {
        errors.push(`Activity ${index + 1} inspiration_sources cannot be an empty string.`);
      }
    } else if (sourcesRaw != null) {
      errors.push(
        `Activity ${index + 1} inspiration_sources must be an array of strings when provided.`
      );
    }

    return sanitized;
  });

  if (activities.length < 2 || activities.length > 5) {
    errors.push(`Provide between 2 and 5 activities (received ${activities.length}).`);
  }

  return { activities, errors };
}

function validateAndNormalizeScores(label, rubric, scoresInput, notesInput) {
  const requiredKeys = ensureArray(rubric).map((item) => item.key);
  const normalizedScores = {};
  const normalizedNotes = {};
  const errors = [];

  requiredKeys.forEach((key) => {
    const rawScore = scoresInput?.[key];
    const parsedScore = Number(rawScore);
    if (!Number.isInteger(parsedScore) || parsedScore < 1 || parsedScore > 5) {
      errors.push(`Score "${key}" must be an integer 1–5 (received ${rawScore ?? 'missing'}).`);
    } else {
      normalizedScores[key] = parsedScore;
    }

    const rawNote = notesInput?.[key];
    const note = typeof rawNote === 'string' ? rawNote.trim() : '';
    if (!note) {
      errors.push(`Score note for "${key}" is required and cannot be blank.`);
    } else if (note.length < 8) {
      errors.push(`Score note for "${key}" is too short; provide at least a brief justification (>= 8 characters).`);
      normalizedNotes[key] = note;
    } else {
      normalizedNotes[key] = note;
    }
  });

  Object.keys(scoresInput || {}).forEach((key) => {
    if (!requiredKeys.includes(key)) {
      errors.push(`Unexpected score key "${key}" detected—limit scores to defined rubric keys.`);
    }
  });

  Object.keys(notesInput || {}).forEach((key) => {
    if (!requiredKeys.includes(key)) {
      errors.push(`Unexpected score note key "${key}" detected—limit notes to defined rubric keys.`);
    }
  });

  return { normalizedScores, normalizedNotes, errors };
}

function summarizeCandidateForPrompt(candidate) {
  if (!candidate) return null;
  const highScores = Object.entries(candidate.scores || {})
    .filter(([, value]) => Number(value) >= 4)
    .map(([key]) => key);

  const activityLabels = ensureArray(candidate.activities)
    .map((activity) => String(activity?.label || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  return {
    plan_id: candidate.plan_id,
    plan_title: candidate.plan_title,
    summary: candidate.summary,
    high_scoring_dimensions: highScores,
    activity_labels: activityLabels,
  };
}

function cleanString(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function cleanStringArray(list, { maxItems = Infinity } = {}) {
  return ensureArray(list)
    .map((entry) => cleanString(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

const MAX_CONTEXT_SNIPPET_CHARS = 1200;

function clipTail(value, limit) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function buildConversationTranscriptFromMessages(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return '';
  const rows = messages
    .map((entry) => {
      const content = cleanString(entry?.content);
      if (!content) return null;
      const role = String(entry?.role || '').toLowerCase();
      let speaker = 'User';
      if (role === 'assistant') speaker = 'Assistant';
      else if (role === 'system') speaker = 'System';
      return `${speaker}: ${content}`;
    })
    .filter(Boolean);
  if (!rows.length) return '';
  return rows.join('\n').trim();
}

function buildConversationTranscriptFromSteps(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return '';
  const rows = [];
  steps.forEach((step) => {
    const label = cleanString(step?.title, cleanString(step?.question, step?.id || 'Step'));
    const answers = Array.isArray(step?.answers) ? step.answers : [];
    answers.forEach((answer) => {
      const text = cleanString(answer);
      if (!text) return;
      rows.push(label ? `${label}: ${text}` : text);
    });
  });
  if (!rows.length) return '';
  return rows.join('\n').trim();
}

const buildContextSnippet = ({ intro, summary, conversation }) => {
  const segments = [];
  if (typeof intro === 'string' && intro.trim()) segments.push(intro.trim());
  if (typeof summary === 'string' && summary.trim()) segments.push(summary.trim());
  if (typeof conversation === 'string' && conversation.trim()) {
    segments.push(clipTail(conversation.trim(), 800));
  }
  const combined = segments.join(' ').trim();
  return clipTail(combined, MAX_CONTEXT_SNIPPET_CHARS);
};

function normalizeBlendedSegments(segments, optionId) {
  const entries = ensureArray(segments)
    .map((segment, idx) => ({
      segment_id: cleanString(segment?.segment_id, `${optionId}_segment_${idx + 1}`),
      label: cleanString(segment?.label, `Segment ${idx + 1}`),
      description: cleanString(segment?.description, ''),
      duration_minutes: (() => {
        const minutes = Number(segment?.duration_minutes);
        return Number.isFinite(minutes) ? Math.max(2, Math.round(minutes)) : 6;
      })(),
      principle: cleanString(segment?.principle, 'guided'),
      source: cleanString(segment?.source, 'blend'),
    }))
    .filter((entry) => entry.label && entry.description);
  if (entries.length) return entries.slice(0, 4);
  return [
    {
      segment_id: `${optionId}_segment_1`,
      label: 'Segment 1',
      description: 'Ease into the hybrid flow and notice your breath.',
      duration_minutes: 6,
      principle: 'guided',
      source: 'blend',
    },
    {
      segment_id: `${optionId}_segment_2`,
      label: 'Segment 2',
      description: 'Carry the new line into a small action to anchor it.',
      duration_minutes: 6,
      principle: 'guided',
      source: 'blend',
    },
  ];
}

function normalizeLayerFlow(layer, prefix) {
  if (!layer || typeof layer !== 'object') {
    return {
      title: `${prefix} layer`,
      theme: 'guided',
      goal: '',
      alignment_notes: '',
      duration_minutes: 10,
      options: [],
    };
  }
  const options = ensureArray(layer.options).map((option, idx) => {
    const durationMinutes = Number(option?.duration_minutes);
    return {
      option_id: cleanString(option?.option_id, `${prefix}_step_${idx + 1}`),
      label: cleanString(option?.label, `Step ${idx + 1}`),
      description: cleanString(option?.description, 'Follow this micro-step.'),
      duration_minutes: Number.isFinite(durationMinutes) ? Math.max(3, Math.round(durationMinutes)) : 8,
      why_it_helps: cleanString(option?.why_it_helps, layer.goal || ''),
      principle: cleanString(option?.principle, layer.theme || 'guided'),
    micro_steps: cleanStringArray(option?.micro_steps, { maxItems: 1 }),
    };
  });
  return {
    title: cleanString(layer.title, `${prefix} layer`),
    theme: cleanString(layer.theme, 'guided'),
    goal: cleanString(layer.goal, ''),
    alignment_notes: cleanString(layer.alignment_notes, ''),
    duration_minutes: (() => {
      const minutes = Number(layer.duration_minutes);
      return Number.isFinite(minutes) ? Math.max(6, Math.round(minutes)) : 10;
    })(),
    options: options.length
      ? options
      : [
          {
            option_id: `${prefix}_step_1`,
            label: 'Step 1',
            description: cleanString(layer.goal, 'Apply the insight in one small move.'),
            duration_minutes: 9,
            why_it_helps: cleanString(layer.alignment_notes, ''),
            principle: cleanString(layer.theme, 'guided'),
            micro_steps: [],
          },
          {
            option_id: `${prefix}_step_2`,
            label: 'Step 2',
            description: 'Name what shifted and note where to reuse it.',
            duration_minutes: 9,
            why_it_helps: cleanString(layer.goal, ''),
            principle: cleanString(layer.theme, 'guided'),
            micro_steps: [],
          },
        ],
  };
}

function normalizeStructuredComboOption(option, index) {
  const optionId = cleanString(option?.option_id, `combo_${String.fromCharCode(97 + index)}`);
  const planTitle = cleanString(option?.plan_title, `Option ${String.fromCharCode(65 + index)}`);
  const summaryRecap = cleanString(option?.summary_recap, planTitle);
  const coherenceNotes = cleanString(option?.coherence_notes, summaryRecap);
  const planningReasoning = cleanStringArray(option?.planning_reasoning, { maxItems: 4 });
  const sourcePlanIds = cleanStringArray(option?.source_plan_ids, { maxItems: 6 }).filter((id) => {
    const normalized = String(id || '').trim().toLowerCase();
    return normalized && normalized !== 'null' && normalized !== 'none' && normalized !== 'n/a';
  });
  const blendedActivity = normalizeLayerFlow(option?.blended_activity, `${optionId}_blend`);
  blendedActivity.segments = normalizeBlendedSegments(option?.blended_activity?.segments, optionId);
  const totalDuration =
    Number(option?.total_duration_minutes) ||
    Number(blendedActivity.duration_minutes) ||
    18;
  const comboTypeRaw = cleanString(option?.type, '').toLowerCase();
  const comboType =
    comboTypeRaw === 'cognitive' || comboTypeRaw === 'experiential' ? comboTypeRaw : 'blended';
  const stepSummaries = (blendedActivity.options || [])
    .map((step) => cleanString(step?.description))
    .filter(Boolean)
    .slice(0, 3);
  return {
    option_id: optionId,
    plan_title: planTitle,
    summary_recap: summaryRecap,
    coherence_notes: coherenceNotes,
    planning_reasoning: planningReasoning.length ? planningReasoning : [],
    source_plan_ids: sourcePlanIds.length ? sourcePlanIds : [optionId],
    total_duration_minutes: Math.max(12, Math.min(24, Math.round(totalDuration))),
    blended_activity: blendedActivity,
    integration_scores: option?.integration_scores || {},
    integration_score_notes: option?.integration_score_notes || {},
    total_score: 0,
    type: comboType,
    goal: cleanString(option?.goal, blendedActivity.goal),
    description: summaryRecap,
    steps: stepSummaries,
  };
}

async function runChatCompletion(label, messages, options = {}) {
  const { model: overrideModel, ...rest } = options || {};
  const model = overrideModel || DEFAULT_LLM_MODEL;
  console.log(`[llm:${label}] request`, {
    model,
    options: Object.keys(rest || {}),
    messages: summarizeMessagesForLog(messages)
  });
  const basePayload = {
    model,
    messages,
    ...rest
  };
  let response;
  try {
    response = await client.chat.completions.create(basePayload);
  } catch (err) {
    const detail =
      err?.response?.data?.error?.message ||
      err?.error?.message ||
      err?.message ||
      '';
    const needsDefaultOnlyRetry =
      typeof detail === 'string' &&
      (
        detail.includes("Unsupported value: 'temperature'") ||
        detail.includes("Only the default (1) value is supported")
      );
    if (!needsDefaultOnlyRetry) {
      throw err;
    }
    const retryPayload = { ...basePayload };
    delete retryPayload.temperature;
    delete retryPayload.top_p;
    delete retryPayload.frequency_penalty;
    delete retryPayload.presence_penalty;
    console.warn(`[llm:${label}] retrying with default-only sampling params`, {
      model,
      removed: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'],
    });
    response = await client.chat.completions.create(retryPayload);
  }

  const content = response?.choices?.[0]?.message?.content?.trim() || '';
  console.log(`[llm:${label}] response`, {
    id: response?.id,
    usage: response?.usage,
    contentPreview: content.slice(0, 200)
  });
  return content;
}

const rewriteCache = new Map();
const MAX_REWRITE_CACHE = 200;

async function rewriteUserFacing(label, text, contextSnippet) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (trimmed.length < 4) return text;
  const cacheKey = `${label}::${trimmed}`;
  if (rewriteCache.has(cacheKey)) {
    return rewriteCache.get(cacheKey);
  }
  const userContent = [
    contextSnippet ? `Context:\n${contextSnippet.trim()}` : null,
    `Original:\n${trimmed}`,
    'Rewrite this for the user (not the developer) who does not know about backend and may not have any psychology background in 1-3 short sentences with plain, specific language. Users prefer personalized text and almost no jargon. Return plain text only.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let rewritten = trimmed;
  try {
    const response = await runChatCompletion(
      `rewrite-${label}`,
      [
        {
          role: 'system',
          content:
            'You rewrite short activity blurbs for everyday people. Use warm, concrete language and reference the provided context when relevant.',
        },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.4 }
    );
    if (response && typeof response === 'string') {
      rewritten = response.trim() || trimmed;
    }
  } catch (err) {
    console.warn('rewriteUserFacing failed', err?.message || err);
  }

  if (rewriteCache.size >= MAX_REWRITE_CACHE) {
    rewriteCache.clear();
  }
  rewriteCache.set(cacheKey, rewritten);
  return rewritten;
}

async function rewriteOptionFields(option = {}, label, contextSnippet) {
  if (!option) return option;
  if (option.why_it_helps) {
    option.why_it_helps = await rewriteUserFacing(
      `${label}_why`,
      option.why_it_helps,
      contextSnippet
    );
  }
  return option;
}

async function rewriteActivityStepFields(step = {}, label, contextSnippet) {
  if (!step || typeof step !== 'object') return step;
  const rewritten = { ...step };
  if (rewritten.title) {
    rewritten.title = await rewriteUserFacing(
      `${label}_title`,
      rewritten.title,
      contextSnippet
    );
  }
  if (rewritten.description) {
    rewritten.description = await rewriteUserFacing(
      `${label}_description`,
      rewritten.description,
      contextSnippet
    );
  }
  return rewritten;
}

async function rewriteSegmentFields(segment = {}) {
  return segment;
}

async function rewriteNodeFields(node = {}, label, contextSnippet) {
  if (!node || typeof node !== 'object') return;
  if (node.alignment_notes) {
    node.alignment_notes = await rewriteUserFacing(
      `${label}_alignment`,
      node.alignment_notes,
      contextSnippet
    );
  }
  if (Array.isArray(node.options)) {
    node.options = await Promise.all(
      node.options.map((option, idx) =>
        rewriteOptionFields(option, `${label}_option_${idx}`, contextSnippet)
      )
    );
  }
  if (node && Array.isArray(node.activity_steps)) {
    node.activity_steps = await Promise.all(
      node.activity_steps.map((step, idx) =>
        rewriteActivityStepFields(step, `${label}_activity_${idx}`, contextSnippet)
      )
    );
  }
  if (Array.isArray(node.segments)) {
    node.segments = await Promise.all(
      node.segments.map((segment, idx) =>
        rewriteSegmentFields(segment, `${label}_segment_${idx}`, contextSnippet)
      )
    );
  }
}

async function personalizePlanCopy(payload = {}, contextSnippet = '') {
  if (!payload || typeof payload !== 'object') return;
  await rewriteNodeFields(payload.blended_activity, 'blended', contextSnippet);
  await rewriteNodeFields(payload.cognitive_layer, 'plan_cog', contextSnippet);
  await rewriteNodeFields(payload.experiential_layer, 'plan_exp', contextSnippet);

  const rewriteCandidateList = async (list = [], prefix) => {
    if (!Array.isArray(list)) return [];
    return Promise.all(
      list.map((candidate, idx) => rewriteNodeFields(candidate, `${prefix}_${idx}`, contextSnippet))
    );
  };
  payload.cognitive_candidates = await rewriteCandidateList(
    payload.cognitive_candidates,
    'candidate_cog'
  );
  payload.experiential_candidates = await rewriteCandidateList(
    payload.experiential_candidates,
    'candidate_exp'
  );
}

async function runLayeredInterventionV2({
  intro = '',
  summary = '',
  conversation_transcript = '',
  steps = [],
  sessionId = '',
  disableInterventionJudge = false,
}) {
  const basePayload = {
    intro,
    summary,
    conversation_transcript,
  };
  const logSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const appendLayeredLog = (event, data = {}) =>
    appendLog(event, logSessionId ? { sessionId: logSessionId, ...data } : data);

  const combinationOptions = [];
  const seenOptionIds = new Set();
  const targetOptionCount = disableInterventionJudge ? 1 : 3;
  const DESIRED_COMBINATION_OPTIONS = targetOptionCount;
  const REQUIRED_COMBINATION_OPTIONS = targetOptionCount;
  const combinePrompt = disableInterventionJudge
    ? `${LAYERED_V2_COMBINE_PROMPT}\n\n${NO_JUDGE_INTERVENTION_PROMPT_SUFFIX}`
    : LAYERED_V2_COMBINE_PROMPT;
  const combineSchema = disableInterventionJudge
    ? makeLayeredV2CombineSchema(1)
    : LAYERED_V2_COMBINE_SCHEMA;
  appendLayeredLog('api:layered-intervention:v2-candidates:start', {
    maxAttempts: MAX_COMBINE_RETRIES,
    target_option_count: targetOptionCount,
    disable_intervention_judge: disableInterventionJudge,
  });
  console.log('[layered:v2] starting direct candidate generation', {
    max_attempts: MAX_COMBINE_RETRIES,
    target_option_count: targetOptionCount,
    disable_intervention_judge: disableInterventionJudge,
  });

  for (let attempt = 1; attempt <= MAX_COMBINE_RETRIES; attempt += 1) {
    try {
      const candidatesRaw = await runChatCompletion(
        'layered-v2-candidates',
        [
          { role: 'system', content: combinePrompt },
          { role: 'user', content: JSON.stringify({ ...basePayload, integration_rubric: INTEGRATION_RUBRIC, attempt }) },
        ],
        {
          response_format: { type: 'json_schema', json_schema: combineSchema },
          model: INTERVENTION_MODEL,
          temperature: 1,
        }
      );
      const candidatesParsed = safeParseJSON(candidatesRaw) || {};
      const structuredOptions = Array.isArray(candidatesParsed.options) ? candidatesParsed.options : [];
      structuredOptions
        .map((option, idx) => normalizeStructuredComboOption(option, combinationOptions.length + idx))
        .forEach((option) => {
          if (!option?.option_id || seenOptionIds.has(option.option_id)) return;
          seenOptionIds.add(option.option_id);
          combinationOptions.push(option);
        });
      if (combinationOptions.length >= DESIRED_COMBINATION_OPTIONS) break;
      appendLayeredLog('api:layered-intervention:v2-candidates:retry', {
        attempt,
        optionCount: combinationOptions.length,
      });
      console.warn('[layered:v2] direct candidate generation produced limited options', {
        attempt,
        optionCount: combinationOptions.length,
      });
    } catch (err) {
      appendLayeredLog('api:layered-intervention:v2-candidates:error', {
        attempt,
        message: err?.message || String(err),
      });
      console.warn('[layered:v2] direct candidate generation attempt failed', err?.message || err);
    }
  }

  if (combinationOptions.length < REQUIRED_COMBINATION_OPTIONS) {
    throw new Error('v2 candidate generation failed to provide structured options');
  }
  appendLayeredLog('api:layered-intervention:v2-candidates', {
    optionCount: combinationOptions.length,
    status: 'completed',
    option_ids: combinationOptions.map((item) => item?.option_id).filter(Boolean),
    option_titles: combinationOptions.map((item) => item?.plan_title).filter(Boolean),
  });
  console.log('[layered:v2] direct candidates generated', combinationOptions.length, {
    option_ids: combinationOptions.map((item) => item?.option_id),
  });
  if (combinationOptions.length < DESIRED_COMBINATION_OPTIONS) {
    appendLayeredLog('api:layered-intervention:v2-candidates:partial', {
      optionCount: combinationOptions.length,
      desired: DESIRED_COMBINATION_OPTIONS,
      option_ids: combinationOptions.map((item) => item?.option_id).filter(Boolean),
    });
    console.log('[layered:v2] continuing with limited direct candidate set', {
      optionCount: combinationOptions.length,
      desired: DESIRED_COMBINATION_OPTIONS,
    });
  }

  const baseCombinationOptions = combinationOptions.map((option) => ({ ...option }));
  let judgedOptions = baseCombinationOptions.map((option) => ({ ...option }));
  let selectedOption = judgedOptions[0] || null;
  let judgeSucceeded = false;

  if (disableInterventionJudge) {
    const baseline = buildBaselineIntegrationScores(
      INTEGRATION_RUBRIC,
      'Judge disabled for ablation run.'
    );
    judgedOptions = baseCombinationOptions.map((option) => {
      const normalized = {
        ...option,
        integration_scores: { ...baseline.scores },
        integration_score_notes: { ...baseline.notes },
      };
      normalized.total_score = Object.values(normalized.integration_scores).reduce(
        (sum, value) => sum + Number(value || 0),
        0
      );
      return normalized;
    });
    selectedOption = judgedOptions[0] || null;
    judgeSucceeded = true;
    appendLayeredLog('api:layered-intervention:v2-judge:skipped', {
      reason: 'ablation_disabled',
      optionCount: judgedOptions.length,
    });
  } else if (judgedOptions.length >= 2) {
    const judgePayloadBase = {
      ...basePayload,
      integration_rubric: INTEGRATION_RUBRIC,
    };
    const judgeOptionLookup = buildJudgeOptionIdLookup(baseCombinationOptions);

    for (let attempt = 1; attempt <= MAX_STRUCTURED_JUDGE_ATTEMPTS; attempt += 1) {
      const judgeAliasLookup = new Map();
      const judgePayload = {
        ...judgePayloadBase,
        options: shuffleArray(baseCombinationOptions).map((option, idx) => {
          const judgeOptionId = `J${idx + 1}`;
          judgeAliasLookup.set(judgeOptionId, option.option_id);
          judgeAliasLookup.set(judgeOptionId.toLowerCase(), option.option_id);
          return {
            option_id: judgeOptionId,
            plan_title: option.plan_title,
            summary_recap: option.summary_recap,
            coherence_notes: option.coherence_notes,
            total_duration_minutes: option.total_duration_minutes,
            blended_activity: option.blended_activity,
            source_plan_ids: option.source_plan_ids,
          };
        }),
      };
      const resolveJudgeOption = (rawOptionId) =>
        judgeAliasLookup.get(cleanString(rawOptionId, '')) ||
        resolveJudgeOptionId(rawOptionId, judgeOptionLookup);

      appendLayeredLog('api:layered-intervention:v2-judge:start', {
        optionCount: baseCombinationOptions.length,
        attempt,
      });
      console.log('[layered:v2] starting structured judge step', {
        optionCount: baseCombinationOptions.length,
        attempt,
      });

      try {
        judgedOptions = baseCombinationOptions.map((option) => ({ ...option }));
        const judgeMessages = [
          { role: 'system', content: LAYERED_V2_JUDGE_PROMPT },
          { role: 'user', content: `JSON INPUT:\n${JSON.stringify(judgePayload)}` },
        ].map((msg) => ({ ...msg, content: String(msg.content ?? '') }));

        const judgeRaw = await runChatCompletion(
          'layered-v2-judge',
          judgeMessages,
          {
            response_format: { type: 'json_schema', json_schema: LAYERED_V2_JUDGE_SCHEMA },
            model: INTERVENTION_MODEL,
            temperature: 1,
          }
        );
        const judgeParsed = safeParseJSON(judgeRaw) || {};
        const criteriaEntries = Array.isArray(judgeParsed.criteria_analysis)
          ? judgeParsed.criteria_analysis
          : [];
        if (criteriaEntries.length) {
          appendLayeredLog('api:layered-intervention:v2-judge:criteria', {
            attempt,
            criteria_preview: criteriaEntries.map((entry) => ({
              criterion: entry?.criterion,
              narrative: entry?.narrative,
              evaluations: entry?.evaluations,
            })),
          });
        }
        const differentiationIssues = validateJudgeDifferentiation(criteriaEntries);
        if (differentiationIssues.length) {
          appendLayeredLog('api:layered-intervention:v2-judge:quality-warning', {
            attempt,
            issues: differentiationIssues.slice(0, 8),
          });
        }
        const scoreMap = new Map();
        criteriaEntries.forEach((entry, criterionIdx) => {
          const criterionKey =
            resolveIntegrationCriterionKey(entry?.criterion) ||
            INTEGRATION_RUBRIC_KEYS[criterionIdx] ||
            null;
          if (!criterionKey) {
            if (entry?.criterion) {
              console.warn('[layered:v2] structured judge returned unknown criterion', entry.criterion);
            }
            return;
          }
          const evaluations = Array.isArray(entry?.evaluations) ? entry.evaluations : [];
          evaluations.forEach((item) => {
            const optionId = resolveJudgeOption(item?.option_id);
            const value = item?.score;
            if (!optionId) return;
            const parsedScore = Number(value);
            if (!Number.isFinite(parsedScore)) return;
            const bucket = scoreMap.get(optionId) || { scores: {}, notes: {} };
            bucket.scores[criterionKey] = parsedScore;
            const note = cleanString(item?.note, '');
            if (note) {
              bucket.notes[criterionKey] = note;
            }
            scoreMap.set(optionId, bucket);
          });
        });
        const judgeFallbackNote = 'Judge output incomplete for this criterion; filled with neutral baseline.';
        baseCombinationOptions.forEach((option) => {
          const optionId = option?.option_id;
          if (!optionId) return;
          const bucket = scoreMap.get(optionId) || { scores: {}, notes: {} };
          INTEGRATION_RUBRIC_KEYS.forEach((key) => {
            if (!Number.isFinite(Number(bucket.scores[key]))) {
              bucket.scores[key] = 3;
            }
            if (!cleanString(bucket.notes[key], '')) {
              bucket.notes[key] = judgeFallbackNote;
            }
          });
          scoreMap.set(optionId, bucket);
        });
        judgedOptions = judgedOptions.map((option) => {
          const entry = scoreMap.get(option.option_id);
          if (entry) {
            option.integration_scores = entry.scores;
            option.integration_score_notes = entry.notes;
          } else {
            option.integration_scores = option.integration_scores || {};
            option.integration_score_notes = option.integration_score_notes || {};
          }
          option.total_score = Object.values(option.integration_scores || {}).reduce(
            (sum, value) => sum + Number(value || 0),
            0
          );
          return option;
        });
        requireCompleteIntegrationScores(judgedOptions, 'structured-judge');
        const candidateSelectedId = resolveJudgeOptionId(
          resolveJudgeOption(judgeParsed.selected_option),
          judgeOptionLookup
        );
        const selectedId =
          candidateSelectedId ||
          chooseTopWithRandomTie(judgedOptions)?.option_id ||
          pickRandom(judgedOptions)?.option_id;
        const optionSummaries = Array.isArray(judgeParsed.option_summaries)
          ? judgeParsed.option_summaries
          : [];
        optionSummaries.forEach((entry) => {
          if (!entry?.option_id || !entry.integration_reasoning) return;
          const canonicalOptionId = resolveJudgeOption(entry.option_id);
          if (!canonicalOptionId) return;
          const target = judgedOptions.find((option) => option.option_id === canonicalOptionId);
          if (target) {
            target.integration_reasoning = entry.integration_reasoning;
          }
        });
        selectedOption =
          judgedOptions.find((option) => option.option_id === selectedId) || null;
        judgeSucceeded = true;
        appendLayeredLog('api:layered-intervention:v2-judge:complete', {
          selected_option: selectedId || null,
          optionCount: judgedOptions.length,
          attempt,
        });
        console.log('[layered:v2] structured judge selected option', {
          option: selectedId,
          attempt,
        });
        break;
      } catch (err) {
        appendLayeredLog('api:layered-intervention:v2-judge:error', {
          message: err?.message || String(err),
          attempt,
        });
        console.warn('[layered:v2] structured judge failed', {
          attempt,
          error: err?.message || err,
        });
        if (err?.code === 'INCOMPLETE_INTEGRATION_SCORES' && attempt < MAX_STRUCTURED_JUDGE_ATTEMPTS) {
          console.warn('[layered:v2] retrying structured judge due to incomplete coverage', { attempt });
          continue;
        }
        if (err?.code === 'MISSING_OPTION_SCORES' && attempt < MAX_STRUCTURED_JUDGE_ATTEMPTS) {
          console.warn('[layered:v2] retrying structured judge due to missing option scores', {
            attempt,
            detail: err?.message,
          });
          continue;
        }
        if (attempt < MAX_STRUCTURED_JUDGE_ATTEMPTS) continue;
        break;
      }
    }
  }

  if (!judgeSucceeded) {
    appendLayeredLog('api:layered-intervention:v2-judge:baseline', {
      optionCount: baseCombinationOptions.length,
      reason: 'judge_failed',
    });
    const baseline = buildBaselineIntegrationScores(
      INTEGRATION_RUBRIC,
      'Fallback baseline score: judge output incomplete or unavailable.'
    );
    judgedOptions = baseCombinationOptions.map((option) => {
      const normalized = {
        ...option,
        integration_scores: { ...baseline.scores },
        integration_score_notes: { ...baseline.notes },
      };
      normalized.total_score = Object.values(normalized.integration_scores).reduce(
        (sum, value) => sum + Number(value || 0),
        0
      );
      return normalized;
    });
    selectedOption =
      chooseTopWithRandomTie(judgedOptions) ||
      pickRandom(judgedOptions) ||
      judgedOptions[0] ||
      null;
  }

  if (!selectedOption) {
    throw new Error('v2 judge step failed to produce a valid plan');
  }

  appendLayeredLog('api:layered-intervention:v2-plan', {
    total_duration: selectedOption?.total_duration_minutes,
    blended_title: selectedOption?.blended_activity?.title || null,
    selected_option: selectedOption?.option_id || null,
  });
  console.log('[layered:v2] selected option', selectedOption?.option_id || null, {
    title: selectedOption?.plan_title,
    total_duration: selectedOption?.total_duration_minutes,
  });

  const finalBlendedActivity = selectedOption?.blended_activity || null;
  const finalPlanTitle =
    finalBlendedActivity?.title || selectedOption?.plan_title || 'Blended activity';
  const finalSummary =
    finalBlendedActivity?.goal || selectedOption?.summary_recap || finalPlanTitle;
  const finalCoherence =
    finalBlendedActivity?.alignment_notes || selectedOption?.coherence_notes || finalSummary;
  const finalDuration =
    finalBlendedActivity?.duration_minutes || selectedOption?.total_duration_minutes || 18;

  let friendlyCopy = null;
  try {
    const detailPayload = {
      plan_title: finalPlanTitle,
      summary_recap: finalSummary,
      coherence_notes: finalCoherence,
      planning_reasoning: ensureArray(selectedOption?.planning_reasoning).map((line) =>
        String(line || '').trim()
      ),
      why_matters: finalCoherence,
      why_feels_good: finalSummary,
      source_summaries: [],
    };
    const detailRaw = await runChatCompletion(
      'layered-detail',
      [
        { role: 'system', content: LAYERED_DETAIL_PROMPT },
        { role: 'user', content: JSON.stringify(detailPayload) },
      ],
      { response_format: { type: 'json_object' }, model: INTERVENTION_MODEL }
    );
    const detailParsed = safeParseJSON(detailRaw) || {};
    const parsedCopy = String(detailParsed.friendly_copy || '').trim();
    if (parsedCopy) {
      friendlyCopy = parsedCopy;
    }
  } catch (err) {
    console.warn('[layered:v2] friendly detail generation failed; continuing without it', err?.message || err);
  }

  return {
    plan_title: finalPlanTitle,
    summary_recap: finalSummary,
    coherence_notes: finalCoherence,
    total_duration_minutes: finalDuration,
    blended_activity: finalBlendedActivity || {
      title: finalPlanTitle,
      goal: finalSummary,
      alignment_notes: finalCoherence,
      duration_minutes: finalDuration,
      options: [],
    },
    combination_options: judgedOptions,
    selected_combination_id: selectedOption?.option_id,
    friendly_copy: friendlyCopy,
    cognitive_activities: [],
    experiential_activities: [],
    cognitive_reasoning: [],
    experiential_reasoning: [],
    cognitive_rubric: COGNITIVE_LAYER_RUBRIC,
    experiential_rubric: EXPERIENTIAL_LAYER_RUBRIC,
    integration_rubric: INTEGRATION_RUBRIC,
    integration_scores: selectedOption?.integration_scores || {},
    integration_score_notes: selectedOption?.integration_score_notes || {},
    planning_reasoning: selectedOption?.planning_reasoning || [],
    selected_ids: { combination: selectedOption?.option_id || null },
    intervention_judge_disabled: disableInterventionJudge,
  };
}

async function requestCandidatePlan({ intro, steps, existingCandidates, slotIndex }) {
  const slotLetter = String.fromCharCode(97 + slotIndex);
  const slotId = `candidate_${slotLetter}`;
  let feedback = '';

  for (let attempt = 1; attempt <= MAX_CANDIDATE_RETRIES; attempt += 1) {
    const payload = {
      intro: intro || '',
      steps,
      candidate_number: slotIndex + 1,
      slot_id: slotId,
      existing_candidates: ensureArray(existingCandidates)
        .map(summarizeCandidateForPrompt)
        .filter(Boolean),
      feedback: feedback || undefined,
    };

    let raw;
    try {
      raw = await runChatCompletion(
        `intervention-candidate-${slotIndex + 1}`,
        [
          {
            role: 'system',
            content: INTERVENTION_CANDIDATE_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify(payload),
          },
        ],
        {
          response_format: { type: 'json_schema', json_schema: CANDIDATE_JSON_SCHEMA },
          model: INTERVENTION_MODEL,
        }
      );
    } catch (err) {
      console.warn(`[intervention] candidate ${slotId} request error (attempt ${attempt}):`, err);
      feedback =
        'The previous call did not succeed. Return valid JSON with a single "candidate" object containing the requested fields.';
      continue;
    }

    const parsed = safeParseJSON(raw);
    if (!parsed) {
      console.warn(`[intervention] candidate ${slotId} returned invalid JSON (attempt ${attempt}).`);
      feedback =
        'Previous response was not valid JSON. Return JSON that matches the required schema and includes a "candidate" object.';
      continue;
    }

    let candidate = parsed?.candidate;
    if (!candidate && Array.isArray(parsed?.candidates) && parsed.candidates.length > 0) {
      candidate = parsed.candidates[0];
    }

    if (!candidate) {
      feedback =
        'Response must include a "candidate" object with plan details, scores, and score_notes.';
      continue;
    }

    const existingIds = ensureArray(existingCandidates).map((item) =>
      String(item?.plan_id || '').trim().toLowerCase()
    );

    candidate.plan_id = String(candidate.plan_id || slotId).trim() || slotId;
    if (existingIds.includes(candidate.plan_id.toLowerCase())) {
      feedback = `Plan id "${candidate.plan_id}" already exists. Provide a unique plan_id (fallback to "${slotId}" if needed).`;
      continue;
    }

    const existingTitles = ensureArray(existingCandidates).map((item) =>
      String(item?.plan_title || '').trim().toLowerCase()
    );
    const proposedTitle = String(candidate.plan_title || '').trim();
    if (proposedTitle && existingTitles.includes(proposedTitle.toLowerCase())) {
      feedback = `Plan title "${proposedTitle}" duplicates an existing candidate. Provide a distinct, curiosity-evoking title.`;
      continue;
    }

    const { activities, errors: activityErrors } = sanitizeActivities(candidate.activities || []);
    const {
      normalizedScores,
      normalizedNotes,
      errors: scoreErrors,
    } = validateAndNormalizeScores(
      candidate.plan_id,
      CANDIDATE_RUBRIC,
      candidate.scores,
      candidate.score_notes
    );

    const errors = [...activityErrors, ...scoreErrors];

    const summaryText = String(candidate.summary || '').trim();
    if (!summaryText) {
      errors.push('Summary is required (2–3 sentences linking the plan to the reflection).');
    }

    const rationaleText = String(candidate.rationale || '').trim();
    if (!rationaleText) {
      errors.push('Rationale is required (4–6 sentences explaining the psychological fit).');
    }

    if (errors.length) {
      feedback = [
        'Correct these issues:',
        ...errors.map((err) => `- ${err}`),
        'Return the full candidate JSON with all fixes applied. Scores must remain integers 1–5 with 10–20 word notes.',
      ].join('\n');
      console.warn(`[intervention] candidate ${slotId} validation errors (attempt ${attempt}):`, errors);
      continue;
    }

    candidate.activities = activities;
    candidate.plan_title = proposedTitle || `Candidate ${slotIndex + 1}`;
    candidate.summary = summaryText;
    candidate.rationale = rationaleText;
    candidate.scores = normalizedScores;
    candidate.score_notes = normalizedNotes;

    console.log(`[intervention] Candidate ${slotIndex + 1} (${candidate.plan_id}) scores`, candidate.scores);
    console.log(
      `[intervention] Candidate ${slotIndex + 1} (${candidate.plan_id}) score_notes`,
      candidate.score_notes
    );

    appendLog('api:intervention:candidate', {
      attempt,
      slot: slotIndex + 1,
      plan_id: candidate.plan_id,
      scores: candidate.scores,
    });

    return candidate;
  }

  throw new Error(
    `Candidate generation failed after ${MAX_CANDIDATE_RETRIES} attempts for slot ${slotIndex + 1}.`
  );
}

async function requestFinalPlan({ intro, steps, candidates }) {
  let feedback = '';

  for (let attempt = 1; attempt <= MAX_SELECTION_RETRIES; attempt += 1) {
    const payload = {
      intro: intro || '',
      steps,
      candidates,
      candidate_rubric: CANDIDATE_RUBRIC,
      selection_rubric: SELECTION_RUBRIC,
      feedback: feedback || undefined,
    };

    let raw;
    try {
      raw = await runChatCompletion(
        'intervention-selection',
        [
          {
            role: 'system',
            content: INTERVENTION_SELECTION_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify(payload),
          },
        ],
        {
          response_format: { type: 'json_schema', json_schema: FINAL_PLAN_JSON_SCHEMA },
          model: INTERVENTION_MODEL,
        }
      );
    } catch (err) {
      console.warn('[intervention] final selection request error:', err);
      feedback =
        'The previous response failed. Return valid JSON with the final plan, scores, score_notes, activities, and selection_reasoning.';
      continue;
    }

    const parsed = safeParseJSON(raw);
    if (!parsed) {
      feedback =
        'Previous response was not valid JSON. Return JSON matching the required schema.';
      continue;
    }

    const planTitle = String(parsed.plan_title || '').trim();
    const summary = String(parsed.summary || '').trim();
    const reasoning = String(parsed.selection_reasoning || '').trim();
    const sourceIds = ensureArray(parsed.source_plan_ids).map((id) => String(id || '').trim());

    const { activities, errors: activityErrors } = sanitizeActivities(parsed.activities || [], {
      requireReasoning: true,
    });
    const {
      normalizedScores,
      normalizedNotes,
      errors: scoreErrors,
    } = validateAndNormalizeScores(
      'final_plan',
      SELECTION_RUBRIC,
      parsed.scores,
      parsed.score_notes
    );

    const errors = [...activityErrors, ...scoreErrors];
    if (!planTitle) {
      errors.push('plan_title is required.');
    }
    if (!summary) {
      errors.push('summary is required (2–3 sentences).');
    }
    if (!reasoning) {
      errors.push('selection_reasoning is required (4–6 sentences).');
    }
    if (sourceIds.length === 0) {
      errors.push('source_plan_ids must list the contributing candidate ids.');
    }

    if (errors.length) {
      feedback = [
        'Fix the following issues before responding again:',
        ...errors.map((err) => `- ${err}`),
        'Return the full final plan JSON with all fields corrected.',
      ].join('\n');
      console.warn('[intervention] final selection validation errors:', errors);
      continue;
    }

    const totalDuration = activities.reduce(
      (sum, item) => sum + (Number(item.duration_minutes) || 0),
      0
    );

    const finalPlan = {
      ...parsed,
      plan_title: planTitle,
      summary,
      selection_reasoning: reasoning,
      source_plan_ids: sourceIds,
      activities,
      scores: normalizedScores,
      score_notes: normalizedNotes,
    };

    console.log('[intervention] Final selection scores', finalPlan.scores);
    console.log('[intervention] Final selection score_notes', finalPlan.score_notes);
    console.log('[intervention] Final plan total duration (minutes)', totalDuration);

    appendLog('api:intervention:final-selection', {
      attempt,
      scores: finalPlan.scores,
      totalDuration,
    });

    return finalPlan;
  }

  throw new Error(`Final selection failed after ${MAX_SELECTION_RETRIES} attempts.`);
}

app.post('/chat', async (req, res) => {
  const body = req.body || {};
  const incomingMessage = typeof body.message === 'string' ? body.message : '';
  const sessionId = await resolveSessionId(body.sessionId);
  const inferredConditionFromChat = extractStudyCondition(
    body?.condition ?? body?.condition_code ?? body?.study_condition ?? body?.assigned_condition ?? body?.arm
  );
  const CHAT_HISTORY_LIMIT = 12;
  const preview = incomingMessage.replace(/\s+/g, ' ').slice(0, 120);
  console.log('[api:chat] incoming message', {
    sessionId,
    length: incomingMessage.length,
    preview
  });
  appendLog('api:chat:req', {
    sessionId,
    ...(inferredConditionFromChat != null ? { condition: inferredConditionFromChat } : {}),
    preview: incomingMessage.replace(/\s+/g, ' ').slice(0, 200)
  });

  if (inferredConditionFromChat != null) {
    try {
      await sessionStore.updateSessionTiming(sessionId, { condition: inferredConditionFromChat });
    } catch (err) {
      console.warn('Failed to persist condition from /chat request', err?.message || err);
    }
  }

  if (incomingMessage) {
    try {
      await sessionStore.recordMessage(sessionId, 'user', incomingMessage);
    } catch (err) {
      console.error('Failed to persist user chat message', err?.message || err);
    }
  }

  const systemMessage = {
    role: 'system',
    content: [
      CORE_CHAT_INSTRUCTION,
      'Within this general chat endpoint, respond as the AI Support assistant for the ai-multi-support app.',
      'Do not repeat prior assistant wording unless the user asks to repeat or clarify it.'
    ].join('\n\n')
  };

  let historyMessages = [];
  try {
    const sessionData = await sessionStore.getSession(sessionId);
    const recent = Array.isArray(sessionData?.messages)
      ? sessionData.messages.slice(-CHAT_HISTORY_LIMIT)
      : [];
    historyMessages = recent
      .map((entry) => {
        const role = entry?.role === 'assistant' ? 'assistant' : entry?.role === 'user' ? 'user' : null;
        const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
        if (!role || !content) return null;
        return { role, content };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('Failed to load chat history for /chat context', err?.message || err);
  }

  const baseMessages = [systemMessage, ...historyMessages];
  if (!historyMessages.length && incomingMessage) {
    baseMessages.push({ role: 'user', content: incomingMessage });
  }

  try {
    const text = await runChatCompletion('chat', baseMessages, { model: CONVERSATION_MODEL });
    console.log('[api:chat] response text preview', text.slice(0, 200));
    appendLog('api:chat:res', { sessionId, preview: text.slice(0, 200) });
    try {
      await sessionStore.recordMessage(sessionId, 'assistant', text);
    } catch (err) {
      console.error('Failed to persist assistant chat message', err?.message || err);
    }
    res.json({ text, sessionId });
  } catch (err) {
    console.error('OpenAI /chat error', err?.response?.data || err?.message || err);
    appendLog('api:chat:error', {
      sessionId,
      detail: err?.response?.data || err?.message || String(err)
    });
    res.status(500).json({
      sessionId,
      error: 'OpenAI request failed',
      detail: err?.response?.data || err?.message
    });
  }
});

app.post('/evaluate', async (req, res) => {
  const { question, answer, stepId, stepTitle } = req.body || {};
  console.log('[api:evaluate] incoming payload', {
    stepId,
    stepTitle,
    questionPreview: (question || '').replace(/\s+/g, ' ').slice(0, 160),
    answerPreview: (answer || '').replace(/\s+/g, ' ').slice(0, 160)
  });
  appendLog('api:evaluate:req', {
    stepId,
    stepTitle,
    answerPreview: (answer || '').replace(/\s+/g, ' ').slice(0, 200)
  });
  if (!question || !answer) {
    return res.status(400).json({ error: 'question and answer are required' });
  }

  try {
    const raw = await runChatCompletion(
      'evaluate',
      [
        {
          role: 'system',
          content: EVALUATION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: JSON.stringify({
            stepId: stepId || null,
            stepTitle: stepTitle || null,
            question,
            answer
          })
        }
      ],
      { response_format: { type: 'json_object' }, model: CONVERSATION_MODEL }
    );

    const parsed = safeParseJSON(raw);
    if (!parsed) {
      console.warn('[api:evaluate] invalid JSON from model', raw);
      appendLog('api:evaluate:invalid-json', { raw: raw?.slice?.(0, 200) });
      return res.status(502).json({ error: 'LLM response was not valid JSON', raw });
    }
    console.log('[api:evaluate] model response', parsed);
    appendLog('api:evaluate:res', parsed);
    res.json(parsed);
  } catch (err) {
    console.error('OpenAI /evaluate error', err?.response?.data || err?.message || err);
    appendLog('api:evaluate:error', { detail: err?.response?.data || err?.message || String(err) });
    res.status(200).json({
      needs_follow_up: false,
      follow_up_question: '',
      error: err?.response?.data || err?.message || 'Evaluation request failed'
    });
  }
});

app.post('/step-control', async (req, res) => {
  const {
    step,
    answer,
    followUpHistory = [],
    nextStep,
    introSummary,
    stepSummaries = [],
    conversationContext,
    isFollowUp = false,
    sessionId: rawSessionId
  } = req.body || {};
  const sessionId = await resolveSessionId(rawSessionId);

  const stepId = step?.id || null;
  const stepTitle = step?.title || null;
  const stepPrompt = step?.prompt || step?.question || null;

  console.log('[api:step-control] incoming payload', {
    sessionId,
    stepId,
    stepTitle,
    hasNextStep: Boolean(nextStep),
    answerPreview: (answer || '').replace(/\s+/g, ' ').slice(0, 160),
    followUpsRecorded: Array.isArray(followUpHistory) ? followUpHistory.length : 0
  });
  appendLog('api:step-control:req', {
    sessionId,
    stepId,
    stepTitle,
    hasNextStep: Boolean(nextStep),
    answerPreview: (answer || '').replace(/\s+/g, ' ').slice(0, 200),
    followUpsRecorded: Array.isArray(followUpHistory) ? followUpHistory.length : 0
  });

  if (!stepPrompt || !answer) {
    appendLog('api:step-control:error', {
      reason: 'missing data',
      stepId,
      hasAnswer: Boolean(answer)
    });
    return res.status(400).json({ sessionId, error: 'step.prompt and answer are required' });
  }

  await recordSessionMessageSafe(sessionId, 'user', answer);

  const followUpHistoryArray = Array.isArray(followUpHistory) ? followUpHistory : [];
  const followUpCount = followUpHistoryArray.length;
  const followUpLimitReached = followUpCount >= MAX_FOLLOW_UPS_PER_STEP;

  if (followUpLimitReached) {
    const rationale = `Follow-up limit of ${MAX_FOLLOW_UPS_PER_STEP} reached; moving forward.`;
    console.log('[api:step-control] follow-up limit reached, forcing advance', {
      followUpCount,
      limit: MAX_FOLLOW_UPS_PER_STEP
    });
    appendLog('api:step-control:limit', {
      followUpCount,
      limit: MAX_FOLLOW_UPS_PER_STEP
    });
    return res.json({
      sessionId,
      decision: 'advance',
      follow_up_focus: '',
      rationale
    });
  }

  try {
    const payload = {
      conversation_context: conversationContext || '',
      intro_summary: introSummary || '',
      step_summaries: stepSummaries || [],
      step_id: stepId,
      step_title: stepTitle,
      question: stepPrompt,
      next_step_title: nextStep?.title || '',
      next_prompt: nextStep?.prompt || '',
      answer,
      follow_up_history: followUpHistoryArray,
      is_follow_up: isFollowUp,
      follow_up_limit: MAX_FOLLOW_UPS_PER_STEP
    };

    const raw = await runChatCompletion(
      'step-control',
      [
        {
          role: 'system',
          content: CONTROL_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      { response_format: { type: 'json_object' }, model: CONVERSATION_MODEL }
    );

    const parsed = safeParseJSON(raw);
    if (!parsed) {
      console.warn('[api:step-control] invalid JSON from model', raw);
      appendLog('api:step-control:invalid-json', { sessionId, raw: raw?.slice?.(0, 200) });
      return res.status(502).json({ sessionId, error: 'LLM response was not valid JSON', raw });
    }

    console.log('[api:step-control] model response', parsed);
    appendLog('api:step-control:res', {
      sessionId,
      decision: parsed?.decision || 'unknown',
      follow_up_focus: parsed?.follow_up_focus || '',
      rationale: parsed?.rationale || ''
    });

    res.json({
      sessionId,
      decision: parsed.decision || 'advance',
      follow_up_focus: parsed.follow_up_focus || '',
      rationale:
        parsed.rationale ||
        (parsed.decision === 'follow_up'
          ? 'Following up for one more detail.'
          : 'Ready to advance.')
    });
  } catch (err) {
    console.error(
      'LLM /step-control error',
      err?.response?.data || err?.message || err
    );
    appendLog('api:step-control:error', {
      sessionId,
      detail: err?.response?.data || err?.message || String(err)
    });
    res.status(200).json({
      sessionId,
      decision: 'advance',
      follow_up_focus: '',
      rationale: err?.response?.data || err?.message || 'Step-control decision failed; advancing.'
    });
  }
});

app.post('/auto-answer', async (req, res) => {
  const body = req.body || {};
  const prompt = (body.prompt || '').trim();
  const mode = body.mode || 'step';
  const step = body.step || null;
  const intro = body.intro || null;
  const steps = Array.isArray(body.steps) ? body.steps : [];

  if (!prompt) {
    appendLog('api:auto-answer:error', { reason: 'missing prompt' });
    return res.status(400).json({ error: 'prompt is required' });
  }

  appendLog('api:auto-answer:req', {
    mode,
    stepId: step?.id || null,
    promptPreview: prompt.slice(0, 160),
    historyCount: steps.length
  });

  try {
    const payload = {
      mode,
      prompt,
      step,
      intro,
      steps
    };

    const raw = await runChatCompletion(
      'auto-answer',
      [
        {
          role: 'system',
          content: AUTO_USER_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      { response_format: { type: 'json_object' }, model: CONVERSATION_MODEL }
    );

    const parsed = safeParseJSON(raw) || {};
    const answer = (parsed.answer || '').trim();

    if (!answer) {
      appendLog('api:auto-answer:empty', { raw: raw?.slice?.(0, 200) });
      return res.status(200).json({
        answer: '',
        error: 'Auto answer response was empty'
      });
    }

    appendLog('api:auto-answer:res', { answerPreview: answer.slice(0, 160) });
    res.json({ answer });
  } catch (err) {
    console.error('OpenAI /auto-answer error', err?.response?.data || err?.message || err);
    appendLog('api:auto-answer:error', {
      detail: err?.response?.data || err?.message || String(err)
    });
    res.status(200).json({
      answer: '',
      error: err?.response?.data || err?.message || 'Auto answer request failed'
    });
  }
});

const STUDY_STOP_MESSAGE = 'Please stop the study here and reach out for immediate support if needed.';
const SAFETY_CHECKS_ENABLED = String(process.env.SAFETY_CHECKS_ENABLED || '1') === '1';

async function runSafetyRiskCheck({ latest, recentHistory = [] }) {
  if (!SAFETY_CHECKS_ENABLED) {
    return { risk: false, reason: '' };
  }
  const snippet = typeof latest === 'string' ? latest.trim() : '';
  const historyEntries = ensureArray(recentHistory)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(-5);
  if (!snippet) {
    return { risk: false, reason: '' };
  }
  try {
    const payload = {
      latest: snippet,
      recent_history: historyEntries,
    };
    const raw = await runChatCompletion(
      'safety-check',
      [
        { role: 'system', content: SAFETY_CHECK_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      { response_format: { type: 'json_object' } }
    );
    const parsed = safeParseJSON(raw) || {};
    return {
      risk: Boolean(parsed?.risk),
      reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
    };
  } catch (err) {
    return {
      risk: false,
      reason: '',
      error: err?.response?.data || err?.message || String(err),
    };
  }
}

function safetyBlockedResponse(reason = '') {
  return {
    blocked: true,
    end_study: true,
    reason,
    user_message: STUDY_STOP_MESSAGE,
  };
}

app.post('/safety-check', async (req, res) => {
  const { text, history, sessionId: rawSessionId } = req.body || {};
  const sessionId = await resolveSessionId(rawSessionId);
  const snippet = typeof text === 'string' ? text.trim() : '';
  const historyEntries = ensureArray(history)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(-5);

  appendLog('api:safety-check:req', {
    sessionId,
    hasText: Boolean(snippet),
    historyCount: historyEntries.length,
    enabled: SAFETY_CHECKS_ENABLED,
  });

  if (!snippet) {
    return res.status(400).json({ sessionId, error: 'text is required' });
  }

  if (!SAFETY_CHECKS_ENABLED) {
    appendLog('api:safety-check:disabled', { sessionId });
    return res.json({ sessionId, risk: false, reason: '' });
  }

  try {
    const safety = await runSafetyRiskCheck({ latest: snippet, recentHistory: historyEntries });
    const risk = Boolean(safety?.risk);
    const reason = typeof safety?.reason === 'string' ? safety.reason : '';
    appendLog('api:safety-check:res', { sessionId, risk, reason });
    res.json({ sessionId, risk, reason });
  } catch (err) {
    console.error('OpenAI /safety-check error', err?.response?.data || err?.message || err);
    appendLog('api:safety-check:error', {
      sessionId,
      detail: err?.response?.data || err?.message || String(err),
    });
    res.status(200).json({
      sessionId,
      risk: false,
      error: err?.response?.data || err?.message || 'Safety check failed',
    });
  }
});

app.post('/summary', async (req, res) => {
  const { steps, sessionId: rawSessionId } = req.body || {};
  const sessionId = await resolveSessionId(rawSessionId);
  console.log('[api:summary] incoming payload', {
    sessionId,
    stepCount: Array.isArray(steps) ? steps.length : 0
  });
  appendLog('api:summary:req', {
    sessionId,
    stepCount: Array.isArray(steps) ? steps.length : 0
  });

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ sessionId, error: 'steps array is required' });
  }

  try {
    const text = await runChatCompletion(
      'summary',
      [
        {
          role: 'system',
          content: SUMMARY_SYSTEM_PROMPT
        },
        { role: 'user', content: JSON.stringify({ steps }) }
      ],
      { model: SUMMARY_MODEL }
    );
    console.log('[api:summary] response text preview', text.slice(0, 200));
    appendLog('api:summary:res', { sessionId, preview: text.slice(0, 200) });
    if (text) {
      try {
        await sessionStore.recordSummary(sessionId, text);
      } catch (err) {
        console.error('Failed to persist summary transcript', err?.message || err);
      }
    }
    res.json({ text, sessionId });
  } catch (err) {
    console.error('OpenAI /summary error', err?.response?.data || err?.message || err);
    appendLog('api:summary:error', {
      sessionId,
      detail: err?.response?.data || err?.message || String(err)
    });
    res
      .status(500)
      .json({
        sessionId,
        error: 'Summary request failed',
        detail: err?.response?.data || err?.message
      });
  }
});

app.post('/summary/variant', async (req, res) => {
  const { summary, mode, custom } = req.body || {};
  const inputSummary = typeof summary === 'string' ? summary.trim() : '';
  if (!inputSummary) {
    return res.status(400).json({ error: 'summary is required' });
  }
  const modeLabel = typeof mode === 'string' ? mode : 'third_person';
  const customStyle = typeof custom === 'string' ? custom.trim() : '';
  const styleMap = {
    third_person:
      'Rewrite from a third-person perspective, as if observing from the outside. Keep clear, neutral wording and concrete details.',
    movie:
      'Retell it like a short scene in a film. Keep it grounded, specific, and realistic without dramatic exaggeration.',
    character:
      'Rewrite it as a brief short story with a clear beginning, middle, and end. Keep the same facts and emotional meaning.',
    custom: customStyle
      ? `Rewrite in this style: ${customStyle}. Keep the same facts, keep it readable, and avoid adding new details.`
      : 'Rewrite in a clear custom style while preserving the same facts and meaning.',
  };
  const styleInstruction = styleMap[modeLabel] || styleMap.third_person;

  try {
    const text = await runChatCompletion(
      'summary-variant',
      [
        {
          role: 'system',
          content:
            'Rewrite the user summary in the requested style. Use plain, simple language that is easy to understand. Keep all concrete facts, avoid adding new details, keep it about the same length. No advice. Return only the rewritten text.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            style: styleInstruction,
            summary: inputSummary,
          }),
        },
      ],
      { model: SUMMARY_MODEL }
    );
    return res.json({ text });
  } catch (err) {
    console.error('OpenAI /summary/variant error', err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: 'Summary variant request failed',
      detail: err?.response?.data || err?.message,
    });
  }
});

app.get('/sessions', async (req, res) => {
  const limitParam = Number(req.query?.limit);
  try {
    const sessions = await sessionStore.listSessions(
      Number.isFinite(limitParam) ? limitParam : undefined
    );
    res.json({ sessions });
  } catch (err) {
    console.error('Failed to list chat sessions', err?.message || err);
    res.status(500).json({
      error: 'Unable to load chat sessions',
      detail: err?.message || String(err)
    });
  }
});

app.get('/sessions/export', async (req, res) => {
  try {
    const records = await sessionStore.exportAllSessions();
    const payload = {
      generated_at: new Date().toISOString(),
      session_count: Array.isArray(records) ? records.length : 0,
      sessions: records,
    };
    const json = JSON.stringify(payload, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sessions-export-${new Date().toISOString().split('T')[0]}.json"`
    );
    res.send(json);
  } catch (err) {
    console.error('Failed to export sessions', err?.message || err);
    res.status(500).json({
      error: 'Unable to export sessions',
      detail: err?.message || String(err),
    });
  }
});

app.get('/sessions/:id', async (req, res) => {
  const sessionId = String(req.params?.id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'session id is required' });
  }
  try {
    const record = await sessionStore.getSession(sessionId);
    if (!record) {
      return res.status(404).json({ error: 'session not found' });
    }
    res.json(record);
  } catch (err) {
    console.error('Failed to load session detail', err?.message || err);
    res.status(500).json({
      error: 'Unable to load session detail',
      detail: err?.message || String(err)
    });
  }
});

app.post('/sessions/:id/voice-flags', async (req, res) => {
  const sessionId = await resolveSessionId(req.params?.id);
  const voice_input_used = req.body?.voice_input_used === true;
  const ai_voice_enabled = req.body?.ai_voice_enabled === true;

  try {
    await sessionStore.updateSessionVoiceFlags(sessionId, {
      ...(voice_input_used ? { voice_input_used: true } : {}),
      ...(ai_voice_enabled ? { ai_voice_enabled: true } : {}),
    });
    appendLog('api:sessions:voice-flags', { sessionId, voice_input_used, ai_voice_enabled });
    res.json({ sessionId });
  } catch (err) {
    console.error('Failed to update session voice flags', err?.message || err);
    res.status(500).json({
      sessionId,
      error: 'Failed to update session voice flags',
      detail: err?.message || String(err),
    });
  }
});

app.post('/sessions/:id/timing', async (req, res) => {
  const sessionId = await resolveSessionId(req.params?.id);
  const conditionRaw =
    req.body?.condition ??
    req.body?.condition_code ??
    req.body?.study_condition ??
    req.body?.assigned_condition ??
    req.body?.arm;
  const totalRaw = req.body?.total_time_spent_ms;
  const total_time_spent_ms =
    typeof totalRaw === 'number'
      ? totalRaw
      : typeof totalRaw === 'string' && totalRaw.trim()
        ? Number(totalRaw.trim())
        : null;
  const condition = extractStudyCondition(conditionRaw);
  const completedRaw = req.body?.completed;
  const completed =
    completedRaw === true ||
    completedRaw === 1 ||
    completedRaw === '1' ||
    (typeof completedRaw === 'string' && completedRaw.trim().toLowerCase() === 'true');
  appendLog('api:sessions:timing:req', {
    sessionId,
    ...(condition ? { condition } : {}),
    completed,
    has_total_time_spent_ms: Number.isFinite(total_time_spent_ms) && total_time_spent_ms >= 0,
  });

  try {
    await sessionStore.updateSessionTiming(sessionId, {
      ...(condition ? { condition } : {}),
      ...(Number.isFinite(total_time_spent_ms) && total_time_spent_ms >= 0
        ? { total_time_spent_ms: Math.trunc(total_time_spent_ms) }
        : {}),
      ...(completed ? { completed: true } : {}),
    });
    appendLog('api:sessions:timing', {
      sessionId,
      ...(condition ? { condition } : {}),
      completed,
      has_total_time_spent_ms: Number.isFinite(total_time_spent_ms) && total_time_spent_ms >= 0,
    });
    res.json({ sessionId });
  } catch (err) {
    console.error('Failed to update session timing', err?.message || err);
    appendLog('api:sessions:timing:error', {
      sessionId,
      ...(condition ? { condition } : {}),
      completed,
      detail: err?.message || String(err),
    });
    res.status(500).json({
      sessionId,
      error: 'Failed to update session timing',
      detail: err?.message || String(err),
    });
  }
});

app.post('/sessions/:id/messages', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!role || !content) {
    return res.status(400).json({ sessionId, error: 'role and content are required' });
  }
  const allowedRoles = new Set(['assistant', 'user', 'system']);
  if (!allowedRoles.has(role)) {
    return res.status(400).json({ sessionId, error: 'role must be assistant, user, or system' });
  }
  await recordSessionMessageSafe(sessionId, role, content);
  res.json({ sessionId });
});

app.post('/sessions/:id/summary-text', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ sessionId, error: 'summary text is required' });
  }
  try {
    await sessionStore.recordSummary(sessionId, text);
    res.json({ sessionId, text });
  } catch (err) {
    console.error('Failed to persist summary text', err?.message || err);
    res.status(500).json({ sessionId, error: 'Failed to persist summary text' });
  }
});

app.post('/sessions/:id/intervention-card', async (req, res) => {
  const sessionId = await resolveSessionId(req.params.id);
  const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
  const imagePrompt =
    typeof req.body?.image_prompt === 'string' ? req.body.image_prompt.trim() : '';
  if (!imageUrl) {
    return res.status(400).json({ sessionId, error: 'image_url is required' });
  }
  try {
    await sessionStore.updateInterventionCardImage(sessionId, {
      image_url: imageUrl,
      image_prompt: imagePrompt || null,
    });
    res.json({ sessionId, ok: true });
  } catch (err) {
    console.error('Failed to persist intervention card image', err?.message || err);
    res.status(500).json({ sessionId, error: 'Failed to persist intervention card image' });
  }
});

app.post('/sessions/:id/ux-submissions', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const spec = req.body?.spec || null;
  const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
  const responses = Array.isArray(req.body?.responses) ? req.body.responses : [];
  const media = req.body?.media || null;
  const moodEmotions = req.body?.mood_emotions || null;
  const moodOther = typeof req.body?.mood_other === 'string' ? req.body.mood_other.trim() : null;
  const uxPlanId = Number(req.body?.ux_plan_id);
  try {
    const record = await sessionStore.recordUxSubmission(sessionId, {
      ux_plan_id: Number.isFinite(uxPlanId) ? uxPlanId : null,
      spec,
      modules,
      responses,
      media,
      mood_emotions: moodEmotions,
      mood_other: moodOther,
    });
    res.json({ sessionId, id: record?.id || null });
  } catch (err) {
    console.error('Failed to persist UX submission', err?.message || err);
    res.status(500).json({
      sessionId,
      error: 'Failed to persist UX submission',
      detail: err?.message || String(err),
    });
  }
});

app.post('/sessions/:id/cognitive-reframe-step', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const stepKey =
    typeof req.body?.step_key === 'string' && req.body.step_key.trim()
      ? req.body.step_key.trim()
      : '';
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  if (!stepKey) {
    return res.status(400).json({ sessionId, error: 'step_key is required' });
  }
  try {
    await sessionStore.recordCognitiveReframeStep(sessionId, stepKey, payload);
    const inferredCondition = extractStudyCondition(payload?.condition);
    if (inferredCondition != null) {
      await sessionStore.updateSessionTiming(sessionId, { condition: inferredCondition });
    }
    res.json({ sessionId, step_key: stepKey, ok: true });
  } catch (err) {
    console.error('Failed to persist cognitive reframe step', err?.message || err);
    res.status(500).json({
      sessionId,
      error: 'Failed to persist cognitive reframe step',
      detail: err?.message || String(err),
    });
  }
});

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const extractStudyCondition = (value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pi' || normalized === 'personalized_intervention') return 1;
    if (normalized === 'cr' || normalized === 'cognitive_reframe') return 2;
  }
  const n = toFiniteNumber(value);
  if (n === 1 || n === 2) return n;
  return null;
};

const extractStudyConditionFromPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.condition,
    payload.condition_code,
    payload.study_condition,
    payload.assigned_condition,
    payload.arm,
    payload.assigned_arm,
    payload.group,
  ];
  for (const candidate of candidates) {
    const parsed = extractStudyCondition(candidate);
    if (parsed != null) return parsed;
  }
  return null;
};

const getLatestPreStudyPayload = (steps, stepKey) => {
  if (!Array.isArray(steps) || !stepKey) return null;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const row = steps[i];
    if (row?.step_key === stepKey) return row?.payload && typeof row.payload === 'object' ? row.payload : null;
  }
  return null;
};

const computeStressMindsetTotalFromPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const explicit = toFiniteNumber(payload.stress_mindset_total_score);
  if (explicit != null) return explicit;
  const rawAnswers = Array.isArray(payload.appraisal_answers) ? payload.appraisal_answers : null;
  if (!rawAnswers || !rawAnswers.length) return null;
  const reverseIndices = Array.isArray(payload.stress_mindset_reverse_item_indices)
    ? payload.stress_mindset_reverse_item_indices.map((v) => toFiniteNumber(v)).filter((v) => Number.isInteger(v))
    : [0, 2, 4, 6];
  const reverseSet = new Set(reverseIndices);
  let total = 0;
  for (let i = 0; i < rawAnswers.length; i += 1) {
    const raw = toFiniteNumber(rawAnswers[i]);
    if (raw == null) return null;
    total += reverseSet.has(i) ? 4 - raw : raw;
  }
  return total;
};

const computePersonalizationMeanFromPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const rawAnswers = Array.isArray(payload.personalization_answers)
    ? payload.personalization_answers
    : null;
  if (!rawAnswers || rawAnswers.length === 0) return null;
  const answers = rawAnswers
    .map((v) => toFiniteNumber(v))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!answers.length) return null;
  return Number((answers.reduce((sum, v) => sum + v, 0) / answers.length).toFixed(4));
};

const computePersonalizationItemScoresFromPayload = (payload) => {
  const fieldNames = [
    'post_personalization_personalized_specific_situation_score',
    'post_personalization_system_understood_situation_score',
    'post_personalization_reflected_shared_information_score',
    'post_personalization_use_similar_activity_again_score',
    'post_personalization_recommend_activity_to_others_score',
    'post_personalization_activity_length_appropriate_score',
    'post_personalization_enjoyed_taking_part_score',
  ];
  const answers = Array.isArray(payload?.personalization_answers)
    ? payload.personalization_answers.map((v) => toFiniteNumber(v))
    : [];
  return fieldNames.reduce((acc, key, idx) => {
    acc[key] = answers[idx] ?? null;
    return acc;
  }, {});
};

const computePostStudyOutcomes = (preStudySteps) => {
  const preDemographics = getLatestPreStudyPayload(preStudySteps, 'pre_demographics');
  const prePss = getLatestPreStudyPayload(preStudySteps, 'pre_pss');
  const preStress = getLatestPreStudyPayload(preStudySteps, 'pre_stress');
  const postStudy = getLatestPreStudyPayload(preStudySteps, 'post_study');

  const stress_pre_rating = toFiniteNumber(preStress?.stress_level);
  const stress_post_rating = toFiniteNumber(postStudy?.stress_rating);
  const stress_difference_pre_minus_post =
    stress_pre_rating != null && stress_post_rating != null ? stress_pre_rating - stress_post_rating : null;

  const stress_mindset_pre_total = computeStressMindsetTotalFromPayload(preStress);
  const stress_mindset_post_total = computeStressMindsetTotalFromPayload(postStudy);
  const stress_mindset_difference_pre_minus_post =
    stress_mindset_pre_total != null && stress_mindset_post_total != null
      ? stress_mindset_pre_total - stress_mindset_post_total
      : null;
  const post_personalization_mean = computePersonalizationMeanFromPayload(postStudy);
  const personalizationItemScores = computePersonalizationItemScoresFromPayload(postStudy);
  const post_attention = toFiniteNumber(postStudy?.post_attention);
  const post_attention_check =
    typeof postStudy?.post_attention_check === 'boolean'
      ? postStudy.post_attention_check
      : post_attention != null
        ? post_attention === 5
        : null;

  return {
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
    stress_pre_rating,
    stress_post_rating,
    stress_difference_pre_minus_post,
    stress_mindset_pre_total,
    stress_mindset_post_total,
    stress_mindset_difference_pre_minus_post,
    post_personalization_mean,
    ...personalizationItemScores,
    post_attention,
    post_attention_check,
    post_activity_effect_text: postStudy?.activity_effect_text || null,
    post_tailoring_text: postStudy?.tailoring_text || null,
    post_helpful_aspects: postStudy?.helpful_aspects || null,
    post_not_helpful_aspects: postStudy?.not_helpful_aspects || null,
    post_improvement_suggestions: postStudy?.improvement_suggestions || null,
    post_technical_issues: postStudy?.technical_issues || null,
  };
};

const inferConditionFromPreStudySteps = (preStudySteps) => {
  const assignment = getLatestPreStudyPayload(preStudySteps, 'assignment');
  const postStudy = getLatestPreStudyPayload(preStudySteps, 'post_study');
  const candidates = [assignment?.condition, postStudy?.condition];
  for (const candidate of candidates) {
    const parsed = extractStudyCondition(candidate);
    if (parsed != null) return parsed;
  }
  return null;
};

const upsertPostStudyOutcomes = async (sessionId) => {
  try {
    const record = await sessionStore.getSession(sessionId);
    const preStudySteps = Array.isArray(record?.pre_study_steps) ? record.pre_study_steps : [];
    const sessionCondition = extractStudyCondition(record?.session?.study_condition);
    const inferredCondition = inferConditionFromPreStudySteps(preStudySteps);
    if (sessionCondition == null && inferredCondition != null) {
      await sessionStore.updateSessionTiming(sessionId, { condition: inferredCondition });
    }
    const outcomes = computePostStudyOutcomes(preStudySteps);
    if (
      outcomes.stress_pre_rating == null &&
      outcomes.stress_post_rating == null &&
      outcomes.stress_mindset_pre_total == null &&
      outcomes.stress_mindset_post_total == null
    ) {
      return;
    }
    await sessionStore.recordPreStudyStep(sessionId, 'post_study_outcomes', {
      ...outcomes,
      computed_at: new Date().toISOString(),
      source_steps: ['pre_stress', 'post_study'],
    });
    appendLog('api:pre-study:outcomes:upsert', {
      sessionId,
      has_stress_pair: outcomes.stress_pre_rating != null && outcomes.stress_post_rating != null,
      has_mindset_pair:
        outcomes.stress_mindset_pre_total != null && outcomes.stress_mindset_post_total != null,
    });
  } catch (err) {
    console.warn('Failed to upsert post-study outcomes', err?.message || err);
  }
};

app.post('/sessions/:id/pre-study-step', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const stepKey =
    typeof req.body?.step_key === 'string' && req.body.step_key.trim()
      ? req.body.step_key.trim()
      : '';
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  if (!stepKey) {
    return res.status(400).json({ sessionId, error: 'step_key is required' });
  }
  try {
    let mergedPayload = payload;
    try {
      const existingRecord = await sessionStore.getSession(sessionId);
      const existingSteps = Array.isArray(existingRecord?.pre_study_steps)
        ? existingRecord.pre_study_steps
        : [];
      const existing = existingSteps.find((row) => row?.step_key === stepKey);
      const existingPayload =
        existing?.payload && typeof existing.payload === 'object' ? existing.payload : null;
      if (existingPayload) {
        mergedPayload = { ...existingPayload, ...payload };
      }
    } catch (mergeErr) {
      console.warn('Failed to load existing pre-study payload for merge', mergeErr?.message || mergeErr);
    }
    await sessionStore.recordPreStudyStep(sessionId, stepKey, mergedPayload);
    const inferredCondition = extractStudyConditionFromPayload(mergedPayload);
    if (inferredCondition != null) {
      await sessionStore.updateSessionTiming(sessionId, { condition: inferredCondition });
    }
    if (stepKey === 'post_study') {
      const hasSubmittedAt =
        typeof mergedPayload?.submitted_at === 'string' && mergedPayload.submitted_at.trim().length > 0;
      const hasSubmittedAtCamel =
        typeof mergedPayload?.submittedAt === 'string' && mergedPayload.submittedAt.trim().length > 0;
      const hasCompletionCode =
        typeof mergedPayload?.completion_code === 'string' && mergedPayload.completion_code.trim().length > 0;
      if (hasSubmittedAt || hasSubmittedAtCamel || hasCompletionCode) {
        await sessionStore.updateSessionTiming(sessionId, {
          ...(inferredCondition != null ? { condition: inferredCondition } : {}),
          completed: true,
        });
      }
    }
    if (stepKey === 'pre_demographics' || stepKey === 'pre_pss') {
      await sessionStore.updateSessionDemographics(sessionId, mergedPayload || {});
    }
    if (stepKey === 'pre_stress' || stepKey === 'post_study') {
      await upsertPostStudyOutcomes(sessionId);
    }
    res.json({ sessionId, step_key: stepKey, ok: true });
  } catch (err) {
    console.error('Failed to persist pre-study step', err?.message || err);
    res.status(500).json({
      sessionId,
      error: 'Failed to persist pre-study step',
      detail: err?.message || String(err),
    });
  }
});

app.post('/sessions/:id/demographics', async (req, res) => {
  const rawId = req.params?.id;
  const sessionId = await resolveSessionId(rawId);
  const profile = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    await sessionStore.updateSessionDemographics(sessionId, profile);
    res.json({ sessionId, ok: true });
  } catch (err) {
    console.error('Failed to persist demographics', err?.message || err);
    res.status(500).json({
      sessionId,
      error: 'Failed to persist demographics',
      detail: err?.message || String(err),
    });
  }
});

const canServeDevPages =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_PAGES === '1';

app.get('/dev/sessions', async (req, res) => {
  if (!canServeDevPages) {
    return res.status(404).send('Not found');
  }
  const limitParam = Number(req.query?.limit);
  try {
    const sessions = await sessionStore.listSessions(
      Number.isFinite(limitParam) ? limitParam : undefined
    );
    const rows =
      sessions.length === 0
        ? '<tr><td colspan="10">No sessions recorded yet.</td></tr>'
        : sessions
            .map((session) => {
              const id = session?.id || '';
              const messageCount = Number(session?.message_count || 0);
              const preview = (session?.last_message_preview || '').slice(0, 120);
              const prolificId =
                session?.student_id ||
                session?.prolific_id ||
                session?.participant_id ||
                '';
              const voiceUsed = session?.voice_input_used ? 'Yes' : 'No';
              const aiVoice = session?.ai_voice_enabled ? 'Yes' : 'No';
              const totalTime = formatDurationMs(session?.total_time_spent_ms);
              return `
                <tr>
                  <td><a href="/dev/sessions/${encodeURIComponent(id)}">${escapeHtml(id)}</a></td>
                  <td>${escapeHtml(formatTimestamp(session.created_at))}</td>
                  <td>${escapeHtml(formatTimestamp(session.updated_at))}</td>
                  <td>${messageCount}</td>
                  <td>${escapeHtml(prolificId) || '—'}</td>
                  <td>${escapeHtml(formatTimestamp(session.last_user_message_at) || '—')}</td>
                  <td>${escapeHtml(totalTime)}</td>
                  <td>${voiceUsed}</td>
                  <td>${aiVoice}</td>
                  <td>${escapeHtml(preview) || '—'}</td>
                </tr>
              `;
            })
            .join('');
    const html = renderDevPage(
      'Session Browser',
      `
        <h1>Session Browser</h1>
        <div class="meta">
          Showing ${sessions.length} session${sessions.length === 1 ? '' : 's'}.
          <span class="badge">GET /sessions</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Messages</th>
              <th>Prolific ID</th>
              <th>Last User Message</th>
              <th>Total Time</th>
              <th>Voice Input Used</th>
              <th>AI Voice Enabled</th>
              <th>Last Message Preview</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p><a href="/sessions">View raw JSON</a></p>
      `
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Failed to render session browser', err?.message || err);
    res.status(500).send('Unable to render session browser.');
  }
});

app.get('/dev/sessions/:id', async (req, res) => {
  if (!canServeDevPages) {
    return res.status(404).send('Not found');
  }
  const sessionId = String(req.params?.id || '').trim();
  if (!sessionId) {
    return res.status(400).send('Session id is required.');
  }
  try {
    const record = await sessionStore.getSession(sessionId);
    if (!record) {
      return res.status(404).send('Session not found.');
    }
    const { session, messages = [], summaries = [], logs = [] } = record;
    const interventions = Array.isArray(record.interventions) ? record.interventions : [];
    const uxPlans = Array.isArray(record.ux_plans) ? record.ux_plans : [];
    const uxSubmissions = Array.isArray(record.ux_submissions) ? record.ux_submissions : [];
    const cognitiveReframeSteps = Array.isArray(record.cognitive_reframe_steps)
      ? record.cognitive_reframe_steps
      : [];
    const messageRows =
      messages.length === 0
        ? '<tr><td colspan="3">No messages recorded.</td></tr>'
        : messages
            .map(
              (msg) => `
            <tr>
              <td>${escapeHtml(msg.role)}</td>
              <td>${escapeHtml(formatTimestamp(msg.created_at))}</td>
              <td>${escapeHtml(msg.content)}</td>
            </tr>
          `
            )
            .join('');
    const summaryRows =
      summaries.length === 0
        ? '<tr><td colspan="3">No summaries yet.</td></tr>'
        : summaries
            .map(
              (entry) => `
            <tr>
              <td>${escapeHtml(String(entry.id))}</td>
              <td>${escapeHtml(formatTimestamp(entry.created_at))}</td>
              <td>${escapeHtml(entry.summary)}</td>
            </tr>
          `
            )
            .join('');
    const logRows =
      logs.length === 0
        ? '<tr><td colspan="3">No logs captured for this session yet.</td></tr>'
        : logs
            .map(
              (entry) => `
            <tr>
              <td>${escapeHtml(formatTimestamp(entry.created_at) || '—')}</td>
              <td>${escapeHtml(entry.event || '')}</td>
              <td><pre>${escapeHtml(safeJson(entry.data || {}))}</pre></td>
            </tr>
          `
            )
            .join('');
    const interventionSections =
      interventions.length === 0
        ? '<p>No interventions recorded for this session yet.</p>'
        : interventions
            .map((intervention, idx) => {
              const candidates = Array.isArray(intervention.candidates)
                ? intervention.candidates
                : [];
              const selectedSourceIds = new Set(
                Array.isArray(intervention.source_plan_ids)
                  ? intervention.source_plan_ids
                      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                      .filter(Boolean)
                  : []
              );
              const cognitiveCandidates = Array.isArray(intervention.cognitive_candidates)
                ? intervention.cognitive_candidates
                : [];
              const experientialCandidates = Array.isArray(intervention.experiential_candidates)
                ? intervention.experiential_candidates
                : [];
              const renderCandidateJson = (label, list) => {
                if (!list.length) {
                  return `<p>No ${label} candidates.</p>`;
                }
                return `
                  <details>
                    <summary>${list.length} ${label} candidate${list.length === 1 ? '' : 's'}</summary>
                    <pre>${escapeHtml(safeJson(list))}</pre>
                  </details>
                `;
              };
              const formatActivities = (activities) => {
                if (!Array.isArray(activities) || activities.length === 0) {
                  return '—';
                }
                return `
                  <details>
                    <summary>${activities.length} task${activities.length === 1 ? '' : 's'}</summary>
                    <pre>${escapeHtml(safeJson(activities))}</pre>
                  </details>
                `;
              };
              return `
                <div class="card">
                  <h3>Intervention #${idx + 1}</h3>
                  <p><strong>Plan title:</strong> ${escapeHtml(intervention.plan_title || 'Untitled')}</p>
                  <p><strong>Created:</strong> ${escapeHtml(
                    formatTimestamp(intervention.created_at) || '—'
                  )}</p>
                  <p><strong>Selection reasoning:</strong> ${escapeHtml(
                    intervention.selection_reasoning || '—'
                  )}</p>
                  <p><strong>Selected source id(s):</strong> ${
                    selectedSourceIds.size
                      ? escapeHtml(Array.from(selectedSourceIds).join(', '))
                      : '—'
                  }</p>
                  <p><strong>Summary:</strong> ${escapeHtml(intervention.summary || '—')}</p>
                  <p><strong>Scores:</strong></p>
                  <pre>${escapeHtml(safeJson(intervention.scores || {}))}</pre>
                  <p><strong>Score notes:</strong></p>
                  <pre>${escapeHtml(safeJson(intervention.score_notes || {}))}</pre>
                  <p><strong>Activities:</strong></p>
                  <pre>${escapeHtml(safeJson(intervention.activities || []))}</pre>
                  ${renderCandidateJson('Cognitive', cognitiveCandidates)}
                  ${renderCandidateJson('Experiential', experientialCandidates)}
                  <h4>Candidates (${candidates.length})</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Selected</th>
                        <th>Layer</th>
                        <th>Plan ID</th>
                        <th>Title</th>
                        <th>Created</th>
                        <th>Summary</th>
                        <th>Rationale</th>
                        <th>Activities</th>
                        <th>Scores</th>
                      </tr>
                    </thead>
                    <tbody>${
                      candidates.length === 0
                        ? '<tr><td colspan="9">No blended candidates recorded.</td></tr>'
                        : candidates
                            .map(
                              (candidate) => {
                                const candidateId =
                                  (typeof candidate.plan_id === 'string' && candidate.plan_id.trim()) ||
                                  (typeof candidate.candidate_id === 'string' && candidate.candidate_id.trim()) ||
                                  '';
                                const isSelected = candidateId
                                  ? selectedSourceIds.has(candidateId)
                                  : false;
                                return `
                                <tr>
                                  <td>${isSelected ? '<strong>Selected</strong>' : '—'}</td>
                                  <td>${escapeHtml(candidate.layer || 'blended')}</td>
                                  <td>${escapeHtml(candidate.plan_id || '')}</td>
                                  <td>${escapeHtml(candidate.plan_title || '')}</td>
                                  <td>${escapeHtml(formatTimestamp(candidate.created_at) || '')}</td>
                                  <td>${escapeHtml(previewText(candidate.summary || '', 180)) || '—'}</td>
                                  <td>${escapeHtml(candidate.rationale || '—')}</td>
                                  <td>${formatActivities(candidate.activities)}</td>
                                  <td><pre>${escapeHtml(safeJson(candidate.scores || {}))}</pre></td>
                                </tr>
                              `;
                              }
                            )
                            .join('')
                    }</tbody>
                  </table>
                </div>
              `;
            })
            .join('');
    const uxPlanSections =
      uxPlans.length === 0
        ? '<p>No UX planner runs recorded for this session yet.</p>'
        : uxPlans
            .map((plan, idx) => {
              const candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
              const selectedIndex =
                typeof plan.selected_index === 'number' ? plan.selected_index : null;
              const selectedCandidate =
                selectedIndex != null && candidates[selectedIndex]
                  ? candidates[selectedIndex]
                  : null;
              const renderCandidateRow = (candidate = {}, candidateIdx = 0) => {
                const title = candidate?.spec?.title || candidate?.title || `Candidate ${candidateIdx + 1}`;
                const instruction =
                  candidate?.spec?.instruction ||
                  candidate?.instruction ||
                  candidate?.summary ||
                  '';
                const scoreRows = objectEntries(candidate?.scores)
                  .map(
                    ([key, value]) => `
                      <div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>
                    `
                  )
                  .join('');
                const scoreNotesRows = objectEntries(candidate?.score_notes)
                  .map(
                    ([key, value]) => `
                      <div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>
                    `
                  )
                  .join('');
                const modules = Array.isArray(candidate?.spec?.modules) ? candidate.spec.modules : [];
                const moduleSummary =
                  modules.length > 0
                    ? modules
                        .map((m) => (typeof m === 'string' ? m : m?.id))
                        .filter(Boolean)
                        .join(', ')
                    : '';
                const isSelected = selectedIndex === candidateIdx;
                return `
                  <tr>
                    <td>${isSelected ? '<strong>Selected</strong>' : '—'}</td>
                    <td>${escapeHtml(String(candidateIdx + 1))}</td>
                    <td>${escapeHtml(title)}</td>
                    <td>${escapeHtml(previewText(instruction, 200)) || '—'}</td>
                    <td>${escapeHtml(moduleSummary) || '—'}</td>
                    <td>${scoreRows || '—'}</td>
                    <td>${scoreNotesRows || '—'}</td>
                    <td>
                      <details>
                        <summary>View JSON</summary>
                        <pre>${escapeHtml(safeJson(candidate || {}))}</pre>
                      </details>
                    </td>
                  </tr>
                `;
              };
              const candidateTable =
                candidates.length === 0
                  ? '<p>No UX candidates recorded.</p>'
                  : `
                    <table>
                      <thead>
                        <tr>
                          <th>Selected</th>
                          <th>#</th>
                          <th>Title</th>
                          <th>Description</th>
                          <th>Modules</th>
                          <th>Scores</th>
                          <th>Score Notes</th>
                          <th>Raw</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${candidates.map(renderCandidateRow).join('')}
                      </tbody>
                    </table>
                  `;
              const selectedSpecPreview =
                plan.selected_spec
                  ? `
                    <details>
                      <summary>Selected spec</summary>
                      <pre>${escapeHtml(safeJson(plan.selected_spec))}</pre>
                    </details>
                  `
                  : '<p>No selected spec recorded.</p>';
              return `
                <div class="card">
                  <h3>UX Plan #${idx + 1}</h3>
                  <p><strong>Created:</strong> ${escapeHtml(
                    formatTimestamp(plan.created_at) || '—'
                  )}</p>
                  <p><strong>Summary:</strong> ${escapeHtml(plan.summary || '—')}</p>
                  <p><strong>Focus:</strong> ${escapeHtml(plan.focus || '—')}</p>
                  <p><strong>Selected index:</strong> ${
                    selectedIndex != null ? selectedIndex : '—'
                  }</p>
                  ${selectedSpecPreview}
                  ${candidateTable}
                </div>
              `;
            })
            .join('');
    const uxSubmissionSections =
      uxSubmissions.length === 0
        ? '<p>No UX submissions recorded for this session yet.</p>'
        : uxSubmissions
            .map((submission, idx) => {
              const modules = Array.isArray(submission.modules) ? submission.modules : [];
              const responses = Array.isArray(submission.responses) ? submission.responses : [];
              const responseMap = responses.reduce((map, entry) => {
                if (entry && typeof entry === 'object' && entry.module_index != null) {
                  map.set(entry.module_index, entry);
                }
                return map;
              }, new Map());
              const rows = modules
                .map((mod, modIdx) => {
                  const response = responseMap.get(modIdx) || {};
                  const prompt = mod?.prompt || mod?.question || mod?.label || '';
                  const options = Array.isArray(mod?.options) ? mod.options : [];
                  const responseText =
                    response?.text ||
                    response?.value ||
                    response?.selectedValue ||
                    (Array.isArray(response?.selected) ? response.selected.join(', ') : '') ||
                    (Array.isArray(response?.values) ? response.values.join(', ') : '') ||
                    (Array.isArray(response?.messages)
                      ? response.messages.map((m) => `${m.from}: ${m.text}`).join(' | ')
                      : '');
                  return `
                    <tr>
                      <td>${escapeHtml(String(modIdx + 1))}</td>
                      <td>${escapeHtml(mod?.id || '')}</td>
                      <td>${escapeHtml(previewText(prompt, 200)) || '—'}</td>
                      <td>${options.length ? escapeHtml(options.join(', ')) : '—'}</td>
                      <td>${escapeHtml(String(responseText || '—')).slice(0, 260) || '—'}</td>
                      <td>
                        <details>
                          <summary>View</summary>
                          <pre>${escapeHtml(safeJson(response || {}))}</pre>
                        </details>
                      </td>
                    </tr>
                  `;
                })
                .join('');
              const moduleTable =
                modules.length === 0
                  ? '<p>No module metadata captured.</p>'
                  : `
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Module</th>
                          <th>Prompt</th>
                          <th>Options</th>
                          <th>Response</th>
                          <th>Raw</th>
                        </tr>
                      </thead>
                      <tbody>${rows}</tbody>
                    </table>
                  `;
              const mediaBlock =
                submission.media
                  ? `
                    <details>
                      <summary>Captured media/scripts</summary>
                      <pre>${escapeHtml(safeJson(submission.media))}</pre>
                    </details>
                  `
                  : '';
              const moodBlock =
                submission.mood_emotions || submission.mood_other
                  ? `
                    <div class="meta">
                      <p><strong>Selected emotions:</strong> ${
                        Array.isArray(submission.mood_emotions)
                          ? escapeHtml(submission.mood_emotions.join(', ') || '—')
                          : escapeHtml(String(submission.mood_emotions || '—'))
                      }</p>
                      <p><strong>Other emotions:</strong> ${escapeHtml(submission.mood_other || '—')}</p>
                    </div>
                  `
                  : '';
              return `
                <div class="card">
                  <h3>UX Submission #${idx + 1}</h3>
                  <p><strong>Created:</strong> ${escapeHtml(
                    formatTimestamp(submission.created_at) || '—'
                  )}</p>
                  ${moodBlock}
                  ${moduleTable}
                  ${mediaBlock}
                </div>
              `;
            })
            .join('');
    const cognitiveReframeSections =
      cognitiveReframeSteps.length === 0
        ? '<p>No cognitive reframe step captures recorded for this session yet.</p>'
        : cognitiveReframeSteps
            .map((entry, idx) => {
              const stepKey = entry?.step_key || `step_${idx + 1}`;
              const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
              return `
                <div class="card">
                  <h3>${escapeHtml(stepKey)}</h3>
                  <p><strong>Created:</strong> ${escapeHtml(formatTimestamp(entry?.created_at) || '—')}</p>
                  <p><strong>Updated:</strong> ${escapeHtml(formatTimestamp(entry?.updated_at) || '—')}</p>
                  <details>
                    <summary>Captured payload</summary>
                    <pre>${escapeHtml(safeJson(payload))}</pre>
                  </details>
                </div>
              `;
            })
            .join('');

    const html = renderDevPage(
      `Session ${sessionId}`,
      `
        <a href="/dev/sessions">&larr; Back to list</a>
        <h1>Session ${escapeHtml(sessionId)}</h1>
        <div class="grid">
          <div class="card">
            <h2>Metadata</h2>
            <p><strong>Created:</strong> ${escapeHtml(formatTimestamp(session.created_at) || '—')}</p>
            <p><strong>Updated:</strong> ${escapeHtml(formatTimestamp(session.updated_at) || '—')}</p>
            <p><strong>Last User Message:</strong> ${escapeHtml(formatTimestamp(session.last_user_message_at) || '—')}</p>
            <p><strong>Last Summary:</strong> ${escapeHtml(formatTimestamp(session.last_summary_at) || '—')}</p>
            <p><strong>Total Messages:</strong> ${messages.length}</p>
            <p><strong>Total time spent:</strong> ${escapeHtml(formatDurationMs(session.total_time_spent_ms))}</p>
            <p><strong>Condition started at:</strong> ${escapeHtml(formatTimestamp(session.condition_started_at) || '—')}</p>
            <p><strong>Condition-only time spent:</strong> ${escapeHtml(formatDurationMs(session.condition_time_spent_ms))}</p>
            <p><strong>Completed at:</strong> ${escapeHtml(formatTimestamp(session.completed_at) || '—')}</p>
            <p><strong>Voice input used:</strong> ${session.voice_input_used ? 'Yes' : 'No'}</p>
            <p><strong>AI voice enabled:</strong> ${session.ai_voice_enabled ? 'Yes' : 'No'}</p>
          </div>
          <div class="card">
            <h2>Raw JSON</h2>
            <pre>${escapeHtml(safeJson(record))}</pre>
          </div>
        </div>
        <h2>Messages</h2>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Timestamp</th>
              <th>Content</th>
            </tr>
          </thead>
          <tbody>${messageRows}</tbody>
        </table>
        <h2>Summaries</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Created</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
        <h2>Logs</h2>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Event</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>${logRows}</tbody>
        </table>
        <h2>UX Planner Runs</h2>
        ${uxPlanSections}
        <h2>UX Submissions</h2>
        ${uxSubmissionSections}
        <h2>Cognitive Reframe Steps</h2>
        ${cognitiveReframeSections}
        <h2>Interventions</h2>
        ${interventionSections}
        <p><a href="/sessions/${encodeURIComponent(sessionId)}">View raw JSON entry</a></p>
      `
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Failed to render session detail', err?.message || err);
    res.status(500).send(
      renderDevPage(
        `Session ${sessionId}`,
        `
          <a href="/dev/sessions">&larr; Back to list</a>
          <h1>Session ${escapeHtml(sessionId)}</h1>
          <div class="card">
            <h2>Render Error</h2>
            <p>The session detail renderer failed for this record.</p>
            <pre>${escapeHtml(err?.stack || err?.message || String(err))}</pre>
          </div>
        `
      )
    );
  }
});

app.post('/dev/stress-support/summary', async (req, res) => {
  const requestedSeed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
  const seed = requestedSeed || pickRandom(STRESS_SUMMARY_SEEDS) || STRESS_SUMMARY_SEEDS[0];
  const tone = typeof req.body?.tone === 'string' ? req.body.tone.trim() : '';

  appendLog('api:stress-support:summary:req', { seed, tone });

  try {
    const userPayload = {
      seed_topic: seed,
      tone: tone || 'steady and down-to-earth',
    };
    const raw = await runChatCompletion(
      'stress-support-summary',
      [
        { role: 'system', content: STRESS_SUMMARY_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      { response_format: { type: 'json_object' }, model: STRESS_SUPPORT_MODEL, temperature: 0.9 }
    );

    const parsed = safeParseJSON(raw) || {};
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : '';

    if (summary) {
      appendLog('api:stress-support:summary:res', { seed, source: 'llm' });
      return res.json({
        summary,
        seed,
        source: 'llm',
      });
    }
  } catch (err) {
    console.error('OpenAI /dev/stress-support/summary error', err?.response?.data || err?.message || err);
  }

  const fallbackSummary = pickRandom(STRESS_SUMMARY_SEEDS) || STRESS_SUMMARY_SEEDS[0];
  appendLog('api:stress-support:summary:fallback', { seed, usingSeed: fallbackSummary });
  return res.json({
    summary: fallbackSummary,
    seed,
    source: 'fallback',
  });
});

// Thinking trap classification (retrieval + completion, mirrors reframing.py pattern).
app.post('/dev/thinking-traps/classify', async (req, res) => {
  try {
    const { thought, situation } = req.body || {};
    if (!thought && !situation) {
      return res.status(400).json({ error: 'missing_thought_or_situation' });
    }
    const thoughtText = typeof thought === 'string' ? thought : '';
    const situationText = typeof situation === 'string' ? situation : '';
    const safetyInput = [thoughtText, situationText].filter(Boolean).join('\n').trim();
    const safety = await runSafetyRiskCheck({ latest: safetyInput });
    if (safety?.risk) {
      appendLog('api:baseline:thinking-traps:blocked', { reason: safety.reason || '' });
      return res.status(200).json(safetyBlockedResponse(safety.reason || ''));
    }
    const result = await classifyThinkingTrap({
      thought: thoughtText,
      situation: situationText,
    });
    res.json(result);
  } catch (err) {
    console.error('thinking-traps classify error', err?.message || err);
    res.status(500).json({ error: 'thinking_trap_failed' });
  }
});

// Thinking trap metadata (for UI rendering without hitting the model).
app.get('/dev/thinking-traps/meta', (_req, res) => {
  res.json({ traps: TRAP_LIST });
});

// Reframe generation (retrieval + completion, similar to reframing.py but using our model).
app.post('/dev/reframe/generate', async (req, res) => {
  try {
    const { thought, situation, traps } = req.body || {};
    if (!thought && !situation) {
      return res.status(400).json({ error: 'missing_thought_or_situation' });
    }
    const thoughtText = typeof thought === 'string' ? thought : '';
    const situationText = typeof situation === 'string' ? situation : '';
    const safetyInput = [thoughtText, situationText].filter(Boolean).join('\n').trim();
    const safety = await runSafetyRiskCheck({ latest: safetyInput });
    if (safety?.risk) {
      appendLog('api:baseline:reframe-generate:blocked', { reason: safety.reason || '' });
      return res.status(200).json(safetyBlockedResponse(safety.reason || ''));
    }
    const result = await generateReframe({
      thought: thoughtText,
      situation: situationText,
      traps: Array.isArray(traps) ? traps.filter((t) => typeof t === 'string') : [],
    });
    res.json(result);
  } catch (err) {
    console.error('reframe generate error', err?.message || err);
    res.status(500).json({ error: 'reframe_failed' });
  }
});

// Optional refinement of an existing reframe with a goal (e.g., relatable, action, supportive).
app.post('/dev/reframe/assist', async (req, res) => {
  try {
    const { thought, situation, traps, current, goal } = req.body || {};
    if (!current) return res.status(400).json({ error: 'missing_current_reframe' });
    const thoughtText = typeof thought === 'string' ? thought : '';
    const situationText = typeof situation === 'string' ? situation : '';
    const currentText = typeof current === 'string' ? current : '';
    const safetyInput = [thoughtText, situationText, currentText].filter(Boolean).join('\n').trim();
    const safety = await runSafetyRiskCheck({ latest: safetyInput });
    if (safety?.risk) {
      appendLog('api:baseline:reframe-assist:blocked', { reason: safety.reason || '' });
      return res.status(200).json(safetyBlockedResponse(safety.reason || ''));
    }
    const result = await assistReframe({
      thought: thoughtText,
      situation: situationText,
      traps: Array.isArray(traps) ? traps.filter((t) => typeof t === 'string') : [],
      current: currentText,
      goal: typeof goal === 'string' ? goal : '',
    });
    res.json(result);
  } catch (err) {
    console.error('reframe assist error', err?.message || err);
    res.status(500).json({ error: 'reframe_assist_failed' });
  }
});

app.post('/dev/stress-support/intervention', async (req, res) => {
  const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';
  const disableUxJudge = parseBooleanFlag(req.body?.disable_ux_judge);
  const focus = typeof req.body?.focus === 'string' && req.body.focus.trim()
    ? req.body.focus.trim()
    : 'Quick stress reset';
  const sessionId = await resolveSessionId(req.body?.sessionId);
  let conversation = typeof req.body?.conversation === 'string' ? req.body.conversation.trim() : '';
  let conversationSource = conversation ? 'request' : 'none';
  if (!conversation && sessionId) {
    try {
      const sessionData = await sessionStore.getSession(sessionId);
      const transcript = buildConversationTranscriptFromMessages(sessionData?.messages);
      if (transcript) {
        conversation = transcript;
        conversationSource = 'session';
      }
    } catch (err) {
      console.warn('Failed to load session conversation transcript', err?.message || err);
    }
  }
  const requestedFormatsRaw = Array.isArray(req.body?.formats)
    ? req.body.formats
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry)
    : [];
  let requestedFormats = requestedFormatsRaw.filter((entry) => STRESS_FORMATS.includes(entry)).slice(0, 1);
  const interventionStepsFromBody = Array.isArray(req.body?.intervention_steps)
    ? req.body.intervention_steps
    : Array.isArray(req.body?.steps)
      ? req.body.steps
      : [];
  const intervention_steps = interventionStepsFromBody
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object') {
        if (typeof entry.description === 'string' && entry.description.trim()) return entry.description.trim();
        if (typeof entry.text === 'string' && entry.text.trim()) return entry.text.trim();
        if (typeof entry.step === 'string' && entry.step.trim()) return entry.step.trim();
        if (typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim();
      }
      return '';
    })
    .filter((entry) => entry)
    .slice(0, 12);
  const fallbackStepsFromSummary = intervention_steps.length
    ? []
    : summary
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
        .filter((line) => line.length > 8)
        .slice(0, 6);
  const effectiveInterventionSteps = intervention_steps.length ? intervention_steps : fallbackStepsFromSummary;
  const UX_PLANNER_TIMEOUT_MS = 5 * 60 * 1000;

  if (!summary) {
    return res.status(400).json({ error: 'summary is required' });
  }
  // default to planner if none provided
  if (requestedFormats.length !== 1) {
    requestedFormats = ['planner'];
  }

  appendLog('api:stress-support:intervention:req', {
    summary_preview: summary.slice(0, 160),
    mediums: requestedFormats,
    is_dalle_video: STRESS_DALLE_VIDEO_FORMATS.includes(requestedFormats[0]),
    disable_ux_judge: disableUxJudge,
    conversation_source: conversationSource,
    conversation_chars: conversation.length,
    intervention_step_count: effectiveInterventionSteps.length,
  });

  try {
    // planner branch: return structured spec directly
    if (requestedFormats[0] === 'planner') {
      const startMs = Date.now();
      const plannerDeadlineAt = startMs + UX_PLANNER_TIMEOUT_MS;
      const buildPlannerTimeoutFallbackSpec = () => {
        const actionText = effectiveInterventionSteps[0] || 'Focus on one manageable next action.';
        return {
          title: 'Quick fallback reset',
          minutes: 3,
          evidence: 'Write one sentence about what shifted.',
          instruction:
            'Start with a short timer and keep going longer if helpful. Then write one brief reflection.',
          modules: [
            { id: 'heading', text: 'Quick reset plan' },
            { id: 'timer', seconds: 180, action: actionText },
            {
              id: 'textbox',
              question: 'What changed while you did this?',
              placeholder: 'Write one brief observation.',
            },
          ],
          steps: [
            `Start a short timer and do: ${actionText}`,
            'Write one sentence about what you noticed.',
          ],
          explanation: 'Generated via timeout fallback to avoid long waits.',
          candidates: [],
        };
      };
      const createPlannerTimeoutError = (stage) => {
        const err = new Error(`Planner exceeded 4-minute timeout at ${stage}`);
        err.code = 'UX_PLANNER_TIMEOUT';
        err.stage = stage;
        return err;
      };
      const runWithinPlannerDeadline = async (stage, promiseFactory) => {
        const remainingMs = plannerDeadlineAt - Date.now();
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
          throw createPlannerTimeoutError(stage);
        }
        let timer = null;
        try {
          return await Promise.race([
            Promise.resolve().then(() => promiseFactory()),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(createPlannerTimeoutError(stage)), remainingMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      appendLog('api:stress-support:planner:start', { summary_preview: summary.slice(0, 160), focus });
      const interventionStepsText = effectiveInterventionSteps.length
        ? effectiveInterventionSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')
        : '(none provided)';
      appendLog('api:stress-support:planner:intervention-steps', {
        text: interventionStepsText,
        count: effectiveInterventionSteps.length,
      });
      try {
        const generatePrompt = disableUxJudge
          ? `${UX_PLANNER_GENERATE_PROMPT}\n\n${NO_JUDGE_UX_PROMPT_SUFFIX}`
          : UX_PLANNER_GENERATE_PROMPT;
        const generateRaw = await runWithinPlannerDeadline('generate', () =>
          runChatCompletion(
            'ux-planner-generate',
            [
              { role: 'system', content: generatePrompt },
              {
                role: 'user',
                content: JSON.stringify({
                  summary,
                  focus,
                  conversation,
                  intervention_steps: effectiveInterventionSteps,
                }),
              },
            ],
            { response_format: { type: 'json_object' }, model: STRESS_SUPPORT_MODEL, temperature: 1 }
          )
        );
      appendLog('api:stress-support:planner:generate:raw', {
        preview: typeof generateRaw === 'string' ? generateRaw.slice(0, 400) : '',
      });
      const generated = safeParseJSON(generateRaw) || {};
      const generatedCandidates = Array.isArray(generated.candidates) ? generated.candidates : [];
      if (!generatedCandidates.length) {
        appendLog('api:stress-support:planner:error', { reason: 'no_candidates' });
        return res.status(502).json({ error: 'Planner did not return candidates' });
      }
      // Randomize canonical candidate order so the same generator slot is not always index 0 downstream.
      const canonicalCandidates = shuffleArray(generatedCandidates);

      const rubricKeys = Array.isArray(UX_FULL_RUBRIC) ? UX_FULL_RUBRIC.map((r) => r.key) : [];
      const ensureArray = (val) => (Array.isArray(val) ? val : []);
      const ensureString = (val, fallback = '') => (typeof val === 'string' && val.trim() ? val.trim() : fallback);
      const ensureNumber = (val, fallback = null) => {
        const num = Number(val);
        return Number.isFinite(num) ? num : fallback;
      };
      const normalizeBestIndex = (idx, max) => {
        const n = Number(idx);
        if (!Number.isFinite(n)) return 0;
        // Prefer zero-based indexing (the judge prompt example uses 0).
        // Fall back to one-based only when zero-based is out of bounds.
        if (n >= 0 && n < max) return n;
        if (n >= 1 && n <= max) return n - 1;
        return 0;
      };
      let mergedCandidates = canonicalCandidates;
      let bestIndex = 0;
      if (disableUxJudge) {
        mergedCandidates = canonicalCandidates.slice(0, 1);
        bestIndex = 0;
        appendLog('api:stress-support:planner:score:skipped', {
          reason: 'ablation_disabled',
          candidate_count: mergedCandidates.length,
        });
      } else {
        const shuffledCandidates = canonicalCandidates.map((candidate, idx) => ({ candidate, idx }));
        for (let i = shuffledCandidates.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledCandidates[i], shuffledCandidates[j]] = [shuffledCandidates[j], shuffledCandidates[i]];
        }
        const scoringCandidates = shuffledCandidates.map((entry) => entry.candidate);
        appendLog('api:stress-support:planner:score:shuffle', {
          order: shuffledCandidates.map((entry) => entry.idx),
        });

        console.log('[ux-planner] scoring step start');
        const scoreRaw = await runWithinPlannerDeadline('score', () =>
          runChatCompletion(
            'ux-planner-score',
            [
              { role: 'system', content: UX_PLANNER_SCORE_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({
                  summary,
                  focus,
                  conversation,
                  intervention_steps: effectiveInterventionSteps,
                  candidates: scoringCandidates,
                }),
              },
            ],
            { response_format: { type: 'json_object' }, model: STRESS_SUPPORT_MODEL, temperature: 1 }
          )
        );
        appendLog('api:stress-support:planner:score:rubric', {
          note: 'Using UX_FULL_RUBRIC for scoring',
          rubric_key_count: rubricKeys.length,
          rubric_keys: rubricKeys,
        });
        console.log(`[ux-planner] scoring with UX_FULL_RUBRIC (${rubricKeys.length} criteria)`);
        appendLog('api:stress-support:planner:score:raw', {
          preview: typeof scoreRaw === 'string' ? scoreRaw.slice(0, 400) : '',
        });
        const scored = safeParseJSON(scoreRaw) || {};
        const scoredCandidates = Array.isArray(scored.candidates) ? scored.candidates : [];
        const scoredBestIndex = normalizeBestIndex(scored.best_index, scoringCandidates.length);
        bestIndex =
          shuffledCandidates[scoredBestIndex]?.idx ??
          normalizeBestIndex(scored.best_index, canonicalCandidates.length);
        const scoreByOriginalIndex = new Array(canonicalCandidates.length).fill(null);
        scoredCandidates.forEach((score, idx) => {
          const originalIdx = shuffledCandidates[idx]?.idx;
          if (Number.isFinite(originalIdx)) scoreByOriginalIndex[originalIdx] = score;
        });
        mergedCandidates = canonicalCandidates.map((cand, idx) => {
          const score = scoreByOriginalIndex[idx] || {};
          return {
            ...cand,
            scores: score.scores || cand.scores,
            score_notes: score.score_notes || cand.score_notes,
          };
        });
      }
      const interactiveIds = ['short_audio', 'storyboard', 'timer', 'timed_cues'];
      const selectedIndex = normalizeBestIndex(bestIndex, mergedCandidates.length);
      const bestSpec =
        mergedCandidates[selectedIndex]?.spec ||
        mergedCandidates[0]?.spec ||
        null;
      const defaultModules = [
        { id: 'heading', text: ensureString(bestSpec?.title, 'Generated UX') },
        { id: 'textbox', question: 'What stood out for you?', placeholder: 'Write one line…' },
      ];
      const toOneLine = (value, max = 220) =>
        ensureString(value, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, max);
      const summarizeGoal = (...parts) => {
        for (const part of parts) {
          const cleaned = toOneLine(part, 220);
          if (cleaned) return cleaned;
        }
        return 'a practical next step for this activity';
      };
      const firstSentence = (text) => {
        const cleaned = toOneLine(text, 280);
        if (!cleaned) return '';
        const match = cleaned.match(/^[^.!?]+[.!?]?/);
        return toOneLine(match ? match[0] : cleaned, 180);
      };
      const buildChatbotModule = (moduleEntry) => {
        const moduleGoal = summarizeGoal(
          moduleEntry?.goal,
          moduleEntry?.purpose,
          moduleEntry?.prompt,
          bestSpec?.instruction,
          bestSpec?.evidence,
          focus,
          effectiveInterventionSteps[0],
          firstSentence(summary)
        );
        const firstAction = summarizeGoal(
          effectiveInterventionSteps[0],
          bestSpec?.steps?.[0],
          'take one small action right now'
        );
        return {
          ...moduleEntry,
          id: 'chatbot',
          persona:
            `You are the Activity Coach chatbot for this exercise. ` +
            `Your purpose is to help the user complete this goal: ${moduleGoal}. ` +
            'Be calm, practical, and concise, and always guide the user toward one concrete next action.',
          first_prompt:
            `Hi, I am your Activity Coach for this step. ` +
            `Today we will focus on this goal: ${moduleGoal}. ` +
            `Start with this first action: ${firstAction}. ` +
            'Reply when you complete it, and I will guide the next micro-step.',
          purpose: ensureString(moduleEntry?.purpose, `A short guided chat to complete this goal: ${moduleGoal}.`),
        };
      };
      const normalizeModule = (moduleEntry) => {
        if (typeof moduleEntry === 'string' && moduleEntry.trim()) {
          return { id: moduleEntry.trim() };
        }
        if (moduleEntry && typeof moduleEntry === 'object' && typeof moduleEntry.id === 'string' && moduleEntry.id.trim()) {
          const trimmedId = moduleEntry.id.trim();
          if (trimmedId.toLowerCase() === 'chatbot') {
            return buildChatbotModule(moduleEntry);
          }
          return { ...moduleEntry, id: trimmedId };
        }
        return null;
      };
      let safeModules = (() => {
        const mods = ensureArray(bestSpec?.modules).map(normalizeModule).filter(Boolean);
        if (mods.length) return mods;
        return defaultModules;
      })();
      const safeSpec = {
        title: ensureString(bestSpec?.title, 'Generated UX'),
        minutes: ensureNumber(bestSpec?.minutes, 3),
        evidence: ensureString(bestSpec?.evidence, 'One short note on what changed.'),
        instruction: ensureString(bestSpec?.instruction, summary),
        modules: safeModules,
        steps: ensureArray(bestSpec?.steps),
        explanation: ensureString(bestSpec?.explanation, 'Structured by UX planner.'),
        candidates: mergedCandidates,
      };
      let hasInteractive =
        Array.isArray(safeSpec.modules) &&
        safeSpec.modules.some((m) => interactiveIds.includes(typeof m?.id === 'string' ? m.id : ''));
      if (!hasInteractive) {
        const fallbackInteractiveModule = {
          id: 'timed_cues',
          purpose: 'Now follow a short guided sequence and notice what changes.',
        };
        safeModules = [...safeModules, fallbackInteractiveModule];
        safeSpec.modules = safeModules;
        hasInteractive = true;
        appendLog('api:stress-support:planner:repaired', {
          reason: 'no_interactive_element',
          added_module: fallbackInteractiveModule.id,
          modulesCount: safeSpec.modules.length,
        });
      }
      try {
        await sessionStore.recordUxPlannerResult(sessionId, {
          summary,
          focus,
          conversation,
          candidates: mergedCandidates,
          selected_index: selectedIndex,
          selected_spec: safeSpec,
          rubric: UX_FULL_RUBRIC,
          fallback_intervention: 0,
          generation_ms: Date.now() - startMs,
        });
      } catch (err) {
        console.error('Failed to persist UX planner result', err?.message || err);
      }
      appendLog('api:stress-support:planner:spec', {
        title: safeSpec.title,
        minutes: safeSpec.minutes,
        modulesCount: Array.isArray(safeSpec.modules) ? safeSpec.modules.length : 0,
        stepsCount: Array.isArray(safeSpec.steps) ? safeSpec.steps.length : 0,
        hasInteractive: hasInteractive || false,
        disable_ux_judge: disableUxJudge,
      });
      return res.json({
        sessionId,
        spec: safeSpec,
        source: disableUxJudge ? 'llm-planner-generate-only' : 'llm-planner-2step',
        fallback_intervention: 0,
        ux_judge_disabled: disableUxJudge,
        debug_log: disableUxJudge
          ? '[ux-planner] judge disabled; using single generated candidate'
          : `[ux-planner] scoring with UX_FULL_RUBRIC (${rubricKeys.length} criteria)`,
      });
      } catch (plannerErr) {
        if (plannerErr?.code !== 'UX_PLANNER_TIMEOUT') throw plannerErr;
        const fallbackSpec = buildPlannerTimeoutFallbackSpec();
        appendLog('api:stress-support:planner:fallback-timeout', {
          timeout_ms: UX_PLANNER_TIMEOUT_MS,
          stage: plannerErr?.stage || 'unknown',
        });
        try {
          await sessionStore.recordUxPlannerResult(sessionId, {
            summary,
            focus,
            conversation,
            candidates: [],
            selected_index: 0,
            selected_spec: fallbackSpec,
            rubric: UX_FULL_RUBRIC,
            fallback_intervention: 1,
            generation_ms: Date.now() - startMs,
          });
        } catch (persistErr) {
          console.error('Failed to persist UX planner timeout fallback', persistErr?.message || persistErr);
        }
        return res.json({
          sessionId,
          spec: fallbackSpec,
          source: 'timeout-fallback',
          fallback_intervention: 1,
          fallback_reason: 'planner_timeout',
          debug_log: '[ux-planner] fallback used after 4-minute timeout',
        });
      }
    }

    const isAudio = STRESS_AUDIO_FORMATS.includes(requestedFormats[0]);
  const isSlides = STRESS_SLIDE_FORMATS.includes(requestedFormats[0]);
  const isImage = STRESS_IMAGE_FORMATS.includes(requestedFormats[0]);
  const isStoryboard = STRESS_STORYBOARD_FORMATS.includes(requestedFormats[0]);
  const isTimer = STRESS_TIMER_FORMATS.includes(requestedFormats[0]);
  const isMotion = STRESS_MOTION_FORMATS.includes(requestedFormats[0]);
  const isDalleVideo = STRESS_DALLE_VIDEO_FORMATS.includes(requestedFormats[0]);
    appendLog('api:stress-support:intervention:llm', {
      summary_preview: summary.slice(0, 120),
      mediums: requestedFormats,
      isAudio,
      isSlides,
      isImage,
      isStoryboard,
      isTimer,
      isMotion,
      isDalleVideo,
    });

    const raw = await runChatCompletion(
      'stress-support-intervention',
      [
        {
          role: 'system',
          content: isAudio
            ? STRESS_INTERVENTION_PROMPT_AUDIO
            : isSlides
            ? STRESS_INTERVENTION_PROMPT_SLIDES
            : isStoryboard
            ? STRESS_INTERVENTION_PROMPT_STORYBOARD
            : isTimer
            ? STRESS_INTERVENTION_PROMPT_TIMED
            : isMotion
            ? STRESS_INTERVENTION_PROMPT_MOTION
            : isDalleVideo
            ? STRESS_INTERVENTION_PROMPT_DALLE_VIDEO
            : STRESS_INTERVENTION_PROMPT_IMAGE,
        },
        {
          role: 'user',
          content: JSON.stringify({
            summary,
            focus,
            minutes: 15,
            requested_format: requestedFormats[0],
          }),
        },
      ],
      { response_format: { type: 'json_object' }, model: STRESS_SUPPORT_MODEL, temperature: 0.7 }
    );

    appendLog('api:stress-support:intervention:llm:raw', {
      length: typeof raw === 'string' ? raw.length : null,
      preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
    });

    const parsed = safeParseJSON(raw) || {};
    const allowedAssetTypes = new Set(
      isAudio
        ? STRESS_ASSET_TYPES_AUDIO
        : isSlides
        ? STRESS_ASSET_TYPES_SLIDES
        : isStoryboard
        ? STRESS_ASSET_TYPES_STORYBOARD
        : isTimer
        ? STRESS_ASSET_TYPES_TIMER
        : isMotion
        ? STRESS_ASSET_TYPES_MOTION
        : isDalleVideo
        ? STRESS_ASSET_TYPES_VIDEO
        : STRESS_ASSET_TYPES_IMAGE
    );

    const normalizeStepIndex = (value) => {
      const num = Number(value);
      if (Number.isFinite(num) && (num === 1 || num === 2)) return num;
      return null;
    };

    const parsedStep =
      parsed.step && typeof parsed.step === 'object'
        ? parsed.step
        : (Array.isArray(parsed.steps) && parsed.steps[0]) || null;

    const buildStep = (raw = {}) => {
      const title =
        typeof raw.title === 'string' && raw.title.trim()
          ? raw.title.trim()
          : 'Step';
      const instruction =
        typeof raw.instruction === 'string' && raw.instruction.trim()
          ? raw.instruction.trim()
          : '';
      const minutes =
        typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) && raw.minutes > 0
          ? raw.minutes
          : undefined;
      const mode =
        typeof raw.medium === 'string' && raw.medium.trim()
          ? raw.medium.trim()
          : typeof raw.mode === 'string' && raw.mode.trim()
          ? raw.mode.trim()
          : undefined;
      if (!instruction) return null;
      const asset = raw.asset && typeof raw.asset === 'object' ? raw.asset : undefined;
      return { title, instruction, minutes, mode, asset };
    };

    const step = buildStep(parsedStep);
    const steps = step ? [step] : [];

    const parsedStepFormats = Array.isArray(parsed.step_formats)
      ? parsed.step_formats
          .map((fmt) => (typeof fmt === 'string' && STRESS_FORMATS.includes(fmt) ? fmt : null))
          .filter(Boolean)
          .slice(0, 1)
      : [];
    const stepFormats = parsedStepFormats.length === 1 ? parsedStepFormats : requestedFormats;

    const rawAssets = [];
    if (parsed.assets && Array.isArray(parsed.assets)) {
      rawAssets.push(...parsed.assets);
    }
    if (parsedStep?.asset && typeof parsedStep.asset === 'object') {
      rawAssets.push(parsedStep.asset);
    }
    if (Array.isArray(parsed.images)) {
      parsed.images.forEach((img) => {
        if (typeof img === 'string' && img.trim()) {
          rawAssets.push({ type: 'image', prompt: img.trim() });
        }
      });
    }

    // Extract image prompts embedded in slide/frame objects
    const extractedImages = [];
    const extractedPerSlide = [];
    const extractedPerFrame = [];
    const stepForAsset = normalizeStepIndex(parsedStep?.step) || 1;
    rawAssets.forEach((asset = {}) => {
      if (Array.isArray(asset.slides)) {
        asset.slides.forEach((s, idx) => {
          if (s && typeof s === 'object') {
            const ip = typeof s.image_prompt === 'string' && s.image_prompt.trim() ? s.image_prompt.trim() : null;
            const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '';
            const line = typeof s.line === 'string' && s.line.trim() ? s.line.trim() : '';
            const textPrompt = `${title || 'supportive card'} ${line || ''}`.trim();
            extractedPerSlide.push({ title, line, idx, image_prompt: ip || null, textPrompt });
            if (ip) extractedImages.push({ type: 'image', prompt: ip, content: ip, step: stepForAsset });
          }
        });
      }
      if (Array.isArray(asset.frames)) {
        asset.frames.forEach((f, idx) => {
          if (f && typeof f === 'object') {
            const ip = typeof f.image_prompt === 'string' && f.image_prompt.trim() ? f.image_prompt.trim() : null;
            const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim() : '';
            const line = typeof f.line === 'string' && f.line.trim() ? f.line.trim() : '';
            const textPrompt = `${title || 'supportive card'} ${line || ''}`.trim();
            extractedPerFrame.push({ title, line, idx, image_prompt: ip || null, textPrompt });
            if (ip) extractedImages.push({ type: 'image', prompt: ip, content: ip, step: stepForAsset });
          }
        });
      }
    });
    rawAssets.push(...extractedImages);

    let parsedAssets = rawAssets
      .map((asset = {}) => {
        const rawType = typeof asset.type === 'string' ? asset.type.trim() : '';
        let type = allowedAssetTypes.has(rawType) ? rawType : null;
        if (!type && rawType === 'audio_script') {
          type = 'audio';
        }
        if (!type && stepFormats[0]) {
          if (['short_audio'].includes(stepFormats[0])) {
            type = 'audio';
          } else if (stepFormats[0] === 'slides') {
            type = 'slide';
          } else if (stepFormats[0] === 'images') {
            type = 'image';
          } else if (stepFormats[0] === 'storyboard') {
            type = 'storyboard';
          } else if (stepFormats[0] === 'timed_cues') {
            type = 'timer';
          } else if (stepFormats[0] === 'calming_motion') {
            type = 'motion';
          } else if (stepFormats[0] === 'dalle_video') {
            type = 'video';
          }
        }
        const label =
          typeof asset.label === 'string' && asset.label.trim() ? asset.label.trim() : null;
        const slides = Array.isArray(asset.slides)
          ? asset.slides
              .map((s) => {
                if (typeof s === 'string' && s.trim()) return s.trim();
                if (s && typeof s === 'object') {
                  const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '';
                  const line = typeof s.line === 'string' && s.line.trim() ? s.line.trim() : '';
                  if (title || line) return [title, line].filter(Boolean).join('\n').trim();
                }
                return null;
              })
              .filter(Boolean)
              .slice(0, 4)
          : undefined;
        const frames = Array.isArray(asset.frames)
          ? asset.frames
              .map((s) => {
                if (typeof s === 'string' && s.trim()) return s.trim();
                if (s && typeof s === 'object') {
                  const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '';
                  const line = typeof s.line === 'string' && s.line.trim() ? s.line.trim() : '';
                  if (title || line) return [title, line].filter(Boolean).join('\n').trim();
                }
                return null;
              })
              .filter(Boolean)
              .slice(0, 4)
          : undefined;
        const content =
          typeof asset.content === 'string' && asset.content.trim()
            ? asset.content.trim()
            : null;
        const prompt =
          typeof asset.prompt === 'string' && asset.prompt.trim()
            ? asset.prompt.trim()
            : null;
        const audio_script =
          typeof asset.audio_script === 'string' && asset.audio_script.trim()
            ? asset.audio_script.trim()
            : null;
        const script =
          typeof asset.script === 'string' && asset.script.trim()
            ? asset.script.trim()
            : null;
        const timer_steps = Array.isArray(asset.timer_steps)
          ? asset.timer_steps
              .map((entry = {}) => {
                const label =
                  typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : null;
                const dur =
                  typeof entry.duration_seconds === 'number' &&
                  Number.isFinite(entry.duration_seconds) &&
                  entry.duration_seconds > 0
                    ? Math.round(entry.duration_seconds)
                    : null;
                if (!label && !dur) return null;
                return { label: label || undefined, duration_seconds: dur || undefined };
              })
              .filter(Boolean)
              .slice(0, 8)
          : undefined;
        const overlay =
          Array.isArray(asset.overlay) && asset.overlay.length
            ? asset.overlay
                .map((o) => (typeof o === 'string' && o.trim() ? o.trim() : null))
                .filter(Boolean)
                .slice(0, 4)
            : undefined;
        const prompts =
          Array.isArray(asset.prompts) && asset.prompts.length
            ? asset.prompts
                .map((p) => (typeof p === 'string' && p.trim() ? p.trim() : null))
                .filter(Boolean)
                .slice(0, 4)
            : undefined;
        const script_lines =
          Array.isArray(asset.script_lines) && asset.script_lines.length
            ? asset.script_lines
                .map((p) => (typeof p === 'string' && p.trim() ? p.trim() : null))
                .filter(Boolean)
                .slice(0, 4)
            : undefined;
        const slidesContent = Array.isArray(slides) && slides.length ? slides.join('\n') : null;
        const framesContent = Array.isArray(frames) && frames.length ? frames.join('\n') : null;
        let mainContent = content || audio_script || script || prompt || slidesContent || framesContent;
        if (!mainContent && timer_steps && timer_steps.length) {
          mainContent = timer_steps
            .map((t) => `${t.label || 'Step'} ${t.duration_seconds || ''}`.trim())
            .join('\n')
            .trim();
        }
        if (!mainContent && type === 'motion' && prompt) {
          mainContent = prompt;
        }
        if (!mainContent && type === 'video' && prompt) {
          mainContent = prompt;
        }
        if (!mainContent && type === 'video' && script_lines && script_lines.length) {
          mainContent = script_lines.join('\n');
        }
        if (!type || !mainContent) return null;
        const duration_seconds =
          typeof asset.duration_seconds === 'number' &&
          Number.isFinite(asset.duration_seconds) &&
          asset.duration_seconds > 0
            ? Math.round(asset.duration_seconds)
            : 60;
        const audio_tone =
          typeof asset.audio_tone === 'string' && asset.audio_tone.trim()
            ? asset.audio_tone.trim()
            : undefined;
        const voice_pitch =
          typeof asset.voice_pitch === 'number' && Number.isFinite(asset.voice_pitch)
            ? asset.voice_pitch
            : undefined;
        const voice_rate =
          typeof asset.voice_rate === 'number' && Number.isFinite(asset.voice_rate)
            ? asset.voice_rate
            : undefined;
        const music_prompt =
          typeof asset.music_prompt === 'string' && asset.music_prompt.trim()
            ? asset.music_prompt.trim()
            : undefined;
        const music_choice =
          typeof asset.music_choice === 'string' && asset.music_choice.trim()
            ? asset.music_choice.trim()
            : undefined;
        const explanation =
          typeof asset.explanation === 'string' && asset.explanation.trim()
            ? asset.explanation.trim()
            : undefined;
        const purpose =
          typeof asset.purpose === 'string' && asset.purpose.trim()
            ? asset.purpose.trim()
            : undefined;
        const step = normalizeStepIndex(asset.step) || 1;
        return {
          step,
          type,
          label: label || undefined,
          content: mainContent,
          prompt: prompt || undefined,
          duration_seconds,
          audio_tone,
          voice_pitch,
          voice_rate,
          music_prompt,
          music_choice,
          purpose,
          explanation,
          audio_script,
          slides,
          frames,
          timer_steps,
          overlay,
          prompts,
        };
      })
      .filter(Boolean)
      .slice(0, 3);

    // Log returned asset types for debugging
    appendLog('api:stress-support:assets', {
      isAudio,
      isSlides,
      isStoryboard,
      isImage,
      isTimer,
      assetTypes: parsedAssets.map((a) => a.type),
      imagePrompts: parsedAssets
        .filter((a) => a.type === 'image')
        .map((a) => a.prompt || a.content || '')
        .slice(0, 8),
      timerSteps: parsedAssets.find((a) => a.type === 'timer')?.timer_steps?.length || 0,
    });
    console.log('stress-support assets parsed', {
      isTimer,
      isMotion,
      isDalleVideo,
      assetTypes: parsedAssets.map((a) => a.type),
      timerSteps: parsedAssets.find((a) => a.type === 'timer')?.timer_steps?.length || 0,
      videoFrames: parsedAssets.find((a) => a.type === 'video')?.prompts?.length || 0,
    });

    if (isTimer) {
      const timerAsset = parsedAssets.find((a) => a.type === 'timer');
      const timerStepCount = timerAsset?.timer_steps?.length || 0;
      if (!timerAsset || timerStepCount === 0) {
        console.warn('stress-support timer missing timer_steps', {
          hasTimer: Boolean(timerAsset),
          timerStepCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : '',
        });
        appendLog('api:stress-support:timer:missing', {
          hasTimer: Boolean(timerAsset),
          timerStepCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : '',
        });
        return res.status(502).json({ error: 'LLM did not return timer steps', raw_preview: raw?.slice?.(0, 400) });
      }
      const hasAudioScript = typeof timerAsset.audio_script === 'string' && timerAsset.audio_script.trim();
      if (!hasAudioScript) {
        console.warn('stress-support timer missing audio_script', {
          hasTimer: Boolean(timerAsset),
          timerStepCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : '',
        });
        appendLog('api:stress-support:timer:missing_audio', {
          hasTimer: Boolean(timerAsset),
          timerStepCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : '',
        });
        return res.status(502).json({ error: 'LLM did not return an audio script for timer', raw_preview: raw?.slice?.(0, 400) });
      }
    }
    if (isMotion) {
      const motionAsset = parsedAssets.find((a) => a.type === 'motion');
      if (!motionAsset) {
        appendLog('api:stress-support:motion:missing', {
          raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
        });
        return res.status(502).json({ error: 'LLM did not return motion content', raw_preview: raw?.slice?.(0, 400) });
      }
    }
    if (isDalleVideo) {
      let videoAsset = parsedAssets.find((a) => a.type === 'video') || null;
      if (!videoAsset) {
        const parsedScript =
          (Array.isArray(parsed.step?.asset?.script_lines) && parsed.step.asset.script_lines) ||
          (Array.isArray(parsed.step?.script_lines) && parsed.step.script_lines) ||
          (Array.isArray(parsed.script_lines) && parsed.script_lines) ||
          [];
        const parsedPrompts =
          (Array.isArray(parsed.step?.asset?.prompts) && parsed.step.asset.prompts) ||
          (Array.isArray(parsed.step?.prompts) && parsed.step.prompts) ||
          (Array.isArray(parsed.prompts) && parsed.prompts) ||
          [];
        videoAsset = {
          type: 'video',
          script_lines: parsedScript.filter((s) => typeof s === 'string' && s.trim()).slice(0, 4),
          prompts: parsedPrompts.filter((p) => typeof p === 'string' && p.trim()).slice(0, 4),
          content:
            (typeof parsed.step?.asset?.script === 'string' && parsed.step.asset.script) ||
            (typeof parsed.step?.instruction === 'string' && parsed.step.instruction) ||
            summary ||
            '',
          duration_seconds: 60,
          explanation:
            (typeof parsed.step?.asset?.explanation === 'string' && parsed.step.asset.explanation) ||
            undefined,
        };
        parsedAssets.unshift(videoAsset);
      }
      const deriveScriptLines = () => {
        const sources = [
          videoAsset.script,
          videoAsset.content,
          parsedStep?.instruction,
          summary,
        ].filter((s) => typeof s === 'string' && s.trim());
        const base = sources[0] || '';
        const sentences = base
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 4);
        const beats = sentences.length
          ? sentences
          : [
              'Step 1: Pause and breathe deeply, letting your shoulders unclench.',
              'Step 2: Picture a calmer space where you can focus on one box at a time.',
              'Step 3: Notice one thing you can finish in the next few minutes.',
              'Step 4: Close with a slow exhale and thank yourself for the effort.',
            ];
        while (beats.length < 4) {
          beats.push(beats[beats.length - 1]);
        }
        return beats.slice(0, 4);
      };
      const derivePrompts = () => {
        const lines =
          (Array.isArray(videoAsset.script_lines) && videoAsset.script_lines.length
            ? videoAsset.script_lines
            : deriveScriptLines()) || [];
        const prompts = lines.map((line, idx) => {
          const base = typeof line === 'string' && line.trim() ? line.trim() : `Calming beat ${idx + 1}`;
          return `${base} — realistic, grounded setting, natural light, no abstract textures, no text or logos`;
        });
        while (prompts.length < 4) {
          prompts.push(prompts[prompts.length - 1] || 'Calming scene');
        }
        return prompts.slice(0, 4);
      };
      if (!Array.isArray(videoAsset.script_lines) || !videoAsset.script_lines.length) {
        videoAsset.script_lines = deriveScriptLines();
        appendLog('api:stress-support:video:derived_script', {
          derived: videoAsset.script_lines,
          source_preview: (videoAsset.content || videoAsset.script || parsedStep?.instruction || summary || '').slice(0, 160),
        });
      }
      if (!Array.isArray(videoAsset.prompts) || !videoAsset.prompts.length) {
        videoAsset.prompts = derivePrompts();
        appendLog('api:stress-support:video:derived_prompts', {
          derived: videoAsset.prompts,
          script_preview: (videoAsset.script_lines || []).slice(0, 2),
        });
      }
      appendLog('api:stress-support:video:parsed', {
        prompts: videoAsset.prompts || [],
        script_lines: videoAsset.script_lines || [],
      });
      const scriptCount = Array.isArray(videoAsset.script_lines) ? videoAsset.script_lines.length : 0;
      if (!scriptCount) {
        console.warn('stress-support video missing script lines', {
          scriptCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
        });
        appendLog('api:stress-support:video:invalid', {
          scriptCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
        });
        return res
          .status(502)
          .json({ error: 'LLM did not return script lines', raw_preview: raw?.slice?.(0, 400) });
      }
      if (scriptCount !== 4) {
        console.warn('stress-support video script lines not length 4; proceeding with truncation/pad', {
          scriptCount,
        });
        appendLog('api:stress-support:video:invalid_length', {
          scriptCount,
        });
        const normalized = (videoAsset.script_lines || [])
          .filter((line) => typeof line === 'string' && line.trim())
          .slice(0, 4);
        while (normalized.length < 4) {
          normalized.push(normalized[normalized.length - 1] || 'Step');
        }
        videoAsset.script_lines = normalized;
      }
      const promptCount = Array.isArray(videoAsset.prompts) ? videoAsset.prompts.length : 0;
      if (promptCount !== 4) {
        const normalizedPrompts = (videoAsset.prompts || [])
          .filter((p) => typeof p === 'string' && p.trim())
          .slice(0, 4);
        while (normalizedPrompts.length < 4) {
          normalizedPrompts.push(
            (videoAsset.script_lines && videoAsset.script_lines[normalizedPrompts.length]) ||
              normalizedPrompts[normalizedPrompts.length - 1] ||
              'Calming scene'
          );
        }
        videoAsset.prompts = normalizedPrompts;
        appendLog('api:stress-support:video:normalized_prompts', {
          promptCount,
          normalizedPrompts,
        });
      }
    }

    if (isStoryboard) {
      const hasStoryboard = parsedAssets.find((a) => a.type === 'storyboard');
      const frameCount =
        (hasStoryboard?.frames && Array.isArray(hasStoryboard.frames) && hasStoryboard.frames.length) ||
        (typeof hasStoryboard?.content === 'string' ? hasStoryboard.content.split(/\n+/).filter(Boolean).length : 0);
      if (!hasStoryboard || frameCount === 0) {
        appendLog('api:stress-support:storyboard:missing', {
          hasStoryboard: Boolean(hasStoryboard),
          frameCount,
          raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
        });
        return res.status(502).json({ error: 'LLM did not return storyboard frames', raw_preview: raw?.slice?.(0, 400) });
      }
      const imageAssets = parsedAssets.filter((a) => a.type === 'image');
      const normalizedFrames = Array.isArray(hasStoryboard.frames)
        ? hasStoryboard.frames.slice(0, 2)
        : [];
      const generatedImages = normalizedFrames.map((frame, idx) => {
        const textPrompt = typeof frame === 'string' ? frame : `${frame.title || 'card'} ${frame.line || ''}`.trim();
        const prompt = `${textPrompt} — abstract, textured, soft light, no faces, no text, fits behind overlay`;
        return { type: 'image', prompt, content: prompt, step: 1, idx };
      });
      parsedAssets.push(...generatedImages);
      // Deduplicate and cap to frame count
      const images = parsedAssets.filter((a) => a.type === 'image');
      const unique = [];
      const seen = new Set();
      images.forEach((img) => {
        const key = (img.prompt || img.content || '').toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (unique.length < normalizedFrames.length) {
          unique.push(img);
        }
      });
      parsedAssets = parsedAssets.filter((a) => a.type !== 'image');
      parsedAssets.push(...unique);
    }

    if (isSlides) {
      const hasSlide = parsedAssets.find((a) => a.type === 'slide');
      if (!hasSlide) {
        appendLog('api:stress-support:slides:missing', {
          hasSlide: Boolean(hasSlide),
          raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
        });
        return res.status(502).json({ error: 'LLM did not return slide content', raw_preview: raw?.slice?.(0, 400) });
      }
      const normalizedSlides = Array.isArray(hasSlide.slides)
        ? hasSlide.slides.slice(0, 3)
        : [];
      const generatedImages = normalizedSlides.map((slide, idx) => {
        const textPrompt = typeof slide === 'string' ? slide : `${slide.title || 'card'} ${slide.line || ''}`.trim();
        const prompt = `${textPrompt} — abstract, textured, soft light, no faces, no text, fits behind overlay`;
        return { type: 'image', prompt, content: prompt, step: 1, idx };
      });
      parsedAssets.push(...generatedImages);
      // Deduplicate and cap to slide count
      const images = parsedAssets.filter((a) => a.type === 'image');
      const unique = [];
      const seen = new Set();
      images.forEach((img) => {
        const key = (img.prompt || img.content || '').toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (unique.length < normalizedSlides.length) {
          unique.push(img);
        }
      });
      parsedAssets = parsedAssets.filter((a) => a.type !== 'image');
      parsedAssets.push(...unique);
    }

    if (steps.length !== 1 || stepFormats.length !== 1) {
      console.warn('stress-support invalid steps or mediums', {
        stepCount: steps.length,
        stepFormats: stepFormats.length,
        raw_preview: typeof raw === 'string' ? raw.slice(0, 200) : '',
      });
      return res.status(502).json({ error: 'LLM did not return one step with a medium', raw_preview: raw?.slice?.(0, 400) });
    }

    const primaryAsset = isAudio
      ? parsedAssets.find((a) => ['audio', 'music', 'ambient'].includes(a.type)) || parsedAssets[0] || null
      : isSlides
      ? parsedAssets.find((a) => a.type === 'slide') || parsedAssets[0] || null
      : isStoryboard
      ? parsedAssets.find((a) => a.type === 'storyboard') || parsedAssets[0] || null
      : isTimer
      ? parsedAssets.find((a) => a.type === 'timer') || parsedAssets[0] || null
      : isMotion
      ? parsedAssets.find((a) => a.type === 'motion') || parsedAssets[0] || null
      : isDalleVideo
      ? parsedAssets.find((a) => a.type === 'video') || parsedAssets[0] || null
      : parsedAssets.find((a) => a.type === 'image') || parsedAssets[0] || null;
    if (!primaryAsset || (!primaryAsset.content && (!primaryAsset.slides || primaryAsset.slides.length === 0))) {
      const reason = 'missing primary asset';
      console.warn('stress-support missing primary asset', {
        type: primaryAsset?.type,
        hasContent: Boolean(primaryAsset?.content),
        hasSlides: Boolean(primaryAsset?.slides?.length),
        raw_preview: typeof raw === 'string' ? raw.slice(0, 200) : '',
      });
      appendLog('api:stress-support:intervention:error', {
        message: reason,
        raw_preview: typeof raw === 'string' ? raw.slice(0, 400) : '',
      });
      return res.status(502).json({ error: 'LLM did not return a valid asset', raw_preview: raw?.slice?.(0, 400) });
    }

    const responsePayload = {
      title:
        (typeof parsed.title === 'string' && parsed.title.trim()) || 'Single-step support',
      focus:
        (typeof parsed.focus === 'string' && parsed.focus.trim()) || focus,
      duration_minutes:
        typeof parsed.duration_minutes === 'number' && parsed.duration_minutes > 0
          ? parsed.duration_minutes
          : 15,
      format:
        (typeof parsed.format === 'string' && parsed.format.trim()) ||
        'custom',
      step_formats: stepFormats,
      assets: parsedAssets,
      steps: steps.map((step, idx) => ({
        ...step,
        mode: step.mode || stepFormats[idx],
      })),
      wrap_up:
        (typeof parsed.wrap_up === 'string' && parsed.wrap_up.trim()) ||
        (typeof parsed.closing_note === 'string' && parsed.closing_note.trim()) ||
        '',
      encouragement:
        (typeof parsed.encouragement === 'string' && parsed.encouragement.trim()) ||
        (typeof parsed.closer === 'string' && parsed.closer.trim()) ||
        '',
      source: 'llm',
    };

    appendLog('api:stress-support:intervention:res', {
      step_count: responsePayload.steps?.length || 0,
      duration: responsePayload.duration_minutes,
    });
    return res.json(responsePayload);
  } catch (err) {
    const detail = err?.response?.data || err?.message || err;
    console.error('OpenAI /dev/stress-support/intervention error', detail);
    appendLog('api:stress-support:intervention:error', {
      message: err?.message || String(err),
      detail,
    });
    return res.status(502).json({ error: 'Intervention generation failed', detail });
  }

  return res.status(502).json({ error: 'Intervention generation failed with no detail' });
});

app.post('/dev/media/image', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const size = typeof req.body?.size === 'string' ? req.body.size.trim() : '1024x1024';
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;
  const quality = typeof req.body?.quality === 'string' ? req.body.quality.trim() : undefined;
  const response_format =
    req.body?.response_format === 'b64_json' ? 'b64_json' : 'url';

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  appendLog('api:media:image:req', { prompt: prompt.slice(0, 160), size, response_format, model, quality });

  try {
    const image = await generateImage(prompt, {
      size,
      response_format,
      model: model || undefined,
      quality: quality || undefined,
    });
    let cached_url = null;
    try {
      if (image.b64_json) {
        cached_url = await cacheImageFromB64(image.b64_json);
      } else if (image.url) {
        cached_url = await cacheImageFromUrl(image.url);
      }
    } catch (err) {
      console.warn('image cache failed', err?.message || err);
    }
    appendLog('api:media:image:res', {
      hasUrl: Boolean(image.url),
      hasB64: Boolean(image.b64_json),
      cached: Boolean(cached_url),
    });
    return res.json({ prompt, ...image, cached_url });
  } catch (err) {
    console.error('image generation failed', err?.response?.data || err?.message || err);
    const detail = err?.response?.data || err?.message || String(err);
    appendLog('api:media:image:error', { message: detail });
    return res.status(502).json({ error: 'image generation failed', detail });
  }
});

app.get('/media/cache/:file', (req, res) => {
  const file = String(req.params?.file || '').trim();
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    return res.status(400).send('invalid file');
  }
  const filePath = getMediaCachePath(file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('not found');
  }
  return res.sendFile(filePath);
});

app.post('/dev/media/image-prompt', async (req, res) => {
  const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';
  if (!summary) {
    return res.status(400).json({ error: 'summary is required' });
  }
  appendLog('api:media:image-prompt:req', { summary: summary.slice(0, 160) });
  try {
    const raw = await runChatCompletion(
      'summary-image-prompt',
      [
        {
          role: 'system',
          content:
            'Create a single image prompt from the user summary for a background card. Reflect the user’s environment and situation (e.g., desk, kitchen, commute, couch, office) with concrete, real-world objects and a clear focal point. Avoid abstract textures, blur, or haze. No faces/people and no text/logos. Return JSON only: { "prompt": "2-4 sentences", "alt": "1 plain sentence" }.'
        },
        { role: 'user', content: summary }
      ],
      {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'summary_image_prompt',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['prompt', 'alt'],
              properties: {
                prompt: { type: 'string', minLength: 20 },
                alt: { type: 'string', minLength: 8 },
              }
            }
          }
        },
        model: 'gpt-4.1',
      }
    );
    const parsed = safeParseJSON(raw);
    const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
    const alt = typeof parsed?.alt === 'string' ? parsed.alt.trim() : '';
    if (!prompt) {
      throw new Error('image prompt empty');
    }
    appendLog('api:media:image-prompt:res', { hasPrompt: Boolean(prompt) });
    return res.json({ prompt, alt });
  } catch (err) {
    console.error('image prompt generation failed', err?.response?.data || err?.message || err);
    const detail = err?.response?.data || err?.message || String(err);
    appendLog('api:media:image-prompt:error', { message: detail });
    return res.status(502).json({ error: 'image prompt generation failed', detail });
  }
});

app.post('/dev/media/tts', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const requestedUseGptVoice =
    typeof req.body?.use_gpt_voice === 'boolean' ? req.body.use_gpt_voice : undefined;
  const useGptVoice = true;
  const styleHint = typeof req.body?.style === 'string' ? req.body.style.trim() : '';

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  // Default fallback settings
  let voice = typeof req.body?.voice === 'string' && req.body.voice.trim() ? req.body.voice.trim() : 'alloy';
  let speed =
    typeof req.body?.speed === 'number' && Number.isFinite(req.body.speed) && req.body.speed > 0
      ? Math.min(1.3, Math.max(0.7, req.body.speed))
      : 1;
  let chosenStyle = styleHint || '';

  // Let GPT pick the voice/tone when requested
  if (useGptVoice) {
    try {
      const prompt = {
        summary: text.slice(0, 1600),
        style_hint: styleHint || 'Choose a voice, pace, and tone that feel supportive and natural for this summary.',
        voices: ['alloy', 'verse', 'shimmer', 'echo', 'nova', 'fable'],
        rules: [
          'Return concise JSON with voice (one of voices), speed (0.7-1.3), style (one phrase).',
          'Prefer calmer pacing for heavy or reflective summaries; quicker for energizing ones.',
          'Voice must be one of the listed options.',
        ],
      };
      const raw = await runChatCompletion(
        'tts-voice-selector',
        [
          {
            role: 'system',
            content:
              'You pick voice and pacing for TTS playback. Stay concise. Output JSON: {"voice":"alloy","speed":1.0,"style":"warm peer tone"}.',
          },
          { role: 'user', content: JSON.stringify(prompt) },
        ],
        { response_format: { type: 'json_object' }, model: INTERVENTION_MODEL, temperature: 0.4 }
      );
      const parsed = safeParseJSON(raw) || {};
      const candidateVoice =
        typeof parsed.voice === 'string' && parsed.voice.trim() ? parsed.voice.trim() : voice;
      const candidateSpeed =
        typeof parsed.speed === 'number' && Number.isFinite(parsed.speed)
          ? Math.min(1.3, Math.max(0.7, parsed.speed))
          : speed;
      const candidateStyle = typeof parsed.style === 'string' ? parsed.style.trim() : '';
      if (['alloy', 'verse', 'shimmer', 'echo', 'nova', 'fable'].includes(candidateVoice)) {
        voice = candidateVoice;
      }
      speed = candidateSpeed;
      if (candidateStyle) {
        chosenStyle = candidateStyle;
      }
      appendLog('api:media:tts:selection', {
        voice,
        speed,
        style: chosenStyle,
        source: 'gpt',
        promptPreview: prompt.summary.slice(0, 120),
      });
    } catch (err) {
      console.warn('tts voice selection failed; falling back', err?.message || err);
      appendLog('api:media:tts:selection:error', {
        message: err?.message || String(err),
        fallbackVoice: voice,
        fallbackSpeed: speed,
        style: chosenStyle,
      });
    }
  }

  appendLog('api:media:tts:req', {
    voice,
    speed,
    preview: text.slice(0, 80),
    style: chosenStyle,
    usedGptVoice: useGptVoice,
    requestedUseGptVoice,
  });
  appendLog('api:media:tts:voice-source', {
    source: 'gpt',
    voice,
    speed,
    style: chosenStyle,
    requestedUseGptVoice,
  });

  const estimateSpeechDurationSeconds = (content, rate = 1) => {
    const words = String(content || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (!words) return null;
    // Conservative conversational baseline ~=150 wpm, adjusted by playback speed.
    const adjustedWpm = Math.max(90, Math.min(240, 150 * (Number.isFinite(rate) ? rate : 1)));
    const seconds = (words / adjustedWpm) * 60;
    return Math.max(3, Math.round(seconds));
  };

  try {
    const audio = await synthesizeSpeech(text, { voice, speed, format: 'mp3' });
    const durationSeconds = estimateSpeechDurationSeconds(text, speed);
    appendLog('api:media:tts:res', {
      length: audio.base64?.length || 0,
      voice,
      speed,
      style: chosenStyle,
      duration_seconds: durationSeconds,
      usedGptVoice: useGptVoice,
    });
    return res.json({
      audio_url: audio.url,
      voice,
      speed,
      style: chosenStyle,
      duration_seconds: durationSeconds,
      used_gpt_voice: true,
      voice_source: 'gpt',
      tts_api_version: 'source-tag-v1',
    });
  } catch (err) {
    console.error('tts generation failed', err?.response?.data || err?.message || err);
    appendLog('api:media:tts:error', {
      message: err?.message || String(err),
      voice,
      speed,
      style: chosenStyle,
      usedGptVoice: useGptVoice,
    });
    return res.status(502).json({ error: 'tts generation failed' });
  }
});

app.post(
  '/dev/media/transcribe',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '12mb' }),
  async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || !buffer.length) {
      return res.status(400).json({ error: 'audio payload is required' });
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const extension = contentType.includes('wav')
      ? 'wav'
      : contentType.includes('mpeg') || contentType.includes('mp3')
      ? 'mp3'
      : contentType.includes('mp4')
      ? 'mp4'
      : contentType.includes('ogg')
      ? 'ogg'
      : 'webm';

    const tmpPath = path.join(
      os.tmpdir(),
      `voice-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
    );

    try {
      await fs.promises.writeFile(tmpPath, buffer);
      const transcription = await client.audio.transcriptions.create({
        model: 'gpt-4o-mini-transcribe',
        file: fs.createReadStream(tmpPath),
      });
      const text = typeof transcription?.text === 'string' ? transcription.text.trim() : '';
      return res.json({ text });
    } catch (err) {
      console.error('transcription failed', err?.response?.data || err?.message || err);
      return res.status(502).json({ error: 'transcription failed' });
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {});
    }
  }
);

app.post('/dev/intervention-lab/blocks', async (req, res) => {
  const idea = typeof req.body?.idea === 'string' ? req.body.idea.trim() : '';

  if (!idea) {
    return res.status(400).json({ error: 'idea text is required' });
  }

  try {
    const payload = { idea };

    const raw = await runChatCompletion(
      'lab-block-plan',
      [
        { role: 'system', content: LAB_BLOCK_GENERATION_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      { response_format: { type: 'json_object' }, model: INTERVENTION_MODEL }
    );

    const parsed = safeParseJSON(raw);
    if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
      console.warn('Intervention lab LLM returned no blocks', raw?.slice?.(0, 200));
      return res.status(502).json({ error: 'LLM did not return any blocks', raw });
    }

    const normalizedBlocks = parsed.blocks.map((block = {}, index) => {
      const rawType = typeof block.type === 'string' ? block.type : 'instruction';
      const type = LAB_BLOCK_TYPES.includes(rawType) ? rawType : 'instruction';
      const title = typeof block.title === 'string' && block.title.trim()
        ? block.title.trim()
        : `Block ${index + 1}`;
      const prompt = typeof block.prompt === 'string' && block.prompt.trim()
        ? block.prompt.trim()
        : `Stay with the activity inspired by "${idea}".`;

      const entry = {
        type,
        title,
        prompt,
      };

      if (typeof block.subtitle === 'string' && block.subtitle.trim()) {
        entry.subtitle = block.subtitle.trim();
      }

      if (Array.isArray(block.details)) {
        const details = block.details
          .filter((detail) => typeof detail === 'string' && detail.trim())
          .map((detail) => detail.trim())
          .slice(0, 6);
        if (details.length > 0) {
          entry.details = details;
        }
      }

      if (Array.isArray(block.steps)) {
        const steps = block.steps
          .filter((step) => typeof step === 'string' && step.trim())
          .map((step) => step.trim())
          .slice(0, 8);
        if (steps.length > 0) {
          entry.steps = steps;
        }
      }

      if (typeof block.minutes === 'number' && Number.isFinite(block.minutes) && block.minutes > 0) {
        entry.minutes = block.minutes;
      }

      return entry;
    });

    res.json({
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
      layer_type: parsed.layer_type === 'experiential' ? 'experiential' : 'cognitive',
      blocks: normalizedBlocks,
    });
  } catch (err) {
    console.error('OpenAI /dev/intervention-lab/blocks error', err?.response?.data || err?.message || err);
    res.status(502).json({ error: 'Lab block generation failed', detail: err?.message || String(err) });
  }
});

app.post('/layered-intervention', async (req, res) => {
  const { intro, steps, summary, sessionId: rawSessionId } = req.body || {};
  const stepsArray = Array.isArray(steps) ? steps : [];
  const sessionId = await resolveSessionId(rawSessionId);
  const disableInterventionJudge = parseBooleanFlag(req.body?.disable_intervention_judge);
  const baseLogMeta = {
    sessionId,
    introPreview: (intro || '').replace(/\s+/g, ' ').slice(0, 160),
    stepCount: stepsArray.length,
    hasSummary: Boolean(summary && String(summary).trim()),
    disable_intervention_judge: disableInterventionJudge,
  };

  let conversationTranscript = '';
  let conversationSource = 'none';
  if (sessionId) {
    try {
      const sessionData = await sessionStore.getSession(sessionId);
      conversationTranscript = buildConversationTranscriptFromMessages(sessionData?.messages);
      if (conversationTranscript) {
        conversationSource = 'messages';
      }
    } catch (err) {
      console.warn('Failed to load session conversation transcript', err?.message || err);
    }
  }
  if (!conversationTranscript) {
    conversationTranscript = buildConversationTranscriptFromSteps(stepsArray);
    if (conversationTranscript) {
      conversationSource = conversationSource === 'none' ? 'steps' : `${conversationSource}+steps`;
    }
  }

  appendLog('api:layered-intervention:req', {
    ...baseLogMeta,
    conversation_source: conversationSource,
    conversation_chars: conversationTranscript.length,
  });
  const startMs = Date.now();

  try {
    const payload = {
      intro: intro || '',
      summary: summary || '',
      conversation_transcript: conversationTranscript || '',
    };

    if (USE_LAYERED_INTERVENTION_V2) {
      const start = Date.now();
      const v2Payload = await runLayeredInterventionV2({
        ...payload,
        steps: stepsArray,
        sessionId,
        disableInterventionJudge,
      });
      await persistLayeredInterventionResult(sessionId, {
        ...v2Payload,
        generation_ms: Date.now() - start,
      });
      appendLog('api:layered-intervention:res', {
        sessionId,
        selected_ids: v2Payload?.selected_combination_id
          ? { combination: v2Payload.selected_combination_id }
          : v2Payload?.selected_ids,
        total_duration: v2Payload?.total_duration_minutes,
        mode: 'v2',
      });
      return res.json({ sessionId, ...v2Payload });
    }

    console.log('[layered:v1] starting candidate generation');
    appendLog('api:layered-intervention:cognitive:start', {
      mode: 'v1',
    });
    appendLog('api:layered-intervention:experiential:start', {
      mode: 'v1',
    });

    const [cogRaw, expRaw] = await Promise.all([
      runChatCompletion(
        'layered-cognitive-candidates',
        [
          { role: 'system', content: LAYERED_COGNITIVE_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'cognitive_candidates',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['reasoning', 'candidates'],
                properties: {
                  reasoning: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: { type: 'string', minLength: 16 },
                  },
                  candidates: LAYERED_CANDIDATE_SCHEMA(
                    COGNITIVE_LAYER_RUBRIC.map((item) => item.key),
                    'cog'
                  ),
                },
              },
            },
          },
          model: INTERVENTION_MODEL,
        }
      ),
      runChatCompletion(
        'layered-experiential-candidates',
        [
          { role: 'system', content: LAYERED_EXPERIENTIAL_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'experiential_candidates',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['reasoning', 'candidates'],
                properties: {
                  reasoning: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: { type: 'string', minLength: 16 },
                  },
                  candidates: LAYERED_CANDIDATE_SCHEMA(
                    EXPERIENTIAL_LAYER_RUBRIC.map((item) => item.key),
                    'exp'
                  ),
                },
              },
            },
          },
          model: INTERVENTION_MODEL,
        }
      ),
    ]);

    const cogParsed = safeParseJSON(cogRaw);
    const expParsed = safeParseJSON(expRaw);
    if (!cogParsed?.candidates || !expParsed?.candidates) {
      appendLog('api:layered-intervention:candidate-invalid', {
        cog: cogRaw?.slice?.(0, 200),
        exp: expRaw?.slice?.(0, 200),
      });
      return res.status(502).json({ error: 'Candidate generation failed', raw: { cog: cogRaw, exp: expRaw } });
    }

    appendLog('api:layered-intervention:cognitive:complete', {
      mode: 'v1',
      count: Array.isArray(cogParsed?.candidates) ? cogParsed.candidates.length : 0,
    });
    appendLog('api:layered-intervention:experiential:complete', {
      mode: 'v1',
      count: Array.isArray(expParsed?.candidates) ? expParsed.candidates.length : 0,
    });

    const selectionPayload = {
      ...payload,
      cognitive_candidates: cogParsed.candidates,
      experiential_candidates: expParsed.candidates,
      integration_rubric: INTEGRATION_RUBRIC,
    };

    console.log('[layered:v1] starting selection synthesis');
    appendLog('api:layered-intervention:selection:start', {
      mode: 'v1',
      cognitiveCount: Array.isArray(cogParsed?.candidates) ? cogParsed.candidates.length : 0,
      experientialCount: Array.isArray(expParsed?.candidates) ? expParsed.candidates.length : 0,
    });

    const selectionRaw = await runChatCompletion(
      'layered-selection',
      [
        { role: 'system', content: LAYERED_SELECTION_PROMPT },
        { role: 'user', content: JSON.stringify(selectionPayload) }
      ],
      {
        response_format: { type: 'json_schema', json_schema: LAYERED_PLAN_SCHEMA },
        model: INTERVENTION_MODEL,
      }
    );

    const finalParsed = safeParseJSON(selectionRaw);
    if (!finalParsed) {
      appendLog('api:layered-intervention:selection-invalid', { raw: selectionRaw?.slice?.(0, 200) });
      return res.status(502).json({ error: 'Layered selection failed', raw: selectionRaw });
    }
    const contextSnippet = buildContextSnippet({ intro, summary, conversation: conversationTranscript });
    await personalizePlanCopy(finalParsed, contextSnippet);

    const responsePayload = {
      ...finalParsed,
      cognitive_reasoning: Array.isArray(cogParsed?.reasoning) ? cogParsed.reasoning : [],
      experiential_reasoning: Array.isArray(expParsed?.reasoning) ? expParsed.reasoning : [],
      cognitive_candidates: cogParsed.candidates,
      experiential_candidates: expParsed.candidates,
      cognitive_rubric: COGNITIVE_LAYER_RUBRIC,
      experiential_rubric: EXPERIENTIAL_LAYER_RUBRIC,
      integration_rubric: INTEGRATION_RUBRIC,
    };

    appendLog('api:layered-intervention:selection:complete', {
      sessionId,
      mode: 'v1',
      cognitiveSelected: responsePayload?.selected_ids?.cognitive || null,
      experientialSelected: responsePayload?.selected_ids?.experiential || null,
    });

    appendLog('api:layered-intervention:res', {
      sessionId,
      selected_ids: responsePayload?.selected_ids,
      total_duration: responsePayload?.total_duration_minutes,
    });
    const generationMs = Date.now() - startMs;
    await persistLayeredInterventionResult(sessionId, {
      ...responsePayload,
      generation_ms: generationMs,
    });
    res.json({ sessionId, ...responsePayload });
  } catch (err) {
    console.error('OpenAI /layered-intervention error', err?.response?.data || err?.message || err);
    appendLog('api:layered-intervention:error', {
      detail: err?.response?.data || err?.message || String(err)
    });
    return res.status(502).json({
      error: 'Layered intervention generation failed',
      detail: err?.response?.data || err?.message || 'Unknown error',
    });
  }
});

app.post('/layered-intervention/details', async (req, res) => {
  const body = req.body || {};
  const payload = {
    plan_title: String(body.plan_title || '').trim(),
    summary_recap: String(body.summary_recap || '').trim(),
    coherence_notes: String(body.coherence_notes || '').trim(),
    planning_reasoning: ensureArray(body.planning_reasoning)
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(0, 5),
    why_matters: String(body.why_matters || '').trim(),
    why_feels_good: String(body.why_feels_good || '').trim(),
    source_summaries: ensureArray(body.source_summaries)
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(0, 5),
  };
  try {
    const raw = await runChatCompletion(
      'layered-detail',
      [
        { role: 'system', content: LAYERED_DETAIL_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      { response_format: { type: 'json_object' }, model: INTERVENTION_MODEL }
    );
    const parsed = safeParseJSON(raw) || {};
    const friendlyCopy = String(parsed.friendly_copy || '').trim();
    if (!friendlyCopy) {
      throw new Error('LLM did not return friendly_copy text.');
    }
    res.json({ friendly_copy: friendlyCopy });
  } catch (err) {
    console.error('Layered detail rewrite error', err?.message || err);
    res.status(502).json({
      error: 'Could not rewrite layered detail',
      detail: err?.message || String(err),
    });
  }
});

const ACK_STYLE_HINTS = [
  'Thank-you acknowledgement (≤10 words): brief appreciation, then move forward.',
  'Grounded acknowledgement (≤15 words): name one concrete element they mentioned.',
  'Emotion mirroring (≤15 words): reflect the feeling without amplifying it.',
  'Experience normalization (≤15 words): gently signal that such reactions are common.',
  'Effort recognition (≤12 words): acknowledge the effort it took to share.',
  'Clarity reflection (≤15 words): restate their core point in simpler terms.',
  'Pattern noticing (≤15 words): highlight a theme across what they said.',
  'Shift acknowledgement (≤12 words): note a change in tone or perspective.',
  'Momentum acknowledgement (≤12 words): affirm forward movement in their thinking.',
  'Uncertainty validation (≤15 words): acknowledge that not knowing is okay. Use only if the user explicitly states uncertainty (e.g., “I don’t know,” “I’m not sure,” “unknown”).',
  'Ambivalence reflection (≤15 words): reflect mixed feelings without resolving them.',
  'Question-responsive acknowledgement (≤15 words): briefly answer or reframe their question before continuing.',
  'Pause-friendly acknowledgement (≤12 words): validate hesitation without pressure.',
  'Scope clarification (≤15 words): gently narrow or organize what they shared.',
  'Containment acknowledgement (≤15 words): signal steadiness when content feels intense.'
];

const BRIDGE_HINTS = [
  'Casual bridge: short “let’s” phrasing, under 12 words.',
  'Natural continuation: connect their last sentence to the next step.',
  'Forward-looking bridge: signal gentle movement ahead.',
  'Curious bridge: phrase next step as a natural question.',
  'Energy-matching bridge: mirror their pace before shifting.',
  'Clarity bridge: summarize briefly, then introduce next focus.',
  'Zoom-in bridge: narrow attention to one specific piece.',
  'Zoom-out bridge: widen perspective before next prompt.',
  'Choice-based bridge: offer two small directions to explore.',
  'Soft transition: low-pressure wording before new prompt.',
  'Stuck-aware bridge: if unsure, offer a simpler starting point.',
  'Uncertainty bridge: suggest exploring even without full clarity.',
  'Question-answer bridge: respond briefly, then pivot.',
  'Reassuring bridge: reduce pressure before next reflection.',
  'Momentum bridge: build on something they already identified.'
];

app.post('/acknowledge', async (req, res) => {
  const body = req.body || {};
  const step = body.step || null;
  const answer = body.answer;
  const decision = body.decision;
  const followUpFocus = body.followUpFocus ?? body.follow_up_focus ?? '';
  const introSummary = body.introSummary ?? body.intro_summary ?? '';
  const previousSteps = body.previousSteps ?? body.previous_steps ?? [];
  const nextStep = body.nextStep ?? body.next_step ?? null;
  const stepNumber = body.stepNumber ?? body.step_number ?? 0;
  const totalSteps = body.totalSteps ?? body.total_steps ?? 0;
  const isFollowUp = body.isFollowUp ?? body.is_follow_up ?? false;
  const sessionId = await resolveSessionId(body.sessionId);

  console.log('[api:acknowledge] incoming payload', {
    sessionId,
    stepId: step?.id,
    decision,
    nextStepTitle: nextStep?.title || null
  });
  appendLog('api:acknowledge:req', {
    sessionId,
    stepId: step?.id || null,
    decision,
    followUpFocus,
    nextStepTitle: nextStep?.title || null
  });

  if (!step?.prompt || !answer || !decision) {
    appendLog('api:acknowledge:error', {
      reason: 'missing data',
      stepId: step?.id || null
    });
    return res.status(400).json({ sessionId, error: 'step, answer, and decision are required' });
  }

  try {
    const normalizedPreviousSteps = (previousSteps || []).map((item) => ({
      id: item?.id ?? null,
      title: item?.title ?? null,
      answers: item?.answers ?? [],
      follow_ups: item?.followUps ?? item?.follow_ups ?? [],
    }));

    const numericStep = Number(stepNumber) || 0;
    const styleHint =
      ACK_STYLE_HINTS.length > 0
        ? ACK_STYLE_HINTS[Math.abs(numericStep + Math.floor(Math.random() * 1000)) % ACK_STYLE_HINTS.length]
        : '';
    const bridgeHint =
      BRIDGE_HINTS.length > 0
        ? BRIDGE_HINTS[Math.abs(numericStep + Math.floor(Math.random() * 2000)) % BRIDGE_HINTS.length]
        : '';
    const payload = {
      decision,
      follow_up_focus: followUpFocus,
      step,
      next_step: nextStep,
      answer,
      intro_summary: introSummary,
      previous_steps: normalizedPreviousSteps,
      step_number: stepNumber,
      total_steps: totalSteps,
      is_follow_up: isFollowUp,
      style_hint: styleHint,
      bridge_hint: bridgeHint,
    };

    const raw = await runChatCompletion(
      'acknowledge',
      [
        {
          role: 'system',
          content: ACKNOWLEDGMENT_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      { response_format: { type: 'json_object' }, model: CONVERSATION_MODEL }
    );

    const parsed = safeParseJSON(raw) || {};
    appendLog('api:acknowledge:res', { sessionId, ...parsed });

    const message = parsed.message || 'Thank you for sharing.';
    const followUpQuestion = parsed.follow_up_question || '';
    await recordAssistantResponse(sessionId, message, followUpQuestion);

    res.json({
      sessionId,
      message,
      follow_up_question: followUpQuestion
    });
  } catch (err) {
    console.error('OpenAI /acknowledge error', err?.response?.data || err?.message || err);
    appendLog('api:acknowledge:error', {
      sessionId,
      detail: err?.response?.data || err?.message || String(err)
    });
    const fallbackMessage = 'Thank you for sharing. Let’s keep going together.';
    await recordAssistantResponse(sessionId, fallbackMessage, '');
    res.status(200).json({
      sessionId,
      message: fallbackMessage,
      follow_up_question: ''
    });
  }
});

app.post('/intervention', async (req, res) => {
  const { intro, steps, sessionId: rawSessionId } = req.body || {};
  const sessionId = await resolveSessionId(rawSessionId);
  const startMs = Date.now();
  appendLog('api:intervention:req', {
    sessionId,
    introPreview: (intro || '').replace(/\s+/g, ' ').slice(0, 160),
    stepCount: Array.isArray(steps) ? steps.length : 0
  });

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ sessionId, error: 'steps array is required' });
  }

  try {
    const generatedCandidates = [];
    for (let idx = 0; idx < CANDIDATE_TARGET_COUNT; idx += 1) {
      const candidate = await requestCandidatePlan({
        intro: intro || '',
        steps,
        existingCandidates: generatedCandidates,
        slotIndex: idx,
      });
      generatedCandidates.push(candidate);
    }

    appendLog('api:intervention:candidates', {
      sessionId,
      candidateCount: generatedCandidates.length,
      planIds: generatedCandidates.map((c) => c?.plan_id).filter(Boolean),
    });

    const finalPlan = await requestFinalPlan({
      intro: intro || '',
      steps,
      candidates: generatedCandidates,
    });

    const responsePayload = {
      ...finalPlan,
      candidates: generatedCandidates,
      candidate_rubric: CANDIDATE_RUBRIC,
      selection_rubric: SELECTION_RUBRIC,
    };

    appendLog('api:intervention:final', {
      sessionId,
      plan_title: responsePayload.plan_title,
      source_plan_ids: responsePayload.source_plan_ids,
      scores: responsePayload.scores,
    });

    try {
      const generationMs = Date.now() - startMs;
      const candidatesForDb = generatedCandidates.map((candidate, index) => ({
        ...candidate,
        layer: 'blended',
        candidate_id: candidate?.candidate_id || candidate?.plan_id || `candidate_${index + 1}`,
        candidate_index: index,
        raw: candidate,
      }));
      await sessionStore.recordInterventionResult(sessionId, {
        ...responsePayload,
        candidates: candidatesForDb,
        generation_ms: generationMs,
      });
      appendLog('db:intervention:persisted', {
        sessionId,
        generation_ms: generationMs,
        candidateCount: generatedCandidates.length,
      });
    } catch (err) {
      console.error('Failed to persist intervention result', err?.message || err);
    }

    res.json({ sessionId, ...responsePayload });
  } catch (err) {
    console.error('OpenAI /intervention error', err?.response?.data || err?.message || err);
    appendLog('api:intervention:error', { sessionId, detail: err?.response?.data || err?.message || String(err) });
    res.status(200).json({
      sessionId,
      plan_title: 'Twenty-Minute Reset',
      summary: 'Spend about twenty minutes grounding, clarifying what matters, and lining up a supportive follow-through.',
      activities: [
        {
          label: '6 min — Settle Your Breath',
          description: 'Sit or stand comfortably, place a hand on your chest, and let each exhale be a little longer than the inhale.',
          duration_minutes: 6
        },
        {
          label: '7 min — Capture What Matters',
          description: 'Journal a few sentences about the trigger, what it stirred up, and what you’d like to feel or remember moving forward.',
          duration_minutes: 7
        },
        {
          label: '7 min — Commit to a Gentle Next Step',
          description: 'List one thing you can do in the next day that supports you, then schedule or message the person involved so it’s real.',
          duration_minutes: 7
        }
      ],
      selection_reasoning: 'Fallback plan generated locally after the decision service was unavailable. Focuses on grounding, reflection, and a gentle action that align with common themes.',
      source_plan_ids: [],
      candidates: [],
      error: err?.response?.data || err?.message || 'Intervention generation failed',
      candidate_rubric: CANDIDATE_RUBRIC,
      selection_rubric: SELECTION_RUBRIC
    });
  }
});

app.post('/ui-spec', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const minutesRaw = req.body?.minutes;
  const minutes =
    typeof minutesRaw === 'number' && Number.isFinite(minutesRaw) && minutesRaw > 0
      ? Math.round(minutesRaw)
      : null;

  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }

  const userPrompt = [
    title ? `Title: ${title}` : null,
    `Description: ${description}`,
    minutes ? `Target duration: about ${minutes} minutes.` : null,
    'Design a concrete, in-app flow (not just text boxes). Include:',
    '- A brief framing/why-it-matters;',
    '- 2–4 micro-prompts or actions (chips, buttons, timers, short fields);',
    '- A visible progress cue;',
    '- A short close-out with a next-step nudge.',
    'Keep it concise and warm. Return plain text with clear labels and bullet points.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const spec = await runChatCompletion(
      'ui-spec',
      [
        {
          role: 'system',
          content:
            'You design short UI flows for reflective steps. Be specific about elements (chips, buttons, timers, sliders) and pacing. Keep it friendly and concise.',
        },
        { role: 'user', content: userPrompt },
      ],
      { model: DEFAULT_LLM_MODEL, temperature: 0.5, max_tokens: 400 }
    );
    res.json({ spec: (spec || '').trim() });
  } catch (err) {
    console.error('ui-spec error', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'ui-spec failed' });
  }
});

app.post('/ui-story', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const minutesRaw = req.body?.minutes;
  const minutes =
    typeof minutesRaw === 'number' && Number.isFinite(minutesRaw) && minutesRaw > 0
      ? Math.round(minutesRaw)
      : null;

  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }

  const userPrompt = [
    title ? `Step title: ${title}` : null,
    `Step description: ${description}`,
    minutes ? `Approximate time: ${minutes} minutes.` : null,
    UX_PALETTE,
    'Return exactly 2 activities that could be supported by the UX palette elements (chatbot, heading, textbox, voice_input, photo_input, mcq, short_audio, image, storyboard/slides, dalle_video, timer, timed_cues, step-by-step box, short video, guided breathing, simple image). All descriptive fields must be >=1 informative sentence; any prompt/script sent to GPT must be >=3 informative sentences.',
    'Make sure the activities fill the allotted time; give rough minutes per activity so they add up to the total.',
    'Each activity must have the user DO something (not just read) and should offer multiple modality options within that activity (e.g., voice OR text; image OR storyboard; slides for structured prompts). At least one modality per activity must be multimodal (e.g., audio + text, or visual + text), and the two activities should use diverse UX types (don’t repeat the same pattern twice). Ground the prompts/questions in the user’s conversation context. Include both a voice input element and a photo input/upload element somewhere in the flow.',
    'Rules: (1) Do not use both timed cues and timer in the same activity. (2) If a timer is used, pair it with a textbox or audio input. (3) Each screen must include at least one of audio/video/timer/timed cues, but do not repeat the same choice across both screens. (4) Prompts for audio/video/timed cues/timer must be personalized to the conversation. (5) The final element on the last screen should be driven by the evidence requirement (text/audio input/photo input). (6) Chatbot persona/first message must reference the user conversation context, avoid repeating what the user already said, and clearly state the bot’s purpose/identity.',
    'Every activity must be complete on its own: title, modalities offered, at least 6 distinct UX elements (micro-prompts, controls, cues, or interactions), concise instruction, minutes, and evidence requirement (photo vs. text).',
    'Ensure the activities are sequential and help the user do/report this step. End with what evidence to collect: whether photo evidence is needed or if a text report is sufficient.',
    'Return plain text with numbered activities, each including: title, modalities, instruction, minutes, and evidence requirement.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const story = await runChatCompletion(
      'ui-story',
      [
        {
          role: 'system',
          content:
            `You design short, sequential activities for multimodal UI (voice, text, video, breathing, storyboard, slides, image). Before planning, read and use this UX palette:\n${UX_PALETTE}\nBe concrete about modality choices per activity, pacing, evidence required, and always return exactly 2 activities. Each activity must include at least 6 UX elements (controls, micro-prompts, cues, or interactions), at least one multimodal path, and the pair should use diverse UX types. Ground the copy in the user conversation context. Always include a voice input element and a photo input/upload element in the overall flow. Follow rules: no activity uses both timed cues and timer; if timer is used, pair it with textbox or audio input; each screen includes at least one of audio/video/timer/timed cues but not the same choice on both screens; prompts for audio/video/timed cues/timer must be personalized; the final element on the last screen should be driven by the evidence requirement; chatbot persona/first message must reference user conversation, avoid repeating the user, and clearly state purpose/identity. All descriptive fields must be >=1 informative sentence; any prompt/script sent to GPT must be >=3 informative sentences. Keep it concise and supportive.`,
        },
        { role: 'user', content: userPrompt },
      ],
      { model: DEFAULT_LLM_MODEL, temperature: 0.7, max_tokens: 280 }
    );
    res.json({ story: (story || '').trim() });
  } catch (err) {
    console.error('ui-story error', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'ui-story failed' });
  }
});

// Lightweight GPT-4.1 chatbot for UX blocks
app.post('/dev/ux-chat', async (req, res) => {
  const persona = typeof req.body?.persona === 'string' && req.body.persona.trim()
    ? req.body.persona.trim()
    : 'You are a calm, concise UX helper who keeps answers short and supportive.';
  const firstPrompt = typeof req.body?.first_prompt === 'string' && req.body.first_prompt.trim()
    ? req.body.first_prompt.trim()
    : 'Say hi briefly and ask what the user wants to focus on.';
  const conversationContext =
    typeof req.body?.conversation_context === 'string' && req.body.conversation_context.trim()
      ? req.body.conversation_context.trim()
      : '';
  const conversation = Array.isArray(req.body?.conversation)
    ? req.body.conversation
        .map((m) => (m && typeof m === 'object' ? m : null))
        .filter(Boolean)
        .map((m) => {
          const role = m.role === 'assistant' ? 'assistant' : 'user';
          const content = typeof m.content === 'string' ? m.content.trim() : '';
          return content ? { role, content } : null;
        })
        .filter(Boolean)
    : [];

  try {
    const contextMessages = conversationContext
      ? [
          {
            role: 'system',
            content:
              'Conversation context (use to personalize; do NOT repeat verbatim; respect the stated purpose/identity): ' +
              conversationContext,
          },
        ]
      : [];
    const messages = [
      {
        role: 'system',
        content:
          `${persona}\n\nFirst reply rule: Acknowledge the user briefly, state your purpose, and immediately give the first task step. Do not ask exploratory/get-to-know-you questions.\n\nFollow-up rule: For every next reply, keep the same persona and purpose, continue the same activity goal, give one concrete next step, and avoid generic or off-task conversation.`,
      },
      ...contextMessages,
      { role: 'assistant', content: firstPrompt },
      ...conversation,
    ];
    const reply = await runChatCompletion(
      'ux-chat',
      messages,
      { model: STRESS_SUPPORT_MODEL, temperature: 0.7, max_tokens: 180 }
    );
    appendLog('api:ux-chat', {
      persona_preview: persona.slice(0, 120),
      first_prompt_preview: firstPrompt.slice(0, 120),
      conversation_turns: conversation.length,
      has_context: Boolean(conversationContext),
      reply_preview: typeof reply === 'string' ? reply.slice(0, 120) : '',
    });
    res.json({
      reply: (reply || '').trim(),
      persona,
      first_prompt: firstPrompt,
    });
  } catch (err) {
    console.error('ux-chat error', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'ux-chat failed' });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
