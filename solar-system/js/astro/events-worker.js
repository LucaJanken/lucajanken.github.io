// Eclipse and transit searches off the main thread, so that the list scrolls smoothly (events.js).
import * as A from '../../vendor/astronomy.min.js';
import { deltaT } from './deltat.js';
import { eventService } from './events.js';

A.SetDeltaTFunction(deltaT);   // as the page does (ephemeris.js): measured ΔT
const serve = eventService();
onmessage = e => postMessage(serve(e.data));
