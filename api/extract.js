// api/extract.js — ProdDev Assistant v2.0
// OpenRouter AI → extract project, regulation, API, team, insights, quality scores, 4 docs → Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const OR_KEY       = process.env.OPENROUTER_API_KEY;
const AI_MODELS_RAW = process.env.AI_MODEL || 'openai/gpt-oss-20b:free|google/gemma-3-12b-it:free|openai/gpt-oss-120b:free|nvidia/nemotron-super-49b-v1:free';
const ALL_MODELS = AI_MODELS_RAW.split('|').map(m => m.trim()).filter(Boolean);

const PROMPT = `You are an AI assistant for a Product Development team at an Indonesian bank.
Read the document below (meeting notes, email thread, transcript, or MoM) and extract structured information.

Return ONLY valid JSON, no markdown, no explanation. Use this exact schema:
{
  "project": {
    "project_id": "lowercase_underscore_from_name",
    "project_name": "Full project name",
    "squad": "Squad/team name",
    "color_hex": "#534AB7",
    "initials": "XX",
    "status": "draft",
    "go_live": "Q4 2026",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "3 dev · 1 BA · 1 QA",
    "note_info": "Key insight about this project"
  },
  "regulasi": {
    "project_id": "same_as_above",
    "dasar_hukum": "PBI No.XX or regulation name",
    "fee_per_trx": "IDR X,XXX or Free",
    "limit_per_trx": "IDR X,XXX,XXX",
    "operasional": "24 hours / 7 days",
    "settlement": "Real-time",
    "availability": "Min 99.9%",
    "enkripsi": "TLS 1.3",
    "badges": "Tag1|Tag2|Tag3",
    "note_reg": "Compliance note"
  },
  "apis": [{
    "project_id": "same_as_above",
    "api_name": "name.gql",
    "version": "v1.0",
    "status": "Active",
    "clickable": "yes",
    "gql_title": "Schema title",
    "gql_schema": "type Mutation { ... }",
    "gql_meta_keys": "Version|Status",
    "gql_meta_vals": "v1.0|Active",
    "badges": "GraphQL|Kafka",
    "note_api": "API note"
  }],
  "team": [{
    "project_id": "same_as_above",
    "role": "Backend Developer",
    "count": "2",
    "name": "Name or -",
    "sprint_duration": "2 weeks",
    "go_live": "Q4 2026",
    "note_team": "Team note"
  }],
  "insights": {
    "project_id": "same_as_above",
    "affected_systems": "System1|System2|System3",
    "dependencies": "Dependency1|Dependency2",
    "policies": "Policy1|Policy2",
    "past_issues": "Lessons learned or past issues from similar work",
    "clarifications": "Question1?|Question2?|Question3?"
  },
  "quality": {
    "project_id": "same_as_above",
    "completeness_pct": 0,
    "completeness_rating": "Good|Medium|Low",
    "ambiguity_count": 0,
    "ambiguity_rating": "Good|Medium|Low",
    "consistency_count": 0,
    "consistency_rating": "Good|Medium|Low",
    "redundancy_count": 0,
    "redundancy_rating": "Good|Medium|Low",
    "dependency_coverage_pct": 0,
    "dependency_rating": "Good|Medium|Low",
    "regulation_coverage_pct": 0,
    "regulation_rating": "Good|Medium|Low",
    "stakeholder_confirmed": 0,
    "stakeholder_total": 5,
    "stakeholder_rating": "Good|Medium|Low"
  }
}

EXTRACTION RULES:
- project_id: lowercase, spaces become underscores
- mandays, budget_idr, all _pct, _count, stakeholder fields: integer numbers only
- color_hex by domain: #534AB7 payment/transfer, #1D9E75 done/green, #BA7517 amber, #D85A30 red, #185FA5 blue
- initials: 2 uppercase letters
- Empty fields: empty string ""
- pipe-separated lists use | character

QUALITY SCORING (analyze the document critically, scores 0-100 for pct, counts as integers):
- completeness_pct: how complete is the requirement info (background, FRs, NFRs, scope all present = high)
- ambiguity_count: number of vague/unclear statements found
- consistency_count: number of contradictions or inconsistent statements
- redundancy_count: number of duplicate/repeated requirements
- dependency_coverage_pct: how well dependencies are identified and documented
- regulation_coverage_pct: how well regulatory requirements are covered
- stakeholder_confirmed: how many stakeholders explicitly confirmed (out of stakeholder_total)

For each _rating field, assign: "Good" (strong/no concerns), "Medium" (some gaps), "Low" (significant gaps).
For percentages: Good >= 80, Medium 60-79, Low < 60.
For counts (ambiguity/consistency/redundancy): Good = 0, Medium = 1-2, Low = 3+.
For stakeholder: Good >= 80% confirmed, Medium 50-79%, Low < 50%.


DOCUMENT:
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!OR_KEY) return res.status(500).json({ ok:false, error: 'OPENROUTER_API_KEY env var not set in Vercel' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ ok:false, error: 'Supabase env vars not set in Vercel' });

    const { text, filename } = req.body || {};
    if (!text || text.trim().length < 20)
      return res.status(400).json({ ok:false, error: 'Text too short' });

    let rawText = '', modelUsed = '', lastError = '';

    // Try models with auto-fallback (cap at 3 to stay within 60s function limit)
    const modelsToTry = ALL_MODELS.slice(0, 3);
    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18000); // 22s per model
        let aiRes;
        try {
          aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${OR_KEY}`,
              'HTTP-Referer': 'https://proddev-assistant.vercel.app',
              'X-Title': 'ProdDev Assistant',
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: 'You extract structured data from documents into JSON. Reply ONLY with valid JSON, no markdown or explanation.' },
                { role: 'user', content: PROMPT + text.substring(0, 9000) }
              ],
              temperature: 0.2,
              max_tokens: 3500,
            })
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (aiRes.status === 429 || aiRes.status === 404) {
          lastError = `${model} → ${aiRes.status}`;
          continue;
        }
        if (!aiRes.ok) {
          lastError = `${model} → ${aiRes.status}: ${(await aiRes.text()).substring(0,100)}`;
          continue;
        }

        const aiData = await aiRes.json();
        const content = aiData?.choices?.[0]?.message?.content || '';
        if (!content || content.trim().length < 10) { lastError = `${model} → empty`; continue; }

        rawText = content;
        modelUsed = model;
        break;
      } catch (e) {
        lastError = e.name === 'AbortError' ? `${model} → timeout (18s)` : `${model} → ${e.message}`;
        continue;
      }
    }

    if (!rawText) throw new Error(`All models failed. Last: ${lastError}`);

    // Parse JSON
    let ex;
    try {
      const m = rawText.match(/\{[\s\S]*\}/);
      ex = JSON.parse(m ? m[0] : rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());
    } catch (e) {
      throw new Error(`JSON parse failed (${modelUsed}): ${rawText.substring(0,200)}`);
    }

    if (!ex.project?.project_id) throw new Error('AI could not identify a project');
    const pid = ex.project.project_id;

    // Rating helpers — use AI-provided rating if valid, else compute from numbers
    var VALID_RATINGS = ['Good','Medium','Low'];
    function useOrCompute(aiRating, computeFn){
      return VALID_RATINGS.includes(aiRating) ? aiRating : computeFn();
    }
    function pctRating(p){ return p >= 80 ? 'Good' : p >= 60 ? 'Medium' : 'Low'; }
    function countRating(c){ return c === 0 ? 'Good' : c <= 2 ? 'Medium' : 'Low'; }
    function stakeRating(c,t){ var r = t ? c/t : 0; return r >= 0.8 ? 'Good' : r >= 0.5 ? 'Medium' : 'Low'; }

    const saved = {};

    // 1. Project
    saved.project = await sbUpsert('projects', ex.project, 'project_id');

    // 3. Regulation
    if (ex.regulasi?.project_id) saved.regulasi = await sbUpsert('regulasi', ex.regulasi, 'project_id');

    // 4. APIs
    saved.apis = [];
    for (const api of (ex.apis||[])) if (api.project_id && api.api_name)
      saved.apis.push(await sbUpsert('api_schema', api, 'project_id,api_name'));

    // 5. Team
    saved.team = [];
    for (const t of (ex.team||[])) if (t.project_id && t.role)
      saved.team.push(await sbUpsert('team_timeline', t, 'project_id,role'));

    // 6. Insights
    if (ex.insights) {
      ex.insights.project_id = pid;
      saved.insights = await sbUpsert('insights', ex.insights, 'project_id');
    }

    // 7. Quality scores (compute ratings)
    if (ex.quality) {
      const q = ex.quality;
      q.project_id = pid;
      q.completeness_rating = useOrCompute(q.completeness_rating, function(){return pctRating(q.completeness_pct||0);});
      q.ambiguity_rating = useOrCompute(q.ambiguity_rating, function(){return countRating(q.ambiguity_count||0);});
      q.consistency_rating = useOrCompute(q.consistency_rating, function(){return countRating(q.consistency_count||0);});
      q.redundancy_rating = useOrCompute(q.redundancy_rating, function(){return countRating(q.redundancy_count||0);});
      q.dependency_rating = useOrCompute(q.dependency_rating, function(){return pctRating(q.dependency_coverage_pct||0);});
      q.regulation_rating = useOrCompute(q.regulation_rating, function(){return pctRating(q.regulation_coverage_pct||0);});
      q.stakeholder_rating = useOrCompute(q.stakeholder_rating, function(){return stakeRating(q.stakeholder_confirmed||0, q.stakeholder_total||5);});
      saved.quality = await sbUpsert('quality_scores', q, 'project_id');
    }

    // 8. Input source
    if (filename) {
      const ext = (filename.split('.').pop()||'txt').toLowerCase();
      const ftype = ['docx','doc'].includes(ext)?'docx':ext==='pdf'?'pdf':ext==='md'?'md':'txt';
      await fetch(`${SUPABASE_URL}/rest/v1/input_sources`, {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Prefer':'return=minimal'},
        body: JSON.stringify({project_id: pid, file_name: filename, file_type: ftype})
      });
    }

    return res.status(200).json({
      ok: true,
      project_id: pid,
      project_name: ex.project.project_name,
      model_used: modelUsed,
      extracted: ex
    });

  } catch (err) {
    console.error('Extract error:', err.message);
    return res.status(500).json({ ok:false, error: err.message });
  }
}

async function sbUpsert(table, data, conflictCol) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCol}`, {
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Prefer':'resolution=merge-duplicates,return=representation'},
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Supabase ${table}: ${(await r.text()).substring(0,200)}`);
  return r.json();
}

async function sbPatch(table, filter, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method:'PATCH',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Prefer':'return=minimal'},
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${table}: ${(await r.text()).substring(0,200)}`);
  return true;
}
