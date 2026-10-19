import 'jspsych/css/jspsych.css';
import './style.css';
import { parseConfig } from './config';
import { run } from './experiment/timeline';

const cfg = parseConfig(window.location.search);
document.title = `Levels sandbox${cfg.debug ? ' [debug]' : ''}`;
run(cfg);
