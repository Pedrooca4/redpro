import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";
export function PlannedPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <SiteHeader homePage={false} />
      <main id="conteudo" className="shell status-page planned-page">
        <p className="eyebrow">MINEPRO · EM DESENVOLVIMENTO</p>
        <h1>{title}</h1>
        <p className="status-lead">{description}</p>
        <p>Contas, publicação e armazenamento ainda não estão disponíveis.</p>
        <div className="hero-actions">
          <Link href="/chat" className="button button-primary">
            Explorar o assistente
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link href="/status" className="inline-link">
            Ver estado do projeto
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
