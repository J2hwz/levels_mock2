// Owns the world state and the event log. Every participant action goes through
// act(); every sim tick through tick(). No Pixi / DOM here, so tests can drive it.

import type { Config } from '../config';
import { simConfigOf } from '../config';
import { hashWorld } from '../sim/hash';
import { type Action, type SimEvent, type WorldState, applyAction, createWorld, snapshotWorld, step } from '../sim/world';
import { Logger, type SessionHeader, type SessionLog } from './logger';

export const HASH_EVERY_TICKS = 30; // 1 s of sim time
export const SNAPSHOT_EVERY_TICKS = 300; // 10 s of sim time

export interface SessionEnv {
  userAgent: string;
  screen: SessionHeader['screen'];
  startedAt: string;
}

export class Session {
  readonly state: WorldState;
  readonly logger: Logger;

  constructor(
    readonly config: Config,
    env: SessionEnv,
    now?: () => number,
  ) {
    this.state = createWorld(simConfigOf(config));
    const header: SessionHeader = {
      app: 'levels-sandbox',
      version: __APP_VERSION__,
      git_hash: __GIT_HASH__,
      started_at: env.startedAt,
      seed: config.seed,
      config: { ...config },
      user_agent: env.userAgent,
      screen: env.screen,
    };
    this.logger = new Logger(header, () => this.state.tick, now);
    this.logger.log('session_start', { hash: hashWorld(this.state) });
    this.logger.log('snapshot', snapshotWorld(this.state));
  }

  log(type: string, payload: unknown = null): void {
    this.logger.log(type, payload);
  }

  act(a: Action): SimEvent[] {
    this.logger.log('action', a);
    const evs = applyAction(this.state, a);
    this.logSimEvents(evs);
    return evs;
  }

  tick(): SimEvent[] {
    const evs = step(this.state, []);
    this.logSimEvents(evs);
    const t = this.state.tick;
    if (t % HASH_EVERY_TICKS === 0) this.logger.log('hash', { hash: hashWorld(this.state) });
    if (t % SNAPSHOT_EVERY_TICKS === 0) this.logger.log('snapshot', snapshotWorld(this.state));
    return evs;
  }

  end(): string {
    const hash = hashWorld(this.state);
    this.logger.log('snapshot', snapshotWorld(this.state));
    this.logger.log('session_end', { tick: this.state.tick, hash });
    return hash;
  }

  toJSON(): SessionLog {
    return this.logger.toJSON();
  }

  private logSimEvents(evs: SimEvent[]): void {
    for (const e of evs) this.logger.log(e.kind, e);
  }
}
