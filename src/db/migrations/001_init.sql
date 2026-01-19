-- OwnKey CLI Initial Schema Migration
-- Version: 001
-- Description: Create all initial tables for OwnKey CLI

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  summary TEXT,
  started_at TIMESTAMP DEFAULT NOW() NOT NULL,
  finished_at TIMESTAMP
);

-- Suggestions table
CREATE TABLE IF NOT EXISTS suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'security', 'performance', 'refactor', 'style', 'architecture', 'test', 'documentation')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  content TEXT NOT NULL,
  diff TEXT NOT NULL,
  file_path TEXT NOT NULL,
  rationale TEXT NOT NULL,
  tags JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Suggestion history table
CREATE TABLE IF NOT EXISTS suggestion_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('applied', 'rejected', 'undone')),
  details TEXT,
  acted_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Run suggestions junction table
CREATE TABLE IF NOT EXISTS run_suggestions (
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, suggestion_id)
);

-- User API keys table (fingerprints only)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  added_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Schema migrations table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_project_id ON suggestions(project_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_type ON suggestions(type);
CREATE INDEX IF NOT EXISTS idx_suggestions_severity ON suggestions(severity);
CREATE INDEX IF NOT EXISTS idx_suggestion_history_suggestion_id ON suggestion_history(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_project_id ON user_api_keys(project_id);

-- Insert migration record
INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;
