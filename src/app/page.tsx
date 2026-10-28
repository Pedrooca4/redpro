import Link from "next/link";
import { ArrowDown, ArrowRight, Bot, BookOpen, Box, CircleDashed, Layers3, Network, Users, Zap } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CircuitScene } from "@/components/circuit-scene";

const features = [
  { icon: Bot, number: "01", title: "Uma IA que entende redstone", description: "Planeje uma farm, entenda a lógica de um circuito e encontre caminhos para resolver o que não funciona.", tags: ["Construir", "Entender", "Corrigir"] },
  { icon: BookOpen, number: "02", title: "Conhecimento, bloco a bloco", description: "Uma biblioteca de projetos com materiais, etapas e compatibilidade. Informação organizada para acompanhar sua construção.", tags: ["Farms", "Mecanismos", "Tutoriais"] },
  { icon: Users, number: "03", title: "Boas ideias se multiplicam", description: "Um espaço para compartilhar suas construções, aprender com outros jogadores e evoluir os projetos juntos.", tags: ["Construções", "Trocas", "Comunidade"] },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo">
        <section className="hero shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="status-dot" /> LABORATÓRIO DE REDSTONE <span className="edition-label">/ EM CONSTRUÇÃO</span></p>
            <h1 id="hero-title">Sua próxima farm<br />começa <span className="title-last">aqui<span className="pixel-period" aria-hidden="true" />.</span></h1>
            <p className="hero-description">Da primeira alavanca à sua próxima grande ideia.<br className="desktop-break" /> Estamos construindo um lugar para criar, entender<br className="desktop-break" /> e ir além com redstone.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#projeto">Conheça o RedPro <ArrowRight size={18} aria-hidden="true" /></a>
              <a className="button button-text" href="#etapas">Veja o que vem a seguir <ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <div className="hero-note"><CircleDashed size={16} aria-hidden="true" /><p>Primeira etapa disponível.<br /><span>IA, biblioteca e comunidade ainda não estão disponíveis.</span></p></div>
          </div>
          <figure className="hero-visual">
            <div className="visual-corner top-left" /><div className="visual-corner bottom-right" />
            <div className="visual-label"><span className="tiny-cross" aria-hidden="true">+</span> REDSTONE LAB <span>001</span></div>
            <CircuitScene />
            <figcaption><span className="redstone-dot" /> Ilustração conceitual • não é um esquema de montagem</figcaption>
          </figure>
        </section>
        <div className="principle-bar">
          <div className="shell principle-inner">
            <span><Box size={17} aria-hidden="true" /> Feito para quem constrói</span>
            <span><Layers3 size={17} aria-hidden="true" /> Java & Bedrock no planejamento</span>
            <span><Network size={17} aria-hidden="true" /> Fontes e compatibilidade em primeiro lugar</span>
          </div>
        </div>
        <section id="projeto" className="project-section shell" aria-labelledby="project-title">
          <div className="section-heading">
            <div><p className="eyebrow"><span className="line-marker" /> O QUE ESTAMOS CONSTRUINDO</p><h2 id="project-title">Menos tentativa e erro.<br /><span className="muted-title">Mais ideias ganhando forma.</span></h2></div>
            <p>Três partes de uma mesma ideia: tornar<br className="desktop-break" /> o universo da redstone mais acessível.<br /><span className="planned-label">Recursos planejados</span></p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, number, title, description, tags }) => (
              <article className="feature" key={number}>
                <div className="feature-top"><span className="feature-icon"><Icon size={23} aria-hidden="true" /></span><span className="feature-number">/{number}</span></div>
                <h3>{title}</h3><p>{description}</p>
                <ul className="feature-tags" aria-label="Temas previstos">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>
                <span className="feature-state"><CircleDashed size={13} aria-hidden="true" /> Em uma próxima etapa</span>
              </article>
            ))}
          </div>
        </section>
        <section className="roadmap-section shell" id="etapas" aria-labelledby="roadmap-title">
          <div className="roadmap-intro"><p className="eyebrow"><Zap size={14} aria-hidden="true" /> DO PRIMEIRO BLOCO EM DIANTE</p><h2 id="roadmap-title">Uma base sólida.<br />Depois, o próximo nível.</h2><p>Cada etapa será implementada e verificada antes de avançar. Você pode acompanhar o que já existe e o que ainda falta.</p><Link className="inline-link" href="/status">Ver o estado desta versão <ArrowRight size={17} aria-hidden="true" /></Link></div>
          <ol className="roadmap">
            <li className="current"><span className="step-number">01</span><div><span className="step-kicker">ETAPA ATUAL</span><h3>Fundação do RedPro</h3><p>Projeto base, identidade visual inicial e preparação das integrações.</p></div><span className="current-badge">Agora</span></li>
            <li><span className="step-number">02</span><div><h3>Contas e dados</h3><p>Autenticação, perfis e armazenamento seguro.</p></div></li>
            <li><span className="step-number">03</span><div><h3>IA e projetos reais</h3><p>Assistente especializado, fontes e biblioteca de farms.</p></div></li>
            <li><span className="step-number">04</span><div><h3>Construir em comunidade</h3><p>Publicações, interações e troca de conhecimento.</p></div></li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
