// AI assistance. Every function here only ADVISES a human: it never approves, rejects
// or penalises anyone. If ANTHROPIC_API_KEY is not set (or a call fails), each function
// falls back to a deterministic, explainable rule-based version so the product always works.

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;

if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
  } catch (e) {
    console.warn('Anthropic SDK not available — using rule-based assistants.', e.message);
  }
}

let suspended = false;
export const suspendAi = (v) => { suspended = v; };
export const aiStatus = () => ({ enabled: !!client, model: client ? MODEL : null });

async function askJson(system, user, schema) {
  if (!client || suspended) return null;
  try {
    const resp = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (resp.stop_reason === 'refusal') return null;
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  } catch (e) {
    console.warn('AI call failed, falling back to rules:', e.message);
    return null;
  }
}

// ---------- Resource matching ----------

const SYNONYMS = {
  laser: ['laser', 'engrave', 'engraving', 'acrylic', 'cut', 'cutting', 'signage', 'stencil', 'plywood', 'mdf'],
  print: ['3d', 'print', 'printing', 'printer', 'prototype', 'pla', 'petg', 'enclosure', 'bracket', 'drone', 'part', 'model'],
  cnc: ['cnc', 'mill', 'milling', 'router', 'aluminium', 'aluminum', 'wood', 'furniture', 'machining'],
  camera: ['camera', 'video', 'film', 'filming', 'shoot', 'photo', 'photography', 'documentary', 'vlog', 'interview', 'footage'],
  audio: ['podcast', 'audio', 'record', 'recording', 'voice', 'voiceover', 'interview', 'music', 'mic', 'microphone'],
  room: ['meeting', 'seminar', 'workshop', 'class', 'talk', 'session', 'room', 'presentation', 'hackathon', 'study', 'group', 'people'],
  electronics: ['solder', 'soldering', 'pcb', 'circuit', 'electronics', 'arduino', 'sensor', 'signal', 'oscilloscope', 'waveform', 'measure', 'debug'],
  compute: ['gpu', 'train', 'training', 'model', 'ml', 'machine', 'learning', 'deep', 'render', 'rendering', 'simulation', 'compute', 'llm', 'dataset'],
  hand: ['hand', 'tools', 'woodwork', 'woodworking', 'saw', 'chisel', 'sanding', 'repair', 'fix', 'bench'],
};

const STOP = new Set(['need', 'want', 'some', 'with', 'that', 'this', 'from', 'have', 'will', 'into', 'week', 'next', 'help', 'make', 'using', 'about', 'like', 'would']);
const stem = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokenize = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).map(stem);

// A resource belongs to the synonym groups that its tags clearly describe (2+ tag hits).
function groupsOf(r) {
  const tags = new Set(r.tags.map(stem));
  return Object.entries(SYNONYMS).filter(([, words]) => words.filter((w) => tags.has(w)).length >= 2).map(([g]) => g);
}

function ruleMatch(query, catalog) {
  const q = new Set(tokenize(query).filter((w) => !STOP.has(w)));
  return catalog.map((r) => {
    const text = new Set(tokenize(`${r.name} ${r.description} ${r.tags.join(' ')}`));
    let score = 0;
    const hits = [];
    for (const g of groupsOf(r)) {
      const inQuery = SYNONYMS[g].filter((w) => q.has(w));
      score += 3 * inQuery.length;
      hits.push(...inQuery);
    }
    for (const w of q) if (w.length > 3 && text.has(w) && !hits.includes(w)) { score += 1; hits.push(w); }
    const capMatch = String(query).match(/(\d+)\s*(people|persons|students|attendees|participants|of us)/i);
    if (capMatch && r.capacity) score += r.capacity >= +capMatch[1] ? 3 : -6;
    return {
      resourceId: r.id,
      fit: Math.max(0, Math.min(98, score * 11)),
      reason: hits.length ? `Matches: ${[...new Set(hits)].slice(0, 5).join(', ')}` : 'Weak keyword match',
    };
  }).filter((m) => m.fit > 0).sort((a, b) => b.fit - a.fit).slice(0, 5);
}

export async function matchResources(query, catalog) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['matches'],
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['resourceId', 'fit', 'reason'],
          properties: { resourceId: { type: 'string' }, fit: { type: 'integer' }, reason: { type: 'string' } },
        },
      },
    },
  };
  const ai = await askJson(
    'You match a person\'s described need to shared campus resources. Return at most 5 matches, best first. fit is 0-100. reason is one short sentence addressed to the user explaining why the resource fits. Only use resourceIds from the catalog. Do not judge eligibility; the platform checks that separately.',
    `Need: ${query}\n\nCatalog (JSON):\n${JSON.stringify(catalog.map(({ id, name, category, description, tags, capacity, location }) => ({ id, name, category, description, tags, capacity, location })))}`,
    schema,
  );
  const ids = new Set(catalog.map((c) => c.id));
  if (ai?.matches?.length) {
    return { source: 'claude', matches: ai.matches.filter((m) => ids.has(m.resourceId)).slice(0, 5) };
  }
  return { source: 'rules', matches: ruleMatch(query, catalog) };
}

// ---------- Incident summaries ----------

function ruleIncident(inc, ctx) {
  const text = `${inc.description}`.toLowerCase();
  const critical = /(fire|smoke|injur|burn|shock|blood|hospital|spark)/.test(text);
  const damage = /(broken|crack|chipped|damag|scratch|bent|dent|missing|lost|not working|faulty|leak|snapp)/.test(text);
  let severity = 'low';
  if (critical) severity = 'critical';
  else if (inc.type === 'damage' || damage) severity = ctx.resourceValue > 500000 ? 'high' : 'medium';
  else if (inc.type === 'delay') severity = (ctx.lateMinutes || 0) > 120 ? 'medium' : 'low';
  else if (inc.type === 'safety') severity = 'high';
  const actions = [];
  if (severity === 'critical') actions.push('Pause the resource and inspect it before the next booking', 'Contact the reporter and confirm nobody was hurt');
  if (inc.type === 'damage' || damage) actions.push('Compare check-in and return condition records and photos', 'Decide whether the damage was pre-existing, wear-and-tear or caused during use');
  if (inc.type === 'delay') actions.push('Check whether the next booking was affected', 'Consider a warning for a first late return');
  if (inc.type === 'no_show') actions.push('Check whether the user cancelled through another channel', 'Confirm or waive the proposed strike');
  if (!actions.length) actions.push('Review the details and contact the people involved');
  const firstSentence = String(inc.description).split(/(?<=[.!?])\s/)[0].slice(0, 220);
  return {
    source: 'rules',
    summary: `${ctx.resourceName}: ${firstSentence}`,
    suggestedSeverity: severity,
    suggestedActions: actions,
    keyFacts: [
      ctx.bookingRef ? `Booking ${ctx.bookingRef}` : null,
      ctx.preExisting?.length ? `Pre-existing issues at check-in: ${ctx.preExisting.join('; ')}` : 'No issues were recorded at check-in',
      ctx.newIssues?.length ? `New issues at return: ${ctx.newIssues.join('; ')}` : null,
      ctx.lateMinutes ? `Returned ${ctx.lateMinutes} min late` : null,
    ].filter(Boolean),
  };
}

export async function summariseIncident(inc, ctx) {
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['summary', 'suggestedSeverity', 'suggestedActions', 'keyFacts'],
    properties: {
      summary: { type: 'string' },
      suggestedSeverity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      suggestedActions: { type: 'array', items: { type: 'string' } },
      keyFacts: { type: 'array', items: { type: 'string' } },
    },
  };
  const ai = await askJson(
    'You help a lab manager triage an incident on shared institutional equipment. Summarise neutrally in 1-2 sentences without assigning blame. Suggest a severity and 2-4 concrete next steps for the human reviewer. keyFacts lists verifiable facts from the records (condition at check-in vs return, lateness). You never decide penalties.',
    JSON.stringify({ incident: { type: inc.type, reportedSeverity: inc.severity, description: inc.description }, context: ctx }),
    schema,
  );
  return ai ? { source: 'claude', ...ai } : ruleIncident(inc, ctx);
}

// ---------- Training-record review ----------

export async function reviewCredential(cred, type, ctx) {
  const reasons = [];
  let risk = 0;
  const idOk = type.pattern.test(cred.certificateId || '');
  reasons.push(idOk ? `Certificate ID matches the ${type.issuer} format` : `Certificate ID does not match the expected format (${type.example})`);
  if (!idOk) risk += 2;
  const issuerOk = String(cred.issuer || '').trim().toLowerCase() === type.issuer.toLowerCase();
  reasons.push(issuerOk ? 'Issuer is a recognised training provider for this course' : `Issuer "${cred.issuer}" is not the recognised provider (${type.issuer})`);
  if (!issuerOk) risk += 1;
  if (cred.expiresAt && cred.expiresAt < ctx.now) { reasons.push('Certificate has expired'); risk += 3; }
  else if (cred.expiresAt) reasons.push('Certificate is within its validity period');
  if (cred.issuedAt && cred.issuedAt > ctx.now) { reasons.push('Issue date is in the future'); risk += 3; }
  if (ctx.duplicateOf) { reasons.push(`The same certificate ID is already on file for another account (${ctx.duplicateOf})`); risk += 4; }
  const base = {
    source: 'rules',
    recommendation: risk === 0 ? 'looks_valid' : risk >= 3 ? 'likely_invalid' : 'needs_closer_look',
    reasons,
  };
  if (!client || !cred.evidence) return base;
  const ai = await askJson(
    'You assist a lab manager reviewing a training certificate a user submitted. Given rule-check results and the user\'s free-text evidence, add at most 2 short observations about consistency (course name, dates, issuer). Never approve or reject; the manager decides.',
    JSON.stringify({ course: type.name, issuer: type.issuer, submitted: cred, ruleChecks: base }),
    { type: 'object', additionalProperties: false, required: ['observations'], properties: { observations: { type: 'array', items: { type: 'string' } } } },
  );
  if (ai?.observations?.length) return { ...base, source: 'rules+claude', reasons: [...reasons, ...ai.observations.slice(0, 2).map((o) => `AI note: ${o}`)] };
  return base;
}
