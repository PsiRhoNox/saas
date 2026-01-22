import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  CheckCircle,
  Clock,
  DollarSign,
  Download,
  FileText,
  History,
  Menu,
  RefreshCw,
  Search,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';
import JSZip from 'jszip';

const STORAGE_KEY = 'denialsZeroDesk';
const STORAGE_VERSION = 4;
const SCORING_VERSION = 'v1.2';
const APPEAL_MODEL_VERSION = 'demo-fallback-v1';

const defaultRules = {
  payerRules: {
    'Blue Cross': { base: 10, mult: 1.2 },
    Aetna: { base: 8, mult: 1.1 },
    United: { base: 7, mult: 1.0 },
    Cigna: { base: 9, mult: 1.15 },
    Humana: { base: 6, mult: 0.95 },
    Medicare: { base: 12, mult: 1.3 },
  },
  denialFactors: {
    'CO-16': { rec: 0.85, boost: 15, act: 'Adjuntar documentación faltante' },
    'CO-4': { rec: 0.8, boost: 12, act: 'Corregir modificadores CPT' },
    'CO-11': { rec: 0.75, boost: 10, act: 'Actualizar código diagnóstico' },
    'CO-197': { rec: 0.65, boost: 20, act: 'Solicitar autorización retroactiva' },
    'CO-18': { rec: 0.15, boost: -10, act: 'Verificar duplicado' },
    'PR-1': { rec: 0.2, boost: -15, act: 'Facturar a paciente' },
  },
};

const initClaims = [
  {
    id: 'CLM-001',
    payerClaimNumber: 'PCN-1001',
    patientControlNumber: 'PAT-1001',
    trackingNumber: 'TRK-1001',
    needsReview: false,
    patient: 'Maria Garcia',
    payer: 'Blue Cross',
    amount: 4250,
    code: 'CO-16',
    reason: 'Falta información',
    status: 'pending',
    cpt: '99214',
    dx: 'E11.9',
    provider: 'Dr. Smith',
    facility: 'Main Clinic',
    submitted: '2024-01-10',
    denied: '2024-01-18',
    appeals: [],
  },
  {
    id: 'CLM-002',
    payerClaimNumber: 'PCN-1002',
    patientControlNumber: 'PAT-1002',
    trackingNumber: 'TRK-1002',
    needsReview: false,
    patient: 'John Davis',
    payer: 'Aetna',
    amount: 8750,
    code: 'CO-4',
    reason: 'Código inconsistente',
    status: 'pending',
    cpt: '99215',
    dx: 'I10',
    provider: 'Dr. Johnson',
    facility: 'East Wing',
    submitted: '2024-01-08',
    denied: '2024-01-16',
    appeals: [],
  },
  {
    id: 'CLM-003',
    payerClaimNumber: 'PCN-1003',
    patientControlNumber: 'PAT-1003',
    trackingNumber: 'TRK-1003',
    needsReview: false,
    patient: 'Sarah Wilson',
    payer: 'United',
    amount: 2100,
    code: 'PR-1',
    reason: 'Deducible',
    status: 'pending',
    cpt: '99213',
    dx: 'J06.9',
    provider: 'Dr. Lee',
    facility: 'Main Clinic',
    submitted: '2024-01-05',
    denied: '2024-01-12',
    appeals: [],
  },
  {
    id: 'CLM-004',
    payerClaimNumber: 'PCN-1004',
    patientControlNumber: 'PAT-1004',
    trackingNumber: 'TRK-1004',
    needsReview: false,
    patient: 'Robert Chen',
    payer: 'Cigna',
    amount: 12500,
    code: 'CO-197',
    reason: 'Sin autorización',
    status: 'in_progress',
    cpt: '43239',
    dx: 'K21.0',
    provider: 'Dr. Martinez',
    facility: 'Surgery',
    submitted: '2024-01-03',
    denied: '2024-01-15',
    appeals: [],
  },
  {
    id: 'CLM-005',
    payerClaimNumber: 'PCN-1005',
    patientControlNumber: 'PAT-1005',
    trackingNumber: 'TRK-1005',
    needsReview: false,
    patient: 'Emily Brown',
    payer: 'Humana',
    amount: 3200,
    code: 'CO-16',
    reason: 'Falta labs',
    status: 'pending',
    cpt: '80053',
    dx: 'R73.09',
    provider: 'Dr. Smith',
    facility: 'Lab',
    submitted: '2024-01-12',
    denied: '2024-01-20',
    appeals: [],
  },
  {
    id: 'CLM-006',
    payerClaimNumber: 'PCN-1006',
    patientControlNumber: 'PAT-1006',
    trackingNumber: 'TRK-1006',
    needsReview: false,
    patient: 'Michael Torres',
    payer: 'Blue Cross',
    amount: 6800,
    code: 'CO-11',
    reason: 'Dx inconsistente',
    status: 'appealed',
    cpt: '47562',
    dx: 'K80.10',
    provider: 'Dr. Johnson',
    facility: 'Surgery',
    submitted: '2024-01-02',
    denied: '2024-01-10',
    appeals: [
      {
        id: 'APL-1001',
        createdAt: '2024-01-19T10:15:00.000Z',
        status: 'submitted',
        summary: 'Carta generada en demo',
      },
    ],
  },
];

const score = (c, date, rules) => {
  const r = rules.payerRules[c.payer] || { base: 5, mult: 1 };
  const d = rules.denialFactors[c.code] || { rec: 0.5, boost: 0, act: 'Revisar' };
  const days = Math.floor((new Date(date) - new Date(c.denied)) / 86400000);
  const amt = Math.min(c.amount / 5000, 3);
  const age = Math.min(days / 30, 2);
  const pen = c.status === 'appealed' ? -20 : c.status === 'in_progress' ? -10 : 0;
  let prio = Math.round(r.base * 3 + d.boost + amt * 15 + age * 10 + d.rec * 20 + pen);
  prio = Math.max(1, Math.min(99, prio));
  let prob = d.rec * r.mult;
  if (c.status === 'appealed') prob *= 1.1;
  if (days > 60) prob *= 0.9;
  prob = Math.round(Math.max(5, Math.min(98, prob * 100)));
  return {
    prio,
    prob,
    action: d.act,
    scoringVersion: SCORING_VERSION,
    inputs: {
      days,
      amt: amt.toFixed(1),
      age: age.toFixed(1),
      pen,
      payerBase: r.base,
      denialBoost: d.boost,
    },
  };
};

const maskName = (name) => {
  if (!name) return '';
  const [first, ...rest] = name.split(' ');
  const maskedRest = rest.map((part) => (part ? `${part[0]}***` : '')).join(' ');
  return `${first[0]}***${maskedRest ? ` ${maskedRest}` : ''}`;
};

const hydrateClaims = (claims, date, rules) =>
  claims.map((c) => ({
    ...c,
    appeals: c.appeals || [],
    ...score(c, date, rules),
  }));

const CSV_FIELDS = [
  'claimId',
  'payerClaimNumber',
  'patientControlNumber',
  'trackingNumber',
  'denialCode',
  'denialReason',
  'amount',
  'status',
];

const CSV_FIELD_LABELS = {
  claimId: 'Claim ID (obligatorio)',
  payerClaimNumber: 'Payer Claim #',
  patientControlNumber: 'Patient Control #',
  trackingNumber: 'Tracking #',
  denialCode: 'Denial/Reason Code',
  denialReason: 'Denial Reason',
  amount: 'Monto',
  status: 'Status',
};

const CSV_FIELD_ALIASES = {
  claimId: ['claim_id', 'claim', 'external_id', 'id'],
  payerClaimNumber: ['payer_claim_number', 'payer_claim', 'payerclaim'],
  patientControlNumber: ['patient_control_number', 'patient_control', 'pcn'],
  trackingNumber: ['tracking_number', 'tracking', 'trn'],
  denialCode: ['denial_code', 'reason_code', 'cas_code', 'code'],
  denialReason: ['denial_reason', 'reason', 'description'],
  amount: ['amount', 'denied_amount', 'charge_amount'],
  status: ['status', 'claim_status'],
};

const normalizeHeader = (value) => value.trim().toLowerCase().replace(/\s+/g, '_');

const parseCsvLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((cell) => cell.trim());
};

const hashPayload = (payload) => {
  const json = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < json.length; i += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
};


const getStoredState = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    return parsed;
  } catch (error) {
    console.error('Storage parse failed', error);
    return null;
  }
};

const persistState = (state) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Storage write failed', error);
  }
};

const buildAuditEntry = ({
  action,
  claimId,
  detail,
  source,
  before,
  after,
  scoring,
  simDate,
  aiDecision,
  modelVersion,
  requestId,
  latencyMs,
  result,
  payloadHash,
}) => {
  const timestamp = new Date();
  return {
    id: timestamp.getTime(),
    ts: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: timestamp.toLocaleDateString(),
    simDate,
    user: source === 'system' ? 'Sistema' : 'Ana R.',
    action,
    claimId,
    detail,
    source,
    before,
    after,
    changedFields: before && after ? Object.keys(after).filter((k) => before[k] !== after[k]) : [],
    scoringInputs: scoring?.inputs || null,
    scoringVersion: scoring?.scoringVersion || null,
    aiDecision: aiDecision ?? source === 'system',
    modelVersion: modelVersion || null,
    requestId: requestId || null,
    latencyMs: latencyMs ?? null,
    result: result || null,
    payloadHash: payloadHash || null,
  };
};

const paymentTone = {
  amber: 'text-amber-600',
  purple: 'text-purple-600',
  emerald: 'text-emerald-600',
};

const TASK_TYPES = [
  'request_docs',
  'fix_coding',
  'call_payer',
  'submit_corrected_claim',
  'appeal_draft',
  'patient_resp_followup',
];

const TASK_LABELS = {
  request_docs: 'Solicitar documentación',
  fix_coding: 'Corregir codificación',
  call_payer: 'Llamar al pagador',
  submit_corrected_claim: 'Enviar claim corregido',
  appeal_draft: 'Borrador de apelación',
  patient_resp_followup: 'Seguimiento paciente',
};

const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done'];
const OWNER_ROLES = ['coder', 'biller', 'arv_specialist', 'supervisor'];
const OWNER_ROLE_LABELS = {
  coder: 'Coder',
  biller: 'Biller',
  arv_specialist: 'ARV Specialist',
  supervisor: 'Supervisor',
};

const OWNER_POOL = {
  coder: ['Luis C.', 'María R.'],
  biller: ['Jorge T.', 'Diana S.'],
  arv_specialist: ['Ana R.', 'Carlos P.'],
  supervisor: ['Supervisor'],
};

const TASK_TYPE_OWNER = {
  request_docs: 'arv_specialist',
  fix_coding: 'coder',
  call_payer: 'biller',
  submit_corrected_claim: 'biller',
  appeal_draft: 'arv_specialist',
  patient_resp_followup: 'arv_specialist',
};

const TASK_TYPE_SLA_DAYS = {
  request_docs: 5,
  fix_coding: 3,
  call_payer: 2,
  submit_corrected_claim: 4,
  appeal_draft: 2,
  patient_resp_followup: 7,
};

const PLAYBOOK_CATEGORIES = ['coding', 'eligibility', 'documentation', 'medical_necessity', 'authorization', 'unknown'];
const QUALITY_GAP_FLAGS = ['auth', 'eligibilidad', 'coding', 'medical_necessity', 'documentation'];
const PREVENTION_STATUSES = ['open', 'in_progress', 'shipped'];
const PREVENTION_OWNER_ROLES = ['coding', 'front_desk', 'auth_team', 'clinical'];

export default function App() {
  const [view, setView] = useState('dashboard');
  const [sel, setSel] = useState(null);
  const [side, setSide] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);
  const [appeal, setAppeal] = useState('');
  const [date, setDate] = useState(new Date('2024-01-22'));
  const [claims, setClaims] = useState([]);
  const [audit, setAudit] = useState([]);
  const [stats, setStats] = useState({ proc: 0, app: 0 });
  const [rules, setRules] = useState(defaultRules);
  const [demoMode, setDemoMode] = useState(true);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [opsRoleFilter, setOpsRoleFilter] = useState('all');
  const [ingestionRuns, setIngestionRuns] = useState([]);
  const [pendingMappings, setPendingMappings] = useState({});
  const [mappingDrafts, setMappingDrafts] = useState({});
  const [activeRunId, setActiveRunId] = useState(null);
  const [awaitingInboxRedirect, setAwaitingInboxRedirect] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [ingestionDetail, setIngestionDetail] = useState(null);
  const [needsReview, setNeedsReview] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [triageResults, setTriageResults] = useState({});
  const [tasks, setTasks] = useState([]);
  const [taskTypeDraft, setTaskTypeDraft] = useState('request_docs');
  const [playbooks, setPlaybooks] = useState([]);
  const [playbookDraft, setPlaybookDraft] = useState({
    name: '',
    category: 'unknown',
    conditions: { payer: '', reasonCode: '', minAmount: '' },
    steps: [''],
    documents: [''],
    clinicalReviewRequired: false,
    appealAngle: '',
    qualityFields: [],
  });
  const [editingPlaybookId, setEditingPlaybookId] = useState(null);
  const [playbookUsage, setPlaybookUsage] = useState({});
  const [preventionIssues, setPreventionIssues] = useState([]);
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [selectedPlaybookId, setSelectedPlaybookId] = useState('');
  const [programSummary, setProgramSummary] = useState('');
  const [contractTerms, setContractTerms] = useState([]);
  const [contractOverrides, setContractOverrides] = useState([]);
  const [underpaymentItems, setUnderpaymentItems] = useState([]);
  const [contractDraft, setContractDraft] = useState({
    payer: '',
    effectiveStart: '',
    effectiveEnd: '',
    expectedPercent: '',
    notes: '',
  });
  const [overrideDraft, setOverrideDraft] = useState({
    payer: '',
    cptCode: '',
    effectiveStart: '',
    effectiveEnd: '',
    expectedPercent: '',
  });
  const [contractError, setContractError] = useState('');
  const [underpaymentFilter, setUnderpaymentFilter] = useState('all');
  const [selectedUnderpaymentId, setSelectedUnderpaymentId] = useState(null);
  const [integrations, setIntegrations] = useState([
    {
      id: 'int-001',
      name: 'Clearinghouse SFTP (demo)',
      host: 'sftp.demo-clearinghouse.com',
      user: 'demo-user',
      path: '/inbox',
      schedule: 'Pendiente',
      timezone: 'Pendiente',
      lastPull: 'Pendiente',
      lastFile: '-',
      errors: 0,
    },
  ]);

  useEffect(() => {
    const stored = getStoredState();
    if (stored) {
      setRules(stored.rules || defaultRules);
      setStats(stored.stats || { proc: 0, app: 0 });
      setDemoMode(stored.demoMode ?? true);
      setIngestionRuns(stored.ingestionRuns || []);
      setPendingMappings(stored.pendingMappings || {});
      setMappingDrafts(stored.mappingDrafts || {});
      setActiveRunId(stored.activeRunId || null);
      setAwaitingInboxRedirect(stored.awaitingInboxRedirect || false);
      setNeedsReview(stored.needsReview || []);
      setUnmatched(stored.unmatched || []);
      setTriageResults(stored.triageResults || {});
      setTasks(stored.tasks || []);
      setPlaybooks(stored.playbooks || []);
      setPlaybookUsage(stored.playbookUsage || {});
      setPreventionIssues(stored.preventionIssues || []);
      setContractTerms(stored.contractTerms || []);
      setContractOverrides(stored.contractOverrides || []);
      setUnderpaymentItems(stored.underpaymentItems || []);
      setIntegrations(stored.integrations || integrations);
      if (stored.date) setDate(new Date(stored.date));
      const seeded = hydrateClaims(stored.claims || initClaims, stored.date || date, stored.rules || defaultRules);
      setClaims(seeded);
      setAudit(
        stored.audit || [
          buildAuditEntry({
            action: 'Inicio',
            claimId: 'ALL',
            detail: 'Carga desde storage',
            source: 'system',
            simDate: new Date(stored.date || date).toLocaleDateString(),
          }),
        ]
      );
    } else {
      const seeded = hydrateClaims(initClaims, date, rules);
      setClaims(seeded);
      setAudit([
        buildAuditEntry({
          action: 'Inicio',
          claimId: 'ALL',
          detail: 'Sesión nueva',
          source: 'system',
          simDate: date.toLocaleDateString(),
        }),
      ]);
    }

    if (typeof window !== 'undefined') {
      const seen = window.localStorage.getItem('dz_tour_seen');
      if (!seen) {
        setShowTour(true);
        window.localStorage.setItem('dz_tour_seen', 'true');
      }
    }
  }, []);

  useEffect(() => {
    if (!claims.length) return;
    const rescored = claims.map((c) => ({ ...c, ...score(c, date, rules) }));
    setClaims(rescored);
    if (sel) {
      const refreshed = rescored.find((c) => c.id === sel.id);
      if (refreshed) setSel(refreshed);
    }
  }, [date, rules]);

  useEffect(() => {
    if (!claims.length) return;
    persistState({
      version: STORAGE_VERSION,
      claims,
      audit,
      stats,
      date: date.toISOString(),
      rules,
      demoMode,
      ingestionRuns,
      pendingMappings,
      mappingDrafts,
      activeRunId,
      awaitingInboxRedirect,
      needsReview,
      unmatched,
      triageResults,
      tasks,
      playbooks,
      playbookUsage,
      preventionIssues,
      contractTerms,
      contractOverrides,
      underpaymentItems,
      integrations,
    });
  }, [
    claims,
    audit,
    stats,
    date,
    rules,
    demoMode,
    ingestionRuns,
    pendingMappings,
    mappingDrafts,
    activeRunId,
    awaitingInboxRedirect,
    needsReview,
    unmatched,
    triageResults,
    tasks,
    playbooks,
    playbookUsage,
    preventionIssues,
    contractTerms,
    contractOverrides,
    underpaymentItems,
    integrations,
  ]);

  const metrics = useMemo(() => {
    const totalAmount = claims.reduce((sum, claim) => sum + claim.amount, 0);
    return {
      total: claims.length,
      pending: claims.filter((c) => c.status === 'pending').length,
      inProgress: claims.filter((c) => c.status === 'in_progress').length,
      appealed: claims.filter((c) => c.status === 'appealed').length,
      amount: totalAmount,
      avgProb: claims.length ? Math.round(claims.reduce((s, c) => s + c.prob, 0) / claims.length) : 0,
      highPrio: claims.filter((c) => c.prio >= 70).length,
    };
  }, [claims]);

  const opsMetrics = useMemo(() => {
    const openTasks = tasks.filter((t) => t.status !== 'done');
    const overdueTasks = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());
    const openDenials = claims.filter((c) => c.status !== 'appealed');
    const riskAmount = openDenials.reduce((sum, c) => sum + c.amount, 0);
    const recoverable = openDenials.reduce((sum, c) => sum + c.amount * (c.prob / 100), 0);
    const completedToday = tasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
    const completedWithDuration = tasks.filter((t) => t.completedAt);
    const avgCompletionHours =
      completedWithDuration.length > 0
        ? Math.round(
            completedWithDuration.reduce((sum, t) => sum + (new Date(t.completedAt) - new Date(t.createdAt)) / 3600000, 0) /
              completedWithDuration.length
          )
        : 0;
    const byRole = OWNER_ROLES.map((role) => {
      const roleTasks = tasks.filter((t) => t.ownerRole === role);
      const open = roleTasks.filter((t) => t.status !== 'done').length;
      const done = roleTasks.filter((t) => t.status === 'done').length;
      return {
        role,
        open,
        done,
      };
    });
    return {
      backlog: openDenials.length,
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
      riskAmount,
      recoverable,
      completedToday: completedToday.length,
      avgCompletionHours,
      byRole,
    };
  }, [claims, tasks]);

  const programMetrics = useMemo(() => {
    const backlog = claims.length;
    const riskAmount = claims.reduce((sum, c) => sum + c.amount, 0);
    const stageCounts = {
      new: claims.filter((c) => c.status === 'pending').length,
      in_progress: claims.filter((c) => c.status === 'in_progress').length,
      appeal_pending: claims.filter((c) => c.status === 'appealed').length,
      resolved: claims.filter((c) => c.status === 'resolved').length,
    };
    const avgQueueDays =
      claims.length > 0
        ? Math.round(
            claims.reduce((sum, c) => sum + (new Date() - new Date(c.denied || c.submitted)) / 86400000, 0) / claims.length
          )
        : 0;
    const topCauses = [...claims].reduce((acc, c) => {
      const key = c.root_cause_bucket || c.code || 'unknown';
      acc[key] = (acc[key] || 0) + c.amount;
      return acc;
    }, {});
    const topCauseEntries = Object.entries(topCauses)
      .map(([key, total]) => ({ key, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    const topPlaybooks = Object.entries(playbookUsage)
      .map(([id, count]) => ({ id, count, name: playbooks.find((pb) => pb.id === id)?.name || id }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    const topIssues = preventionIssues
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        impact: issue.impactEstimate || 0,
      }))
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3);
    return {
      backlog,
      riskAmount,
      stageCounts,
      avgQueueDays,
      topCauseEntries,
      topPlaybooks,
      topIssues,
    };
  }, [claims, playbookUsage, playbooks, preventionIssues]);

  const tutorialSteps = [
    {
      title: '1. El cliente ya recibe 277CA y 835',
      body: 'El clearinghouse o pagador envía estos archivos al cliente. Aquí no inventamos integraciones: solo los subes o los lees vía SFTP.',
    },
    {
      title: '2. Orden recomendado',
      body: 'Primero sube 277CA para conocer el estatus y tracking; luego 835 para ajustes CAS y montos. Ejemplo: 277CA → 835.',
    },
    {
      title: '3. Resultado visible',
      body: 'La ingestión crea o actualiza claims, genera denials con códigos y deja historial por archivo. Luego revisas la Denials Inbox.',
    },
  ];

  const logAudit = ({
    action,
    claimId,
    detail,
    source,
    before,
    after,
    scoring,
    aiDecision,
    modelVersion,
    requestId,
    latencyMs,
    result,
    payloadHash,
  }) => {
    const entry = buildAuditEntry({
      action,
      claimId,
      detail,
      source,
      before,
      after,
      scoring,
      simDate: date.toLocaleDateString(),
      aiDecision,
      modelVersion,
      requestId,
      latencyMs,
      result,
      payloadHash,
    });
    setAudit((prev) => [entry, ...prev]);
  };

  const updateClaimFields = (claimId, updates, detail) => {
    setClaims((prev) =>
      prev.map((c) =>
        c.id === claimId
          ? {
              ...c,
              ...updates,
              ...score({ ...c, ...updates }, date, rules),
            }
          : c
      )
    );
    logAudit({
      action: 'Usuario actualizó campos del denial',
      claimId,
      detail,
      source: 'user',
    });
  };

  const createPlaybook = (payload) => {
    const id = `pb-${Date.now()}`;
    const playbook = {
      id,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload,
    };
    setPlaybooks((prev) => [playbook, ...prev]);
    logAudit({
      action: 'Usuario creó playbook',
      claimId: 'PLAYBOOK',
      detail: `${playbook.name} v${playbook.version}`,
      source: 'user',
    });
  };

  const updatePlaybook = (playbookId, payload) => {
    setPlaybooks((prev) =>
      prev.map((pb) =>
        pb.id === playbookId
          ? {
              ...pb,
              ...payload,
              updatedAt: new Date().toISOString(),
            }
          : pb
      )
    );
    logAudit({
      action: 'Usuario editó playbook',
      claimId: 'PLAYBOOK',
      detail: `${payload.name || 'Playbook'} actualizado`,
      source: 'user',
    });
  };

  const duplicatePlaybook = (playbook) => {
    const copy = {
      ...playbook,
      id: `pb-${Date.now()}`,
      name: `${playbook.name} (copia)`,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlaybooks((prev) => [copy, ...prev]);
    logAudit({
      action: 'Usuario duplicó playbook',
      claimId: 'PLAYBOOK',
      detail: `${playbook.name} → ${copy.name}`,
      source: 'user',
    });
  };

  const versionPlaybook = (playbook) => {
    const next = {
      ...playbook,
      id: `pb-${Date.now()}`,
      version: playbook.version + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlaybooks((prev) => [next, ...prev]);
    logAudit({
      action: 'Usuario versionó playbook',
      claimId: 'PLAYBOOK',
      detail: `${playbook.name} v${next.version}`,
      source: 'user',
    });
  };

  const applyPlaybookToClaim = (playbook, claim) => {
    const steps = playbook.steps.filter(Boolean);
    const docs = playbook.documents.filter(Boolean);
    const nextTriage = {
      suggested_action_short: steps[0] || claim.action || 'Revisar',
      suggested_action_steps: steps.length ? steps : [claim.action || 'Revisar expediente'],
      required_documents: docs.length ? docs : ['Documentación faltante'],
      appeal_angle: playbook.appealAngle || 'Revisar caso con documentación.',
      appeal_recommended: playbook.clinicalReviewRequired,
    };
    setTriageResults((prev) => ({ ...prev, [claim.id]: { ...prev[claim.id], ...nextTriage } }));
    updateClaimFields(
      claim.id,
      {
        action: nextTriage.suggested_action_short,
        denial_category_normalized: playbook.category,
        root_cause_bucket: playbook.category,
        quality_gap_flags: playbook.qualityFields || [],
        clinical_review_required: playbook.clinicalReviewRequired,
      },
      `Playbook aplicado: ${playbook.name}`
    );
    setPlaybookUsage((prev) => ({
      ...prev,
      [playbook.id]: (prev[playbook.id] || 0) + 1,
    }));
    logAudit({
      action: 'Usuario aplicó playbook',
      claimId: claim.id,
      detail: `${playbook.name} v${playbook.version} • ${playbook.id}`,
      source: 'user',
      requestId: `playbook-${playbook.id}-v${playbook.version}`,
    });
  };

  const hasOverlap = (ranges, next) => {
    const start = new Date(next.effectiveStart).getTime();
    const end = new Date(next.effectiveEnd).getTime();
    return ranges.some((item) => {
      const itemStart = new Date(item.effectiveStart).getTime();
      const itemEnd = new Date(item.effectiveEnd).getTime();
      return start <= itemEnd && end >= itemStart;
    });
  };

  const addContractTerm = () => {
    setContractError('');
    if (!contractDraft.payer || !contractDraft.effectiveStart || !contractDraft.effectiveEnd || !contractDraft.expectedPercent) {
      setContractError('Completa todos los campos obligatorios.');
      return;
    }
    if (new Date(contractDraft.effectiveEnd) <= new Date(contractDraft.effectiveStart)) {
      setContractError('La fecha fin debe ser mayor que la fecha inicio.');
      return;
    }
    const overlaps = hasOverlap(
      contractTerms.filter((term) => term.payer === contractDraft.payer),
      contractDraft
    );
    if (overlaps) {
      setContractError('El rango se solapa con otra regla del mismo pagador.');
      return;
    }
    const term = {
      id: `ct-${Date.now()}`,
      payer: contractDraft.payer,
      effectiveStart: contractDraft.effectiveStart,
      effectiveEnd: contractDraft.effectiveEnd,
      expectedPercent: Number(contractDraft.expectedPercent),
      notes: contractDraft.notes,
      createdAt: new Date().toISOString(),
    };
    setContractTerms((prev) => [term, ...prev]);
    logAudit({
      action: 'Usuario creó regla Contract Lite',
      claimId: 'CONTRACT',
      detail: `${term.payer} ${term.expectedPercent}%`,
      source: 'user',
    });
    setContractDraft({ payer: '', effectiveStart: '', effectiveEnd: '', expectedPercent: '', notes: '' });
  };

  const addContractOverride = () => {
    setContractError('');
    if (
      !overrideDraft.payer ||
      !overrideDraft.cptCode ||
      !overrideDraft.effectiveStart ||
      !overrideDraft.effectiveEnd ||
      !overrideDraft.expectedPercent
    ) {
      setContractError('Completa todos los campos obligatorios.');
      return;
    }
    if (new Date(overrideDraft.effectiveEnd) <= new Date(overrideDraft.effectiveStart)) {
      setContractError('La fecha fin debe ser mayor que la fecha inicio.');
      return;
    }
    const overlaps = hasOverlap(
      contractOverrides.filter((ovr) => ovr.payer === overrideDraft.payer && ovr.cptCode === overrideDraft.cptCode),
      overrideDraft
    );
    if (overlaps) {
      setContractError('El override se solapa con otro rango para el mismo CPT.');
      return;
    }
    const override = {
      id: `cto-${Date.now()}`,
      payer: overrideDraft.payer,
      cptCode: overrideDraft.cptCode,
      effectiveStart: overrideDraft.effectiveStart,
      effectiveEnd: overrideDraft.effectiveEnd,
      expectedPercent: Number(overrideDraft.expectedPercent),
      createdAt: new Date().toISOString(),
    };
    setContractOverrides((prev) => [override, ...prev]);
    logAudit({
      action: 'Usuario creó override de contrato',
      claimId: 'CONTRACT',
      detail: `${override.payer} ${override.cptCode} ${override.expectedPercent}%`,
      source: 'user',
    });
    setOverrideDraft({ payer: '', cptCode: '', effectiveStart: '', effectiveEnd: '', expectedPercent: '' });
  };

  const findContractTerm = (payer, serviceDate) =>
    contractTerms.find((term) => {
      if (term.payer !== payer) return false;
      const date = new Date(serviceDate || new Date().toISOString()).getTime();
      return date >= new Date(term.effectiveStart).getTime() && date <= new Date(term.effectiveEnd).getTime();
    });

  const findContractOverride = (payer, cptCode, serviceDate) =>
    contractOverrides.find((override) => {
      if (override.payer !== payer || override.cptCode !== cptCode) return false;
      const date = new Date(serviceDate || new Date().toISOString()).getTime();
      return date >= new Date(override.effectiveStart).getTime() && date <= new Date(override.effectiveEnd).getTime();
    });

  const scoreUnderpayment = (item, payerRules) => {
    const base = payerRules?.[item.payer] || { base: 5, mult: 1 };
    const days = Math.floor((new Date() - new Date(item.detectedAt)) / 86400000);
    const variance = Math.min(item.varianceAmount / 1000, 10);
    const age = Math.min(days / 30, 2);
    let prio = Math.round(base.base * 3 + variance * 10 + age * 8);
    prio = Math.max(1, Math.min(99, prio));
    return { prio, prob: Math.round(Math.max(5, Math.min(95, base.mult * 60 + variance * 2))) };
  };

  const buildPreventionSuggestions = () => {
    const byCode = {};
    claims.forEach((claim) => {
      const key = claim.code || 'unknown';
      if (!byCode[key]) {
        byCode[key] = { code: key, total: 0, count: 0, payer: claim.payer };
      }
      byCode[key].total += claim.amount || 0;
      byCode[key].count += 1;
    });
    return Object.values(byCode)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  };

  const createPreventionIssue = (payload) => {
    const issue = {
      id: `issue-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'open',
      linkedClaimIds: [],
      ...payload,
    };
    setPreventionIssues((prev) => [issue, ...prev]);
    logAudit({
      action: 'Usuario creó issue de prevención',
      claimId: 'PREVENTION',
      detail: issue.title,
      source: 'user',
    });
    return issue;
  };

  const linkIssueToClaim = (issueId, claim) => {
    setPreventionIssues((prev) =>
      prev.map((issue) => {
        if (issue.id !== issueId) return issue;
        const linkedClaimIds = [...new Set([...(issue.linkedClaimIds || []), claim.id])];
        const impactEstimate = linkedClaimIds.reduce((sum, id) => {
          const linked = claims.find((c) => c.id === id);
          return sum + (linked?.amount || 0);
        }, 0);
        return { ...issue, linkedClaimIds, impactEstimate };
      })
    );
    updateClaimFields(
      claim.id,
      { prevention_issue_ids: [...new Set([...(claim.prevention_issue_ids || []), issueId])] },
      'Denial vinculado a prevención'
    );
    logAudit({
      action: 'Usuario vinculó denial a prevención',
      claimId: claim.id,
      detail: `Issue ${issueId}`,
      source: 'user',
    });
  };

  const computeDueDate = (taskType, payer) => {
    const baseDays = TASK_TYPE_SLA_DAYS[taskType] || 5;
    const payerBoost = payer === 'Medicare' ? -1 : payer === 'Blue Cross' ? 1 : 0;
    const due = new Date();
    due.setDate(due.getDate() + Math.max(1, baseDays + payerBoost));
    return due.toISOString();
  };

  const assignTaskToRole = (role, existingTasks) => {
    const pool = OWNER_POOL[role] || ['Equipo'];
    const counts = pool.map((name) => ({
      name,
      count: existingTasks.filter((task) => task.ownerName === name && task.status !== 'done').length,
    }));
    counts.sort((a, b) => a.count - b.count);
    return counts[0]?.name || pool[0];
  };

  const createTask = ({
    denialId,
    claimId,
    title,
    taskType,
    source = 'system',
    payer,
    notes,
    ownerRole,
    ownerName,
    dueDate,
    nextFollowUpAt,
  }) => {
    const createdAt = new Date().toISOString();
    const role = ownerRole || TASK_TYPE_OWNER[taskType] || 'arv_specialist';
    const assignedName = ownerName || assignTaskToRole(role, tasks);
    return {
      id: `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      denialId,
      claimId,
      title,
      taskType,
      status: 'open',
      ownerRole: role,
      ownerName: assignedName,
      dueDate: dueDate || computeDueDate(taskType, payer),
      nextFollowUpAt: nextFollowUpAt || null,
      createdAt,
      completedAt: null,
      source,
      notes: notes || '',
    };
  };

  const detectEdiType = (fileName, content) => {
    const upper = `${fileName} ${content}`.toUpperCase();
    if (fileName.toLowerCase().endsWith('.csv')) return 'CSV';
    if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
    if (upper.includes('277') || upper.includes('STC')) return '277CA';
    return 'unknown';
  };

  const parse835 = (content) => {
    const segments = content.replace(/\r/g, '').split('~').map((s) => s.trim()).filter(Boolean);
    const rows = [];
    const errors = [];
    let currentClaim = null;
    segments.forEach((segment, index) => {
      const parts = segment.split('*');
      const tag = parts[0];
      if (tag === 'CLP') {
        if (!parts[1]) {
          errors.push({ line: index + 1, message: 'CLP sin identificador de claim' });
        }
        currentClaim = {
          payerClaimNumber: parts[1] || '',
          patientControlNumber: parts[7] || '',
          trackingNumber: '',
          charged: Number(parts[3] || 0),
          paid: Number(parts[4] || 0),
          patientResp: Number(parts[5] || 0),
          adjustments: [],
        };
        rows.push(currentClaim);
      }
      if (tag === 'TRN' && parts[1] === '1' && currentClaim) {
        currentClaim.trackingNumber = parts[2] || '';
      }
      if (tag === 'CAS' && currentClaim) {
        const groupCode = parts[1];
        for (let i = 2; i < parts.length; i += 3) {
          const reasonCode = parts[i];
          const amount = Number(parts[i + 1] || 0);
          if (!reasonCode) continue;
          currentClaim.adjustments.push({ groupCode, reasonCode, amount });
        }
      }
    });
    return { rows, errors };
  };

  const parse277 = (content) => {
    const segments = content.replace(/\r/g, '').split('~').map((s) => s.trim()).filter(Boolean);
    const rows = [];
    const errors = [];
    let trackingNumber = '';
    let patientControlNumber = '';
    segments.forEach((segment, index) => {
      const parts = segment.split('*');
      const tag = parts[0];
      if (tag === 'TRN' && parts[1] === '1') {
        trackingNumber = parts[2] || '';
      }
      if (tag === 'REF' && parts[1] === '1K') {
        patientControlNumber = parts[2] || '';
      }
      if (tag === 'STC') {
        const status = parts[1] || '';
        if (!status) {
          errors.push({ line: index + 1, message: 'STC sin status' });
        }
        rows.push({
          status,
          trackingNumber,
          patientControlNumber,
        });
      }
    });
    return { rows, errors };
  };

  const detectCsvMapping = (headers) => {
    if (!headers?.length) return {};
    const normalized = headers.map((header) => normalizeHeader(header));
    const mapping = {};
    CSV_FIELDS.forEach((field) => {
      const alias = CSV_FIELD_ALIASES[field].find((option) => normalized.includes(option));
      if (alias) {
        mapping[field] = headers[normalized.indexOf(alias)];
      }
    });
    return mapping;
  };

  const parseCsv = (content, mapping) => {
    const lines = content.replace(/\r/g, '').split('\n').filter((line) => line.trim().length);
    const errors = [];
    if (lines.length < 2) {
      return { rows: [], errors: [{ line: 1, message: 'CSV sin filas de datos' }] };
    }
    const headers = parseCsvLine(lines[0]);
    const headerIndex = Object.fromEntries(headers.map((header, idx) => [header, idx]));
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const cells = parseCsvLine(line);
      const row = {};
      CSV_FIELDS.forEach((field) => {
        const column = mapping?.[field];
        if (!column) return;
        const index = headerIndex[column];
        row[field] = index !== undefined ? cells[index] : '';
      });
      if (!row.claimId && !row.payerClaimNumber && !row.patientControlNumber && !row.trackingNumber) {
        errors.push({ line: i + 1, message: 'Fila sin identificador de claim' });
        continue;
      }
      rows.push(row);
    }
    return { rows, errors, headers };
  };

  const runTriage = (denial, claim) => {
    const rule = defaultRules.denialFactors[denial.code] || { rec: 0.5, boost: 0, act: 'Revisar' };
    const priorityAdjustment = Math.round(rule.boost / 4);
    return {
      denial_category_normalized: denial.code.startsWith('CO') ? 'coding' : 'eligibility',
      root_cause_guess: { label: denial.reason || 'Faltan datos', confidence: 0.58 },
      suggested_action_short: rule.act,
      suggested_action_steps: ['Revisar el expediente', 'Validar CPT/Dx', 'Adjuntar soporte', 'Reenviar al pagador'],
      required_documents: ['Notas clínicas', 'Orden médica', 'Evidencia de elegibilidad'],
      who_should_work_it: 'RCM Specialist',
      priority_adjustment: priorityAdjustment,
      appeal_recommended: rule.rec > 0.6,
      appeal_angle: 'Necesidad médica y corrección de documentación.',
      warnings: ['Datos incompletos del pagador', 'Verificar elegibilidad'],
    };
  };

  const applyTriage = (denialId) => {
    const result = triageResults[denialId];
    if (!result) return;
    const claim = claims.find((c) => c.id === denialId);
    if (!claim) return;
    const adjusted = Math.max(1, Math.min(99, claim.prio + result.priority_adjustment));
    const updated = {
      ...claim,
      action: result.suggested_action_short,
      denial_category_normalized: result.denial_category_normalized || claim.denial_category_normalized || 'unknown',
      root_cause_bucket: result.root_cause_guess?.label || claim.root_cause_bucket || 'unknown',
      quality_gap_flags: claim.quality_gap_flags || [],
      clinical_review_required: result.appeal_recommended || false,
      prio: adjusted,
      status: claim.status === 'pending' ? 'in_progress' : claim.status,
    };
    setClaims((prev) => prev.map((c) => (c.id === claim.id ? updated : c)));
    if (sel?.id === claim.id) setSel(updated);
    setTasks((prev) => [
      createTask({
        denialId: claim.id,
        claimId: claim.id,
        title: result.suggested_action_short,
        taskType: 'appeal_draft',
        source: 'ai',
        payer: claim.payer,
        notes: 'Sugerencia automática basada en denial.',
      }),
      ...prev,
    ]);
    logAudit({
      action: 'Sistema aplicó sugerencias IA',
      claimId: claim.id,
      detail: result.suggested_action_short,
      source: 'system',
      scoring: updated,
      aiDecision: true,
      modelVersion: APPEAL_MODEL_VERSION,
      requestId: `triage-${denialId}`,
      result: 'ok',
    });
  };

  const findClaimMatch = (list, identifiers) =>
    list.find(
      (c) =>
        (identifiers.patientControlNumber && c.patientControlNumber === identifiers.patientControlNumber) ||
        (identifiers.payerClaimNumber && c.payerClaimNumber === identifiers.payerClaimNumber) ||
        (identifiers.trackingNumber && c.trackingNumber === identifiers.trackingNumber)
    );

  const createNewClaim = (identifier, amount, fallbackIndex, sourceLabel) => {
    const safeSource = sourceLabel ? sourceLabel.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'FILE';
    const externalId = identifier || `EXT-${safeSource}-${fallbackIndex + 1}`;
    const base = {
      id: externalId,
      payerClaimNumber: identifier || '',
      patientControlNumber: '',
      trackingNumber: '',
      needsReview: true,
      patient: demoMode ? 'Paciente Nuevo' : 'Paciente Nuevo',
      payer: 'Blue Cross',
      amount: amount || 1200,
      code: 'CO-11',
      reason: 'Revisar detalle',
      status: 'pending',
      cpt: '99214',
      dx: 'E11.9',
      provider: 'Dr. Demo',
      facility: 'Main Clinic',
      submitted: date.toISOString().slice(0, 10),
      denied: date.toISOString().slice(0, 10),
      appeals: [],
    };
    return { ...base, ...score(base, date, rules) };
  };

  const updateRun = (runId, updater) => {
    setIngestionRuns((prev) => prev.map((run) => (run.id === runId ? updater(run) : run)));
  };

  const expandFiles = async (fileList) => {
    const files = Array.from(fileList);
    const expanded = [];
    for (const file of files) {
      if (!file.name) continue;
      if (file.name.toLowerCase().endsWith('.zip')) {
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.values(zip.files).filter((entry) => !entry.dir);
          for (const entry of entries) {
            const content = await entry.async('string');
            expanded.push({
              id: `${file.name}-${entry.name}-${Date.now()}`,
              name: entry.name,
              sourceName: file.name,
              content,
            });
          }
        } catch (error) {
          expanded.push({
            id: `${file.name}-${Date.now()}`,
            name: file.name,
            sourceName: null,
            content: '',
            zipError: `No se pudo abrir el zip: ${error.message}`,
          });
        }
      } else {
        const content = await file.text();
        expanded.push({ id: `${file.name}-${Date.now()}`, name: file.name, sourceName: null, content });
      }
    }
    return expanded;
  };

  const processFileEntry = async (runId, fileEntry, fileIndex, mappingOverride = null) => {
    updateRun(runId, (run) => ({
      ...run,
      status: 'processing',
      files: run.files.map((f) => (f.id === fileEntry.id ? { ...f, status: 'processing' } : f)),
    }));

    if (fileEntry.zipError) {
      updateRun(runId, (run) => ({
        ...run,
        files: run.files.map((f) =>
          f.id === fileEntry.id
            ? {
                ...f,
                status: 'error',
                errors: [{ line: '-', message: fileEntry.zipError }],
              }
            : f
        ),
      }));
      setNeedsReview((prev) => [
        { id: fileEntry.id, name: fileEntry.name, reason: fileEntry.zipError, receivedAt: fileEntry.receivedAt },
        ...prev,
      ]);
      return { denialsCreated: 0 };
    }

    const type = detectEdiType(fileEntry.name, fileEntry.content);
    if (type === 'unknown') {
      updateRun(runId, (run) => ({
        ...run,
        files: run.files.map((f) =>
          f.id === fileEntry.id
            ? { ...f, status: 'error', errors: [{ line: '-', message: 'Tipo no reconocido' }] }
            : f
        ),
      }));
      setNeedsReview((prev) => [
        { id: fileEntry.id, name: fileEntry.name, reason: 'Tipo no reconocido', receivedAt: fileEntry.receivedAt },
        ...prev,
      ]);
      return { denialsCreated: 0 };
    }

    let rows = [];
    let errors = [];
    let detectedHeaders = [];
    let csvMapping = mappingOverride;
    if (type === '835') {
      ({ rows, errors } = parse835(fileEntry.content));
    } else if (type === '277CA') {
      ({ rows, errors } = parse277(fileEntry.content));
    } else if (type === 'CSV') {
      const autoMapping = detectCsvMapping(parseCsvLine(fileEntry.content.split('\n')[0] || ''));
      csvMapping = csvMapping || autoMapping;
      const mappingReady =
        csvMapping?.claimId || csvMapping?.payerClaimNumber || csvMapping?.patientControlNumber || csvMapping?.trackingNumber;
      if (!mappingReady) {
        const headerRow = parseCsvLine(fileEntry.content.split('\n')[0] || '');
        setPendingMappings((prev) => ({
          ...prev,
          [fileEntry.id]: { headers: headerRow, runId },
        }));
        updateRun(runId, (run) => ({
          ...run,
          status: 'waiting_mapping',
          files: run.files.map((f) =>
            f.id === fileEntry.id ? { ...f, status: 'needs_mapping', type: 'CSV', headers: headerRow } : f
          ),
        }));
        return { denialsCreated: 0 };
      }
      const parsed = parseCsv(fileEntry.content, csvMapping);
      rows = parsed.rows;
      errors = parsed.errors;
      detectedHeaders = parsed.headers || [];
    }

    if (!rows.length) {
      updateRun(runId, (run) => ({
        ...run,
        files: run.files.map((f) =>
          f.id === fileEntry.id
            ? { ...f, status: 'error', errors: errors.length ? errors : [{ line: '-', message: 'Sin datos reconocibles' }] }
            : f
        ),
      }));
      setNeedsReview((prev) => [
        { id: fileEntry.id, name: fileEntry.name, reason: 'Sin datos reconocibles', receivedAt: fileEntry.receivedAt },
        ...prev,
      ]);
      return { denialsCreated: 0 };
    }

    const summary = {
      claims: rows.length,
      denials: 0,
      payments: 0,
      adjustments: 0,
      matched: 0,
      created: 0,
      needsReview: 0,
    };
    const createdDenials = [];
    const unmatchedItems = [];
    setClaims((prev) => {
      const updated = [...prev];
      rows.forEach((row, index) => {
        const identifiers = {
          payerClaimNumber: row.payerClaimNumber || row.claimId || '',
          patientControlNumber: row.patientControlNumber || '',
          trackingNumber: row.trackingNumber || '',
        };
        const existing = findClaimMatch(updated, identifiers);
        let target = existing;
        if (existing) {
          summary.matched += 1;
          target.payerClaimNumber = identifiers.payerClaimNumber || target.payerClaimNumber;
          target.patientControlNumber = identifiers.patientControlNumber || target.patientControlNumber;
          target.trackingNumber = identifiers.trackingNumber || target.trackingNumber;
        } else {
          summary.created += 1;
          summary.needsReview += 1;
          const preferredId =
            identifiers.patientControlNumber || identifiers.payerClaimNumber || identifiers.trackingNumber || row.claimId || '';
          const newClaim = createNewClaim(
            preferredId,
            row.amount ? Number(row.amount) : 1200,
            index,
            fileEntry.name
          );
          newClaim.patientControlNumber = identifiers.patientControlNumber;
          newClaim.trackingNumber = identifiers.trackingNumber;
          updated.push(newClaim);
          target = newClaim;
          unmatchedItems.push({
            id: newClaim.id,
            suggestion: identifiers.patientControlNumber ? 'Revisar patient control number' : 'Revisar identificadores de claim',
            reason: 'Claim no encontrado, creado como needs review',
          });
        }

        if (type === '835') {
          const denialAdjustments = row.adjustments.filter((adj) => adj.amount > 0);
          summary.adjustments += denialAdjustments.length;
          const isDenied = row.paid === 0 || denialAdjustments.some((adj) => ['CO', 'PR', 'PI', 'OA'].includes(adj.groupCode));
          if (isDenied && denialAdjustments.length) {
            const primary = denialAdjustments[0];
            target.code = `${primary.groupCode}-${primary.reasonCode}`;
            target.reason = `Ajuste ${primary.reasonCode} por $${primary.amount}`;
            target.status = 'pending';
            target.denied = date.toISOString().slice(0, 10);
            summary.denials += 1;
            createdDenials.push(target.id);
          }
          if (row.paid > 0) {
            summary.payments += 1;
          }
          if (row.charged) target.amount = row.charged;
          const nonPrAdjustment = denialAdjustments.find((adj) => adj.groupCode !== 'PR');
          if (row.charged && row.paid !== undefined && nonPrAdjustment) {
            const serviceDate = target.denied || date.toISOString();
            const override = findContractOverride(target.payer, target.cpt, serviceDate);
            const term = findContractTerm(target.payer, serviceDate);
            const expectedPercent = override?.expectedPercent ?? term?.expectedPercent;
            const expectedAmount = expectedPercent ? (row.charged * expectedPercent) / 100 : null;
            const varianceAmount = expectedAmount !== null ? expectedAmount - row.paid : row.charged - row.paid;
            const hasItem = underpaymentItems.some(
              (item) => item.claimId === target.id && item.correlationId === fileEntry.id
            );
            if (!hasItem && varianceAmount > 0) {
              const status = expectedPercent ? 'open' : 'needs_contract_rule';
              const recommended_next_step = expectedPercent
                ? 'Revisar contrato y reclamar diferencia'
                : 'Agregar regla Contract Lite';
              createUnderpaymentItem(
                {
                  claimId: target.id,
                  paymentId: `pay-${fileEntry.id}-${target.id}`,
                  payer: target.payer,
                  expectedAmount,
                  actualPaidAmount: row.paid,
                  varianceAmount,
                  casGroupCode: nonPrAdjustment.groupCode,
                  casReasonCode: nonPrAdjustment.reasonCode,
                  status,
                  recommendedNextStep: recommended_next_step,
                  correlationId: fileEntry.id,
                },
                fileEntry.id
              );
            }
          }
        }

        if (type === '277CA') {
          const denialStatus = row.status || '';
          const isDenied =
            denialStatus.startsWith('A1') ||
            denialStatus.startsWith('A7') ||
            denialStatus.startsWith('R') ||
            denialStatus.startsWith('E');
          if (isDenied) {
            target.code = `277-${denialStatus.split(':')[0]}`;
            target.reason = `Estatus STC ${denialStatus}`;
            target.status = 'pending';
            target.denied = date.toISOString().slice(0, 10);
            summary.denials += 1;
            createdDenials.push(target.id);
          } else {
            target.status = target.status || 'pending';
          }
        }

        if (type === 'CSV') {
          if (row.denialCode) {
            target.code = row.denialCode;
            target.reason = row.denialReason || 'Denial desde CSV';
            target.status = 'pending';
            target.denied = date.toISOString().slice(0, 10);
            summary.denials += 1;
            createdDenials.push(target.id);
          }
          if (row.amount) target.amount = Number(row.amount);
        }
      });
      return updated.map((c) => ({ ...c, ...score(c, date, rules) }));
    });

    if (unmatchedItems.length) {
      setUnmatched((prev) => [...unmatchedItems, ...prev]);
    }

    const newTriage = {};
    createdDenials.forEach((denialId) => {
      const claim = claims.find((c) => c.id === denialId) || initClaims.find((c) => c.id === denialId);
      if (!claim) return;
      newTriage[denialId] = runTriage(claim, claim);
    });
    if (Object.keys(newTriage).length) {
      setTriageResults((prev) => ({ ...prev, ...newTriage }));
    }

    updateRun(runId, (run) => ({
      ...run,
      files: run.files.map((f) =>
        f.id === fileEntry.id
          ? {
              ...f,
              type,
              status: errors.length ? 'ok_with_errors' : 'ok',
              errors,
              counts: summary,
              headers: detectedHeaders,
              mapping: csvMapping || f.mapping,
            }
          : f
      ),
    }));
    if (errors.length) {
      setNeedsReview((prev) => [
        {
          id: fileEntry.id,
          name: fileEntry.name,
          reason: `${errors.length} errores de parseo`,
          receivedAt: fileEntry.receivedAt,
        },
        ...prev,
      ]);
    }

    logAudit({
      action: 'Archivo procesado',
      claimId: 'INGEST',
      detail: `${fileEntry.name} → ${type}`,
      source: 'system',
    });

    return { denialsCreated: createdDenials.length };
  };

  const processIngestionRun = async (runId, files) => {
    let totalDenials = 0;
    for (let i = 0; i < files.length; i += 1) {
      const result = await processFileEntry(runId, files[i], i);
      totalDenials += result.denialsCreated;
    }
    updateRun(runId, (run) => ({
      ...run,
      status: run.files.some((file) => file.status === 'needs_mapping')
        ? 'waiting_mapping'
        : run.files.some((file) => file.status === 'error')
          ? 'error'
          : 'completed',
    }));
    if (awaitingInboxRedirect && totalDenials > 0) {
      setView('denials');
      setAwaitingInboxRedirect(false);
    }
  };

  const applyCsvMapping = (fileId, mapping) => {
    const run = ingestionRuns.find((entry) => entry.files.some((file) => file.id === fileId));
    if (!run) return;
    const fileIndex = run.files.findIndex((file) => file.id === fileId);
    const fileEntry = run.files[fileIndex];
    setPendingMappings((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    setMappingDrafts((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    updateRun(run.id, (prevRun) => ({
      ...prevRun,
      status: 'queued',
      files: prevRun.files.map((file) =>
        file.id === fileId ? { ...file, mapping, status: 'queued', errors: [] } : file
      ),
    }));
    setTimeout(() => {
      processFileEntry(run.id, fileEntry, fileIndex, mapping);
    }, 300);
  };

  const reprocessFile = (runId, fileId) => {
    const run = ingestionRuns.find((entry) => entry.id === runId);
    if (!run) return;
    const fileIndex = run.files.findIndex((file) => file.id === fileId);
    const fileEntry = run.files[fileIndex];
    if (!fileEntry) return;
    updateRun(runId, (prevRun) => ({
      ...prevRun,
      status: 'queued',
      files: prevRun.files.map((file) =>
        file.id === fileId ? { ...file, status: 'queued', errors: [] } : file
      ),
    }));
    setTimeout(() => {
      processFileEntry(runId, fileEntry, fileIndex, fileEntry.mapping || null);
    }, 300);
  };

  const handleUploadFiles = async (fileList) => {
    const expanded = await expandFiles(fileList);
    if (!expanded.length) return;
    const runId = `ing-${Date.now()}`;
    const now = new Date().toISOString();
    const fileRecords = expanded.map((file) => ({
      id: file.id,
      name: file.name,
      sourceName: file.sourceName,
      type: detectEdiType(file.name, file.content),
      receivedAt: now,
      status: 'queued',
      counts: {
        claims: 0,
        denials: 0,
        payments: 0,
        adjustments: 0,
        matched: 0,
        created: 0,
        needsReview: 0,
      },
      errors: [],
      warnings: [],
      content: file.content,
      zipError: file.zipError,
    }));
    const newRun = {
      id: runId,
      createdAt: now,
      status: 'queued',
      files: fileRecords,
    };
    setIngestionRuns((prev) => [newRun, ...prev]);
    setActiveRunId(runId);
    logAudit({
      action: 'Ingestión creada',
      claimId: 'INGEST',
      detail: `Run ${runId} (${fileRecords.length} archivos)`,
      source: 'system',
    });
    setTimeout(() => {
      processIngestionRun(runId, fileRecords);
    }, 400);
  };

  const downloadSample = (type) => {
    const content =
      type === '835'
        ? 'CLP*PCN-2001*1*1250*0*1250*12*PAT-2001*11~TRN*1*TRK-2001~CAS*CO*16*1250~'
        : type === '277ca'
          ? 'TRN*1*TRK-3001*123456789~REF*1K*PAT-3001~STC*A1:19*20240101*U*CO:16~'
          : 'claim_id,denial_code,denial_reason,amount\nPCN-4001,CO-16,Falta info,500';
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = type === 'csv' ? `sample-${type}.csv` : `sample-${type}.txt`;
    link.click();
  };

  const resolveUnmatched = (itemId) => {
    setUnmatched((prev) => prev.filter((u) => u.id !== itemId));
    logAudit({
      action: 'Usuario resolvió unmatched',
      claimId: itemId,
      detail: 'Asociado manualmente',
      source: 'user',
    });
  };

  const addIntegration = (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const next = {
      id: `int-${Date.now()}`,
      name: form.get('name'),
      host: form.get('host'),
      user: form.get('user'),
      path: form.get('path'),
      schedule: 'Pendiente',
      timezone: 'Pendiente',
      lastPull: 'Pendiente',
      lastFile: '-',
      errors: 0,
    };
    setIntegrations((prev) => [next, ...prev]);
    logAudit({
      action: 'Usuario configuró integración',
      claimId: 'INTEGRATION',
      detail: next.name,
      source: 'user',
    });
    e.target.reset();
  };

  const updateStatus = (id, status) => {
    const claim = claims.find((c) => c.id === id);
    if (!claim) return;
    const before = { status: claim.status, prio: claim.prio, prob: claim.prob, action: claim.action };
    const updated = { ...claim, status, ...score({ ...claim, status }, date, rules) };
    setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
    if (sel?.id === id) setSel(updated);
    setStats((prev) => ({ proc: prev.proc + 1, app: status === 'appealed' ? prev.app + 1 : prev.app }));
    logAudit({
      action: `Usuario cambió estado a ${status}`,
      claimId: id,
      detail: `Prio:${updated.prio}`,
      source: 'user',
      before,
      after: { status: updated.status, prio: updated.prio, prob: updated.prob, action: updated.action },
      scoring: updated,
    });
  };

  const applyAppeal = (claim, appealEntry, source = 'user') => {
    const before = { status: claim.status, appeals: claim.appeals.length, prio: claim.prio, prob: claim.prob };
    const nextClaim = {
      ...claim,
      status: 'appealed',
      appeals: [appealEntry, ...claim.appeals],
    };
    const rescored = { ...nextClaim, ...score(nextClaim, date, rules) };
    setClaims((prev) => prev.map((c) => (c.id === claim.id ? rescored : c)));
    setSel(rescored);
    setStats((prev) => ({ proc: prev.proc + 1, app: prev.app + 1 }));
    logAudit({
      action: source === 'system' ? 'Sistema generó apelación demo' : 'Usuario generó apelación demo',
      claimId: claim.id,
      detail: appealEntry.id,
      source,
      before,
      after: { status: rescored.status, appeals: rescored.appeals.length, prio: rescored.prio, prob: rescored.prob },
      scoring: rescored,
    });
  };

  const generateAppeal = async (claim) => {
    const apiUrl = import.meta.env.VITE_APPEAL_API_URL;
    const publicToken = import.meta.env.VITE_APPEAL_PUBLIC_TOKEN;
    const startedAt = performance.now();
    const patientName = demoMode ? maskName(claim.patient) : claim.patient;
    const appealPayload = {
      claimId: claim.id,
      payer: claim.payer,
      patient: patientName,
      provider: claim.provider,
      cpt: claim.cpt,
      dx: claim.dx,
      amount: claim.amount,
      denial: { code: claim.code, reason: claim.reason },
      action: claim.action,
      probability: claim.prob,
    };
    const payloadHash = hashPayload(appealPayload);
    if (!apiUrl || !publicToken) {
      const fallbackText = `APELACIÓN ${claim.id}
Para: ${claim.payer}
Paciente: ${patientName}
Proveedor: ${claim.provider}
CPT: ${claim.cpt} | Dx: ${claim.dx}
Monto: $${claim.amount}
Denial: ${claim.code} - ${claim.reason}
Acción: ${claim.action}
Prob: ${claim.prob}%

[Modo demo: agrega un token público para generar texto real.]`;
      logAudit({
        action: 'Sistema generó borrador de apelación (demo)',
        claimId: claim.id,
        detail: 'Fallback local (sin proxy)',
        source: 'system',
        aiDecision: true,
        modelVersion: APPEAL_MODEL_VERSION,
        requestId: 'local-fallback',
        latencyMs: Math.round(performance.now() - startedAt),
        result: 'fallback',
        payloadHash,
      });
      return { text: fallbackText, meta: { ok: false, modelVersion: APPEAL_MODEL_VERSION, requestId: 'local-fallback' } };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicToken}`,
      },
      body: JSON.stringify(appealPayload),
    });

    if (!response.ok) {
      const fallbackText = `APELACIÓN ${claim.id}
Para: ${claim.payer}
Paciente: ${patientName}

[Fallback: servicio no disponible (${response.status}).]`;
      logAudit({
        action: 'Sistema intentó generar apelación',
        claimId: claim.id,
        detail: `Error ${response.status} (token público)`,
        source: 'system',
        aiDecision: true,
        modelVersion: APPEAL_MODEL_VERSION,
        requestId: `error-${response.status}`,
        latencyMs: Math.round(performance.now() - startedAt),
        result: 'error',
        payloadHash,
      });
      return { text: fallbackText, meta: { ok: false, modelVersion: APPEAL_MODEL_VERSION, requestId: `error-${response.status}` } };
    }

    const data = await response.json();
    const modelVersion = data.modelVersion || data.model || APPEAL_MODEL_VERSION;
    const requestId = data.requestId || data.id || `req-${Date.now()}`;
    logAudit({
      action: 'Sistema generó borrador de apelación',
      claimId: claim.id,
      detail: 'Generación OK (token público)',
      source: 'system',
      aiDecision: true,
      modelVersion,
      requestId,
      latencyMs: Math.round(performance.now() - startedAt),
      result: 'ok',
      payloadHash,
    });
    return { text: data.text || data.appeal || data.message || 'Respuesta vacía del modelo.', meta: { ok: true, modelVersion, requestId } };
  };

  const openAppealModal = async (claim) => {
    const appealResult = await generateAppeal(claim);
    setAppeal(appealResult.text);
    setModal(true);
  };

  const exportCsv = (rows, name) => {
    const headers = Object.keys(rows[0] || {});
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${r[h] ?? ''}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv]));
    link.download = name;
    link.click();
  };

  const advanceDay = () => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    setDate(next);
    logAudit({
      action: 'Sistema avanzó el día',
      claimId: 'SYS',
      detail: next.toLocaleDateString(),
      source: 'system',
      before: { simDate: date.toLocaleDateString() },
      after: { simDate: next.toLocaleDateString() },
    });
    logAudit({
      action: 'Sistema recalculó scoring',
      claimId: 'ALL',
      detail: 'Re-score diario',
      source: 'system',
    });
  };

  const buildPlanTasksForClaim = (claim) => {
    const tasksToCreate = [];
    const reason = (claim.reason || '').toLowerCase();
    if (claim.amount > 5000 || claim.code?.startsWith('CO') || claim.code?.startsWith('PR')) {
      tasksToCreate.push({
        taskType: 'appeal_draft',
        title: `Borrador de apelación para ${claim.id}`,
      });
    }
    if (reason.includes('document') || reason.includes('info') || reason.includes('labor')) {
      tasksToCreate.push({
        taskType: 'request_docs',
        title: `Solicitar documentación para ${claim.id}`,
      });
    }
    if (reason.includes('coding') || reason.includes('dx') || reason.includes('cpt')) {
      tasksToCreate.push({
        taskType: 'fix_coding',
        title: `Revisar codificación para ${claim.id}`,
      });
    }
    if (claim.payer) {
      tasksToCreate.push({
        taskType: 'call_payer',
        title: `Llamar al pagador ${claim.payer} por ${claim.id}`,
        nextFollowUpAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      });
    }
    if (!tasksToCreate.length) {
      tasksToCreate.push({
        taskType: 'submit_corrected_claim',
        title: `Enviar claim corregido ${claim.id}`,
      });
    }
    return tasksToCreate.slice(0, 3);
  };

  const createDailyPlan = () => {
    const maxTasks = Math.min(12, Math.max(5, Math.floor(claims.length / 2)));
    const prioritized = [...claims].sort((a, b) => b.prio - a.prio).slice(0, maxTasks);
    const newTasks = [];
    prioritized.forEach((claim) => {
      buildPlanTasksForClaim(claim).forEach((entry) => {
        if (newTasks.length >= maxTasks) return;
        newTasks.push(
          createTask({
            denialId: claim.id,
            claimId: claim.id,
            title: entry.title,
            taskType: entry.taskType,
            source: 'system',
            payer: claim.payer,
            nextFollowUpAt: entry.nextFollowUpAt || null,
            notes: `Plan diario para ${claim.id}.`,
          })
        );
      });
    });
    if (!newTasks.length) return;
    setTasks((prev) => [...newTasks, ...prev]);
    logAudit({
      action: 'Sistema creó plan operativo de hoy',
      claimId: 'OPS',
      detail: `${newTasks.length} tareas generadas`,
      source: 'system',
    });
    newTasks.forEach((task) => {
      logAudit({
        action: 'Sistema creó tarea del plan diario',
        claimId: task.claimId,
        detail: `${TASK_LABELS[task.taskType] || task.taskType} • ${OWNER_ROLE_LABELS[task.ownerRole]}`,
        source: 'system',
      });
    });
    return newTasks;
  };

  const updateTask = (taskId, updater) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? updater(task) : task)));
  };

  const reassignTask = (taskId, role) => {
    const currentTasks = tasks.filter((task) => task.id !== taskId);
    const ownerName = assignTaskToRole(role, currentTasks);
    updateTask(taskId, (task) => ({
      ...task,
      ownerRole: role,
      ownerName,
    }));
    logAudit({
      action: 'Usuario reasignó tarea',
      claimId: tasks.find((t) => t.id === taskId)?.claimId || 'TASK',
      detail: `Rol ${OWNER_ROLE_LABELS[role]} → ${ownerName}`,
      source: 'user',
    });
  };

  const completeTask = (taskId, source = 'user') => {
    updateTask(taskId, (task) => ({
      ...task,
      status: 'done',
      completedAt: new Date().toISOString(),
    }));
    logAudit({
      action: source === 'system' ? 'Sistema marcó tarea como hecha' : 'Usuario marcó tarea como hecha',
      claimId: tasks.find((t) => t.id === taskId)?.claimId || 'TASK',
      detail: 'Tarea completada',
      source: source === 'system' ? 'system' : 'user',
    });
  };

  const escalateTask = (taskId) => {
    updateTask(taskId, (task) => ({
      ...task,
      status: 'blocked',
      ownerRole: 'supervisor',
      ownerName: OWNER_POOL.supervisor[0],
    }));
    logAudit({
      action: 'Usuario escaló tarea a supervisor',
      claimId: tasks.find((t) => t.id === taskId)?.claimId || 'TASK',
      detail: 'Bloqueado por escalación',
      source: 'user',
    });
  };

  const createTaskForDenial = (claim, taskType, source = 'user') => {
    const task = createTask({
      denialId: claim.id,
      claimId: claim.id,
      title: `${TASK_LABELS[taskType]} para ${claim.id}`,
      taskType,
      source,
      payer: claim.payer,
      notes: source === 'ai' ? 'Sugerencia automática del sistema.' : 'Creado manualmente.',
    });
    setTasks((prev) => [task, ...prev]);
    logAudit({
      action: source === 'ai' ? 'Sistema creó tarea sugerida' : 'Usuario creó tarea',
      claimId: claim.id,
      detail: TASK_LABELS[taskType],
      source: source === 'ai' ? 'system' : 'user',
      aiDecision: source === 'ai',
      requestId: source === 'ai' ? `auto-${task.id}` : null,
      latencyMs: source === 'ai' ? Math.round(Math.random() * 120 + 80) : null,
      result: 'ok',
    });
  };

  const applySuggestedTasks = (claim) => {
    const action = (claim.action || '').toLowerCase();
    const suggested = [];
    if (action.includes('document')) {
      suggested.push('request_docs');
    }
    if (action.includes('cpt') || action.includes('coding') || action.includes('dx')) {
      suggested.push('fix_coding');
    }
    if (action.includes('paciente') || action.includes('patient')) {
      suggested.push('patient_resp_followup');
    }
    if (!suggested.length) {
      suggested.push('appeal_draft');
    }
    const unique = [...new Set(suggested)].slice(0, 3);
    unique.forEach((taskType) => createTaskForDenial(claim, taskType, 'ai'));
  };

  const createUnderpaymentItem = (payload, correlationId) => {
    const item = {
      id: `up-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      detectedAt: new Date().toISOString(),
      status: payload.status || 'open',
      ...payload,
    };
    setUnderpaymentItems((prev) => [item, ...prev]);
    logAudit({
      action: 'Sistema detectó underpayment',
      claimId: payload.claimId,
      detail: `${payload.payer} • $${Math.round(payload.varianceAmount || 0)}`,
      source: 'system',
      requestId: correlationId ? `835-${correlationId}` : null,
      result: 'ok',
    });
  };


  const filtered = claims
    .filter(
      (c) =>
        ((c.patient.toLowerCase().includes(search.toLowerCase()) ||
          c.id.toLowerCase().includes(search.toLowerCase())) &&
          (filter === 'all' || c.status === filter))
    )
    .sort((a, b) => b.prio - a.prio);

  const displayName = (claim) => (demoMode ? maskName(claim.patient) : claim.patient);

  const underpaymentScored = useMemo(
    () =>
      underpaymentItems.map((item) => ({
        ...item,
        ...scoreUnderpayment(item, rules.payerRules),
      })),
    [underpaymentItems, rules]
  );

  const queueItems = useMemo(() => {
    const denialItems = claims.map((claim) => ({
      type: 'denial',
      id: `denial-${claim.id}`,
      claim,
      prio: claim.prio,
      prob: claim.prob,
    }));
    const underItems = underpaymentScored.map((item) => ({
      type: 'underpayment',
      id: `under-${item.id}`,
      underpayment: item,
      claim: claims.find((c) => c.id === item.claimId),
      prio: item.prio,
      prob: item.prob,
    }));
    return [...denialItems, ...underItems].sort((a, b) => b.prio - a.prio);
  }, [claims, underpaymentScored]);

  const filteredQueue = queueItems.filter((item) => {
    if (underpaymentFilter !== 'all' && item.type !== underpaymentFilter) return false;
    if (item.type === 'denial' && filter !== 'all' && item.claim.status !== filter) return false;
    const targetId = item.type === 'denial' ? item.claim.id : item.underpayment.claimId;
    const patientName = item.claim?.patient || '';
    const match =
      targetId.toLowerCase().includes(search.toLowerCase()) ||
      patientName.toLowerCase().includes(search.toLowerCase());
    return match;
  });

  const resetStorage = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem('dz_tour_seen');
      window.location.reload();
    }
  };

  const tourSteps = [
    {
      id: 'nav-denials',
      title: '1. Denials Inbox',
      body: 'Aquí aparece la cola priorizada con probabilidad y monto.',
    },
    {
      id: 'denial-detail',
      title: '2. Detalle del denial',
      body: 'Abre un denial para ver motivo, monto y pagador.',
    },
    {
      id: 'tour-status',
      title: '3. Acción sugerida + estado',
      body: 'Aplica una acción y marca el denial en proceso.',
    },
    {
      id: 'tour-appeal',
      title: '4. Generar apelación demo',
      body: 'Crea un borrador y guarda la trazabilidad.',
    },
    {
      id: 'nav-audit',
      title: '5. Audit log',
      body: 'Todo queda registrado con usuario, hora y detalle.',
    },
  ];

  const currentTour = tourSteps[tourStep];
  const tourTarget = currentTour ? document.getElementById(currentTour.id) : null;
  const tourRect = tourTarget?.getBoundingClientRect();

  const runQuickTour = () => {
    const top = [...claims].sort((a, b) => b.prio - a.prio)[0];
    if (!top) return;
    setView('denials');
    setSel(top);
    logAudit({
      action: 'Recorrido rápido iniciado',
      claimId: top.id,
      detail: 'Seleccionamos el denial más prioritario',
      source: 'system',
    });
    const planned = createDailyPlan() || [];
    updateStatus(top.id, 'in_progress');
    logAudit({
      action: 'Sistema cambió estado a En proceso',
      claimId: top.id,
      detail: 'Se inicia trabajo de recuperación',
      source: 'system',
    });
    const appealEntry = {
      id: `APL-${Date.now().toString().slice(-4)}`,
      createdAt: new Date().toISOString(),
      status: 'submitted',
      summary: 'Apelación demo generada',
    };
    applyAppeal(top, appealEntry, 'system');
    logAudit({
      action: 'Sistema sugirió acción prioritaria',
      claimId: top.id,
      detail: 'Reunir documentos y reenviar al pagador',
      source: 'system',
    });
    if (planned.length) {
      completeTask(planned[0].id, 'system');
      logAudit({
        action: 'Sistema cerró una tarea del plan',
        claimId: planned[0].claimId,
        detail: TASK_LABELS[planned[0].taskType] || planned[0].taskType,
        source: 'system',
      });
    }
    logAudit({
      action: 'Recorrido rápido completado',
      claimId: top.id,
      detail: 'Estado, apelación y auditoría listos',
      source: 'system',
    });
    setView('audit');
  };

  const priorityClass = (prio) =>
    prio >= 70 ? 'text-red-600 bg-red-50' : prio >= 40 ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50';

  const statusBadge = (status) => {
    const map = {
      pending: ['bg-orange-100 text-orange-700', 'Pend'],
      in_progress: ['bg-blue-100 text-blue-700', 'Proc'],
      appealed: ['bg-purple-100 text-purple-700', 'Apel'],
    };
    const [cls, label] = map[status] || map.pending;
    return <span className={`px-1 py-0.5 rounded text-xs ${cls}`}>{label}</span>;
  };

  const activeRun = ingestionRuns.find((run) => run.id === activeRunId) || ingestionRuns[0];
  const selectedUnderpayment = underpaymentScored.find((item) => item.id === selectedUnderpaymentId);

  return (
    <div className="h-screen flex bg-slate-100 overflow-hidden text-xs">
      <div className={`${side ? 'w-36' : 'w-10'} bg-slate-900 text-white flex flex-col`}>
        <div className="p-2 flex items-center justify-between border-b border-slate-700">
          {side && (
            <span className="font-bold flex items-center gap-1">
              <Zap className="w-3 h-3 text-emerald-400" />
              Denials Zero
            </span>
          )}
          <button onClick={() => setSide(!side)} className="p-1 hover:bg-slate-800 rounded">
            <Menu className="w-3 h-3" />
          </button>
        </div>
        <nav className="flex-1 p-1 space-y-1">
          {[
            ['dashboard', BarChart3, 'Dashboard'],
            ['tutorial', FileText, 'Cómo llegan los denials'],
            ['how', FileText, 'Cómo funciona'],
            ['ops', BarChart3, 'Ops Dashboard'],
            ['ops_queue', Users, 'Ops Queue'],
            ['playbooks', FileText, 'Playbooks'],
            ['prevention', AlertCircle, 'Prevención'],
            ['program', BarChart3, 'Programa'],
            ['contract', FileText, 'Contract Lite'],
            ['insights', BarChart3, 'Insights'],
            ['intake', Upload, 'Data Intake'],
            ['ingestions', History, 'Historial de ingestión'],
            ['denials', AlertCircle, 'Denials Inbox'],
            ['unmatched', Users, 'Unmatched'],
            ['integrations', Users, 'SFTP (visual)'],
            ['payments', DollarSign, 'Pagos'],
            ['audit', History, 'Auditoría'],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              id={`nav-${id}`}
              onClick={() => {
                setView(id);
                setSel(null);
                setSelectedUnderpaymentId(null);
              }}
              className={`w-full flex items-center gap-1 px-2 py-1 rounded ${
                view === id ? 'bg-emerald-600' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3 h-3" />
              {side && label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-slate-700 flex items-center gap-1">
          <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center font-bold">A</div>
          {side && 'Ana R.'}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-8 bg-white border-b flex items-center justify-between px-2">
          <span className="font-semibold">
            {view === 'dashboard'
              ? 'Dashboard'
              : view === 'tutorial'
                ? 'Cómo llegan los denials'
                : view === 'how'
                  ? 'Cómo funciona'
                : view === 'ops'
                  ? 'Ops Dashboard'
                  : view === 'ops_queue'
                    ? 'Ops Queue'
                    : view === 'playbooks'
                      ? 'Playbooks'
                      : view === 'prevention'
                        ? 'Prevención'
                        : view === 'program'
                          ? 'Programa'
                          : view === 'contract'
                            ? 'Contract Lite'
                            : view === 'insights'
                              ? 'Insights'
                  : view === 'intake'
                    ? 'Data Intake'
                    : view === 'ingestions'
                      ? 'Historial de ingestión'
                      : view === 'integrations'
                        ? 'SFTP (visual)'
                        : view === 'denials'
                          ? 'Denials Inbox'
                          : view === 'unmatched'
                            ? 'Unmatched'
                            : view === 'payments'
                              ? 'Pagos'
                              : view === 'audit'
                                ? 'Auditoría'
                                : 'Detalle'}
          </span>
          <div className="flex items-center gap-2">
            <span className="bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {date.toLocaleDateString()}
              <button onClick={advanceDay} className="hover:bg-slate-200 rounded p-0.5">
                <RefreshCw className="w-3 h-3" />
              </button>
            </span>
            <button
              id="quick-tour-btn"
              onClick={runQuickTour}
              className="px-2 py-0.5 rounded border bg-white hover:bg-slate-50 text-slate-600"
            >
              Recorrido rápido
            </button>
            <button
              onClick={() => {
                setTourStep(0);
                setShowTour(true);
              }}
              className="px-2 py-0.5 rounded border bg-white hover:bg-slate-50 text-slate-600"
            >
              Tour
            </button>
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <span>Demo PHI (solo visual)</span>
              <button
                onClick={() => setDemoMode((prev) => !prev)}
                className={`px-1 rounded border ${demoMode ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-500'}`}
              >
                {demoMode ? 'ON' : 'OFF'}
              </button>
              <button onClick={resetStorage} className="px-1 rounded border hover:bg-slate-100">
                Reset
              </button>
            </div>
            <Bell className="w-3 h-3 text-slate-400" />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-2">
          {view === 'tutorial' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Cómo llegan los denials</h2>
                <p className="text-slate-600 mt-1">
                  Tres pasos simples para explicar a un cliente cómo se alimenta la cola sin magia.
                </p>
              </div>
              <div className="bg-white rounded p-3 border">
                <p className="text-emerald-600 text-xs">Paso {tutorialStepIndex + 1} de 3</p>
                <h3 className="font-semibold mt-1">{tutorialSteps[tutorialStepIndex].title}</h3>
                <p className="text-slate-600 mt-1">{tutorialSteps[tutorialStepIndex].body}</p>
                {tutorialStepIndex === 1 ? (
                  <div className="mt-2 p-2 bg-slate-50 rounded border text-xs text-slate-600">
                    <p className="font-semibold text-slate-700">Mini ejemplo</p>
                    <p>1) Subes 277CA (rechazos/estatus) → 2) Subes 835 (ajustes y pagos).</p>
                  </div>
                ) : null}
                <div className="mt-3 flex justify-between">
                  <button
                    onClick={() => setTutorialStepIndex((prev) => Math.max(0, prev - 1))}
                    className="px-3 py-1 border rounded hover:bg-slate-50"
                    disabled={tutorialStepIndex === 0}
                  >
                    Anterior
                  </button>
                  {tutorialStepIndex < tutorialSteps.length - 1 ? (
                    <button
                      onClick={() => setTutorialStepIndex((prev) => Math.min(tutorialSteps.length - 1, prev + 1))}
                      className="px-3 py-1 bg-emerald-600 text-white rounded"
                    >
                      Siguiente
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setAwaitingInboxRedirect(true);
                        setTutorialStepIndex(0);
                        setView('intake');
                      }}
                      className="px-3 py-1 bg-emerald-600 text-white rounded"
                    >
                      Ir a subir archivos
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'how' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Cómo funciona en el mundo real</h2>
                <p className="text-slate-600 mt-1">
                  Explicación simple de cómo llegan los denials y qué hace el cliente para activar el flujo.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    title: '¿De dónde salen los denials?',
                    body: 'Del 277CA (estatus/rechazos) y del 835 (ajustes CAS no pagados).',
                  },
                  {
                    title: '¿Qué hace el cliente para que lleguen aquí?',
                    body: 'Conecta el flujo de archivos: primero en piloto sube manualmente, luego en producción usa SFTP seguro.',
                  },
                  {
                    title: '¿Qué sube si está en piloto?',
                    body: 'Archivos 277CA y 835 (y CSV si desea validar antes). El orden recomendado es 277CA → 835.',
                  },
                  {
                    title: '¿Qué cambia al pasar a producción?',
                    body: 'Configuramos SFTP/carpeta segura. El sistema procesa automáticamente igual que la carga manual.',
                  },
                  {
                    title: '¿Qué pasa cuando hay mismatch?',
                    body: 'Match MVP: usamos patient control number como ID principal. Si no hay match, se crea como needs review.',
                  },
                  {
                    title: '¿Dónde veo el resultado?',
                    body: 'Cada archivo deja su resultado y los denials aparecen en Denials Inbox con prioridad.',
                  },
                ].map((card) => (
                  <div key={card.title} className="bg-white rounded p-2 border">
                    <p className="font-semibold">{card.title}</p>
                    <p className="text-slate-600 mt-1">{card.body}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded p-2 border text-xs text-slate-600">
                <p>
                  <span className="font-semibold">Resumen:</span> No enviamos 837. Consumimos 277CA y 835 de forma confiable para
                  poblar la Denials Inbox.
                </p>
              </div>
            </div>
          )}

          {view === 'ops' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Ops Dashboard</h2>
                  <p className="text-slate-600 mt-1">Vista operacional para AR Recovery y Denials Ops.</p>
                </div>
                <button onClick={createDailyPlan} className="px-3 py-1 bg-emerald-600 text-white rounded">
                  Crear plan de hoy
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  ['Backlog denials', opsMetrics.backlog],
                  ['Tareas abiertas', opsMetrics.openTasks],
                  ['Tareas vencidas', opsMetrics.overdueTasks],
                  ['Completadas hoy', opsMetrics.completedToday],
                  ['Monto en riesgo', `$${Math.round(opsMetrics.riskAmount).toLocaleString()}`],
                  ['Monto recuperable', `$${Math.round(opsMetrics.recoverable).toLocaleString()}`],
                  ['Tiempo promedio (h)', opsMetrics.avgCompletionHours],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded p-2 border">
                    <p className="text-slate-500">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Productividad por rol</p>
                <table className="w-full mt-2 text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1">Rol</th>
                      <th>Abiertas</th>
                      <th>Completadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opsMetrics.byRole.map((row) => (
                      <tr key={row.role} className="border-t">
                        <td className="py-1">{OWNER_ROLE_LABELS[row.role]}</td>
                        <td>{row.open}</td>
                        <td>{row.done}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'ops_queue' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Ops Queue</h2>
                  <p className="text-slate-600 mt-1">Tareas asignadas y no asignadas por rol.</p>
                </div>
                <button onClick={createDailyPlan} className="px-3 py-1 bg-emerald-600 text-white rounded">
                  Crear plan de hoy
                </button>
              </div>
              <div className="bg-white rounded p-2 border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">Filtrar por rol</span>
                  <select
                    value={opsRoleFilter}
                    onChange={(e) => setOpsRoleFilter(e.target.value)}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    <option value="all">Todos</option>
                    {OWNER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {OWNER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="text-xs text-slate-400">{tasks.length} tareas</span>
              </div>
              <div className="space-y-2">
                {tasks
                  .filter((task) => (opsRoleFilter === 'all' ? true : task.ownerRole === opsRoleFilter))
                  .map((task) => {
                    const overdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
                    return (
                      <div key={task.id} className="bg-white rounded p-2 border">
                        <div className="flex justify-between">
                          <div>
                            <p className="font-medium">
                              {task.title} {overdue ? <span className="text-red-600 text-xs">Atrasado</span> : null}
                            </p>
                            <p className="text-slate-500 text-xs">
                              {TASK_LABELS[task.taskType]} • {OWNER_ROLE_LABELS[task.ownerRole]} • {task.ownerName}
                            </p>
                            <p className="text-slate-400 text-xs">
                              Estado: {task.status} • SLA: {task.dueDate ? task.dueDate.slice(0, 10) : 'n/a'}
                            </p>
                          </div>
                          <div className="flex gap-2 items-start">
                            <select
                              value={task.ownerRole}
                              onChange={(e) => reassignTask(task.id, e.target.value)}
                              className="border rounded px-1 text-xs"
                            >
                              {OWNER_ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {OWNER_ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => completeTask(task.id)}
                              className="px-2 py-1 bg-emerald-600 text-white rounded text-xs"
                            >
                              Marcar done
                            </button>
                            <button
                              onClick={() => escalateTask(task.id)}
                              className="px-2 py-1 border rounded text-xs"
                            >
                              Escalar
                            </button>
                          </div>
                        </div>
                        {task.notes ? <p className="text-slate-500 text-xs mt-1">{task.notes}</p> : null}
                      </div>
                    );
                  })}
                {!tasks.length ? <p className="text-slate-400">Sin tareas creadas.</p> : null}
              </div>
            </div>
          )}

          {view === 'playbooks' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Playbooks operativos y clínicos</h2>
                <p className="text-slate-600 mt-1">Plantillas por categoría de denial con pasos y checklist.</p>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">{editingPlaybookId ? 'Editar playbook' : 'Nuevo playbook'}</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    value={playbookDraft.name}
                    onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Nombre"
                    className="border rounded p-1"
                  />
                  <select
                    value={playbookDraft.category}
                    onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, category: e.target.value }))}
                    className="border rounded p-1"
                  >
                    {PLAYBOOK_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <input
                    value={playbookDraft.conditions.payer}
                    onChange={(e) =>
                      setPlaybookDraft((prev) => ({ ...prev, conditions: { ...prev.conditions, payer: e.target.value } }))
                    }
                    placeholder="Condición pagador"
                    className="border rounded p-1"
                  />
                  <input
                    value={playbookDraft.conditions.reasonCode}
                    onChange={(e) =>
                      setPlaybookDraft((prev) => ({ ...prev, conditions: { ...prev.conditions, reasonCode: e.target.value } }))
                    }
                    placeholder="Reason code"
                    className="border rounded p-1"
                  />
                  <input
                    value={playbookDraft.conditions.minAmount}
                    onChange={(e) =>
                      setPlaybookDraft((prev) => ({ ...prev, conditions: { ...prev.conditions, minAmount: e.target.value } }))
                    }
                    placeholder="Monto mínimo"
                    className="border rounded p-1"
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={playbookDraft.clinicalReviewRequired}
                      onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, clinicalReviewRequired: e.target.checked }))}
                    />
                    Requiere revisión clínica
                  </label>
                  <textarea
                    value={playbookDraft.appealAngle}
                    onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, appealAngle: e.target.value }))}
                    placeholder="Ángulo de apelación"
                    className="border rounded p-1 col-span-2"
                  />
                  <textarea
                    value={playbookDraft.steps.join('\n')}
                    onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, steps: e.target.value.split('\n') }))}
                    placeholder="Pasos recomendados (1 por línea)"
                    className="border rounded p-1 col-span-2"
                  />
                  <textarea
                    value={playbookDraft.documents.join('\n')}
                    onChange={(e) => setPlaybookDraft((prev) => ({ ...prev, documents: e.target.value.split('\n') }))}
                    placeholder="Documentos requeridos (1 por línea)"
                    className="border rounded p-1 col-span-2"
                  />
                  <div className="col-span-2 text-xs text-slate-600">
                    <p className="font-semibold">Campos de calidad</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {QUALITY_GAP_FLAGS.map((flag) => (
                        <label key={flag} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={playbookDraft.qualityFields.includes(flag)}
                            onChange={(e) => {
                              setPlaybookDraft((prev) => ({
                                ...prev,
                                qualityFields: e.target.checked
                                  ? [...prev.qualityFields, flag]
                                  : prev.qualityFields.filter((item) => item !== flag),
                              }));
                            }}
                          />
                          {flag}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      if (!playbookDraft.name) return;
                      if (editingPlaybookId) {
                        updatePlaybook(editingPlaybookId, playbookDraft);
                      } else {
                        createPlaybook(playbookDraft);
                      }
                      setEditingPlaybookId(null);
                      setPlaybookDraft({
                        name: '',
                        category: 'unknown',
                        conditions: { payer: '', reasonCode: '', minAmount: '' },
                        steps: [''],
                        documents: [''],
                        clinicalReviewRequired: false,
                        appealAngle: '',
                        qualityFields: [],
                      });
                    }}
                    className="px-3 py-1 bg-emerald-600 text-white rounded"
                  >
                    {editingPlaybookId ? 'Guardar cambios' : 'Crear playbook'}
                  </button>
                  {editingPlaybookId ? (
                    <button
                      onClick={() => {
                        setEditingPlaybookId(null);
                        setPlaybookDraft({
                          name: '',
                          category: 'unknown',
                          conditions: { payer: '', reasonCode: '', minAmount: '' },
                          steps: [''],
                          documents: [''],
                          clinicalReviewRequired: false,
                          appealAngle: '',
                          qualityFields: [],
                        });
                      }}
                      className="px-3 py-1 border rounded"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Playbooks guardados</p>
                <div className="mt-2 space-y-2">
                  {playbooks.map((pb) => (
                    <div key={pb.id} className="p-2 bg-slate-50 rounded flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {pb.name} <span className="text-xs text-slate-500">v{pb.version}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {pb.category} • {pb.conditions?.payer || 'Cualquier pagador'}
                        </p>
                        <p className="text-xs text-slate-400">
                          Pasos: {pb.steps.filter(Boolean).length} • Docs: {pb.documents.filter(Boolean).length}
                        </p>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button
                          onClick={() => {
                            setEditingPlaybookId(pb.id);
                            setPlaybookDraft({
                              name: pb.name,
                              category: pb.category,
                              conditions: pb.conditions || { payer: '', reasonCode: '', minAmount: '' },
                              steps: pb.steps || [''],
                              documents: pb.documents || [''],
                              clinicalReviewRequired: pb.clinicalReviewRequired || false,
                              appealAngle: pb.appealAngle || '',
                              qualityFields: pb.qualityFields || [],
                            });
                          }}
                          className="px-2 py-1 border rounded"
                        >
                          Editar
                        </button>
                        <button onClick={() => duplicatePlaybook(pb)} className="px-2 py-1 border rounded">
                          Duplicar
                        </button>
                        <button onClick={() => versionPlaybook(pb)} className="px-2 py-1 border rounded">
                          Versionar
                        </button>
                      </div>
                    </div>
                  ))}
                  {!playbooks.length ? <p className="text-slate-400">Sin playbooks todavía.</p> : null}
                </div>
              </div>
            </div>
          )}

          {view === 'prevention' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Prevención</h2>
                <p className="text-slate-600 mt-1">
                  Convertimos patrones de denials en acciones preventivas internas.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Top causas raíz (por $ en riesgo)</p>
                  <ol className="mt-2 text-xs text-slate-600 list-decimal list-inside">
                    {buildPreventionSuggestions().map((item) => (
                      <li key={item.code}>
                        {item.code} • ${Math.round(item.total).toLocaleString()}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Top pagadores</p>
                  <ol className="mt-2 text-xs text-slate-600 list-decimal list-inside">
                    {Object.entries(
                      claims.reduce((acc, c) => {
                        acc[c.payer] = (acc[c.payer] || 0) + c.amount;
                        return acc;
                      }, {})
                    )
                      .map(([payer, total]) => ({ payer, total }))
                      .sort((a, b) => b.total - a.total)
                      .slice(0, 5)
                      .map((item) => (
                        <li key={item.payer}>
                          {item.payer} • ${Math.round(item.total).toLocaleString()}
                        </li>
                      ))}
                  </ol>
                </div>
              </div>
              <div className="bg-white rounded p-2 border">
                <div className="flex justify-between items-center">
                  <p className="font-semibold">Issues de prevención</p>
                  <button
                    onClick={() => {
                      const suggestion = buildPreventionSuggestions()[0];
                      if (!suggestion) return;
                      createPreventionIssue({
                        title: `Reducir ${suggestion.code}`,
                        rootCauseCategory: suggestion.code,
                        payersAffected: [suggestion.payer],
                        reasonCodes: [suggestion.code],
                        impactEstimate: suggestion.total,
                        ownerRole: 'coding',
                        recommendation:
                          'Actualizar checklist interno y capacitar al equipo. Revisar elegibilidad antes de enviar.',
                        trend: 'up',
                      });
                    }}
                    className="px-2 py-1 bg-emerald-600 text-white rounded text-xs"
                  >
                    Crear issue sugerido
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {preventionIssues.map((issue) => (
                    <div key={issue.id} className="p-2 bg-slate-50 rounded border">
                      <div className="flex justify-between">
                        <div>
                          <p className="font-medium">{issue.title}</p>
                          <p className="text-xs text-slate-500">
                            {issue.rootCauseCategory} • {issue.status} • ${Math.round(issue.impactEstimate || 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-slate-400">Owner: {issue.ownerRole}</p>
                        </div>
                        <div className="text-xs text-slate-500">Tendencia: {issue.trend || 'flat'}</div>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{issue.recommendation}</p>
                    </div>
                  ))}
                  {!preventionIssues.length ? <p className="text-slate-400">Sin issues todavía.</p> : null}
                </div>
              </div>
            </div>
          )}

          {view === 'program' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Programa</h2>
                  <p className="text-slate-600 mt-1">Resumen ejecutivo del backlog y acciones.</p>
                </div>
                <button
                  onClick={() => {
                    const summary = `Resumen semanal:
- Volumen: ${programMetrics.backlog} denials activos.
- Impacto estimado: $${Math.round(programMetrics.riskAmount).toLocaleString()} en riesgo.
- Top causas: ${programMetrics.topCauseEntries.map((c) => c.key).join(', ') || 'n/a'}.
- Acciones: ${programMetrics.topPlaybooks.map((p) => p.name).join(', ') || 'sin playbooks aplicados'}.
- Prevención: ${programMetrics.topIssues.map((i) => i.title).join(', ') || 'sin issues nuevos'}.
Próximos pasos: reforzar playbooks y cerrar tareas abiertas para prevenir recurrencia.`;
                    setProgramSummary(summary);
                    logAudit({
                      action: 'Sistema generó resumen semanal',
                      claimId: 'PROGRAM',
                      detail: 'Resumen listo para compartir',
                      source: 'system',
                    });
                  }}
                  className="px-3 py-1 bg-emerald-600 text-white rounded"
                >
                  Generar resumen semanal
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  ['Backlog total', programMetrics.backlog],
                  ['$ en riesgo', `$${Math.round(programMetrics.riskAmount).toLocaleString()}`],
                  ['Tiempo promedio en cola (días)', programMetrics.avgQueueDays],
                  ['New', programMetrics.stageCounts.new],
                  ['In progress', programMetrics.stageCounts.in_progress],
                  ['Appeal pending', programMetrics.stageCounts.appeal_pending],
                  ['Resolved', programMetrics.stageCounts.resolved],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded p-2 border">
                    <p className="text-slate-500">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Top causas raíz</p>
                  <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
                    {programMetrics.topCauseEntries.map((entry) => (
                      <li key={entry.key}>
                        {entry.key} • ${Math.round(entry.total).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Top playbooks usados</p>
                  <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
                    {programMetrics.topPlaybooks.map((entry) => (
                      <li key={entry.id}>
                        {entry.name} • {entry.count}
                      </li>
                    ))}
                    {!programMetrics.topPlaybooks.length ? <li>Sin uso todavía</li> : null}
                  </ul>
                </div>
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Top issues de prevención</p>
                  <ul className="mt-2 text-xs text-slate-600 list-disc list-inside">
                    {programMetrics.topIssues.map((entry) => (
                      <li key={entry.id}>
                        {entry.title} • ${Math.round(entry.impact).toLocaleString()}
                      </li>
                    ))}
                    {!programMetrics.topIssues.length ? <li>Sin issues todavía</li> : null}
                  </ul>
                </div>
              </div>
              {programSummary ? (
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Resumen semanal</p>
                  <textarea value={programSummary} readOnly className="w-full h-24 border rounded p-2 text-xs mt-2" />
                </div>
              ) : null}
            </div>
          )}

          {view === 'contract' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Contract Lite</h2>
                <p className="text-slate-600 mt-1">
                  Reglas simples por pagador para estimar el expected paid (no es contrato completo).
                </p>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Regla base por pagador</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    value={contractDraft.payer}
                    onChange={(e) => setContractDraft((prev) => ({ ...prev, payer: e.target.value }))}
                    placeholder="Pagador"
                    className="border rounded p-1"
                  />
                  <input
                    value={contractDraft.expectedPercent}
                    onChange={(e) => setContractDraft((prev) => ({ ...prev, expectedPercent: e.target.value }))}
                    placeholder="% esperado sobre charge"
                    className="border rounded p-1"
                  />
                  <input
                    type="date"
                    value={contractDraft.effectiveStart}
                    onChange={(e) => setContractDraft((prev) => ({ ...prev, effectiveStart: e.target.value }))}
                    className="border rounded p-1"
                  />
                  <input
                    type="date"
                    value={contractDraft.effectiveEnd}
                    onChange={(e) => setContractDraft((prev) => ({ ...prev, effectiveEnd: e.target.value }))}
                    className="border rounded p-1"
                  />
                  <input
                    value={contractDraft.notes}
                    onChange={(e) => setContractDraft((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Notas"
                    className="border rounded p-1 col-span-2"
                  />
                </div>
                {contractError ? <p className="text-red-600 text-xs mt-1">{contractError}</p> : null}
                <button onClick={addContractTerm} className="mt-2 px-3 py-1 bg-emerald-600 text-white rounded">
                  Guardar regla
                </button>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Overrides por CPT</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    value={overrideDraft.payer}
                    onChange={(e) => setOverrideDraft((prev) => ({ ...prev, payer: e.target.value }))}
                    placeholder="Pagador"
                    className="border rounded p-1"
                  />
                  <input
                    value={overrideDraft.cptCode}
                    onChange={(e) => setOverrideDraft((prev) => ({ ...prev, cptCode: e.target.value }))}
                    placeholder="CPT"
                    className="border rounded p-1"
                  />
                  <input
                    value={overrideDraft.expectedPercent}
                    onChange={(e) => setOverrideDraft((prev) => ({ ...prev, expectedPercent: e.target.value }))}
                    placeholder="% esperado"
                    className="border rounded p-1"
                  />
                  <input
                    type="date"
                    value={overrideDraft.effectiveStart}
                    onChange={(e) => setOverrideDraft((prev) => ({ ...prev, effectiveStart: e.target.value }))}
                    className="border rounded p-1"
                  />
                  <input
                    type="date"
                    value={overrideDraft.effectiveEnd}
                    onChange={(e) => setOverrideDraft((prev) => ({ ...prev, effectiveEnd: e.target.value }))}
                    className="border rounded p-1"
                  />
                </div>
                {contractError ? <p className="text-red-600 text-xs mt-1">{contractError}</p> : null}
                <button onClick={addContractOverride} className="mt-2 px-3 py-1 bg-emerald-600 text-white rounded">
                  Guardar override
                </button>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Reglas guardadas</p>
                <div className="mt-2 space-y-2 text-xs">
                  {contractTerms.map((term) => (
                    <div key={term.id} className="bg-slate-50 rounded p-2 border">
                      <p className="font-medium">
                        {term.payer} • {term.expectedPercent}% ({term.effectiveStart} - {term.effectiveEnd})
                      </p>
                      <p className="text-slate-500">{term.notes || 'Sin notas'}</p>
                    </div>
                  ))}
                  {!contractTerms.length ? <p className="text-slate-400">Sin reglas todavía.</p> : null}
                </div>
                <p className="font-semibold mt-2">Overrides guardados</p>
                <div className="mt-2 space-y-2 text-xs">
                  {contractOverrides.map((override) => (
                    <div key={override.id} className="bg-slate-50 rounded p-2 border">
                      <p className="font-medium">
                        {override.payer} • {override.cptCode} • {override.expectedPercent}% ({override.effectiveStart} - {override.effectiveEnd})
                      </p>
                    </div>
                  ))}
                  {!contractOverrides.length ? <p className="text-slate-400">Sin overrides todavía.</p> : null}
                </div>
              </div>
            </div>
          )}

          {view === 'insights' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Insights</h2>
                <p className="text-slate-600 mt-1">Agregados simples de denials y underpayments.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Por pagador</p>
                  <ol className="mt-2 text-xs text-slate-600 list-decimal list-inside">
                    {Object.entries(
                      claims.reduce((acc, claim) => {
                        acc[claim.payer] = (acc[claim.payer] || 0) + (claim.amount || 0);
                        return acc;
                      }, underpaymentItems.reduce((acc, item) => {
                        acc[item.payer] = (acc[item.payer] || 0) + (item.varianceAmount || 0);
                        return acc;
                      }, {}))
                    )
                      .map(([payer, total]) => ({ payer, total }))
                      .sort((a, b) => b.total - a.total)
                      .slice(0, 3)
                      .map((entry) => (
                        <li key={entry.payer}>
                          {entry.payer} • ${Math.round(entry.total).toLocaleString()}
                        </li>
                      ))}
                  </ol>
                </div>
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Por reason code</p>
                  <ol className="mt-2 text-xs text-slate-600 list-decimal list-inside">
                    {Object.entries(
                      claims.reduce((acc, claim) => {
                        const key = claim.code || 'unknown';
                        acc[key] = (acc[key] || 0) + (claim.amount || 0);
                        return acc;
                      }, underpaymentItems.reduce((acc, item) => {
                        const key = item.casReasonCode || 'unknown';
                        acc[key] = (acc[key] || 0) + (item.varianceAmount || 0);
                        return acc;
                      }, {}))
                    )
                      .map(([code, total]) => ({ code, total }))
                      .sort((a, b) => b.total - a.total)
                      .slice(0, 3)
                      .map((entry) => (
                        <li key={entry.code}>
                          {entry.code} • ${Math.round(entry.total).toLocaleString()}
                        </li>
                      ))}
                  </ol>
                </div>
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Por CPT</p>
                  <ol className="mt-2 text-xs text-slate-600 list-decimal list-inside">
                    {Object.entries(
                      claims.reduce((acc, claim) => {
                        const key = claim.cpt || 'unknown';
                        acc[key] = (acc[key] || 0) + (claim.amount || 0);
                        return acc;
                      }, underpaymentItems.reduce((acc, item) => {
                        const claim = claims.find((c) => c.id === item.claimId);
                        const key = claim?.cpt || 'unknown';
                        acc[key] = (acc[key] || 0) + (item.varianceAmount || 0);
                        return acc;
                      }, {}))
                    )
                      .map(([cpt, total]) => ({ cpt, total }))
                      .sort((a, b) => b.total - a.total)
                      .slice(0, 3)
                      .map((entry) => (
                        <li key={entry.cpt}>
                          {entry.cpt} • ${Math.round(entry.total).toLocaleString()}
                        </li>
                      ))}
                  </ol>
                </div>
              </div>
            </div>
          )}

          {view === 'integrations' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Configuración SFTP (visual)</h2>
                <p className="text-slate-600 mt-1">
                  Solo guardamos la configuración. La conexión real se implementará más adelante.
                </p>
                <form onSubmit={addIntegration} className="grid grid-cols-3 gap-2 mt-2">
                  <input name="name" placeholder="Nombre" className="border rounded p-1" required />
                  <input name="host" placeholder="Host SFTP" className="border rounded p-1" required />
                  <input name="user" placeholder="Usuario" className="border rounded p-1" required />
                  <input name="path" placeholder="Folder / Ruta" className="border rounded p-1" required />
                  <button type="submit" className="px-3 py-1 bg-emerald-600 text-white rounded col-span-3">
                    Guardar configuración
                  </button>
                </form>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Estado</p>
                <div className="mt-2 space-y-2">
                  {integrations.map((int) => (
                    <div key={int.id} className="p-2 bg-slate-50 rounded flex justify-between">
                      <div>
                        <p className="font-medium">{int.name}</p>
                        <p className="text-slate-500 text-xs">
                          {int.host} • {int.path} • Usuario: {int.user}
                        </p>
                        <p className="text-slate-400 text-xs">Status: Pendiente de conexión real</p>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>Status: {int.lastPull === 'Pendiente' ? 'Pendiente' : 'Pendiente'}</p>
                        <p>Host: {int.host}</p>
                        <p>Folder: {int.path}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === 'intake' && (
            <div className="space-y-2">
              <div
                className="bg-white rounded p-2 border border-dashed"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) {
                    handleUploadFiles(e.dataTransfer.files);
                  }
                }}
              >
                <h2 className="font-semibold">Data Intake</h2>
                <p className="text-slate-600 mt-1">
                  Sube 835, 277CA, CSV o un ZIP con varios archivos. Detectamos el tipo y procesamos en background.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="px-3 py-1 border rounded cursor-pointer bg-white hover:bg-slate-50">
                    Cargar archivos
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handleUploadFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                  <button onClick={() => downloadSample('277ca')} className="px-3 py-1 border rounded hover:bg-slate-50">
                    Descargar ejemplo 277CA
                  </button>
                  <button onClick={() => downloadSample('835')} className="px-3 py-1 border rounded hover:bg-slate-50">
                    Descargar ejemplo 835
                  </button>
                  <button onClick={() => downloadSample('csv')} className="px-3 py-1 border rounded hover:bg-slate-50">
                    Descargar ejemplo CSV
                  </button>
                </div>
              </div>

              {Object.keys(pendingMappings).length ? (
                <div className="bg-white rounded p-2 border">
                  <p className="font-semibold">Mapeo CSV pendiente</p>
                  <div className="mt-2 space-y-2">
                    {Object.entries(pendingMappings).map(([fileId, mappingInfo]) => {
                      const draft = mappingDrafts[fileId] || {};
                      return (
                        <div key={fileId} className="p-2 bg-slate-50 rounded border">
                          <p className="font-medium">Archivo CSV sin columnas esperadas</p>
                          <p className="text-xs text-slate-500">Selecciona las columnas correctas para procesarlo.</p>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {CSV_FIELDS.map((field) => (
                              <label key={field} className="text-xs text-slate-600">
                                {CSV_FIELD_LABELS[field]}
                                <select
                                  className="w-full border rounded p-1 mt-1"
                                  value={draft[field] || ''}
                                  onChange={(e) =>
                                    setMappingDrafts((prev) => ({
                                      ...prev,
                                      [fileId]: { ...prev[fileId], [field]: e.target.value },
                                    }))
                                  }
                                >
                                  <option value="">-- Sin asignar --</option>
                                  {mappingInfo.headers.map((header) => (
                                    <option key={header} value={header}>
                                      {header}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </div>
                          <button
                            onClick={() => applyCsvMapping(fileId, draft)}
                            className="mt-2 px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-60"
                            disabled={
                              !draft.claimId && !draft.payerClaimNumber && !draft.patientControlNumber && !draft.trackingNumber
                            }
                          >
                            Procesar CSV
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Resultado por archivo</p>
                {activeRun?.files?.length ? (
                  <div className="mt-2 space-y-2">
                    {activeRun.files.map((file) => (
                      <div key={file.id} className="p-2 border rounded bg-slate-50">
                        <div className="flex justify-between">
                          <span className="font-medium">
                            {file.name}
                            {file.sourceName ? <span className="text-xs text-slate-400"> ({file.sourceName})</span> : null}
                          </span>
                          <span className="text-slate-500">{file.type}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="px-2 py-0.5 rounded bg-slate-200">Status: {file.status}</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            Denials: {file.counts.denials}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                            Pagos: {file.counts.payments}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                            Ajustes: {file.counts.adjustments}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-200">Match: {file.counts.matched}</span>
                          <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">
                            Needs review: {file.counts.needsReview}
                          </span>
                        </div>
                        {file.errors?.length ? (
                          <div className="mt-2 text-xs text-red-600 space-y-1">
                            {file.errors.map((err, idx) => (
                              <p key={`${file.id}-err-${idx}`}>
                                Línea {err.line}: {err.message}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 mt-1">Sin archivos procesados todavía.</p>
                )}
              </div>
            </div>
          )}

          {view === 'dashboard' && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1">
                {[
                  ['Total', metrics.total],
                  ['Hi-Prio', metrics.highPrio, 'Prioridad demo según monto, antigüedad y reglas del pagador.'],
                  ['$Pend', `$${(metrics.amount / 1000).toFixed(0)}K`],
                  ['Prob%', `${metrics.avgProb}%`, 'Probabilidad demo basada en recuperación histórica y estado.'],
                  ['Proc', stats.proc],
                ].map(([label, value, hint]) => (
                  <div key={label} className="bg-white rounded p-1.5 border text-center">
                    <p className="text-slate-500">
                      {label}
                      {hint ? (
                        <span className="ml-1 text-slate-400" title={hint}>
                          ⓘ
                        </span>
                      ) : null}
                    </p>
                    <p className="font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 bg-white rounded p-2 border">
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold">Alta Prioridad</span>
                    <button onClick={() => setView('denials')} className="text-emerald-600">
                      →
                    </button>
                  </div>
                  {filtered
                    .filter((c) => c.prio >= 70)
                    .slice(0, 4)
                    .map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setSel(c);
                          setView('denials');
                        }}
                        className="flex justify-between p-1 hover:bg-slate-50 cursor-pointer border-b last:border-0"
                      >
                        <div className="flex items-center gap-1">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${priorityClass(c.prio)}`}>
                            {c.prio}
                          </div>
                          <div>
                          <p className="font-medium">{displayName(c)}</p>
                            <p className="text-slate-500">{c.id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${c.amount.toLocaleString()}</p>
                          <p className="text-emerald-600">{c.prob}%</p>
                        </div>
                      </div>
                    ))}
                </div>
                <div className="bg-white rounded p-2 border">
                  <span className="font-semibold">Estados</span>
                  {[
                    ['Pend', metrics.pending],
                    ['Proc', metrics.inProgress],
                    ['Apel', metrics.appealed],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between py-0.5 border-b last:border-0">
                      <span>{label}</span>
                      <span className="font-bold">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded p-2 border">
                <span className="font-semibold">Actividad</span>
                {audit.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-1 p-1 bg-slate-50 rounded mt-1">
                    <Users className="w-3 h-3" />
                    <span className="flex-1">
                      {entry.action} • {entry.claimId}
                    </span>
                    <span className="text-slate-400">{entry.ts}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded p-2 border" id="help-panel">
                <span className="font-semibold">Ayuda rápida</span>
                <div className="mt-1 space-y-1 text-slate-600">
                  <p>
                    <strong>Claim:</strong> factura enviada al pagador.
                  </p>
                  <p>
                    <strong>Denial:</strong> rechazo total o parcial del pago.
                  </p>
                  <p>
                    <strong>Prioridad:</strong> fórmula demo con monto, antigüedad y reglas.
                  </p>
                  <p>
                    <strong>Probabilidad:</strong> chance estimada de recuperación.
                  </p>
                  <p>
                    <strong>Apelación:</strong> borrador editable para solicitar revisión.
                  </p>
                  <p>
                    <strong>Auditoría:</strong> registro de acciones y cambios.
                  </p>
                </div>
              </div>
            </div>
          )}

          {view === 'denials' && (
            <div className="flex h-full gap-2">
              <div className={`${sel || selectedUnderpayment ? 'w-1/2' : 'w-full'} bg-white rounded border flex flex-col`}>
                <div className="p-1.5 border-b flex gap-1">
                  <div className="flex-1 relative">
                    <Search className="absolute left-1 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                    <input
                      placeholder="Buscar..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-5 pr-1 py-1 border rounded"
                    />
                  </div>
                  <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border rounded px-1">
                    <option value="all">Todos</option>
                    <option value="pending">Pend</option>
                    <option value="in_progress">Proc</option>
                    <option value="appealed">Apel</option>
                  </select>
                  <button
                    onClick={() =>
                      exportCsv(
                        filtered.map((c) => ({
                          id: c.id,
                          patient: displayName(c),
                          payer: c.payer,
                          amount: c.amount,
                          status: c.status,
                          prio: c.prio,
                          prob: c.prob,
                        })),
                        'denials.csv'
                      )
                    }
                    className="border rounded px-1 hover:bg-slate-50"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-1 border-b flex gap-1 text-xs">
                  {[
                    ['all', 'Todo'],
                    ['denial', 'Denials'],
                    ['underpayment', 'Underpayments'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setUnderpaymentFilter(key)}
                      className={`px-2 py-0.5 rounded border ${underpaymentFilter === key ? 'bg-emerald-50 text-emerald-700' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-auto">
                  {filteredQueue.map((item) => {
                    const claim = item.claim;
                    if (!claim) return null;
                    const isUnderpayment = item.type === 'underpayment';
                    const label = isUnderpayment ? 'Underpayment' : 'Denial';
                    const amount = isUnderpayment ? item.underpayment.varianceAmount : claim.amount;
                    const selected = isUnderpayment ? selectedUnderpayment?.id === item.underpayment.id : sel?.id === claim.id;
                    return (
                    <div
                      key={item.id}
                      onClick={() => {
                        if (isUnderpayment) {
                          setSelectedUnderpaymentId(item.underpayment.id);
                          setSel(null);
                        } else {
                          setSel(claim);
                          setSelectedUnderpaymentId(null);
                        }
                      }}
                      className={`p-1.5 border-b cursor-pointer hover:bg-slate-50 ${
                        selected ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''
                      }`}
                    >
                      <div className="flex justify-between">
                        <div className="flex items-center gap-1">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${priorityClass(item.prio)}`}>
                            {item.prio}
                          </div>
                          <div>
                            <p className="font-medium">{displayName(claim)}</p>
                            <p className="text-slate-500">
                              {claim.id} • {label}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${Math.round(amount).toLocaleString()}</p>
                          {isUnderpayment ? (
                            <span className="text-xs text-amber-600">{item.underpayment.status}</span>
                          ) : (
                            statusBadge(claim.status)
                          )}
                        </div>
                      </div>
                      <div className="ml-6 text-slate-500">
                        {claim.payer} •{' '}
                        <span className="text-red-600">{isUnderpayment ? item.underpayment.casReasonCode : claim.code}</span> •{' '}
                        <span className="text-emerald-600">{item.prob}%</span>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
              {sel && (
                <div className="w-1/2 bg-white rounded border flex flex-col">
                  <div className="p-1.5 border-b flex justify-between">
                    <span className="font-semibold">{sel.id}</span>
                    <button onClick={() => setSel(null)}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-2 space-y-2" id="denial-detail">
                    <div className="p-2 bg-slate-800 text-white rounded flex justify-between">
                      <div>
                        <p className="text-slate-400">Monto</p>
                        <p className="text-lg font-bold">${sel.amount.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-400">Prob</p>
                        <p className="text-lg font-bold text-emerald-400">{sel.prob}%</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        ['Paciente', displayName(sel)],
                        ['Pagador', sel.payer],
                        ['Proveedor', sel.provider],
                        ['Facility', sel.facility],
                        ['CPT', sel.cpt],
                        ['Dx', sel.dx],
                      ].map(([label, value]) => (
                        <div key={label} className="p-1 bg-slate-50 rounded">
                          <p className="text-slate-500">{label}</p>
                          <p className="font-medium">{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="p-1.5 bg-red-50 border border-red-200 rounded">
                      <p className="font-semibold text-red-700">{sel.code}</p>
                      <p className="text-red-800">{sel.reason}</p>
                    </div>
                    <div className="p-1.5 bg-emerald-50 border border-emerald-200 rounded">
                      <p className="font-semibold text-emerald-700">Acción AI</p>
                      <p className="text-emerald-800">{sel.action}</p>
                    </div>
                    {triageResults[sel.id] ? (
                      <div className="p-2 bg-white border rounded">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">Triage IA</span>
                          <button
                            onClick={() => applyTriage(sel.id)}
                            className="px-2 py-0.5 bg-emerald-600 text-white rounded"
                          >
                            Aplicar sugerencias
                          </button>
                        </div>
                        <p className="text-slate-600 mt-1">{triageResults[sel.id].suggested_action_short}</p>
                        <ul className="text-slate-500 text-xs mt-1 list-disc list-inside">
                          {triageResults[sel.id].suggested_action_steps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                        <p className="text-slate-400 text-xs mt-1">
                          Docs sugeridos: {triageResults[sel.id].required_documents.join(', ')}
                        </p>
                        <p className="text-slate-400 text-xs mt-1">
                          Recomendación de apelación: {triageResults[sel.id].appeal_recommended ? 'Sí' : 'No'} •{' '}
                          {triageResults[sel.id].appeal_angle}
                        </p>
                      </div>
                    ) : (
                      <div className="p-2 bg-slate-50 border rounded text-slate-500 text-xs">
                        Sin triage IA todavía. Sube un 277CA/835 en Data Intake para generar sugerencias.
                      </div>
                    )}
                    <div className="p-2 bg-white border rounded">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Work plan</span>
                        <div className="flex gap-2">
                          <select
                            value={taskTypeDraft}
                            onChange={(e) => setTaskTypeDraft(e.target.value)}
                            className="border rounded px-1 text-xs"
                          >
                            {TASK_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {TASK_LABELS[type]}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => createTaskForDenial(sel, taskTypeDraft, 'user')}
                            className="px-2 py-0.5 border rounded text-xs"
                          >
                            Crear tarea
                          </button>
                          <button
                            onClick={() => applySuggestedTasks(sel)}
                            className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs"
                          >
                            Aplicar sugerencia
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-xs">
                        {tasks.filter((t) => t.claimId === sel.id).length ? (
                          tasks
                            .filter((t) => t.claimId === sel.id)
                            .map((t) => (
                              <div key={t.id} className="flex justify-between border-b last:border-0 py-1">
                                <div>
                                  <p className="font-medium">{t.title}</p>
                                  <p className="text-slate-500">
                                    {TASK_LABELS[t.taskType]} • {OWNER_ROLE_LABELS[t.ownerRole]} • {t.ownerName}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-slate-500">Estado: {t.status}</p>
                                  <button
                                    onClick={() => completeTask(t.id)}
                                    className="text-emerald-600 text-xs"
                                  >
                                    Marcar done
                                  </button>
                                </div>
                              </div>
                            ))
                        ) : (
                          <p className="text-slate-400">Sin tareas aún.</p>
                        )}
                      </div>
                    </div>
                    <div className="p-2 bg-white border rounded">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Aplicar playbook</span>
                        <div className="flex gap-2">
                          <select
                            value={selectedPlaybookId || playbooks[0]?.id || ''}
                            onChange={(e) => setSelectedPlaybookId(e.target.value)}
                            className="border rounded px-1 text-xs"
                            disabled={!playbooks.length}
                          >
                            {playbooks.length ? (
                              playbooks.map((pb) => (
                                <option key={pb.id} value={pb.id}>
                                  {pb.name} v{pb.version}
                                </option>
                              ))
                            ) : (
                              <option value="">Sin playbooks</option>
                            )}
                          </select>
                          <button
                            onClick={() => {
                              const selected =
                                playbooks.find((pb) => pb.id === (selectedPlaybookId || playbooks[0]?.id)) || playbooks[0];
                              if (selected) applyPlaybookToClaim(selected, sel);
                            }}
                            className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs"
                            disabled={!playbooks.length}
                          >
                            Aplicar
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Aplica pasos y checklist del playbook al denial actual.
                      </p>
                    </div>
                    <div className="p-2 bg-white border rounded">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Vincular a prevención</span>
                        <div className="flex gap-2">
                          <select
                            value={selectedIssueId}
                            onChange={(e) => setSelectedIssueId(e.target.value)}
                            className="border rounded px-1 text-xs"
                          >
                            <option value="">Selecciona issue</option>
                            {preventionIssues.map((issue) => (
                              <option key={issue.id} value={issue.id}>
                                {issue.title}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const issue = preventionIssues.find((item) => item.id === selectedIssueId);
                              if (issue) linkIssueToClaim(issue.id, sel);
                            }}
                            className="px-2 py-0.5 border rounded text-xs"
                          >
                            Vincular
                          </button>
                          <button
                            onClick={() => {
                              const newIssue = createPreventionIssue({
                                title: `Prevenir ${sel.code || 'denial'} ${sel.id}`,
                                rootCauseCategory: sel.root_cause_bucket || sel.code || 'unknown',
                                payersAffected: [sel.payer],
                                reasonCodes: [sel.code || 'unknown'],
                                impactEstimate: sel.amount || 0,
                                ownerRole: 'coding',
                                recommendation: 'Revisar proceso interno y actualizar checklist del equipo.',
                                trend: 'up',
                              });
                              linkIssueToClaim(newIssue.id, sel);
                            }}
                            className="px-2 py-0.5 bg-emerald-600 text-white rounded text-xs"
                          >
                            Crear issue
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Vincula el denial a un issue preventivo para evitar recurrencias.
                      </p>
                    </div>
                    <div className="p-2 bg-white border rounded">
                      <p className="font-semibold">Causa raíz y calidad</p>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                        <label className="text-slate-600">
                          Categoría normalizada
                          <select
                            value={sel.denial_category_normalized || 'unknown'}
                            onChange={(e) =>
                              updateClaimFields(sel.id, { denial_category_normalized: e.target.value }, 'Categoría actualizada')
                            }
                            className="w-full border rounded p-1 mt-1"
                          >
                            {PLAYBOOK_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-slate-600">
                          Root cause bucket
                          <input
                            value={sel.root_cause_bucket || ''}
                            onChange={(e) =>
                              updateClaimFields(sel.id, { root_cause_bucket: e.target.value || 'unknown' }, 'Root cause actualizado')
                            }
                            placeholder="unknown"
                            className="w-full border rounded p-1 mt-1"
                          />
                        </label>
                        <label className="text-slate-600">
                          Revisión clínica
                          <select
                            value={sel.clinical_review_required ? 'yes' : 'no'}
                            onChange={(e) =>
                              updateClaimFields(
                                sel.id,
                                { clinical_review_required: e.target.value === 'yes' },
                                'Revisión clínica actualizada'
                              )
                            }
                            className="w-full border rounded p-1 mt-1"
                          >
                            <option value="no">No</option>
                            <option value="yes">Sí</option>
                          </select>
                        </label>
                        <div className="text-slate-600">
                          Campos de calidad faltantes
                          <div className="mt-1 flex flex-wrap gap-2">
                            {QUALITY_GAP_FLAGS.map((flag) => (
                              <label key={flag} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={(sel.quality_gap_flags || []).includes(flag)}
                                  onChange={(e) => {
                                    const nextFlags = e.target.checked
                                      ? [...(sel.quality_gap_flags || []), flag]
                                      : (sel.quality_gap_flags || []).filter((item) => item !== flag);
                                    updateClaimFields(sel.id, { quality_gap_flags: nextFlags }, 'Checklist de calidad actualizado');
                                  }}
                                />
                                {flag}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-1.5 bg-slate-50 rounded">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">Scoring</p>
                        <span className="text-slate-400">{sel.scoringVersion}</span>
                      </div>
                      <p className="text-slate-600">
                        Días: {sel.inputs.days} | Amt: {sel.inputs.amt} | Age: {sel.inputs.age} | Pen:{' '}
                        {sel.inputs.pen}
                      </p>
                      <p className="text-slate-400 text-[10px]">
                        Demo: fórmula basada en monto, antigüedad, reglas del pagador y tipo de denial.
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        id="tour-appeal"
                        onClick={() => openAppealModal(sel)}
                        className="flex-1 bg-emerald-600 text-white py-1 rounded hover:bg-emerald-700 flex items-center justify-center gap-1"
                      >
                        <FileText className="w-3 h-3" />
                        Apelación
                      </button>
                      <button
                        id="tour-status"
                        onClick={() => updateStatus(sel.id, 'in_progress')}
                        className="flex-1 bg-blue-600 text-white py-1 rounded hover:bg-blue-700 flex items-center justify-center gap-1"
                      >
                        <CheckCircle className="w-3 h-3" />
                        En Proceso
                      </button>
                    </div>
                    <div className="p-1.5 bg-slate-50 rounded text-slate-600">
                      Enviado: {sel.submitted} • Denegado: {sel.denied}
                    </div>
                    <div className="p-2 bg-white border rounded">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">Historial de Apelaciones</span>
                        <span className="text-slate-400 text-xs">{sel.appeals.length}</span>
                      </div>
                      {sel.appeals.length ? (
                        <div className="space-y-1">
                          {sel.appeals.map((a) => (
                            <div key={a.id} className="flex justify-between text-slate-600 text-xs bg-slate-50 p-1 rounded">
                              <span>
                                {a.id} • {a.status}
                              </span>
                              <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400 text-xs">Sin apelaciones previas.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {selectedUnderpayment && (
                <div className="w-1/2 bg-white rounded border flex flex-col">
                  <div className="p-1.5 border-b flex justify-between">
                    <span className="font-semibold">Underpayment • {selectedUnderpayment.claimId}</span>
                    <button onClick={() => setSelectedUnderpaymentId(null)}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-2 space-y-2">
                    <div className="p-2 bg-slate-800 text-white rounded flex justify-between">
                      <div>
                        <p className="text-slate-400">Variance</p>
                        <p className="text-lg font-bold">${Math.round(selectedUnderpayment.varianceAmount).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-slate-400">Prob</p>
                        <p className="text-lg font-bold text-emerald-400">{selectedUnderpayment.prob}%</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        ['Pagador', selectedUnderpayment.payer],
                        ['Expected (estimado)', selectedUnderpayment.expectedAmount ? `$${Math.round(selectedUnderpayment.expectedAmount)}` : 'Unknown'],
                        ['Paid', `$${Math.round(selectedUnderpayment.actualPaidAmount)}`],
                        ['Reason', selectedUnderpayment.casReasonCode || 'unknown'],
                      ].map(([label, value]) => (
                        <div key={label} className="p-1 bg-slate-50 rounded">
                          <p className="text-slate-500">{label}</p>
                          <p className="font-medium">{value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="p-1.5 bg-amber-50 border border-amber-200 rounded">
                      <p className="font-semibold text-amber-700">Recomendación</p>
                      <p className="text-amber-800">{selectedUnderpayment.recommendedNextStep}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'unmatched' && (
            <div className="bg-white rounded p-2 border">
              <div className="flex justify-between mb-2">
                <span className="font-semibold">Unmatched ({unmatched.length})</span>
                <span className="text-slate-400">Requiere revisión humana</span>
              </div>
              {unmatched.length ? (
                <div className="space-y-2">
                  {unmatched.map((item) => (
                    <div key={item.id} className="p-2 bg-slate-50 rounded flex justify-between items-center">
                      <div>
                        <p className="font-medium">{item.id}</p>
                        <p className="text-slate-500 text-xs">{item.reason}</p>
                        <p className="text-slate-400 text-xs">Sugerencia IA: {item.suggestion}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => resolveUnmatched(item.id)}
                          className="px-2 py-1 border rounded hover:bg-slate-100"
                        >
                          Confirmar match
                        </button>
                        <button
                          onClick={() => resolveUnmatched(item.id)}
                          className="px-2 py-1 bg-emerald-600 text-white rounded"
                        >
                          Crear claim
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400">Sin elementos pendientes.</p>
              )}
            </div>
          )}

          {view === 'ingestions' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <div className="flex justify-between mb-2">
                  <span className="font-semibold">Historial de ingestión ({ingestionRuns.length})</span>
                  <span className="text-slate-400">Estado por archivo</span>
                </div>
                {ingestionRuns.length ? (
                  <div className="space-y-3">
                    {ingestionRuns.map((run) => (
                      <div key={run.id} className="border rounded p-2 bg-slate-50">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>Run {run.id}</span>
                          <span>{new Date(run.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-slate-400">Estado: {run.status}</p>
                        <div className="mt-2 space-y-2">
                          {run.files.map((file) => (
                            <div key={file.id} className="p-2 bg-white border rounded flex justify-between items-center">
                              <div>
                                <p className="font-medium">
                                  {file.name} {file.sourceName ? <span className="text-xs text-slate-400">({file.sourceName})</span> : null}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {file.type} • {file.status} • Denials {file.counts.denials} • Errors {file.errors.length}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setIngestionDetail({ runId: run.id, file })}
                                  className="px-2 py-1 border rounded hover:bg-slate-100"
                                >
                                  Ver detalles
                                </button>
                                <button
                                  onClick={() => reprocessFile(run.id, file.id)}
                                  className="px-2 py-1 bg-emerald-600 text-white rounded"
                                >
                                  Reprocesar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400">Sin ingestiones todavía.</p>
                )}
              </div>
            </div>
          )}

          {view === 'payments' && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Pendiente', `$${(metrics.amount / 1000).toFixed(0)}K`, 'amber'],
                  ['Apelados', stats.app, 'purple'],
                  ['Prob Prom', `${metrics.avgProb}%`, 'emerald'],
                ].map(([label, value, color]) => (
                  <div key={label} className="bg-white rounded p-2 border">
                    <p className={paymentTone[color]}>{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded p-2 border">
                <span className="font-semibold">Apelados</span>
                {claims.filter((c) => c.status === 'appealed').length ? (
                  claims
                    .filter((c) => c.status === 'appealed')
                    .map((c) => (
                      <div key={c.id} className="flex justify-between p-1 bg-slate-50 rounded mt-1">
                        <div>
                          <p className="font-medium">{c.id}</p>
                          <p className="text-slate-500">{displayName(c)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${c.amount.toLocaleString()}</p>
                          <p className="text-purple-600">{c.prob}%</p>
                        </div>
                      </div>
                    ))
                ) : (
                  <p className="text-slate-400 mt-1">Ninguno</p>
                )}
              </div>
            </div>
          )}

          {view === 'audit' && (
            <div className="bg-white rounded p-2 border">
              <div className="flex justify-between mb-2">
                <span className="font-semibold">Auditoría ({audit.length})</span>
                <button
                  onClick={() =>
                    exportCsv(
                      audit.map((a) => ({
                        ts: `${a.date} ${a.ts}`,
                        simDate: a.simDate,
                        user: a.user,
                        action: a.action,
                        claim: a.claimId,
                        source: a.source,
                        changed: (a.changedFields || []).join('|'),
                        scoringVersion: a.scoringVersion || '',
                        modelVersion: a.modelVersion || '',
                        requestId: a.requestId || '',
                        latencyMs: a.latencyMs ?? '',
                        result: a.result || '',
                      })),
                      'audit.csv'
                    )
                  }
                  className="text-emerald-600 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              </div>
              {audit.map((entry) => (
                <div key={entry.id} className="p-1.5 bg-slate-50 rounded mb-1">
                  <div className="flex justify-between">
                    <span className="font-medium">{entry.action}</span>
                    <span className="text-slate-400">{entry.ts}</span>
                  </div>
                  <p className="text-slate-600">
                    {entry.user} • {entry.claimId}
                    {entry.detail ? ` • ${entry.detail}` : ''}
                  </p>
                  {entry.changedFields?.length ? (
                    <p className="text-slate-400 text-xs">Cambios: {entry.changedFields.join(', ')}</p>
                  ) : null}
                  {entry.scoringInputs ? (
                    <p className="text-slate-400 text-xs">
                      Scoring {entry.scoringVersion}: días {entry.scoringInputs.days}, amt {entry.scoringInputs.amt}, age{' '}
                      {entry.scoringInputs.age}
                    </p>
                  ) : null}
                  {entry.modelVersion || entry.requestId ? (
                    <p className="text-slate-400 text-xs">
                      AI {entry.modelVersion || 'n/a'} • {entry.requestId || 'n/a'} • {entry.latencyMs ?? '--'}ms •{' '}
                      {entry.result || 'n/a'}
                    </p>
                  ) : null}
                  {entry.payloadHash ? (
                    <p className="text-slate-400 text-xs">Payload hash: {entry.payloadHash}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

              
        </main>
      </div>

      {ingestionDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded w-full max-w-lg mx-4">
            <div className="p-2 border-b flex justify-between">
              <span className="font-semibold">Detalles de ingestión</span>
              <button onClick={() => setIngestionDetail(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-2 text-xs">
              <p className="font-semibold">{ingestionDetail.file.name}</p>
              <p className="text-slate-500">
                Tipo: {ingestionDetail.file.type} • Estado: {ingestionDetail.file.status}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(ingestionDetail.file.counts).map(([label, value]) => (
                  <div key={label} className="bg-slate-50 rounded p-2 border">
                    <p className="text-slate-500">{label}</p>
                    <p className="font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              {ingestionDetail.file.errors?.length ? (
                <div>
                  <p className="font-semibold text-red-600">Errores</p>
                  <ul className="list-disc list-inside text-red-600">
                    {ingestionDetail.file.errors.map((err, idx) => (
                      <li key={`${ingestionDetail.file.id}-detail-${idx}`}>
                        Línea {err.line}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-slate-400">Sin errores reportados.</p>
              )}
            </div>
            <div className="p-2 border-t flex justify-end">
              <button onClick={() => setIngestionDetail(null)} className="px-3 py-1 border rounded">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded w-full max-w-md mx-4">
            <div className="p-2 border-b flex justify-between">
              <span className="font-semibold">Carta de Apelación</span>
              <button onClick={() => setModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3">
              <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} className="w-full h-40 p-2 border rounded text-xs" />
            </div>
            <div className="p-2 border-t flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="px-3 py-1 border rounded">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!sel) return;
                  const appealEntry = {
                    id: `APL-${Date.now().toString().slice(-4)}`,
                    createdAt: new Date().toISOString(),
                    status: 'submitted',
                    summary: appeal.split('\n')[0] || 'Carta generada',
                  };
                  setModal(false);
                  applyAppeal(sel, appealEntry);
                }}
                className="px-3 py-1 bg-emerald-600 text-white rounded"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {showTour && currentTour && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" />
          {tourRect ? (
            <div
              className="absolute border-2 border-emerald-400 rounded pointer-events-none"
              style={{
                top: `${tourRect.top - 6}px`,
                left: `${tourRect.left - 6}px`,
                width: `${tourRect.width + 12}px`,
                height: `${tourRect.height + 12}px`,
              }}
            />
          ) : null}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white rounded shadow-lg p-4 w-full max-w-md">
            <p className="font-semibold">{currentTour.title}</p>
            <p className="text-slate-600 mt-1">{currentTour.body}</p>
            <div className="flex justify-between mt-3 text-sm">
              <button onClick={() => setShowTour(false)} className="px-2 py-1 border rounded">
                Cerrar
              </button>
              <div className="flex gap-2">
                <button onClick={() => setTourStep((prev) => Math.max(prev - 1, 0))} className="px-2 py-1 border rounded">
                  Atrás
                </button>
                <button
                  onClick={() => {
                    if (tourStep >= tourSteps.length - 1) {
                      setShowTour(false);
                      setTourStep(0);
                    } else {
                      setTourStep((prev) => prev + 1);
                    }
                  }}
                  className="px-2 py-1 bg-emerald-600 text-white rounded"
                >
                  {tourStep >= tourSteps.length - 1 ? 'Finalizar' : 'Siguiente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
