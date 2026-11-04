import type { Session } from '../log/session';

export function backupKey(session: Session): string {
  const h = session.logger.header;
  return `levels-sandbox-${h.seed}-${h.started_at}`;
}

/** The data file: the main session's log, plus one ordinary log per generalisation task (each replayable). */
export function dataFile(session: Session, tasks: Session[] = []): unknown {
  return { ...session.toJSON(), generalisation: tasks.map((t) => t.toJSON()) };
}

/** Best-effort backup into localStorage. Returns false if storage is unavailable or full. */
export function saveBackup(session: Session, tasks: Session[] = []): boolean {
  try {
    localStorage.setItem(backupKey(session), JSON.stringify(dataFile(session, tasks)));
    localStorage.setItem('levels-sandbox-last', backupKey(session));
    return true;
  } catch {
    return false;
  }
}

export function fileName(session: Session): string {
  const h = session.logger.header;
  const ts = h.started_at.replace(/\.\d+Z$/, 'Z').replace(/[:]/g, '-');
  return `levels-sandbox-${h.seed}-${ts}.json`;
}

export function download(session: Session, tasks: Session[] = []): void {
  const blob = new Blob([JSON.stringify(dataFile(session, tasks))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(session);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
