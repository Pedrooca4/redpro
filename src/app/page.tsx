import Link from "next/link";
import {
  ArrowRight,
  Bot,
  BookOpen,
  Box,
  Calculator,
  CircleDashed,
  Layers3,
  Network,
  Users,
  Zap,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CircuitScene } from "@/components/circuit-scene";
import { MODES } from "@/features/chat/config";
import { MODE_ICONS } from "@/features/chat/icons";

const features = [
  {
    icon: Bot,
    number: "01",
    title: "Ajuda para o jogo inteiro",
    description:
      "Planeje uma farm, entenda a lógica de um circuito e encontre caminhos para resolver o que não funciona.",
    tags: ["Construir", "Entender", "Corrigir"],
  },
  {
    icon: BookOpen,
    number: "02",
    title: "Conhecimento, bloco a bloco",
    description:
      "Uma biblioteca de projetos com materiais, etapas e compatibilidade. Informação organizada para acompanhar sua construção.",
    tags: ["Farms", "Mecanismos", "Tutoriais"],
  },
  {
    icon: Users,
    number: "03",
    title: "Boas ideias se multiplicam",
    description:
      "Um espaço para compartilhar suas construções, aprender com outros jogadores e evoluir os projetos juntos.",
    tags: ["Construções", "Trocas", "Comunidade"],
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo">
        <section className="hero shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" /> SEU PRÓXIMO MUNDO{" "}
              <span className="edition-label">/ EM CONSTRUÇÃO</span>
            </p>
            <h1 id="hero-title">
              Minecraft inteiro.
              <br />
              Uma ajuda{" "}
              <span className="title-last">
                inteligente
                <span className="pixel-period" aria-hidden="true" />.
              </span>
            </h1>
            <p className="hero-description">
              Farms, redstone, construções, mods, comandos e sobrevivência — para sua edição e
              versão.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/chat">
                Abrir assistente <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link className="button home-calculator-link" href="/ferramentas/materiais">
                <Calculator size={21} aria-hidden="true" />
                <span>
                  Calculadora de materiais
                  <small>Disponível · Java e Bedrock</small>
                </span>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className="hero-note">
              <CircleDashed size={16} aria-hidden="true" />
              <p>
                A disponibilidade da IA é informada no chat.
                <br />
                <span>Biblioteca e comunidade ainda em desenvolvimento.</span>
              </p>
            </div>
          </div>
          <figure className="hero-visual">
            <div className="visual-corner top-left" />
            <div className="visual-corner bottom-right" />
            <div className="visual-label">
              <span className="tiny-cross" aria-hidden="true">
                +
              </span>{" "}
              MINEPRO LAB <span>001</span>
            </div>
            <CircuitScene />
            <figcaption>
              <span className="redstone-dot" /> Ilustração conceitual • não é um esquema de montagem
            </figcaption>
          </figure>
        </section>
        <div className="principle-bar">
          <div className="shell principle-inner">
            <span>
              <Box size={17} aria-hidden="true" /> Feito para quem constrói
            </span>
            <span>
              <Layers3 size={17} aria-hidden="true" /> JavaMine e BedMine
            </span>
            <span>
              <Network size={17} aria-hidden="true" /> Fontes e compatibilidade em primeiro lugar
            </span>
          </div>
        </div>
        <section className="home-specialties shell" aria-labelledby="specialties-title">
          <p className="eyebrow">ESCOLHA SEU PRÓXIMO DESAFIO</p>
          <h2 id="specialties-title">Seis modos. Seu mundo inteiro.</h2>
          <p>Explore as especialidades na demonstração do assistente.</p>
          <div className="home-mode-grid">
            {MODES.map((mode) => {
              const Icon = MODE_ICONS[mode.id];
              return (
                <article key={mode.id}>
                  <p className="home-mode-label">
                    <Icon size={20} aria-hidden="true" />
                    {mode.id}
                  </p>
                  <h3>{mode.title}</h3>
                  <p>{mode.description}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section id="projeto" className="project-section shell" aria-labelledby="project-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                <span className="line-marker" /> O QUE ESTAMOS CONSTRUINDO
              </p>
              <h2 id="project-title">
                Menos tentativa e erro.
                <br />
                <span className="muted-title">Mais ideias ganhando forma.</span>
              </h2>
            </div>
            <p>
              Três partes de uma mesma ideia: tornar
              <br className="desktop-break" /> o Minecraft inteiro mais acessível.
              <br />
              <span className="planned-label">Recursos planejados</span>
            </p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, number, title, description, tags }) => (
              <article className="feature" key={number}>
                <div className="feature-top">
                  <span className="feature-icon">
                    <Icon size={23} aria-hidden="true" />
                  </span>
                  <span className="feature-number">/{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
                <ul className="feature-tags" aria-label="Temas previstos">
                  {tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
                <span className="feature-state">
                  <CircleDashed size={13} aria-hidden="true" /> Em uma próxima etapa
                </span>
              </article>
            ))}
          </div>
        </section>
        <section className="roadmap-section shell" id="etapas" aria-labelledby="roadmap-title">
          <div className="roadmap-intro">
            <p className="eyebrow">
              <Zap size={14} aria-hidden="true" /> DO PRIMEIRO BLOCO EM DIANTE
            </p>
            <h2 id="roadmap-title">
              Uma base sólida.
              <br />
              Depois, o próximo nível.
            </h2>
            <p>
              Cada etapa será implementada e verificada antes de avançar. Você pode acompanhar o que
              já existe e o que ainda falta.
            </p>
            <Link className="inline-link" href="/status">
              Ver o estado desta versão <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <ol className="roadmap">
            <li className="current">
              <span className="step-number">01</span>
              <div>
                <span className="step-kicker">ETAPA ATUAL</span>
                <h3>Interface do MinePRO</h3>
                <p>Chat demonstrativo, seis modos e seletores de edição e versão.</p>
              </div>
              <span className="current-badge">Agora</span>
            </li>
            <li>
              <span className="step-number">02</span>
              <div>
                <h3>Contas e dados</h3>
                <p>Autenticação, perfis e armazenamento seguro.</p>
              </div>
            </li>
            <li>
              <span className="step-number">03</span>
              <div>
                <h3>IA e projetos reais</h3>
                <p>Assistente especializado, fontes e biblioteca de projetos.</p>
              </div>
            </li>
            <li>
              <span className="step-number">04</span>
              <div>
                <h3>Construir em comunidade</h3>
                <p>Publicações, interações e troca de conhecimento.</p>
              </div>
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
