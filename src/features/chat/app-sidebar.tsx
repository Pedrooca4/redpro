import Link from "next/link";
import {
  Plus,
  MessageSquare,
  BookOpen,
  Users,
  Settings2,
  ArrowUpRight,
  History,
} from "lucide-react";
import { MineproBrand } from "@/components/minepro-brand";

export function AppSidebar({
  onNew,
  onSettings,
  onNavigate,
  aiAvailable = false,
}: {
  onNew: () => void;
  onSettings: () => void;
  onNavigate?: () => void;
  aiAvailable?: boolean;
}) {
  return (
    <div className="sidebar-content">
      <Link href="/" aria-label="MinePRO, início" onClick={onNavigate}>
        <MineproBrand />
      </Link>
      <button type="button" className="new-conversation" onClick={onNew}>
        <Plus size={18} aria-hidden="true" />
        Nova conversa
      </button>
      <nav aria-label="Navegação do assistente">
        <Link href="/chat" aria-current="page" onClick={onNavigate}>
          <MessageSquare size={18} aria-hidden="true" />
          Assistente<span className="nav-badge">{aiAvailable ? "IA" : "DEMO"}</span>
        </Link>
        <Link href="/projetos" onClick={onNavigate}>
          <BookOpen size={18} aria-hidden="true" />
          Biblioteca
        </Link>
        <Link href="/comunidade" onClick={onNavigate}>
          <Users size={18} aria-hidden="true" />
          Comunidade
        </Link>
      </nav>
      <div className="conversation-history">
        <p className="sidebar-label">
          <History size={14} aria-hidden="true" />
          CONVERSAS
        </p>
        <p>
          {aiAvailable
            ? "A conversa atual fica nesta página e é descartada ao sair ou recarregar."
            : "Suas conversas aparecerão aqui quando o histórico estiver disponível."}
        </p>
        <span>Somente nesta página, por enquanto.</span>
      </div>
      <div className="sidebar-bottom">
        <button type="button" onClick={onSettings}>
          <Settings2 size={17} aria-hidden="true" />
          {aiAvailable ? "Preferências da sessão" : "Configurações da demonstração"}
        </button>
        <Link href="/status" onClick={onNavigate}>
          Estado do MinePRO
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
        <p>
          <span className="status-dot" />
          Protótipo em desenvolvimento
        </p>
      </div>
    </div>
  );
}
