import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, CircleDashed } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
export const metadata: Metadata = { title: "Estado do projeto" };
export default function StatusPage() {
  return (
    <>
      <SiteHeader statusPage />
      <main id="conteudo" className="shell status-page">
        <Link className="back-link" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> Voltar ao início
        </Link>
        <p className="eyebrow">
          <span className="status-dot" /> VERSÃO 0.1.0 • FUNDAÇÃO
        </p>
        <h1>
          O primeiro bloco
          <br />
          <span className="text-green">do RedPro.</span>
        </h1>
        <p className="status-lead">
          Esta é a primeira entrega do projeto. A base do site existe; os recursos de IA, biblioteca
          e comunidade serão construídos nas próximas etapas.
        </p>
        <div className="status-grid">
          <section className="status-panel">
            <span className="panel-label">
              <Check size={18} aria-hidden="true" /> DISPONÍVEL NESTA VERSÃO
            </span>
            <h2>A estrutura inicial</h2>
            <ul>
              <li>Página inicial e navegação responsiva.</li>
              <li>Identidade visual verde e preta.</li>
              <li>Aplicação Next.js com TypeScript.</li>
              <li>Endpoint para verificar se a aplicação responde.</li>
            </ul>
            <a className="inline-link" href="/api/health">
              Abrir verificação da aplicação <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <p className="small-note">
              O endpoint verifica apenas a aplicação. Não testa Supabase, GitHub, Vercel ou um
              provedor de IA.
            </p>
          </section>
          <section className="status-panel">
            <span className="panel-label pending">
              <CircleDashed size={18} aria-hidden="true" /> AINDA NÃO DISPONÍVEL
            </span>
            <h2>As próximas construções</h2>
            <ul>
              <li>Cadastro, login e perfis.</li>
              <li>Chat com IA e consulta a fontes.</li>
              <li>Biblioteca de farms e projetos.</li>
              <li>Publicações e interações da comunidade.</li>
            </ul>
            <p className="small-note">
              A integração com Supabase está preparada no código. Conexão, permissões e persistência
              ainda precisam ser configuradas e verificadas.
            </p>
          </section>
        </div>
        <div className="status-footnote">
          <span>RED-001</span>
          <p>
            Projeto base e documentação de execução. Esta versão não representa a conclusão do MVP.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
