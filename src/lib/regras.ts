// Verificação das regras da casa sobre a escala de uma semana.
// As regras vêm do banco (tabelas `regras` e `configuracoes`) e podem ser
// alteradas na tela "Regras da casa". Aqui só há a lógica, sem acesso ao banco.

import type { Configuracao, Escala, Funcionario, Regra, Turno } from "./tipos";
import { DIAS_SEMANA_CURTO, diasDaSemana, paraData, somarDias } from "./datas";

export type TipoAlerta = "minimo" | "folga" | "fechar-abrir";

export type Alerta = {
  tipo: TipoAlerta;
  /** Aviso curto mostrado dentro da célula, ex.: "Falta 1 Salão" */
  curto: string;
  /** Frase completa para o resumo, ex.: "Sex · Jantar: falta 1 Salão" */
  completo: string;
  /** Células (data + turno) que ficam vermelhas */
  celulas: { data: string; turno_id: string }[];
  /** Escalações cujo nome fica em vermelho */
  marcas: { data: string; turno_id: string; funcionario_id: string }[];
};

export type ConfiguracoesRegras = {
  folgasMinimasSemana: number;
  bloquearFecharEAbrir: boolean;
};

export const CHAVE_FOLGAS = "folgas_minimas_semana";
export const CHAVE_FECHAR_ABRIR = "bloquear_fechar_e_abrir";

/** Lê as configurações em texto do banco, com valores padrão seguros. */
export function lerConfiguracoes(lista: Configuracao[]): ConfiguracoesRegras {
  const valor = (chave: string) => lista.find((c) => c.chave === chave)?.valor;
  const folgas = Number(valor(CHAVE_FOLGAS) ?? "0");
  return {
    folgasMinimasSemana: Number.isFinite(folgas) && folgas > 0 ? folgas : 0,
    bloquearFecharEAbrir: valor(CHAVE_FECHAR_ABRIR) === "true",
  };
}

/**
 * Mínimos que valem para um turno num dia da semana, por função.
 * Uma regra de dia específico substitui a regra geral (todos os dias)
 * do mesmo turno e da mesma função.
 */
export function minimosDoDia(
  regras: Regra[],
  turnoId: string,
  diaSemana: number,
): Map<string, number> {
  const resultado = new Map<string, number>();
  for (const r of regras) {
    if (r.turno_id === turnoId && r.dia_semana === null) resultado.set(r.funcao, r.minimo);
  }
  for (const r of regras) {
    if (r.turno_id === turnoId && r.dia_semana === diaSemana) resultado.set(r.funcao, r.minimo);
  }
  return resultado;
}

/**
 * Verifica a semana que começa em `segunda`.
 * `escalas` pode incluir o domingo anterior e a segunda seguinte,
 * para a regra de fechar e abrir na virada da semana.
 */
export function verificarSemana(params: {
  segunda: string;
  turnos: Turno[];
  funcionarios: Funcionario[];
  escalas: Escala[];
  regras: Regra[];
  configuracoes: ConfiguracoesRegras;
}): Alerta[] {
  const { segunda, turnos, funcionarios, escalas, regras, configuracoes } = params;
  const dias = diasDaSemana(segunda);
  const naSemana = new Set(dias);
  const alertas: Alerta[] = [];
  const porId = new Map(funcionarios.map((f) => [f.id, f]));
  const turnosOrdenados = [...turnos].sort((a, b) => a.ordem - b.ordem);
  const rotulo = (data: string) => DIAS_SEMANA_CURTO[paraData(data).getDay()];

  // 1. Mínimo de pessoas por turno e função
  for (const data of dias) {
    for (const turno of turnosOrdenados) {
      const minimos = minimosDoDia(regras, turno.id, paraData(data).getDay());
      const escalados = escalas.filter((e) => e.data === data && e.turno_id === turno.id);
      for (const [funcao, minimo] of minimos) {
        const quantos = escalados.filter((e) => porId.get(e.funcionario_id)?.funcao === funcao).length;
        if (quantos < minimo) {
          const falta = minimo - quantos;
          alertas.push({
            tipo: "minimo",
            curto: `Falta ${falta} ${funcao}`,
            completo: `${rotulo(data)} · ${turno.nome}: falta ${falta} ${funcao} (mínimo ${minimo})`,
            celulas: [{ data, turno_id: turno.id }],
            marcas: [],
          });
        }
      }
    }
  }

  // 2. Folgas mínimas na semana (folga = dia sem nenhum turno)
  if (configuracoes.folgasMinimasSemana > 0) {
    const daSemana = escalas.filter((e) => naSemana.has(e.data));
    const ids = new Set(daSemana.map((e) => e.funcionario_id));
    for (const id of ids) {
      const minhas = daSemana.filter((e) => e.funcionario_id === id);
      const diasTrabalhados = new Set(minhas.map((e) => e.data)).size;
      const folgas = 7 - diasTrabalhados;
      if (folgas < configuracoes.folgasMinimasSemana) {
        const nome = porId.get(id)?.nome ?? "Funcionário";
        alertas.push({
          tipo: "folga",
          curto: "Sem folga",
          completo:
            folgas === 0
              ? `${nome}: sem folga na semana`
              : `${nome}: só ${folgas} folga(s) na semana (mínimo ${configuracoes.folgasMinimasSemana})`,
          celulas: [],
          marcas: minhas.map((e) => ({ data: e.data, turno_id: e.turno_id, funcionario_id: id })),
        });
      }
    }
  }

  // 3. Fechar um dia (último turno) e abrir o seguinte (primeiro turno)
  if (configuracoes.bloquearFecharEAbrir && turnosOrdenados.length >= 2) {
    const fechar = turnosOrdenados[turnosOrdenados.length - 1];
    const abrir = turnosOrdenados[0];
    // Do domingo anterior até o domingo da semana
    for (let i = -1; i < 7; i++) {
      const dia = somarDias(segunda, i);
      const seguinte = somarDias(dia, 1);
      if (!naSemana.has(dia) && !naSemana.has(seguinte)) continue;
      const fecham = escalas.filter((e) => e.data === dia && e.turno_id === fechar.id);
      for (const e of fecham) {
        const abre = escalas.some(
          (x) => x.data === seguinte && x.turno_id === abrir.id && x.funcionario_id === e.funcionario_id,
        );
        if (!abre) continue;
        const nome = porId.get(e.funcionario_id)?.nome ?? "Funcionário";
        const celulas = [
          { data: dia, turno_id: fechar.id },
          { data: seguinte, turno_id: abrir.id },
        ];
        alertas.push({
          tipo: "fechar-abrir",
          curto: "Fecha e abre",
          completo: `${nome}: fecha ${rotulo(dia)} (${fechar.nome}) e abre ${rotulo(seguinte)} (${abrir.nome})`,
          celulas: celulas.filter((c) => naSemana.has(c.data)),
          marcas: celulas.map((c) => ({ ...c, funcionario_id: e.funcionario_id })),
        });
      }
    }
  }

  return alertas;
}
