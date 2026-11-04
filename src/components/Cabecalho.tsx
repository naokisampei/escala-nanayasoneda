"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { identidade } from "@/config/identidade";
import { menu } from "@/config/menu";

export function Cabecalho() {
  const caminho = usePathname();
  return (
    <header
      className="sticky top-0 z-10 border-b border-white/10 text-white shadow-lg"
      style={{ background: "var(--cor-principal)" }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-3 pb-2">
        {identidade.logo ? (
          <Image
            src={identidade.logo}
            alt={identidade.nome}
            width={60}
            height={48}
            priority
            className="h-12 w-auto object-contain"
          />
        ) : null}
        <span className="text-lg leading-tight font-bold tracking-tight">{identidade.nome}</span>
      </div>
      <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pb-2">
        {menu.map((item) => {
          const ativo = caminho === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg border-b-2 px-3 py-2 text-sm font-semibold ${
                ativo ? "border-white bg-white/15" : "border-transparent text-white/80"
              }`}
            >
              {item.rotulo}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
