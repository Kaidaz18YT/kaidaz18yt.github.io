import PocketBase from 'pocketbase';
import { config } from '../config';

export const pb = new PocketBase(config.pocketbaseUrl);
// Several components refresh at once; don't let the SDK cancel earlier calls.
pb.autoCancellation(false);
