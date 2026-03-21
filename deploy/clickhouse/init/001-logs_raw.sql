CREATE TABLE IF NOT EXISTS logs_raw (
  timestamp String,
  observed_at String,
  event_id String,
  agent_id String,
  host_id String,
  source_type String,
  level String,
  message String,
  source_json String
)
ENGINE = MergeTree
ORDER BY (agent_id, timestamp);
