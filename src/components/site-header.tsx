import Link from "next/link";
import { ArrowUpRight, Blocks } from "lucide-react";

export function SiteHeader({
  statusPage = false,
  homePage = true,
}: {
  statusPage?: boolean;
  homePage?: boolean;
}) {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="MinePRO, início">
          <span className="brand-symbol">
            <Blocks size={23} strokeWidth={2.3} aria-hidden="true" />
          </span>
          <span>
            Mine<span className="text-green">PRO</span>
            <span className="brand-dot">.</span>
          </span>
        </Link>
        <nav className="main-nav" aria-label="Navegação principal">
          <Link href="/" aria-current={homePage && !statusPage ? "page" : undefined}>
            Início
          </Link>
          <Link href="/chat">Assistente</Link>
          <Link href="/projetos">Biblioteca</Link>
        </nav>
        <Link className="header-link" href="/status" aria-current={statusPage ? "page" : undefined}>
          Estado do projeto <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
