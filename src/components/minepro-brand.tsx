import { Blocks } from "lucide-react";

export function MineproBrand() {
  return (
    <span className="brand">
      <span className="brand-symbol">
        <Blocks size={23} strokeWidth={2.3} aria-hidden="true" />
      </span>
      <span>
        Mine<span className="text-green">PRO</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
