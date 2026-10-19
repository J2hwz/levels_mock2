import type { Session } from '../log/session';

export function backupKey(session: Session): string {
  const h = session.logger.header;
  return `levels-sandbox-${h.seed}-${h.started_at}`;
}

/** Best-effort backup into localStorage. Returns false if storage is unavailable or full. */
export function saveBackup(session: Session): boolean {
  try {
    localStorage.setItem(backupKey(session), JSON.stringify(session.toJSON()));
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

export function download(session: Session): void {
  const blob = new Blob([JSON.stringify(session.toJSON())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(session);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
