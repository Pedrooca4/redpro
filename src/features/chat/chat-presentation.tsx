import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { CircleDashed, FileText } from "lucide-react";
import type { AssistantReply, StructuredAnswerContent } from "../assistant/contracts";
import { EDITIONS } from "./config";
import type { LocalMessage } from "./state";

export type { StructuredAnswerContent } from "../assistant/contracts";

export function ToolResultPanel({
  title,
  state,
  children,
}: {
  title: string;
  state: "unavailable" | "waiting" | "inconclusive";
  children: ReactNode;
}) {
  const labels = {
    unavailable: "Em desenvolvimento · sem execução",
    waiting: "Aguardando evidências",
    inconclusive: "Resultado inconclusivo",
  };
  return (
    <section className="tool-result-panel" aria-label={title}>
      <p className="eyebrow">
        <CircleDashed size={15} aria-hidden="true" />
        {labels[state]}
      </p>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function StructuredAnswer({
  answer,
  evidence,
  media,
}: {
  answer: StructuredAnswerContent;
  evidence?: ReactNode;
  media?: ReactNode;
}) {
  return (
    <div className="structured-answer">
      <p>{answer.text}</p>
      {media ? <section aria-label="Imagens e diagramas">{media}</section> : null}
      {answer.compatibility ? <p>{answer.compatibility}</p> : null}
      {answer.prerequisites?.length ? (
        <section>
          <h4>Pré-requisitos</h4>
          <ul>
            {answer.prerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {answer.steps?.length ? (
        <section>
          <h4>Passos</h4>
          <ol>
            {answer.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}
      {answer.materials?.length ? (
        <div className="table-scroll">
          <table>
            <caption>Materiais e hipóteses</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Precisão</th>
              </tr>
            </thead>
            <tbody>
              {answer.materials.map((item, i) => (
                <tr key={i}>
                  <td>{item.name}</td>
                  <td>
                    {item.quantity} {item.unit}
                  </td>
                  <td>{item.estimated ? "Estimativa" : "Exato"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {answer.verification ? (
        <section>
          <h4>Como verificar no jogo</h4>
          <p>{answer.verification}</p>
        </section>
      ) : null}
      {answer.warnings?.length ? (
        <ul aria-label="Limitações">
          {answer.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {evidence ? <section aria-label="Fontes e evidências">{evidence}</section> : null}
    </div>
  );
}
export function ChatMessage({ message }: { message: LocalMessage }) {
  return (
    <article className="local-message">
      <p className="message-meta">
        <FileText size={15} aria-hidden="true" />
        Você · {EDITIONS[message.context.edition].label} ·{" "}
        {message.context.game_version ?? "Versão não informada"} · {message.context.mode}
      </p>
      <p className="message-body">{message.text}</p>
    </article>
  );
}

const replyLabels: Record<AssistantReply["type"], string> = {
  ANSWER: "Orientação guiada",
  CLARIFICATION: "Pergunta de esclarecimento",
  UNSUPPORTED: "Sem orientação validada",
};

export function AssistantMessage({
  reply,
  replyRef,
  onReuseQuestion,
}: {
  reply: AssistantReply;
  replyRef?: Ref<HTMLElement>;
  onReuseQuestion?: () => void;
}) {
  const label = replyLabels[reply.type];
  const { edition, game_version, mode } = reply.context;
  return (
    <article
      ref={replyRef}
      className="assistant-message"
      aria-label={label}
      data-reply-type={reply.type}
    >
      <p className="assistant-meta">
        MinePRO · {EDITIONS[edition].label} · {game_version ?? "Versão não informada"} · {mode}
      </p>
      <h3>{label}</h3>
      {reply.type === "ANSWER" ? (
        <>
          <p className="assistant-meta">
            {reply.verification === "CALCULATED"
              ? "Cálculo geométrico"
              : "Procedimento com referência técnica"}
          </p>
          <StructuredAnswer
            answer={reply.answer}
            evidence={
              reply.sources.length ? (
                <>
                  <h4>Referências</h4>
                  <ul>
                    {reply.sources.map(({ title, url }) => (
                      <li key={url}>
                        <a href={url}>{title}</a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null
            }
          />
          {reply.procedureId === "builder-base-21" ? (
            <Link href="/ferramentas/materiais">Conferir na calculadora de materiais</Link>
          ) : null}
        </>
      ) : (
        <p>{reply.text}</p>
      )}
      {reply.type === "CLARIFICATION" && reply.needsVersion && onReuseQuestion ? (
        <button type="button" className="button assistant-reuse" onClick={onReuseQuestion}>
          Reusar pergunta no rascunho
        </button>
      ) : null}
    </article>
  );
}
