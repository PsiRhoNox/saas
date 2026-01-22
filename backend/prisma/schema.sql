-- Minimal schema for MVP ingestion
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE payer_rules (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  payer_name TEXT NOT NULL,
  base_score NUMERIC NOT NULL,
  multiplier NUMERIC NOT NULL,
  active_from TIMESTAMP NOT NULL,
  active_to TIMESTAMP NOT NULL,
  CHECK (active_to > active_from),
  EXCLUDE USING GIST (tenant_id WITH =, payer_name WITH =, tsrange(active_from, active_to, '[]') WITH &&)
);

CREATE TABLE edi_files (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_path TEXT NOT NULL,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ingest_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  edi_file_id UUID REFERENCES edi_files(id),
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE claims (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  external_id TEXT NOT NULL,
  payer_claim_number TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL,
  last_denial_id UUID REFERENCES denials(id) ON DELETE SET NULL,
  last_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL
);

CREATE TABLE denials (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  claim_id UUID REFERENCES claims(id),
  denial_code TEXT,
  denial_reason TEXT,
  denied_at TIMESTAMP,
  category TEXT
);

CREATE TABLE payments (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  claim_id UUID REFERENCES claims(id),
  paid_amount NUMERIC,
  charged_amount NUMERIC,
  patient_responsibility NUMERIC
);

CREATE TABLE unmatched_items (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  file_id UUID REFERENCES edi_files(id),
  reason TEXT,
  suggestion TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  action TEXT,
  detail TEXT,
  before_state JSONB,
  after_state JSONB,
  source TEXT,
  request_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE patients (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  external_id TEXT,
  full_name TEXT
);

CREATE TABLE payers (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL
);

CREATE TABLE providers (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL
);

CREATE TABLE facilities (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email TEXT NOT NULL
);

CREATE TABLE templates (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  body TEXT
);

CREATE TABLE documents (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  storage_path TEXT
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE edi_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE denials ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON payer_rules
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON edi_files
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON ingest_runs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON claims
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON denials
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON payments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON unmatched_items
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON patients
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON payers
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON providers
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON facilities
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON templates
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
