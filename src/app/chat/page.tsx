import type { Metadata } from "next";
import { ChatShell } from "@/features/chat/chat-shell";
export const metadata: Metadata = {
  title: "Assistente",
  description:
    "Planeje e tire dúvidas de Minecraft no MinePRO, com JavaMine, BedMine e seis especialidades. A disponibilidade da IA é informada no chat.",
};
export default function ChatPage() {
  return <ChatShell />;
}
