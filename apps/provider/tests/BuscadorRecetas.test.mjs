import test from "node:test";
import assert from "node:assert/strict";
import { crearBuscadorRecetas } from "../src/BuscadorRecetas.ts";

// Motor pequeño de prueba. En producción el buscador recibe las funciones reales
// de ColorMixer.tsx; este motor solo hace deterministas las pruebas del algoritmo.
const motorPrueba = {
  mezclar: (items) => {
    const total = items.reduce((s, x) => s + x.porcentaje, 0);
    const rgb = [0, 1, 2].map(index => Math.round(items.reduce((s, item) => {
      const hex = item.hex.replace("#", "");
      return s + parseInt(hex.slice(index * 2, index * 2 + 2), 16) * item.porcentaje / total;
    }, 0)));
    return "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  },
  hexToLab: (hex) => {
    const value = hex.replace("#", "");
    return { L: parseInt(value.slice(0, 2), 16), a: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
  },
  deltaE2000: (a, b) => Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
};

const inventario = [
  { id: "rojo", nombre: "Rojo", hex: "#D02030", ml: 8 },
  { id: "amarillo", nombre: "Amarillo", hex: "#F0D030", ml: 6 },
  { id: "azul", nombre: "Azul", hex: "#2030D0", ml: 10 },
  { id: "verde", nombre: "Verde", hex: "#309050", ml: 4 },
  { id: "rosa", nombre: "Rosa", hex: "#D070A0", ml: 3 },
  { id: "blanco", nombre: "Blanco", hex: "#F5F0E8", ml: 0 }
];

test("un objetivo idéntico a un esmalte devuelve ese esmalte al 100 %", async () => {
  const buscar = crearBuscadorRecetas(motorPrueba);
  const recetas = await buscar("#309050", inventario, 3);
  assert.equal(recetas.length, 1);
  assert.equal(recetas[0].ingredientes.length, 1);
  assert.equal(recetas[0].ingredientes[0].esmalteId, "verde");
  assert.equal(recetas[0].ingredientes[0].porcentaje, 100);
  assert.ok(Math.abs(recetas[0].deltaE) < 1e-9);
});

test("un objetivo difícil devuelve hasta tres recetas ordenadas sin crashear", async () => {
  const buscar = crearBuscadorRecetas(motorPrueba);
  const recetas = await buscar("#07F9EE", inventario, 3);
  assert.equal(recetas.length, 3);
  assert.ok(recetas.every((receta, i) => i === 0 || recetas[i - 1].deltaE <= receta.deltaE));
  assert.ok(recetas.every(receta => receta.ingredientes.length === 2 || receta.ingredientes.length === 3));
});

test("no se sugieren esmaltes sin stock", async () => {
  const buscar = crearBuscadorRecetas(motorPrueba);
  const recetas = await buscar("#F5F0E8", inventario, 3);
  assert.ok(recetas.length > 0);
  assert.ok(recetas.every(receta => receta.ingredientes.every(ingrediente => ingrediente.esmalteId !== "blanco")));
});


test("las recetas se calculan en gotas enteras para el tamaño seleccionado", async () => {
  const buscar = crearBuscadorRecetas(motorPrueba);
  for (const total of [4, 7, 12, 20]) {
    const recetas = await buscar("#07F9EE", inventario, 3, total);
    assert.ok(recetas.length > 0);
    for (const receta of recetas) {
      assert.ok(Math.abs(receta.ingredientes.reduce((s, i) => s + i.porcentaje, 0) - 100) < 1e-9);
      const gotas = receta.ingredientes.map(i => Math.round(i.porcentaje * total / 100));
      assert.ok(gotas.every(g => g >= 1), `total ${total}: ${gotas}`);
      assert.equal(gotas.reduce((s, g) => s + g, 0), total);
    }
  }
});

test("con 4 gotas, cada ingrediente sugerido representa al menos una gota", async () => {
  const buscar = crearBuscadorRecetas(motorPrueba);
  const recetas = await buscar("#07F9EE", inventario, 3, 4);
  assert.ok(recetas.every(r => r.ingredientes.every(i => i.porcentaje >= 25)));
});
