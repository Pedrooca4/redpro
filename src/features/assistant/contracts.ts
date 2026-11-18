import {
  EDITIONS,
  isGameVersion,
  MESSAGE_LIMIT,
  MODES,
  type MinecraftContext,
} from "../chat/config.ts";

const fieldsByProcedure = {
  "red-piston": ["piston"],
  "farm-iron": ["farm"],
  "builder-base-21": [],
  "command-help": ["command"],
  "mods-triage": ["setup", "issue"],
  "survival-mining": ["resource", "pickaxe"],
} as const;

const detailOptions = {
  piston: ["not-extending", "not-retracting", "blocked"],
  farm: ["no-golem", "no-item"],
  command: ["help"],
  setup: ["fabric", "bedrock-addons"],
  issue: ["crash", "dependency", "version", "activation"],
  resource: ["coal", "iron", "diamond"],
  pickaxe: ["none", "wood", "stone", "gold", "iron", "diamond", "netherite"],
} as const;

export type ProcedureId = keyof typeof fieldsByProcedure;
export type DetailField = keyof typeof detailOptions;
export type Details = Partial<Record<DetailField, string>>;
export type FollowUp = { procedureId: ProcedureId; field: DetailField; details: Details };
export type AssistantRequest = {
  message: string;
  context: MinecraftContext;
  followUp?: FollowUp;
};

export type StructuredAnswerContent = {
  text: string;
  steps?: readonly string[];
  materials?: readonly { name: string; quantity: number; unit: string; estimated: boolean }[];
  prerequisites?: readonly string[];
  compatibility?: string;
  verification?: string;
  warnings?: readonly string[];
};
export type Evidence = { title: string; url: string };
export type Answer = {
  type: "ANSWER";
  context: MinecraftContext & { game_version: string };
  procedureId: ProcedureId;
  answer: StructuredAnswerContent;
  verification: "DOCUMENTED" | "CALCULATED";
  sources: readonly Evidence[];
};
export type AssistantReply =
  | Answer
  | {
      type: "CLARIFICATION";
      context: MinecraftContext;
      text: string;
      needsVersion?: true;
      followUp?: FollowUp;
    }
  | { type: "UNSUPPORTED"; context: MinecraftContext; text: string };

export type AssistantError = {
  type: "ERROR";
  code:
    | "INVALID_INPUT"
    | "INVALID_JSON"
    | "PAYLOAD_TOO_LARGE"
    | "UNSUPPORTED_MEDIA_TYPE"
    | "INTERNAL_ERROR";
  text: string;
};
export type AssistantResponse = AssistantReply | AssistantError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isText(value: unknown, max = 1000): value is string {
  return typeof value === "string" && value.length <= max && !!value.trim();
}

function isContext(value: unknown): value is MinecraftContext {
  return (
    isRecord(value) &&
    hasOnly(value, ["edition", "mode", "game_version"]) &&
    typeof value.edition === "string" &&
    Object.hasOwn(EDITIONS, value.edition) &&
    MODES.some(({ id }) => id === value.mode) &&
    (value.game_version === null ||
      (typeof value.game_version === "string" &&
        value.game_version === value.game_version.trim() &&
        isGameVersion(value.game_version)))
  );
}

function isProcedureId(value: unknown): value is ProcedureId {
  return typeof value === "string" && Object.hasOwn(fieldsByProcedure, value);
}

export function procedureFields(id: ProcedureId): readonly DetailField[] {
  return fieldsByProcedure[id];
}

function isFollowUp(value: unknown): value is FollowUp {
  if (
    !isRecord(value) ||
    !hasOnly(value, ["procedureId", "field", "details"]) ||
    !isProcedureId(value.procedureId) ||
    !isRecord(value.details)
  )
    return false;
  const fields = procedureFields(value.procedureId);
  const field = fields.find((field) => field === value.field);
  if (!field || Object.hasOwn(value.details, field)) return false;
  return Object.entries(value.details).every(([key, option]) => {
    const allowed = fields.find((field) => field === key);
    return !!allowed && (detailOptions[allowed] as readonly unknown[]).includes(option);
  });
}

export function parseAssistantRequest(value: unknown): AssistantRequest | null {
  if (
    !isRecord(value) ||
    !hasOnly(value, ["message", "context", "followUp"]) ||
    !isText(value.message, MESSAGE_LIMIT) ||
    !isContext(value.context) ||
    (value.followUp !== undefined && !isFollowUp(value.followUp))
  )
    return null;
  return { message: value.message.trim(), context: value.context, followUp: value.followUp };
}

export function sameContext(a: MinecraftContext, b: MinecraftContext): boolean {
  return a.edition === b.edition && a.game_version === b.game_version && a.mode === b.mode;
}

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 12 && value.every((item) => isText(item));
}

function isStructuredAnswer(value: unknown): value is StructuredAnswerContent {
  return (
    isRecord(value) &&
    hasOnly(value, [
      "text",
      "steps",
      "materials",
      "prerequisites",
      "compatibility",
      "verification",
      "warnings",
    ]) &&
    isText(value.text) &&
    ["steps", "prerequisites", "warnings"].every(
      (key) => value[key] === undefined || isTextList(value[key]),
    ) &&
    ["compatibility", "verification"].every(
      (key) => value[key] === undefined || isText(value[key]),
    ) &&
    (value.materials === undefined ||
      (Array.isArray(value.materials) &&
        value.materials.length <= 12 &&
        value.materials.every(
          (item) =>
            isRecord(item) &&
            hasOnly(item, ["name", "quantity", "unit", "estimated"]) &&
            isText(item.name, 100) &&
            isText(item.unit, 40) &&
            typeof item.quantity === "number" &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity > 0 &&
            typeof item.estimated === "boolean",
        )))
  );
}

function isEvidence(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnly(value, ["title", "url"]) ||
    !isText(value.title, 160) ||
    !isText(value.url, 500)
  )
    return false;
  const url = URL.parse(value.url);
  return !!url && url.protocol === "https:" && !url.username && !url.password;
}

export function isAssistantReply(value: unknown): value is AssistantReply {
  if (!isRecord(value) || !isContext(value.context)) return false;
  switch (value.type) {
    case "ANSWER":
      return (
        hasOnly(value, ["type", "context", "procedureId", "answer", "verification", "sources"]) &&
        value.context.game_version !== null &&
        isProcedureId(value.procedureId) &&
        isStructuredAnswer(value.answer) &&
        (value.verification === "DOCUMENTED" || value.verification === "CALCULATED") &&
        Array.isArray(value.sources) &&
        (value.verification !== "DOCUMENTED" || value.sources.length > 0) &&
        value.sources.length <= 8 &&
        value.sources.every(isEvidence)
      );
    case "CLARIFICATION":
      return (
        hasOnly(value, ["type", "context", "text", "needsVersion", "followUp"]) &&
        isText(value.text) &&
        (value.needsVersion === undefined ||
          (value.needsVersion === true &&
            value.context.game_version === null &&
            value.followUp === undefined)) &&
        (value.followUp === undefined || isFollowUp(value.followUp))
      );
    case "UNSUPPORTED":
      return hasOnly(value, ["type", "context", "text"]) && isText(value.text);
    default:
      return false;
  }
}
