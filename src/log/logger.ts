// One in-memory event stream. Each event is {t_tick, t_ms, type, payload}.

export interface LogEvent {
  t_tick: number;
  t_ms: number;
  type: string;
  payload: unknown;
}

export interface SessionHeader {
  app: string;
  version: string;
  git_hash: string;
  started_at: string;
  seed: number;
  config: Record<string, unknown>;
  user_agent: string;
  screen: { width: number; height: number; dpr: number; viewport_w: number; viewport_h: number };
}

export interface SessionLog {
  header: SessionHeader;
  events: LogEvent[];
}

export class Logger {
  readonly events: LogEvent[] = [];
  private readonly t0: number;

  constructor(
    readonly header: SessionHeader,
    private readonly tick: () => number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.t0 = now();
  }

  log(type: string, payload: unknown = null): LogEvent {
    const ev: LogEvent = {
      t_tick: this.tick(),
      t_ms: Math.round((this.now() - this.t0) * 10) / 10,
      type,
      payload,
    };
    this.events.push(ev);
    return ev;
  }

  toJSON(): SessionLog {
    return { header: this.header, events: this.events };
  }

  /** Events as JSON lines (one event per line). */
  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n');
  }
}
