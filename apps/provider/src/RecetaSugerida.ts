// Modelo de una receta inversa sugerida por el buscador.
export type IngredienteReceta = {
  esmalteId: string;
  nombre: string;
  hex: string;
  porcentaje: number;
};

export type RecetaSugerida = {
  ingredientes: IngredienteReceta[];
  hexResultante: string;
  deltaE: number;
  cercania: "Idéntico" | "Muy parecido" | "Aceptable" | "Lejos";
};
