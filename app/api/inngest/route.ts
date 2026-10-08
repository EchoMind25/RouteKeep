import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/generation";
import { messagingFunctions } from "@/inngest/messaging";

// Inngest calls this endpoint to run each step; requests are signed with
// INNGEST_SIGNING_KEY in production and rejected otherwise.
export const { GET, POST, PUT } = serve({ client: inngest, functions: [...functions, ...messagingFunctions] });
