// SPDX-License-Identifier: AGPL-3.0-only
// Removes the password and all sessions so first-run setup runs again (a new setup code is printed on next server start).
import { ensureDirs } from '../config.ts';
import { migrate } from '../db.ts';
import { resetAuth } from '../auth.ts';

ensureDirs();
migrate();
resetAuth();
console.log('Password and sessions removed. Restart the server and check its log for the new setup code.');
