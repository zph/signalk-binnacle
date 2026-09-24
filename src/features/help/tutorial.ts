import { isRecord, PLATFORM_BREAKPOINTS } from '$shared/lib';
import type { PersistedCodec, PersistedDecodeResult } from '$shared/settings';

export const TUTORIAL_FLOW_IDS = [
  'chart',
  'instruments',
  'passage',
  'offline',
  'safety',
  'review',
] as const;

export type TutorialFlowId = (typeof TUTORIAL_FLOW_IDS)[number];
export type TutorialDevice = 'phone' | 'tablet' | 'computer';
export type TutorialStatus = 'offered' | 'active' | 'skipped' | 'completed';
export type TutorialActionId =
  | 'layers'
  | 'instruments'
  | 'routes'
  | 'offline'
  | 'alarms'
  | 'tracks';

export interface TutorialProgress {
  version: 1;
  status: TutorialStatus;
  completedFlowIds: TutorialFlowId[];
  activeFlowId: TutorialFlowId | null;
  stepIndex: number;
}

export interface TutorialStep {
  title: string;
  instructions: Record<TutorialDevice, string>;
  action?: { id: TutorialActionId; label: string };
}

export interface TutorialFlow {
  id: TutorialFlowId;
  title: string;
  summary: string;
  minutes: number;
  steps: TutorialStep[];
}

const FLOW_IDS = new Set<string>(TUTORIAL_FLOW_IDS);
const STATUSES = new Set<string>(['offered', 'active', 'skipped', 'completed']);

export function defaultTutorialProgress(): TutorialProgress {
  return {
    version: 1,
    status: 'offered',
    completedFlowIds: [],
    activeFlowId: null,
    stepIndex: 0,
  };
}

function cleanTutorialProgress(value: unknown): TutorialProgress | undefined {
  if (!isRecord(value) || value.version !== 1 || !STATUSES.has(String(value.status))) {
    return undefined;
  }
  if (!Array.isArray(value.completedFlowIds) || value.completedFlowIds.length > 6) {
    return undefined;
  }
  const completedFlowIds: TutorialFlowId[] = [];
  const seen = new Set<string>();
  for (const id of value.completedFlowIds) {
    if (typeof id !== 'string' || !FLOW_IDS.has(id)) return undefined;
    if (seen.has(id)) continue;
    seen.add(id);
    completedFlowIds.push(id as TutorialFlowId);
  }
  const activeFlowId = value.activeFlowId;
  if (activeFlowId !== null && (typeof activeFlowId !== 'string' || !FLOW_IDS.has(activeFlowId))) {
    return undefined;
  }
  if (
    !Number.isInteger(value.stepIndex) ||
    Number(value.stepIndex) < 0 ||
    Number(value.stepIndex) > 8
  ) {
    return undefined;
  }
  return {
    version: 1,
    status: value.status as TutorialStatus,
    completedFlowIds,
    activeFlowId: activeFlowId as TutorialFlowId | null,
    stepIndex: activeFlowId === null ? 0 : Number(value.stepIndex),
  };
}

export const tutorialProgressCodec: PersistedCodec<TutorialProgress> = {
  decode(value): PersistedDecodeResult<TutorialProgress> {
    const cleaned = cleanTutorialProgress(value);
    if (!cleaned) return { state: 'invalid' };
    return {
      state: JSON.stringify(cleaned) === JSON.stringify(value) ? 'valid' : 'migrated',
      value: cleaned,
    };
  },
};

export function tutorialDeviceFor(widthPx: number, coarsePointer: boolean): TutorialDevice {
  if (widthPx <= PLATFORM_BREAKPOINTS.phoneMaxPx) return 'phone';
  return coarsePointer ? 'tablet' : 'computer';
}

const FLOWS: Record<TutorialFlowId, TutorialFlow> = {
  chart: {
    id: 'chart',
    title: 'Read and move around the chart',
    summary: 'Find chart controls, turn on nautical charts, and follow the boat.',
    minutes: 2,
    steps: [
      {
        title: 'Know where controls live',
        instructions: {
          phone:
            'Tap Menu at the bottom for the full set of controls. Panels open as sheets over the chart, and Back returns to the previous surface.',
          tablet:
            'Tap Menu in the helm rail. Panels and instruments use the extra screen space while keeping the chart visible when possible.',
          computer:
            'Open Menu with the pointer, or press Command K or Control K to search every action. Escape closes the top surface.',
        },
      },
      {
        title: 'Turn on a nautical chart',
        instructions: {
          phone:
            'Open Layers and charts, choose Layers and Overlays, and enable a source that covers the visible water. The reference map alone is not a nautical chart.',
          tablet:
            'Open Layers and charts beside the map, then enable a nautical chart with coverage over the current view.',
          computer:
            'Open Layers and charts from Menu or Command K, then enable a nautical source for the current viewport.',
        },
        action: { id: 'layers', label: 'Try Layers and charts' },
      },
      {
        title: 'Center, follow, and orient',
        instructions: {
          phone:
            'Use Center for one recenter, Follow to keep the boat on screen, and Orientation to cycle north-up, heading-up, and course-up.',
          tablet:
            'Center returns to the boat once. Follow keeps the chart with the boat, and Orientation selects how the chart rotates.',
          computer:
            'Center and Follow are available from the helm rail and Command K. Panning releases Follow so the chart stays where you moved it.',
        },
      },
    ],
  },
  instruments: {
    id: 'instruments',
    title: 'Arrange instruments',
    summary: 'Choose readings, place overlays, and save a useful helm layout.',
    minutes: 2,
    steps: [
      {
        title: 'Enter instrument editing',
        instructions: {
          phone:
            'Choose Edit instruments from Menu. The instrument workspace fills the phone so every tile remains readable and touchable.',
          tablet:
            'Choose Edit instruments to place floating readings over the chart. Drag them with one finger while editing.',
          computer:
            'Choose Edit instruments from Menu or Command K. Drag floating instruments and resize them from their edit handles.',
        },
        action: { id: 'instruments', label: 'Try instrument editing' },
      },
      {
        title: 'Choose the readings that matter',
        instructions: {
          phone:
            'Use Customize to add wind, speed, depth, navigation, or history instruments. Keep the set small enough to scan quickly.',
          tablet:
            'Use Customize to combine large visual instruments with compact numeric readings for the current job.',
          computer:
            'Use Customize to add built-in or discovered Signal K instruments, then use the layout controls for precise placement.',
        },
      },
      {
        title: 'Finish and reuse the layout',
        instructions: {
          phone:
            'Tap Done when placement is complete. Instrument choices can be saved with a profile for this operating context.',
          tablet:
            'Tap Done to lock placement. Save the arrangement as an instrument layout or carry it with a profile.',
          computer:
            'Finish editing to prevent accidental movement. Profiles can carry the selected instruments and overlay positions.',
        },
      },
    ],
  },
  passage: {
    id: 'passage',
    title: 'Plan a passage',
    summary: 'Create a route from the chart, inspect it, and activate it deliberately.',
    minutes: 3,
    steps: [
      {
        title: 'Start with the destination',
        instructions: {
          phone:
            'Press the chart at the destination, then choose a route or waypoint action. Move the sheet down when you need more chart space.',
          tablet:
            'Press the destination on the chart and choose a route action. The panel and chart stay connected while you place points.',
          computer:
            'Right-click the destination or open Routes from Menu. Chart actions seed the first point without typing coordinates.',
        },
        action: { id: 'routes', label: 'Try Routes' },
      },
      {
        title: 'Shape and inspect the route',
        instructions: {
          phone:
            'Add waypoints where the passage needs them, then inspect each leg. Keep charted hazards and the vessel draft in mind.',
          tablet:
            'Add and move waypoints directly on the chart, then inspect leg distances, bearings, and the route summary.',
          computer:
            'Use chart points to shape the route, then inspect its legs and advisory timing before saving.',
        },
      },
      {
        title: 'Navigate only after review',
        instructions: {
          phone:
            'Save first, then use the separate Navigate action. Binnacle asks for confirmation before changing active guidance.',
          tablet:
            'Save the plan and review chart coverage. Activating navigation is a separate confirmed action.',
          computer:
            'Save and review the route before activation. Sail Wayfinder can propose alternatives, but every result remains advisory.',
        },
      },
    ],
  },
  offline: {
    id: 'offline',
    title: 'Prepare charts for offline use',
    summary: 'Save chart coverage before leaving a reliable connection.',
    minutes: 2,
    steps: [
      {
        title: 'Open Offline charts',
        instructions: {
          phone:
            'Open Offline charts from Menu while connected. If Chart Locker is unavailable, the panel explains what the server administrator needs to install or approve.',
          tablet:
            'Open Offline charts and choose a saved area or route corridor while the full chart remains available beside it.',
          computer:
            'Open Offline charts from Menu or Command K. The landing page shows provider, access, and storage readiness separately.',
        },
        action: { id: 'offline', label: 'Try Offline charts' },
      },
      {
        title: 'Choose the waters you need',
        instructions: {
          phone:
            'Draw a bounded area or use route coverage. Avoid downloading a much larger region than the trip needs.',
          tablet:
            'Draw an area on the chart or prepare a route corridor, then review the source list and estimated size.',
          computer:
            'Select an area or route corridor, inspect its sources and estimate, and start the server-side cache job.',
        },
      },
      {
        title: 'Verify before departure',
        instructions: {
          phone:
            'Wait for completion, then inspect the saved area. A healthy provider is not proof that your route is covered.',
          tablet:
            'Confirm completion, included charts, coverage, and update time for the saved area.',
          computer:
            'Review saved-area coverage and included sources. Test the intended view without relying on a live upstream connection.',
        },
      },
    ],
  },
  safety: {
    id: 'safety',
    title: 'Set safety watches',
    summary: 'Understand alarms, nearby vessels, anchor watch, and MOB behavior.',
    minutes: 3,
    steps: [
      {
        title: 'Set alarm behavior for these waters',
        instructions: {
          phone:
            'Open Alarms and choose collision and shallow-water settings for the current operating profile. Enable sound with a tap on this display.',
          tablet:
            'Open Alarms, review the active collision profile, and verify that this display can sound before standing watch.',
          computer:
            'Open Alarms to set CPA, TCPA, shallow-water, and sound behavior. Settings can vary by operating profile.',
        },
        action: { id: 'alarms', label: 'Try Alarms' },
      },
      {
        title: 'Use AIS as an assessment, not a lookout',
        instructions: {
          phone:
            'Open Nearby vessels for CPA and TCPA details. An unassessed target lacks enough fresh motion data for a prediction.',
          tablet:
            'Inspect nearby vessels and their motion vectors. Treat missing or stale CPA data as unknown risk, not no risk.',
          computer:
            'Use the AIS list and chart vectors together. CPA and TCPA assume both vessels hold course and speed.',
        },
      },
      {
        title: 'Know the deliberate emergency actions',
        instructions: {
          phone:
            'Anchor watch and MOB are separate safety flows. MOB marks and alarms first, while steering to it always requires another confirmation.',
          tablet:
            'Set anchor watch only from a fresh position. MOB marks the event for every station but never changes course automatically.',
          computer:
            'Keep Anchor watch and MOB reachable. All navigation output remains advisory and requires an active lookout.',
        },
      },
    ],
  },
  review: {
    id: 'review',
    title: 'Record and review a voyage',
    summary: 'Record a track, add logbook context, and replay available history.',
    minutes: 2,
    steps: [
      {
        title: 'Record the track',
        instructions: {
          phone:
            'Open Tracks before departure and start recording. The active recording survives reload when this browser can use its local database.',
          tablet:
            'Start a track from the Tracks panel and leave it recording while the chart remains your primary view.',
          computer:
            'Open Tracks from the helm rail or Command K. Pauses, fix outages, and implausible jumps remain separate segments.',
        },
        action: { id: 'tracks', label: 'Try Tracks' },
      },
      {
        title: 'Add operational context',
        instructions: {
          phone:
            'Use Logbook for events and Watch handoff for a concise station change. Confirm saved entries reached Signal K.',
          tablet:
            'Pair the track with logbook entries and a Watch handoff snapshot when responsibility changes.',
          computer:
            'Use Logbook and Watch handoff to capture context that a position line alone cannot explain.',
        },
      },
      {
        title: 'Review without changing live navigation',
        instructions: {
          phone:
            'Playback reviews history when a provider is available. Exit returns the display to live data.',
          tablet:
            'Use Playback for synchronized historic position and readings, then exit explicitly to return to now.',
          computer:
            'Open Playback to scrub available Signal K history. Reviewing history never activates a route or changes live guidance.',
        },
      },
    ],
  },
};

const FLOW_ORDER: Record<TutorialDevice, readonly TutorialFlowId[]> = {
  phone: ['chart', 'safety', 'offline', 'passage', 'instruments', 'review'],
  tablet: ['chart', 'instruments', 'passage', 'safety', 'offline', 'review'],
  computer: ['chart', 'passage', 'instruments', 'offline', 'safety', 'review'],
};

export function tutorialFlowsFor(device: TutorialDevice): TutorialFlow[] {
  return FLOW_ORDER[device].map((id) => FLOWS[id]);
}

export function tutorialDeviceLabel(device: TutorialDevice): string {
  if (device === 'phone') return 'phone';
  if (device === 'tablet') return 'touchscreen';
  return 'computer';
}
