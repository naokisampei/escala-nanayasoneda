"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, variaveisConfiguradas } from "@/lib/supabase";
import type { Configuracao, Escala, Funcionario, Regra, Turno } from "@/lib/tipos";
import { lerConfiguracoes, verificarSemana, type Alerta } from "@/lib/regras";
import {
  DIAS_SEMANA,
  diaMes,
  diasDaSemana,
  hojeISO,
  horaCurta,
  inicioDaSemana,
  paraData,
  rotuloDia,
  somarDias,
} from "@/lib/datas";

type CelulaAberta = { data: string; turno: Turno };

export default function EscalaDaSemana() {
  const [segunda, setSegunda] = useState(() => inicioDaSemana(hojeISO()));
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [configuracoes, setConfiguracoes] = useState<Configuracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [celula, setCelula] = useState<CelulaAberta | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const dias = diasDaSemana(segunda);
  const domingo = dias[6];
  const hoje = hojeISO();

  // Turnos e funcionários: carregados uma vez.
  useEffect(() => {
    async function carregarBase() {
      if (!variaveisConfiguradas()) {
        setErro("As variáveis do Supabase não foram configuradas.");
        return;
      }
      const db = supabase();
      const [t, f, r, c] = await Promise.all([
        db.from("turnos").select("id, nome, hora_inicio, hora_fim, ordem").order("ordem"),
        db.from("funcionarios").select("id, nome, funcao, telefone, cpf, ativo").order("nome"),
        db.from("regras").select("id, dia_semana, turno_id, funcao, minimo"),
        db.from("configuracoes").select("chave, valor"),
      ]);
      const falha = t.error ?? f.error ?? r.error ?? c.error;
      if (falha) {
        setErro(`Não foi possível carregar os dados. Detalhe: ${falha.message}`);
        return;
      }
      setTurnos(t.data ?? []);
      setFuncionarios(f.data ?? []);
      setRegras(r.data ?? []);
      setConfiguracoes(c.data ?? []);
    }
    carregarBase();
  }, []);

  // Escala da semana: recarregada a cada troca de semana.
  // Inclui o domingo anterior e a segunda seguinte (regra de fechar e abrir).
  const carregarEscalas = useCallback(async () => {
    if (!variaveisConfiguradas()) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    const { data, error } = await supabase()
      .from("escalas")
      .select("id, data, turno_id, funcionario_id")
      .gte("data", somarDias(segunda, -1))
      .lte("data", somarDias(segunda, 7));
    if (error) setErro(`Não foi possível carregar a escala. Detalhe: ${error.message}`);
    else setEscalas(data ?? []);
    setCarregando(false);
  }, [segunda]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarEscalas();
  }, [carregarEscalas]);

  function escaladosEm(data: string, turnoId: string): Escala[] {
    return escalas.filter((e) => e.data === data && e.turno_id === turnoId);
  }

  const alertas = verificarSemana({
    segunda,
    turnos,
    funcionarios,
    escalas,
    regras,
    configuracoes: lerConfiguracoes(configuracoes),
  });

  function alertasDaCelula(data: string, turnoId: string): Alerta[] {
    return alertas.filter((a) => a.celulas.some((c) => c.data === data && c.turno_id === turnoId));
  }

  function nomeEmAlerta(data: string, turnoId: string, funcionarioId: string): boolean {
    return alertas.some((a) =>
      a.marcas.some(
        (m) => m.data === data && m.turno_id === turnoId && m.funcionario_id === funcionarioId,
      ),
    );
  }

  /** Alertas que envolvem a célula: vermelhos na célula ou no nome de alguém dela. */
  function alertasEnvolvendo(data: string, turnoId: string): Alerta[] {
    return alertas.filter(
      (a) =>
        a.celulas.some((c) => c.data === data && c.turno_id === turnoId) ||
        a.marcas.some((m) => m.data === data && m.turno_id === turnoId),
    );
  }

  function nomeDe(id: string): string {
    return funcionarios.find((f) => f.id === id)?.nome ?? "?";
  }

  async function alternar(data: string, turnoId: string, funcionarioId: string) {
    setErro(null);
    setSalvandoId(funcionarioId);
    const existente = escalas.find(
      (e) => e.data === data && e.turno_id === turnoId && e.funcionario_id === funcionarioId,
    );
    const db = supabase().from("escalas");
    if (existente) {
      const { error } = await db.delete().eq("id", existente.id);
      if (error) setErro(`Não foi possível remover. Detalhe: ${error.message}`);
      else setEscalas((atual) => atual.filter((e) => e.id !== existente.id));
    } else {
      const { data: nova, error } = await db
        .insert({ data, turno_id: turnoId, funcionario_id: funcionarioId })
        .select("id, data, turno_id, funcionario_id")
        .single();
      if (error) setErro(`Não foi possível salvar. Detalhe: ${error.message}`);
      else if (nova) setEscalas((atual) => [...atual, nova]);
    }
    setSalvandoId(null);
  }

  // Na janela de escolha: ativos + quem já está escalado (mesmo se desativado depois).
  const opcoesCelula = celula
    ? funcionarios.filter(
        (f) =>
          f.ativo ||
          escaladosEm(celula.data, celula.turno.id).some((e) => e.funcionario_id === f.id),
      )
    : [];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Escala da semana</h1>

      <div className="cartao space-y-3">
        <p className="text-center text-lg font-semibold">
          {diaMes(segunda)} a {diaMes(domingo)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="botao-secundario" onClick={() => setSegunda(somarDias(segunda, -7))}>
            ← Semana anterior
          </button>
          <button className="botao-secundario" onClick={() => setSegunda(somarDias(segunda, 7))}>
            Próxima semana →
          </button>
        </div>
        {segunda !== inicioDaSemana(hoje) && (
          <button className="botao w-full" onClick={() => setSegunda(inicioDaSemana(hoje))}>
            Voltar para esta semana
          </button>
        )}
      </div>

      {erro && <p className="cartao border-red-300 text-red-700">{erro}</p>}

      {!carregando && !erro && (
        <div
          className={`cartao ${alertas.length > 0 ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50"}`}
        >
          {alertas.length === 0 ? (
            <p className="font-semibold text-green-800">✓ Nenhum alerta nesta semana</p>
          ) : (
            <>
              <p className="font-semibold text-red-800">
                ⚠ {alertas.length} {alertas.length === 1 ? "alerta" : "alertas"} nesta semana
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
                {alertas.map((a, i) => (
                  <li key={i}>{a.completo}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p className="text-sm text-neutral-600">
        Toque em uma célula para escolher quem trabalha. Arraste a grade para os lados para ver
        todos os dias.
      </p>

      <div className="cartao overflow-x-auto p-0">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] w-24 border-b bg-white p-2 text-left">Turno</th>
              {dias.map((d) => (
                <th
                  key={d}
                  className={`border-b p-2 text-center ${d === hoje ? "bg-secundaria" : ""}`}
                >
                  {rotuloDia(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {turnos.map((t) => (
              <tr key={t.id}>
                <th className="sticky left-0 z-[1] border-b bg-white p-2 text-left align-top">
                  <span className="block font-semibold">{t.nome}</span>
                  <span className="block text-xs font-normal text-neutral-600">
                    {horaCurta(t.hora_inicio)}–{horaCurta(t.hora_fim)}
                  </span>
                </th>
                {dias.map((d) => {
                  const lista = escaladosEm(d, t.id);
                  const daCelula = alertasDaCelula(d, t.id);
                  const comAlerta = daCelula.length > 0;
                  return (
                    <td
                      key={d}
                      className={`border-b border-l p-1 align-top ${comAlerta ? "bg-red-50" : ""}`}
                    >
                      <button
                        className={`flex min-h-24 w-full flex-col items-start gap-1 rounded-lg p-2 text-left disabled:opacity-50 ${
                          comAlerta
                            ? "border-2 border-red-500 active:bg-red-100"
                            : "active:bg-neutral-100"
                        }`}
                        onClick={() => setCelula({ data: d, turno: t })}
                        disabled={carregando}
                      >
                        {lista.length === 0 ? (
                          <span className="text-neutral-400">+ Escolher</span>
                        ) : (
                          lista
                            .map((e) => ({ id: e.funcionario_id, nome: nomeDe(e.funcionario_id) }))
                            .sort((a, b) => a.nome.localeCompare(b.nome))
                            .map(({ id, nome }) => {
                              const vermelho = nomeEmAlerta(d, t.id, id);
                              return (
                                <span
                                  key={id}
                                  className={`w-full rounded-md px-2 py-1 font-medium ${
                                    vermelho ? "bg-red-100 text-red-800" : "bg-secundaria"
                                  }`}
                                >
                                  {vermelho && "⚠ "}
                                  {nome}
                                </span>
                              );
                            })
                        )}
                        {daCelula
                          .filter((a) => a.tipo === "minimo")
                          .map((a, i) => (
                            <span key={i} className="text-xs font-semibold text-red-700">
                              {a.curto}
                            </span>
                          ))}
                        {daCelula.some((a) => a.tipo === "fechar-abrir") && (
                          <span className="text-xs font-semibold text-red-700">Fecha e abre</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!carregando && turnos.length === 0 && !erro && (
          <p className="p-4 text-neutral-600">Nenhum turno cadastrado.</p>
        )}
      </div>

      {celula && (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setCelula(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">
              {celula.turno.nome} · {DIAS_SEMANA[paraData(celula.data).getDay()]}{" "}
              {diaMes(celula.data)}
            </h2>
            <p className="mb-3 text-sm text-neutral-600">Marque quem trabalha. Salva na hora.</p>
            {alertasEnvolvendo(celula.data, celula.turno.id).length > 0 && (
              <ul className="mb-3 space-y-1 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {alertasEnvolvendo(celula.data, celula.turno.id).map((a, i) => (
                  <li key={i}>⚠ {a.completo}</li>
                ))}
              </ul>
            )}
            <div className="flex-1 space-y-2 overflow-y-auto">
              {opcoesCelula.map((f) => {
                const marcado = escaladosEm(celula.data, celula.turno.id).some(
                  (e) => e.funcionario_id === f.id,
                );
                return (
                  <label
                    key={f.id}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${
                      marcado ? "border-principal bg-secundaria" : "border-neutral-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-6 w-6 shrink-0 accent-principal"
                      checked={marcado}
                      disabled={salvandoId !== null}
                      onChange={() => alternar(celula.data, celula.turno.id, f.id)}
                    />
                    <span className="flex-1">
                      <span className="block font-semibold">{f.nome}</span>
                      <span className="block text-sm text-neutral-600">
                        {f.funcao}
                        {!f.ativo && " · desativado"}
                      </span>
                    </span>
                    {salvandoId === f.id && (
                      <span className="text-sm text-neutral-500">Salvando...</span>
                    )}
                  </label>
                );
              })}
              {opcoesCelula.length === 0 && (
                <p className="text-neutral-600">Nenhum funcionário ativo. Cadastre na Equipe.</p>
              )}
            </div>
            <button className="botao mt-4 w-full" onClick={() => setCelula(null)}>
              Pronto
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
