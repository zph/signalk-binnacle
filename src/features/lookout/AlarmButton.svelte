<script lang="ts">
import Bell from '@lucide/svelte/icons/bell';
import BellOff from '@lucide/svelte/icons/bell-off';
import type { AlarmButtonGrade } from './notification-actions';

interface Props {
  grade: AlarmButtonGrade;
  count: number;
  onOpen: () => void;
  lowKey?: boolean;
}

const { grade, count, onOpen, lowKey = false }: Props = $props();
const activeLabel = $derived(
  count === 0 ? '' : `, ${count} active ${count === 1 ? 'notification' : 'notifications'}`,
);
</script>

<button
  type="button"
  class="btn btn-pill alarm-button"
  class:alarm-button--alert={grade === 'alert'}
  class:alarm-button--alarm={grade === 'alarm'}
  aria-label={`Open alarms${activeLabel}${lowKey ? ', low-key navigation alarms on' : ''}`}
  title={lowKey ? 'Low-key navigation alarms on. Open alarms' : 'Open alarms'}
  onclick={onOpen}
>
  {#if lowKey}
    <BellOff size={16} aria-hidden="true" />
  {:else}
    <Bell size={16} aria-hidden="true" />
  {/if}
</button>

<style>
.alarm-button {
  opacity: 0.72;
}
.alarm-button--alert {
  border-color: var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
  animation: alarm-button-pulse 1.4s ease-in-out infinite;
}
.alarm-button--alarm {
  border-color: var(--alarm);
  background: var(--alarm-tint);
  color: var(--alarm);
  animation: alarm-button-pulse 1.1s ease-in-out infinite;
}
@keyframes alarm-button-pulse {
  0%,
  100% {
    opacity: 0.62;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .alarm-button--alert,
  .alarm-button--alarm {
    opacity: 1;
    animation: none;
  }
}
</style>
