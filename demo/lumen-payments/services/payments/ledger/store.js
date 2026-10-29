// Payout ledger repository. A payout writes its ledger entry and moves the merchant balance in one
// transaction, so reconciliation never sees one without the other.
import pg from 'pg';

const pool = new pg.Pool();

export async function recordPayout({ merchantId, amountMinor, currency, reference }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO ledger_entries (merchant_id, kind, amount_minor, currency, reference) VALUES ($1, $2, $3, $4, $5)',
      [merchantId, 'payout', amountMinor, currency, reference],
    );
    await client.query('UPDATE merchant_balances SET available_minor = available_minor - $2 WHERE merchant_id = $1', [merchantId, amountMinor]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function entriesFor(merchantId, { limit = 100 } = {}) {
  const { rows } = await pool.query('SELECT * FROM ledger_entries WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2', [merchantId, limit]);
  return rows;
}
