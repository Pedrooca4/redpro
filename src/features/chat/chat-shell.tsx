"use client";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Blocks,
  ChevronRight,
  Menu,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { EDITIONS, MODES, TOOLS, suggestionsFor } from "./config";
import { chatReducer, initialChatState, MESSAGE_LIMIT } from "./state";
import { AppSidebar } from "./app-sidebar";
import { EditionSwitcher, SpecialtyModePicker, VersionSelect } from "./chat-controls";
import { ChatMessage, ToolResultPanel } from "./chat-presentation";
import { PrototypeDialog } from "./prototype-dialog";
import { MODE_ICONS } from "./icons";

export function ChatShell() {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [activeTool, setActiveTool] = useState<Exclude<
    (typeof TOOLS)[number],
    { href: string }
  > | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const busy = state.phase === "previewing";
  const mode = MODES.find((entry) => entry.id === state.context.mode)!;
  const Icon = MODE_ICONS[mode.id];
  useEffect(() => {
    if (!busy) return;
    // Local preview only: this timer never calls an API or generates an AI answer.
    const timer = window.setTimeout(() => {
      dispatch({ type: failNext ? "fail" : "complete" });
      setFailNext(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busy, failNext]);
  useEffect(() => {
    if (state.messages.length)
      messages.current?.scrollTo({ top: messages.current.scrollHeight, behavior: "instant" });
  }, [state.messages.length]);
  function newConversation() {
    dispatch({ type: "new" });
    setDrawer(false);
    textarea.current?.focus();
  }
  function prepare(text: string) {
    dispatch({ type: "draft", value: text });
    textarea.current?.focus();
  }
  return (
    <div className="chat-app">
      <aside className="desktop-sidebar" aria-label="Barra lateral">
        <AppSidebar onNew={newConversation} onSettings={() => setSettings(true)} />
      </aside>
      <div className="chat-workspace">
        <header className="chat-topbar">
          <div className="chat-heading">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              aria-expanded={drawer}
              onClick={() => setDrawer(true)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <div>
              <p>SEU ESPAÇO DE IDEIAS</p>
              <h1>
                Assistente MinePRO <span className="prototype-pill">Protótipo</span>
              </h1>
            </div>
          </div>
          <div className="context-controls">
            <div>
              <span className="control-label">Edição do Minecraft</span>
              <EditionSwitcher context={state.context} dispatch={dispatch} disabled={busy} />
            </div>
            <VersionSelect
              key={state.context.edition}
              context={state.context}
              dispatch={dispatch}
              disabled={busy}
            />
          </div>
        </header>
        <main id="conteudo" className="chat-main">
          <div className="prototype-notice">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Esta é uma demonstração da interface; a IA real será conectada em uma etapa futura.
            </p>
          </div>
          <div className="chat-scroll" ref={messages} tabIndex={0} aria-label="Área de mensagens">
            <div className="chat-content">
              {state.messages.length === 0 ? (
                <section className="chat-welcome" aria-labelledby="welcome-title">
                  <div className="welcome-mark" aria-hidden="true">
                    <Blocks size={34} strokeWidth={1.5} />
                  </div>
                  <p className="eyebrow">UM MUNDO DE POSSIBILIDADES</p>
                  <h2 id="welcome-title">
                    O que vamos
                    <br />
                    <span>construir hoje?</span>
                  </h2>
                  <p>
                    Da sua primeira base ao próximo grande mecanismo.
                    <br />
                    Escolha um modo e dê o primeiro passo.
                  </p>
                  <div className="active-specialty">
                    <Icon size={17} aria-hidden="true" />
                    <strong>{mode.title}</strong>
                    <span>{EDITIONS[state.context.edition].label}</span>
                  </div>
                  <div className="suggestion-grid">
                    {suggestionsFor(state.context).map((question) => (
                      <button
                        type="button"
                        key={question}
                        onClick={() => prepare(question)}
                        disabled={busy}
                      >
                        <span>{question}</span>
                        <ArrowUpRight size={18} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="message-list" aria-label="Mensagens locais">
                  {state.messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  <p className="no-ai-answer">
                    Protótipo: respostas de IA ainda não estão disponíveis.
                  </p>
                </section>
              )}
              <section className="tools-section" aria-labelledby="tools-title">
                <div className="tools-heading">
                  <h2 id="tools-title">
                    <Wrench size={16} aria-hidden="true" />
                    Sua bancada de ferramentas
                  </h2>
                  <span>1 disponível · 5 prévias</span>
                </div>
                <div className="tool-grid">
                  {TOOLS.map((tool) =>
                    "href" in tool ? (
                      <Link key={tool.id} href={tool.href} className="tool-available">
                        <span>{tool.name}</span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        key={tool.id}
                        disabled={busy}
                        onClick={() => setActiveTool(tool)}
                      >
                        <span>{tool.name}</span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    ),
                  )}
                </div>
              </section>
            </div>
          </div>
          <div className="composer-area">
            <div className="context-announcement" role="status" aria-live="polite">
              {state.notice}
            </div>
            {state.error ? (
              <p className="composer-error" role="alert">
                {state.error}
              </p>
            ) : null}
            <form
              aria-busy={busy}
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                dispatch({ type: "submit" });
              }}
            >
              <SpecialtyModePicker mode={state.context.mode} dispatch={dispatch} disabled={busy} />
              <label htmlFor="chat-draft" className="composer-label">
                Sua mensagem · {mode.title}
              </label>
              <div className="composer-input-row">
                <textarea
                  ref={textarea}
                  id="chat-draft"
                  rows={2}
                  value={state.draft}
                  readOnly={busy}
                  aria-invalid={!!state.error}
                  aria-describedby="composer-help composer-count"
                  placeholder={`O que você quer explorar com ${EDITIONS[state.context.edition].label}?`}
                  onChange={(event) => dispatch({ type: "draft", value: event.target.value })}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (!busy) event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-button"
                  disabled={busy || !state.draft.trim()}
                  aria-label={busy ? "Exibindo mensagem local" : "Enviar mensagem de demonstração"}
                >
                  <ArrowUp size={21} aria-hidden="true" />
                </button>
              </div>
              <div className="composer-bottom">
                <p id="composer-help" aria-live="polite">
                  {busy ? "Exibindo mensagem local…" : "Enter envia · Shift+Enter quebra linha"}
                </p>
                <span id="composer-count">
                  {state.draft.length}/{MESSAGE_LIMIT}
                </span>
              </div>
            </form>
            <p className="composer-footnote">
              {EDITIONS[state.context.edition].description} ·{" "}
              {state.context.game_version ?? "Versão não informada"}
              <br />
              Mensagens locais e temporárias. Não envie dados pessoais.
            </p>
          </div>
        </main>
      </div>
      <PrototypeDialog
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Navegação MinePRO"
        drawer
      >
        <AppSidebar
          onNew={newConversation}
          onSettings={() => {
            setDrawer(false);
            setSettings(true);
          }}
          onNavigate={() => setDrawer(false)}
        />
      </PrototypeDialog>
      <PrototypeDialog
        open={settings}
        onClose={() => setSettings(false)}
        title="Configurações da demonstração"
      >
        <p>
          As escolhas de edição, versão e modo permanecem apenas enquanto esta página estiver
          aberta. Não há conta ou histórico salvo.
        </p>
        <label className="demo-failure-toggle">
          <input
            type="checkbox"
            checked={failNext}
            disabled={busy}
            onChange={(event) => setFailNext(event.target.checked)}
          />
          Simular falha na próxima mensagem local
        </label>
        <p className="small-note">
          Teste de interface: a falha mantém seu rascunho e permite tentar novamente. Nenhum serviço
          externo será chamado.
        </p>
      </PrototypeDialog>
      <PrototypeDialog
        open={!!activeTool}
        onClose={() => setActiveTool(null)}
        title={activeTool?.name ?? "Ferramenta"}
      >
        {activeTool ? (
          <ToolResultPanel title={activeTool.name} state="unavailable">
            <p>{activeTool.description}</p>
            <p className="tool-limitation">{activeTool.limit}</p>
            <p>
              Esta prévia apresenta a ferramenta. Ainda não executa cálculos, análises ou
              verificações.
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                dispatch({ type: "prepare", text: activeTool.question, mode: activeTool.mode });
                setActiveTool(null);
                window.requestAnimationFrame(() => textarea.current?.focus());
              }}
            >
              Preparar pergunta
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </ToolResultPanel>
        ) : null}
      </PrototypeDialog>
    </div>
  );
}
