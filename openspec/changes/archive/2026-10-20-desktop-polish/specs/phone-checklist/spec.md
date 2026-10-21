## ADDED Requirements

### Requirement: Site icons
Each item in the checklist, in "Not due" and in the Links section SHALL show an icon: the emoji or letter in the item's
Icon field if it has one, otherwise the site's own icon, and the first letter of the item's name when the site's icon
cannot be shown (no web address, no icon, or the load fails).
- The icon SHALL be requested directly from the item's site, without sending a referrer, and only for http(s) sites.
- Icons SHALL be loaded lazily and kept on the device for about 30 days, so they show without a connection. Nothing else
  from another site SHALL be kept, and the cache for icons SHALL be separate from the app's own files.
- A failing or unreachable icon SHALL never block or delay the checklist.

#### Scenario: Icon shown
- **WHEN** an item's site serves an icon
- **THEN** the item shows it beside its name

#### Scenario: Icon missing
- **WHEN** the site has no icon or does not answer
- **THEN** the item shows the first letter of its name

#### Scenario: Offline after a visit
- **WHEN** the phone is offline and the icon was loaded within the last 30 days
- **THEN** the icon still shows

#### Scenario: Typed icon
- **WHEN** an item has "🍎" in its Icon field
- **THEN** the checklist shows "🍎" and does not contact the site for an icon

#### Scenario: Item without a web address
- **WHEN** an item has no usable address (for example it needs a Google email that is not set)
- **THEN** it shows its first letter and nothing is requested
