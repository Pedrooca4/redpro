import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { expect } from "playwright/test";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifactDir = process.env.UI_ARTIFACT_DIR || "coverage/ui";
await mkdir(artifactDir, { recursive: true });
const expectUI = expect.configure({ timeout: 30000 });
const fixture =
  "TESTE AUTOMATIZADO · RESPOSTA SIMULADA\n\nNo Java 1.21.1, reúna madeira e procure um abrigo.\n<img src=x onerror=alert('fixture')>";
for (const width of [320, 390, 768, 1440]) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let posts = 0,
      status = 200,
      releaseReply;
    let responseGate = Promise.resolve();
    await page.route("**/api/chat", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
      posts++;
      const body = route.request().postDataJSON();
      assert.equal(body.context.edition, "JAVA");
      assert.equal(body.context.game_version, "1.21.1");
      assert.equal(body.messages.at(-1).role, "user");
      assert.ok(!("model" in body));
      await responseGate;
      await route.fulfill({
        status,
        json:
          status === 200
            ? { text: fixture, truncated: false }
            : {
                error: {
                  code: status === 429 ? "RATE_LIMITED" : "TIMEOUT",
                  message: "untrusted-provider-fixture",
                },
              },
      });
    });
    await page.goto(new URL("/chat", base).href);
    await expectUI(
      page.getByText(
        "IA pode errar. Confira edição e versão. Não envie dados pessoais ou credenciais.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByLabel("Versão do Minecraft", { exact: true }).selectOption("1.21.1");
    const draft = page.getByLabel(/^Sua mensagem/);
    await draft.fill("Como sobreviver à primeira noite?");
    responseGate = new Promise((resolve) => {
      releaseReply = resolve;
    });
    await draft.press("Enter");
    await expectUI(
      page.getByText("MinePRO está preparando sua resposta…", { exact: true }),
    ).toBeVisible();
    await expectUI(
      page.getByRole("button", { name: "Gerando resposta", exact: true }),
    ).toBeDisabled();
    releaseReply();
    const answer = page.getByRole("article", { name: "Resposta do MinePRO", exact: true });
    await expectUI(answer).toContainText(fixture);
    await expectUI(answer.locator("img")).toHaveCount(0);
    await expectUI(
      page.getByRole("article", { name: "Mensagem do jogador", exact: true }),
    ).toHaveCount(1);
    await expectUI(draft).toHaveValue("");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await answer.getByRole("button", { name: "Copiar resposta", exact: true }).click();
    await expectUI(answer).toContainText("Resposta copiada.");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), fixture);
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${artifactDir}/ai-chat-${width}.png`, fullPage: true });
    for (const failure of [429, 504]) {
      status = failure;
      await draft.fill("Minha pergunta para tentar novamente");
      await draft.press("Enter");
      await expectUI(page.locator(".composer-error")).toBeVisible();
      await expectUI(draft).toHaveValue("Minha pergunta para tentar novamente");
      await expectUI(page.locator(".composer-error")).not.toContainText(
        "untrusted-provider-fixture",
      );
      assert.equal(await answer.count(), failure === 429 ? 1 : 2);
      status = 200;
      await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
      await expectUI(draft).toHaveValue("");
    }
    await expectUI(answer).toHaveCount(3);
    assert.equal(posts, 5, "Each retry must be explicit; no automatic provider retry");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.addStyleTag({ content: "html {font-size:200%;}" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.reload();
    await expectUI(answer).toHaveCount(0);
    await page.getByRole("link", { name: "Abrir Calculadora de materiais", exact: true }).click();
    await page.waitForURL(new URL("/ferramentas/materiais", base).href);
    await expectUI(
      page.getByRole("heading", { name: "Calculadora de materiais", exact: true }),
    ).toBeVisible();
    assert.deepEqual(errors, []);
    console.log(
      `PASS AI UI ${width}px: simulated responses, safe rendering, loading, explicit retries, copy, keyboard, context and calculator`,
    );
  } finally {
    await browser.close();
  }
}
