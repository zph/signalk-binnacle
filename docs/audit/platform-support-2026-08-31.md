# Platform support audit, 2026-08-31

## Standard adopted

Binnacle Chartplotter supports three first-class operating modes:

- Desktop helm: 1440 by 900 CSS pixels or larger, fine pointer, keyboard, and mouse.
- iPad helm: 1024 by 768 and 768 by 1024 CSS pixels, coarse touch, Safari, and safe areas.
- Phone: 390 by 844 portrait and 844 by 390 landscape CSS pixels, coarse touch, Safari or
  Chromium, dynamic browser chrome, and safe areas.

Every feature must have a reachable entry point, usable interaction path, visible feedback, and
bounded layout in each mode. A breakpoint alone is not support. The behavior needs a device- and
input-appropriate test.

## Baseline found

The foundation is solid. The shared panel system has a phone bottom-sheet path at 600 pixels, a
coarse-pointer tablet width, dynamic viewport units, and safe-area handling. Map and chart menus
also use visual viewport positioning where needed. The browser suite contains many 320 to 390 pixel
phone checks, desktop Chromium and Safari projects, direct touch event coverage, and a small number
of tablet-sized checks.

However, this is not yet three-platform support. iPad is not a Playwright project, the phone is
only a project for `ui-quality.spec.ts`, and most behavior specs run only as desktop Chromium.
Recent chart-instrument work made that gap visible: the test formerly asserted that locked chart
instruments were inert, even though the supported behavior is now clickable chart instruments.
That spec has been updated in this change, but it still needs to be exercised on the full device
matrix below.

## Findings and remediation

### P1. The control model is not equivalent on desktop, iPad, and phone

**Resolved, 2026-08-31.** A persistent MOB and Menu pair now appears above the safe area at every
width. Menu opens the same radial action set on desktop, iPad, and phone, including the instrument
control cycle. The screen-edit toolbar reserves its clearance.

- **Location**: `src/app/App.svelte` renders `.desktop-helm-actions` with the primary
  Show/Edit/Hide instruments control, then hides that entire group at `max-width: 900px`.
  `src/features/menu/ActionDial.svelte` is coarse-pointer only, but does not provide an explicit,
  always-visible equivalent to that instrument state cycle.
- **Impact**: iPad and phone users lose the persistent direct control that desktop users use to
  show, edit, and hide chart instruments. Command K remains a recovery path, not an equivalent
  helm control.
- **Required correction**: define one responsive helm-action primitive and render it in all three
  modes. It may be a bottom action row on desktop and iPad, and a compact bottom bar or dial action
  on phone, but its three states and labels must be identical. Keep it clear of safe areas and the
  safety rail.
- **Verification**: browser scenarios on desktop, iPad portrait, iPad landscape, phone portrait,
  and phone landscape. Assert the state cycle is reachable, visible, and inside the viewport.

### P2. The automated browser matrix does not cover all supported platforms

**Resolved for chart instruments, 2026-08-31.** Playwright now has iPad Safari portrait and
landscape projects plus a phone Safari instrument project. The representative instrument flow runs
on each; the existing mobile UI project continues to cover shared visual quality.

- **Location**: `playwright.config.ts` defines Desktop Chrome, Desktop Safari, a fixture-backed
  desktop project, and an iPhone 13 project limited to `ui-quality.spec.ts`. It has no iPad device
  project and no full phone functional project.
- **Impact**: a feature can pass the browser gate while its iPad layout, touch behavior, or phone
  entry point is broken. Static 1024 by 768 and 320 by 568 viewports in individual specs are useful
  spot checks, but they do not exercise the target device, input mode, or cross-feature workflow.
- **Required correction**: add iPad Safari portrait and landscape projects, and a phone Safari
  functional smoke project. Classify every browser spec as desktop-only only when it has no
  user-visible layout or input interaction. Make the shared smoke, menu, chart, instruments,
  safety, and panel scenarios run in all applicable projects.
- **Verification**: `scripts/check-package.mjs` must validate the new project names, and the
  browser gate must include a representative cross-platform scenario for every major surface.

### P3. Chart-instrument editing lacks platform-specific touch coverage

**Resolved, 2026-08-31.** The edit frame declares `touch-action: none`, has a genuine Chromium
touch-drag scenario, and its screen workflow runs in the new iPad and phone Safari projects.
The scenario checks the persistent control, tile-body drag, locked map panning, persistence,
removal, and toolbar viewport bounds.

- **Location**: `src/features/instruments/InstrumentScreenLayer.svelte` owns body dragging,
  resizing, expansion, removal, alignment guides, and the lower edit toolbar. Before this audit,
  `e2e/instrument-screen.spec.ts` relied on the retired dock drag and asserted inert locked tiles.
- **Impact**: the new touch-first interactions can regress on iPad or phone without a failing
  test. In particular, pointer capture, movement thresholds, target buttons, safe-area clearance,
  and the lower toolbar must coexist with map gestures and browser chrome.
- **Required correction**: run this scenario on iPad and phone. Test touch drag from a tile body,
  the expand exception, resize, remove, green alignment guides, persistence, and map panning in
  locked mode. Add both portrait and landscape checks for the bottom edit toolbar.
- **Verification**: a device-parameterized instrument-screen spec, with real CDP touch events for
  drag and `expectInsideViewport` checks for the toolbar and its menu.

### P4. Breakpoints are feature-local rather than an explicit platform contract

**Resolved for new work, 2026-08-31.** `src/shared/lib/platform.ts` is the named source for the
phone and compact-helm breakpoints, and supplies the supported viewport matrix used by browser
work. Existing CSS literals remain necessary because CSS cannot import TypeScript; they must cite
the contract when touched and are now prohibited from introducing a new unnamed platform mode.

- **Location**: 600 and 900 pixel decisions are repeated across `src/app/App.svelte`,
  `src/styles/panels.css`, `src/app/StatusStrip.svelte`, `src/features/menu/PinnedActions.svelte`,
  and individual features. Some source comments document a mirrored literal, but the platform
  intent is scattered.
- **Impact**: a new surface can choose a nearby arbitrary breakpoint and silently create a fourth,
  unsupported mode. iPad landscape, narrow desktop windows, and phone landscape then receive
  accidental behavior.
- **Required correction**: establish named platform contracts in one shared source and document
  the supported viewport and orientation matrix in the design system. CSS media queries must still
  use literals, but each literal should cite the contract and be covered by a matching test.
- **Verification**: a small source-inventory test for sanctioned breakpoints plus browser viewport
  scenarios at the boundary values.

### P5. Keyboard parity is inconsistent for chart-layout controls

**Resolved, 2026-08-31.** Pointer dragging, resize dragging, and keyboard nudges all share the
same alignment snap calculation. A live region announces the aligned horizontal and vertical edge
or center for keyboard and assistive-technology users.

- **Location**: move and resize handles in `InstrumentScreenLayer.svelte` support arrow-key
  changes, while body dragging and alignment feedback are pointer-only.
- **Impact**: desktop keyboard users can make coarse adjustments but cannot discover or use the
  same alignment result as a pointer user. This is a lower-severity platform gap than P1 through
  P3, but it violates equal desktop support.
- **Required correction**: expose alignment state to keyboard movement, snap to a guide when the
  user moves within the same tolerance, and announce the aligned edge or center through a concise
  live region.
- **Verification**: component test for the snap calculation and an E2E keyboard scenario.

## Already supported and should be preserved

- Shared buttons and icon controls use a 44 pixel target. `e2e/ui-quality.spec.ts` checks this on
  a 320 pixel phone.
- Phone panels become bounded bottom sheets, and coarse-pointer tablets receive a wider panel.
  `src/styles/panels.css` also uses dynamic viewport height.
- Safe areas are handled in global tokens, status strips, menus, chart controls, and the interface
  lock. Existing browser checks cover the status strips and menu clearance.
- Action Dial deliberately hides for a fine pointer and supports touch positioning. That is a good
  platform-specific interaction, but it must be paired with equivalent commands rather than being
  the only touch entry point.
- Map interactions have touch-specific tests for long press, measurement, anchor watch, tides, and
  instrument customization reorder.

## Ongoing verification

No feature is complete against this policy until relevant desktop, iPad, and phone scenarios are
green. The platform projects above are the minimum regression matrix for the chart-instrument
surface; other major surfaces must add their own equivalent scenarios before changing behavior.
