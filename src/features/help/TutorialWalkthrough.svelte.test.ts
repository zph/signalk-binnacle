import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import TutorialWalkthrough from './TutorialWalkthrough.svelte';
import { defaultTutorialProgress } from './tutorial';

const actions = {
  onProgressChange: vi.fn(),
  onOpenLayers: vi.fn(),
  onOpenInstruments: vi.fn(),
  onOpenRoutes: vi.fn(),
  onOpenOffline: vi.fn(),
  onOpenAlarms: vi.fn(),
  onOpenTracks: vi.fn(),
};

describe('TutorialWalkthrough', () => {
  it('lists the common flows with device-aware guidance', () => {
    const body = render(TutorialWalkthrough, {
      props: { device: 'phone', progress: defaultTutorialProgress(), ...actions },
    }).body;
    for (const label of [
      'Read and move around the chart',
      'Arrange instruments',
      'Plan a passage',
      'Prepare charts for offline use',
      'Set safety watches',
      'Record and review a voyage',
    ]) {
      expect(body).toContain(label);
    }
    expect(body).toContain('hands-on guides for this phone');
    expect(body).toContain('Skip tutorial');
  });

  it('renders the saved active step and its real-surface action', () => {
    const body = render(TutorialWalkthrough, {
      props: {
        device: 'computer',
        progress: {
          ...defaultTutorialProgress(),
          status: 'active',
          activeFlowId: 'chart',
          stepIndex: 1,
        },
        ...actions,
      },
    }).body;
    expect(body).toContain('Step 2 of 3');
    expect(body).toContain('Try Layers and charts');
    expect(body).toContain('Command K');
    expect(body).toContain('Exit and keep progress');
  });
});
