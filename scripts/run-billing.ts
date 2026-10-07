// Runs the nightly billing job by hand (FR-BIL-03): `npm run billing:run`.
import { billAll } from "@/lib/jobs/billing";

const results = await billAll();
for (const r of results) {
  if (r.invoicesCreated || r.paymentsPosted || r.failures.length) {
    console.log(`${r.tenantId}: ${r.invoicesCreated} invoices, ${r.paymentsPosted} payments posted, ${r.invoicesPaid} paid, ${r.failures.length} failed`);
  }
}
console.log(`billed ${results.length} businesses`);
process.exit(0);
