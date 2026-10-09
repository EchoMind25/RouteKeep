import type { Instrumentation } from "next";

// OPS-03: server request failures become scrubbed error.server events
// (lib/telemetry/server-error.ts). Node runtime only: the database client
// does not run on the edge. Reporting never throws.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // eslint-disable-next-line no-restricted-syntax -- the runtime name is set by Next.js, not configuration
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reportServerError } = await import("./lib/telemetry/server-error");
    await reportServerError(error, request, context);
  } catch {
    // Never let reporting fail the request's own error handling.
  }
};
