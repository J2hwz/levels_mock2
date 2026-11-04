// Generalisation tasks (after the Report): each starts with an empty world (same seed, so the same laws and
// recipes as exploration) and a palette of all 12 elements. Participants drop things in and try to make a named
// effect happen within the time limit. Success = the target mechanism at the target scale; everything else
// (another scale, combining) is logged but does not count.

import type { SimEvent } from '../sim/world';

export type TaskKey = 'lock' | 'catalysis';

// =====================================================================================================
// TUNE: the generalisation tasks. Prompts describe only the effect, never which elements or scale.
// =====================================================================================================
export const GEN = {
  /** task order */
  order: ['lock', 'catalysis'] as TaskKey[],
  /** time per task */
  durationMs: 60_000,
  /** most elements a participant can drop into one task world */
  maxSpawns: 30,
  intro:
    'Now two short tasks. Each one starts with an empty world. Drag things from the panel on the right into the ' +
    'world and try to make something happen. You have 1 minute for each task.',
  palette: 'Drag these into the world',
  success: 'Done! You made it happen. Press Continue when you are ready.',
  outOfSpawns: 'You have used all the things you can add.',
  tasks: {
    // target: the mechanism (rule) and level (tier: 0 cells, 1 organisms, 2 herds) that counts as success
    lock: { prompt: 'Make two things stick together.', target: { rule: 'lock', tier: 0 } },
    catalysis: { prompt: 'Make something start spinning.', target: { rule: 'catalysis', tier: 1 } },
  } as Record<TaskKey, { prompt: string; target: { rule: 'lock' | 'catalysis'; tier: number } }>,
};

/** Did this sim event achieve the task: its target mechanism took effect at its target level? */
export function isTaskSuccess(task: TaskKey, e: SimEvent): boolean {
  const { rule, tier } = GEN.tasks[task].target;
  return e.kind === 'encounter' && e.ok && e.rule === rule && e.tier === tier;
}
