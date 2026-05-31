// api/extract.js — Vercel Serverless Function
// Terima file upload → FreeModel AI extract → save ke Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const FREEMODEL_KEY = process.env.FREEMODEL_API_KEY;
const FREEMODEL_URL = 'https://cc.freemodel.dev';

const EXTRACT_PROMPT = `Kamu adalah AI assistant untuk tim Product Development di perusahaan perbankan Indonesia.

Baca dokumen meeting notes berikut dan extract informasi ke dalam format JSON yang tepat.

Format output JSON yang WAJIB diikuti:
{
  "project": {
    "project_id": "string lowercase tanpa spasi (contoh: transfer_bifast)",
    "project_name": "Nama lengkap project",
    "squad": "Nama squad/tim",
    "color_hex": "#RRGGBB (pilih warna yang sesuai karakter project)",
    "initials": "2 huruf inisial",
    "status": "draft|pending|review|approved",
    "go_live": "Target tanggal atau kuartal go-live",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "X dev · X BA · X QA",
    "note_info": "Insight penting tentang project ini"
  },
  "regulasi": {
    "project_id": "sama dengan project.project_id",
    "dasar_hukum": "Nama regulasi/PBI",
    "fee_per_trx": "Rp X.XXX",
    "limit_per_trx": "Rp X.XXX.XXX",
    "operasional": "jam operasional",
    "settlement": "mekanisme settlement",
    "availability": "SLA availability",
    "enkripsi": "jenis enkripsi",
    "badges": "Tag1|Tag2|Tag3",
    "note_reg": "Catatan penting tentang regulasi"
  },
  "apis": [
    {
      "project_id": "sama dengan project.project_id",
      "api_name": "nama endpoint atau file gql",
      "version": "vX.X",
      "status": "Active|Stable|Deprecated",
      "clickable": "yes|no",
      "gql_title": "Judul untuk modal schema",
      "gql_schema": "Schema GraphQL atau deskripsi endpoint",
      "gql_meta_keys": "Key1|Key2|Key3",
      "gql_meta_vals": "Val1|Val2|Val3",
      "badges": "Tag1|Tag2",
      "note_api": "Catatan tentang API ini"
    }
  ],
  "team": [
    {
      "project_id": "sama dengan project.project_id",
      "role": "Backend dev|Frontend dev|QA Engineer|Business Analyst|Lead",
      "count": "X",
      "name": "Nama jika ada, atau -",
      "sprint_duration": "X minggu",
      "go_live": "tanggal/kuartal",
      "note_team": "Catatan tentang tim (isi di baris pertama saja)"
    }
  ]
}

Jika informasi tidak ada dalam dokumen, gunakan nilai default yang masuk akal atau string kosong.
Untuk budget_idr dan mandays, gunakan angka bulat (integer), bukan string.
Untuk project_id, buat dari nama project: lowercase, replace spasi dengan underscore.
Kembalikan HANYA JSON valid, tanpa penjelasan tambahan, tanpa markdown code block.`;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text, filename } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: 'Teks dokumen terlalu pendek atau kosong' });
    }

    // ── 1. Call FreeModel AI ──────────────────────────
    const aiRes = await fetch(`${FREEMODEL_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': FREEMODEL_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${EXTRACT_PROMPT}\n\n---\nDOKUMEN MEETING NOTES:\n${text.substring(0, 8000)}`
          }
        ]
      })
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      throw new Error(`FreeModel API error: ${err}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '';

    // ── 2. Parse JSON ────────────────────────────────
    let extracted;
    try {
      const clean = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(clean);
    } catch (e) {
      throw new Error(`Gagal parse JSON dari AI: ${rawText.substring(0, 200)}`);
    }

    // ── 3. Save ke Supabase ──────────────────────────
    const saved = { project: null, regulasi: null, apis: [], team: [] };

    // Upsert project
    if (extracted.project?.project_id) {
      const r = await supabaseUpsert('projects', extracted.project, 'project_id');
      saved.project = r;
    }

    // Upsert regulasi
    if (extracted.regulasi?.project_id) {
      const r = await supabaseUpsert('regulasi', extracted.regulasi, 'project_id');
      saved.regulasi = r;
    }

    // Upsert APIs
    for (const api of (extracted.apis || [])) {
      if (api.project_id && api.api_name) {
        const r = await supabaseUpsert('api_schema', api, 'project_id,api_name');
        saved.apis.push(r);
      }
    }

    // Upsert team
    for (const member of (extracted.team || [])) {
      if (member.project_id && member.role) {
        const r = await supabaseUpsert('team_timeline', member, 'project_id,role');
        saved.team.push(r);
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
    console.error('Extract error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function supabaseUpsert(table, data, conflictCol) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(`${url}?on_conflict=${conflictCol}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error(`Supabase ${table} error: ${e}`);
  }
  return r.json();
}
