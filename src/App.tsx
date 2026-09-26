import { useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Divider,
  Elevation,
  FormGroup,
  HTMLSelect,
  Icon,
  InputGroup,
  ProgressBar,
  Tab,
  Tabs,
  Tag,
  TextArea
} from '@blueprintjs/core';
import {
  clone,
  closeCompletedBatches,
  collectDownstream,
  collectFreezeBlockers,
  compareVersions,
  confirmStepInBatch,
  CURRENT_AUTHOR,
  CURRENT_ROLE,
  hasMissingSafety,
  initialProcess,
  nextMinorVersion,
  normalizeProcess,
  registerStepChange,
  splitList,
  uid,
  type ExperimentProcess,
  type FreezeBlocker,
  type ProcessStatus,
  type ProcessStep,
  type ReviewBatch,
  type StepStatus
} from './logic';

type ViewId = 'editor' | 'review' | 'compare';

interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v1';

function historyReducer(state: HistoryState, action:
  | { type: 'commit'; update: (draft: ExperimentProcess) => void }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: ExperimentProcess }
): HistoryState {
  if (action.type === 'commit') {
    const next = clone(state.present);
    action.update(next);
    next.updatedAt = new Date().toISOString();
    return { past: [...state.past.slice(-59), clone(state.present)], present: next, future: [] };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { past: state.past.slice(0, -1), present: previous, future: [clone(state.present), ...state.future].slice(0, 60) };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return { past: [...state.past, clone(state.present)].slice(-60), present: next, future: state.future.slice(1) };
  }
  return { past: [], present: action.value, future: [] };
}

function loadProcess(): ExperimentProcess {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return initialProcess();
    const parsed = normalizeProcess(JSON.parse(value) as ExperimentProcess);
    return parsed.id && Array.isArray(parsed.steps) ? parsed : initialProcess();
  } catch {
    return initialProcess();
  }
}

function statusLabel(status: StepStatus): string {
  return status === 'confirmed' ? '已确认' : status === 'returned' ? '已退回' : status === 'submitted' ? '待复核' : '草稿';
}

function processStatusLabel(status: ProcessStatus): string {
  return status === 'frozen' ? '已冻结' : status === 'in-review' ? '复核中' : status === 'revising' ? '修订中' : '草稿';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: loadProcess(), future: [] }));
  const process = history.present;
  const [selectedStepId, setSelectedStepId] = useState(process.steps[0]?.id ?? '');
  const [activeView, setActiveView] = useState<ViewId>('editor');
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [savedLabel, setSavedLabel] = useState('本地数据已载入');
  const [online, setOnline] = useState(true);
  const [compareBaseId, setCompareBaseId] = useState(process.versions[0]?.id ?? '');
  const [compareTargetId, setCompareTargetId] = useState(process.versions.at(-1)?.id ?? '');
  const [freezeBlockers, setFreezeBlockers] = useState<FreezeBlocker[] | null>(null);
  const initialSaveSkipped = useRef(false);

  const selectedStep = process.steps.find((step) => step.id === selectedStepId) ?? process.steps[0];
  const downstreamIds = useMemo(() => collectDownstream(process.steps, lastModifiedId), [process.steps, lastModifiedId]);
  const impactedSteps = process.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = process.steps.filter(hasMissingSafety);
  const openBatches = process.reviewBatches.filter((batch) => batch.status === 'open');
  const completedBatches = process.reviewBatches.filter((batch) => batch.status === 'completed');
  const pendingItemStepIds = useMemo(() => new Set(
    openBatches.flatMap((batch) => batch.items.filter((item) => !item.confirmedAt).map((item) => item.stepId))
  ), [openBatches]);
  const pendingReviewCount = process.steps.filter((step) => step.status === 'submitted' || step.status === 'returned').length;
  const confirmedCount = process.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = process.steps.length ? Math.round((confirmedCount / process.steps.length) * 100) : 0;
  const compareBase = process.versions.find((version) => version.id === compareBaseId);
  const compareTarget = process.versions.find((version) => version.id === compareTargetId);
  const versionDiff = useMemo(() => compareVersions(compareBase, compareTarget), [compareBase, compareTarget]);

  useEffect(() => {
    if (!initialSaveSkipped.current) {
      initialSaveSkipped.current = true;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
    setSavedLabel(`自动保存 · ${formatDate(new Date().toISOString())}`);
  }, [process]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? dispatch({ type: 'redo' }) : dispatch({ type: 'undo' });
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(process));
        setSavedLabel(`手动保存 · ${formatDate(new Date().toISOString())}`);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [process]);

  const commitProcess = (update: (draft: ExperimentProcess) => void): void => {
    dispatch({ type: 'commit', update });
  };

  const updateProcessField = (field: 'title' | 'code' | 'objective' | 'principal' | 'lab', value: string): void => {
    commitProcess((draft) => { draft[field] = value; });
  };

  const updateStep = (field: keyof ProcessStep, value: unknown): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    setLastModifiedId(id);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (!step) return;
      (step as unknown as Record<string, unknown>)[field] = value;
      registerStepChange(draft, id, field);
    });
  };

  const updateStepList = (field: 'hazards' | 'dependencies', value: string): void => {
    updateStep(field, splitList(value));
  };

  const addStep = (): void => {
    if (process.status === 'frozen') return;
    const id = uid('step');
    commitProcess((draft) => {
      draft.steps.push({
        id, title: '新的实验步骤', purpose: '', materials: '', equipment: '', amount: '', duration: 10,
        hazards: [], controls: '', dependencies: draft.steps.at(-1) ? [draft.steps.at(-1)!.id] : [],
        safetyNote: '', expectedResult: '', status: 'draft', comments: []
      });
    });
    setSelectedStepId(id);
    setLastModifiedId(id);
    setActiveView('editor');
  };

  const duplicateStep = (): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const copy: ProcessStep = clone(selectedStep);
    copy.id = uid('step');
    copy.title = `${copy.title}（副本）`;
    copy.status = 'draft';
    copy.comments = [];
    copy.dependencies = [...copy.dependencies];
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === selectedStep.id);
      draft.steps.splice(index + 1, 0, copy);
    });
    setSelectedStepId(copy.id);
  };

  const deleteStep = (): void => {
    if (!selectedStep || process.steps.length <= 1 || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      draft.steps = draft.steps.filter((step) => step.id !== id);
      draft.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
      // 同步裁剪批次条目；条目清空的批次直接移除，条目齐全的未关闭批次自动结束
      draft.reviewBatches.forEach((batch) => {
        batch.items = batch.items.filter((item) => item.stepId !== id);
      });
      closeCompletedBatches(draft, new Date().toISOString());
      draft.reviewBatches = draft.reviewBatches.filter((batch) => batch.items.length > 0);
    });
    setSelectedStepId(process.steps.find((step) => step.id !== id)?.id ?? '');
    setLastModifiedId((current) => (current === id ? null : current));
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || process.status === 'frozen') return;
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === selectedStep.id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const [step] = draft.steps.splice(index, 1);
      draft.steps.splice(nextIndex, 0, step);
    });
  };

  const toggleDependency = (dependencyId: string, checked: boolean): void => {
    if (!selectedStep) return;
    const next = checked
      ? [...new Set([...selectedStep.dependencies, dependencyId])]
      : selectedStep.dependencies.filter((id) => id !== dependencyId);
    updateStep('dependencies', next);
  };

  const submitForReview = (): void => {
    if (process.status === 'frozen') return;
    commitProcess((draft) => {
      draft.status = 'in-review';
      draft.steps.forEach((step) => {
        if (step.status !== 'confirmed') step.status = 'submitted';
      });
    });
    setActiveView('review');
    setSavedLabel('流程已提交复核');
  };

  const addReviewComment = (): void => {
    if (!selectedStep || !commentText.trim()) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      step?.comments.push({
        id: uid('comment'), author: CURRENT_AUTHOR, role: CURRENT_ROLE,
        text: commentText.trim(), createdAt: new Date().toISOString(), resolved: false
      });
    });
    setCommentText('');
  };

  const confirmSelectedStep = (): void => {
    if (!selectedStep || hasMissingSafety(selectedStep)) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      confirmStepInBatch(draft, id, new Date().toISOString());
    });
  };

  const setSelectedStepStatus = (status: StepStatus): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (step) step.status = status;
    });
  };

  const resolveComment = (commentId: string): void => {
    if (!selectedStep) return;
    const stepId = selectedStep.id;
    commitProcess((draft) => {
      const comment = draft.steps.find((step) => step.id === stepId)?.comments.find((item) => item.id === commentId);
      if (comment) comment.resolved = !comment.resolved;
    });
  };

  const freezeVersion = (): void => {
    if (process.status === 'frozen') return;
    const blockers = collectFreezeBlockers(process);
    if (blockers.length) {
      setFreezeBlockers(blockers);
      setSavedLabel('冻结被拦截：存在未处理批次或未确认步骤');
      return;
    }
    const nextNumber = nextMinorVersion(process.version);
    const previousVersionId = process.versions.at(-1)?.id ?? '';
    const frozenVersionId = uid('version');
    commitProcess((draft) => {
      draft.versions.push({
        id: frozenVersionId, label: '复核通过冻结版', version: nextNumber,
        createdAt: new Date().toISOString(),
        note: `${draft.steps.length} 个步骤全部确认，安全控制完整；随版本归档 ${draft.reviewBatches.length} 个改动批次。`,
        author: CURRENT_AUTHOR, steps: clone(draft.steps), reviewBatches: clone(draft.reviewBatches)
      });
      draft.version = nextNumber;
      draft.status = 'frozen';
      draft.frozenAt = new Date().toISOString();
    });
    setSavedLabel(`版本 ${nextNumber} 已冻结`);
    setCompareBaseId(previousVersionId);
    setCompareTargetId(frozenVersionId);
    setFreezeBlockers(null);
  };

  const startRevision = (): void => {
    if (process.status !== 'frozen') return;
    commitProcess((draft) => {
      const nextNumber = nextMinorVersion(draft.version);
      draft.version = `${nextNumber}-revision`;
      draft.status = 'revising';
      draft.frozenAt = undefined;
      // 历史批次与批注全部保留；新修订从草稿状态重新走批次流程
      draft.steps.forEach((step) => {
        step.status = 'draft';
      });
      draft.reviewBatches = draft.reviewBatches.filter((batch) => batch.status === 'completed');
    });
    setActiveView('editor');
    setSavedLabel('已从冻结版本创建修订稿（批注与批次历史已保留）');
  };

  const addVersionSnapshot = (): void => {
    commitProcess((draft) => {
      draft.versions.push({
        id: uid('version'), label: '工作版本快照', version: draft.version.replace('-draft', ''),
        createdAt: new Date().toISOString(), note: '保存当前步骤、复核状态与待复核批次。',
        author: CURRENT_AUTHOR, steps: clone(draft.steps), reviewBatches: clone(draft.reviewBatches)
      });
    });
    setSavedLabel('已保存工作版本快照');
  };

  const stepInOpenBatch = (stepId: string): boolean => pendingItemStepIds.has(stepId);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>改动批次 · 逐项复核 · 冻结门禁</p></div>
        </div>
        <div className="header-status">
          <span className={`network ${online ? 'online' : ''}`}></span>
          <span>{online ? '离线保存已启用' : '当前离线，修改仍会保存'}</span>
          <strong>{savedLabel}</strong>
        </div>
        <div className="header-actions">
          <Button icon="undo" text="撤销" minimal disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
          <Button icon="redo" text="重做" minimal disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
          <Button icon="floppy-disk" text="保存快照" onClick={addVersionSnapshot} />
          <Button icon="lock" text="冻结版本" intent="primary" onClick={freezeVersion} disabled={process.status === 'frozen'} />
        </div>
      </header>

      {freezeBlockers && (
        <div className="bp6-overlay bp6-overlay-open freeze-overlay" onMouseDown={() => setFreezeBlockers(null)}>
          <div className="bp6-dialog freeze-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="bp6-dialog-header">
              <h4 className="bp6-heading"><Icon icon="disable" intent="danger" /> 无法冻结版本</h4>
              <Button aria-label="关闭" minimal icon="cross" onClick={() => setFreezeBlockers(null)} />
            </div>
            <div className="bp6-dialog-body">
              <Callout intent="danger" icon="warning-sign" className="freeze-callout">
                <strong>以下条件未满足，冻结已被拦截：</strong>
              </Callout>
              <ul className="blocker-list">
                {freezeBlockers.map((blocker) => (
                  <li key={blocker.key}>
                    <div><Icon icon="cross-circle" intent="danger" size={15} /><strong>{blocker.label}</strong></div>
                    <p>{blocker.detail}</p>
                  </li>
                ))}
              </ul>
              <p className="muted">已确认步骤再次改动会使旧确认失效，改动步骤与全部下游步骤须在待复核批次中逐项重新确认。</p>
            </div>
            <div className="bp6-dialog-footer">
              <Button fill intent="primary" icon="endorsed" text="前往处理批次" onClick={() => { setFreezeBlockers(null); setActiveView('review'); }} />
            </div>
          </div>
        </div>
      )}

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核、批次和批注仍会保存在当前浏览器。</Callout>}

      <section className="process-banner">
        <div className="banner-main">
          <div className="code-line"><span>{process.code}</span><Tag minimal>{processStatusLabel(process.status)}</Tag></div>
          <h2>{process.title}</h2>
          <p>{process.objective}</p>
        </div>
        <div className="banner-meta">
          <div><span>负责人</span><strong>{process.principal}</strong></div>
          <div><span>实验区域</span><strong>{process.lab}</strong></div>
          <div><span>当前版本</span><strong>{process.version}</strong></div>
        </div>
        <div className="banner-progress">
          <div><span>复核进度</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
          <ProgressBar value={reviewProgress / 100} intent={reviewProgress === 100 ? 'success' : 'primary'} stripes={reviewProgress < 100} />
          <small>
            {openBatches.length ? `${openBatches.length} 个待复核批次 · ${pendingItemStepIds.size} 个条目待确认` : '没有待处理批次'}
            {' · '}{pendingReviewCount ? `${pendingReviewCount} 步待处理` : '所有步骤已处理'} · {missingSafetySteps.length} 条安全缺口
          </small>
        </div>
      </section>

      <Tabs id="workspace-tabs" selectedTabId={activeView} onChange={(value) => setActiveView(value as ViewId)} renderActiveTabPanelOnly className="workspace-tabs">
        <Tab id="editor" title={<span><Icon icon="edit" /> 流程编写</span>} />
        <Tab id="review" title={<span><Icon icon="endorsed" /> 安全复核 {openBatches.length > 0 && <b className="tab-badge">{openBatches.length}</b>}</span>} />
        <Tab id="compare" title={<span><Icon icon="comparison" /> 版本比较</span>} />
      </Tabs>

      {activeView === 'editor' && selectedStep && (
        <main className="editor-layout">
          <aside className="step-panel">
            <div className="panel-heading">
              <div><span>PROCESS STEPS</span><h3>实验步骤</h3></div>
              <Button icon="add" minimal small onClick={addStep} disabled={process.status === 'frozen'} />
            </div>
            <div className="step-list">
              {process.steps.map((step, index) => (
                <button key={step.id} className={step.id === selectedStep.id ? 'selected' : ''} onClick={() => setSelectedStepId(step.id)}>
                  <span className={`step-number ${step.status}`}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}</small></span>
                  {stepInOpenBatch(step.id) && <Icon icon="layers" intent="warning" size={13} title="属于未关闭的待复核批次" />}
                  {hasMissingSafety(step) && <Icon icon="warning-sign" intent="danger" size={13} />}
                </button>
              ))}
            </div>
            <div className="step-actions">
              <Button icon="arrow-up" small minimal disabled={process.steps[0]?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(-1)} />
              <Button icon="arrow-down" small minimal disabled={process.steps.at(-1)?.id === selectedStep.id || process.status === 'frozen'} onClick={() => moveStep(1)} />
              <Button icon="duplicate" small minimal text="复制" disabled={process.status === 'frozen'} onClick={duplicateStep} />
              <Button icon="trash" small minimal intent="danger" disabled={process.status === 'frozen'} onClick={deleteStep} />
            </div>
          </aside>

          <section className="editor-main">
            <Card elevation={Elevation.ONE} className="process-meta-card">
              <div className="card-title"><div><span>PROCESS INFO</span><h3>实验基本信息</h3></div><Tag minimal intent="primary">{process.steps.length} 个步骤</Tag></div>
              <div className="meta-grid">
                <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill value={process.title} onChange={(event) => updateProcessField('title', event.target.value)} /></FormGroup>
                <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill value={process.code} onChange={(event) => updateProcessField('code', event.target.value)} /></FormGroup>
                <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill value={process.principal} onChange={(event) => updateProcessField('principal', event.target.value)} /></FormGroup>
                <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill value={process.lab} onChange={(event) => updateProcessField('lab', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill value={process.objective} onChange={(event) => updateProcessField('objective', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(process.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <div className="status-tags">
                  {stepInOpenBatch(selectedStep.id) && <Tag minimal intent="warning" icon="layers">批次待复核</Tag>}
                  <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
                </div>
              </div>
              <FormGroup label="步骤名称" labelFor="step-title"><InputGroup id="step-title" fill value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
              <FormGroup label="操作目的" labelFor="step-purpose"><TextArea id="step-purpose" fill value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
              <div className="form-grid">
                <FormGroup label="材料" labelFor="materials"><TextArea id="materials" fill value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label="设备" labelFor="equipment"><TextArea id="equipment" fill value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label="用量 / 参数" labelFor="amount"><TextArea id="amount" fill value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label="预计时间（分钟）" labelFor="duration"><InputGroup id="duration" type="number" min={1} fill value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards"><TextArea id="hazards" fill value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label="控制措施" labelFor="controls"><TextArea id="controls" fill value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label="预期结果" labelFor="expected"><TextArea id="expected" fill value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="dependency-card">
              <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
              <p className="muted">调整依赖会改变下游范围：被波及的已确认步骤将随待复核批次一并退回。</p>
              <div className="dependency-grid">
                {process.steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                  <Checkbox key={step.id} checked={selectedStep.dependencies.includes(step.id)} label={`${String(process.steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
                ))}
              </div>
            </Card>
          </section>

          <aside className="inspector-panel">
            <Card elevation={Elevation.ONE} className="batch-card">
              <div className="card-title"><div><span>REVIEW BATCHES</span><h3>待复核批次</h3></div><Tag intent={openBatches.length ? 'warning' : 'success'} minimal>{openBatches.length ? `${openBatches.length} 进行中` : '无'}</Tag></div>
              {openBatches.length ? (
                <div className="batch-stack">
                  {openBatches.map((batch) => (
                    <BatchCard key={batch.id} batch={batch} steps={process.steps} onSelect={setSelectedStepId} compact />
                  ))}
                </div>
              ) : (
                <p className="muted">研究员修改已确认步骤后，这里会生成待复核批次，改动步骤与全部下游步骤须逐项重新确认。</p>
              )}
            </Card>

            <Card elevation={Elevation.ONE} className="impact-card">
              <div className="card-title"><div><span>IMPACT ANALYSIS</span><h3>变更影响提醒</h3></div><Icon icon="path-search" size={18} /></div>
              {lastModifiedId ? (
                <>
                  <Callout intent={impactedSteps.length ? 'warning' : 'primary'} icon={impactedSteps.length ? 'warning-sign' : 'tick'}>
                    <strong>{impactedSteps.length ? `${impactedSteps.length} 个后续步骤受影响` : '未发现下游步骤'}</strong>
                    <p>{impactedSteps.length ? '已与改动步骤一起退回待复核批次，旧确认不再生效。' : '当前修改没有影响其他步骤的安全条件。'}</p>
                  </Callout>
                  <div className="impact-list">
                    {impactedSteps.map((step) => (
                      <button key={step.id} onClick={() => setSelectedStepId(step.id)}>
                        <Icon icon={step.status === 'confirmed' ? 'endorsed' : 'circle'} intent={step.status === 'confirmed' ? 'success' : 'none'} size={13} />
                        <span><strong>{step.title}</strong><small>{stepInOpenBatch(step.id) ? '已退回批次待复核' : `当前状态：${statusLabel(step.status)}`}</small></span>
                        <Icon icon="chevron-right" size={12} />
                      </button>
                    ))}
                  </div>
                </>
              ) : <p className="muted">编辑任一步骤后，这里会显示受影响的所有后续步骤；它们会连同改动步骤一起进入待复核批次。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="safety-card">
              <div className="card-title"><div><span>SAFETY GATE</span><h3>安全完整性</h3></div><Tag intent={missingSafetySteps.length ? 'danger' : 'success'} minimal>{missingSafetySteps.length ? `${missingSafetySteps.length} 项缺口` : '通过'}</Tag></div>
              {missingSafetySteps.length ? missingSafetySteps.map((step) => (
                <button className="safety-row" key={step.id} onClick={() => setSelectedStepId(step.id)}><Icon icon="warning-sign" intent="danger" size={14} /><span><strong>{step.title}</strong><small>危险项缺少控制措施或安全说明</small></span></button>
              )) : <p className="muted">所有存在危险项的步骤都已填写控制措施和安全说明。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="gate-card">
              <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div></div>
              <div className="gate-row"><span>待复核批次</span><strong className={openBatches.length ? 'danger-text' : ''}>{openBatches.length}</strong></div>
              <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
              <div className="gate-row"><span>安全缺口</span><strong className={missingSafetySteps.length ? 'danger-text' : ''}>{missingSafetySteps.length}</strong></div>
              <div className="gate-row"><span>流程状态</span><strong>{processStatusLabel(process.status)}</strong></div>
              <Divider />
              {process.status === 'frozen' ? <Button fill intent="warning" icon="git-branch" text="从冻结版创建修订" onClick={startRevision} /> : <Button fill intent="primary" icon="send-to" text="提交复核" onClick={submitForReview} />}
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'review' && (
        <main className="review-layout">
          <aside className="review-steps">
            <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>逐条复核</h3></div><Tag intent={pendingItemStepIds.size || pendingReviewCount ? 'warning' : 'success'}>{pendingItemStepIds.size ? `${pendingItemStepIds.size} 批次待确认` : pendingReviewCount ? `${pendingReviewCount} 步待复核` : '已完成'}</Tag></div>
            {process.steps.map((step, index) => (
              <button key={step.id} className={`${step.id === selectedStep?.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{step.title}</strong><small>{statusLabel(step.status)}{stepInOpenBatch(step.id) ? ' · 批次待确认' : ''}</small></div>
                {stepInOpenBatch(step.id)
                  ? <Icon icon="layers" intent="warning" size={15} />
                  : <Icon icon={step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} size={15} />}
              </button>
            ))}
          </aside>
          <section className="review-main">
            {openBatches.length > 0 && (
              <Card elevation={Elevation.ONE} className="review-batch-card">
                <div className="card-title">
                  <div><span>PENDING BATCHES</span><h3>待复核批次（逐项确认后自动结束）</h3></div>
                  <Tag intent="warning" icon="layers">{openBatches.length} 个进行中</Tag>
                </div>
                <Callout intent="warning" icon="warning-sign" className="batch-callout">
                  改动步骤与其全部下游步骤已一并退回；同一步骤再次改动时，批次条目会重建，复核员此前的确认不再算数。
                </Callout>
                <div className="batch-stack">
                  {openBatches.map((batch) => (
                    <BatchCard key={batch.id} batch={batch} steps={process.steps} onSelect={(id) => setSelectedStepId(id)} onConfirm={(stepId) => {
                      setSelectedStepId(stepId);
                      commitProcess((draft) => confirmStepInBatch(draft, stepId, new Date().toISOString()));
                    }} />
                  ))}
                </div>
              </Card>
            )}

            {selectedStep && (
              <>
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
                  {openBatches.some((batch) => batch.items.some((item) => item.stepId === selectedStep.id)) && (
                    <Callout intent="warning" icon="layers" className="batch-callout">
                      {openBatches.filter((batch) => batch.items.some((item) => item.stepId === selectedStep.id))
                        .map((batch) => `批次 #${batch.number}（${batch.sourceTitle}）`)
                        .join('、')} 将该步骤退回复核，确认后才算处理完毕。
                    </Callout>
                  )}
                  <div className="review-facts">
                    <div><span>预计时间</span><strong>{selectedStep.duration} 分钟</strong></div>
                    <div><span>材料与用量</span><strong>{selectedStep.materials} / {selectedStep.amount}</strong></div>
                    <div><span>危险项</span><strong>{selectedStep.hazards.join('、') || '无'}</strong></div>
                  </div>
                  <div className="review-section"><h4>控制措施</h4><p>{selectedStep.controls || '未填写'}</p></div>
                  <div className="review-section"><h4>安全说明</h4><p className={hasMissingSafety(selectedStep) ? 'danger-text' : ''}>{selectedStep.safetyNote || '未填写'}</p></div>
                  {hasMissingSafety(selectedStep) && <Callout intent="danger" icon="warning-sign">当前步骤存在安全信息缺口，不能确认或冻结版本。</Callout>}
                </Card>
                <Card elevation={Elevation.ONE} className="comment-card">
                  <div className="card-title"><div><span>REVIEW COMMENTS</span><h3>复核批注（历史保留）</h3></div><Tag minimal>{selectedStep.comments.length} 条</Tag></div>
                  <div className="comment-compose">
                    <TextArea fill value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="填写具体依据、风险或修改建议…" />
                    <Button intent="primary" icon="comment" text="添加批注" disabled={!commentText.trim()} onClick={addReviewComment} />
                  </div>
                  <div className="comment-list">
                    {selectedStep.comments.map((comment) => (
                      <article key={comment.id} className={comment.resolved ? 'resolved' : ''}>
                        <div className="comment-avatar">{comment.author.slice(0, 1)}</div>
                        <div><header><strong>{comment.author}</strong><span>{comment.role}</span><time>{formatDate(comment.createdAt)}</time></header><p>{comment.text}</p><Button minimal small text={comment.resolved ? '已解决' : '标记解决'} icon={comment.resolved ? 'tick' : 'circle'} onClick={() => resolveComment(comment.id)} /></div>
                      </article>
                    ))}
                    {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注，批注会随流程长期保留。</p>}
                  </div>
                </Card>

                {completedBatches.length > 0 && (
                  <Card elevation={Elevation.ONE} className="batch-history-card">
                    <div className="card-title"><div><span>BATCH HISTORY</span><h3>已结束批次（{completedBatches.length}）</h3></div><Icon icon="history" size={17} /></div>
                    <div className="batch-history-list">
                      {completedBatches.map((batch) => (
                        <details key={batch.id}>
                          <summary>
                            <Tag minimal intent="success" icon="tick-circle">#{batch.number} 已结束</Tag>
                            <span>{batch.sourceTitle}</span>
                            <small>{formatDate(batch.completedAt ?? batch.createdAt)}</small>
                          </summary>
                          <BatchCard batch={batch} steps={process.steps} onSelect={setSelectedStepId} compact />
                        </details>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            )}
          </section>
          <aside className="review-actions">
            <Card elevation={Elevation.ONE}>
              <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
              <p className="muted">逐项确认仅在该步骤所属的待复核批次全部确认后使其结束；研究员再次改动同一步骤会生成新批次，旧确认失效。</p>
              <Button fill large intent="success" icon="tick" text="逐项确认当前步骤" disabled={!selectedStep || hasMissingSafety(selectedStep)} onClick={confirmSelectedStep} />
              <Button fill large icon="undo" text="退回修改" intent="warning" disabled={!selectedStep} onClick={() => selectedStep && setSelectedStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" disabled={!selectedStep} onClick={() => selectedStep && setSelectedStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {process.steps.map((step) => <div key={step.id}><span>{step.title}{stepInOpenBatch(step.id) && <Icon icon="layers" intent="warning" size={11} />}</span><Tag minimal intent={step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="尝试冻结版本" onClick={freezeVersion} disabled={process.status === 'frozen'} />
            </Card>
          </aside>
        </main>
      )}

      {activeView === 'compare' && (
        <main className="compare-layout">
          <Card elevation={Elevation.ONE} className="version-panel">
            <div className="card-title"><div><span>VERSION TIMELINE</span><h3>冻结版本</h3></div><Tag minimal>{process.versions.length} 个</Tag></div>
            <div className="version-timeline">
              {process.versions.map((version, index) => (
                <article key={version.id} className={index === process.versions.length - 1 ? 'latest' : ''}>
                  <span></span><div><b>{version.version}</b><strong>{version.label}</strong><p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.author}</p><small>{version.note}</small>
                    {(version.reviewBatches?.length ?? 0) > 0 && (
                      <small className="version-batch-note"><Icon icon="layers" size={11} /> 冻结时归档 {version.reviewBatches!.length} 个改动批次</small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="diff-panel">
            <div className="card-title"><div><span>VERSION DIFF</span><h3>流程差异比较</h3></div><div className="diff-selects">
              <HTMLSelect value={compareBaseId} onChange={(event) => setCompareBaseId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 基准</option>)}</HTMLSelect>
              <Icon icon="arrow-right" />
              <HTMLSelect value={compareTargetId} onChange={(event) => setCompareTargetId(event.target.value)}>{process.versions.map((version) => <option key={version.id} value={version.id}>{version.version} · 目标</option>)}</HTMLSelect>
            </div></div>
            {compareTarget && (compareTarget.reviewBatches?.length ?? 0) > 0 && (
              <div className="diff-batches">
                <span><Icon icon="layers" size={13} /> 目标版本归档的改动批次：</span>
                {compareTarget.reviewBatches!.map((batch) => (
                  <Tag key={batch.id} minimal intent={batch.status === 'open' ? 'warning' : 'none'}>
                    #{batch.number} {batch.sourceTitle} · {batch.items.length} 步{batch.status === 'open' ? '（冻结时仍未关闭）' : ''}
                  </Tag>
                ))}
              </div>
            )}
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容与影响范围</span></div>
              {versionDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : diff.kind === 'impacted' ? 'warning' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : diff.kind === 'impacted' ? '受影响' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!versionDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个版本没有差异</strong><p>请选择不同版本，或先冻结新的流程版本。</p></div>}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div></div>
            <div className={openBatches.length === 0 ? 'passed' : ''}><Icon icon={openBatches.length === 0 ? 'tick-circle' : 'circle'} /><span><strong>待复核批次已处理</strong><small>{openBatches.length} 个批次未关闭</small></span></div>
            <div className={confirmedCount === process.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === process.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{process.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={process.steps.every((step) => step.dependencies.every((id) => process.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{process.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <Button fill intent="primary" icon="lock" text="尝试冻结当前版本" onClick={freezeVersion} disabled={process.status === 'frozen'} />
            {openBatches.length > 0 && <p className="muted freeze-hint">冻结时会先说明未处理批次及受影响步骤，不能直接跳过。</p>}
          </Card>
        </main>
      )}

      <footer className="app-footer">
        <span>实验步骤、待复核批次与历史批注均保存在当前浏览器 localStorage，关闭页面后仍保留。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

function BatchCard({ batch, steps, onSelect, onConfirm, compact }: {
  batch: ReviewBatch;
  steps: ProcessStep[];
  onSelect: (stepId: string) => void;
  onConfirm?: (stepId: string) => void;
  compact?: boolean;
}): ReactElement {
  const confirmed = batch.items.filter((item) => item.confirmedAt).length;
  const open = batch.status === 'open';
  return (
    <article className={`batch-entry ${open ? 'open' : 'done'} ${compact ? 'compact' : ''}`}>
      <header>
        <Tag minimal intent={open ? 'warning' : 'success'} icon={open ? 'layers' : 'tick-circle'}>批次 #{batch.number} · {open ? '待复核' : '已结束'}</Tag>
        <small>{formatDate(open ? batch.createdAt : (batch.completedAt ?? batch.createdAt))} · {batch.createdBy}</small>
      </header>
      <p className="batch-reason">{batch.reason}</p>
      <div className="batch-fields">改动字段：{batch.changedFields.join('、')}</div>
      <div className="batch-progress">
        <ProgressBar value={batch.items.length ? confirmed / batch.items.length : 0} intent={confirmed === batch.items.length ? 'success' : 'warning'} stripes={confirmed < batch.items.length} />
        <small>{confirmed}/{batch.items.length} 已逐项确认</small>
      </div>
      <ul className="batch-items">
        {batch.items.map((item) => {
          const step = steps.find((s) => s.id === item.stepId);
          const isConfirmed = Boolean(item.confirmedAt);
          const blocked = step ? hasMissingSafety(step) : false;
          return (
            <li key={item.key} className={isConfirmed ? 'confirmed' : ''}>
              <button className="batch-item-main" onClick={() => onSelect(item.stepId)} title={item.reason}>
                <Icon icon={isConfirmed ? 'tick-circle' : item.role === 'source' ? 'edit' : 'graph'} intent={isConfirmed ? 'success' : item.role === 'source' ? 'warning' : 'none'} size={14} />
                <span><strong>{step?.title ?? '（步骤已删除）'}{item.role === 'source' && <em>改动步骤</em>}</strong><small>{item.reason}</small></span>
              </button>
              {open && onConfirm && step && (
                <Button
                  small minimal outlined={!isConfirmed}
                  intent={isConfirmed ? 'success' : 'none'}
                  icon={isConfirmed ? 'tick' : 'blank'}
                  text={isConfirmed ? '已确认' : '确认'}
                  disabled={blocked}
                  title={blocked ? '存在安全信息缺口，不能确认' : undefined}
                  onClick={() => onConfirm(item.stepId)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}

export default App;
