-- Run once against your Neon database:
--   psql "$DATABASE_URL" -f migrations/0007_api_usage.sql
--
-- Rolls up Gemini API token usage per day + model so the (admin-only) /spend page
-- can show an estimated project cost. The camera POSTs one row's worth of tokens
-- after every identify() call; we aggregate here rather than store a row per call.

create table if not exists api_usage (
  day date not null,
  model text not null,
  calls bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, model)
);
