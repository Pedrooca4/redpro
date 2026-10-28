import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("./lib/report-error.ts");
    return reportError(...args);
  }
};
