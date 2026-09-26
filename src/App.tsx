import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  batchConfirmedCount,
  changedStepFields,
  closeCompletedBatches,
  collectDownstream,
  hasMissingSafety,
  pruneDeletedBatchItems,
  registerChangeBatch
} from './batch';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
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

type StepStatus = 'draft' | 'submitted' | 'confirmed' | 'returned';
type ProcessStatus = 'draft' | 'in-review' | 'frozen' | 'revising';
type ViewId = 'editor' | 'review' | 'compare';

interface ReviewComment {
  id: string;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface ReviewBatchItem {
  stepId: string;
  title: string;
  confirmed: boolean;
  downstream: boolean;
}

export interface ReviewBatch {
  id: string;
  code: string;
  sourceStepId: string;
  sourceTitle: string;
  deleted: boolean;
  changedFields: string[];
  items: ReviewBatchItem[];
  createdAt: string;
  updatedAt: string;
  closed: boolean;
  closedAt?: string;
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

interface VersionSnapshot {
  id: string;
  label: string;
  version: string;
  createdAt: string;
  note: string;
  author: string;
  steps: ProcessStep[];
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
  batches: ReviewBatch[];
  batchSeq: number;
  versions: VersionSnapshot[];
  frozenAt?: string;
  updatedAt: string;
}

interface HistoryState {
  past: ExperimentProcess[];
  present: ExperimentProcess;
  future: ExperimentProcess[];
}

interface DiffItem {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
  impactedBy?: string[];
}

const STORAGE_KEY = 'sologsb-1027-lab-safety-v1';
const CURRENT_AUTHOR = '周宁';
const CURRENT_ROLE = '安全复核员';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function initialProcess(): ExperimentProcess {
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
    steps: clone(baseSteps).slice(0, 4).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };
  const secondVersion: VersionSnapshot = {
    id: 'version-1-1', label: '补充冷却与废液步骤', version: '1.1.0', createdAt: '2026-09-24T15:10:00+08:00',
    note: '增加安全冷却、废液处置和现场恢复。', author: '王颖',
    steps: clone(baseSteps).map((step) => ({ ...step, status: 'confirmed', comments: [] }))
  };

  return {
    id: 'exp-catalyst-2026-09', title: '负载型催化剂评价实验', code: 'SAFE-CAT-026',
    objective: '在受控温度下评价催化剂活性，并完整记录过程样品与安全控制措施。',
    principal: '李明', lab: '材料化学实验室 B-207',
    status: 'in-review', version: '1.2.0-draft',
    steps: baseSteps, batches: [], batchSeq: 0, versions: [firstVersion, secondVersion], updatedAt: new Date().toISOString()
  };
}

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
    const parsed = JSON.parse(value) as Partial<ExperimentProcess>;
    if (!parsed.id || !Array.isArray(parsed.steps)) return initialProcess();
    return {
      ...initialProcess(),
      ...parsed,
      batches: Array.isArray(parsed.batches) ? parsed.batches : [],
      batchSeq: typeof parsed.batchSeq === 'number' ? parsed.batchSeq : 0,
      versions: Array.isArray(parsed.versions) ? parsed.versions : []
    } as ExperimentProcess;
  } catch {
    return initialProcess();
  }
}

function splitList(value: string): string[] {
  return value.split(/[\n,，、;；]+/).map((item) => item.trim()).filter(Boolean);
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
  const [freezeBlockers, setFreezeBlockers] = useState<string[]>([]);
  const [freezeDialogOpen, setFreezeDialogOpen] = useState(false);
  const initialSaveSkipped = useRef(false);

  const selectedStep = process.steps.find((step) => step.id === selectedStepId) ?? process.steps[0];
  const downstreamIds = useMemo(() => collectDownstream(process.steps, lastModifiedId), [process.steps, lastModifiedId]);
  const impactedSteps = process.steps.filter((step) => downstreamIds.includes(step.id));
  const missingSafetySteps = process.steps.filter(hasMissingSafety);
  const frozen = process.status === 'frozen';
  const openBatches = useMemo(() => process.batches.filter((batch) => !batch.closed), [process.batches]);
  const pendingBatchItems = useMemo(() => {
    const ids = new Set<string>();
    openBatches.forEach((batch) => batch.items.forEach((item) => { if (!item.confirmed) ids.add(item.stepId); }));
    return ids;
  }, [openBatches]);
  const confirmedCount = process.steps.filter((step) => step.status === 'confirmed').length;
  const reviewProgress = process.steps.length ? Math.round((confirmedCount / process.steps.length) * 100) : 0;
  const versionDiff = useMemo(() => compareVersions(process, compareBaseId, compareTargetId), [process, compareBaseId, compareTargetId]);

  const collectFreezeBlockers = (): string[] => {
    const blockers: string[] = [];
    if (openBatches.length) {
      const remaining = openBatches.reduce((sum, batch) => sum + batch.items.filter((item) => !item.confirmed).length, 0);
      blockers.push(`存在 ${openBatches.length} 个未处理复核批次（${remaining} 项待逐项确认）：${openBatches.map((batch) => batch.code).join('、')}。`);
    }
    const unconfirmed = process.steps.filter((step) => step.status !== 'confirmed');
    if (unconfirmed.length) blockers.push(`${unconfirmed.length} 个步骤尚未确认：${unconfirmed.map((step) => step.title).join('、')}。`);
    if (missingSafetySteps.length) blockers.push(`${missingSafetySteps.length} 个步骤存在安全信息缺口：${missingSafetySteps.map((step) => step.title).join('、')}。`);
    return blockers;
  };

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
    if (!selectedStep || process.status === 'frozen') return;
    const id = selectedStep.id;
    const before = clone(selectedStep);
    setLastModifiedId(id);
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (!step) return;
      (step as unknown as Record<string, unknown>)[field] = value;
      const fields = changedStepFields(before, step);
      if (fields.length) registerChangeBatch(draft, id, fields, false, () => uid('batch'));
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
      draft.status = 'draft';
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
      registerChangeBatch(draft, id, ['步骤删除'], true, () => uid('batch'));
      draft.steps = draft.steps.filter((step) => step.id !== id);
      draft.steps.forEach((step) => { step.dependencies = step.dependencies.filter((dependency) => dependency !== id); });
      pruneDeletedBatchItems(draft, id);
    });
    setSelectedStepId(process.steps.find((step) => step.id !== id)?.id ?? '');
    setLastModifiedId(id);
    setActiveView('review');
  };

  const moveStep = (direction: -1 | 1): void => {
    if (!selectedStep || process.status === 'frozen') return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const index = draft.steps.findIndex((step) => step.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
      const [step] = draft.steps.splice(index, 1);
      draft.steps.splice(nextIndex, 0, step);
    });
    setLastModifiedId(id);
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

  const setStepStatus = (status: StepStatus): void => {
    if (!selectedStep) return;
    const id = selectedStep.id;
    commitProcess((draft) => {
      const step = draft.steps.find((item) => item.id === id);
      if (step) step.status = status;
      const now = new Date().toISOString();
      draft.batches.forEach((batch) => {
        if (batch.closed) return;
        const item = batch.items.find((entry) => entry.stepId === id);
        if (!item) return;
        if (status === 'confirmed') {
          item.confirmed = true;
        } else if (status === 'returned') {
          item.confirmed = false;
        }
        batch.updatedAt = now;
      });
      closeCompletedBatches(draft);
    });
    setLastModifiedId(status === 'returned' ? id : null);
  };

  const confirmBatchItem = (batchId: string, stepId: string): void => {
    commitProcess((draft) => {
      const batch = draft.batches.find((item) => item.id === batchId);
      if (!batch || batch.closed) return;
      const entry = batch.items.find((item) => item.stepId === stepId);
      const step = draft.steps.find((item) => item.id === stepId);
      if (!entry || entry.confirmed || !step || hasMissingSafety(step)) return;
      entry.confirmed = true;
      step.status = 'confirmed';
      batch.updatedAt = new Date().toISOString();
      closeCompletedBatches(draft);
    });
  };

  const returnBatchItem = (batchId: string, stepId: string): void => {
    commitProcess((draft) => {
      const batch = draft.batches.find((item) => item.id === batchId);
      if (!batch || batch.closed) return;
      const entry = batch.items.find((item) => item.stepId === stepId);
      const step = draft.steps.find((item) => item.id === stepId);
      if (!entry || !step) return;
      entry.confirmed = false;
      step.status = 'returned';
      batch.updatedAt = new Date().toISOString();
    });
    setLastModifiedId(stepId);
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
    const blockers = collectFreezeBlockers();
    if (blockers.length) {
      setFreezeBlockers(blockers);
      setFreezeDialogOpen(true);
      setSavedLabel('冻结被未处理批次或未确认步骤阻止');
      return;
    }
    const nextNumber = nextMinorVersion(process.version);
    const previousVersionId = process.versions.at(-1)?.id ?? '';
    const frozenVersionId = uid('version');
    commitProcess((draft) => {
      draft.versions.push({
        id: frozenVersionId, label: '复核通过冻结版', version: nextNumber,
        createdAt: new Date().toISOString(), note: `${draft.steps.length} 个步骤全部确认，${draft.batches.filter((batch) => batch.closed).length} 个复核批次全部结案，安全控制完整。`,
        author: CURRENT_AUTHOR, steps: clone(draft.steps)
      });
      draft.version = nextNumber;
      draft.status = 'frozen';
      draft.frozenAt = new Date().toISOString();
    });
    setSavedLabel(`版本 ${nextNumber} 已冻结`);
    setCompareBaseId(previousVersionId);
    setCompareTargetId(frozenVersionId);
    setFreezeDialogOpen(false);
  };

  const startRevision = (): void => {
    if (process.status !== 'frozen') return;
    commitProcess((draft) => {
      const nextNumber = nextMinorVersion(draft.version);
      draft.version = `${nextNumber}-revision`;
      draft.status = 'revising';
      draft.frozenAt = undefined;
      draft.steps.forEach((step) => {
        step.status = 'draft';
      });
      // 修订稿开启新一轮复核，既有批次留档备查，不再作为待办拦截冻结。
      draft.batches.forEach((batch) => {
        if (!batch.closed) {
          batch.closed = true;
          batch.closedAt = new Date().toISOString();
        }
      });
    });
    setActiveView('editor');
    setSavedLabel('已从冻结版本创建修订稿');
  };

  const addVersionSnapshot = (): void => {
    commitProcess((draft) => {
      draft.versions.push({
        id: uid('version'), label: '工作版本快照', version: draft.version.replace('-draft', ''),
        createdAt: new Date().toISOString(), note: '保存当前步骤与复核状态。',
        author: CURRENT_AUTHOR, steps: clone(draft.steps)
      });
    });
    setSavedLabel('已保存工作版本快照');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-icon"><Icon icon="lab-test" size={23} /></div>
          <div><h1>实验流程安全复核台</h1><p>步骤影响分析 · 逐条复核 · 冻结版本</p></div>
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
          <Button icon="lock" text="冻结版本" intent="primary" onClick={freezeVersion} disabled={frozen} />
        </div>
      </header>

      {!online && <Callout className="offline-callout" intent="warning" icon="cloud">网络不可用。编辑、复核和版本快照仍会保存在当前浏览器。</Callout>}

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
          <small>{openBatches.length ? `${openBatches.length} 个待复核批次 · ${pendingBatchItems.size} 项待确认` : '没有待处理批次'} · {missingSafetySteps.length} 条安全缺口</small>
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
                  <span className="step-copy"><strong>{step.title}</strong><small>{step.duration} 分钟 · {statusLabel(step.status)}{pendingBatchItems.has(step.id) ? ' · 待复核' : ''}</small></span>
                  {pendingBatchItems.has(step.id)
                    ? <Icon icon="notifications" intent="warning" size={13} />
                    : hasMissingSafety(step)
                      ? <Icon icon="warning-sign" intent="danger" size={13} />
                      : <span className="step-list-placeholder" />}
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
                <FormGroup label="实验名称" labelFor="process-title"><InputGroup id="process-title" fill disabled={frozen} value={process.title} onChange={(event) => updateProcessField('title', event.target.value)} /></FormGroup>
                <FormGroup label="流程编号" labelFor="process-code"><InputGroup id="process-code" fill disabled={frozen} value={process.code} onChange={(event) => updateProcessField('code', event.target.value)} /></FormGroup>
                <FormGroup label="负责人" labelFor="principal"><InputGroup id="principal" fill disabled={frozen} value={process.principal} onChange={(event) => updateProcessField('principal', event.target.value)} /></FormGroup>
                <FormGroup label="实验区域" labelFor="lab"><InputGroup id="lab" fill disabled={frozen} value={process.lab} onChange={(event) => updateProcessField('lab', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="实验目标" labelFor="objective"><TextArea id="objective" fill disabled={frozen} value={process.objective} onChange={(event) => updateProcessField('objective', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="step-editor-card">
              <div className="card-title">
                <div><span>STEP {String(process.steps.indexOf(selectedStep) + 1).padStart(2, '0')}</span><h3>{selectedStep.title}</h3></div>
                <Tag minimal intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag>
              </div>
              <FormGroup label="步骤名称" labelFor="step-title"><InputGroup id="step-title" fill disabled={frozen} value={selectedStep.title} onChange={(event) => updateStep('title', event.target.value)} /></FormGroup>
              <FormGroup label="操作目的" labelFor="step-purpose"><TextArea id="step-purpose" fill disabled={frozen} value={selectedStep.purpose} onChange={(event) => updateStep('purpose', event.target.value)} /></FormGroup>
              <div className="form-grid">
                <FormGroup label="材料" labelFor="materials"><TextArea id="materials" fill disabled={frozen} value={selectedStep.materials} onChange={(event) => updateStep('materials', event.target.value)} /></FormGroup>
                <FormGroup label="设备" labelFor="equipment"><TextArea id="equipment" fill disabled={frozen} value={selectedStep.equipment} onChange={(event) => updateStep('equipment', event.target.value)} /></FormGroup>
                <FormGroup label="用量 / 参数" labelFor="amount"><TextArea id="amount" fill disabled={frozen} value={selectedStep.amount} onChange={(event) => updateStep('amount', event.target.value)} /></FormGroup>
                <FormGroup label="预计时间（分钟）" labelFor="duration"><InputGroup id="duration" type="number" min={1} fill disabled={frozen} value={String(selectedStep.duration)} onChange={(event) => updateStep('duration', Number(event.target.value))} /></FormGroup>
              </div>
              <div className="form-grid two-column">
                <FormGroup label="危险项（逗号或换行分隔）" labelFor="hazards"><TextArea id="hazards" fill disabled={frozen} value={selectedStep.hazards.join('，')} onChange={(event) => updateStepList('hazards', event.target.value)} /></FormGroup>
                <FormGroup label="控制措施" labelFor="controls"><TextArea id="controls" fill disabled={frozen} value={selectedStep.controls} onChange={(event) => updateStep('controls', event.target.value)} /></FormGroup>
              </div>
              <FormGroup label="安全说明" labelFor="safety-note" helperText={hasMissingSafety(selectedStep) ? '存在危险项时，控制措施和安全说明均为必填。' : '安全说明已满足复核条件。'}>
                <TextArea id="safety-note" fill disabled={frozen} intent={hasMissingSafety(selectedStep) ? 'danger' : 'none'} value={selectedStep.safetyNote} onChange={(event) => updateStep('safetyNote', event.target.value)} />
              </FormGroup>
              <FormGroup label="预期结果" labelFor="expected"><TextArea id="expected" fill disabled={frozen} value={selectedStep.expectedResult} onChange={(event) => updateStep('expectedResult', event.target.value)} /></FormGroup>
            </Card>

            <Card elevation={Elevation.ONE} className="dependency-card">
              <div className="card-title"><div><span>DEPENDENCIES</span><h3>前置步骤</h3></div><Tag minimal>{selectedStep.dependencies.length} 个依赖</Tag></div>
              <p className="muted">当前步骤只有在所选前置步骤完成后才能进入执行队列。</p>
              <div className="dependency-grid">
                {process.steps.filter((step) => step.id !== selectedStep.id).map((step) => (
                  <Checkbox key={step.id} checked={selectedStep.dependencies.includes(step.id)} label={`${String(process.steps.indexOf(step) + 1).padStart(2, '0')} · ${step.title}`} onChange={(event) => toggleDependency(step.id, event.currentTarget.checked)} />
                ))}
              </div>
            </Card>
          </section>

          <aside className="inspector-panel">
            <Card elevation={Elevation.ONE} className="impact-card">
              <div className="card-title"><div><span>IMPACT ANALYSIS</span><h3>变更影响提醒</h3></div><Tag minimal intent={openBatches.length ? 'warning' : 'none'}>{openBatches.length ? `${openBatches.length} 个待复核批次` : '无待处理批次'}</Tag></div>
              {openBatches.length ? (
                <>
                  <Callout intent="warning" icon="warning-sign">
                    <strong>改动已退回待复核，不能直接冻结</strong>
                    <p>每次改动生成一个待复核批次，改动步骤及其全部下游步骤需由复核员逐项确认，批次才会结案。</p>
                  </Callout>
                  <div className="impact-list">
                    {openBatches.flatMap((batch) => batch.items.filter((item) => !item.confirmed).map((item) => {
                      const step = process.steps.find((entry) => entry.id === item.stepId);
                      const missing = step ? hasMissingSafety(step) : false;
                      return (
                        <button key={`${batch.id}-${item.stepId}`} onClick={() => { setSelectedStepId(item.stepId); setActiveView('review'); }}>
                          <Icon icon={missing ? 'warning-sign' : item.downstream ? 'graph' : 'edit'} intent={missing ? 'danger' : item.downstream ? 'warning' : 'primary'} size={13} />
                          <span><strong>{step?.title ?? item.title}</strong><small>{batch.code} · {missing ? '存在安全缺口 · ' : ''}{item.downstream ? `受「${batch.sourceTitle}」改动影响的下游步骤` : `改动：${batch.changedFields.join('、')}`}</small></span>
                          <Icon icon="chevron-right" size={12} />
                        </button>
                      );
                    }))}
                  </div>
                </>
              ) : (
                <>
                  <Callout intent="primary" icon="tick">
                    <strong>当前没有待处理复核批次</strong>
                    <p>{impactedSteps.length ? `最近编辑涉及 ${impactedSteps.length} 个下游步骤，相关批次已全部结案。` : '编辑任一步骤后，系统会自动计算受影响的全部下游步骤。'}</p>
                  </Callout>
                </>
              )}
            </Card>

            <Card elevation={Elevation.ONE} className="safety-card">
              <div className="card-title"><div><span>SAFETY GATE</span><h3>安全完整性</h3></div><Tag intent={missingSafetySteps.length ? 'danger' : 'success'} minimal>{missingSafetySteps.length ? `${missingSafetySteps.length} 项缺口` : '通过'}</Tag></div>
              {missingSafetySteps.length ? missingSafetySteps.map((step) => (
                <button className="safety-row" key={step.id} onClick={() => setSelectedStepId(step.id)}><Icon icon="warning-sign" intent="danger" size={14} /><span><strong>{step.title}</strong><small>危险项缺少控制措施或安全说明</small></span></button>
              )) : <p className="muted">所有存在危险项的步骤都已填写控制措施和安全说明。</p>}
            </Card>

            <Card elevation={Elevation.ONE} className="gate-card">
              <div className="card-title"><div><span>RELEASE GATE</span><h3>提交与冻结</h3></div></div>
              <div className="gate-row"><span>复核状态</span><strong>{confirmedCount}/{process.steps.length}</strong></div>
              <div className="gate-row"><span>待复核批次</span><strong className={openBatches.length ? 'danger-text' : ''}>{openBatches.length}</strong></div>
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
            <div className="panel-heading"><div><span>REVIEW QUEUE</span><h3>逐条复核</h3></div><Tag intent={openBatches.length ? 'warning' : 'success'}>{openBatches.length ? `${openBatches.length} 个批次待处理` : '已完成'}</Tag></div>
            {process.steps.map((step, index) => (
              <button key={step.id} className={`${step.id === selectedStep?.id ? 'selected' : ''} ${step.status}`} onClick={() => setSelectedStepId(step.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{statusLabel(step.status)}{pendingBatchItems.has(step.id) ? ' · 批次待确认' : ''}</small></div><Icon icon={pendingBatchItems.has(step.id) ? 'notifications' : step.status === 'confirmed' ? 'tick-circle' : step.status === 'returned' ? 'undo' : 'circle'} intent={pendingBatchItems.has(step.id) ? 'warning' : 'none'} size={15} />
              </button>
            ))}
          </aside>
          <section className="review-main">
            {selectedStep && (
              <>
                <Card elevation={Elevation.ONE} className="review-summary">
                  <div className="card-title"><div><span>SAFETY REVIEW</span><h3>{selectedStep.title}</h3></div><Tag intent={selectedStep.status === 'confirmed' ? 'success' : selectedStep.status === 'returned' ? 'danger' : 'warning'}>{statusLabel(selectedStep.status)}</Tag></div>
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
                  <div className="card-title"><div><span>REVIEW COMMENTS</span><h3>复核批注</h3></div><Tag minimal>{selectedStep.comments.length} 条</Tag></div>
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
                    {!selectedStep.comments.length && <p className="muted">当前步骤尚未添加复核批注。</p>}
                  </div>
                </Card>

                <Card elevation={Elevation.ONE} className="batch-card">
                  <div className="card-title"><div><span>REVIEW BATCHES</span><h3>待复核批次</h3></div><Tag minimal intent={openBatches.length ? 'warning' : 'success'}>{openBatches.length ? `${openBatches.length} 个进行中` : '全部结案'}</Tag></div>
                  {openBatches.length ? (
                    <div className="batch-list">
                      {openBatches.map((batch) => {
                        const done = batchConfirmedCount(batch);
                        return (
                          <article key={batch.id} className="batch-item">
                            <header>
                              <div><b>{batch.code}</b><strong>{batch.deleted ? `删除步骤：${batch.sourceTitle}` : `改动步骤：${batch.sourceTitle}`}</strong></div>
                              <Tag minimal intent={done === batch.items.length ? 'success' : 'warning'}>{done}/{batch.items.length}</Tag>
                            </header>
                            <p className="batch-meta">{formatDate(batch.createdAt)} 发起 · 变化内容：{batch.changedFields.join('、')}</p>
                            <div className="batch-items">
                              {batch.items.map((item) => {
                                const step = process.steps.find((entry) => entry.id === item.stepId);
                                const missing = step ? hasMissingSafety(step) : false;
                                return (
                                  <div key={item.stepId} className={item.confirmed ? 'confirmed' : ''}>
                                    <button className="batch-step-link" onClick={() => setSelectedStepId(item.stepId)}>
                                      <Icon icon={item.confirmed ? 'tick-circle' : item.downstream ? 'graph' : 'edit'} intent={item.confirmed ? 'success' : item.downstream ? 'warning' : 'primary'} size={14} />
                                      <span><strong>{step?.title ?? item.title}</strong><small>{item.downstream ? '受影响下游步骤' : '本次改动步骤'}{missing ? ' · 安全缺口' : ''}</small></span>
                                    </button>
                                    {!item.confirmed && (
                                      <div className="batch-item-actions">
                                        <Button small minimal intent="success" icon="tick" text="确认" disabled={!step || missing} onClick={() => confirmBatchItem(batch.id, item.stepId)} />
                                        <Button small minimal intent="warning" icon="undo" text="退回" disabled={!step} onClick={() => returnBatchItem(batch.id, item.stepId)} />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {done === batch.items.length && <p className="batch-done">全部逐项确认，批次已结案。</p>}
                          </article>
                        );
                      })}
                    </div>
                  ) : <p className="muted">没有未处理的复核批次。研究员改动已确认步骤后，改动步骤与全部下游步骤会自动退回这里等待逐项确认。</p>}
                </Card>

                <Card elevation={Elevation.ONE} className="batch-history-card">
                  <div className="card-title"><div><span>BATCH HISTORY</span><h3>批次历史</h3></div><Tag minimal>{process.batches.filter((batch) => batch.closed).length} 个已结案</Tag></div>
                  {process.batches.filter((batch) => batch.closed).length ? (
                    <div className="batch-history">
                      {process.batches.filter((batch) => batch.closed).map((batch) => (
                        <div key={batch.id}>
                          <Icon icon="box" size={13} />
                          <span><strong>{batch.code} · {batch.sourceTitle}</strong><small>{batch.changedFields.join('、')} · {batch.items.length} 项全部确认{batch.closedAt ? ` · ${formatDate(batch.closedAt)} 结案` : ''}</small></span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted">尚无已结案批次。</p>}
                </Card>
              </>
            )}
          </section>
          <aside className="review-actions">
            <Card elevation={Elevation.ONE}>
              <div className="card-title"><div><span>REVIEWER ACTION</span><h3>复核决定</h3></div><Icon icon="endorsed" size={18} /></div>
              {selectedStep && pendingBatchItems.has(selectedStep.id) && (
                <Callout intent="warning" icon="notifications" className="reviewer-batch-callout">
                  该步骤存在于未结复核批次中，请在下方“待复核批次”中逐项确认；全部确认后批次才结案。
                </Callout>
              )}
              <p className="muted">确认后研究员若再次改动同一步骤或其上游，该步骤会随新批次重新退回待复核，旧确认不再有效。</p>
              <Button fill large intent="success" icon="tick" text="确认当前步骤" disabled={!selectedStep || hasMissingSafety(selectedStep) || frozen || (selectedStep?.status === 'confirmed' && !pendingBatchItems.has(selectedStep.id))} onClick={() => selectedStep && setStepStatus('confirmed')} />
              <Button fill large icon="undo" text="退回修改" intent="warning" disabled={!selectedStep || frozen} onClick={() => setStepStatus('returned')} />
              <Button fill large minimal icon="refresh" text="恢复为待复核" disabled={!selectedStep || frozen} onClick={() => setStepStatus('submitted')} />
              <Divider />
              <div className="review-progress-list">
                {process.steps.map((step) => <div key={step.id}><span>{step.title}</span><Tag minimal intent={pendingBatchItems.has(step.id) ? 'warning' : step.status === 'confirmed' ? 'success' : step.status === 'returned' ? 'danger' : 'none'}>{pendingBatchItems.has(step.id) ? '批次待确认' : statusLabel(step.status)}</Tag></div>)}
              </div>
              <Button fill intent="primary" icon="lock" text="全部确认后冻结" onClick={freezeVersion} disabled={frozen} />
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
                  <span></span><div><b>{version.version}</b><strong>{version.label}</strong><p>{formatDate(version.createdAt)} · {version.steps.length} 个步骤 · {version.author}</p><small>{version.note}</small></div>
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
            <div className="diff-table">
              <div className="diff-head"><span>变更类型</span><span>步骤</span><span>具体内容</span></div>
              {versionDiff.map((diff) => <div className={`diff-row ${diff.kind}`} key={diff.id}><Tag minimal intent={diff.kind === 'added' ? 'success' : diff.kind === 'removed' ? 'danger' : 'primary'}>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</Tag><strong>{diff.title}</strong><p>{diff.detail}</p></div>)}
              {!versionDiff.length && <div className="empty-diff"><Icon icon="comparison" size={30} /><strong>两个版本没有差异</strong><p>请选择不同版本，或先冻结新的流程版本。</p></div>}
            </div>
          </Card>
          <Card elevation={Elevation.ONE} className="freeze-rules">
            <div className="card-title"><div><span>FREEZE RULES</span><h3>冻结检查</h3></div></div>
            <div className={openBatches.length === 0 ? 'passed' : ''}><Icon icon={openBatches.length === 0 ? 'tick-circle' : 'circle'} /><span><strong>待复核批次全部结案</strong><small>{openBatches.length} 个未处理批次 · {pendingBatchItems.size} 项待确认</small></span></div>
            <div className={confirmedCount === process.steps.length ? 'passed' : ''}><Icon icon={confirmedCount === process.steps.length ? 'tick-circle' : 'circle'} /><span><strong>所有步骤已确认</strong><small>{confirmedCount}/{process.steps.length}</small></span></div>
            <div className={!missingSafetySteps.length ? 'passed' : ''}><Icon icon={!missingSafetySteps.length ? 'tick-circle' : 'circle'} /><span><strong>安全信息完整</strong><small>{missingSafetySteps.length} 个缺口</small></span></div>
            <div className={process.steps.every((step) => step.dependencies.every((id) => process.steps.some((item) => item.id === id))) ? 'passed' : ''}><Icon icon="git-merge" /><span><strong>依赖引用有效</strong><small>{process.steps.reduce((sum, step) => sum + step.dependencies.length, 0)} 条依赖</small></span></div>
            <Button fill intent="primary" icon="lock" text="冻结当前版本" onClick={freezeVersion} disabled={frozen} />
          </Card>
        </main>
      )}

      <Dialog isOpen={freezeDialogOpen} onClose={() => setFreezeDialogOpen(false)} title="暂时无法冻结版本" icon="lock" className="freeze-dialog">
        <div className="freeze-dialog-body">
          <Callout intent="danger" icon="warning-sign">
            以下复核事项尚未处理完毕，全部解决后才能冻结版本。
          </Callout>
          <ul className="freeze-blocker-list">
            {freezeBlockers.map((blocker) => (
              <li key={blocker}><Icon icon="small-cross" intent="danger" size={14} /><span>{blocker}</span></li>
            ))}
          </ul>
          <p className="muted">研究员的每次改动都会生成待复核批次，改动步骤和全部下游步骤需复核员逐项确认，批次结案后该门禁才会通过。</p>
        </div>
        <div className="freeze-dialog-footer">
          <Button text="关闭" onClick={() => setFreezeDialogOpen(false)} />
          <Button intent="primary" icon="endorsed" text="前往复核" onClick={() => { setFreezeDialogOpen(false); setActiveView('review'); }} />
        </div>
      </Dialog>

      <footer className="app-footer">
        <span>所有实验数据仅保存在当前浏览器 localStorage。</span>
        <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Ctrl/Cmd + S 保存</span>
      </footer>
    </div>
  );
}

function nextMinorVersion(value: string): string {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.2.0';
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function compareVersions(process: ExperimentProcess, baseId: string, targetId: string): DiffItem[] {
  const base = process.versions.find((version) => version.id === baseId);
  const target = process.versions.find((version) => version.id === targetId);
  if (!base || !target) return [];
  const diffs: DiffItem[] = [];
  const targetMap = new Map(target.steps.map((step) => [step.id, step]));
  const baseMap = new Map(base.steps.map((step) => [step.id, step]));
  const titleOf = (id: string): string => targetMap.get(id)?.title ?? baseMap.get(id)?.title ?? id;
  // 依赖关系以两版并集为准，任一版本里挂在该步骤之后的都算受影响。
  const impactOf = (sourceId: string): string[] =>
    [...new Set([...collectDownstream(base.steps, sourceId), ...collectDownstream(target.steps, sourceId)])].map(titleOf);
  base.steps.forEach((step) => {
    if (!targetMap.has(step.id)) {
      const impacted = impactOf(step.id);
      diffs.push({
        id: step.id, title: step.title, kind: 'removed',
        detail: `目标版本已删除该步骤。${impacted.length ? `受影响下游步骤：${impacted.join('、')}。` : '无下游步骤受影响。'}`,
        impactedBy: impacted
      });
    }
  });
  target.steps.forEach((step) => {
    const before = baseMap.get(step.id);
    if (!before) {
      const impacted = impactOf(step.id);
      diffs.push({
        id: step.id, title: step.title, kind: 'added',
        detail: `${step.duration} 分钟；危险项：${step.hazards.join('、') || '无'}。${impacted.length ? `受影响下游步骤：${impacted.join('、')}。` : ''}`,
        impactedBy: impacted
      });
      return;
    }
    const fields: string[] = [];
    if (before.title !== step.title) fields.push('名称');
    if (before.purpose !== step.purpose) fields.push('目的');
    if (before.materials !== step.materials || before.amount !== step.amount) fields.push('材料或用量');
    if (before.equipment !== step.equipment) fields.push('设备');
    if (before.duration !== step.duration) fields.push('预计时间');
    if (JSON.stringify(before.hazards) !== JSON.stringify(step.hazards)) fields.push('危险项');
    if (before.controls !== step.controls || before.safetyNote !== step.safetyNote) fields.push('安全控制');
    if (JSON.stringify(before.dependencies) !== JSON.stringify(step.dependencies)) fields.push('依赖关系');
    if (before.expectedResult !== step.expectedResult) fields.push('预期结果');
    if (fields.length) {
      const impacted = impactOf(step.id);
      diffs.push({
        id: step.id, title: step.title, kind: 'changed',
        detail: `变化字段：${fields.join('、')}。${impacted.length ? `受影响下游步骤：${impacted.join('、')}。` : '无下游步骤受影响。'}`,
        impactedBy: impacted
      });
    }
  });
  return diffs;
}

export default App;
