-- Per-workspace name for items without a group (NULL = "Default").
ALTER TABLE workspaces ADD COLUMN ungrouped_label TEXT;
