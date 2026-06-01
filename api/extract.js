// api/extract.js — Vercel Serverless Function
// Terima teks → OpenRouter AI extract → save ke Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const OR_KEY       = process.env.OPENROUTER_API_KEY;
const OR_MODEL     = process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free';

const PROMPT = `Kamu adalah AI assistant untuk tim Product Development di perusahaan perbankan Indonesia.

Baca dokumen meeting notes berikut dan extract informasi ke dalam format JSON.

Kembalikan HANYA JSON valid berikut, tanpa markdown, tanpa penjelasan apapun:
{
  "project": {
    "project_id": "lowercase_underscore_contoh_transfer_va",
    "project_name": "Nama lengkap project",
    "squad": "Nama squad",
    "color_hex": "#534AB7",
    "initials": "XX",
    "status": "draft",
    "go_live": "Q3 2026",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "2 dev · 1 BA · 1 QA",
    "note_info": "Insight penting"
  },
  "regulasi": {
    "project_id": "sama_dengan_atas",
    "dasar_hukum": "PBI No.XX",
    "fee_per_trx": "Rp X.XXX",
    "limit_per_trx": "Rp X.XXX.XXX",
    "operasional": "24 jam / 7 hari",
    "settlement": "Real-time",
    "availability": "Min 99.9%",
    "enkripsi": "TLS 1.3",
    "badges": "Tag1|Tag2|Tag3",
    "note_reg": "Catatan regulasi"
  },
  "apis": [{
    "project_id": "sama_dengan_atas",
    "api_name": "nama.gql",
    "version": "v1.0",
    "status": "Active",
    "clickable": "yes",
    "gql_title": "Judul schema",
    "gql_schema": "type Mutation { ... }",
    "gql_meta_keys": "Versi|Status",
    "gql_meta_vals": "v1.0|Active",
    "badges": "GraphQL|Kafka",
    "note_api": "Catatan API"
  }],
  "team": [{
    "project_id": "sama_dengan_atas",
    "role": "Backend dev",
    "count": "2",
    "name": "-",
    "sprint_duration": "2 minggu",
    "go_live": "Q3 2026",
    "note_team": "Catatan tim"
  }]
}

Aturan:
- project_id: lowercase, spasi→underscore
- mandays, budget_idr: integer saja
- color_hex: #534AB7 ungu | #1D9E75 hijau | #BA7517 oranye | #D85A30 merah | #185FA5 biru
- initials: 2 huruf kapital
- Kosongkan field dengan "" jika tidak ada info
- badges: pisah dengan |
- HANYA JSON, tidak ada teks lain`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Teks terlalu pendek' });
    }

    // ── 1. Call OpenRouter ──────────────────────────────
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
          { role: 'system', content: 'Kamu adalah AI yang mengekstrak data dari meeting notes menjadi JSON terstruktur. Selalu kembalikan JSON valid tanpa penjelasan.' },
          { role: 'user', content: PROMPT + '\n\n' + text.substring(0, 10000) }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`OpenRouter error ${aiRes.status}: ${err.substring(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.choices?.[0]?.message?.content || '';

    if (!rawText) throw new Error('AI tidak mengembalikan respons. Coba lagi.');

    // ── 2. Parse JSON ───────────────────────────────────
    let extracted;
    try {
      const clean = rawText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      extracted = JSON.parse(clean);
    } catch(e) {
      throw new Error(`Gagal parse JSON: ${rawText.substring(0, 200)}`);
    }

    if (!extracted.project?.project_id) {
      throw new Error('AI tidak berhasil mengidentifikasi project dari dokumen');
    }

    // ── 3. Save ke Supabase ─────────────────────────────
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
