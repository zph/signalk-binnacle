# Device-aware tutorial

Binnacle offers a short tutorial when it first becomes usable on a device. The offer is a compact
banner over the chart, not a forced modal or automatically opened panel. A navigator can start the
tutorial or skip it. Skipping is stored only on that device, and every walkthrough remains available
under Help.

## Common flows

The tutorial covers six ordinary chartplotter jobs:

1. **Read and move around the chart**: find the helm controls, enable a nautical chart, center on
   the boat, follow it, and change chart orientation.
2. **Arrange instruments**: enter instrument editing, choose relevant readings, place them, and
   preserve a useful layout.
3. **Plan a passage**: begin from the chart, shape and inspect a route, save it, and activate
   navigation as a separate confirmed action.
4. **Prepare charts for offline use**: choose an area or route corridor, review its size and
   sources, download it, and verify actual coverage before departure.
5. **Set safety watches**: configure alarms for the current context, interpret AIS assessment,
   enable alarm audio, and understand deliberate Anchor watch and MOB actions.
6. **Record and review a voyage**: record a track, add Logbook and Watch handoff context, and use
   Playback without changing live navigation.

## Device adaptation

The flows and safety meaning stay consistent across devices. Their order and instructions change to
match the controls the navigator actually has:

- A **phone** guide leads with the bottom helm rail, touch gestures, full-screen sheets, and compact
  instrument handling.
- A **touchscreen** guide leads with chart and panel coexistence, direct manipulation, and the wider
  tablet layout.
- A **computer** guide includes pointer actions, Command K or Control K, Escape, and precise layout
  controls.

Phone classification follows Binnacle's shared 600 px phone breakpoint. Wider displays with a
coarse primary pointer use the touchscreen guide. Other displays use the computer guide. Rotation or
input changes update the instructions without discarding progress.

## Interaction model

- The first-landing banner has **Start tutorial** and **Skip** actions.
- Help lists every walkthrough, its purpose, estimated duration, and completion state.
- A walkthrough presents one step at a time with an explicit progress indicator.
- A step that refers to another Binnacle surface offers a **Try** action. It advances progress and
  opens the real surface. Back returns to Help where that surface supports panel history; otherwise,
  Help resumes at the saved next step.
- **Exit and keep progress** returns to the walkthrough list without resetting it.
- **Skip tutorial** in Help suppresses future first-landing offers on that device and marks the
  walkthrough as skipped. Skipping the compact offer also suppresses it without changing progress.
- **Restart all** clears tutorial completion while leaving all other device and profile settings
  untouched.

The walkthrough never simulates writes, starts navigation, arms a safety watch, or activates an
alarm. It teaches through existing panels, and the normal confirmation and access rules remain in
force.

## Persistence

Progress is stored in `binnacle-custom:tutorial-progress` with device scope. It contains a schema
version, progress state, completed flow IDs, active flow ID, and step index. A bounded codec rejects
unknown IDs, invalid states, oversized collections, and invalid step indexes. The separate
`binnacle-custom:tutorial-offer` device setting prevents the landing offer from returning after it
is handled. Neither setting enters a portable profile or syncs to Signal K.

The existing safety orientation remains independent. It can be dismissed permanently on the device,
while the safe-use guidance remains available in Help.

## Accessibility and safety

- All navigation is made of ordinary buttons with at least Binnacle's shared control target size.
- The active step reports determinate progress with visible and assistive step counts.
- Completion is conveyed in text and accessibility labels, not color alone.
- The tutorial stays within the Help panel and never covers emergency safety rails.
- Night-red uses existing surface, accent, text, and status tokens.
- Every route, chart, weather, collision, and depth result remains advisory.

## Verification

Unit and component tests cover device classification, flow order, persistence validation, the first
and resumed states, the common-flow catalog, and device-specific copy. Browser tests cover the
first-landing offer, Skip persistence after reload, restarting from Help, phone wording, Try actions,
and return navigation.
