"use client";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Blocks,
  Calculator,
  ChevronRight,
  Menu,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { isAssistantReply, sameContext } from "../assistant/contracts";
import { EDITIONS, MODES, TOOLS, suggestionsFor } from "./config";
import { chatReducer, initialChatState, MESSAGE_LIMIT } from "./state";
import { AppSidebar } from "./app-sidebar";
import { EditionSwitcher, SpecialtyModePicker, VersionSelect } from "./chat-controls";
import { AssistantMessage, ChatMessage, ToolResultPanel } from "./chat-presentation";
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
  const latestReply = useRef<HTMLElement>(null);
  const pending = state.pending;
  const busy = state.phase === "sending";
  const invalidMessage = state.composerError?.kind === "message";
  const mode = MODES.find((entry) => entry.id === state.context.mode)!;
  const Icon = MODE_ICONS[mode.id];
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const turn = pending;
    async function send() {
      try {
        if (turn.simulateFailure) throw new Error("Falha simulada");
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          body: JSON.stringify({
            message: turn.text,
            context: turn.context,
            followUp: turn.followUp,
          }),
        });
        if (!response.ok) throw new Error("Falha na resposta");
        const reply: unknown = await response.json();
        if (!isAssistantReply(reply) || !sameContext(reply.context, turn.context))
          throw new Error("Resposta inválida");
        if (!controller.signal.aborted) dispatch({ type: "complete", id: turn.id, reply });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "fail", id: turn.id });
      }
    }
    void send();
    return () => controller.abort();
  }, [pending]);
  useEffect(() => {
    const area = messages.current;
    const answer = latestReply.current;
    if (state.messages.length && area && answer)
      area.scrollTop += answer.getBoundingClientRect().top - area.getBoundingClientRect().top;
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
                Assistente MinePRO <span className="prototype-pill">Guiado</span>
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
              error={state.versionError}
            />
          </div>
        </header>
        <main id="conteudo" className="chat-main">
          <div className="prototype-notice">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Assistência guiada disponível para assuntos selecionados de Minecraft. A IA
              conversacional ainda está em desenvolvimento.
            </p>
          </div>
          <Link
            className="chat-calculator-link"
            href="/ferramentas/materiais"
            aria-label="Abrir Calculadora de materiais"
            aria-describedby="calculator-availability"
          >
            <Calculator size={23} aria-hidden="true" />
            <span>
              <strong>Calculadora de materiais</strong>
              <span id="calculator-availability">Disponível · blocos, stacks e slots</span>
            </span>
            <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
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
                <section className="message-list" aria-label="Conversa nesta página">
                  {state.messages.map((message, index) => (
                    <div className="chat-turn" key={message.id}>
                      <ChatMessage message={message} />
                      <AssistantMessage
                        reply={message.reply}
                        replyRef={index === state.messages.length - 1 ? latestReply : undefined}
                        onReuseQuestion={busy ? undefined : () => prepare(message.text)}
                      />
                    </div>
                  ))}
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
                      <Link
                        key={tool.id}
                        href={tool.href}
                        className="tool-available"
                        aria-label={tool.name}
                        aria-describedby={`tool-${tool.id}-state`}
                      >
                        <span>
                          {tool.name}
                          <small id={`tool-${tool.id}-state`}>Disponível</small>
                        </span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        key={tool.id}
                        aria-label={tool.name}
                        aria-describedby={`tool-${tool.id}-state`}
                        disabled={busy}
                        onClick={() => setActiveTool(tool)}
                      >
                        <span>
                          {tool.name}
                          <small id={`tool-${tool.id}-state`}>Prévia · ainda não executa</small>
                        </span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    ),
                  )}
                </div>
              </section>
            </div>
          </div>
          <div className="composer-area">
            <div
              className="context-announcement"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {state.notice}
            </div>
            {state.composerError ? (
              <p id="composer-error" className="composer-error" role="alert">
                {state.composerError.text}
              </p>
            ) : null}
            <form
              aria-busy={busy}
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                const text = state.draft.trim();
                const simulateFailure = failNext && text.length > 0 && text.length <= MESSAGE_LIMIT;
                dispatch({ type: "submit", simulateFailure });
                if (simulateFailure) setFailNext(false);
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
                  aria-invalid={invalidMessage || undefined}
                  aria-describedby={
                    invalidMessage
                      ? "composer-help composer-count composer-error"
                      : "composer-help composer-count"
                  }
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
                  aria-label={busy ? "Aguardando orientação" : "Enviar pergunta"}
                >
                  <ArrowUp size={21} aria-hidden="true" />
                </button>
              </div>
              <div className="composer-bottom">
                <p id="composer-help" aria-live="polite">
                  {busy ? "Consultando o assistente…" : "Enter envia · Shift+Enter quebra linha"}
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
              Histórico temporário nesta página. Não envie dados pessoais.
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
        title="Configurações do assistente"
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
          Simular falha na próxima pergunta
        </label>
        <p className="small-note">
          A falha simulada mantém seu rascunho e permite tentar novamente.
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
