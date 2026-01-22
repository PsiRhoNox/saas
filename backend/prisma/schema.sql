-- Minimal schema for MVP ingestion
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
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
  last_denial_id UUID,
  last_payment_id UUID
);

CREATE TABLE denials (
  id UUID PRIMARY KEY,
  claim_id UUID REFERENCES claims(id),
  denial_code TEXT,
  denial_reason TEXT,
  denied_at TIMESTAMP,
  category TEXT
);

CREATE TABLE payments (
  id UUID PRIMARY KEY,
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
