// Queues tomorrow's reminders and sends what the outbox holds (FR-MSG-01): `npm run messages:run`.
import { remindAll } from "@/lib/jobs/daily";

const r = await remindAll();
console.log(`reminders queued: ${r.queued}; sent ${r.sent.sent}, held back ${r.sent.suppressed}, failed ${r.sent.failed}, retrying ${r.sent.retry}`);
process.exit(0);
