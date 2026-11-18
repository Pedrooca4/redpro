import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";

// Match the existing locator wait budget; wait for observable state, never sleep
// or repeat a failed action to manufacture a pass.
const uiExpect = expect.configure({ timeout: 30_000 });
const versionRounds = 20;
const versionErrorText =
  "Informe uma versão numérica, como 1.21.1, ou deixe a versão não informada.";
const messageErrorText =
  "Escreva uma mensagem de 1 a 4000 caracteres. Seu rascunho foi preservado.";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const assistantUrl = new URL("/api/assistant", base).href;
const networkErrorText =
  "Não foi possível consultar o assistente. Sua mensagem foi preservada. Tente novamente.";
const artifactDir = process.env.UI_ARTIFACT_DIR || "coverage/ui";
await mkdir(artifactDir, { recursive: true });
const launchOptions = {
  headless: true,
  ...(process.env.UI_CHROMIUM_EXECUTABLE
    ? {
        executablePath: process.env.UI_CHROMIUM_EXECUTABLE,
        args: [
          "--single-process",
          "--no-zygote",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      }
    : {}),
};
async function holdAssistantReply(page) {
  const gate = Promise.withResolvers();
  const finished = Promise.withResolvers();
  let received = false;
  await page.route(
    assistantUrl,
    async (route) => {
      try {
        const response = await route.fetch();
        received = true;
        await gate.promise;
        await route.fulfill({ response }).catch(() => {
          // Starting a new conversation may abort the original browser request.
        });
      } finally {
        finished.resolve();
      }
    },
    { times: 1 },
  );
  return {
    waitForResponse: () => uiExpect.poll(() => received).toBe(true),
    async release() {
      gate.resolve();
      await finished.promise;
    },
  };
}

async function checkGuidedConversation(page, requests) {
  await page.goto(new URL("/chat", base).href);
  const draft = page.getByLabel(/^Sua mensagem/);
  const version = page.getByLabel("Versão do Minecraft", { exact: true });
  const replies = page.locator(".assistant-message");
  const playerMessages = page.locator(".local-message");
  const status = page.locator(".composer-area").getByRole("status");
  const question = "Planeje uma base 21 × 21";
  await draft.fill(question);
  await draft.press("Enter");
  await uiExpect(replies.last()).toHaveAttribute("data-reply-type", "CLARIFICATION");
  await uiExpect(replies.last()).toContainText("Qual versão do Minecraft você usa?");
  await version.selectOption("1.21.1");
  await page.getByRole("button", { name: "Reusar pergunta no rascunho" }).click();
  await uiExpect(draft).toHaveValue(question);
  await uiExpect(draft).toBeFocused();
  await page.route(assistantUrl, (route) => route.abort("failed"), { times: 1 });
  await draft.press("Enter");
  await uiExpect(page.locator(".composer-area").getByRole("alert")).toHaveText(networkErrorText);
  await uiExpect(draft).toHaveValue(question);
  await uiExpect(draft).not.toHaveAttribute("aria-invalid");
  await uiExpect(replies).toHaveCount(1);
  await uiExpect(playerMessages).toHaveCount(1);

  const retry = await holdAssistantReply(page);
  const beforeRetry = requests.length;
  await draft.press("Enter");
  await retry.waitForResponse();
  await uiExpect(page.locator(".chat-composer")).toHaveAttribute("aria-busy", "true");
  await uiExpect(page.getByRole("button", { name: "Aguardando orientação" })).toBeDisabled();
  await draft.press("Enter");
  await draft.press("Enter");
  assert.equal(requests.length, beforeRetry + 1);
  await retry.release();
  await uiExpect(replies).toHaveCount(2);
  await uiExpect(playerMessages).toHaveCount(2);
  await uiExpect(replies.last()).toHaveAttribute("data-reply-type", "ANSWER");
  await uiExpect(replies.last()).toContainText("441");
  await uiExpect(
    replies.last().getByRole("link", { name: "Conferir na calculadora de materiais" }),
  ).toHaveAttribute("href", "/ferramentas/materiais");
  await uiExpect(page.locator(".composer-area").getByRole("alert")).toHaveCount(0);
  await uiExpect(draft).toHaveValue("");
  await uiExpect(draft).toBeFocused();
  await uiExpect(status).toHaveText("Resposta 2. Orientação guiada.");
  const retryAnnouncement = await status.ariaSnapshot();
  await page.screenshot({ path: `${artifactDir}/assistant-builder-390.png` });

  await draft.fill("Quero minerar diamantes");
  await draft.press("Enter");
  await uiExpect(replies).toHaveCount(3);
  await uiExpect(replies.last()).toContainText("Que picareta você tem hoje?");
  await draft.fill("Ferro");
  await draft.press("Enter");
  await uiExpect(replies).toHaveCount(4);
  await uiExpect(replies.last()).toContainText("atende ao requisito para obter diamante");
  assert.equal(requests.at(-1).followUp.field, "pickaxe");
  assert.equal(requests.at(-1).followUp.details.resource, "diamond");

  const stale = await holdAssistantReply(page);
  await draft.fill("Quero montar uma farm de ferro");
  await draft.press("Enter");
  await stale.waitForResponse();
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page
    .getByRole("dialog", { name: "Navegação MinePRO" })
    .getByRole("button", { name: "Nova conversa" })
    .click();
  await uiExpect(replies).toHaveCount(0);
  await uiExpect(playerMessages).toHaveCount(0);
  await uiExpect(version).toHaveValue("1.21.1");
  await uiExpect(status).toContainText("Nova conversa local.");
  const newConversationAnnouncement = await status.ariaSnapshot();
  await draft.fill("Como uso /help?");
  await draft.press("Enter");
  await uiExpect(replies).toHaveCount(1);
  await uiExpect(replies.last()).toContainText("use /help");
  await uiExpect(status).toHaveText("Resposta 1. Orientação guiada.");
  const newReplyAnnouncement = await status.ariaSnapshot();
  await stale.release();
  await uiExpect(replies).toHaveCount(1);
  await uiExpect(playerMessages).toHaveCount(1);
  await uiExpect(playerMessages).toContainText("Como uso /help?");
  await uiExpect(page.locator(".composer-area").getByRole("alert")).toHaveCount(0);
  assert.equal(await status.ariaSnapshot(), newReplyAnnouncement);
  return { retryAnnouncement, newConversationAnnouncement, newReplyAnnouncement };
}

async function checkContextAnnouncements(page) {
  await page.goto(new URL("/chat", base).href);
  const version = page.getByLabel("Versão do Minecraft", { exact: true });
  const draft = page.getByLabel(/^Sua mensagem/);
  const replies = page.locator(".assistant-message");
  const status = page.locator(".composer-area").getByRole("status");
  await version.selectOption("1.21.1");
  await uiExpect(status).toHaveAttribute("aria-live", "polite");
  await uiExpect(status).toHaveAttribute("aria-atomic", "true");
  await uiExpect(page.locator(".composer-area").getByRole("status")).toHaveCount(1);

  const observation = await status.evaluateHandle((node) => {
    const changes = [];
    new MutationObserver(() => changes.push(node.textContent)).observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return { node, changes };
  });
  const read = () =>
    status.evaluate(
      (node, observed) => ({ stable: node === observed.node, changes: observed.changes }),
      observation,
    );

  const evidence = [];
  for (const [message, category, selected] of [
    ["Quero montar uma farm de ferro para Minecraft Bedrock 1.21.0.", "CLARIFICATION", "JAVA"],
    ["Meu pistão comum não estende em Java 1.20.1. Como testo?", "CLARIFICATION", "JAVA"],
    ["Meu pistão comum não estende no Minecraft Java 1.21.1. Como testo?", "ANSWER", "JAVA"],
    ["Como uso /help no Minecraft Java 1.21.1?", "ANSWER", "JAVA"],
    [
      "Meu pistão comum não estende no Minecraft Java 1.21.1. Como testo?",
      "CLARIFICATION",
      "BEDROCK",
    ],
  ]) {
    if (selected === "BEDROCK") {
      await page.getByRole("button", { name: "BedMine", exact: true }).click();
      await version.selectOption("1.21.0");
    }
    const before = (await read()).changes.length;
    const responsePromise = page.waitForResponse(
      (response) => response.url() === assistantUrl && response.request().method() === "POST",
    );
    await draft.fill(message);
    await draft.press("Enter");
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const reply = await response.json();
    assert.equal(reply.type, category);
    assert.equal(reply.context.edition, selected);
    if (category === "CLARIFICATION") {
      assert.match(reply.text, /difere da seleção/);
      assert.equal("answer" in reply, false);
    }
    const number = evidence.length + 1;
    await uiExpect(replies).toHaveCount(number);
    await uiExpect(replies.last()).toHaveAttribute("data-reply-type", category);
    const label = category === "ANSWER" ? "Orientação guiada." : "Pergunta de esclarecimento.";
    const announcement = `Resposta ${number}. ${label}`;
    await uiExpect(status).toHaveText(announcement);
    await uiExpect(draft).toBeFocused();
    const { stable, changes } = await read();
    assert.equal(stable, true, "The status region stays mounted");
    const updates = changes.slice(before);
    assert.deepEqual(updates, [announcement], "One status announcement per completed turn");
    evidence.push({
      message,
      context: reply.context,
      category,
      updates,
      accessibility: await status.ariaSnapshot(),
    });
  }
  await observation.dispose();
  await page.screenshot({ path: `${artifactDir}/chat-c-r1-anuncios-390.png` });
  return evidence;
}

let browser;
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    const forbiddenRequests = [];
    const assistantRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.href === assistantUrl && request.method() === "POST")
        assistantRequests.push(request.postDataJSON());
      else if (
        url.origin !== new URL(base).origin ||
        (url.pathname.startsWith("/api/") && url.pathname !== "/api/health")
      )
        forbiddenRequests.push(request.url());
    });
    for (const path of ["/", "/status", "/projetos", "/comunidade", "/chat"]) {
      await page.goto(new URL(path, base).href);
      await page.getByRole("main").waitFor();
      if (path === "/")
        await page
          .getByRole("heading", { name: "Seis modos. Seu mundo inteiro.", exact: true })
          .waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${path} horizontal overflow at ${width}`,
      );
      assert.doesNotMatch(await page.locator("body").innerText(), /redpro/i);
      assert.match(await page.title(), /MinePRO/);
      if (path === "/") {
        const homeCalculator = page.getByRole("link", {
          name: "Calculadora de materiais Disponível · Java e Bedrock",
          exact: true,
        });
        await uiExpect(homeCalculator).toHaveCount(1);
        await uiExpect(homeCalculator).toHaveAttribute("href", "/ferramentas/materiais");
        const bounds = await homeCalculator.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44);
        await homeCalculator.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(new URL("/ferramentas/materiais", base).href);
        await uiExpect(
          page.getByRole("heading", { name: "Calculadora de materiais", exact: true }),
        ).toBeVisible();
        await page.getByRole("link", { name: "Voltar ao chat", exact: true }).click();
        await page.waitForURL(new URL("/chat", base).href);
        await page.goto(new URL("/", base).href);
      }
      if (path === "/" && [390, 1440].includes(width)) {
        await page.locator(".home-calculator-link").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${artifactDir}/home-${width}.png` });
      }
    }
    const shortcut = page.getByRole("link", {
      name: "Abrir Calculadora de materiais",
      exact: true,
    });
    // Important tools must be usable on entry, outside the messages' independent scroll.
    async function checkShortcut() {
      await uiExpect(shortcut).toBeInViewport({ ratio: 1 });
      const target = await shortcut.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return {
          height: r.height,
          width: r.width,
          unobstructed: element.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
          inMessages: !!element.closest(".chat-scroll"),
        };
      });
      assert.ok(target.height >= 44 && target.width >= 44);
      assert.equal(target.unobstructed, true, "The composer must not cover the shortcut");
      assert.equal(target.inMessages, false);
    }
    await checkShortcut();
    await uiExpect(shortcut).toHaveAccessibleDescription("Disponível · blocos, stacks e slots");
    const bench = page.getByRole("region", { name: "Sua bancada de ferramentas", exact: true });
    await uiExpect(bench.getByRole("link")).toHaveCount(1);
    await uiExpect(bench.getByRole("button")).toHaveCount(5);
    await uiExpect(bench.getByRole("link")).toHaveAccessibleDescription("Disponível");
    for (const tool of await bench.getByRole("button").all())
      await uiExpect(tool).toHaveAccessibleDescription("Prévia · ainda não executa");
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${artifactDir}/chat-access-${width}.png` });
    await shortcut.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new URL("/ferramentas/materiais", base).href);
    await page.getByRole("link", { name: "Voltar ao chat", exact: true }).click();
    await page.waitForURL(new URL("/chat", base).href);
    await page.screenshot({ path: `${artifactDir}/chat-${width}-javamine.png`, fullPage: true });
    if (width <= 800) await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page
      .getByRole("link", { name: "Biblioteca", exact: true })
      .filter({ visible: true })
      .click();
    await page.waitForURL(new URL("/projetos", base).href);
    await page.getByRole("link", { name: "Explorar o assistente" }).click();
    await page.waitForURL(new URL("/chat", base).href);
    const draft = page.getByLabel(/^Sua mensagem/);
    const version = page.getByLabel("Versão do Minecraft", { exact: true });
    const customVersion = page.getByLabel("Outra versão (ex.: 1.21.1)");
    const applyVersion = page.getByRole("button", { name: "Aplicar", exact: true });
    const versionError = page.locator(".version-control").getByRole("alert");
    const composerError = page.locator(".composer-area").getByRole("alert");
    const contextNotice = page.locator(".context-announcement");
    const footnote = page.locator(".composer-footnote");
    const edition = (name) => page.getByRole("button", { name, exact: true });
    const mode = (name) => page.getByRole("button", { name, exact: true });
    await draft.fill("Rascunho preservado");
    await version.selectOption("1.21.1");
    await uiExpect(contextNotice).toHaveText("Versão atualizada; seu rascunho foi mantido.");
    await edition("BedMine").click();
    assert.equal(await edition("BedMine").getAttribute("aria-pressed"), "true");
    assert.equal(await draft.inputValue(), "Rascunho preservado");
    await uiExpect(version).toHaveValue("");
    await version.selectOption("1.21.0");
    for (const name of ["RED", "FARM", "BUILDER", "COMMAND", "MODS", "SURVIVAL"]) {
      await mode(name).click();
      assert.equal(await mode(name).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('.mode-picker [aria-pressed="true"]').count(), 1);
      assert.match(await page.locator(".suggestion-grid").innerText(), /BedMine/);
      if (width === 1440)
        await page.screenshot({
          path: `${artifactDir}/mode-${name.toLowerCase()}.png`,
          fullPage: true,
        });
    }
    await page.screenshot({ path: `${artifactDir}/chat-${width}-bedmine.png`, fullPage: true });
    const miningQuestion = "Quero minerar diamantes e uso picareta de pedra";
    await draft.fill(miningQuestion);
    await draft.press("Shift+Enter");
    assert.equal(await draft.inputValue(), `${miningQuestion}\n`);
    await draft.press("Enter");
    const firstAnswer = page.getByRole("article", { name: "Orientação guiada", exact: true });
    await uiExpect(firstAnswer).toContainText("prepare uma picareta de ferro");
    await uiExpect(firstAnswer).toContainText(/BedMine.*1\.21\.0.*SURVIVAL/);
    await uiExpect(page.locator(".local-message")).toHaveCount(1);
    assert.deepEqual(assistantRequests.at(-1), {
      message: miningQuestion,
      context: { edition: "BEDROCK", game_version: "1.21.0", mode: "SURVIVAL" },
    });
    await checkShortcut();
    const sentContext = page.locator(".message-meta");
    await uiExpect(sentContext).toHaveText(/BedMine.*1\.21\.0.*SURVIVAL/);
    await version.selectOption("1.20.80");
    await uiExpect(footnote).toContainText("1.20.80");
    await uiExpect(sentContext).toHaveText(/BedMine.*1\.21\.0.*SURVIVAL/);
    await edition("JavaMine").click();
    assert.match(await page.getByRole("status").innerText(), /perder validade/);
    await uiExpect(version).toHaveValue("");
    await uiExpect(sentContext).toHaveText(/BedMine.*1\.21\.0.*SURVIVAL/);
    await uiExpect(firstAnswer).toContainText(/BedMine.*1\.21\.0.*SURVIVAL/);

    if (width <= 800) {
      const trigger = page.getByRole("button", { name: "Abrir navegação" });
      await trigger.click();
      await page.getByRole("dialog", { name: "Navegação MinePRO" }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
      await trigger.click();
    }
    await page
      .getByRole("button", { name: "Nova conversa", exact: true })
      .filter({ visible: true })
      .click();
    assert.equal(await page.locator(".local-message").count(), 0);
    if (width <= 800) await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page
      .getByRole("button", { name: "Configurações do assistente", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Simular falha na próxima pergunta").check();
    await page.keyboard.press("Escape");
    await draft.fill("Meu rascunho após falha");
    await draft.press("Enter");
    await uiExpect(composerError).toHaveText(
      "Falha simulada: sua mensagem foi preservada. Tente novamente.",
    );
    await uiExpect(draft).not.toHaveAttribute("aria-invalid");
    await uiExpect(draft).not.toHaveAccessibleDescription(/Falha simulada/);
    await uiExpect(version).not.toHaveAttribute("aria-invalid");
    await uiExpect(versionError).toHaveCount(0);
    assert.equal(await draft.inputValue(), "Meu rascunho após falha");
    assert.equal(await page.locator(".local-message").count(), 0);
    await draft.press("Enter");
    await page.locator(".local-message").waitFor();
    assert.equal(await page.locator(".local-message").count(), 1);
    await uiExpect(page.getByRole("article", { name: "Sem orientação validada" })).toContainText(
      "Ainda não há orientação validada",
    );
    await uiExpect(composerError).toHaveCount(0);
    for (const invalidDraft of ["", "x".repeat(4001)]) {
      await draft.fill(invalidDraft);
      await draft.press("Enter");
      await uiExpect(composerError).toHaveText(messageErrorText);
      await uiExpect(draft).toHaveAttribute("aria-invalid", "true");
      await uiExpect(draft).toHaveAccessibleDescription(new RegExp(messageErrorText));
      await uiExpect(draft).toHaveValue(invalidDraft);
      await uiExpect(versionError).toHaveCount(0);
      await uiExpect(version).not.toHaveAttribute("aria-invalid");
      await uiExpect(page.locator(".local-message")).toHaveCount(1);
    }
    for (const name of [
      "Doutor de crash logs",
      "Java ↔ Bedrock",
      "Assistente de seeds",
      "Otimizador de encantamentos",
      "Guia de mineração Y-Level",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      const panel = page.getByRole("dialog", { name, exact: true });
      await panel.waitFor();
      assert.match(await panel.innerText(), /sem execução/);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Assistente de seeds", exact: true }).click();
    await page.getByRole("button", { name: "Preparar pergunta", exact: true }).click();
    const preparedDraft = await draft.inputValue();
    assert.match(preparedDraft, /verificar uma seed/);
    assert.equal(await mode("SURVIVAL").getAttribute("aria-pressed"), "true");
    await version.selectOption("1.21.1");
    await uiExpect(contextNotice).toContainText("Contexto alterado");
    await version.selectOption("custom");
    await customVersion.fill("invalid");
    await customVersion.press("Tab");
    await uiExpect(applyVersion).toBeFocused();
    await page.keyboard.press("Enter");
    await uiExpect(versionError).toHaveText(versionErrorText);
    await uiExpect(contextNotice).toBeEmpty();
    await uiExpect(customVersion).toHaveAttribute("aria-invalid", "true");
    await uiExpect(customVersion).toHaveAccessibleDescription(versionErrorText);
    await uiExpect(draft).not.toHaveAttribute("aria-invalid");
    await customVersion.fill("1.21.1");
    await customVersion.press("Enter");
    await uiExpect(customVersion).toBeFocused();
    await uiExpect(versionError).toHaveCount(0);
    await uiExpect(customVersion).not.toHaveAttribute("aria-invalid");
    await uiExpect(customVersion).not.toHaveAttribute("aria-describedby");
    await uiExpect(footnote).toContainText("1.21.1");
    await uiExpect(draft).toHaveValue(preparedDraft);
    await uiExpect(mode("SURVIVAL")).toHaveAttribute("aria-pressed", "true");
    await version.selectOption("");

    for (let round = 0; round < versionRounds; round++) {
      try {
        await version.selectOption("custom");
        await uiExpect(versionError).toHaveCount(0);
        await customVersion.fill("invalid");
        await uiExpect(customVersion).toHaveValue("invalid");
        await applyVersion.click();
        await uiExpect(versionError).toHaveText(versionErrorText);
        await uiExpect(contextNotice).toBeEmpty();
        await uiExpect(versionError).toBeVisible();
        await uiExpect(customVersion).toHaveAttribute("aria-invalid", "true");
        await uiExpect(customVersion).toHaveAccessibleDescription(versionErrorText);
        await uiExpect(draft).not.toHaveAttribute("aria-invalid");
        await uiExpect(composerError).toHaveCount(0);
        await uiExpect(footnote).toContainText("Versão não informada");
        await customVersion.fill("1.20.2");
        await uiExpect(customVersion).toHaveValue("1.20.2");
        await applyVersion.click();
        await uiExpect(footnote).toContainText("1.20.2");
        await uiExpect(versionError).toHaveCount(0);
        await uiExpect(customVersion).not.toHaveAttribute("aria-invalid");
        await uiExpect(draft).toHaveValue(preparedDraft);
        if (round < versionRounds - 1) {
          await version.selectOption("");
          await uiExpect(footnote).toContainText("Versão não informada");
        }
      } catch (error) {
        const state = await page
          .evaluate(() => ({
            input: document.querySelector("#custom-version")?.value ?? null,
            busy: document.querySelector(".chat-composer")?.getAttribute("aria-busy"),
            version: document.querySelector("#game-version")?.value ?? null,
            errorVisible: !!document.querySelector("#version-error")?.getClientRects().length,
            versionInvalid: document.querySelector("#custom-version")?.getAttribute("aria-invalid"),
            openDialogs: document.querySelectorAll("dialog[open]").length,
          }))
          .catch(() => ({ unavailable: true }));
        console.error("Version validation diagnostic", { width, round, ...state });
        throw error;
      }
    }
    console.log(`PASS version validation ${width}px: ${versionRounds} invalid/valid cycles`);
    // Native dialog must keep focus within the modal on repeated Tab navigation.
    await page.getByRole("button", { name: "Assistente de seeds", exact: true }).click();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
        true,
      );
    }
    await page.keyboard.press("Escape");
    // Approximate 200% zoom by doubling root text size. Browser/device zoom remains a manual gate.
    const chatZoom = await page.addStyleTag({ content: "html { font-size: 200%; }" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `200% text overflow at ${width}`,
    );
    await chatZoom.evaluate((element) => element.remove());

    // Open the one functional tool through the chat link after existing regressions.
    await page.getByRole("link", { name: "Calculadora de materiais", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(new URL("/ferramentas/materiais", base).href);
    await uiExpect(
      page.getByRole("heading", { name: "Calculadora de materiais", exact: true }),
    ).toBeVisible();
    const materialRequests = [];
    const trackMaterialRequest = (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin || url.pathname.startsWith("/api/"))
        materialRequests.push(url.pathname);
    };
    page.on("request", trackMaterialRequest);
    const shape = page.getByLabel("Tipo de construção");
    const length = page.getByLabel("Comprimento");
    const breadth = page.getByLabel("Largura");
    const calculate = page.getByRole("button", { name: "Calcular blocos" });
    const nameField = page.getByLabel("Nome do material");
    const quantity = page.getByLabel("Quantidade", { exact: true });
    const stack = page.getByLabel("Tamanho da stack");
    const add = page.getByRole("button", { name: "Adicionar à lista" });
    const copy = page.getByRole("button", { name: "Copiar lista" });
    const inventory = page.getByRole("region", { name: "Lista de materiais" });
    const row = (name) => inventory.getByRole("listitem").filter({ hasText: name });
    await uiExpect(copy).toBeDisabled();
    await uiExpect(inventory).toContainText("Sua lista está vazia");
    await length.fill("1001");
    await breadth.fill("10");
    await calculate.click();
    await uiExpect(length).toHaveAttribute("aria-invalid", "true");
    await uiExpect(length).toBeFocused();
    await length.fill("15");
    await calculate.click();
    await uiExpect(page.getByText("150 blocos estimados")).toBeVisible();
    await page.getByRole("button", { name: "Usar estimativa na lista" }).click();
    await uiExpect(nameField).toBeFocused();
    await uiExpect(quantity).toHaveValue("150");
    await nameField.fill("Pedra lisa");
    await add.click();
    await uiExpect(row("Pedra lisa").locator("dd")).toHaveText(["150", "2", "22", "3"]);

    await shape.selectOption("volume");
    await page.getByLabel("Altura").fill("3");
    await calculate.click();
    await uiExpect(page.getByText("450 blocos estimados")).toBeVisible();
    await shape.selectOption("walls");
    await length.fill("1");
    await calculate.click();
    await uiExpect(page.getByText("Informe um número inteiro de 2 a 1.000.")).toBeVisible();
    await length.fill("15");
    await calculate.click();
    await uiExpect(page.getByText("138 blocos estimados")).toBeVisible();

    await nameField.fill("Pérola");
    await quantity.fill("1e3");
    await add.click();
    await uiExpect(quantity).toHaveAttribute("aria-invalid", "true");
    await quantity.fill("32");
    await stack.selectOption("16");
    await add.click();
    await uiExpect(row("Pérola").locator("dd")).toHaveText(["32", "2", "0", "2"]);
    await inventory.getByRole("button", { name: "Editar Pérola" }).click();
    await uiExpect(nameField).toBeFocused();
    await uiExpect(nameField).toHaveValue("Pérola");
    await nameField.fill("Balde");
    await quantity.fill("4");
    await stack.selectOption("1");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await uiExpect(row("Pérola")).toHaveCount(0);
    await uiExpect(row("Balde").locator("dd")).toHaveText(["4", "4", "0", "4"]);
    await uiExpect(inventory).toContainText("154 unidades no total");
    await uiExpect(inventory).toContainText("7 slots estimados");

    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${artifactDir}/materials-${width}.png`, fullPage: true });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await copy.click();
    await uiExpect(page.getByText("Lista copiada.", { exact: true })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /Pedra lisa: 150 un\. \| stack de 64/);
    assert.match(clipboard, /Total: 154 unidades · 7 slots estimados/);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Clipboard denied by test");
          },
        },
      }),
    );
    await copy.click();
    await uiExpect(page.getByLabel("Texto da lista")).toHaveValue(clipboard);
    await inventory.getByRole("button", { name: "Remover Balde" }).click();
    await uiExpect(row("Balde")).toHaveCount(0);
    await uiExpect(inventory).toContainText("3 slots estimados");
    await inventory.getByRole("button", { name: "Remover Pedra lisa" }).click();
    await uiExpect(copy).toBeDisabled();
    await uiExpect(inventory).toContainText("0 unidades no total");

    await nameField.fill("M".repeat(80));
    await quantity.fill("1000000000");
    await stack.selectOption("1");
    await add.click();
    await uiExpect(inventory).toContainText("1.000.000.000 slots estimados");
    await uiExpect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await uiExpect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    assert.deepEqual(materialRequests, [], "Materials must not send data outside the page");
    page.off("request", trackMaterialRequest);
    await page.reload();
    await uiExpect(inventory).toContainText("Sua lista está vazia");
    await page.getByRole("link", { name: "Voltar ao chat", exact: true }).click();
    await page.waitForURL(new URL("/chat", base).href);
    console.log(
      `PASS materiais ${width}px: rota, geometria, stacks, edição, remoção, cópia e overflow`,
    );
    if (width === 390) {
      const recovery = await checkGuidedConversation(page, assistantRequests);
      const consecutive = await checkContextAnnouncements(page);
      await writeFile(
        `${artifactDir}/chat-c-r1-anuncios.json`,
        JSON.stringify({ recovery, consecutive }, null, 2) + "\n",
      );
      console.log(
        "PASS assistente 390px: esclarecimento, resposta, falha de rede, reenvio, duplicação e nova conversa",
      );
      console.log(
        "PASS C-R1 390px: conflitos de contexto e anúncios consecutivos na região estável",
      );
    }
    assert.deepEqual(errors, [], `Browser errors at ${width}`);
    assert.deepEqual(
      forbiddenRequests,
      [],
      "The guided chat must only call its own assistant endpoint",
    );
    results.push({
      width,
      result: "PASS",
      routes: 5,
      editions: 2,
      modes: 6,
      tools: 6,
      materialsCalculator: "PASS",
      versionValidationCycles: versionRounds,
      sameVersionRecovery: "PASS",
      consoleErrors: 0,
      aiRequests: 0,
      assistantRequests: assistantRequests.length,
      ...(width === 390 ? { guidedConversation: "PASS", contextAnnouncements: "PASS" } : {}),
    });
    console.log(
      `PASS UI ${width}px: routes, editions, modes, context, retry, tools, keyboard and text scaling`,
    );
    await context.close();
    await browser?.close();
  }
  // Regression: a short viewport must not let the composer cover the tool buttons.
  browser = await chromium.launch(launchOptions);
  const compact = await browser.newContext({
    viewport: { width: 320, height: 360 },
    reducedMotion: "reduce",
  });
  const page = await compact.newPage();
  const compactErrors = [];
  page.on("pageerror", (error) => compactErrors.push(error.message));
  await page.goto(new URL("/chat", base).href);
  const draft = page.getByLabel(/^Sua mensagem/);
  await draft.fill("Rascunho em uma janela baixa");
  await page.getByRole("button", { name: "BedMine", exact: true }).click();
  await page.getByLabel("Versão do Minecraft", { exact: true }).selectOption("1.21.0");
  assert.equal(await draft.inputValue(), "Rascunho em uma janela baixa");
  const geometry = await page.evaluate(() => {
    const scroll = document.querySelector(".chat-scroll").getBoundingClientRect();
    const composer = document.querySelector(".composer-area").getBoundingClientRect();
    const shortcut = document.querySelector(".chat-calculator-link").getBoundingClientRect();
    return {
      messageRegionHeight: scroll.height,
      composerOverlaps: composer.top < scroll.bottom - 1,
      shortcutOverlaps: shortcut.bottom > scroll.top || shortcut.bottom > composer.top,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.ok(geometry.messageRegionHeight >= 44, "Message region must retain a usable height");
  assert.equal(geometry.composerOverlaps, false);
  assert.equal(geometry.shortcutOverlaps, false);
  assert.equal(geometry.horizontalOverflow, false);
  await page.getByRole("button", { name: "Guia de mineração Y-Level", exact: true }).click();
  await page.getByRole("dialog", { name: "Guia de mineração Y-Level", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enviar pergunta" }).click();
  await page.locator(".local-message").waitFor();
  await uiExpect(page.getByRole("article", { name: "Sem orientação validada" })).toBeVisible();
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page.getByRole("dialog", { name: "Navegação MinePRO" }).waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${artifactDir}/chat-320x360.png`, fullPage: true });
  const compactVersion = page.getByLabel("Versão do Minecraft", { exact: true });
  const compactCustom = page.getByLabel("Outra versão (ex.: 1.21.1)");
  const compactVersionError = page.locator(".version-control").getByRole("alert");
  await compactVersion.selectOption("custom");
  await compactCustom.fill("invalid");
  await compactCustom.press("Enter");
  await uiExpect(compactVersionError).toBeVisible();
  await uiExpect(compactCustom).toHaveAccessibleDescription(versionErrorText);
  await uiExpect(draft).not.toHaveAttribute("aria-invalid");
  await page.screenshot({ path: `${artifactDir}/version-error-320x360.png`, fullPage: true });
  const messageHeightWithVersionError = await page
    .locator(".chat-scroll")
    .evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(
    messageHeightWithVersionError >= 44,
    `Message region height with custom version error: ${messageHeightWithVersionError}px`,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await compactCustom.fill("1.21.0");
  await compactCustom.press("Enter");
  await uiExpect(compactVersionError).toHaveCount(0);
  await uiExpect(compactCustom).not.toHaveAttribute("aria-invalid");
  await uiExpect(page.locator(".message-meta")).toHaveText(/BedMine.*1\.21\.0/);
  await draft.focus();
  await uiExpect(draft).toBeInViewport();
  assert.deepEqual(compactErrors, []);
  results.push({
    width: 320,
    height: 360,
    scenario: "short-viewport",
    result: "PASS",
    ...geometry,
    messageHeightWithVersionError,
  });
  console.log(
    "PASS UI 320x360px: composer does not cover tools; draft, send and mobile menu remain usable",
  );
  await compact.close();
} finally {
  await browser?.close();
}
await writeFile(`${artifactDir}/results.json`, JSON.stringify(results, null, 2) + "\n");
