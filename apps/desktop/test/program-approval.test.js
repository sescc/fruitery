// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_APPROVED, MAX_PROGRAM_PATH, normalizeProgramPath, sanitizeApprovedPrograms, needsConfirm, approveProgram, afterAnswer } from '../lib/program-approval.js';

test('normalizeProgramPath: case, slashes, repeated and trailing backslashes', () => {
  assert.equal(normalizeProgramPath('C:\\Apps\\Tool.EXE'), 'c:\\apps\\tool.exe');
  assert.equal(normalizeProgramPath('c:/apps/tool.exe'), 'c:\\apps\\tool.exe');
  assert.equal(normalizeProgramPath('C:\\\\Apps\\\\\\Tool.exe'), 'c:\\apps\\tool.exe');
  assert.equal(normalizeProgramPath('  C:\\Apps\\Tool.exe  '), 'c:\\apps\\tool.exe');
  assert.equal(normalizeProgramPath('C:\\Apps\\'), 'c:\\apps');
  assert.equal(normalizeProgramPath('C:\\'), 'c:\\', 'a drive root keeps its backslash');
  assert.equal(normalizeProgramPath('\\\\Server\\Share\\Tool.exe'), '\\\\server\\share\\tool.exe', 'a network path keeps its leading \\\\');
  assert.equal(normalizeProgramPath('//server/share/tool.exe'), '\\\\server\\share\\tool.exe');
});

test('needsConfirm: unknown paths ask; approved paths do not, whatever the case or slashes', () => {
  const approved = ['C:\\Apps\\Tool.exe'];
  assert.equal(needsConfirm('C:\\Apps\\Tool.exe', approved), false);
  assert.equal(needsConfirm('c:\\apps\\tool.EXE', approved), false, 'case-insensitive');
  assert.equal(needsConfirm('C:/Apps/Tool.exe', approved), false, 'forward slashes');
  assert.equal(needsConfirm('C:\\\\Apps\\Tool.exe', approved), false, 'doubled backslash');
  assert.equal(needsConfirm('C:\\Apps\\Other.exe', approved), true);
  assert.equal(needsConfirm('C:\\Apps\\Tool.exe.bat', approved), true, 'only the exact program');
  assert.equal(needsConfirm('C:\\Other\\Apps\\Tool.exe', approved), true);
  assert.equal(needsConfirm('C:\\Apps\\Tool.exe', []), true);
  assert.equal(needsConfirm('C:\\Apps\\Tool.exe', undefined), true);
  assert.equal(needsConfirm('C:\\Apps\\Tool.exe', 'C:\\Apps\\Tool.exe'), true, 'junk list');
});

test('needsConfirm: an empty or non-string path always asks', () => {
  for (const p of ['', '   ', null, undefined, 5]) assert.equal(needsConfirm(/** @type {any} */ (p), ['']), true);
});

test('sanitizeApprovedPrograms: strings only, trimmed, no blanks, no duplicates, junk -> []', () => {
  for (const junk of [undefined, null, 'x', 5, {}, true]) assert.deepEqual(sanitizeApprovedPrograms(junk), []);
  assert.deepEqual(sanitizeApprovedPrograms([' C:\\a.exe ', 5, null, '', '  ', {}, ['x'], 'D:\\b.exe']), ['C:\\a.exe', 'D:\\b.exe']);
  assert.deepEqual(sanitizeApprovedPrograms(['C:\\A.exe', 'c:/a.exe', 'C:\\\\a.EXE']), ['C:\\A.exe'], 'same program once (first spelling kept)');
  assert.deepEqual(sanitizeApprovedPrograms(['C:\\a\nb.exe', 'C:\\ok.exe']), ['C:\\ok.exe'], 'control characters are dropped');
});

test('sanitizeApprovedPrograms: length caps', () => {
  const long = `C:\\${'x'.repeat(MAX_PROGRAM_PATH)}`;
  const edge = `C:\\${'y'.repeat(MAX_PROGRAM_PATH - 3)}`;
  assert.equal(edge.length, MAX_PROGRAM_PATH);
  assert.deepEqual(sanitizeApprovedPrograms([long, edge]), [edge]);
  const many = Array.from({ length: MAX_APPROVED + 20 }, (_, i) => `C:\\p${i}.exe`);
  const kept = sanitizeApprovedPrograms(many);
  assert.equal(kept.length, MAX_APPROVED);
  assert.equal(kept.at(-1), `C:\\p${MAX_APPROVED + 19}.exe`, 'the newest are kept');
});

test('approveProgram: adds once, case and slash variants are the same program, unusable paths change nothing', () => {
  assert.deepEqual(approveProgram([], 'C:\\a.exe'), ['C:\\a.exe']);
  assert.deepEqual(approveProgram(['C:\\a.exe'], 'c:/A.EXE'), ['C:\\a.exe']);
  assert.deepEqual(approveProgram(['C:\\a.exe'], 'D:\\b.exe'), ['C:\\a.exe', 'D:\\b.exe']);
  assert.deepEqual(approveProgram(undefined, 'C:\\a.exe'), ['C:\\a.exe']);
  assert.deepEqual(approveProgram(['C:\\a.exe'], ''), ['C:\\a.exe']);
  assert.deepEqual(approveProgram(['C:\\a.exe'], /** @type {any} */ (null)), ['C:\\a.exe']);
  assert.equal(needsConfirm('C:\\a.exe', approveProgram([], 'C:\\a.exe')), false);
});

test('afterAnswer: Start launches; Don\u2019t start uses the fallback when there is one, else nothing', () => {
  assert.equal(afterAnswer(true, true), 'launch');
  assert.equal(afterAnswer(true, false), 'launch');
  assert.equal(afterAnswer(false, true), 'fallback');
  assert.equal(afterAnswer(false, false), 'none');
});