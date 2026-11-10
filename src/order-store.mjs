import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CheckoutError } from './checkout-contract.mjs';

export class OrderStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, provider_id TEXT UNIQUE, capture_id TEXT UNIQUE,
        create_request_id TEXT NOT NULL UNIQUE, capture_request_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL, paid INTEGER NOT NULL CHECK(paid IN (0,1)),
        record TEXT NOT NULL CHECK(json_valid(record)), CHECK(paid=0 OR capture_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS entitlements (
        business_order_id TEXT PRIMARY KEY REFERENCES orders(id), capture_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS experiment_runs (
        id TEXT PRIMARY KEY, business_order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
        revision INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))
      );`);
  }
  get(id) {
    const row = this.db.prepare('SELECT record FROM orders WHERE id=?').get(id);
    if (!row) throw new CheckoutError('ORDER_NOT_FOUND', 404);
    return JSON.parse(row.record);
  }
  list() { return this.db.prepare('SELECT record FROM orders ORDER BY rowid DESC LIMIT 50').all().map(r => JSON.parse(r.record)); }
  insert(order) {
    this.db.prepare('INSERT INTO orders VALUES (?,NULL,NULL,?,?,?,0,?)').run(order.id, order.createRequestId, order.captureRequestId, order.revision, JSON.stringify(order));
    return order;
  }
  save(order) {
    const next = { ...order, revision: order.revision + 1 };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(`UPDATE orders SET provider_id=?,capture_id=?,revision=?,paid=?,record=? WHERE id=? AND revision=?`)
        .run(next.paypalOrderId, next.captureId, next.revision, Number(next.paid), JSON.stringify(next), next.id, order.revision);
      if (result.changes !== 1) throw new CheckoutError('ORDER_CHANGED_RELOAD_REQUIRED', 409);
      if (next.paid) this.db.prepare('INSERT INTO entitlements VALUES (?,?) ON CONFLICT(business_order_id) DO NOTHING').run(next.id, next.captureId);
      this.db.exec('COMMIT');
      return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  fulfillmentCount(id) { return this.db.prepare('SELECT count(*) AS count FROM entitlements WHERE business_order_id=?').get(id).count; }
  entitlementCaptures(id) { return this.db.prepare('SELECT capture_id FROM entitlements WHERE business_order_id=? ORDER BY capture_id').all(id).map(r => r.capture_id); }
  getRun(id) {
    const row = this.db.prepare('SELECT record FROM experiment_runs WHERE id=?').get(id);
    if (!row) throw new CheckoutError('RUN_NOT_FOUND', 404);
    return JSON.parse(row.record);
  }
  listRuns() { return this.db.prepare('SELECT record FROM experiment_runs ORDER BY rowid DESC LIMIT 50').all().map(r => JSON.parse(r.record)); }
  insertRun(run) {
    this.db.prepare('INSERT INTO experiment_runs VALUES (?,?,?,?)').run(run.id, run.businessOrderId, run.revision, JSON.stringify(run));
    return run;
  }
  saveRun(run) {
    const next = { ...run, revision: run.revision + 1 };
    const result = this.db.prepare('UPDATE experiment_runs SET revision=?,record=? WHERE id=? AND revision=?')
      .run(next.revision, JSON.stringify(next), next.id, run.revision);
    if (result.changes !== 1) throw new CheckoutError('RUN_CHANGED_RELOAD_REQUIRED', 409);
    return next;
  }
  close() { this.db.close(); }
}
