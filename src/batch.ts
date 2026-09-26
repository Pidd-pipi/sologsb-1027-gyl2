import type { ExperimentProcess, ProcessStep, ReviewBatch, ReviewBatchItem } from './App';

export const FIELD_LABELS: Array<{ field: keyof ProcessStep; label: string }> = [
  { field: 'title', label: '步骤名称' },
  { field: 'purpose', label: '操作目的' },
  { field: 'materials', label: '材料' },
  { field: 'equipment', label: '设备' },
  { field: 'amount', label: '用量/参数' },
  { field: 'duration', label: '预计时间' },
  { field: 'hazards', label: '危险项' },
  { field: 'controls', label: '控制措施' },
  { field: 'safetyNote', label: '安全说明' },
  { field: 'expectedResult', label: '预期结果' },
  { field: 'dependencies', label: '依赖关系' }
];

export function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

export function changedStepFields(before: ProcessStep, after: ProcessStep): string[] {
  return FIELD_LABELS.filter(({ field }) => {
    const oldValue = before[field];
    const newValue = after[field];
    return Array.isArray(oldValue) || Array.isArray(newValue)
      ? JSON.stringify(oldValue) !== JSON.stringify(newValue)
      : oldValue !== newValue;
  }).map(({ label }) => label);
}

export function collectDownstream(steps: ProcessStep[], sourceId: string | null): string[] {
  if (!sourceId) return [];
  const result = new Set<string>();
  const visit = (id: string) => {
    steps.filter((step) => step.dependencies.includes(id)).forEach((step) => {
      if (result.has(step.id)) return;
      result.add(step.id);
      visit(step.id);
    });
  };
  visit(sourceId);
  return [...result];
}

let uidCounter = 0;
function defaultUid(): string {
  uidCounter += 1;
  return `batch-${Date.now()}-${uidCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 把一次改动登记为待复核批次：改动步骤与全部下游步骤退回待复核，
 * 同一步骤再次改动时，其它未结批次里的旧确认一律作废。
 * 提交复核前的草稿阶段不产生批次；同一步骤 5 分钟内的连续编辑合并为同一批次。
 */
export function registerChangeBatch(draft: ExperimentProcess, sourceId: string, fields: string[], deleted = false, uidFn: () => string = defaultUid): void {
  const source = draft.steps.find((step) => step.id === sourceId);
  if (!source && !deleted) return;
  const now = new Date().toISOString();
  const downstreamIds = collectDownstream(draft.steps, sourceId);
  const affectedIds = deleted ? downstreamIds : [sourceId, ...downstreamIds];
  // 仅当改动触及已提交/已确认/已退回的步骤时才需要复核批次。
  const needsReview = affectedIds.some((id) => draft.steps.find((step) => step.id === id)?.status !== 'draft');
  if (!needsReview) return;

  draft.batches.forEach((batch) => {
    if (batch.closed) return;
    let invalidated = false;
    batch.items.forEach((item) => {
      if (affectedIds.includes(item.stepId) && item.confirmed) {
        item.confirmed = false;
        invalidated = true;
      }
    });
    if (invalidated) batch.updatedAt = now;
  });

  draft.steps.forEach((step) => {
    if (affectedIds.includes(step.id) && step.status !== 'draft') step.status = 'submitted';
  });

  const buildItem = (id: string, downstream: boolean): ReviewBatchItem | null => {
    const step = draft.steps.find((entry) => entry.id === id);
    // 草稿步骤尚未进入复核，不纳入"退回待复核"范围。
    if (!step || step.status === 'draft') return null;
    return { stepId: id, title: step.title, confirmed: false, downstream };
  };

  const latest = draft.batches.at(-1);
  const recentEnough = latest && Date.now() - new Date(latest.createdAt).getTime() < 5 * 60 * 1000;
  if (latest && !latest.closed && !deleted && !latest.deleted && latest.sourceStepId === sourceId && recentEnough) {
    latest.changedFields = [...new Set([...latest.changedFields, ...fields])];
    downstreamIds.forEach((id) => {
      if (!latest.items.some((item) => item.stepId === id)) {
        const item = buildItem(id, true);
        if (item) latest.items.push(item);
      }
    });
    latest.updatedAt = now;
    return;
  }

  const items: ReviewBatchItem[] = [];
  if (!deleted && source) {
    items.push({ stepId: sourceId, title: source.title, confirmed: false, downstream: false });
  }
  downstreamIds.forEach((id) => {
    const item = buildItem(id, true);
    if (item) items.push(item);
  });
  if (!items.length) return;

  draft.batchSeq += 1;
  const batch: ReviewBatch = {
    id: uidFn(),
    code: `RB-${String(draft.batchSeq).padStart(3, '0')}`,
    sourceStepId: sourceId,
    sourceTitle: source?.title ?? '已删除步骤',
    deleted,
    changedFields: fields,
    items,
    createdAt: now,
    updatedAt: now,
    closed: false
  };
  draft.batches.push(batch);
}

/** 删除步骤后清理未结批次里指向该步骤的悬空项，空批次直接结案。 */
export function pruneDeletedBatchItems(draft: ExperimentProcess, deletedId: string): void {
  draft.batches.forEach((batch) => {
    if (batch.closed) return;
    batch.items = batch.items.filter((item) => item.stepId !== deletedId);
    if (!batch.items.length) {
      batch.closed = true;
      batch.closedAt = new Date().toISOString();
    }
  });
}

export function batchConfirmedCount(batch: ReviewBatch): number {
  return batch.items.filter((item) => item.confirmed).length;
}

/** 批次内所有步骤逐项确认后自动结案；仍有未确认项时保持待处理。 */
export function closeCompletedBatches(draft: ExperimentProcess): void {
  const now = new Date().toISOString();
  draft.batches.forEach((batch) => {
    if (!batch.closed && batch.items.length > 0 && batch.items.every((item) => item.confirmed)) {
      batch.closed = true;
      batch.closedAt = now;
    }
  });
}
