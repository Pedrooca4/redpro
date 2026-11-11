import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";

// Match the existing locator wait budget; wait for observable state, never sleep
// or repeat a failed action to manufacture a pass.
const uiExpect = expect.configure({ timeout: 30_000 });
const versionRounds = 20;

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
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
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\/api\/(chat|tools|conversations)/.test(request.url()))
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
    const edition = (name) => page.getByRole("button", { name, exact: true });
    const mode = (name) => page.getByRole("button", { name, exact: true });
    await draft.fill("Rascunho preservado");
    await page.getByLabel("Versão do Minecraft", { exact: true }).selectOption("1.21.1");
    await edition("BedMine").click();
    assert.equal(await edition("BedMine").getAttribute("aria-pressed"), "true");
    assert.equal(await draft.inputValue(), "Rascunho preservado");
    assert.equal(await page.getByLabel("Versão do Minecraft", { exact: true }).inputValue(), "");
    await page.getByLabel("Versão do Minecraft", { exact: true }).selectOption("1.21.0");
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
    await draft.fill("Mensagem local segura");
    await draft.press("Shift+Enter");
    assert.equal(await draft.inputValue(), "Mensagem local segura\n");
    await draft.press("Enter");
    await page
      .getByText("Protótipo: respostas de IA ainda não estão disponíveis.", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".local-message").count(), 1);
    await checkShortcut();
    assert.match(await page.locator(".message-meta").innerText(), /BedMine.*1.21.0.*SURVIVAL/);
    await edition("JavaMine").click();
    assert.match(await page.getByRole("status").innerText(), /perder validade/);
    assert.match(await page.locator(".message-meta").innerText(), /BedMine/);

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
      .getByRole("button", { name: "Configurações da demonstração", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Simular falha na próxima mensagem local").check();
    await page.keyboard.press("Escape");
    await draft.fill("Meu rascunho após falha");
    await draft.press("Enter");
    await page.locator(".composer-error").waitFor();
    assert.equal(await draft.inputValue(), "Meu rascunho após falha");
    assert.equal(await page.locator(".local-message").count(), 0);
    await draft.press("Enter");
    await page.locator(".local-message").waitFor();
    assert.equal(await page.locator(".local-message").count(), 1);
    await draft.fill("x".repeat(4001));
    await draft.press("Enter");
    await page.locator(".composer-error").waitFor();
    assert.equal((await draft.inputValue()).length, 4001);
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
    assert.match(await draft.inputValue(), /verificar uma seed/);
    assert.equal(await mode("SURVIVAL").getAttribute("aria-pressed"), "true");
    const version = page.getByLabel("Versão do Minecraft", { exact: true });
    const customVersion = page.getByLabel("Outra versão (ex.: 1.21.1)");
    const applyVersion = page.getByRole("button", { name: "Aplicar", exact: true });
    const composerError = page.locator(".composer-error");
    const footnote = page.locator(".composer-footnote");
    for (let round = 0; round < versionRounds; round++) {
      try {
        await version.selectOption("custom");
        await uiExpect(composerError).toBeHidden();
        await customVersion.fill("invalid");
        await uiExpect(customVersion).toHaveValue("invalid");
        await applyVersion.click();
        await uiExpect(composerError).toHaveText(
          "Informe uma versão numérica, como 1.21.1, ou deixe a versão não informada.",
        );
        await uiExpect(composerError).toBeVisible();
        await uiExpect(footnote).toContainText("Versão não informada");
        await customVersion.fill("1.20.2");
        await uiExpect(customVersion).toHaveValue("1.20.2");
        await applyVersion.click();
        await uiExpect(footnote).toContainText("1.20.2");
        await uiExpect(composerError).toBeHidden();
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
            errorVisible: !!document.querySelector(".composer-error")?.getClientRects().length,
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
    assert.deepEqual(errors, [], `Browser errors at ${width}`);
    assert.deepEqual(
      forbiddenRequests,
      [],
      "Prototype must never call real chat or tools endpoints",
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
      consoleErrors: 0,
      aiRequests: 0,
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
  await page.getByRole("button", { name: "Enviar mensagem de demonstração" }).click();
  await page.locator(".local-message").waitFor();
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page.getByRole("dialog", { name: "Navegação MinePRO" }).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(compactErrors, []);
  await page.screenshot({ path: `${artifactDir}/chat-320x360.png`, fullPage: true });
  results.push({
    width: 320,
    height: 360,
    scenario: "short-viewport",
    result: "PASS",
    ...geometry,
  });
  console.log(
    "PASS UI 320x360px: composer does not cover tools; draft, send and mobile menu remain usable",
  );
  await compact.close();
} finally {
  await browser?.close();
}
await writeFile(`${artifactDir}/results.json`, JSON.stringify(results, null, 2) + "\n");
