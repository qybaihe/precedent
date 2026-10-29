-- Payout ledger: one row per money movement. Finance reconciles and audits it with SQL every night.
CREATE TABLE ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  merchant_id   TEXT        NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('payout', 'refund', 'fee', 'adjustment')),
  amount_minor  BIGINT      NOT NULL,
  currency      CHAR(3)     NOT NULL,
  reference     TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE merchant_balances (
  merchant_id     TEXT   PRIMARY KEY,
  available_minor BIGINT NOT NULL DEFAULT 0
);
