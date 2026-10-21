# Spec Delta

## ADDED Requirements

### Requirement: Deletion rules
Deleting SHALL be recorded as deletion markers so other devices learn of it:
- deleting an item marks only that item;
- deleting a group marks the group, and its items stay but become ungrouped;
- deleting a workspace marks the workspace, its groups and its items;
- deleting the last remaining workspace SHALL be refused.

Every changed entity SHALL get the time of the deletion as its update time.

#### Scenario: Group deletion keeps items
- **WHEN** a group with two items is deleted
- **THEN** the group is marked deleted, and both items remain with no group and a new update time

#### Scenario: Workspace deletion cascades
- **WHEN** a workspace with one group and three items is deleted while another workspace exists
- **THEN** the workspace, the group and the three items are all marked deleted

#### Scenario: Last workspace refused
- **WHEN** deletion of the only remaining workspace is requested
- **THEN** it is refused and nothing changes

### Requirement: Workspace validation and the ungrouped label
A workspace SHALL have a non-blank name. It MAY have a name for its ungrouped section: if set, it SHALL
be non-blank text of at most 40 characters; an absent one means "Default". The system SHALL reject a
workspace that breaks these rules, listing the field.

#### Scenario: Blank name
- **WHEN** a workspace with a blank name is validated
- **THEN** a name error is reported

#### Scenario: Label rules
- **WHEN** a workspace has an ungrouped label of 41 characters, or only spaces
- **THEN** an ungroupedLabel error is reported (out of range, or required)

#### Scenario: Default label
- **WHEN** a workspace has no ungrouped label
- **THEN** its ungrouped section is called "Default"
