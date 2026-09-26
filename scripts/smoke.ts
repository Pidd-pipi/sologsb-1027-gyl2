// 纯逻辑冒烟测试（直接引用 src/logic.ts，验证真实实现）：
// 批次创建/合并、旧确认失效、逐项确认结束批次、冻结拦截、版本比较
import assert from 'node:assert/strict';
import {
  clone,
  collectFreezeBlockers,
  compareVersions,
  confirmStepInBatch,
  initialProcess,
  registerStepChange,
  type ExperimentProcess
} from '../src/logic.ts';

const apply = (process: ExperimentProcess, fn: (draft: ExperimentProcess) => void): ExperimentProcess => {
  const next = clone(process);
  fn(next);
  return next;
};
const change = (process: ExperimentProcess, stepId: string, field: string) =>
  apply(process, (draft) => registerStepChange(draft, stepId, field));
const confirmStep = (process: ExperimentProcess, stepId: string) =>
  apply(process, (draft) => confirmStepInBatch(draft, stepId, new Date().toISOString()));

let p = initialProcess();

// 1. 初始：step-1/2 confirmed，无批次
assert.equal(p.reviewBatches.length, 0);
assert.equal(p.steps[0].status, 'confirmed');

// 2. 研究员改动已确认的 step-1（改名称）→ 生成批次，改动步骤与 5 个下游一起退回
p = change(p, 'step-1', 'title');
assert.equal(p.reviewBatches.length, 1, '应生成 1 个批次');
const b1 = p.reviewBatches[0];
assert.equal(b1.status, 'open');
assert.equal(b1.items.length, 6, '改动步骤 + 5 个下游，共 6 条');
assert.ok(b1.items.every((i) => !i.confirmedAt), '新批次条目均未确认');
assert.equal(p.steps[0].status, 'submitted', '改动步骤退回待复核');
assert.equal(p.steps[1].status, 'submitted', '下游已确认步骤退回待复核');

// 3. 连续编辑同一步骤 → 并入同一批次，字段累加
p = change(p, 'step-1', 'controls');
assert.equal(p.reviewBatches.length, 1, '同一来源步骤应并入同一未关闭批次');
assert.ok(p.reviewBatches[0].changedFields.includes('名称'));
assert.ok(p.reviewBatches[0].changedFields.includes('控制措施'));

// 4. 复核员逐项确认前 3 项 → 批次仍开启
const itemIds = p.reviewBatches[0].items.map((i) => i.stepId);
p = confirmStep(p, itemIds[0]);
p = confirmStep(p, itemIds[1]);
p = confirmStep(p, itemIds[2]);
assert.equal(p.reviewBatches[0].status, 'open', '未全部确认前批次保持开启');
assert.equal(p.steps[0].status, 'confirmed', '逐项确认后步骤恢复已确认');

// 5. 同一步骤再次改动 → 旧确认失效（条目重建），步骤重新退回
p = change(p, 'step-1', 'amount');
const reopened = p.reviewBatches[0];
assert.equal(reopened.items.length, 6);
assert.ok(reopened.items.every((i) => !i.confirmedAt), '再次改动后旧确认全部失效');
assert.equal(p.steps[0].status, 'submitted');
assert.equal(p.steps[1].status, 'submitted');

// 6. 有未确认条目时冻结被拦截，原因含未处理批次
let blockers = collectFreezeBlockers(p);
assert.ok(blockers.some((b) => b.key === 'batches'), '未处理批次必须拦截冻结');
assert.match(blockers[0].detail, /核对试剂/);

// 7. 全部步骤提交后逐项确认完毕 → 批次自动结束
p = apply(p, (draft) => { draft.steps.forEach((s) => { if (s.status === 'draft') s.status = 'submitted'; }); });
p.reviewBatches[0].items.forEach((i) => { p = confirmStep(p, i.stepId); });
assert.equal(p.reviewBatches[0].status, 'completed', '逐项确认完毕后批次自动结束');
assert.ok(p.reviewBatches[0].completedAt);
assert.ok(p.steps.every((s) => s.status === 'confirmed'));

// 8. 批次关闭、全部确认、安全完整 → 可冻结
assert.equal(collectFreezeBlockers(p).length, 0);

// 9. 安全缺口拦截
p = apply(p, (draft) => { draft.steps[0].controls = ''; });
assert.ok(collectFreezeBlockers(p).some((b) => b.key === 'safety'), '安全缺口必须拦截');
p = apply(p, (draft) => { draft.steps[0].controls = '在通风柜内取用，远离点火源；使用接地金属容器。'; });

// 10. 两个互不重叠的批次；确认批次 B 不误关闭批次 A
p = change(p, 'step-5', 'title');
p = change(p, 'step-1', 'title');
// step-5 批次含 step-5/6；step-1 批次含 step-1..6，先确认 step-5 批次自身条目
assert.equal(p.reviewBatches.filter((b) => b.status === 'open').length, 2, '两个来源 → 2 个进行中批次');
const bStep5Id = p.reviewBatches.find((b) => b.sourceStepId === 'step-5' && b.status === 'open')!.id;
p.reviewBatches.find((b) => b.id === bStep5Id)!.items.forEach((i) => { p = confirmStep(p, i.stepId); });
// step-1 新批次仍含 step-1..4 未确认条目，不应结束；step-5/6 条目已顺带盖章
const openStep1Batch = p.reviewBatches.find((b) => b.sourceStepId === 'step-1' && b.status === 'open')!;
assert.ok(openStep1Batch, '另一个批次不应被误关闭');
assert.ok(openStep1Batch.items.some((i) => i.stepId === 'step-5' && i.confirmedAt), '共享的下游条目应顺带盖章');
assert.ok(openStep1Batch.items.some((i) => i.stepId === 'step-1' && !i.confirmedAt), '改动步骤仍需确认');
assert.ok(collectFreezeBlockers(p).some((b) => b.key === 'batches'));
const bStep5After = p.reviewBatches.find((b) => b.id === bStep5Id)!;
assert.equal(bStep5After.status, 'completed', 'step-5 批次自身条目确认完应结束');

// 11. 退回步骤必须拦截冻结
p = apply(p, (draft) => {
  const step = draft.steps.find((s) => s.id === 'step-1')!;
  step.status = 'returned';
});
assert.ok(collectFreezeBlockers(p).some((b) => b.key === 'steps'), '已退回步骤必须拦截冻结');

// 12. 版本比较：改动行写明影响的下游；未改动但被波及的步骤标记“受影响”
p = apply(p, (draft) => {
  draft.steps[0].status = 'confirmed';
  draft.reviewBatches = draft.reviewBatches.filter((b) => b.status === 'completed');
});
// 用 versions[1](1.1.0) 作基准，构造目标版本：step-1 改用量，其余步骤不动
const base = p.versions[1];
const target = clone(base);
const targetStep1 = target.steps.find((s) => s.id === 'step-1')!;
targetStep1.amount = '乙醇 150 mL；去离子水 300 mL';
const diff = compareVersions(base, target);
const changedRow = diff.find((d) => d.kind === 'changed');
assert.ok(changedRow, '应出现修改行');
assert.match(changedRow!.detail, /影响下游 5 个步骤/, '修改行应列出受影响下游步骤');
const impactedRows = diff.filter((d) => d.kind === 'impacted');
assert.equal(impactedRows.length, 5, '其余 5 个内容未变的下游应标记为受影响');
assert.match(impactedRows[0].detail, /核对试剂/);

// 13. 新增与删除仍能识别
const target2 = clone(base);
target2.steps = target2.steps.slice(0, 5);
target2.steps.push({ ...clone(target2.steps[0]), id: 'step-new', title: '新增的淬灭步骤', dependencies: ['step-5'] });
const diff2 = compareVersions(base, target2);
assert.ok(diff2.some((d) => d.kind === 'removed' && d.id === 'step-6'));
assert.ok(diff2.some((d) => d.kind === 'added' && d.id === 'step-new'));

console.log('全部逻辑冒烟测试通过 ✔');
