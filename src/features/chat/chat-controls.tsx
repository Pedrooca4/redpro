"use client";
import { useEffect, useRef, useState, type Dispatch } from "react";
import { EDITIONS, MODES, type MinecraftContext } from "./config";
import type { ChatAction } from "./state";
import { MODE_ICONS } from "./icons";

export function EditionSwitcher({
  context,
  dispatch,
  disabled,
}: {
  context: MinecraftContext;
  dispatch: Dispatch<ChatAction>;
  disabled: boolean;
}) {
  return (
    <fieldset className="edition-switcher" disabled={disabled}>
      <legend className="sr-only">Edição do Minecraft</legend>
      {Object.entries(EDITIONS).map(([id, edition]) => (
        <button
          key={id}
          type="button"
          aria-pressed={context.edition === id}
          title={edition.description}
          onClick={() => dispatch({ type: "edition", value: id as MinecraftContext["edition"] })}
        >
          {edition.label}
        </button>
      ))}
    </fieldset>
  );
}
export function VersionSelect({
  context,
  dispatch,
  disabled,
}: {
  context: MinecraftContext;
  dispatch: Dispatch<ChatAction>;
  disabled: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const [input, setInput] = useState("");
  const versions: readonly string[] = EDITIONS[context.edition].versions;
  return (
    <div className="version-control">
      <label htmlFor="game-version">Versão do Minecraft</label>
      <select
        id="game-version"
        disabled={disabled}
        value={custom ? "custom" : (context.game_version ?? "")}
        onChange={(event) => {
          if (event.target.value === "custom") {
            setCustom(true);
            setInput(context.game_version ?? "");
          } else {
            setCustom(false);
            dispatch({ type: "version", value: event.target.value || null });
          }
        }}
      >
        <option value="">Escolha sua versão</option>
        {versions.map((version) => (
          <option key={version} value={version}>
            {version}
          </option>
        ))}
        {context.game_version && !versions.includes(context.game_version) ? (
          <option value={context.game_version}>{context.game_version}</option>
        ) : null}
        <option value="custom">Outra versão…</option>
      </select>
      {custom ? (
        <div className="custom-version">
          <label htmlFor="custom-version">Outra versão (ex.: 1.21.1)</label>
          <input
            id="custom-version"
            value={input}
            maxLength={12}
            disabled={disabled}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                dispatch({ type: "version", value: input.trim() || null });
              }
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              dispatch({ type: "version", value: input.trim() || null });
            }}
          >
            Aplicar
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function SpecialtyModePicker({
  mode,
  dispatch,
  disabled,
}: {
  mode: MinecraftContext["mode"];
  dispatch: Dispatch<ChatAction>;
  disabled: boolean;
}) {
  const picker = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    picker.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [mode]);
  return (
    <fieldset ref={picker} className="mode-picker" disabled={disabled}>
      <legend className="sr-only">Especialidade do assistente</legend>
      {MODES.map((entry) => {
        const Icon = MODE_ICONS[entry.id];
        return (
          <button
            key={entry.id}
            type="button"
            title={entry.title}
            aria-pressed={mode === entry.id}
            onClick={() => dispatch({ type: "mode", value: entry.id })}
          >
            <Icon size={15} aria-hidden="true" />
            {entry.id}
          </button>
        );
      })}
    </fieldset>
  );
}
