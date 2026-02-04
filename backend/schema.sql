-- Minimal multi-tenant schema with RLS and append-only audit log.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id text,
  patient_control_number text,
  payer_claim_number text,
  tracking_number text,
  payer text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('pending', 'in_progress', 'appealed', 'resolved')),
  submitted_at date,
  denied_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  code text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  paid_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  title text NOT NULL,
  task_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done')),
  owner_role text NOT NULL,
  owner_name text NOT NULL,
  sla_days integer,
  due_date date,
  next_follow_up_at date,
  escalated_at timestamptz,
  escalation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claim_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('appeal_draft', 'resubmission_draft')),
  version integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, claim_id, doc_type, version)
);

CREATE TABLE claim_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  submission_type text NOT NULL CHECK (submission_type IN ('appeal', 'resubmission')),
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'awaiting_response', 'resolved')),
  evidence_reference text,
  evidence_url text,
  submitted_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playbook_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  title text NOT NULL
);

CREATE TABLE playbook_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  item_order integer NOT NULL,
  label text NOT NULL
);

CREATE TABLE claim_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  label text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sftp_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  host text NOT NULL,
  username text NOT NULL,
  private_key text NOT NULL,
  remote_path text NOT NULL,
  file_pattern text NOT NULL DEFAULT '*.txt',
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'active',
  last_pull_at timestamptz,
  last_file_name text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sftp_poll_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES sftp_integrations(id) ON DELETE CASCADE,
  status text NOT NULL,
  files_fetched integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payer text NOT NULL,
  cpt_code text,
  expected_percent numeric(5, 2) NOT NULL,
  effective_start date NOT NULL,
  effective_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_terms_lite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payer text NOT NULL,
  expected_percent numeric(5, 2) NOT NULL,
  effective_start date NOT NULL,
  effective_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_term_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payer text NOT NULL,
  cpt_code text NOT NULL,
  expected_percent numeric(5, 2) NOT NULL,
  effective_start date NOT NULL,
  effective_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE underpayment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  payer text NOT NULL,
  expected_amount numeric(12, 2),
  actual_paid_amount numeric(12, 2) NOT NULL,
  variance_amount numeric(12, 2) NOT NULL,
  cas_group_code text,
  cas_reason_code text,
  status text NOT NULL DEFAULT 'open',
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  created_by uuid REFERENCES users(id),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE edi_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ingest_run_id uuid NOT NULL REFERENCES ingest_runs(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  checksum text NOT NULL,
  storage_path text NOT NULL,
  detected_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX edi_files_tenant_checksum_idx ON edi_files (tenant_id, checksum);

CREATE TABLE ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_key)
);

CREATE TABLE unmatched_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ingest_run_id uuid REFERENCES ingest_runs(id) ON DELETE CASCADE,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  detail text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit log.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- RLS configuration
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE denials ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_terms_lite ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_term_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE underpayment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE sftp_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sftp_poll_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE edi_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_sessions ON sessions USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_claims ON claims USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_denials ON denials USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_payments ON payments USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_tasks ON tasks USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_documents ON documents USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_claim_documents ON claim_documents USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_claim_submissions ON claim_submissions USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_payer_rules ON payer_rules USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_contract_terms ON contract_terms_lite USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_contract_overrides ON contract_term_overrides USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_underpayments ON underpayment_items USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_playbooks ON playbooks USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_playbook_steps ON playbook_steps USING (playbook_id IN (SELECT id FROM playbooks WHERE tenant_id = current_setting('app.tenant_id')::uuid));
CREATE POLICY tenant_isolation_playbook_checklists ON playbook_checklists USING (playbook_id IN (SELECT id FROM playbooks WHERE tenant_id = current_setting('app.tenant_id')::uuid));
CREATE POLICY tenant_isolation_claim_checklists ON claim_checklists USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_sftp_integrations ON sftp_integrations USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_sftp_poll_logs ON sftp_poll_logs USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_ingest_runs ON ingest_runs USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_edi_files ON edi_files USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_ingest_events ON ingest_events USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_unmatched ON unmatched_items USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_audit ON audit_log USING (tenant_id = current_setting('app.tenant_id')::uuid);
