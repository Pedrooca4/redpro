"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, Calculator, Copy, Package, Pencil, Plus, Trash2 } from "lucide-react";
import {
  estimateBlocks,
  formatMaterialList,
  formatQuantity,
  materialTotals,
  MAX_DIMENSION,
  MAX_MATERIALS,
  MAX_NAME_LENGTH,
  MAX_QUANTITY,
  parseWholeNumber,
  STACK_SIZES,
  stackBreakdown,
  type Material,
  type Shape,
  type StackSize,
} from "./calculations";

const SHAPES: Record<Shape, { title: string; formula: string }> = {
  platform: { title: "Plataforma retangular", formula: "Comprimento × largura" },
  volume: { title: "Volume preenchido", formula: "Comprimento × largura × altura" },
  walls: { title: "Paredes retangulares", formula: "(2 × comprimento + 2 × largura − 4) × altura" },
};
const EMPTY_DRAFT = { name: "", quantity: "", stackSize: 64 as StackSize };

function StackMetrics({ quantity, stackSize }: Pick<Material, "quantity" | "stackSize">) {
  const { fullStacks, remainder, slots } = stackBreakdown(quantity, stackSize);
  return (
    <dl className="material-metrics">
      <div>
        <dt>Unidades</dt>
        <dd>{formatQuantity(quantity)}</dd>
      </div>
      <div>
        <dt>Stacks completas</dt>
        <dd>{formatQuantity(fullStacks)}</dd>
      </div>
      <div>
        <dt>Itens restantes</dt>
        <dd>{formatQuantity(remainder)}</dd>
      </div>
      <div>
        <dt>Slots</dt>
        <dd>{formatQuantity(slots)}</dd>
      </div>
    </dl>
  );
}

function GeometryForm({
  onUseEstimate,
  editing,
}: {
  onUseEstimate: (quantity: number) => void;
  editing: boolean;
}) {
  const [shape, setShape] = useState<Shape>("platform");
  const [result, setResult] = useState<number | null>(null);
  const [invalidField, setInvalidField] = useState("");
  const minimum = shape === "walls" ? 2 : 1;
  const dimensions = [
    { id: "length", label: "Comprimento", min: minimum },
    { id: "width", label: "Largura", min: minimum },
    ...(shape === "platform" ? [] : [{ id: "height", label: "Altura", min: 1 }]),
  ];

  function clearResult() {
    setResult(null);
    setInvalidField("");
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = dimensions.map(({ id, min }) =>
      parseWholeNumber(String(data.get(id) ?? ""), min, MAX_DIMENSION),
    );
    const badIndex = values.indexOf(null);
    if (badIndex >= 0) {
      const id = dimensions[badIndex]!.id;
      setInvalidField(id);
      form.querySelector<HTMLInputElement>(`#geometry-${id}`)?.focus();
      return;
    }
    const [length, width, height] = values;
    setResult(
      estimateBlocks(shape, { length: length!, width: width!, height: height ?? undefined }),
    );
    setInvalidField("");
  }

  return (
    <section className="material-panel" aria-labelledby="estimate-title">
      <h2 id="estimate-title">
        <Calculator size={20} aria-hidden="true" /> Estimativa da construção
      </h2>
      <form className="material-form" noValidate onSubmit={calculate} onChange={clearResult}>
        <div className="material-field">
          <label htmlFor="geometry-shape">Tipo de construção</label>
          <select
            id="geometry-shape"
            value={shape}
            onChange={(e) => setShape(e.target.value as Shape)}
          >
            {Object.entries(SHAPES).map(([id, { title }]) => (
              <option value={id} key={id}>
                {title}
              </option>
            ))}
          </select>
        </div>
        <div className="material-fields">
          {dimensions.map(({ id, label, min }) => (
            <div className="material-field" key={id}>
              <label htmlFor={`geometry-${id}`}>{label}</label>
              <input
                id={`geometry-${id}`}
                name={id}
                inputMode="numeric"
                required
                placeholder={`${min} a ${formatQuantity(MAX_DIMENSION)}`}
                aria-invalid={invalidField === id || undefined}
                aria-describedby={invalidField === id ? "geometry-error" : undefined}
              />
              {invalidField === id && (
                <p className="material-error" role="alert" id="geometry-error">
                  Informe um número inteiro de {min} a {formatQuantity(MAX_DIMENSION)}.
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="material-formula">{SHAPES[shape].formula}</p>
        <button type="submit" className="button button-primary">
          Calcular blocos
        </button>
      </form>
      <div className="material-estimate" role="status">
        {result === null ? (
          <p>Informe as medidas em blocos para ver a estimativa.</p>
        ) : (
          <p>
            <strong>{formatQuantity(result)}</strong> blocos estimados
          </p>
        )}
      </div>
      {result !== null && (
        <button
          type="button"
          className="button material-secondary"
          disabled={editing}
          onClick={() => onUseEstimate(result)}
        >
          <ArrowDownToLine size={17} aria-hidden="true" /> Usar estimativa na lista
        </button>
      )}
      {result !== null && editing && (
        <p className="material-note">Finalize a edição para usar a estimativa.</p>
      )}
      <p className="material-note">
        Estimativa geométrica sem desconto de portas, janelas, decoração ou outros espaços vazios.
      </p>
    </section>
  );
}

export function MaterialCalculator() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<{ field?: "name" | "quantity"; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const nextId = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const quantityInput = useRef<HTMLInputElement>(null);
  const manualCopy = useRef<HTMLTextAreaElement>(null);
  const quantity = parseWholeNumber(draft.quantity, 1, MAX_QUANTITY);
  const totals = materialTotals(materials);

  function resetDraft() {
    setDraft(EMPTY_DRAFT);
    setEditing(null);
    setError(null);
    nameInput.current?.focus();
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name || name.length > MAX_NAME_LENGTH || /[\r\n]/.test(name)) {
      setError({ field: "name", message: `Informe um nome de 1 a ${MAX_NAME_LENGTH} caracteres.` });
      nameInput.current?.focus();
      return;
    }
    if (quantity === null) {
      setError({
        field: "quantity",
        message: `Informe uma quantidade inteira de 1 a ${formatQuantity(MAX_QUANTITY)}.`,
      });
      quantityInput.current?.focus();
      return;
    }
    if (editing === null && materials.length >= MAX_MATERIALS) {
      setError({ message: `Limite de ${MAX_MATERIALS} materiais por lista.` });
      return;
    }
    const item = { id: editing ?? ++nextId.current, name, quantity, stackSize: draft.stackSize };
    setMaterials((current) =>
      editing === null
        ? [...current, item]
        : current.map((material) => (material.id === editing ? item : material)),
    );
    setNotice(editing === null ? `${name} adicionado à lista.` : `${name} atualizado.`);
    setCopyState("idle");
    resetDraft();
  }

  function edit(material: Material) {
    setDraft({
      name: material.name,
      quantity: String(material.quantity),
      stackSize: material.stackSize,
    });
    setEditing(material.id);
    setError(null);
    nameInput.current?.focus();
  }

  function remove(material: Material) {
    setMaterials((current) => current.filter(({ id }) => id !== material.id));
    setNotice(`${material.name} removido da lista.`);
    setCopyState("idle");
    if (editing === material.id) resetDraft();
    else nameInput.current?.focus();
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(formatMaterialList(materials));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <>
      <div className="material-workbench">
        <GeometryForm
          editing={editing !== null}
          onUseEstimate={(estimate) => {
            setDraft((current) => ({ ...current, quantity: String(estimate) }));
            setError(null);
            setNotice(
              "Estimativa preenchida. Informe o nome e a capacidade da stack para adicionar.",
            );
            nameInput.current?.focus();
          }}
        />
        <section className="material-panel" aria-labelledby="entry-title">
          <h2 id="entry-title">
            <Package size={20} aria-hidden="true" />
            {editing === null ? "Adicionar material" : "Editar material"}
          </h2>
          <form
            className="material-form"
            noValidate
            onSubmit={save}
            onChange={() => setError(null)}
          >
            <div className="material-field">
              <label htmlFor="material-name">Nome do material</label>
              <input
                id="material-name"
                ref={nameInput}
                value={draft.name}
                required
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ex.: Pedra lisa"
                aria-invalid={error?.field === "name" || undefined}
                aria-describedby={error?.field === "name" ? "material-error" : undefined}
              />
            </div>
            <div className="material-fields">
              <div className="material-field">
                <label htmlFor="material-quantity">Quantidade</label>
                <input
                  id="material-quantity"
                  ref={quantityInput}
                  value={draft.quantity}
                  required
                  inputMode="numeric"
                  onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                  placeholder="Ex.: 150"
                  aria-invalid={error?.field === "quantity" || undefined}
                  aria-describedby={error?.field === "quantity" ? "material-error" : undefined}
                />
              </div>
              <div className="material-field">
                <label htmlFor="material-stack">Tamanho da stack</label>
                <select
                  id="material-stack"
                  value={draft.stackSize}
                  onChange={(e) =>
                    setDraft({ ...draft, stackSize: Number(e.target.value) as StackSize })
                  }
                >
                  {STACK_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size === 1 ? "1 · não empilha" : `${size} unidades`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <p id="material-error" role="alert" className="material-error">
                {error.message}
              </p>
            )}
            <div className="material-actions">
              <button type="submit" className="button button-primary">
                {editing === null ? (
                  <>
                    <Plus size={18} aria-hidden="true" /> Adicionar à lista
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </button>
              {editing !== null && (
                <button type="button" className="button material-secondary" onClick={resetDraft}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          <div className="material-conversion" role="region" aria-label="Conversão da quantidade">
            {quantity === null ? (
              <p className="material-note">
                A conversão aparece quando você informa uma quantidade válida.
              </p>
            ) : (
              <StackMetrics quantity={quantity} stackSize={draft.stackSize} />
            )}
          </div>
        </section>
      </div>
      <section className="material-panel material-inventory" aria-labelledby="inventory-title">
        <div className="material-inventory-heading">
          <div>
            <h2 id="inventory-title">
              <Package size={20} aria-hidden="true" /> Lista de materiais
            </h2>
            <p className="material-note">
              Os slots são somados por linha, sem juntar materiais repetidos.
            </p>
          </div>
          <button
            type="button"
            className="button material-secondary"
            disabled={!materials.length}
            onClick={() => void copyList()}
          >
            <Copy size={17} aria-hidden="true" /> Copiar lista
          </button>
        </div>
        <p className="material-list-totals">
          <span>
            <strong>{formatQuantity(totals.units)}</strong> unidades no total
          </span>
          <span>
            <strong>{formatQuantity(totals.slots)}</strong> slots estimados
          </span>
        </p>
        <p className="sr-only" role="status">
          {notice}
        </p>
        <p className="material-copy-status" role="status">
          {copyState === "copied"
            ? "Lista copiada."
            : copyState === "failed"
              ? "Não foi possível copiar automaticamente. Selecione e copie o texto abaixo."
              : ""}
        </p>
        {copyState === "failed" && (
          <div className="material-field">
            <label htmlFor="material-copy-text">Texto da lista</label>
            <textarea
              id="material-copy-text"
              ref={manualCopy}
              rows={4}
              readOnly
              onFocus={() => manualCopy.current?.select()}
              value={formatMaterialList(materials)}
            />
          </div>
        )}
        {materials.length ? (
          <ul className="material-list" aria-label="Materiais adicionados">
            {materials.map((material) => (
              <li key={material.id}>
                <div className="material-item-info">
                  <h3>{material.name}</h3>
                  <p>Stack de {material.stackSize}</p>
                </div>
                <StackMetrics quantity={material.quantity} stackSize={material.stackSize} />
                <div className="material-actions">
                  <button
                    type="button"
                    className="button material-secondary"
                    aria-label={`Editar ${material.name}`}
                    onClick={() => edit(material)}
                  >
                    <Pencil size={16} aria-hidden="true" /> Editar
                  </button>
                  <button
                    type="button"
                    className="button material-secondary"
                    aria-label={`Remover ${material.name}`}
                    onClick={() => remove(material)}
                  >
                    <Trash2 size={16} aria-hidden="true" /> Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="material-empty">
            Sua lista está vazia. Adicione um material ou use uma estimativa da construção.
          </p>
        )}
      </section>
    </>
  );
}
