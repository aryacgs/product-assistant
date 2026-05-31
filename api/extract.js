// api/extract.js — Vercel Serverless Function
// Terima teks → Gemini AI extract → save ke Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_URL   = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const PROMPT = `Kamu adalah AI assistant untuk tim Product Development di perusahaan perbankan Indonesia.

Baca dokumen meeting notes berikut dan extract informasi ke dalam format JSON.

Format JSON yang WAJIB diikuti (kembalikan HANYA JSON valid, tanpa markdown, tanpa penjelasan):
{
  "project": {
    "project_id": "lowercase_tanpa_spasi_gunakan_underscore",
    "project_name": "Nama lengkap project",
    "squad": "Nama squad/tim",
    "color_hex": "#534AB7",
    "initials": "XX",
    "status": "draft",
    "go_live": "Q3 2026",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "X dev · X BA · X QA",
    "note_info": "Insight penting tentang project"
  },
  "regulasi": {
    "project_id": "sama_dengan_project_id",
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
  "apis": [
    {
      "project_id": "sama_dengan_project_id",
      "api_name": "nama.gql",
      "version": "v1.0",
      "status": "Active",
      "clickable": "yes",
      "gql_title": "Judul schema",
      "gql_schema": "type Query { ... }",
      "gql_meta_keys": "Versi|Status",
      "gql_meta_vals": "v1.0|Active",
      "badges": "GraphQL|Kafka",
      "note_api": "Catatan API"
    }
  ],
  "team": [
    {
      "project_id": "sama_dengan_project_id",
      "role": "Backend dev",
      "count": "2",
      "name": "Nama jika ada, atau -",
      "sprint_duration": "2 minggu",
      "go_live": "Q3 2026",
      "note_team": "Catatan tim (isi di baris pertama saja)"
    }
  ]
}

Aturan penting:
- project_id: lowercase, spasi jadi underscore, contoh: transfer_virtual_account
- mandays dan budget_idr: angka integer saja (tanpa Rp, tanpa titik)
- color_hex: pilih warna sesuai karakter project (#534AB7 ungu, #1D9E75 hijau, #BA7517 oranye, #D85A30 merah, #185FA5 biru)
- initials: 2 huruf kapital dari nama project
- Jika info tidak ada, gunakan string kosong ""
- badges: pisahkan dengan | (pipe)

DOKUMEN MEETING NOTES:
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, filename } = req.body;
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Teks terlalu pendek' });
    }

    // ── 1. Call Gemini ──────────────────────────────────
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: PROMPT + text.substring(0, 10000) }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      throw new Error(`Gemini API error ${geminiRes.status}: ${err.substring(0, 200)}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ── 2. Parse JSON ───────────────────────────────────
    let extracted;
    try {
      const clean = rawText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      extracted = JSON.parse(clean);
    } catch (e) {
      throw new Error(`Gagal parse JSON dari AI: ${rawText.substring(0, 300)}`);
    }

    // ── 3. Save ke Supabase ─────────────────────────────
    const saved = { project: null, regulasi: null, apis: [], team: [] };

    if (extracted.project?.project_id) {
      saved.project = await sbUpsert('projects', extracted.project, 'project_id');
    }
    if (extracted.regulasi?.project_id) {
      saved.regulasi = await sbUpsert('regulasi', extracted.regulasi, 'project_id');
    }
    for (const api of (extracted.apis || [])) {
      if (api.project_id && api.api_name) {
        saved.apis.push(await sbUpsert('api_schema', api, 'project_id,api_name'));
      }
    }
    for (const t of (extracted.team || [])) {
      if (t.project_id && t.role) {
        saved.team.push(await sbUpsert('team_timeline', t, 'project_id,role'));
      }
    }

    return res.status(200).json({
      ok: true,
      project_id: extracted.project?.project_id,
      project_name: extracted.project?.project_name,
      saved,
      extracted
    });

  } catch (err) {
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
