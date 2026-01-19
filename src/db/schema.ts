import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Projects table
export const projects = pgTable('projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Runs table
export const runs = pgTable('runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id)
        .notNull(),
    command: text('command').notNull(),
    status: text('status').notNull(), // 'running' | 'completed' | 'failed'
    summary: text('summary'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
});

// Suggestions table
export const suggestions = pgTable('suggestions', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
        .references(() => projects.id)
        .notNull(),
    type: text('type').notNull(), // 'bug' | 'security' | 'performance' | etc.
    severity: text('severity').notNull(), // 'critical' | 'high' | 'medium' | 'low' | 'info'
    content: text('content').notNull(),
    diff: text('diff').notNull(),
    filePath: text('file_path').notNull(),
    rationale: text('rationale').notNull(),
    tags: jsonb('tags'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Suggestion history table
export const suggestionHistory = pgTable('suggestion_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    suggestionId: uuid('suggestion_id')
        .references(() => suggestions.id)
        .notNull(),
    action: text('action').notNull(), // 'applied' | 'rejected' | 'undone'
    details: text('details'),
    actedAt: timestamp('acted_at').defaultNow().notNull(),
});

// Run suggestions junction table
export const runSuggestions = pgTable('run_suggestions', {
    runId: uuid('run_id')
        .references(() => runs.id)
        .notNull(),
    suggestionId: uuid('suggestion_id')
        .references(() => suggestions.id)
        .notNull(),
});

// User API keys table (for fingerprints only)
export const userApiKeys = pgTable('user_api_keys', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id),
    provider: text('provider').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    addedAt: timestamp('added_at').defaultNow().notNull(),
});

// Schema migrations table
export const schemaMigrations = pgTable('schema_migrations', {
    version: integer('version').primaryKey(),
    appliedAt: timestamp('applied_at').defaultNow().notNull(),
});

// Relations
export const projectsRelations = relations(projects, ({ many }) => ({
    runs: many(runs),
    suggestions: many(suggestions),
    apiKeys: many(userApiKeys),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
    project: one(projects, {
        fields: [runs.projectId],
        references: [projects.id],
    }),
    runSuggestions: many(runSuggestions),
}));

export const suggestionsRelations = relations(suggestions, ({ one, many }) => ({
    project: one(projects, {
        fields: [suggestions.projectId],
        references: [projects.id],
    }),
    history: many(suggestionHistory),
    runSuggestions: many(runSuggestions),
}));

export const suggestionHistoryRelations = relations(suggestionHistory, ({ one }) => ({
    suggestion: one(suggestions, {
        fields: [suggestionHistory.suggestionId],
        references: [suggestions.id],
    }),
}));

export const runSuggestionsRelations = relations(runSuggestions, ({ one }) => ({
    run: one(runs, {
        fields: [runSuggestions.runId],
        references: [runs.id],
    }),
    suggestion: one(suggestions, {
        fields: [runSuggestions.suggestionId],
        references: [suggestions.id],
    }),
}));
