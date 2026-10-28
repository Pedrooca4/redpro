"use client";

import { ERROR_SCREEN } from "../lib/error-presentation";

export function ErrorState({ reset }: { reset: () => void }) {
  return (
    <main id="conteudo" className="shell status-page" aria-labelledby="error-title">
      <p className="eyebrow">REDPRO • ERRO INESPERADO</p>
      <h1 id="error-title">{ERROR_SCREEN.title}</h1>
      <p className="status-lead" role="alert">
        {ERROR_SCREEN.description}
      </p>
      <div className="hero-actions">
        <button type="button" className="button button-primary" onClick={reset}>
          {ERROR_SCREEN.retry}
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Full document navigation recovers even when the root router failed. */}
        <a className="button button-text" href="/">
          {ERROR_SCREEN.home}
        </a>
      </div>
    </main>
  );
}
