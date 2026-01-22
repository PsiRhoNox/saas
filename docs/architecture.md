# Arquitectura Técnica: Denials Zero Desk
## Sistema de Automatización RCM para Proveedores de Salud

**Versión:** 1.1  
**Fecha:** Enero 2024  
**Objetivo:** Reducir denials 20-35%, reducir días A/R 10-18 días, reducir costo/claim 15-25%

---

## 1. Stack Tecnológico Recomendado

### Backend
| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| API Principal | **Node.js + NestJS** | Tipado fuerte, modular, excelente para microservicios |
| Base de Datos | **PostgreSQL** | ACID compliance crítico para datos financieros/médicos |
| Cache | **Redis** | Sessions, colas, cache de reglas por pagador |
| Colas/Workers | **BullMQ** | Job scheduling, reintentos, dead letter queues |
| Search | **Elasticsearch** | Búsqueda full-text en claims, audit logs |
| File Storage | **S3 + MinIO** | Documentos adjuntos, EDI files, exports |

### Frontend
| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Web App | **React + TypeScript** | Ya validado en prototipo |
| State | **Zustand** | Ligero, simple, escalable |
| UI | **Tailwind + shadcn/ui** | Consistencia, accesibilidad |
| Charts | **Recharts** | Dashboards de métricas |

### Infraestructura
| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| Cloud | **AWS** | HIPAA eligible, BAA disponible |
| Containers | **ECS Fargate** | Serverless containers, auto-scaling |
| CI/CD | **GitHub Actions** | Integración directa con repo |
| Monitoring | **Datadog** | APM, logs, métricas, HIPAA compliant |
| Secrets | **AWS Secrets Manager** | Rotación automática de keys |

---

## 2. Modelo de Datos (Single Source of Truth)

### 2.1 Principios
- `claims` guarda el estado financiero/operativo del claim (status + substatus).
- `denials` es una entidad separada para cada evento de denegación.
- `payments` es la entidad de pago, referenciada por claim.
- Todas las tablas multi-tenant incluyen `tenant_id` y están cubiertas por RLS.
- `claims` mantiene punteros al último denial y pago para lectura rápida.

### 2.2 Schema Principal (PostgreSQL)

```sql
CREATE TYPE claim_status AS ENUM (
  'submitted', 'acknowledged', 'pending', 'denied',
  'in_review', 'appealed', 'appeal_pending',
  'paid', 'partial_paid', 'adjusted', 'voided'
);

-- Claims (núcleo del sistema)
CREATE TABLE claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  external_id VARCHAR(50) NOT NULL,
  patient_id UUID REFERENCES patients(id),
  payer_id UUID REFERENCES payers(id),
  provider_id UUID REFERENCES providers(id),
  facility_id UUID REFERENCES facilities(id),

  -- Financiero
  billed_amount DECIMAL(12,2) NOT NULL,
  allowed_amount DECIMAL(12,2),
  paid_amount DECIMAL(12,2) DEFAULT 0,
  patient_responsibility DECIMAL(12,2) DEFAULT 0,

  -- Códigos
  cpt_codes JSONB NOT NULL, -- [{code, modifier, units, amount}]
  diagnosis_codes VARCHAR(10)[] NOT NULL,
  place_of_service VARCHAR(2),

  -- Fechas
  service_date DATE NOT NULL,
  submitted_date TIMESTAMP,
  submitted_via VARCHAR(20),
  tracking_number VARCHAR(100),

  -- Estado operativo
  status claim_status NOT NULL DEFAULT 'submitted',
  substatus VARCHAR(50),

  -- Últimos eventos (pointers)
  last_denial_id UUID REFERENCES denials(id) ON DELETE SET NULL,
  last_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,

  -- Scoring (calculado)
  priority_score INTEGER,
  recovery_probability DECIMAL(5,2),
  suggested_action TEXT,
  scoring_inputs JSONB,
  scoring_version VARCHAR(10),
  last_scored_at TIMESTAMP,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  CONSTRAINT unique_external_claim UNIQUE(external_id, payer_id, tenant_id)
);

-- Denials (uno por cada denegación de un claim)
CREATE TABLE denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  claim_id UUID REFERENCES claims(id) NOT NULL,

  denial_code VARCHAR(20) NOT NULL,
  denial_reason TEXT,
  denial_category VARCHAR(50),
  remark_codes VARCHAR(10)[],

  denied_amount DECIMAL(12,2) NOT NULL,
  denied_date TIMESTAMP NOT NULL,

  -- Resolución
  resolution_status VARCHAR(20) DEFAULT 'open',
  resolution_date TIMESTAMP,
  resolution_amount DECIMAL(12,2),
  resolution_notes TEXT,

  -- Tracking
  assigned_to UUID REFERENCES users(id),
  due_date DATE,
  escalation_level INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Payments (ERA 835 y pagos manuales)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  claim_id UUID REFERENCES claims(id),

  payment_type VARCHAR(20) NOT NULL,
  check_number VARCHAR(50),
  eft_trace VARCHAR(50),

  payment_date DATE NOT NULL,
  payment_amount DECIMAL(12,2) NOT NULL,

  era_file_id UUID REFERENCES edi_files(id),
  payer_claim_number VARCHAR(50),

  adjustments JSONB,

  reconciled BOOLEAN DEFAULT FALSE,
  reconciled_at TIMESTAMP,
  reconciled_by UUID,
  variance_amount DECIMAL(12,2),
  variance_reason TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Payer Rules (configuración por pagador)
CREATE TABLE payer_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  payer_id UUID REFERENCES payers(id) NOT NULL,

  base_priority INTEGER DEFAULT 5,
  risk_multiplier DECIMAL(4,2) DEFAULT 1.0,

  timely_filing_days INTEGER DEFAULT 90,
  appeal_window_days INTEGER DEFAULT 60,
  second_appeal_days INTEGER DEFAULT 30,

  auto_retry_enabled BOOLEAN DEFAULT TRUE,
  auto_retry_days INTEGER DEFAULT 7,
  auto_escalate_days INTEGER DEFAULT 14,

  denial_rules JSONB,

  appeal_template_id UUID,

  effective_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log (inmutable, append-only)
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,

  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,

  action VARCHAR(50) NOT NULL,
  action_category VARCHAR(20),

  before_state JSONB,
  after_state JSONB,
  changed_fields TEXT[],

  reason TEXT,
  source VARCHAR(20) NOT NULL,

  ai_decision BOOLEAN DEFAULT FALSE,
  ai_model_version VARCHAR(20),
  ai_inputs JSONB,
  ai_confidence DECIMAL(5,2),
  ai_explanation TEXT,

  user_id UUID,
  user_role VARCHAR(50),
  session_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_tenant_date ON audit_log(tenant_id, created_at DESC);
```

**Nota operativa:** la actualización de `last_denial_id` y `last_payment_id` debe estar centralizada en el servicio de ingestión (277CA/835) para evitar inconsistencias.

### 2.3 Versionado de payer_rules (no solapamiento)

Para asegurar una única regla activa por pagador y tenant en cada fecha, se recomienda un constraint por rango:

```sql
ALTER TABLE payer_rules
  ADD CONSTRAINT payer_rules_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    payer_id WITH =,
    daterange(effective_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
  );
```

### 2.4 Estado del Claim (State Machine)

```
submitted → acknowledged → pending → denied → in_review → appealed
                              ↓           ↓         ↓
                            paid    appeal_pending  paid
                              ↓           ↓
                        partial_paid   denied (final)
```

---

## 3. APIs y Contratos

### 3.1 Endpoints Principales

```yaml
POST   /api/v1/claims/ingest          # Bulk ingest desde EDI/FHIR
GET    /api/v1/claims                 # Lista con filtros y paginación
GET    /api/v1/claims/:id             # Detalle con scoring
PATCH  /api/v1/claims/:id/status      # Cambio de estado
POST   /api/v1/claims/:id/rescore     # Forzar recálculo de scoring

GET    /api/v1/denials                # Cola priorizada
GET    /api/v1/denials/:id            # Detalle con historia
POST   /api/v1/denials/:id/assign     # Asignar a usuario
POST   /api/v1/denials/:id/escalate   # Escalar

POST   /api/v1/appeals/generate       # Generar con AI
GET    /api/v1/appeals/:id            # Detalle
POST   /api/v1/appeals/:id/submit     # Marcar como enviada
PATCH  /api/v1/appeals/:id/response   # Registrar respuesta

POST   /api/v1/payments/ingest-era    # Procesar ERA 835
GET    /api/v1/payments               # Lista
POST   /api/v1/payments/reconcile     # Reconciliar batch

GET    /api/v1/analytics/dashboard    # Métricas agregadas
GET    /api/v1/analytics/trends       # Tendencias temporales
GET    /api/v1/analytics/payer/:id    # Métricas por pagador

GET    /api/v1/audit                  # Trail con filtros
GET    /api/v1/audit/export           # Export para compliance
```

### 3.2 Contrato de Respuesta - Denial Detail

```typescript
interface DenialDetailResponse {
  id: string;
  claim: {
    id: string;
    externalId: string;
    patient: { id: string; name: string; dob: string; mrn: string; };
    payer: { id: string; name: string; payerId: string; };
    provider: { id: string; name: string; npi: string; };
    facility: { id: string; name: string; };
    billedAmount: number;
    serviceDate: string;
    cptCodes: Array<{ code: string; modifier?: string; amount: number; }>;
    diagnosisCodes: string[];
  };
  denial: {
    code: string;
    reason: string;
    category: string;
    deniedAmount: number;
    deniedDate: string;
    remarkCodes: string[];
  };
  scoring: {
    priority: number;
    recoveryProbability: number;
    suggestedAction: string;
    inputs: {
      daysOld: number;
      amountFactor: number;
      agingFactor: number;
      payerBasePriority: number;
      denialCodeBoost: number;
      statusPenalty: number;
    };
    version: string;
    calculatedAt: string;
  };
  workflow: {
    status: string;
    assignedTo?: { id: string; name: string; };
    dueDate?: string;
    escalationLevel: number;
    lastActionAt: string;
    lastActionBy: string;
  };
  appeals: Array<{
    id: string;
    type: string;
    status: string;
    submittedDate?: string;
    responseDate?: string;
    responseStatus?: string;
  }>;
  auditTrail: Array<{
    action: string;
    timestamp: string;
    user: string;
    source: string;
    details?: string;
  }>;
}
```

---

## 4. Flujo EDI (837/835/277CA/999)

### 4.1 Mapeo de Transacciones

| EDI | Dirección | Propósito | Mapeo Interno |
|-----|-----------|-----------|---------------|
| **837P/I** | Salida | Claim submission | `claims` → generar |
| **999** | Entrada | Acknowledgment | `claims.status` → acknowledged |
| **277CA** | Entrada | Claim status | `claims.status`, `denials` |
| **835** | Entrada | Payment/ERA | `payments`, `denials.resolution` |

### 4.2 Pipeline de Ingestion

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Clearinghouse│────▶│  SFTP/API   │────▶│  EDI Parser │────▶│  Normalizer │
│  (Availity,  │     │  Receiver   │     │  (Stedi/    │     │             │
│   Change,    │     │             │     │   Custom)   │     │             │
│   Trizetto)  │     └─────────────┘     └─────────────┘     └──────┬──────┘
└─────────────┘                                                     │
                                                                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Scoring   │◀────│   Matcher   │◀────│  Validator  │◀────│   Queue     │
│   Engine    │     │ (claim ↔    │     │  (schema,   │     │  (BullMQ)   │
│             │     │  payment)   │     │   business) │     │             │
└──────┬──────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│  Database   │────▶│   Audit     │
│  (claims,   │     │   Log       │
│   denials)  │     │             │
└─────────────┘     └─────────────┘
```

### 4.3 Parsing 835 (ERA) - Campos Críticos

```typescript
interface ERA835Parsed {
  senderId: string;
  receiverId: string;
  transactionDate: string;

  paymentMethod: 'CHK' | 'ACH' | 'NON';
  paymentAmount: number;
  paymentDate: string;
  checkNumber?: string;
  eftTraceNumber?: string;

  payerName: string;
  payerId: string;

  claims: Array<{
    patientControlNumber: string;
    claimStatus: '1' | '2' | '3' | '4' | '19' | '20' | '21' | '22';
    chargedAmount: number;
    paidAmount: number;
    patientResponsibility: number;
    payerClaimNumber: string;

    serviceLines: Array<{
      procedureCode: string;
      chargedAmount: number;
      paidAmount: number;
      quantity: number;
      adjustments: Array<{
        groupCode: 'CO' | 'PR' | 'OA' | 'PI' | 'CR';
        reasonCode: string;
        amount: number;
      }>;
    }>;
  }>;
}
```

---

## 5. Motor de Colas y Workers

### 5.1 Queues Definidas

```typescript
export const QUEUES = {
  EDI_INGEST: 'edi:ingest',
  FHIR_SYNC: 'fhir:sync',

  CLAIM_SCORE: 'claim:score',
  BATCH_RESCORE: 'claim:batch-score',

  DENIAL_ASSIGN: 'denial:assign',
  DENIAL_ESCALATE: 'denial:escalate',
  DENIAL_RETRY: 'denial:retry',

  APPEAL_GENERATE: 'appeal:generate',
  APPEAL_SUBMIT: 'appeal:submit',

  PAYMENT_MATCH: 'payment:match',
  PAYMENT_POST: 'payment:post',

  NOTIFY_USER: 'notify:user',
  NOTIFY_ESCALATION: 'notify:escalate',

  REPORT_GENERATE: 'report:generate',
  EXPORT_AUDIT: 'export:audit',
};
```

### 5.2 Worker de Scoring

```typescript
const worker = new Worker<ScoreJobData>('claim:score', async (job: Job) => {
  const { claimId, trigger, userId } = job.data;

  const claim = await ClaimService.getWithRelations(claimId);
  if (!claim) throw new Error(`Claim ${claimId} not found`);

  const payerRules = await PayerRulesService.getActive(claim.payerId);

  const previousScore = {
    priority: claim.priorityScore,
    recoveryProbability: claim.recoveryProbability,
  };

  const newScore = ScoringEngine.calculate({
    claim,
    payerRules,
    denialCode: claim.latestDenial?.denialCode,
    daysOld: calculateDaysOld(claim.latestDenial?.deniedDate),
  });

  await ClaimService.updateScore(claimId, {
    priorityScore: newScore.priority,
    recoveryProbability: newScore.recoveryProbability,
    suggestedAction: newScore.suggestedAction,
    scoringInputs: newScore.inputs,
    scoringVersion: ScoringEngine.VERSION,
    lastScoredAt: new Date(),
  });

  await AuditService.log({
    entityType: 'claim',
    entityId: claimId,
    action: 'score_calculated',
    source: trigger === 'manual' ? 'user' : 'system',
    userId,
    beforeState: previousScore,
    afterState: {
      priority: newScore.priority,
      recoveryProbability: newScore.recoveryProbability,
    },
    aiDecision: true,
    aiModelVersion: ScoringEngine.VERSION,
    aiInputs: newScore.inputs,
    aiConfidence: newScore.confidence,
    aiExplanation: newScore.explanation,
  });

  if (newScore.priority >= 90 && claim.status === 'denied') {
    await AutoActionService.checkAndExecute(claim, newScore);
  }

  return { claimId, newScore };
});
```

---

## 6. Servicio de Apelaciones

### 6.1 Generación con AI

```typescript
interface AppealGenerationRequest {
  denialId: string;
  templateId?: string;
  additionalContext?: string;
  userId: string;
}

interface AppealGenerationResult {
  appealText: string;
  confidence: number;
  suggestedAttachments: string[];
  warnings: string[];
  modelVersion: string;
}
```

---

## 7. Reconciliación de Pagos

### 7.1 Estados de Reconciliación

```
ERA Received → Parsed → Matched → Posted → Reconciled
                 ↓         ↓
              Invalid   Unmatched → Manual Review → Matched/Written Off
```

---

## 8. Compliance y Seguridad (HIPAA)

### 8.1 RBAC (Role-Based Access Control)

```typescript
export const ROLES = {
  ADMIN: {
    permissions: ['*', 'phi:full'],
  },
  RCM_MANAGER: {
    permissions: [
      'claims:read', 'claims:update',
      'denials:read', 'denials:update', 'denials:assign',
      'appeals:read', 'appeals:create', 'appeals:update',
      'payments:read',
      'analytics:read',
      'audit:read',
      'users:read',
      'rules:read', 'rules:update',
      'phi:full',
    ],
  },
  RCM_SPECIALIST: {
    permissions: [
      'claims:read',
      'denials:read', 'denials:update',
      'appeals:read', 'appeals:create',
      'payments:read',
      'analytics:read',
    ],
  },
  AUDITOR: {
    permissions: [
      'claims:read',
      'denials:read',
      'appeals:read',
      'payments:read',
      'analytics:read',
      'audit:read', 'audit:export',
    ],
  },
  API_SERVICE: {
    permissions: [
      'claims:create', 'claims:read',
      'payments:create',
    ],
  },
};
```

### 8.2 PHI Handling

```typescript
const PHI_FIELDS = [
  'patient.name', 'patient.dob', 'patient.ssn',
  'patient.address', 'patient.phone', 'patient.email',
  'patient.mrn',
];

function maskPHI(data: any, userRole: string): any {
  if (ROLES[userRole]?.permissions.includes('phi:full')) {
    return data;
  }

  const masked = { ...data };
  for (const field of PHI_FIELDS) {
    const value = get(masked, field);
    if (value) {
      set(masked, field, maskValue(value, field));
    }
  }
  return masked;
}
```

### 8.3 Encryption

```yaml
Database: AWS RDS with AES-256 encryption
S3 Buckets: SSE-S3 or SSE-KMS
Redis: In-transit encryption enabled

APIs: TLS 1.3 only
Internal services: mTLS
Database connections: SSL required

AWS KMS for encryption keys
Automatic key rotation (90 days)
Separate keys per tenant
```

### 8.4 Audit Log Retention

```typescript
const RETENTION = {
  AUDIT_LOGS: '7 years',
  CLAIMS_DATA: '10 years',
  APPEAL_LETTERS: '10 years',
  ERA_FILES: '7 years',
  SESSION_LOGS: '90 days',
  TEMP_FILES: '24 hours',
};
```

---

## 9. Multi-Tenant Architecture

```sql
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE denials ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_claims ON claims
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_denials ON denials
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_payments ON payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_rules ON payer_rules
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_audit ON audit_log
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Nota:** En ambientes con connection pooling, el `tenant_id` debe setearse dentro de una transacción por request para evitar leakage.

### 9.1 Tablas relacionadas con RLS
Todas las tablas referenciadas deben incluir `tenant_id` + policy RLS: `patients`, `payers`, `providers`, `facilities`, `users`, `edi_files`, `templates`, `documents`.

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE edi_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
```

---  

## 10. Índices recomendados (performance)

```sql
CREATE INDEX idx_claims_tenant_status ON claims(tenant_id, status);
CREATE INDEX idx_denials_tenant_resolution ON denials(tenant_id, resolution_status);
CREATE INDEX idx_denials_due_date ON denials(tenant_id, due_date);
CREATE INDEX idx_payments_tenant_date ON payments(tenant_id, payment_date);
```

---

## 11. Plan de Despliegue por Fases

### Fase 1: MVP (Semanas 1-6)
**Objetivo:** Demo vendible con 1 clearinghouse y 2 pagadores.

| Entregable | Semana | Owner |
|------------|--------|-------|
| DB schema + migrations | 1 | Backend |
| Auth + RBAC básico | 1-2 | Backend |
| Claims CRUD API | 2 | Backend |
| Dashboard UI (del prototipo) | 2-3 | Frontend |
| Scoring engine v1 | 3 | Backend |
| Integración 1 clearinghouse (Availity) | 3-4 | Integration |
| Parser 835 básico | 4 | Backend |
| Generación de apelaciones (Claude) | 5 | Backend |
| Testing E2E | 5-6 | QA |
| Deploy staging | 6 | DevOps |

### Fase 2: Production-Ready (Semanas 7-12)
**Objetivo:** Primer cliente en producción.

| Entregable | Semana | Owner |
|------------|--------|-------|
| Multi-tenant completo | 7-8 | Backend |
| HIPAA compliance audit | 7-8 | Security |
| 277CA parser | 8 | Backend |
| Reconciliación de pagos | 9 | Backend |
| Workers + queues | 9-10 | Backend |
| Alertas y notificaciones | 10 | Full-stack |
| Reportes básicos | 11 | Full-stack |
| Load testing | 11 | QA |
| Production deploy | 12 | DevOps |

### Fase 3: Scale (Semanas 13-20)
**Objetivo:** 5+ clientes, 10+ pagadores.

| Entregable | Semana | Owner |
|------------|--------|-------|
| 3 clearinghouses adicionales | 13-15 | Integration |
| Optimización de scoring v2 | 14-16 | Data |
| Auto-acciones avanzadas | 15-17 | Backend |
| Data warehouse + BI | 17-19 | Data |
| SOC 2 Type 2 | 18-20 | Security |

---

## 12. Apéndice: Notas de Handoff
- Mantener `claims.status` como fuente de verdad del workflow.
- `denials` es histórico por evento; no duplicar estado del claim allí.
- Las reglas por pagador deben versionarse para auditoría.
- Toda acción que afecte scoring debe generar audit con before/after + inputs.
