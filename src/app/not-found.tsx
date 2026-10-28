import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
export default function NotFound() {
  return (
    <>
      <SiteHeader homePage={false} />
      <main id="conteudo" className="shell status-page">
        <p className="eyebrow">404 • CAMINHO NÃO ENCONTRADO</p>
        <h1>
          Este bloco
          <br />
          ainda não existe.
        </h1>
        <p className="status-lead">
          A página não foi encontrada. Volte ao início para conhecer o projeto.
        </p>
        <Link className="button button-primary" href="/">
          Voltar ao início
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
