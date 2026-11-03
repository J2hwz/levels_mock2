// Participant notepad: a small panel at the bottom right of the world that can be shown and hidden at any time,
// in every phase. The text is reported (not per keystroke) when typing pauses, when the notepad is hidden, and at
// the end of the sandbox.

import { h } from './dom';

export type NotesReason = 'pause' | 'hide' | 'end';

/** typing pause after which the text is reported */
const PAUSE_MS = 2000;

export class Notepad {
  readonly el = h('div', { class: 'notepad', id: 'notepad' });
  text = '';
  private open = false;
  private logged = '';
  private timer = 0;
  // one textarea for the panel's whole life: hiding never loses text, caret or scroll position
  private readonly area = h('textarea', {
    id: 'notepad-text',
    rows: 8,
    placeholder: 'Write down anything you notice…',
    'aria-label': 'Notes',
  });
  private readonly openButton = h('button', { class: 'notepad-open', id: 'notepad-open' }, '✎ notepad');
  private readonly body = h('div', { class: 'notepad-body' });

  constructor(
    private readonly onToggle: (open: boolean) => void,
    private readonly onNotes: (text: string, reason: NotesReason) => void,
  ) {
    this.area.addEventListener('input', () => {
      this.text = this.area.value;
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.flush('pause'), PAUSE_MS);
    });
    this.openButton.addEventListener('click', () => this.setOpen(true));
    const hide = h('button', { class: 'link notepad-hide', id: 'notepad-hide', onclick: () => this.setOpen(false) }, 'hide');
    this.body.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Notes'), hide), this.area);
    this.el.append(this.openButton, this.body);
    this.render();
  }

  /** Report the text if it changed since it was last reported. */
  flush(reason: NotesReason): void {
    window.clearTimeout(this.timer);
    if (this.text === this.logged) return;
    this.logged = this.text;
    this.onNotes(this.text, reason);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    if (!open) this.flush('hide');
    this.open = open;
    this.onToggle(open);
    this.render();
    if (open) this.area.focus();
  }

  private render(): void {
    this.openButton.style.display = this.open ? 'none' : '';
    this.body.style.display = this.open ? '' : 'none';
    this.el.classList.toggle('open', this.open);
  }
}
