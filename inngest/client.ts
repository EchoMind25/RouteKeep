import { Inngest } from "inngest";

// D-04: long work runs as durable steps. The SDK reads INNGEST_EVENT_KEY and
// INNGEST_SIGNING_KEY from the environment in production; locally it talks to
// the Inngest dev server (`npx inngest-cli@latest dev`) when that is running.
export const inngest = new Inngest({ id: "routeverde" });
