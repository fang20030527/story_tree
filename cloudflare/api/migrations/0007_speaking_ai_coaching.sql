-- 保留历史专用评测来源，新增点评显式记录为 evolink。
ALTER TABLE speaking_pronunciation_assessments ADD COLUMN provider TEXT NOT NULL DEFAULT 'speechace'
  CHECK (provider IN ('speechace', 'evolink'));
