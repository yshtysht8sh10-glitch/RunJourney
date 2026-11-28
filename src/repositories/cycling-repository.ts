import { CyclingRecorder } from './cycling-recorder';
import { cyclingDatabase } from './cycling-database';
/** Independent lifetime; Running's RAM queues and checkpoints never point here. */
export const CyclingRepository = new CyclingRecorder(cyclingDatabase);
