import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "MinePRO — Minecraft inteiro. Uma ajuda inteligente.",
    template: "%s | MinePRO",
  },
  description:
    "Farms, redstone, construções, mods, comandos e sobrevivência — para sua edição e versão. Explore a demonstração do MinePRO.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
