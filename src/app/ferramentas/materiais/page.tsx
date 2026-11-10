import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Blocks } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MaterialCalculator } from "@/features/materials/material-calculator";
import "@/styles/materials.css";

export const metadata: Metadata = {
  title: "Calculadora de materiais",
  description:
    "Estime blocos para suas construções e organize materiais em stacks e slots no MinePRO.",
};

export default function MaterialsPage() {
  return (
    <>
      <SiteHeader homePage={false} />
      <main id="conteudo" className="shell materials-page">
        <Link className="back-link" href="/chat">
          <ArrowLeft size={17} aria-hidden="true" /> Voltar à bancada
        </Link>
        <header className="materials-intro">
          <span className="materials-mark">
            <Blocks size={29} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">BANCADA MINEPRO · JAVA E BEDROCK</p>
            <h1>Calculadora de materiais</h1>
            <p>Planeje os blocos da sua construção e saiba quantos slots reservar.</p>
          </div>
        </header>
        <p className="materials-local">
          Cálculo determinístico, sem IA. A lista fica nesta página e é descartada ao sair ou
          recarregar.
        </p>
        <MaterialCalculator />
      </main>
      <SiteFooter />
    </>
  );
}
