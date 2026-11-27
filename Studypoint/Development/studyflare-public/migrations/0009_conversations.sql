-- Migration 0009 (2026-11-27): saved conversations (step 6a, AST-06). The conversations and messages
-- tables exist since 0001; titles and messages are stored as ciphertext. These indexes serve the
-- per-course and all-chats lists and loading one conversation in order.
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at);
CREATE INDEX idx_conversations_course ON conversations(user_id, course_id, updated_at);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
