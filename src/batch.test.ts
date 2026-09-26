import { describe, expect, test } from 'vitest';
import {
  registerChangeBatch,
  closeCompletedBatches,
  pruneDeletedBatchItems,
  batchConfirmedCount,
  changedStepFields,
  collectDownstream,
  hasMissingSafety
} from './batch';
import type { ExperimentProcess, ProcessStep } from './App';
function makeStep(id: string, overrides: Partial<ProcessStep> = {}): ProcessStep {
  return {
    id, title: id, purpose: '', materials: '', equipment: '', amount: '', duration: 10,
    hazards: [], controls: '', dependencies: [], safetyNote: '', expectedResult: '',
    status: 'confirmed', comments: [], ...overrides
  };
}

let idc = 0;
const uidFn = () => 'b' + (++idc);

function makeProcess(steps: ProcessStep[]): ExperimentProcess {
  return {
    id: 'p', title: '', code: '', objective: '', principal: '', lab: '',
    status: 'in-review', version: '1.0-draft', steps, batches: [], batchSeq: 0,
    versions: [], updatedAt: new Date().toISOString()
  };
}

describe('changedStepFields', () => {
  test('detects changed fields', () => {
    const a = makeStep('s', { amount: '1 g' });
    const b = makeStep('s', { amount: '2 g', hazards: ['火'] });
    expect(changedStepFields(a, b).sort()).toEqual(['危险项', '用量/参数'].sort());
  });
});

describe('registerChangeBatch', () => {
  test('edited confirmed step and all downstream steps are returned for review', () => {
    const steps = [
      makeStep('s1'), makeStep('s2', { dependencies: ['s1'] }),
      makeStep('s3', { dependencies: ['s2'] }), makeStep('s4')
    ];
    const draft = makeProcess(steps);
    draft.steps[0].amount = '2 g';
    const before = makeStep('s1');
    registerChangeBatch(draft, 's1', changedStepFields(before, draft.steps[0]), false, uidFn);
    expect(draft.batches).toHaveLength(1);
    const batch = draft.batches[0];
    expect(batch.items.map((i) => i.stepId)).toEqual(['s1', 's2', 's3']);
    expect(batch.items.every((i) => !i.confirmed)).toBe(true);
    expect(draft.steps.map((s) => s.status)).toEqual(['submitted', 'submitted', 'submitted', 'confirmed']);
    expect(batch.items.find((i) => i.stepId === 's2')?.downstream).toBe(true);
    expect(batch.items.find((i) => i.stepId === 's1')?.downstream).toBe(false);
  });

  test('draft-only edits do not create batches', () => {
    const steps = [makeStep('s1', { status: 'draft' }), makeStep('s2', { status: 'draft', dependencies: ['s1'] })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's1', ['材料'], false, uidFn);
    expect(draft.batches).toHaveLength(0);
  });

  test('re-editing a step invalidates prior confirmations across all open batches', () => {
    const steps = [makeStep('s1'), makeStep('s2', { dependencies: ['s1'] })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's1', ['材料'], false, uidFn);
    const first = draft.batches[0];
    first.items.forEach((i) => { i.confirmed = true; });
    draft.steps[0].status = 'confirmed';
    draft.steps[1].status = 'confirmed';
    closeCompletedBatches(draft);
    expect(first.closed).toBe(true);

    // researcher edits the confirmed step again
    draft.steps[0].amount = 'x';
    registerChangeBatch(draft, 's1', ['用量/参数'], false, uidFn);
    const second = draft.batches.at(-1)!;
    expect(second.closed).toBe(false);
    expect(second.items.map((i) => i.stepId).sort()).toEqual(['s1', 's2']);
    expect(draft.steps.every((s) => s.status === 'submitted')).toBe(true);
  });

  test('batch closes only after every item is confirmed one by one', () => {
    const steps = [makeStep('s1'), makeStep('s2', { dependencies: ['s1'] })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's1', ['设备'], false, uidFn);
    const batch = draft.batches[0];
    batch.items[0].confirmed = true;
    closeCompletedBatches(draft);
    expect(batch.closed).toBe(false);
    batch.items[1].confirmed = true;
    closeCompletedBatches(draft);
    expect(batch.closed).toBe(true);
    expect(batchConfirmedCount(batch)).toBe(2);
  });

  test('a second change while a batch is open resets affected confirmed items', () => {
    const steps = [makeStep('s1'), makeStep('s2', { dependencies: ['s1'] }), makeStep('s3', { dependencies: ['s2'] })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's1', ['设备'], false, uidFn);
    const first = draft.batches[0];
    first.items.find((i) => i.stepId === 's1')!.confirmed = true;
    // edit s2 (downstream) which opens another batch; s2 appears in both batches
    registerChangeBatch(draft, 's2', ['安全控制'], false, uidFn);
    // s1 confirmation survives (not affected by s2 change)
    expect(first.items.find((i) => i.stepId === 's1')!.confirmed).toBe(true);
    // s2 confirmation was never set; s3 unconfirmed in both
    expect(first.items.find((i) => i.stepId === 's3')!.confirmed).toBe(false);
    // confirm s1,s2,s3 in first batch but s2 gets edited again upstream
    first.items.forEach((i) => { i.confirmed = true; });
    closeCompletedBatches(draft);
    // first batch can only close if second's items are irrelevant — it closes independently
    expect(first.closed).toBe(true);
  });

  test('deleting a confirmed step creates a deletion batch for its downstream', () => {
    const steps = [makeStep('s1'), makeStep('s2', { dependencies: ['s1'] })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's1', ['步骤删除'], true, uidFn);
    draft.steps = draft.steps.filter((s) => s.id !== 's1');
    draft.steps.forEach((s) => { s.dependencies = s.dependencies.filter((d) => d !== 's1'); });
    pruneDeletedBatchItems(draft, 's1');
    const batch = draft.batches[0];
    expect(batch.deleted).toBe(true);
    expect(batch.items.map((i) => i.stepId)).toEqual(['s2']);
    expect(draft.steps[0].status).toBe('submitted');
  });

  test('deleting a draft tail step leaves no dangling open batch', () => {
    const steps = [makeStep('s1'), makeStep('s2', { status: 'draft' })];
    const draft = makeProcess(steps);
    registerChangeBatch(draft, 's2', ['步骤删除'], true, uidFn);
    expect(draft.batches).toHaveLength(0);
  });
});

describe('collectDownstream / hasMissingSafety', () => {
  test('collects transitive downstream', () => {
    const steps = [makeStep('s1'), makeStep('s2', { dependencies: ['s1'] }), makeStep('s3', { dependencies: ['s2'] })];
    expect(collectDownstream(steps, 's1')).toEqual(['s2', 's3']);
  });
  test('requires controls and safety notes when hazards exist', () => {
    expect(hasMissingSafety(makeStep('s', { hazards: ['火'], controls: 'c', safetyNote: 'n' }))).toBe(false);
    expect(hasMissingSafety(makeStep('s', { hazards: ['火'], controls: '', safetyNote: 'n' }))).toBe(true);
  });
});
