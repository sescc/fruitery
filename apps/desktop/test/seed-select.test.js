// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSeed, isValidSeed } from '../lib/seed-select.js';
import { SEED } from '../../../packages/core/index.js';

const example = /** @type {any} */ (SEED);

test('absent local seed -> the example, as a mutable deep copy', () => {
  const r = selectSeed(null, example);
  assert.equal(r.source, 'example');
  assert.equal(r.seed.items.length, SEED.items.length);
  assert.notEqual(r.seed, example);
  r.seed.items[0].name = 'changed';
  assert.notEqual(SEED.items[0].name, 'changed');
});

test('a valid local seed is used', () => {
  const local = structuredClone(example);
  local.workspaces[0].name = 'Mine';
  const r = selectSeed(JSON.stringify(local), example);
  assert.equal(r.source, 'local');
  assert.equal(r.seed.workspaces[0].name, 'Mine');
});

test('an invalid local seed falls back to the example: bad JSON, bad item, unknown workspace, bad timezone, empty', () => {
  assert.equal(selectSeed('{not json', example).source, 'example');
  const badItem = structuredClone(example);
  badItem.items[0].url = '';
  assert.equal(selectSeed(JSON.stringify(badItem), example).source, 'example');
  const badWs = structuredClone(example);
  badWs.items[0].workspaceId = 'ghost';
  assert.equal(selectSeed(JSON.stringify(badWs), example).source, 'example');
  const badTz = structuredClone(example);
  badTz.settings.timezone = 'Not/AZone';
  assert.equal(selectSeed(JSON.stringify(badTz), example).source, 'example');
  assert.equal(selectSeed('{}', example).source, 'example');
  assert.equal(selectSeed('null', example).source, 'example');
  assert.equal(selectSeed('', example).source, 'example');
  const noWs = structuredClone(example);
  noWs.workspaces = [];
  assert.equal(selectSeed(JSON.stringify(noWs), example).source, 'example');
});

test('duplicate ids and a group of another workspace are invalid', () => {
  const dup = structuredClone(example);
  dup.items[1].id = dup.items[0].id;
  assert.equal(isValidSeed(dup), false);
  const badGroup = structuredClone(example);
  badGroup.groups[0].workspaceId = 'ghost';
  assert.equal(isValidSeed(badGroup), false);
});

test('the example seed itself is valid', () => {
  assert.equal(isValidSeed(structuredClone(example)), true);
});
