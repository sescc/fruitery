// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampDiskCacheMB, diskCacheBytes, DEFAULT_DISK_CACHE_MB, MIN_DISK_CACHE_MB, MAX_DISK_CACHE_MB } from '../lib/disk-cache.js';

test('clampDiskCacheMB keeps values in range, rounds, and falls back for non-numbers', () => {
  assert.equal(clampDiskCacheMB(200), 200);
  assert.equal(clampDiskCacheMB(5), MIN_DISK_CACHE_MB);
  assert.equal(clampDiskCacheMB(100000), MAX_DISK_CACHE_MB);
  assert.equal(clampDiskCacheMB(150.6), 151);
  assert.equal(clampDiskCacheMB('x'), DEFAULT_DISK_CACHE_MB);
  assert.equal(clampDiskCacheMB(undefined), DEFAULT_DISK_CACHE_MB);
  assert.equal(clampDiskCacheMB(NaN), DEFAULT_DISK_CACHE_MB);
  assert.equal(clampDiskCacheMB('x', 300), 300);
});

test('the default is 200 MB, lowered from the original 500', () => {
  assert.equal(DEFAULT_DISK_CACHE_MB, 200);
});

test('diskCacheBytes converts the clamped MB to bytes', () => {
  assert.equal(diskCacheBytes(200), 200 * 1024 * 1024);
  assert.equal(diskCacheBytes(5), MIN_DISK_CACHE_MB * 1024 * 1024);
});
