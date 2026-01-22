-- Migration: Add applies table for tracking applied suggestions
-- Version: 002

CREATE TABLE IF NOT EXISTS applies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL,
    files_modified JSONB NOT NULL,
    backup_id TEXT,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'rolled_back')),
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_applies_suggestion_id ON applies(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_applies_applied_at ON applies(applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_applies_status ON applies(status);

-- Add foreign key if suggestions table exists
-- Note: This will fail gracefully if suggestions table doesn't exist yet
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suggestions') THEN
        ALTER TABLE applies 
        ADD CONSTRAINT fk_applies_suggestion 
        FOREIGN KEY (suggestion_id) 
        REFERENCES suggestions(id) 
        ON DELETE CASCADE;
    END IF;
END $$;
