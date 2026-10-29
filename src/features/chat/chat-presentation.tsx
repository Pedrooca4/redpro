import type { ReactNode } from "react";
import { CircleDashed, FileText } from "lucide-react";
import { EDITIONS } from "./config";
import type { LocalMessage } from "./state";

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
// Presentation only. A future server adapter must validate evidence before supplying it.
export type StructuredAnswerContent = {
  text: string;
  steps?: readonly string[];
  materials?: readonly { name: string; quantity: number; unit: string; estimated: boolean }[];
  compatibility?: string;
  warnings?: readonly string[];
};
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
      {evidence ? <section aria-label="Fontes e evidências">{evidence}</section> : null}
      {answer.compatibility ? <p>{answer.compatibility}</p> : null}
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
      {answer.warnings?.length ? (
        <ul aria-label="Limitações">
          {answer.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
export function ChatMessage({ message }: { message: LocalMessage }) {
  return (
    <article className="local-message">
      <p className="message-meta">
        <FileText size={15} aria-hidden="true" />
        Você · mensagem local · {EDITIONS[message.context.edition].label} ·{" "}
        {message.context.game_version ?? "Versão não informada"} · {message.context.mode}
      </p>
      <p className="message-body">{message.text}</p>
      <p className="message-disclosure">
        Demonstração: esta mensagem não foi enviada a um provedor de IA.
      </p>
    </article>
  );
}
