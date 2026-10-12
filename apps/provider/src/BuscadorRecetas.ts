import type { RecetaSugerida } from "./RecetaSugerida.ts";

export type EsmalteInventario = {
  id: string;
  nombre: string;
  hex: string;
  ml: number;
};

export type LabColor = { L: number; a: number; b: number };

export type MotorMezcla = {
  // Estas funciones se inyectan desde el motor que ya usa el mezclador.
  mezclar: (items: Array<{ hex: string; porcentaje: number }>) => string;
  hexToLab: (hex: string) => LabColor;
  deltaE2000: (a: LabColor, b: LabColor) => number;
};

const normalizarHex = (hex: string) => {
  const limpio = hex.trim().replace(/^#/, "");
  const completo = limpio.length === 3 ? limpio.split("").map(c => c + c).join("") : limpio;
  return /^[0-9a-fA-F]{6}$/.test(completo) ? "#" + completo.toUpperCase() : null;
};

const cercaniaDe = (deltaE: number): RecetaSugerida["cercania"] => {
  if (deltaE < 2) return "Idéntico";
  if (deltaE < 5) return "Muy parecido";
  if (deltaE < 10) return "Aceptable";
  return "Lejos";
};

const cederTurno = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Crea el buscador con el motor existente. La función devuelta conserva la
 * firma buscarRecetas(objetivoHex, inventario, maxComponentes = 3).
 * Se cede el turno periódicamente para que la interfaz móvil siga respondiendo.
 */
export function crearBuscadorRecetas(motor: MotorMezcla) {
  return async function buscarRecetas(
    objetivoHex: string,
    inventario: EsmalteInventario[],
    maxComponentes = 3
  ): Promise<RecetaSugerida[]> {
    const objetivoNormalizado = normalizarHex(objetivoHex);
    if (!objetivoNormalizado) throw new Error("El color objetivo debe ser un HEX válido, por ejemplo #F07835.");

    const disponibles = inventario.filter(e => Number.isFinite(e.ml) && e.ml > 0 && normalizarHex(e.hex) !== null);
    if (!disponibles.length) return [];

    const objetivoLab = motor.hexToLab(objetivoNormalizado);

    // Caso especial necesario: si el objetivo ya existe en el inventario,
    // la receta exacta es ese esmalte al 100 %.
    const exacto = disponibles.find(e => normalizarHex(e.hex) === objetivoNormalizado);
    if (exacto) {
      return [{
        ingredientes: [{ esmalteId: exacto.id, nombre: exacto.nombre, hex: normalizarHex(exacto.hex)!, porcentaje: 100 }],
        hexResultante: normalizarHex(exacto.hex)!,
        deltaE: motor.deltaE2000(motor.hexToLab(exacto.hex), objetivoLab),
        cercania: "Idéntico"
      }];
    }
    if (disponibles.length < 2) return [];

    // Prefiltro obligatorio: únicamente los 15 esmaltes más cercanos en CIELAB.
    const cercanos = disponibles
      .map(esmalte => ({ esmalte, distancia: motor.deltaE2000(motor.hexToLab(esmalte.hex), objetivoLab) }))
      .sort((a, b) => a.distancia - b.distancia)
      .slice(0, 15)
      .map(item => item.esmalte);

    const maximo = Math.min(3, Math.max(2, Math.floor(maxComponentes) || 3));
    const resultados: RecetaSugerida[] = [];
    let evaluadas = 0;

    const evaluar = (elegidos: EsmalteInventario[], porcentajes: number[]) => {
      // La mezcla SIEMPRE la calcula el motor ya existente de la Pantalla 1.
      const hexResultante = motor.mezclar(elegidos.map((e, i) => ({ hex: e.hex, porcentaje: porcentajes[i] })));
      const deltaE = motor.deltaE2000(motor.hexToLab(hexResultante), objetivoLab);
      resultados.push({
        ingredientes: elegidos.map((e, i) => ({
          esmalteId: e.id,
          nombre: e.nombre,
          hex: normalizarHex(e.hex)!,
          porcentaje: porcentajes[i]
        })),
        hexResultante,
        deltaE,
        cercania: cercaniaDe(deltaE)
      });
      evaluadas++;
    };

    const generarPorcentajes = (componentes: number): number[][] => {
      const filas: number[][] = [];
      const recorrer = (restante: number, prefijo: number[]) => {
        if (prefijo.length === componentes - 1) {
          if (restante >= 10 && restante <= 90 && restante % 10 === 0) filas.push([...prefijo, restante]);
          return;
        }
        const minimoRestante = 10 * (componentes - prefijo.length - 1);
        for (let valor = 10; valor <= restante - minimoRestante; valor += 10) {
          recorrer(restante - valor, [...prefijo, valor]);
        }
      };
      recorrer(100, []);
      return filas;
    };

    const porcentajesPorCantidad = new Map<number, number[][]>();
    for (let cantidad = 2; cantidad <= maximo; cantidad++) {
      porcentajesPorCantidad.set(cantidad, generarPorcentajes(cantidad));
    }

    const elegir = async (inicio: number, elegidos: EsmalteInventario[], cantidad: number): Promise<void> => {
      if (elegidos.length === cantidad) {
        for (const porcentajes of porcentajesPorCantidad.get(cantidad) ?? []) {
          evaluar(elegidos, porcentajes);
          if (evaluadas % 400 === 0) await cederTurno();
        }
        return;
      }
      const faltan = cantidad - elegidos.length;
      for (let i = inicio; i <= cercanos.length - faltan; i++) {
        await elegir(i + 1, [...elegidos, cercanos[i]], cantidad);
      }
    };

    for (let cantidad = 2; cantidad <= maximo; cantidad++) {
      await elegir(0, [], cantidad);
    }

    resultados.sort((a, b) => a.deltaE - b.deltaE);
    // Evita repetir una misma fórmula si llega a producirse una duplicación de inventario.
    const unicos: RecetaSugerida[] = [];
    const vistos = new Set<string>();
    for (const receta of resultados) {
      const clave = receta.ingredientes.map(i => i.esmalteId + ":" + i.porcentaje).join("|");
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      unicos.push(receta);
      if (unicos.length === 3) break;
    }
    return unicos;
  };
}
