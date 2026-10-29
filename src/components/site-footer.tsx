import Link from "next/link";
import { Blocks } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div>
          <Link className="footer-brand" href="/">
            <Blocks size={18} aria-hidden="true" /> MinePRO
          </Link>
          <p>Uma ideia de cada vez. Bloco por bloco.</p>
        </div>
        <p className="minecraft-note">
          Projeto independente, sem afiliação à Mojang ou à Microsoft.
        </p>
        <Link href="/status">
          Versão inicial <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </footer>
  );
}
