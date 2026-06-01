// api/extract.js — Vercel Serverless Function
// OpenRouter → Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const OR_KEY      = process.env.OPENROUTER_API_KEY;
const OR_MODEL    = process.env.AI_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

const PROMPT = `Kamu adalah AI assistant untuk tim Product Development perbankan Indonesia.
Extract data dari meeting notes berikut ke JSON.
KEMBALIKAN HANYA JSON VALID, tidak ada teks lain, tidak ada markdown.

Format JSON:
{
  "project": {
    "project_id": "lowercase_underscore",
    "project_name": "Nama Project",
    "squad": "Nama Squad",
    "color_hex": "#534AB7",
    "initials": "XX",
    "status": "draft",
    "go_live": "",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "2 dev · 1 BA",
    "note_info": ""
  },
  "regulasi": {
    "project_id": "sama_dengan_project_id",
    "dasar_hukum": "",
    "fee_per_trx": "",
    "limit_per_trx": "",
    "operasional": "",
    "settlement": "",
    "availability": "",
    "enkripsi": "",
    "badges": "Tag1|Tag2",
    "note_reg": ""
  },
  "apis": [{
    "project_id": "sama_dengan_project_id",
    "api_name": "nama.gql",
    "version": "v1.0",
    "status": "Active",
    "clickable": "yes",
    "gql_title": "",
    "gql_schema": "",
    "gql_meta_keys": "",
    "gql_meta_vals": "",
    "badges": "",
    "note_api": ""
  }],
  "team": [{
    "project_id": "sama_dengan_project_id",
    "role": "Backend dev",
    "count": "1",
    "name": "-",
    "sprint_duration": "",
    "go_live": "",
    "note_team": ""
  }]
}

Aturan:
- project_id: lowercase, spasi jadi underscore
- mandays, budget_idr: angka integer saja
- color_hex: #534AB7 ungu | #1D9E75 hijau | #BA7517 oranye | #D85A30 merah | #185FA5 biru
- initials: 2 huruf kapital
- Field kosong: string kosong ""
- badges: pisah dengan |

MEETING NOTES:
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text || text.trim().length < 20)
      return res.status(400).json({ error: 'Teks terlalu pendek' });

    // ── 1. Call OpenRouter ──────────────────────────
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OR_KEY}`,
        'HTTP-Referer': 'https://proddev-assistant.vercel.app',
        'X-Title': 'ProdDev Assistant',
      },
      body: JSON.stringify({
        model: OR_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Kamu mengekstrak data meeting notes menjadi JSON. Balas HANYA dengan JSON valid, tanpa markdown, tanpa penjelasan.'
          },
          {
            role: 'user',
            content: PROMPT + text.substring(0, 10000)
          }
        ],
        temperature: 0.1,
        max_tokens: 4096,
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`OpenRouter error ${aiRes.status}: ${err.substring(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.choices?.[0]?.message?.content || '';

    if (!rawText || rawText.trim().length < 10)
      throw new Error('AI tidak mengembalikan respons. Model: ' + OR_MODEL);

    // ── 2. Parse JSON ───────────────────────────────
    let extracted;
    try {
      // extract JSON block dari response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const clean = jsonMatch ? jsonMatch[0] : rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      extracted = JSON.parse(clean);
    } catch(e) {
      throw new Error(`Gagal parse JSON: ${rawText.substring(0, 200)}`);
    }

    if (!extracted.project?.project_id)
      throw new Error('AI tidak mengidentifikasi project dari dokumen');

    // ── 3. Save ke Supabase ─────────────────────────
    const saved = { project: null, regulasi: null, apis: [], team: [] };

    if (extracted.project?.project_id)
      saved.project = await sbUpsert('projects', extracted.project, 'project_id');

    if (extracted.regulasi?.project_id)
      saved.regulasi = await sbUpsert('regulasi', extracted.regulasi, 'project_id');

    for (const api of (extracted.apis || []))
      if (api.project_id && api.api_name)
        saved.apis.push(await sbUpsert('api_schema', api, 'project_id,api_name'));

    for (const t of (extracted.team || []))
      if (t.project_id && t.role)
        saved.team.push(await sbUpsert('team_timeline', t, 'project_id,role'));

    return res.status(200).json({
      ok: true,
      project_id: extracted.project?.project_id,
      project_name: extracted.project?.project_name,
      model_used: OR_MODEL,
      saved
    });

  } catch(err) {
    console.error('Extract error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function sbUpsert(table, data, conflictCol) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCol}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Supabase ${table}: ${(await r.text()).substring(0,200)}`);
  return r.json();
}
