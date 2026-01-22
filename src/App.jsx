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
  Users,
  X,
  Zap,
} from 'lucide-react';

const STORAGE_KEY = 'denialsZeroDesk';
const STORAGE_VERSION = 1;
const SCORING_VERSION = 'v1.2';

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
    aiDecision: source === 'system',
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

  useEffect(() => {
    const stored = getStoredState();
    if (stored) {
      setRules(stored.rules || defaultRules);
      setStats(stored.stats || { proc: 0, app: 0 });
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
  }, []);

  useEffect(() => {
    if (!claims.length) return;
    const rescored = claims.map((c) => ({ ...c, ...score(c, date, rules) }));
    setClaims(rescored);
    if (sel) {
      const refreshed = rescored.find((c) => c.id === sel.id);
      if (refreshed) setSel(refreshed);
    }
  }, [date]);

  useEffect(() => {
    if (!claims.length) return;
    persistState({
      version: STORAGE_VERSION,
      claims,
      audit,
      stats,
      date: date.toISOString(),
      rules,
    });
  }, [claims, audit, stats, date, rules]);

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

  const logAudit = ({ action, claimId, detail, source, before, after, scoring }) => {
    const entry = buildAuditEntry({
      action,
      claimId,
      detail,
      source,
      before,
      after,
      scoring,
      simDate: date.toLocaleDateString(),
    });
    setAudit((prev) => [entry, ...prev]);
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
      action: `Estado→${status}`,
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
      action: 'Apelación generada',
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
    const apiKey = import.meta.env.VITE_APPEAL_API_KEY;
    if (!apiUrl || !apiKey) {
      return `APELACIÓN ${claim.id}
Para: ${claim.payer}
Paciente: ${claim.patient}
Proveedor: ${claim.provider}
CPT: ${claim.cpt} | Dx: ${claim.dx}
Monto: $${claim.amount}
Denial: ${claim.code} - ${claim.reason}
Acción: ${claim.action}
Prob: ${claim.prob}%

[Modo demo: agrega una API key para generar texto real.]`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        claimId: claim.id,
        payer: claim.payer,
        patient: claim.patient,
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
      return `APELACIÓN ${claim.id}
Para: ${claim.payer}
Paciente: ${claim.patient}

[Fallback: servicio no disponible (${response.status}).]`;
    }

    const data = await response.json();
    return data.text || data.appeal || data.message || 'Respuesta vacía del modelo.';
  };

  const openAppealModal = async (claim) => {
    const appealText = await generateAppeal(claim);
    setAppeal(appealText);
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
      action: 'Día+1',
      claimId: 'SYS',
      detail: next.toLocaleDateString(),
      source: 'system',
      before: { simDate: date.toLocaleDateString() },
      after: { simDate: next.toLocaleDateString() },
    });
  };

  const filtered = claims
    .filter(
      (c) =>
        (c.patient.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase())) &&
        (filter === 'all' || c.status === filter)
    )
    .sort((a, b) => b.prio - a.prio);

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
            ['denials', AlertCircle, 'Denials'],
            ['payments', DollarSign, 'Pagos'],
            ['audit', History, 'Auditoría'],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
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
            {view === 'dashboard' ? 'Dashboard' : view === 'denials' ? 'Denials' : view === 'payments' ? 'Pagos' : 'Auditoría'}
          </span>
          <div className="flex items-center gap-2">
            <span className="bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {date.toLocaleDateString()}
              <button onClick={advanceDay} className="hover:bg-slate-200 rounded p-0.5">
                <RefreshCw className="w-3 h-3" />
              </button>
            </span>
            <Bell className="w-3 h-3 text-slate-400" />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-2">
          {view === 'dashboard' && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1">
                {[
                  ['Total', metrics.total],
                  ['Hi-Prio', metrics.highPrio],
                  ['$Pend', `$${(metrics.amount / 1000).toFixed(0)}K`],
                  ['Prob%', `${metrics.avgProb}%`],
                  ['Proc', stats.proc],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded p-1.5 border text-center">
                    <p className="text-slate-500">{label}</p>
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
                            <p className="font-medium">{c.patient}</p>
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
                          patient: c.patient,
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
                            <p className="font-medium">{c.patient}</p>
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
                  <div className="flex-1 overflow-auto p-2 space-y-2">
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
                        ['Paciente', sel.patient],
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
                    <div className="p-1.5 bg-slate-50 rounded">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">Scoring</p>
                        <span className="text-slate-400">{sel.scoringVersion}</span>
                      </div>
                      <p className="text-slate-600">
                        Días: {sel.inputs.days} | Amt: {sel.inputs.amt} | Age: {sel.inputs.age} | Pen:{' '}
                        {sel.inputs.pen}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
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
                          <p className="text-slate-500">{c.patient}</p>
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
                </div>
              ))}
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
    </div>
  );
}
