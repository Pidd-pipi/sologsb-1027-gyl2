export type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned';
export type ProcessStatus = 'draft' | 'in-review' | 'frozen' | 'revising';
export type DiffKind = 'added' | 'removed' | 'changed' | 'impacted';

export interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface ProcessStep {
  id: string;
  title: string;
  purpose: string;
  materials: string;
  equipment: string;
  amount: string;
  duration: number;
  hazards: string[];
  controls: string;
  dependencies: string[];
  safetyNote: string;
  expectedResult: string;
  status: StepStatus;
  comments: ReviewComment[];
}

export interface BatchItem {
  /** 批次内条目键：批次 id + 步骤 id，每次改动会重新生成，使旧确认标记失效 */
  key: string;
  stepId: string;
  /** source = 被研究员改动的步骤；downstream = 依赖链上的下游步骤 */
  role: 'source' | 'downstream';
  reason: string;
  confirmedAt?: string;
}

export interface ReviewBatch {
  id: string;
  number: number;
  sourceStepId: string;
  sourceTitle: string;
  changedFields: string[];
  reason: string;
  createdAt: string;
  createdBy: string;
  status: 'open' | 'completed';
  items: BatchItem[];
  completedAt?: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  note: string;
  author: string;
  steps: ProcessStep[];
  /** 冻结时刻的待复核批次记录（含历史批次），供版本比较追溯本次改动影响了哪些步骤 */
  reviewBatches?: ReviewBatch[];
}

export interface ExperimentProcess {
  id: string;
  title: string;
  code: string;
  objective: string;
  principal: string;
  lab: string;
  status: ProcessStatus;
  version: string;
  steps: ProcessStep[];
  versions: VersionSnapshot[];
  /** 改动产生的待复核批次，已确认完毕的批次保留为历史 */
  reviewBatches: ReviewBatch[];
  frozenAt?: string;
  updatedAt: string;
}

export interface DiffItem {
  id: string;
  title: string;
  kind: DiffKind;
  detail: string;
}

export interface FreezeBlocker {
  key: string;
  label: string;
  detail: string;
}

export const CURRENT_AUTHOR = '周宁';
export const CURRENT_ROLE = '安全复核员';
export const RESEARCHER_NAME = '李明';

export const FIELD_LABELS: Record<string, string> = {
  title: '名称',
  purpose: '操作目的',
  materials: '材料',
  equipment: '设备',
  amount: '用量 / 参数',
  duration: '预计时间',
  hazards: '危险项',
  controls: '控制措施',
  dependencies: '依赖关系',
  safetyNote: '安全说明',
  expectedResult: '预期结果'
};

export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function initialProcess(): ExperimentProcess {
  const baseSteps: ProcessStep[] = [
    {
      id: 'step-1', title: '核对试剂与实验区域', purpose: '确认所需物料、设备及区域状态符合实验方案。',
      materials: '无水乙醇、去离子水', equipment: '通风柜、防爆柜、标签打印机', amount: '乙醇 120 mL；去离子水 300 mL',
      duration: 15, hazards: ['易燃液体'], controls: '在通风柜内取用，远离点火源；使用接地金属容器。',
      dependencies: [], safetyNote: '操作人员需佩戴护目镜和防化手套。', expectedResult: '试剂标签、数量和有效期均核对无误。',
      status: 'confirmed', comments: [
        { id: 'c-1', author: '李明', role: '研究员', text: '已核对批号和有效期，防爆柜温度记录正常。', createdAt: '2026-09-24T09:10:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-2', title: '搭建恒温循环装置', purpose: '连接循环浴与反应夹套，检查密封和温控。',
      materials: '无', equipment: '恒温循环浴、硅胶管、反应夹套、扎带', amount: '循环液 800 mL',
      duration: 25, hazards: ['烫伤', '管路脱落'], controls: '管路双端固定；升温前完成 5 分钟试压并设置独立超温断电。',
      dependencies: ['step-1'], safetyNote: '高温表面设置警示标识，循环浴周围保持干燥。', expectedResult: '30 分钟内温度稳定在 55 ± 0.5 ℃。',
      status: 'confirmed', comments: [
        { id: 'c-2', author: '王颖', role: '安全复核员', text: '补充超温断电值，不能只依赖设备自带温控。', createdAt: '2026-09-24T10:05:00+08:00', resolved: true }
      ]
    },
    {
      id: 'step-3', title: '加入催化剂并启动反应', purpose: '按批次加入催化剂，记录起点并开始计时。',
      materials: '催化剂 A', equipment: '分析天平、加料漏斗、计时器', amount: '催化剂 A 2.50 ± 0.02 g',
      duration: 20, hazards: ['粉尘吸入', '放热反应'], controls: '在通风柜内称量，佩戴 N95 口罩；分三次少量加入并监测温度。',
      dependencies: ['step-2'], safetyNote: '反应温度超过 70 ℃ 时立即停止加料并启动冷却。', expectedResult: '温度缓慢升至 62–66 ℃，无明显冲料。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-4', title: '恒温反应与过程取样', purpose: '维持温度并定时取样观察反应转化。',
      materials: '样品瓶、惰性气体', equipment: '取样针、气相色谱、恒温循环浴', amount: '每点样品约 1 mL，共 6 点',
      duration: 90, hazards: ['高温液体', '挥发性气体'], controls: '取样前泄压；使用长针和防护屏；样品瓶及时封闭。',
      dependencies: ['step-3'], safetyNote: '取样时不得正对瓶口，样品瓶不得完全密封后加热。', expectedResult: '转化率达到 95% 以上且无异常副产物。',
      status: 'submitted', comments: []
    },
    {
      id: 'step-5', title: '停止加热并冷却', purpose: '终止反应并将体系降至安全温度。',
      materials: '无', equipment: '循环浴、温度探头', amount: '降温目标 ≤ 30 ℃', duration: 35,
      hazards: ['烫伤', '残余反应'], controls: '先停止加料并维持搅拌，再以不超过 1 ℃/min 的速率降温。',
      dependencies: ['step-4'], safetyNote: '确认温度连续 5 分钟低于 30 ℃ 后才能拆除装置。', expectedResult: '体系温度稳定低于 30 ℃。',
      status: 'draft', comments: []
    },
    {
      id: 'step-6', title: '废液分类与现场恢复', purpose: '按危险废物要求分类收集并恢复实验区域。',
      materials: '废液桶、吸附棉', equipment: '防化手套、护目镜、危废标签', amount: '按实际产生量记录', duration: 25,
      hazards: ['废液混装', '化学暴露'], controls: '有机废液单独收集，核对相容性后贴标签；泄漏吸附材料按危废处置。',
      dependencies: ['step-5'], safetyNote: '废液不得倒入下水道，现场恢复后完成双人确认。', expectedResult: '废液交接记录完整，台面无残留。',
      status: 'draft', comments: []
    }
  ];

  const firstVersion: VersionSnapshot = {
    id: 'version-1-0', label: '首版批准流程', version: '1.0.0', createdAt: '2026-09-20T14:30:00+08:00',
    note: '建立基础反应与取样步骤。', author: '王颖',
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed' as const, comments: [] }))
  };
  const secondVersion: VersionSnapshot = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', createdAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed' as const, comments: [] }))
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    status: 'in-review', version: '1.2.0-draft',
    steps: baseSteps, versions: [firstVersion, secondVersion], reviewBatches: [], updatedAt: new Date().toISOString()
  };
}

/** 兼容旧版本本地数据：补齐 reviewBatches 字段并裁剪无效批次条目 */
export function normalizeProcess(value: ExperimentProcess): ExperimentProcess {
  const stepIds = new Set(value.steps.map((step) => step.id));
  value.reviewBatches = Array.isArray(value.reviewBatches)
    ? value.reviewBatches.map((batch) => ({
      ...batch,
      items: (batch.items ?? []).filter((item) => stepIds.has(item.stepId))
    })).filter((batch) => batch.items.length > 0 || batch.status === 'open')
    : [];
  value.versions = (value.versions ?? []).map((version) => ({ ...version, reviewBatches: version.reviewBatches ?? [] }));
  return value;
}

export function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
}

export function hasMissingSafety(step: ProcessStep): boolean {
  return step.hazards.length > 0 && (!step.controls.trim() || !step.safetyNote.trim());
}

/** 沿依赖边收集全部直接 / 间接下游步骤 id */
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

function buildBatchItems(batchId: string, sourceId: string, downstreamIds: string[], steps: ProcessStep[]): BatchItem[] {
  const source = steps.find((step) => step.id === sourceId);
  return [
    { key: `${batchId}:${sourceId}`, stepId: sourceId, role: 'source', reason: '本次被改动的步骤，旧确认已失效' },
    ...downstreamIds.map((id) => ({
      key: `${batchId}:${id}`,
      stepId: id,
      role: 'downstream' as const,
      reason: `依赖「${source?.title ?? '上游步骤'}」，随改动一并退回复核`
    }))
  ];
}

/**
 * 研究员改动步骤后的核心联动：
 * 1. 改动步骤与全部下游步骤一律退回待复核（草稿除外，未提交内容不改变状态）；
 * 2. 所有未关闭批次中这些步骤的旧确认标记作废；
 * 3. 同一改动来源步骤并入同一未关闭批次，否则新建待复核批次。
 */
export function registerStepChange(draft: ExperimentProcess, sourceId: string, field: string): void {
  if (draft.status === 'frozen') return;
  const source = draft.steps.find((step) => step.id === sourceId);
  if (!source) return;

  const downstreamIds = collectDownstream(draft.steps, sourceId);
  const affectedIds = [sourceId, ...downstreamIds];
  const fieldLabel = FIELD_LABELS[field] ?? '内容';
  const now = new Date().toISOString();

  const existingBatch = draft.reviewBatches.find(
    (batch) => batch.status === 'open' && batch.sourceStepId === sourceId
  );

  const needsBatch = affectedIds.some((id) => {
    const step = draft.steps.find((item) => item.id === id);
    return step && (step.status === 'confirmed' || step.status === 'submitted' || step.status === 'returned');
  });
  if (!existingBatch && !needsBatch) return;

  // 所有未关闭批次中，被波及步骤的旧确认一律失效
  draft.reviewBatches.forEach((batch) => {
    if (batch.status !== 'open') return;
    batch.items.forEach((item) => {
      if (affectedIds.includes(item.stepId)) item.confirmedAt = undefined;
    });
  });

  // 改动步骤与下游步骤退回待复核
  affectedIds.forEach((id) => {
    const step = draft.steps.find((item) => item.id === id);
    if (step && step.status !== 'draft') step.status = 'submitted';
  });

  const reason = `研究员${RESEARCHER_NAME}修改了「${source.title}」的${fieldLabel}，该步骤及 ${downstreamIds.length} 个下游步骤退回待复核`;

  if (existingBatch) {
    existingBatch.sourceTitle = source.title;
    existingBatch.changedFields = [...new Set([...existingBatch.changedFields, fieldLabel])];
    existingBatch.reason = reason;
    existingBatch.items = buildBatchItems(existingBatch.id, sourceId, downstreamIds, draft.steps);
    existingBatch.createdAt = now;
  } else {
    const id = uid('batch');
    draft.reviewBatches.push({
      id,
      number: draft.reviewBatches.length + 1,
      sourceStepId: sourceId,
      sourceTitle: source.title,
      changedFields: [fieldLabel],
      reason,
      createdAt: now,
      createdBy: RESEARCHER_NAME,
      status: 'open',
      items: buildBatchItems(id, sourceId, downstreamIds, draft.steps)
    });
  }

  // 重新编辑意味着流程重新进入复核环节
  if (draft.status === 'draft') draft.status = 'in-review';
}

/** 复核员逐项确认：对该步骤所属的全部进行中批次盖章；批次内全部确认后批次结束 */
export function confirmStepInBatch(draft: ExperimentProcess, stepId: string, at: string): void {
  const step = draft.steps.find((item) => item.id === stepId);
  if (!step || hasMissingSafety(step)) return;
  step.status = 'confirmed';
  draft.reviewBatches.forEach((batch) => {
    if (batch.status !== 'open') return;
    batch.items.forEach((item) => {
      if (item.stepId === stepId) item.confirmedAt = at;
    });
  });
  closeCompletedBatches(draft, at);
}

export function closeCompletedBatches(draft: ExperimentProcess, at: string): void {
  const stepIds = new Set(draft.steps.map((step) => step.id));
  draft.reviewBatches.forEach((batch) => {
    if (batch.status !== 'open') return;
    batch.items = batch.items.filter((item) => stepIds.has(item.stepId));
    if (batch.items.length > 0 && batch.items.every((item) => item.confirmedAt)) {
      batch.status = 'completed';
      batch.completedAt = at;
    }
  });
}

export function collectFreezeBlockers(process: ExperimentProcess): FreezeBlocker[] {
  const blockers: FreezeBlocker[] = [];
  const openBatches = process.reviewBatches.filter((batch) => batch.status === 'open');
  if (openBatches.length) {
    const pending = openBatches.flatMap((batch) =>
      batch.items.filter((item) => !item.confirmedAt).map((item) => {
        const step = process.steps.find((s) => s.id === item.stepId);
        return step?.title ?? item.stepId;
      })
    );
    blockers.push({
      key: 'batches',
      label: `${openBatches.length} 个待复核批次尚未处理完毕`,
      detail: `待逐项确认：${[...new Set(pending)].join('、') || '批次条目状态待刷新'}`
    });
  }
  const notConfirmed = process.steps.filter((step) => step.status !== 'confirmed');
  if (notConfirmed.length) {
    blockers.push({
      key: 'steps',
      label: `${notConfirmed.length} 个步骤尚未确认`,
      detail: notConfirmed.map((step) => `「${step.title}」(${statusLabelLocal(step.status)})`).join('、')
    });
  }
  const missingSafety = process.steps.filter(hasMissingSafety);
  if (missingSafety.length) {
    blockers.push({
      key: 'safety',
      label: `${missingSafety.length} 个步骤存在安全信息缺口`,
      detail: `${missingSafety.map((step) => `「${step.title}」`).join('、')} 有危险项但缺少控制措施或安全说明`
    });
  }
  return blockers;
}

function statusLabelLocal(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

export function nextMinorVersion(value: string): string {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.2.0';
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function fieldChanged(before: ProcessStep, step: ProcessStep): string[] {
  const fields: string[] = [];
  if (before.title !== step.title) fields.push(FIELD_LABELS.title);
  if (before.purpose !== step.purpose) fields.push(FIELD_LABELS.purpose);
  if (before.materials !== step.materials || before.amount !== step.amount) fields.push('材料或用量');
  if (before.equipment !== step.equipment) fields.push(FIELD_LABELS.equipment);
  if (before.duration !== step.duration) fields.push(FIELD_LABELS.duration);
  if (JSON.stringify(before.hazards) !== JSON.stringify(step.hazards)) fields.push(FIELD_LABELS.hazards);
  if (before.controls !== step.controls || before.safetyNote !== step.safetyNote) fields.push('安全控制');
  if (JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies)) fields.push(FIELD_LABELS.dependencies);
  if (before.expectedResult !== step.expectedResult) fields.push(FIELD_LABELS.expectedResult);
  return fields;
}

/** 版本比较：字段差异之外，标出本次改动沿依赖链影响的下游步骤 */
export function compareVersions(base: VersionSnapshot | undefined, target: VersionSnapshot | undefined): DiffItem[] {
  if (!base || !target) return [];
  const diffs: DiffItem[] = [];
  const targetMap = new Map(target.steps.map((step) => [step.id, step]));
  const baseMap = new Map(base.steps.map((step) => [step.id, step]));

  const changedSources: ProcessStep[] = [];
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (before && fieldChanged(before, step).length) changedSources.push(step);
  });

  // 改动步骤沿目标版本依赖链波及的下游
  const impactedIds = new Set<string>();
  const impactedTitleById = new Map<string, string[]>();
  changedSources.forEach((source) => {
    collectDownstream(target.steps, source.id).forEach((id) => {
      if (id === source.id) return;
      impactedIds.add(id);
      const list = impactedTitleById.get(id) ?? [];
      list.push(source.title);
      impactedTitleById.set(id, list);
    });
  });

  base.steps.forEach((step) => {
    if (!targetMap.has(step.id)) diffs.push({ id: step.id, title: step.title, kind: 'removed', detail: '目标版本已删除该步骤。' });
  });
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      diffs.push({ id: step.id, title: step.title, kind: 'added', detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}` });
      return;
    }
    const fields = fieldChanged(before, step);
    if (fields.length) {
      const impactTitles = collectDownstream(target.steps, step.id)
        .map((id) => targetMap.get(id)?.title)
        .filter((title): title is string => Boolean(title));
      const impactText = impactTitles.length
        ? ` 本次改动影响下游 ${impactTitles.length} 个步骤：${impactTitles.join('、')}。`
        : ' 该步骤无下游步骤受影响。';
      diffs.push({ id: step.id, title: step.title, kind: 'changed', detail: `变化字段：${fields.join('、')}。${impactText}` });
    } else if (impactedIds.has(step.id)) {
      const sources = impactedTitleById.get(step.id) ?? [];
      diffs.push({
        id: `impact-${step.id}`,
        title: step.title,
        kind: 'impacted',
        detail: `步骤内容未变，但受上游改动（${[...new Set(sources)].join('、')}）影响，已随批次退回复核。`
      });
    }
  });
  return diffs;
}
