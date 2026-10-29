import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
export const metadata: Metadata = { title: "Comunidade" };
export default function CommunityPage() {
  return (
    <PlannedPage
      title="Comunidade MinePRO"
      description="A comunidade está em desenvolvimento; ainda não há publicações de jogadores."
    />
  );
}
