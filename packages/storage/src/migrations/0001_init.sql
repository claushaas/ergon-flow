CREATE TABLE IF NOT EXISTS workflows (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  description TEXT,
  source_path TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  hostname TEXT,
  pid INTEGER,
  started_at TEXT NOT NULL,
  last_beat_at TEXT NOT NULL,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  workflow_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL,
  claimed_by TEXT,
  lease_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  current_step_id TEXT,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  inputs_json TEXT NOT NULL,
  context_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  error_detail_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflows(id, version)
);

CREATE TABLE IF NOT EXISTS step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  depends_on_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  request_json TEXT,
  response_json TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  error_detail_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, step_id, attempt)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  mime TEXT,
  path TEXT NOT NULL,
  size_bytes INTEGER,
  sha256 TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_run_id TEXT,
  type TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id) REFERENCES step_runs(id) ON DELETE SET NULL,
  UNIQUE(run_id, seq)
);
