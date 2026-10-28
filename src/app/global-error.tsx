"use client";

import { ErrorState } from "../components/error-state";
import "../styles/globals.css";

// This boundary replaces the root layout, so it must include html and body.
export default function GlobalError() {
  return (
    <html lang="pt-BR">
      <body>
        <ErrorState reset={() => window.location.reload()} />
      </body>
    </html>
  );
}
