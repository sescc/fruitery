-- Per-item phone deep link: an Android intent:/custom-scheme target the phone opens instead of a web URL, or NULL (= none). The desktop never opens it.
ALTER TABLE items ADD COLUMN deep_link TEXT;
