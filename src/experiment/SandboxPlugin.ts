import { type JsPsych, type JsPsychPlugin, ParameterType, type TrialType } from 'jspsych';
import type { Config } from '../config';
import type { Session } from '../log/session';
import { runSandbox } from './sandboxApp';

const info = <const>{
  name: 'levels-sandbox',
  version: '0.0.1',
  parameters: {
    /** parsed URL config */
    config: { type: ParameterType.OBJECT, default: undefined },
    /** returns the Session that owns the world + log (created by the timeline so the end screen can download it) */
    getSession: { type: ParameterType.FUNCTION, default: undefined },
  },
  data: {
    final_hash: { type: ParameterType.STRING },
    final_tick: { type: ParameterType.INT },
    n_events: { type: ParameterType.INT },
    backup_saved: { type: ParameterType.BOOL },
  },
};

type Info = typeof info;

/** jsPsych plugin that mounts the Pixi sandbox and runs the three phases. */
export class SandboxPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private readonly jsPsych: JsPsych) {}

  async trial(display_element: HTMLElement, trial: TrialType<Info>): Promise<void> {
    const result = await runSandbox(display_element, (trial.getSession as () => Session)(), trial.config as Config);
    display_element.innerHTML = '';
    this.jsPsych.finishTrial({ ...result });
  }
}
