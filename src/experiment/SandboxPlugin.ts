import { type JsPsych, type JsPsychPlugin, ParameterType, type TrialType } from 'jspsych';
import type { Config } from '../config';
import type { Session } from '../log/session';
import type { TaskKey } from './generalisation';
import { runSandbox } from './sandboxApp';

const info = <const>{
  name: 'levels-sandbox',
  version: '0.0.1',
  parameters: {
    /** parsed URL config */
    config: { type: ParameterType.OBJECT, default: undefined },
    /** returns the Session that owns the world + log (created by the timeline so the end screen can download it) */
    getSession: { type: ParameterType.FUNCTION, default: undefined },
    /** set for a generalisation task ('lock' | 'catalysis'): an empty world with a palette, see generalisation.ts */
    task: { type: ParameterType.STRING, default: null },
  },
  data: {
    final_hash: { type: ParameterType.STRING },
    final_tick: { type: ParameterType.INT },
    n_events: { type: ParameterType.INT },
    backup_saved: { type: ParameterType.BOOL },
  },
};

type Info = typeof info;

/** jsPsych plugin that mounts the Pixi sandbox: Explore + Report, or one generalisation task. */
export class SandboxPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private readonly jsPsych: JsPsych) {}

  async trial(display_element: HTMLElement, trial: TrialType<Info>): Promise<void> {
    const task = (trial.task ?? undefined) as TaskKey | undefined;
    const result = await runSandbox(display_element, (trial.getSession as () => Session)(), trial.config as Config, task);
    display_element.innerHTML = '';
    this.jsPsych.finishTrial({ ...result });
  }
}
