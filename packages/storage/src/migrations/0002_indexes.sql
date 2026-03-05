CREATE INDEX IF NOT EXISTS idx_workflow_runs_queue
  ON workflow_runs(status, priority DESC, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_lease
  ON workflow_runs(status, lease_until);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
  ON workflow_runs(workflow_id, workflow_version);

CREATE INDEX IF NOT EXISTS idx_artifacts_run
  ON artifacts(run_id, name);

CREATE INDEX IF NOT EXISTS idx_events_type
  ON events(type, ts);
