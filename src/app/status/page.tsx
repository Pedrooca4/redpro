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
          <span className="status-dot" /> PROTÓTIPO • INTERFACE EM EVOLUÇÃO
        </p>
        <h1>
          Uma nova interface
          <br />
          <span className="text-green">do MinePRO.</span>
        </h1>
        <p className="status-lead">
          A interface demonstrativa permite escolher edição, versão e especialidade. IA real,
          contas, biblioteca e comunidade continuam em desenvolvimento.
        </p>
        <div className="status-grid">
          <section className="status-panel">
            <span className="panel-label">
              <Check size={18} aria-hidden="true" /> DISPONÍVEL NESTA VERSÃO
            </span>
            <h2>A estrutura inicial</h2>
            <ul>
              <li>Página inicial e navegação responsiva.</li>
              <li>Identidade visual MinePRO em obsidiana e esmeralda.</li>
              <li>Chat local, JavaMine/BedMine, versão e seis modos.</li>
              <li>
                <Link className="inline-link" href="/ferramentas/materiais">
                  Calculadora de materiais
                </Link>{" "}
                com estimativas de blocos, stacks e slots.
              </li>
              <li>Prévias das demais ferramentas.</li>
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
              <li>Biblioteca de projetos de Minecraft.</li>
              <li>Publicações e interações da comunidade.</li>
            </ul>
            <p className="small-note">
              O site público não consome banco de dados. A preparação técnica existente não implica
              contas ou persistência de mensagens.
            </p>
          </section>
        </div>
        <div className="status-footnote">
          <span>MinePRO</span>
          <p>Interface demonstrativa. Esta versão não representa a conclusão do MVP.</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
