import type { Metadata } from "next";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "RedPro — Sua próxima farm começa aqui", template: "%s | RedPro" },
  description: "O RedPro está sendo construído: inteligência artificial para redstone, farms e mecanismos de Minecraft. Conheça o projeto e acompanhe a primeira etapa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><a className="skip-link" href="#conteudo">Pular para o conteúdo</a>{children}</body></html>;
}
