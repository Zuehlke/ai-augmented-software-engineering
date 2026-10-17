import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchVerdicts, findVerdict } from '../src/workflows/text';

test('a verdict the agent wrapped in markdown still counts, one without markdown is read as written', () => {
  const keywords = ['APPROVE', 'REJECT'] as const;
  assert.deepEqual(findVerdict('agent/ticket-1: APPROVE', keywords, 'agent/ticket-1'), { kind: 'APPROVE', reason: '' });
  assert.deepEqual(findVerdict('**agent/ticket-1: APPROVE**', keywords, 'agent/ticket-1'), { kind: 'APPROVE', reason: '' });
  assert.deepEqual(findVerdict('- `agent/ticket-1: REJECT, no test for `status``', keywords, 'agent/ticket-1'), { kind: 'REJECT', reason: 'no test for `status' });
  assert.deepEqual(findVerdict('REJECT: uses `on_time`', keywords), { kind: 'REJECT', reason: 'uses `on_time`' }); // nothing stripped
  assert.equal(findVerdict('agent/ticket-2: APPROVE', keywords, 'agent/ticket-1'), undefined);
});

test('the review’s verdict lines', () => {
  const review = 'Thoughts: ok.\n\n- **agent/ticket-1: REJECT, no test**\nagent/ticket-2: APPROVE\nNot a verdict: APPROVE';
  assert.deepEqual(branchVerdicts(review), ['agent/ticket-1: REJECT, no test', 'agent/ticket-2: APPROVE']);
  assert.deepEqual(branchVerdicts('I approve it.'), []);
});
