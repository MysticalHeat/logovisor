ALTER TABLE logs_raw
ADD COLUMN IF NOT EXISTS level String
AFTER source_type;
