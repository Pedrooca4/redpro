import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveQuestion } from "./questions.ts";
import { type CommandContext, type CommandResult, validateCandidate } from "./validate.ts";

type DevelopmentSuite = "3ed" | "3ee";

type Example = {
  id: string;
  edition: string | null;
  version?: string | null;
  question?: string;
  candidate?: string;
  status: CommandResult["status"];
  command?: string;
  fields?: string[];
  message?: string;
};

export async function measureRobustness(
  question: (context: CommandContext, text: string) => CommandResult = resolveQuestion,
  candidate: (context: CommandContext, text: string) => CommandResult = validateCandidate,
  suite: DevelopmentSuite = "3ed",
) {
  const path = new URL(`../../tests/fixtures/command-validation-${suite}.json`, import.meta.url);
  const examples = JSON.parse(await readFile(path, "utf8")) as Example[];
  const rows = examples.map((item) => {
    const context = {
      edition: item.edition,
      version:
        item.version === undefined
          ? item.edition === "Java"
            ? "1.21.5"
            : "1.21.80"
          : item.version,
    };
    const result =
      item.question === undefined
        ? candidate(context, item.candidate ?? "")
        : question(context, item.question);
    const commandMatches =
      item.command === undefined || (result.status === "ready" && result.command === item.command);
    const correct =
      item.status === result.status &&
      commandMatches &&
      (item.fields === undefined ||
        ("fields" in result && JSON.stringify(result.fields) === JSON.stringify(item.fields))) &&
      (item.message === undefined ||
        ("message" in result && result.message.includes(item.message)));
    return {
      id: item.id,
      input: item.question === undefined ? "candidate" : "question",
      expected: item.status,
      actual: result.status,
      commandMatches,
      correct,
    };
  });
  const summarize = (group: typeof rows) => {
    const count = (predicate: (row: (typeof rows)[number]) => boolean) =>
      group.filter(predicate).length;
    return {
      total: group.length,
      covered: count((row) => row.actual !== "outside-scope"),
      correct: count((row) => row.correct),
      correctReady: count((row) => row.correct && row.actual === "ready"),
      adequateClarifications: count((row) => row.correct && row.actual === "clarify"),
      correctInvalid: count((row) => row.correct && row.actual === "invalid"),
      adequateCautions: count((row) => row.correct && row.actual === "caution"),
      abstentions: count((row) => row.actual === "outside-scope"),
      adequateAbstentions: count((row) => row.correct && row.actual === "outside-scope"),
      falsePositives: count(
        (row) => row.actual === "ready" && (row.expected !== "ready" || !row.commandMatches),
      ),
      falseNegatives: count(
        (row) => (row.expected === "ready" || row.expected === "clarify") && !row.correct,
      ),
    };
  };
  return {
    total: summarize(rows),
    questions: summarize(rows.filter((row) => row.input === "question")),
    candidates: summarize(rows.filter((row) => row.input === "candidate")),
    mismatches: rows.filter((row) => !row.correct),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2] ?? "3ed";
  if (suite !== "3ed" && suite !== "3ee") throw new Error("Use a bateria 3ed ou 3ee.");
  process.stdout.write(
    `${JSON.stringify(await measureRobustness(undefined, undefined, suite), null, 2)}\n`,
  );
}
