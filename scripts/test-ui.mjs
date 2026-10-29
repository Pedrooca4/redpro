import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

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
      if (path === "/" && [390, 1440].includes(width))
        await page.screenshot({ path: `${artifactDir}/home-${width}.png`, fullPage: true });
    }
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
      "Calculadora de materiais",
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
    await page.getByRole("button", { name: "Calculadora de materiais", exact: true }).click();
    await page.getByRole("button", { name: "Preparar pergunta", exact: true }).click();
    assert.match(await draft.inputValue(), /medidas e materiais/);
    assert.equal(await mode("BUILDER").getAttribute("aria-pressed"), "true");
    await page.getByLabel("Versão do Minecraft", { exact: true }).selectOption("custom");
    await page.getByLabel("Outra versão (ex.: 1.21.1)").fill("invalid");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await page.locator(".composer-error").waitFor();
    await page.getByLabel("Outra versão (ex.: 1.21.1)").fill("1.20.2");
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    assert.match(await page.locator(".composer-footnote").innerText(), /1.20.2/);
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
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `200% text overflow at ${width}`,
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
    return {
      messageRegionHeight: scroll.height,
      composerOverlaps: composer.top < scroll.bottom - 1,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.ok(geometry.messageRegionHeight >= 44, "Message region must retain a usable height");
  assert.equal(geometry.composerOverlaps, false);
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
