// Which tables a backup contains, in restore order (parents before children), and how each is
// scoped to one user (DATABASE §5, AGENTS rule 8). tests/verify_schema.py checks this list against
// the migrations: every user table present, every foreign-key parent listed earlier.
//
// Not exported: passages_fts (rebuilt on restore), and the system tables backups, schema_meta and
// allowed_emails (the app-wide sign-in list from Settings → People, which isn't one person's study data).

export type ExportTable = {
  name: string;
  /** SQL WHERE clause selecting this user's rows; `?1` is the user id. */
  scope: string;
};

const viaParent = (col: string, parent: string, parentScope = 'user_id = ?1') =>
  `${col} IN (SELECT id FROM ${parent} WHERE ${parentScope})`;

export const EXPORT_TABLES: readonly ExportTable[] = [
  { name: 'users', scope: 'id = ?1' },
  { name: 'user_emails', scope: 'user_id = ?1' },
  { name: 'settings', scope: 'user_id = ?1' },
  { name: 'courses', scope: 'user_id = ?1' },
  { name: 'catalog_courses', scope: 'user_id = ?1' },
  { name: 'units', scope: viaParent('course_id', 'courses') },
  { name: 'topics', scope: viaParent('course_id', 'courses') },
  { name: 'tags', scope: 'user_id = ?1' },
  { name: 'entity_tags', scope: viaParent('tag_id', 'tags') },
  { name: 'sources', scope: 'user_id = ?1' },
  { name: 'source_topics', scope: viaParent('source_id', 'sources') },
  { name: 'source_versions', scope: viaParent('source_id', 'sources') },
  { name: 'locations', scope: `source_version_id IN (SELECT id FROM source_versions WHERE ${viaParent('source_id', 'sources')})` },
  { name: 'passages', scope: 'user_id = ?1' },
  { name: 'notes', scope: viaParent('source_id', 'sources') },
  { name: 'generations', scope: 'user_id = ?1' },
  { name: 'cards', scope: 'user_id = ?1' },
  { name: 'card_topics', scope: viaParent('card_id', 'cards') },
  { name: 'card_sources', scope: viaParent('card_id', 'cards') },
  { name: 'card_states', scope: 'user_id = ?1' },
  { name: 'plan_blocks', scope: 'user_id = ?1' },
  { name: 'study_sessions', scope: 'user_id = ?1' },
  { name: 'review_log', scope: 'user_id = ?1' },
  { name: 'source_change_flags', scope: 'user_id = ?1' },
  { name: 'conversations', scope: 'user_id = ?1' },
  { name: 'messages', scope: viaParent('conversation_id', 'conversations') },
  { name: 'message_citations', scope: `message_id IN (SELECT id FROM messages WHERE ${viaParent('conversation_id', 'conversations')})` },
  { name: 'ai_usage', scope: 'user_id = ?1' },
  { name: 'questions', scope: 'user_id = ?1' },
  { name: 'question_topics', scope: viaParent('question_id', 'questions') },
  { name: 'question_sources', scope: viaParent('question_id', 'questions') },
  { name: 'quizzes', scope: 'user_id = ?1' },
  { name: 'quiz_items', scope: viaParent('quiz_id', 'quizzes') },
  { name: 'attempts', scope: 'user_id = ?1' },
  { name: 'mastery', scope: 'user_id = ?1' },
  { name: 'mastery_history', scope: 'user_id = ?1' },
  { name: 'deadlines', scope: 'user_id = ?1' },
  { name: 'deadline_topics', scope: viaParent('deadline_id', 'deadlines') },
  { name: 'goals', scope: 'user_id = ?1' },
  { name: 'lookups', scope: 'user_id = ?1' },
];

/**
 * Self-referencing columns that can point at a row inserted later in the same table.
 * Restore inserts them as NULL, then sets them in a second pass.
 */
export const DEFERRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  sources: ['alt_rendition_of'],
};

/** Tables whose rows count as "content": restore refuses to run unless all of them are empty. */
export const CONTENT_TABLES: readonly string[] = EXPORT_TABLES.map((t) => t.name).filter(
  (n) => n !== 'users' && n !== 'user_emails' && n !== 'settings',
);
