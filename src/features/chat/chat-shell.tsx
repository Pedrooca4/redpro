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
import { EDITIONS, MODES, TOOLS, suggestionsFor } from "./config";
import { chatReducer, initialChatState, MESSAGE_LIMIT } from "./state";
import { AppSidebar } from "./app-sidebar";
import { EditionSwitcher, SpecialtyModePicker, VersionSelect } from "./chat-controls";
import { ChatMessage, ToolResultPanel } from "./chat-presentation";
import { PrototypeDialog } from "./prototype-dialog";
import { MODE_ICONS } from "./icons";
import { askMinepro, ChatRequestError } from "./ai-client";
import { buildAIHistory, type AIMessage } from "./ai-contract";

export function ChatShell() {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [availability, setAvailability] = useState<"checking" | "available" | "disabled">(
    "checking",
  );
  const [activeTool, setActiveTool] = useState<Exclude<
    (typeof TOOLS)[number],
    { href: string }
  > | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const busy = state.phase === "previewing";
  const aiAvailable = availability === "available";
  const mode = MODES.find((entry) => entry.id === state.context.mode)!;
  const Icon = MODE_ICONS[mode.id];
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chat", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    })
      .then(async (response) => response.ok && (await response.json()).available === true)
      .then((available) => {
        if (!controller.signal.aborted) setAvailability(available ? "available" : "disabled");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("disabled");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!busy) return;
    if (aiAvailable && state.pending) {
      const controller = new AbortController();
      const history: AIMessage[] = state.messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.text,
      }));
      askMinepro(
        { context: state.pending.context, messages: buildAIHistory(history, state.pending.text) },
        controller.signal,
      )
        .then((answer) => {
          if (!controller.signal.aborted) dispatch({ type: "complete", answer });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            dispatch({
              type: "fail",
              code: error instanceof ChatRequestError ? error.code : "PROVIDER_FAILED",
            });
        });
      return () => controller.abort();
    }
    // Local preview only: this timer never calls an API or generates an AI answer.
    const timer = window.setTimeout(() => {
      dispatch({ type: failNext ? "fail" : "complete" });
      setFailNext(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [busy, failNext, aiAvailable, state.pending, state.messages]);
  useEffect(() => {
    if (state.messages.length)
      messages.current?.scrollTo({ top: messages.current.scrollHeight, behavior: "instant" });
  }, [state.messages.length, busy]);
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
        <AppSidebar
          onNew={newConversation}
          onSettings={() => setSettings(true)}
          aiAvailable={aiAvailable}
        />
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
                Assistente MinePRO{" "}
                <span className="prototype-pill">{aiAvailable ? "IA" : "Protótipo"}</span>
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
            <p aria-live="polite">
              {availability === "checking"
                ? "Verificando a disponibilidade da IA…"
                : aiAvailable
                  ? "IA pode errar. Confira edição e versão. Não envie dados pessoais ou credenciais."
                  : "A IA ainda não está ativada. Esta demonstração mantém as mensagens somente nesta página."}
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
                <section className="message-list" aria-label="Mensagens locais">
                  {state.messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  {!aiAvailable ? (
                    <p className="no-ai-answer">
                      Protótipo: respostas de IA ainda não estão disponíveis.
                    </p>
                  ) : null}
                </section>
              )}
              {aiAvailable && busy ? (
                <div className="ai-generating" role="status" aria-live="polite">
                  <p className="message-body">Você · {state.pending?.text}</p>
                  <p>MinePRO está preparando sua resposta…</p>
                </div>
              ) : null}
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
            <div className="context-announcement" role="status" aria-live="polite">
              {state.notice}
            </div>
            {state.error ? (
              <div className="composer-error" role="alert">
                <p>{state.error}</p>
                {aiAvailable ? (
                  <button
                    type="button"
                    className="ai-retry"
                    onClick={() => dispatch({ type: "submit" })}
                    disabled={busy}
                  >
                    Tentar novamente
                  </button>
                ) : null}
              </div>
            ) : null}
            <form
              aria-busy={busy}
              className="chat-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (availability === "checking") return;
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
                      if (!busy && availability !== "checking")
                        event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="send-button"
                  disabled={busy || availability === "checking" || !state.draft.trim()}
                  aria-label={
                    busy
                      ? aiAvailable
                        ? "Gerando resposta"
                        : "Exibindo mensagem local"
                      : aiAvailable
                        ? "Enviar pergunta"
                        : "Enviar mensagem de demonstração"
                  }
                >
                  <ArrowUp size={21} aria-hidden="true" />
                </button>
              </div>
              <div className="composer-bottom">
                <p id="composer-help" aria-live="polite">
                  {busy
                    ? aiAvailable
                      ? "Preparando resposta…"
                      : "Exibindo mensagem local…"
                    : "Enter envia · Shift+Enter quebra linha"}
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
              {aiAvailable
                ? "Histórico temporário nesta página. Perguntas são enviadas ao provedor de IA."
                : "Mensagens locais e temporárias. Não envie dados pessoais."}
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
          aiAvailable={aiAvailable}
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
        title={aiAvailable ? "Preferências da sessão" : "Configurações da demonstração"}
      >
        <p>
          As escolhas de edição, versão e modo permanecem apenas enquanto esta página estiver
          aberta. Não há conta ou histórico salvo.
        </p>
        {!aiAvailable ? (
          <label className="demo-failure-toggle">
            <input
              type="checkbox"
              checked={failNext}
              disabled={busy}
              onChange={(event) => setFailNext(event.target.checked)}
            />
            Simular falha na próxima mensagem local
          </label>
        ) : null}
        {!aiAvailable ? (
          <p className="small-note">
            Teste de interface: a falha mantém seu rascunho e permite tentar novamente. Nenhum
            serviço externo será chamado.
          </p>
        ) : (
          <p>
            Ao enviar, a pergunta e um contexto curto da sessão são processados pelo provedor de IA.
            Confira as orientações antes de aplicá-las no jogo.
          </p>
        )}
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
