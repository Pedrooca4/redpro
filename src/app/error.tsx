"use client";

import { ErrorState } from "../components/error-state";

// Never render or log error.message, error.stack or arbitrary digest data.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState reset={reset} />;
}
