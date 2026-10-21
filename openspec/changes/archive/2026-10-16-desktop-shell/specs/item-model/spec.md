# Spec Delta

## ADDED Requirements

### Requirement: User agent preset
Every item SHALL have a user-agent preset: default, chrome, firefox, or custom with a non-empty
string of at most 512 characters. An item without a preset SHALL be treated as default. The
system SHALL reject an unknown preset, or a custom preset with an empty or over-long string.

#### Scenario: Missing preset
- **WHEN** an item without a user-agent preset is validated
- **THEN** no error is reported and it is treated as default

#### Scenario: Custom without a string
- **WHEN** an item has the custom preset and an empty custom string
- **THEN** a userAgent error is reported
