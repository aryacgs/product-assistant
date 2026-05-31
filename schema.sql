-- ═══════════════════════════════════════════════════
-- ProdDev Assistant — Supabase Schema
-- Jalankan di: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════

-- 1. PROJECTS
create table if not exists projects (
  project_id       text primary key,
  project_name     text not null,
  squad            text,
  color_hex        text default '#534AB7',
  initials         text,
  status           text default 'draft' check (status in ('draft','pending','review','approved')),
  go_live          text,
  mandays          integer,
  budget_idr       bigint,
  resource_summary text,
  note_info        text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 2. REGULASI
create table if not exists regulasi (
  id             bigint generated always as identity primary key,
  project_id     text references projects(project_id) on delete cascade,
  dasar_hukum    text,
  fee_per_trx    text,
  limit_per_trx  text,
  operasional    text,
  settlement     text,
  availability   text,
  enkripsi       text,
  badges         text,  -- pipe-separated: "PBI|E2E|Audit"
  note_reg       text,
  gql_title      text,
  gql_schema     text,
  gql_meta_keys  text,  -- pipe-separated
  gql_meta_vals  text,  -- pipe-separated
  updated_at     timestamptz default now(),
  unique(project_id)
);

-- 3. API SCHEMA
create table if not exists api_schema (
  id             bigint generated always as identity primary key,
  project_id     text references projects(project_id) on delete cascade,
  api_name       text not null,
  version        text,
  status         text default 'Active',
  clickable      text default 'no',
  gql_title      text,
  gql_schema     text,
  gql_meta_keys  text,
  gql_meta_vals  text,
  badges         text,
  note_api       text,
  updated_at     timestamptz default now(),
  unique(project_id, api_name)
);

-- 4. TEAM TIMELINE
create table if not exists team_timeline (
  id              bigint generated always as identity primary key,
  project_id      text references projects(project_id) on delete cascade,
  role            text not null,
  count           text default '1',
  name            text default '-',
  sprint_duration text,
  go_live         text,
  note_team       text,
  updated_at      timestamptz default now(),
  unique(project_id, role)
);

-- ═══ SEED DATA ═══════════════════════════════════════

insert into projects (project_id,project_name,squad,color_hex,initials,status,go_live,mandays,budget_idr,resource_summary,note_info) values
('bifast','Transfer Bifast','Squad Transfer','#534AB7','TB','draft','Q4 2026',45,120000000,'3 dev · 1 BA · 1 QA','Pengembangan lanjutan dari Kliring. Beberapa komponen dapat di-reuse untuk efisiensi.'),
('kliring','Transfer Kliring','Squad Transfer','#1D9E75','TK','approved','Mei 2022',30,80000000,'2 dev · 1 BA','Project sudah live. Bisa dijadikan referensi & reuse untuk Bifast.'),
('rtgs','Transfer RTGS','Squad Core','#BA7517','TR','approved','2021',20,55000000,'2 dev · 1 BA','Transfer nilai besar, jam terbatas. Cocok untuk korporasi.'),
('kyc','Onboarding KYC v2','Squad Identity','#D85A30','OK','pending','Q1 2027',38,95000000,'2 dev · 1 BA · 1 QA','Upgrade KYC flow dengan liveness detection.'),
('notif','Notifikasi Real-time','Squad Platform','#185FA5','NR','review','Q3 2026',25,60000000,'2 dev · 1 QA','Push, SMS, dan email unified notification engine.'),
('qr','Merchant QR Payment','Squad Payment','#0F6E56','MQ','approved','Des 2023',50,140000000,'3 dev · 1 BA · 1 QA','QRIS merchant onboarding dan settlement.')
on conflict (project_id) do nothing;

insert into regulasi (project_id,dasar_hukum,fee_per_trx,limit_per_trx,operasional,settlement,availability,enkripsi,badges,note_reg,gql_title,gql_schema,gql_meta_keys,gql_meta_vals) values
('bifast','PBI No.22/23/2020','Rp 2.500','Rp 250.000.000','24 jam / 7 hari','Real-time < 25 dtk','Min 99.9%','End-to-end wajib','PBI 22/23/2020|Enkripsi E2E|Data center RI|Audit log wajib','Wajib lolos sertifikasi BI-FAST dan UAT dari Bank Indonesia sebelum go-live.','PBI BI-FAST 2020','# PBI No.22/23/PBI/2020\n\nLimit       : Rp 250.000.000/trx\nOperasional : 24 jam / 7 hari\nSettlement  : real-time < 25 dtk\nAvailability: min 99.9%','Nomor|Tahun|Limit|Berlaku|Penyelenggara','22/23/PBI/2020|2020|Rp 250 jt/trx|1 Des 2021|Bank Indonesia'),
('kliring','PBI No.17/9/2015','Rp 2.900','Rp 500.000.000','06.00 – 16.30 WIB','T+0, batch 8x/hari','-','-','PBI 17/9/2015|PADG 21/2019|Batch settlement|T+0','Regulasi SKNBI berbeda dengan BI-FAST — batch vs real-time.','PBI SKNBI 2015','# PBI No.17/9/PBI/2015\n\nLimit    : Rp 500.000.000/trx\nBatch    : 8 siklus/hari\nJam ops  : 06.00–16.30 WIB','Nomor|Update|Limit|Batch','17/9/PBI/2015|PADG 21/2019|Rp 500 jt/trx|8x/hari'),
('rtgs','Peraturan BI RTGS','Rp 25.000','Min Rp 100.000.000','06.00 – 18.00 WIB','Gross real-time','-','-','Bank Indonesia|RTGS|High value','Tidak ada perubahan regulasi signifikan sejak 2021.',null,null,null,null)
on conflict (project_id) do nothing;

insert into api_schema (project_id,api_name,version,status,clickable,gql_title,gql_schema,gql_meta_keys,gql_meta_vals,badges,note_api) values
('bifast','transfer.gql','v3.2','Active','yes','GraphQL transfer.graphql v3.2','type Mutation {\n  initiateTransfer(input: TransferInput!): TransferResult!\n}\n\ninput TransferInput {\n  fromAccount: String!\n  toAccount:   String!\n  amount:      Float!\n  channel:     Channel!\n}\n\nenum Channel { BIFAST KLIRING RTGS }','Versi|Update|Reusable|Auth','v3.2|Mar 2024|Ya|OAuth2 + JWT','GraphQL|Kafka|Redis|OAuth2','Schema dari Kliring dapat di-reuse.'),
('bifast','notification.gql','v2.0','Active','yes','GraphQL notification.graphql v2.0','type Subscription {\n  onTransferUpdate(transactionId: ID!): NotificationEvent!\n}\n\nenum NotifType { TRANSFER_SUCCESS TRANSFER_FAILED TRANSFER_PENDING }','Versi|Push|SMS','v2.0|FCM + APNs|Twilio','',''),
('bifast','REST legacy','v1.0','Deprecated','no',null,null,null,null,'','Deprecated Q3 2025.'),
('kliring','kliring.gql','v1.4','Stable','yes','GraphQL kliring.graphql v1.4','type Mutation {\n  initiateKliring(input: KliringInput!): KliringResult!\n}\n\ninput KliringInput {\n  fromAccount: String!\n  toAccount:   String!\n  amount:      Float!\n}','Versi|Status','v1.4|Stable','GraphQL|Kafka|PostgreSQL','Schema mature dan stable.'),
('rtgs','rtgs.gql','v2.1','Stable','yes','GraphQL rtgs.graphql v2.1','type Mutation {\n  initiateRTGS(input: RTGSInput!): RTGSResult!\n}\n\ninput RTGSInput {\n  fromAccount: String!\n  toAccount:   String!\n  amount:      Float!\n  purpose:     String!\n}','Versi|Min amount|Fee','v2.1|Rp 100 jt|Rp 25.000/trx','GraphQL|Core Banking','Schema sederhana.')
on conflict (project_id, api_name) do nothing;

insert into team_timeline (project_id,role,count,name,sprint_duration,go_live,note_team) values
('bifast','Backend dev','2','-','2 minggu','Q4 2026','Overlap dengan Notifikasi Real-time di Agustus.'),
('bifast','Frontend dev','1','-','','',''),
('bifast','QA Engineer','1','-','','',''),
('bifast','Business Analyst','1','-','','',''),
('bifast','Lead / Arch','1','Budi Santoso','','',''),
('kliring','Backend dev','2','-','-','Mei 2022','Tim sudah bubar. Rina bisa jadi konsultan.'),
('kliring','Business Analyst','1','-','','',''),
('kliring','Lead','1','Rina Kusuma','','',''),
('rtgs','Backend dev','2','-','-','2021','Fully handed over ke ops.'),
('rtgs','Business Analyst','1','-','','',''),
('kyc','Backend dev','2','-','2 minggu','Q1 2027','Koordinasi dengan tim Identity untuk liveness SDK.'),
('kyc','Frontend dev','1','-','','',''),
('kyc','QA Engineer','1','-','','',''),
('kyc','Business Analyst','1','-','','',''),
('notif','Backend dev','2','-','2 minggu','Q3 2026','Unified notification engine.'),
('notif','QA Engineer','1','-','','',''),
('qr','Backend dev','3','-','2 minggu','Des 2023','Sudah live. Docs di Confluence.'),
('qr','Frontend dev','1','-','','',''),
('qr','QA Engineer','1','-','','',''),
('qr','Business Analyst','1','-','','',''),
('qr','Lead','1','Dani Wahyu','','','')
on conflict (project_id, role) do nothing;

-- ═══ ENABLE ROW LEVEL SECURITY (public read) ═════════
alter table projects enable row level security;
alter table regulasi enable row level security;
alter table api_schema enable row level security;
alter table team_timeline enable row level security;

create policy "public read projects" on projects for select using (true);
create policy "public read regulasi" on regulasi for select using (true);
create policy "public read api_schema" on api_schema for select using (true);
create policy "public read team_timeline" on team_timeline for select using (true);

create policy "service insert projects" on projects for insert with check (true);
create policy "service update projects" on projects for update using (true);
create policy "service insert regulasi" on regulasi for insert with check (true);
create policy "service update regulasi" on regulasi for update using (true);
create policy "service insert api_schema" on api_schema for insert with check (true);
create policy "service update api_schema" on api_schema for update using (true);
create policy "service insert team_timeline" on team_timeline for insert with check (true);
create policy "service update team_timeline" on team_timeline for update using (true);
