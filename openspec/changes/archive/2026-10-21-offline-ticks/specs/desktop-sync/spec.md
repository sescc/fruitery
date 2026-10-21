# Spec Delta

## MODIFIED Requirements

### Requirement: Ticks on a connected PC
On a connected PC, ticking and unticking SHALL go through the Worker so that the server's clock
decides the period. While the PC is offline or the sync is in an error, ticking and unticking
SHALL still work: the change SHALL appear at once, be shown as waiting to be sent, and be sent
later with the time it was made so that the server files it under the right period. Ticking SHALL
be refused, with a notice, only when it could never be sent: the access key has expired or this PC
holds no readable key. The first sync SHALL send ticks made locally in the current periods and then
use the server's history.
- A waiting tick that the server refuses (too old, from the future, or not allowed) SHALL be dropped
  and listed under "Needs attention" until dismissed. One for an item that no longer exists or is
  no longer tickable SHALL be dropped without a message.
- Ticking and unticking the same period while offline SHALL cancel out: nothing is sent.
- Times SHALL be reported with the server's clock as last seen, so a PC with a wrong clock does not
  lose its ticks.
- Waiting ticks SHALL be sent only to a Worker that reports it understands reported times; otherwise they
  SHALL be held, not sent and not dropped, with a notice that the Worker needs an update.

#### Scenario: Tick
- **WHEN** the owner ticks a check-in on the connected PC
- **THEN** the phone shows it ticked after a refresh

#### Scenario: Offline tick
- **WHEN** the PC is offline and the owner ticks a check-in
- **THEN** the check-in shows as ticked and waiting to be sent, Done moves on to the next item, and nothing says that ticking is unavailable

#### Scenario: Sent later, filed by day
- **WHEN** the owner ticks a daily item at 22:00 while offline, and the connection returns the next morning
- **THEN** the phone shows the item ticked for the evening's day, not for the morning's

#### Scenario: Undo while offline
- **WHEN** the owner ticks and then unticks the same item in the same period while offline
- **THEN** nothing is waiting to be sent and the server is not asked to change anything

#### Scenario: Too old to send
- **WHEN** a tick has waited more than 48 hours and the connection returns
- **THEN** the tick is dropped, the owner is told under "Needs attention", and they can dismiss the message

#### Scenario: Key expired or missing
- **WHEN** the access key has expired, or the data folder was copied to another PC and no key is stored
- **THEN** ticking is refused with a notice that says the access key is needed, and nothing changes locally

#### Scenario: Clock ahead
- **WHEN** this PC's clock is 20 minutes ahead and the owner ticks offline
- **THEN** the tick is accepted by the server when it is sent

#### Scenario: Worker not updated
- **WHEN** ticks are waiting and the Worker does not report that it understands reported times
- **THEN** the ticks stay waiting, nothing is filed under the wrong day, and a notice says "Queued ticks wait for a Worker update (npm run deploy:web)"; ticking while connected still works

#### Scenario: Worker updated later
- **WHEN** the Worker is updated while ticks are held
- **THEN** the notice disappears and the waiting ticks are sent on the next sync
