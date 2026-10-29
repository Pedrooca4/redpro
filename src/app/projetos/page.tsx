import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
export const metadata: Metadata = { title: "Biblioteca" };
export default function ProjectsPage() {
  return (
    <PlannedPage
      title="Biblioteca de projetos"
      description="A biblioteca está em desenvolvimento; ainda não há projetos publicados."
    />
  );
}
