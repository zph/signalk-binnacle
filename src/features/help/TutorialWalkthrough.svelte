<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import type {
  TutorialActionId,
  TutorialDevice,
  TutorialFlow,
  TutorialFlowId,
  TutorialProgress,
} from './tutorial';
import { tutorialDeviceLabel, tutorialFlowsFor } from './tutorial';

interface Props {
  device: TutorialDevice;
  progress: TutorialProgress;
  onProgressChange: (progress: TutorialProgress) => void;
  onOpenLayers: () => void;
  onOpenInstruments: () => void;
  onOpenRoutes: () => void;
  onOpenOffline: () => void;
  onOpenAlarms: () => void;
  onOpenTracks: () => void;
}

const {
  device,
  progress,
  onProgressChange,
  onOpenLayers,
  onOpenInstruments,
  onOpenRoutes,
  onOpenOffline,
  onOpenAlarms,
  onOpenTracks,
}: Props = $props();

const flows = $derived(tutorialFlowsFor(device));
const activeFlow = $derived(
  progress.activeFlowId === null
    ? undefined
    : flows.find((flow) => flow.id === progress.activeFlowId),
);
const currentStepIndex = $derived(
  activeFlow ? Math.min(progress.stepIndex, activeFlow.steps.length - 1) : 0,
);
const currentStep = $derived(activeFlow?.steps[currentStepIndex]);
const completed = $derived(new Set(progress.completedFlowIds));
const remaining = $derived(flows.filter((flow) => !completed.has(flow.id)));

function setProgress(next: Partial<TutorialProgress>): void {
  onProgressChange({ ...progress, ...next });
}

function startFlow(flow: TutorialFlow): void {
  setProgress({ status: 'active', activeFlowId: flow.id, stepIndex: 0 });
}

function leaveFlow(): void {
  setProgress({ activeFlowId: null, stepIndex: 0 });
}

function back(): void {
  if (currentStepIndex === 0) leaveFlow();
  else setProgress({ stepIndex: currentStepIndex - 1 });
}

function completeFlow(flowId: TutorialFlowId): void {
  const nextCompleted = completed.has(flowId)
    ? progress.completedFlowIds
    : [...progress.completedFlowIds, flowId];
  setProgress({
    status: nextCompleted.length === flows.length ? 'completed' : 'active',
    completedFlowIds: nextCompleted,
    activeFlowId: null,
    stepIndex: 0,
  });
}

function next(): void {
  if (!activeFlow) return;
  if (currentStepIndex >= activeFlow.steps.length - 1) completeFlow(activeFlow.id);
  else setProgress({ stepIndex: currentStepIndex + 1 });
}

function tryAction(actionId: TutorialActionId): void {
  if (!activeFlow) return;
  if (currentStepIndex >= activeFlow.steps.length - 1) completeFlow(activeFlow.id);
  else setProgress({ stepIndex: currentStepIndex + 1 });
  if (actionId === 'layers') onOpenLayers();
  else if (actionId === 'instruments') onOpenInstruments();
  else if (actionId === 'routes') onOpenRoutes();
  else if (actionId === 'offline') onOpenOffline();
  else if (actionId === 'alarms') onOpenAlarms();
  else onOpenTracks();
}

function skipAll(): void {
  setProgress({ status: 'skipped', activeFlowId: null, stepIndex: 0 });
}

function restart(): void {
  onProgressChange({
    version: 1,
    status: 'active',
    completedFlowIds: [],
    activeFlowId: flows[0]?.id ?? null,
    stepIndex: 0,
  });
}
</script>

<section class="panel-section tutorial" aria-label="Guided walkthroughs">
  {#if activeFlow && currentStep}
    <div class="tutorial-heading">
      <button type="button" class="icon-btn" aria-label="Back to walkthroughs" onclick={leaveFlow}>
        <ChevronLeft size={20} />
      </button>
      <div>
        <p class="caps-label">Guided walkthrough</p>
        <h3>{activeFlow.title}</h3>
      </div>
    </div>

    <div
      class="tutorial-progress"
      role="progressbar"
      aria-label={`${activeFlow.title} progress`}
      aria-valuemin="1"
      aria-valuemax={activeFlow.steps.length}
      aria-valuenow={currentStepIndex + 1}
      aria-valuetext={`Step ${currentStepIndex + 1} of ${activeFlow.steps.length}`}
    >
      <span style:width={`${((currentStepIndex + 1) / activeFlow.steps.length) * 100}%`}></span>
    </div>
    <p class="step-count num">Step {currentStepIndex + 1} of {activeFlow.steps.length}</p>

    <div class="card-frame tutorial-step">
      <h4>{currentStep.title}</h4>
      <p>{currentStep.instructions[device]}</p>
      {#if currentStep.action}
        <button
          type="button"
          class="btn"
          onclick={() => currentStep.action && tryAction(currentStep.action.id)}
        >
          {currentStep.action.label}
        </button>
        <p class="muted-note">
          This opens the real control. Return to Help to continue at the next step.
        </p>
      {/if}
    </div>

    <div class="tutorial-actions">
      <button type="button" class="btn btn-ghost" onclick={back}>
        {currentStepIndex === 0 ? 'All walkthroughs' : 'Previous'}
      </button>
      <button type="button" class="btn" onclick={next}>
        {currentStepIndex === activeFlow.steps.length - 1 ? 'Finish walkthrough' : 'Next'}
      </button>
    </div>
    <button type="button" class="btn btn-ghost exit" onclick={leaveFlow}>
      Exit and keep progress
    </button>
  {:else}
    <h3 class="caps-label">Guided walkthroughs</h3>
    <p class="muted-note">
      Short, hands-on guides for this {tutorialDeviceLabel(device)}. Each guide opens Binnacle's
      real controls, and your progress stays on this device.
    </p>

    {#if progress.status === 'completed'}
      <p class="alert-note" role="status">
        All walkthroughs are complete. You can repeat any one whenever you want.
      </p>
    {:else if progress.status === 'skipped'}
      <p class="muted-note" role="status">
        The first-run tutorial is off. These walkthroughs remain available here.
      </p>
    {/if}

    <ul class="bare-list tutorial-list">
      {#each flows as flow (flow.id)}
        <li>
          <button type="button" class="card-frame tutorial-card" onclick={() => startFlow(flow)}>
            <span class="tutorial-card-copy">
              <span class="tutorial-card-title">{flow.title}</span>
              <span class="muted-note">{flow.summary}</span>
              <span class="tutorial-meta num">About {flow.minutes} min</span>
            </span>
            {#if completed.has(flow.id)}
              <span class="done" role="img" aria-label="Completed"><Check size={18} /></span>
            {:else}
              <span class="start-label">Start</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>

    <div class="tutorial-actions">
      {#if progress.status === 'completed' || progress.status === 'skipped'}
        <button type="button" class="btn btn-ghost" onclick={restart}>Restart all</button>
      {:else}
        <button type="button" class="btn" onclick={() => startFlow(remaining[0] ?? flows[0])}>
          {progress.completedFlowIds.length > 0 ? 'Continue recommended tour' : 'Start recommended tour'}
        </button>
        <button type="button" class="btn btn-ghost" onclick={skipAll}>Skip tutorial</button>
      {/if}
    </div>
  {/if}
</section>

<style>
.tutorial {
  gap: var(--space-3);
}
.tutorial-heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tutorial-heading h3,
.tutorial-heading p,
.tutorial-step h4,
.tutorial-step p {
  margin: 0;
}
.tutorial-progress {
  block-size: 0.35rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface);
}
.tutorial-progress span {
  display: block;
  block-size: 100%;
  background: var(--accent);
}
.step-count {
  margin: calc(var(--space-2) * -1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.tutorial-step {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: var(--space-3);
  padding: var(--space-4);
}
.tutorial-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.exit {
  align-self: start;
}
.tutorial-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tutorial-card {
  display: flex;
  inline-size: 100%;
  min-block-size: var(--control-size);
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  color: inherit;
  text-align: start;
}
.tutorial-card-copy {
  display: flex;
  min-inline-size: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}
.tutorial-card-title {
  font-weight: 650;
}
.tutorial-meta,
.start-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.done {
  display: inline-flex;
  color: var(--ok);
}
</style>
