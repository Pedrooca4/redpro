import type { Metadata } from "next";
import { ChatShell } from "@/features/chat/chat-shell";
export const metadata: Metadata = {
  title: "Assistente",
  description:
    "Explore a demonstração do assistente MinePRO com JavaMine, BedMine e seis especialidades. IA real ainda não conectada.",
};
export default function ChatPage() {
  return <ChatShell />;
}
