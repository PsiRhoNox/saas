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

const STORAGE_KEY = 'denialsZeroDesk';
const STORAGE_VERSION = 3;
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
  };
};

const paymentTone = {
  amber: 'text-amber-600',
  purple: 'text-purple-600',
  emerald: 'text-emerald-600',
};

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
  const [uploads, setUploads] = useState([]);
  const [needsReview, setNeedsReview] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [triageResults, setTriageResults] = useState({});
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const stored = getStoredState();
    if (stored) {
      setRules(stored.rules || defaultRules);
      setStats(stored.stats || { proc: 0, app: 0 });
      setDemoMode(stored.demoMode ?? true);
      setUploads(stored.uploads || []);
      setNeedsReview(stored.needsReview || []);
      setUnmatched(stored.unmatched || []);
      setTriageResults(stored.triageResults || {});
      setTasks(stored.tasks || []);
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
      uploads,
      needsReview,
      unmatched,
      triageResults,
      tasks,
    });
  }, [claims, audit, stats, date, rules, demoMode, uploads, needsReview, unmatched, triageResults, tasks]);

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

  const logAudit = ({ action, claimId, detail, source, before, after, scoring, aiDecision, modelVersion, requestId, latencyMs, result }) => {
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
    });
    setAudit((prev) => [entry, ...prev]);
  };

  const detectEdiType = (fileName, content) => {
    const upper = `${fileName} ${content}`.toUpperCase();
    if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
    if (upper.includes('277') || upper.includes('STC')) return '277CA';
    return 'unknown';
  };

  const parse835 = (content) => {
    const claimsParsed = [];
    const regex = /CLP\*([^*]+)\*[^*]*\*([0-9.]+)\*([0-9.]+)\*([0-9.]+)\*/g;
    let match = regex.exec(content);
    while (match) {
      const [_, externalId, charged, paid, patientResp] = match;
      claimsParsed.push({
        externalId,
        charged: Number(charged),
        paid: Number(paid),
        patientResp: Number(patientResp),
      });
      match = regex.exec(content);
    }
    return claimsParsed;
  };

  const parse277 = (content) => {
    const claimsParsed = [];
    const regex = /TRN\*1\*([^~*\n\r]+)[^~]*~?[^~]*STC\*([^*~]+)/g;
    let match = regex.exec(content);
    while (match) {
      const [_, externalId, status] = match;
      claimsParsed.push({
        externalId,
        status,
      });
      match = regex.exec(content);
    }
    return claimsParsed;
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
      prio: adjusted,
      status: claim.status === 'pending' ? 'in_progress' : claim.status,
    };
    setClaims((prev) => prev.map((c) => (c.id === claim.id ? updated : c)));
    if (sel?.id === claim.id) setSel(updated);
    setTasks((prev) => [
      {
        id: Date.now(),
        claimId: claim.id,
        title: result.suggested_action_short,
        owner: result.who_should_work_it,
        status: 'open',
      },
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

  const handleUploadFiles = async (fileList) => {
    const files = Array.from(fileList);
    for (const file of files) {
      if (!file.name) continue;
      const content = await file.text();
      const type = detectEdiType(file.name, content);
      const uploadId = `${Date.now()}-${file.name}`;
      const baseUpload = {
        id: uploadId,
        name: file.name,
        type,
        receivedAt: new Date().toISOString(),
        status: 'received',
        warnings: [],
      };
      setUploads((prev) => [baseUpload, ...prev]);
      logAudit({
        action: 'Archivo recibido',
        claimId: 'INGEST',
        detail: `${file.name} (${type})`,
        source: 'system',
      });

      if (type === 'unknown') {
        setNeedsReview((prev) => [
          { id: uploadId, name: file.name, reason: 'Tipo no reconocido', receivedAt: baseUpload.receivedAt },
          ...prev,
        ]);
        setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'needs_review' } : u)));
        logAudit({
          action: 'Archivo requiere revisión',
          claimId: 'INGEST',
          detail: file.name,
          source: 'system',
        });
        continue;
      }

      setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'parsed' } : u)));
      const parsedClaims = type === '835' ? parse835(content) : parse277(content);
      if (!parsedClaims.length) {
        setNeedsReview((prev) => [
          { id: uploadId, name: file.name, reason: 'Sin datos reconocibles', receivedAt: baseUpload.receivedAt },
          ...prev,
        ]);
        setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'needs_review' } : u)));
        continue;
      }

      const createdDenials = [];
      const unmatchedItems = [];
      setClaims((prev) => {
        const updated = [...prev];
        parsedClaims.forEach((row) => {
          const existing = updated.find((c) => c.id === row.externalId);
          if (existing) {
            existing.amount = row.charged ? row.charged : existing.amount;
            existing.status = existing.status || 'pending';
            if (type === '277CA') {
              createdDenials.push(existing.id);
            }
            return;
          }
          if (type === '277CA') {
            unmatchedItems.push({
              id: row.externalId,
              suggestion: 'Revisar patient control number',
              reason: 'Claim no encontrado',
            });
            return;
          }
          const newClaim = {
            id: row.externalId,
            patient: demoMode ? 'Paciente Demo' : 'Paciente Nuevo',
            payer: 'Blue Cross',
            amount: row.charged || 1200,
            code: 'CO-11',
            reason: 'Dx inconsistente',
            status: 'pending',
            cpt: '99214',
            dx: 'E11.9',
            provider: 'Dr. Demo',
            facility: 'Main Clinic',
            submitted: date.toISOString().slice(0, 10),
            denied: date.toISOString().slice(0, 10),
            appeals: [],
          };
          updated.push({ ...newClaim, ...score(newClaim, date, rules) });
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

      setUploads((prev) => prev.map((u) => (u.id === uploadId ? { ...u, status: 'triaged' } : u)));
      logAudit({
        action: 'Archivo procesado',
        claimId: 'INGEST',
        detail: `${file.name} → ${type}`,
        source: 'system',
      });
    }
  };

  const downloadSample = (type) => {
    const content =
      type === '835'
        ? 'CLP*CLM-010*1*1250*950*300*12*12345*11~'
        : 'TRN*1*CLM-010*123456789~STC*A1:19*20240101*U*CO:16~';
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sample-${type}.txt`;
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

  const applyAppeal = (claim, appealEntry) => {
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
      action: 'Usuario generó apelación demo',
      claimId: claim.id,
      detail: appealEntry.id,
      source: 'user',
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
        detail: 'Fallback local',
        source: 'system',
        aiDecision: true,
        modelVersion: APPEAL_MODEL_VERSION,
        requestId: 'local-fallback',
        latencyMs: Math.round(performance.now() - startedAt),
        result: 'fallback',
      });
      return { text: fallbackText, meta: { ok: false, modelVersion: APPEAL_MODEL_VERSION, requestId: 'local-fallback' } };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicToken}`,
      },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      const fallbackText = `APELACIÓN ${claim.id}
Para: ${claim.payer}
Paciente: ${patientName}

[Fallback: servicio no disponible (${response.status}).]`;
      logAudit({
        action: 'Sistema intentó generar apelación',
        claimId: claim.id,
        detail: `Error ${response.status}`,
        source: 'system',
        aiDecision: true,
        modelVersion: APPEAL_MODEL_VERSION,
        requestId: `error-${response.status}`,
        latencyMs: Math.round(performance.now() - startedAt),
        result: 'error',
      });
      return { text: fallbackText, meta: { ok: false, modelVersion: APPEAL_MODEL_VERSION, requestId: `error-${response.status}` } };
    }

    const data = await response.json();
    const modelVersion = data.modelVersion || data.model || APPEAL_MODEL_VERSION;
    const requestId = data.requestId || data.id || `req-${Date.now()}`;
    logAudit({
      action: 'Sistema generó borrador de apelación',
      claimId: claim.id,
      detail: 'Generación OK',
      source: 'system',
      aiDecision: true,
      modelVersion,
      requestId,
      latencyMs: Math.round(performance.now() - startedAt),
      result: 'ok',
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

  const filtered = claims
    .filter(
      (c) =>
        ((c.patient.toLowerCase().includes(search.toLowerCase()) ||
          maskName(c.patient).toLowerCase().includes(search.toLowerCase()) ||
          c.id.toLowerCase().includes(search.toLowerCase())) &&
          (filter === 'all' || c.status === filter))
    )
    .sort((a, b) => b.prio - a.prio);

  const displayName = (claim) => (demoMode ? maskName(claim.patient) : claim.patient);

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
      title: '1. Cola priorizada',
      body: 'Aquí aparece el backlog ordenado por prioridad y probabilidad de recuperación.',
    },
    {
      id: 'denial-detail',
      title: '2. Detalle del denial',
      body: 'Al abrir un denial ves el monto, la razón y la acción sugerida.',
    },
    {
      id: 'tour-appeal',
      title: '3. Borrador de apelación',
      body: 'Genera un borrador demo con un clic y deja rastro en auditoría.',
    },
    {
      id: 'nav-audit',
      title: '4. Auditoría',
      body: 'Cada cambio queda registrado con usuario, hora y explicación.',
    },
    {
      id: 'nav-how',
      title: '5. Cómo funciona',
      body: 'Explica el flujo de punta a punta con palabras simples.',
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
      detail: 'Mostrando flujo completo',
      source: 'system',
    });
    updateStatus(top.id, 'in_progress');
    const appealEntry = {
      id: `APL-${Date.now().toString().slice(-4)}`,
      createdAt: new Date().toISOString(),
      status: 'submitted',
      summary: 'Apelación demo generada',
    };
    applyAppeal(top, appealEntry);
    logAudit({
      action: 'Recorrido rápido completado',
      claimId: top.id,
      detail: 'Estado y apelación actualizados',
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
            ['upload', Upload, 'Upload Center'],
            ['denials', AlertCircle, 'Denials'],
            ['unmatched', Users, 'Unmatched'],
            ['review', History, 'Needs Review'],
            ['payments', DollarSign, 'Pagos'],
            ['audit', History, 'Auditoría'],
            ['how', FileText, 'Cómo funciona'],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              id={`nav-${id}`}
              onClick={() => {
                setView(id);
                setSel(null);
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
              : view === 'upload'
                ? 'Upload Center'
                : view === 'denials'
                  ? 'Denials'
                  : view === 'unmatched'
                    ? 'Unmatched'
                    : view === 'review'
                      ? 'Needs Review'
                      : view === 'payments'
                        ? 'Pagos'
                        : view === 'how'
                          ? 'Cómo funciona'
                          : 'Auditoría'}
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
              <span>Demo PHI</span>
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
          {view === 'upload' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Upload Center</h2>
                <p className="text-slate-600 mt-1">
                  Sube archivos 277CA y 835. El sistema detecta, parsea y ejecuta triage IA.
                </p>
                <div className="mt-2 flex items-center gap-2">
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
                </div>
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Progreso de archivos</p>
                {uploads.length ? (
                  <div className="mt-2 space-y-2">
                    {uploads.map((u) => (
                      <div key={u.id} className="p-2 border rounded bg-slate-50">
                        <div className="flex justify-between">
                          <span className="font-medium">{u.name}</span>
                          <span className="text-slate-500">{u.type}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded ${u.status === 'received' ? 'bg-slate-200' : 'bg-emerald-100 text-emerald-700'}`}>
                            Recibido
                          </span>
                          <span className={`px-2 py-0.5 rounded ${u.status === 'parsed' || u.status === 'triaged' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200'}`}>
                            Parseado
                          </span>
                          <span className={`px-2 py-0.5 rounded ${u.status === 'triaged' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200'}`}>
                            Triage IA listo
                          </span>
                          {u.status === 'needs_review' ? <span className="text-red-600">Needs Review</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 mt-1">Sin archivos cargados todavía.</p>
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
              <div className={`${sel ? 'w-1/2' : 'w-full'} bg-white rounded border flex flex-col`}>
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
                <div className="flex-1 overflow-auto">
                  {filtered.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSel(c)}
                      className={`p-1.5 border-b cursor-pointer hover:bg-slate-50 ${
                        sel?.id === c.id ? 'bg-emerald-50 border-l-2 border-l-emerald-500' : ''
                      }`}
                    >
                      <div className="flex justify-between">
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
                          {statusBadge(c.status)}
                        </div>
                      </div>
                      <div className="ml-6 text-slate-500">
                        {c.payer} • <span className="text-red-600">{c.code}</span> •{' '}
                        <span className="text-emerald-600">{c.prob}%</span>
                      </div>
                    </div>
                  ))}
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
                        Sin triage IA todavía. Sube un 277CA/835 en Upload Center para generar sugerencias.
                      </div>
                    )}
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

          {view === 'review' && (
            <div className="bg-white rounded p-2 border">
              <div className="flex justify-between mb-2">
                <span className="font-semibold">Needs Review ({needsReview.length})</span>
                <span className="text-slate-400">Archivos sin parseo</span>
              </div>
              {needsReview.length ? (
                <div className="space-y-2">
                  {needsReview.map((item) => (
                    <div key={item.id} className="p-2 bg-slate-50 rounded flex justify-between items-center">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-slate-500 text-xs">{item.reason}</p>
                      </div>
                      <button
                        onClick={() => setNeedsReview((prev) => prev.filter((r) => r.id !== item.id))}
                        className="px-2 py-1 border rounded hover:bg-slate-100"
                      >
                        Marcar resuelto
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400">Sin archivos pendientes.</p>
              )}
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
                </div>
              ))}
            </div>
          )}

          {view === 'how' && (
            <div className="space-y-2">
              <div className="bg-white rounded p-2 border">
                <h2 className="font-semibold">Cómo funciona Denials Zero Desk</h2>
                <p className="text-slate-600 mt-1">
                  Flujo simple pensado para equipos no técnicos: cargar denials, priorizar, ejecutar acciones y dejar trazabilidad.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { title: '1. Llegada de denials', body: 'El equipo sube archivos o integra un envío diario. La cola se llena sola.' },
                  { title: '2. Priorización', body: 'El sistema ordena por monto, antigüedad y reglas del pagador.' },
                  { title: '3. Acción y apelación', body: 'Se aplican pasos sugeridos y se genera un borrador de apelación.' },
                ].map((card) => (
                  <div key={card.title} className="bg-white rounded p-2 border">
                    <p className="font-semibold">{card.title}</p>
                    <p className="text-slate-600 mt-1">{card.body}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded p-2 border">
                <p className="font-semibold">Piloto sin integraciones</p>
                <p className="text-slate-600 mt-1">
                  El cliente exporta archivos de su sistema y los sube manualmente. En minutos ve la cola priorizada y acciones sugeridas.
                </p>
                <p className="font-semibold mt-2">Producción con integración ligera</p>
                <p className="text-slate-600 mt-1">
                  Se automatiza el envío diario de archivos. El equipo sigue trabajando igual, solo que la cola se actualiza sola.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

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
