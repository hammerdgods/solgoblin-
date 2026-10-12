-- YieldGoblin schema. Stores public on-chain-derived data only:
-- no private keys, seed phrases, emails or other personal data.
--
-- Access model: RLS is ENABLED on every table and NO policies are granted to
-- the anon/authenticated roles, so the public anon key cannot read or write.
-- The Next.js server uses SUPABASE_SERVICE_ROLE_KEY (server-only env var).

create table if not exists strategy_snapshots (
  id uuid primary key,
  opportunity_id text not null,
  protocol text not null,
  asset text not null check (asset in ('SOL', 'USDC')),
  network text not null check (network in ('mainnet-beta', 'devnet', 'localnet')),
  rate_type text not null,
  apy double precision not null check (apy >= 0 and apy <= 1),
  source_kind text not null check (source_kind in ('live', 'demo')),
  source_name text not null,
  fetched_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists strategy_snapshots_opp_created_idx on strategy_snapshots (opportunity_id, created_at desc);

create or replace view latest_strategy_snapshots as
  select distinct on (opportunity_id) *
  from strategy_snapshots
  order by opportunity_id, created_at desc;

create table if not exists agent_recommendations (
  id uuid primary key,
  wallet text check (wallet is null or wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  mode text not null check (mode in ('live', 'demo')),
  engine text not null check (engine in ('deterministic', 'ai-assisted')),
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_recommendations_wallet_created_idx on agent_recommendations (wallet, created_at desc);

create table if not exists portfolio_snapshots (
  id uuid primary key,
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  network text not null,
  sol_balance double precision not null check (sol_balance >= 0),
  usdc_balance double precision not null check (usdc_balance >= 0),
  positions jsonb not null default '[]'::jsonb,
  sol_usd double precision,
  usdc_usd double precision,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_snapshots_wallet_created_idx on portfolio_snapshots (wallet, created_at desc);

create table if not exists transaction_events (
  id uuid primary key,
  wallet text not null check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  network text not null,
  opportunity_id text not null,
  action text not null check (action in ('kamino-deposit', 'native-stake')),
  asset text not null,
  amount double precision not null check (amount > 0),
  status text not null check (status in ('prepared', 'submitted', 'confirmed', 'failed', 'expired')),
  signature text unique,
  fee_lamports bigint,
  message_hash text not null,
  last_valid_block_height bigint not null,
  error text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transaction_events_wallet_created_idx on transaction_events (wallet, created_at desc);

create table if not exists alerts (
  id uuid primary key,
  type text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail text not null,
  opportunity_id text,
  wallet text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists alerts_created_idx on alerts (created_at desc);
create index if not exists alerts_wallet_created_idx on alerts (wallet, created_at desc);

alter table strategy_snapshots enable row level security;
alter table agent_recommendations enable row level security;
alter table portfolio_snapshots enable row level security;
alter table transaction_events enable row level security;
alter table alerts enable row level security;

-- The view must respect the underlying table's RLS.
alter view latest_strategy_snapshots set (security_invoker = true);
