import type { Metadata } from "next";
import { ChatShell } from "@/features/chat/chat-shell";
export const metadata: Metadata = {
  title: "Assistente",
  description:
    "Use a assistência guiada do MinePRO em seis especialidades, com contexto JavaMine ou BedMine.",
};
export default function ChatPage() {
  return <ChatShell />;
}
