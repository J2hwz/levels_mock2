import HtmlButtonResponse from '@jspsych/plugin-html-button-response';
import Instructions from '@jspsych/plugin-instructions';
import { type JsPsych, initJsPsych } from 'jspsych';
import type { Config } from '../config';
import { Session } from '../log/session';
import { SandboxPlugin } from './SandboxPlugin';
import { download, fileName, saveBackup } from './storage';

export function buildSession(cfg: Config): Session {
  return new Session(cfg, {
    userAgent: navigator.userAgent,
    screen: {
      width: screen.width,
      height: screen.height,
      dpr: window.devicePixelRatio || 1,
      viewport_w: window.innerWidth,
      viewport_h: window.innerHeight,
    },
    startedAt: new Date().toISOString(),
  });
}

export function run(cfg: Config): JsPsych {
  const jsPsych = initJsPsych();
  let session: Session | null = null;
  const minutes = Math.round(cfg.exploreMs / 6000) / 10;

  const welcome = {
    type: HtmlButtonResponse,
    stimulus: `<div class="prose"><h1>Welcome</h1>
      <p>In this study you will explore a small world full of made-up living things.
      Nothing in it comes from Earth, so there is nothing you are expected to already know.</p>
      <p>This is a test version. It takes about ${Math.ceil(minutes) + 5} minutes.</p></div>`,
    choices: ['Begin'],
  };

  const instructions = {
    type: Instructions,
    show_clickable_nav: true,
    pages: [
      `<div class="prose"><h2>Looking around</h2>
        <ul>
          <li><b>Hover</b> over something to highlight it. <b>Click</b> to select it.</li>
          <li><b>Click again</b> on the same spot to select something bigger that it is part of.</li>
          <li><b>Esc</b> clears the selection.</li>
          <li><b>Scroll</b> to zoom. <b>Drag the background</b> to move around.</li>
          <li>Use the time buttons at the top to pause, slow down or speed up.</li>
        </ul></div>`,
      `<div class="prose"><h2>Doing things</h2>
        <ul>
          <li><b>Drag</b> a selected thing to move it.</li>
          <li><b>Shift + drag</b> a selected thing to pull it out of whatever it is in.</li>
          <li><b>Drop</b> a loose thing onto something else and it may join it.</li>
          <li>Press <b>I</b> to freeze everything except the selected thing. Press I again to unfreeze.</li>
        </ul></div>`,
      `<div class="prose"><h2>Your first task</h2>
        <p>For about ${minutes} minute${minutes === 1 ? '' : 's'}, just <b>explore</b>. Watch, poke and try things out.
        Try to work out how this world works.</p>
        <p>Some things carry a small bar. If a bar runs out, that thing falls apart. You can help if you like,
        but exploring is what matters most.</p></div>`,
    ],
    on_finish: () => {
      session = buildSession(cfg);
    },
  };

  const sandbox = {
    type: SandboxPlugin,
    config: cfg,
    getSession: () => session,
  };

  const end = {
    type: HtmlButtonResponse,
    stimulus: () => `<div class="prose"><h1>Thank you!</h1>
      <p>That's the end of this test run. Please download your data file.</p>
      <p class="muted">A backup copy is also kept in this browser's local storage.</p>
      <p><button id="download-data" class="jspsych-btn">Download data</button></p>
      <p class="muted" id="download-name">${session ? fileName(session) : ''}</p></div>`,
    choices: [],
    on_load: () => {
      document.getElementById('download-data')?.addEventListener('click', () => {
        if (!session) return;
        session.log('download', { file: fileName(session) });
        saveBackup(session);
        download(session);
      });
    },
  };

  void jsPsych.run([welcome, instructions, sandbox, end]);
  return jsPsych;
}
