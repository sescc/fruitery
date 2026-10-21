-- Per-item user-agent preset for the desktop app: JSON {"preset": "...", "custom": "..."} or NULL (= default).
ALTER TABLE items ADD COLUMN user_agent TEXT;
