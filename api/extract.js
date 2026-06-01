// api/extract.js — Vercel Serverless Function
// OpenRouter dengan auto-fallback model → Supabase

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const OR_KEY       = process.env.OPENROUTER_API_KEY;

// Semua model dari env var AI_MODEL, pisahkan dengan | (pipe)
// Contoh: qwen/qwen3-8b:free|mistralai/mistral-7b-instruct:free|google/gemma-3-12b-it:free
const AI_MODELS_RAW = process.env.AI_MODEL || 'qwen/qwen3-8b:free|qwen/qwen-2.5-7b-instruct:free|mistralai/mistral-7b-instruct:free|google/gemma-3-12b-it:free|meta-llama/llama-3.2-3b-instruct:free|microsoft/phi-4-reasoning-plus:free';
const allModels = AI_MODELS_RAW.split('|').map(m => m.trim()).filter(Boolean);

const PROMPT = `Kamu adalah AI assistant untuk tim Product Development perbankan Indonesia.
Extract informasi dari dokumen berikut ke JSON.
KEMBALIKAN HANYA JSON VALID, tidak ada teks lain, tidak ada markdown code block.

{
  "project": {
    "project_id": "lowercase_underscore_dari_nama_project",
    "project_name": "Nama lengkap project",
    "squad": "Nama squad/tim",
    "color_hex": "#534AB7",
    "initials": "2HURUF",
    "status": "draft",
    "go_live": "Q4 2026",
    "mandays": 0,
    "budget_idr": 0,
    "resource_summary": "X dev · X BA · X QA",
    "note_info": "Insight penting"
  },
  "regulasi": {
    "project_id": "sama_dengan_project_id",
    "dasar_hukum": "Nama PBI atau regulasi",
    "fee_per_trx": "Rp X.XXX atau Gratis",
    "limit_per_trx": "Rp X.XXX.XXX",
    "operasional": "24 jam / 7 hari",
    "settlement": "Real-time",
    "availability": "Min 99.9%",
    "enkripsi": "",
    "badges": "Tag1|Tag2|Tag3",
    "note_reg": "Catatan regulasi penting"
  },
  "apis": [{
    "project_id": "sama_dengan_project_id",
    "api_name": "nama-endpoint.gql",
    "version": "v1.0",
    "status": "Active",
    "clickable": "yes",
    "gql_title": "Judul untuk modal",
    "gql_schema": "type Mutation { ... }",
    "gql_meta_keys": "Key1|Key2",
    "gql_meta_vals": "Val1|Val2",
    "badges": "GraphQL|Kafka",
    "note_api": "Catatan API"
  }],
  "team": [{
    "project_id": "sama_dengan_project_id",
    "role": "Backend dev",
    "count": "1",
    "name": "Nama atau -",
    "sprint_duration": "2 minggu",
    "go_live": "",
    "note_team": "Catatan tim (hanya di baris pertama)"
  }]
}

Aturan ekstraksi:
- project_id: huruf kecil semua, spasi → underscore
- mandays, budget_idr: angka bulat saja, tanpa simbol
- color_hex pilih berdasar karakter project:
  #534AB7 = payment/transfer | #1D9E75 = completed/green | 
  #BA7517 = warning/oranye | #D85A30 = merah/urgent | #185FA5 = biru/info
- initials: 2 huruf kapital dari singkatan nama project
- Field tidak ada: isi string kosong ""
- badges: pisahkan dengan karakter | (pipe)
- Dokumen bisa berupa email, notulen, chat — tetap extract dengan baik

DOKUMEN:
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

    // Model list sudah disiapkan dari env var di atas

    let rawText = '';
    let modelUsed = '';
    let lastError = '';

    // ── 1. Try models until one works ──────────────────
    for (const model of allModels) {
      try {
        console.log(`Trying model: ${model}`);
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OR_KEY}`,
            'HTTP-Referer': 'https://proddev-assistant.vercel.app',
            'X-Title': 'ProdDev Assistant',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'Kamu mengekstrak data dari dokumen menjadi JSON terstruktur. Selalu balas HANYA dengan JSON valid tanpa markdown atau penjelasan apapun.'
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

        // Skip model jika 429 atau 404
        if (aiRes.status === 429 || aiRes.status === 404) {
          const errBody = await aiRes.text();
          lastError = `${model} → ${aiRes.status}: ${errBody.substring(0, 100)}`;
          console.log(`Skip ${model}: ${aiRes.status}`);
          continue;
        }

        if (!aiRes.ok) {
          const errBody = await aiRes.text();
          lastError = `${model} → ${aiRes.status}: ${errBody.substring(0, 100)}`;
          continue;
        }

        const aiData = await aiRes.json();
        const content = aiData?.choices?.[0]?.message?.content || '';

        if (!content || content.trim().length < 10) {
          lastError = `${model} → empty response`;
          continue;
        }

        rawText = content;
        modelUsed = model;
        break; // sukses, stop loop

      } catch (fetchErr) {
        lastError = `${model} → ${fetchErr.message}`;
        continue;
      }
    }

    if (!rawText) {
      throw new Error(`Semua model gagal. Error terakhir: ${lastError}`);
    }

    // ── 2. Parse JSON ───────────────────────────────────
    let extracted;
    try {
      // Coba ambil JSON block dari response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const clean = jsonMatch
        ? jsonMatch[0]
        : rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(clean);
    } catch (e) {
      throw new Error(`Gagal parse JSON dari ${modelUsed}: ${rawText.substring(0, 200)}`);
    }

    if (!extracted.project?.project_id)
      throw new Error('AI tidak berhasil mengidentifikasi project dari dokumen ini');

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
      model_used: modelUsed,
      saved
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
  if (!r.ok) throw new Error(`Supabase ${table}: ${(await r.text()).substring(0, 200)}`);
  return r.json();
}
