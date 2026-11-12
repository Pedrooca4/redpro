type Format = "text" | "inline" | "block";
type Presentation = "presented" | "discouraged" | "example" | "uncertain";

const commandStart = /(?:^|(?<=[\s(["“'‘:*]))\/[a-z][a-z0-9_-]*(?=\s|[.,;!?\])"”'’*]|$)/giu;
const inlineCode = /(`+)([^`]+)\1/g;
const fenceMarker = /^\s*(?:>\s*)?(`{3,}|~{3,})(.*)$/u;
const proseBoundary =
  /[.,;!?](?=\s|$)|["”’)]|\*\*|\s+(?=(?:para|pois|porque|quando|se|no|na|com|sem|e|ou)\b|(?:é|está|seria)\s|não (?:funciona\b|deve\s|é\s)|\((?:incorreto|errado|inválido)\b)/iu;
const action = "usar|use|executar|execute|digitar|digite|rodar|rode|utilizar|utilize";
const negativeLabel = "incorret[oa]|errad[oa]|inválid[oa]";
const discouraged = new RegExp(
  [
    `\\bnão\\s+(?:(?:se\\s+)?deve\\s+|(?:é\\s+(?:para|necessário))\\s+)?(?:${action}|recomend\\w*|faça)\\b`,
    "\\bnão é(?:\\s+o comando (?:certo|correto))?(?=\\s|:|$)",
    `\\b(?:evite|evitar|nunca|em vez de|ao invés de)(?:\\s+(?:${action}))?\\b`,
    `\\b(?:exemplo|comando|sintaxe|forma|uso)\\s+(?:${negativeLabel}|a evitar|do que não fazer)\\b(?::\\s*(?:${action})\\b)?`,
    `\\b(?:${negativeLabel})(?=\\s*:)`,
  ].join("|"),
  "giu",
);
const presented = /\b(?:use|usar|execute|executar|digite|digitar|rode|rodar|utilize|aplique)\b/giu;
const example = /\b(?:exemplos?|ilustraç(?:ão|ões)|hipotétic[oa]s?)\b/giu;
const trailingDiscouragement =
  /^[\s*`_]*(?:(?:é|está|seria|\(|[–—:])\s*(?:incorreto|errado|inválido)\b|não\s+(?:funciona|deve ser (?:usado|executado)|é o comando certo)\b)/iu;
const standalonePrefix = /^\s*(?:(?:[-+*>]+|\d+[.)])\s*)?[*_]*$/u;
const commandLabel =
  /\b(?:comando|sintaxe)(?:\s+(?:é|corret[oa]|[^.!?;]{0,120}\s+é))?\s*[:*_\s]*$/iu;

type Mention = {
  text: string;
  line: number;
  format: Format;
  presentation: Presentation;
};

function lastCue(prefix: string) {
  const clause = prefix.split(/[.!?;](?=\s|$)/u).at(-1) ?? "";
  const cues = [
    { kind: "discouraged" as const, matches: clause.matchAll(discouraged) },
    { kind: "presented" as const, matches: clause.matchAll(presented) },
    { kind: "example" as const, matches: clause.matchAll(example) },
  ];
  // Use the end of the cue so the "use" inside "não use" does not win.
  let latest = -1;
  let result: Presentation = "uncertain";
  for (const { kind, matches } of cues) {
    for (const match of matches) {
      const end = match.index + match[0].length;
      if (end > latest) {
        latest = end;
        result = kind;
      }
    }
  }
  return result;
}

function classify(prefix: string, suffix: string, fallback: Presentation): Presentation {
  if (trailingDiscouragement.test(suffix)) return "discouraged";
  const cue = lastCue(prefix);
  return cue === "uncertain" ? fallback : cue;
}

function classifyLine(prefix: string, suffix: string, lead: string): Presentation {
  const standalone = standalonePrefix.test(prefix) || commandLabel.test(prefix);
  return classify(prefix, suffix, classify(lead, "", standalone ? "presented" : "uncertain"));
}

function extract(text: string): Mention[] {
  const mentions: Mention[] = [];
  let fence: { marker: string; presentation: Presentation } | null = null;
  let lead = "";
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = index + 1;
    const marker = fenceMarker.exec(raw);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.marker[0] &&
        marker[1].length >= fence.marker.length &&
        !marker[2].trim()
      ) {
        fence = null;
        lead = "";
      } else {
        const value = raw.replace(/^\s*>\s?/u, "").trim();
        if (/^\/[a-z][\w-]*(?:\s|$)/iu.test(value)) {
          mentions.push({ text: value, line, format: "block", presentation: fence.presentation });
        }
      }
      continue;
    }
    if (marker) {
      fence = { marker: marker[1], presentation: classify(lead, "", "presented") };
      continue;
    }

    // Mask code spans while keeping their offsets in the prose line.
    const spans = [...raw.matchAll(inlineCode)];
    const prose = raw.replace(inlineCode, (span) => " ".repeat(span.length));
    const starts = [...prose.matchAll(commandStart)];
    for (const [i, start] of starts.entries()) {
      const offset = start.index;
      const next = Math.min(
        starts[i + 1]?.index ?? raw.length,
        spans.find((span) => span.index > offset)?.index ?? raw.length,
      );
      const tail = raw.slice(offset + start[0].length, next);
      const boundary = tail.search(proseBoundary);
      const end = boundary < 0 ? next : offset + start[0].length + boundary;
      mentions.push({
        text: raw.slice(offset, end).trim(),
        line,
        format: "text",
        presentation: classifyLine(raw.slice(0, offset), raw.slice(end), lead),
      });
    }
    for (const span of spans) {
      const value = span[2].trim();
      if (/^\/[a-z][\w-]*(?:\s|$)/iu.test(value)) {
        mentions.push({
          text: value,
          line,
          format: "inline",
          presentation: classifyLine(
            raw.slice(0, span.index),
            raw.slice(span.index + span[0].length),
            lead,
          ),
        });
      }
    }
    if (raw.trim() && !starts.length && !spans.length) lead = raw;
  }
  return mentions;
}

function normalized(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function assessCommands(text: string, expected: string) {
  const reference = normalized(expected);
  const family = reference.split(" ", 1)[0];
  const mentions = extract(text).map((mention) => {
    const command = normalized(mention.text);
    const sameFamily = command.split(" ", 1)[0] === family;
    const referenceTextPresent = command === reference || command.startsWith(`${reference} `);
    const parameters = !sameFamily
      ? "not-assessed"
      : command === reference
        ? "matches-reference"
        : "differs-from-reference";
    return { ...mention, referenceTextPresent, parameters };
  });
  const referenceTextPresent = mentions.some((mention) => mention.referenceTextPresent);
  const referenceParametersMatch = mentions.some(
    (mention) => mention.parameters === "matches-reference",
  );
  const referenceDiscouraged = mentions.some(
    (mention) =>
      mention.parameters === "matches-reference" && mention.presentation === "discouraged",
  );
  const presentedReference = mentions.some(
    (mention) => mention.parameters === "matches-reference" && mention.presentation === "presented",
  );
  return {
    referenceTextPresent,
    referenceParametersMatch,
    recommendedReferencePresent: presentedReference && !referenceDiscouraged,
    conflictingReferencePresentation: presentedReference && referenceDiscouraged,
    mentions,
  };
}
