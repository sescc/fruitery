# Spec Delta

## Purpose

How a PC's desktop app connects to the owner's Worker and keeps its workspaces, items, settings
and ticks in step with the phone and the other PCs, including offline use and access-key expiry.

## ADDED Requirements

### Requirement: Connecting a PC with an access key
The owner SHALL be able to connect a PC by entering the Worker address, an access key (client
id and secret) and the key's expiry date in the Sync settings.
- The secret SHALL be stored encrypted for the current Windows user, and SHALL never be shown
  again or sent anywhere except to the Worker address.
- "Test connection" SHALL report success or the server's reason.
- "Disconnect" SHALL delete the stored key.
- A data folder copied to another PC or user SHALL ask for the key again.

#### Scenario: Connect
- **WHEN** the owner enters a valid address and key and taps "Test connection"
- **THEN** the app reports that it is connected and starts syncing

#### Scenario: Wrong key
- **WHEN** the key is not accepted by the Worker
- **THEN** the app shows "not connected" with the reason, and the local copy stays usable

#### Scenario: Copied data folder
- **WHEN** the data folder is copied to another PC and the app starts there
- **THEN** the app asks for the access key again and does not sync until it is entered

### Requirement: Two-way sync
A connected PC SHALL fetch the latest state when it starts, when its window gains focus, every
60 seconds, and shortly after a local edit. It SHALL merge it so that, per workspace, group,
item and settings, the most recently saved version wins. Changes made on the phone or another
PC SHALL appear without restarting.

#### Scenario: Edit on the phone
- **WHEN** the owner renames an item on the phone while the PC app is open and connected
- **THEN** the PC shows the new name within about a minute, or immediately when its window is focused

#### Scenario: Edit on the PC
- **WHEN** the owner adds an item on the connected PC
- **THEN** it appears on the phone after a refresh

### Requirement: Offline edits
Edits made while the PC is offline, or the Worker can't be reached, SHALL be kept and sent when
the connection returns. If the server rejects a sent change, the app SHALL show which entry and
why, and let the owner fix or discard it.

#### Scenario: Edit offline
- **WHEN** the owner edits an item with no connection and reconnects later
- **THEN** the edit is sent and appears on the other devices

#### Scenario: Rejected change
- **WHEN** the server rejects a queued change as invalid
- **THEN** the entry is marked with the error and stays local until fixed or discarded

### Requirement: Ticks on a connected PC
On a connected PC, ticking and unticking SHALL go through the Worker so that the server's clock
decides the period. While offline, ticking SHALL be disabled with a visible notice. The first
sync SHALL send ticks made locally in the current periods and then use the server's history.

#### Scenario: Tick
- **WHEN** the owner ticks a check-in on the connected PC
- **THEN** the phone shows it ticked after a refresh

#### Scenario: Offline tick
- **WHEN** the PC is offline
- **THEN** checkboxes and Done are disabled and a notice says ticking needs a connection

### Requirement: Sync status and key expiry
The app SHALL always show the sync status: synced, syncing, offline, not connected, an error with
its reason, or a warning when the access key expires within 14 days or has expired.

#### Scenario: Key expiring
- **WHEN** the stored expiry date is 10 days away
- **THEN** the status shows that the access key expires in 10 days

#### Scenario: Key expired
- **WHEN** the Worker refuses the key after its expiry date
- **THEN** the status shows that the key has expired and how to replace it

### Requirement: Running programs from synced items
The first time an item would start a given program on this PC, the app SHALL ask for
confirmation, showing the program path. Approved paths SHALL be remembered on this PC only. A
declined program SHALL NOT start, and the item's fallback address SHALL open instead if it has one.

#### Scenario: First launch
- **WHEN** an item synced from another device would start a program never approved on this PC
- **THEN** the app asks before starting it, and starts it only if the owner approves

#### Scenario: Declined
- **WHEN** the owner declines
- **THEN** the program does not start and the fallback address opens in a pane, if there is one
