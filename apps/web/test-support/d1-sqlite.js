// @ts-check
// Test-only D1 stand-in over node:sqlite. It mimics the subset of the D1 API the Worker uses:
// prepare().bind().first()/all()/run(), batch() (atomic), exec(). It only approximates D1 (no
// remote latency, size limits or read replicas).

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('node:sqlite').SQLInputValue} SqlValue */

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * @param {unknown} row
 * @returns {Record<string, unknown>}
 */
function plain(row) {
  // node:sqlite rows have a null prototype; copy to a normal object (as D1 returns).
  return { ...(/** @type {Record<string, unknown>} */ (row)) };
}

class Statement {
  /**
   * @param {DatabaseSync} sqlite
   * @param {string} sql
   * @param {SqlValue[]} params
   */
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  /**
   * @param {...unknown} values
   * @returns {Statement}
   */
  bind(...values) {
    return new Statement(this.sqlite, this.sql, /** @type {SqlValue[]} */ (values.map((v) => (v === undefined ? null : v))));
  }

  /** @returns {Promise<Record<string, unknown> | null>} */
  async first() {
    const row = this.sqlite.prepare(this.sql).get(...this.params);
    return row === undefined ? null : plain(row);
  }

  /** @returns {Promise<{results: Record<string, unknown>[], success: true}>} */
  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.params).map(plain), success: true };
  }

  /** @returns {Promise<{success: true, meta: {changes: number}}>} */
  async run() {
    return this.runSync();
  }

  /** @returns {{success: true, meta: {changes: number}}} */
  runSync() {
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export class FakeD1 {
  /** @param {string} [path] SQLite path, default in-memory */
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
  }

  /**
   * @param {string} sql
   * @returns {Statement}
   */
  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

  /**
   * Run several statements atomically: if any fails, none of them takes effect.
   * @param {Statement[]} statements
   * @returns {Promise<{success: true, meta: {changes: number}}[]>}
   */
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s.runSync());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * @param {string} sql one or more statements
   * @returns {Promise<void>}
   */
  async exec(sql) {
    this.sqlite.exec(sql);
  }

  close() {
    this.sqlite.close();
  }
}

/**
 * Apply every `migrations/*.sql` in filename order.
 * @param {FakeD1} db
 * @param {string} [dir] defaults to apps/web/migrations
 * @returns {Promise<string[]>} the applied file names
 */
export async function applyMigrations(db, dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) await db.exec(readFileSync(join(dir, f), 'utf8'));
  return files;
}

/**
 * A fresh in-memory database with all migrations applied.
 * @returns {Promise<FakeD1>}
 */
export async function createMigratedDb() {
  const db = new FakeD1();
  await applyMigrations(db);
  return db;
}
