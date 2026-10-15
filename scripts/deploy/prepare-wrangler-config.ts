#!/usr/bin/env tsx

/**
 * Materializes `wrangler.jsonc` for a deploy.
 *
 * Runs first in `continuous-deployment.yml`. All the logic lives in
 * `lib/wrangler-config/`; this file is only the ordered sequence — plus the one
 * thing that is not a call.
 */

import { applyTopLevelPatch, applyVarsPatch, prepareConfigFile } from '../lib/wrangler-config/patches';
import { provisionWranglerResources } from '../lib/wrangler-config/resources';
import { ensureConfigCoversTemplate } from '../lib/wrangler-config/template-coverage';

// Order matters: the file must exist before it can be patched, and coverage is
// checked after both patches so a var supplied by `WRANGLER_VARS_PATCH_JSON`
// counts the same as one carried in the file. Resources are provisioned last so
// they see the patched values — and after the check, so a config that cannot
// deploy never creates a D1 database or a Secrets Store on the way to finding out.
prepareConfigFile();
applyTopLevelPatch();
applyVarsPatch();
ensureConfigCoversTemplate();
provisionWranglerResources();

console.log('Wrangler configuration is ready.');
