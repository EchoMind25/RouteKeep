// Runs appointment generation for every tenant, the same code the nightly job
// runs. Used after `npm run db:reset` so the demo schedule has visits.
//   tsx --conditions=react-server --env-file=.env.local scripts/generate-demo-visits.ts
import { generateAll } from "@/lib/jobs/generate-appointments";
import { pool } from "@/lib/db/client";

const started = Date.now();
const result = await generateAll();
console.log(`generated ${result.created} visits for ${result.subscriptions} subscriptions in ${Date.now() - started} ms`);
await pool().destroy();
