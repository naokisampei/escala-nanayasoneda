"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, variaveisConfiguradas } from "@/lib/supabase";
import { FUNCOES_PADRAO, type Regra, type Turno } from "@/lib/tipos";
import { DIAS_SEMANA } from "@/lib/datas";
import { CHAVE_FECHAR_ABRIR, CHAVE_FOLGAS, lerConfiguracoes } from "@/lib/regras";

type Formulario = {
  id: string | null; // null = regra nova
  turno_id: string;
  dia_semana: string; // "" = todos os dias
  funcao: string;
  minimo: string;
};

export default function RegrasDaCasa() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [funcoesEquipe, setFuncoesEquipe] = useState<string[]>([]);
  const [folgas, setFolgas] = useState("1");
  const [fecharAbrir, setFecharAbrir] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    if (!variaveisConfiguradas()) {
      setErro("As variáveis do Supabase não foram configuradas.");
      setCarregando(false);
      return;
    }
    const db = supabase();
    const [t, r, c, f] = await Promise.all([
      db.from("turnos").select("id, nome, hora_inicio, hora_fim, ordem").order("ordem"),
      db.from("regras").select("id, dia_semana, turno_id, funcao, minimo"),
      db.from("configuracoes").select("chave, valor"),
      db.from("funcionarios").select("funcao"),
    ]);
    const falha = t.error ?? r.error ?? c.error ?? f.error;
    if (falha) {
      setErro(`Não foi possível carregar as regras. Detalhe: ${falha.message}`);
    } else {
      setTurnos(t.data ?? []);
      setRegras(r.data ?? []);
      setFuncoesEquipe((f.data ?? []).map((x) => x.funcao as string));
      const conf = lerConfiguracoes(c.data ?? []);
      setFolgas(String(conf.folgasMinimasSemana));
      setFecharAbrir(conf.bloquearFecharEAbrir);
    }
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, []);

  const funcoes = useMemo(
    () => Array.from(new Set([...FUNCOES_PADRAO, ...funcoesEquipe])),
    [funcoesEquipe],
  );

  // Ordena: por turno, depois "todos os dias" antes dos dias específicos, depois função.
  const ordemTurno = (id: string) => turnos.find((t) => t.id === id)?.ordem ?? 99;
  const regrasOrdenadas = [...regras].sort(
    (a, b) =>
      ordemTurno(a.turno_id) - ordemTurno(b.turno_id) ||
      (a.dia_semana ?? -1) - (b.dia_semana ?? -1) ||
      a.funcao.localeCompare(b.funcao),
  );

  const nomeTurno = (id: string) => turnos.find((t) => t.id === id)?.nome ?? "?";
  const nomeDia = (d: number | null) => (d === null ? "Todos os dias" : DIAS_SEMANA[d]);

  async function salvarConfiguracoes() {
    const n = Number(folgas);
    if (!Number.isInteger(n) || n < 0 || n > 7) {
      setErro("Folgas mínimas deve ser um número de 0 a 7.");
      return;
    }
    setErro(null);
    setAviso(null);
    const { error } = await supabase()
      .from("configuracoes")
      .upsert([
        { chave: CHAVE_FOLGAS, valor: String(n) },
        { chave: CHAVE_FECHAR_ABRIR, valor: fecharAbrir ? "true" : "false" },
      ]);
    if (error) setErro(`Não foi possível salvar. Detalhe: ${error.message}`);
    else setAviso("Configurações salvas.");
  }

  async function salvarRegra(e: React.FormEvent) {
    e.preventDefault();
    if (!formulario) return;
    const minimo = Number(formulario.minimo);
    if (!formulario.turno_id || !formulario.funcao || !Number.isInteger(minimo) || minimo < 0) {
      setErro("Preencha turno, função e um mínimo válido (0 ou mais).");
      return;
    }
    setSalvando(true);
    setErro(null);
    setAviso(null);
    const dados = {
      turno_id: formulario.turno_id,
      dia_semana: formulario.dia_semana === "" ? null : Number(formulario.dia_semana),
      funcao: formulario.funcao,
      minimo,
    };
    const db = supabase().from("regras");
    const { error } = formulario.id
      ? await db.update(dados).eq("id", formulario.id)
      : await db.insert(dados);
    setSalvando(false);
    if (error) {
      setErro(`Não foi possível salvar. Detalhe: ${error.message}`);
      return;
    }
    setFormulario(null);
    carregar();
  }

  async function removerRegra(r: Regra) {
    if (!confirm(`Remover a regra "${nomeTurno(r.turno_id)} · ${nomeDia(r.dia_semana)} · ${r.funcao}"?`))
      return;
    setErro(null);
    setAviso(null);
    const { error } = await supabase().from("regras").delete().eq("id", r.id);
    if (error) setErro(`Não foi possível remover. Detalhe: ${error.message}`);
    else carregar();
  }

  function abrirFormulario(r: Regra | null) {
    setFormulario(
      r
        ? {
            id: r.id,
            turno_id: r.turno_id,
            dia_semana: r.dia_semana === null ? "" : String(r.dia_semana),
            funcao: r.funcao,
            minimo: String(r.minimo),
          }
        : { id: null, turno_id: turnos[0]?.id ?? "", dia_semana: "", funcao: "", minimo: "1" },
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Regras da casa</h1>
      <p className="text-neutral-700">
        Estas regras geram os alertas em vermelho na Escala da semana.
      </p>

      {erro && <p className="cartao border-red-300 text-red-700">{erro}</p>}
      {aviso && <p className="cartao border-green-300 text-green-800">{aviso}</p>}

      {formulario && (
        <form onSubmit={salvarRegra} className="cartao space-y-4">
          <h2 className="text-lg font-semibold">
            {formulario.id ? "Editar mínimo" : "Novo mínimo"}
          </h2>
          <label className="block">
            <span className="mb-1 block font-medium">Turno</span>
            <select
              className="campo"
              value={formulario.turno_id}
              onChange={(e) => setFormulario({ ...formulario, turno_id: e.target.value })}
            >
              {turnos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Dia</span>
            <select
              className="campo"
              value={formulario.dia_semana}
              onChange={(e) => setFormulario({ ...formulario, dia_semana: e.target.value })}
            >
              <option value="">Todos os dias</option>
              {/* Segunda a domingo */}
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {DIAS_SEMANA[d]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-sm text-neutral-600">
              Um dia específico substitui &quot;Todos os dias&quot; para o mesmo turno e função.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Função</span>
            <select
              className="campo"
              value={formulario.funcao}
              onChange={(e) => setFormulario({ ...formulario, funcao: e.target.value })}
            >
              <option value="">Escolha a função</option>
              {funcoes.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Mínimo de pessoas</span>
            <input
              className="campo"
              type="number"
              inputMode="numeric"
              min={0}
              value={formulario.minimo}
              onChange={(e) => setFormulario({ ...formulario, minimo: e.target.value })}
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="botao flex-1" type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button
              className="botao-secundario flex-1"
              type="button"
              onClick={() => setFormulario(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {carregando ? (
        <p className="text-neutral-600">Carregando...</p>
      ) : (
        <>
          <section className="cartao space-y-4">
            <h2 className="text-lg font-semibold">Folgas e descanso</h2>
            <label className="block">
              <span className="mb-1 block font-medium">Folgas mínimas por semana</span>
              <input
                className="campo"
                type="number"
                inputMode="numeric"
                min={0}
                max={7}
                value={folgas}
                onChange={(e) => setFolgas(e.target.value)}
              />
              <span className="mt-1 block text-sm text-neutral-600">
                Folga é um dia sem nenhum turno. Use 0 para não verificar.
              </span>
            </label>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2">
              <input
                type="checkbox"
                className="h-6 w-6 shrink-0 accent-principal"
                checked={fecharAbrir}
                onChange={(e) => setFecharAbrir(e.target.checked)}
              />
              <span>
                <span className="block font-medium">Proibir fechar e abrir</span>
                <span className="block text-sm text-neutral-600">
                  Ninguém trabalha no último turno de um dia e no primeiro do dia seguinte.
                </span>
              </span>
            </label>
            <button className="botao w-full" onClick={salvarConfiguracoes}>
              Salvar folgas e descanso
            </button>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Mínimo por turno e função</h2>
              {!formulario && (
                <button className="botao" onClick={() => abrirFormulario(null)}>
                  + Adicionar mínimo
                </button>
              )}
            </div>
            {regrasOrdenadas.length === 0 && (
              <p className="text-neutral-600">Nenhum mínimo cadastrado.</p>
            )}
            {regrasOrdenadas.map((r) => (
              <div key={r.id} className="cartao">
                <p className="text-lg font-semibold">
                  {r.minimo} {r.funcao}
                </p>
                <p className="text-neutral-700">
                  {nomeTurno(r.turno_id)} · {nomeDia(r.dia_semana)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="botao-secundario" onClick={() => abrirFormulario(r)}>
                    Editar
                  </button>
                  <button className="botao-secundario" onClick={() => removerRegra(r)}>
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
