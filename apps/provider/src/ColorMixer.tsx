import { useMemo, useState } from "react";
import { crearBuscadorRecetas } from "./BuscadorRecetas";
import ColorCapture from "./ColorCapture";

type Esmalte = { id: string; nombre: string; hex: string; ml: number };
type Ingrediente = { esmalteId: string; nombre: string; hex: string; porcentaje: number; ml: number };
type Receta = { id: string; nombre: string; hex: string; deltaE: number; objetivoHex?: string | null; totalGotas?: number; ingredientes: Ingrediente[]; creada: string };
type Lab = { L: number; a: number; b: number };
type Rgb = { r: number; g: number; b: number };

const COLOR_PALETTE = [
  { nombre: "Rojo", hex: "#C83E4D" },
  { nombre: "Naranja", hex: "#F07835" },
  { nombre: "Amarillo", hex: "#F2C94C" },
  { nombre: "Verde", hex: "#3C8D56" },
  { nombre: "Turquesa", hex: "#36A6A0" },
  { nombre: "Azul", hex: "#356AC3" },
  { nombre: "Violeta", hex: "#8055A5" },
  { nombre: "Morado", hex: "#6B3FA0" },
  { nombre: "Rosa", hex: "#D8799B" },
  { nombre: "Fucsia", hex: "#C43B82" },
  { nombre: "Marrón", hex: "#8B5E3C" },
  { nombre: "Blanco", hex: "#F4F0E8" }
] as const;

const INVENTORY_KEY = "luni.colorMixer.inventory.v1";
const RECIPES_KEY = "luni.colorMixer.recipes.v1";
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
// Solo transforma el texto presentado en pantalla; no modifica los datos guardados.
const capitalizar = (nombre: string): string => nombre.length ? nombre.charAt(0).toLocaleUpperCase("es") + nombre.slice(1) : nombre;
const toHex = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0").toUpperCase();
function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "").trim();
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}
const rgbHex = (c: Rgb) => "#" + toHex(c.r) + toHex(c.g) + toHex(c.b);
function rgbToRyb(input: Rgb) {
  let { r, g, b } = { r: input.r / 255, g: input.g / 255, b: input.b / 255 };
  const white = Math.min(r, g, b); r -= white; g -= white; b -= white;
  const maxG = Math.max(r, g, b);
  let y = Math.min(r, g); r -= y; g -= y;
  if (b > 0 && g > 0) { b *= 0.5; g *= 0.5; }
  y += g; b += g;
  const maxY = Math.max(r, y, b);
  if (maxY > 0) { const n = maxG / maxY; r *= n; y *= n; b *= n; }
  r += white; y += white; b += white;
  return { r: clamp(r), y: clamp(y), b: clamp(b) };
}
function rybToRgb(input: { r: number; y: number; b: number }): Rgb {
  let { r, y, b } = input;
  const white = Math.min(r, y, b); r -= white; y -= white; b -= white;
  const maxY = Math.max(r, y, b);
  let g = Math.min(y, b); y -= g; b -= g;
  if (b > 0 && g > 0) { b *= 2; g *= 2; }
  r += y; g += y;
  const maxG = Math.max(r, g, b);
  if (maxG > 0) { const n = maxY / maxG; r *= n; g *= n; b *= n; }
  r += white; g += white; b += white;
  return { r: clamp(r) * 255, g: clamp(g) * 255, b: clamp(b) * 255 };
}
function mixColors(items: Array<{ hex: string; porcentaje: number }>): string {
  const total = items.reduce((s, x) => s + x.porcentaje, 0) || 1;
  const rybs = items.map(x => ({ c: rgbToRyb(parseHex(x.hex)), w: x.porcentaje / total }));
  const mixed = rybs.reduce((acc, item) => ({
    r: acc.r + item.c.r * item.w, y: acc.y + item.c.y * item.w, b: acc.b + item.c.b * item.w
  }), { r: 0, y: 0, b: 0 });
  // Un esmalte al 100 % debe conservar exactamente su código de color.
  if (items.length === 1) return items[0].hex.toUpperCase();
  return rgbHex(rybToRgb(mixed));
}
function hexToLab(hex: string): Lab {
  const c = parseHex(hex);
  const linear = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = linear(c.r), g = linear(c.g), b = linear(c.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = (v: number) => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function deltaE2000(lab1: Lab, lab2: Lab): number {
  const rad = Math.PI / 180, deg = (v: number) => v / rad;
  const C1 = Math.hypot(lab1.a, lab1.b), C2 = Math.hypot(lab2.a, lab2.b), Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * lab1.a, a2p = (1 + G) * lab2.a;
  const C1p = Math.hypot(a1p, lab1.b), C2p = Math.hypot(a2p, lab2.b);
  const hp = (a: number, b: number) => { const h = deg(Math.atan2(b, a)); return (h + 360) % 360; };
  const h1p = C1p < 1e-7 ? 0 : hp(a1p, lab1.b), h2p = C2p < 1e-7 ? 0 : hp(a2p, lab2.b);
  const dLp = lab2.L - lab1.L, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p >= 1e-7) { const d = h2p - h1p; dhp = Math.abs(d) <= 180 ? d : d > 180 ? d - 360 : d + 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lbar = (lab1.L + lab2.L) / 2, Cpbar = (C1p + C2p) / 2;
  let hbar = h1p + h2p;
  if (C1p * C2p < 1e-7) hbar = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbar /= 2;
  else hbar = (hbar + (hbar < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad) + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.20 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbar - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpbar, 7) / (Math.pow(Cpbar, 7) + Math.pow(25, 7)));
  const Sl = 1 + 0.015 * Math.pow(Lbar - 50, 2) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
  const Sc = 1 + 0.045 * Cpbar, Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}
function readStore<T>(key: string): T[] {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function NailPreview({ hex }: { hex: string }) {
  return <svg viewBox="0 0 150 180" role="img" aria-label={`Vista previa de uña ${hex}`} style={{ width: 110, maxWidth: "100%", display: "block", margin: "0 auto" }}>
    <defs><linearGradient id="nailGloss" x1="0" x2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".25"/><stop offset=".4" stopColor="#ffffff" stopOpacity="0"/><stop offset="1" stopColor="#ffffff" stopOpacity=".18"/></linearGradient></defs>
    <path d="M48 165 C37 150 27 126 28 91 C29 58 38 19 75 12 C112 19 121 58 122 91 C123 126 113 150 102 165 C89 177 61 177 48 165Z" fill="#f5d8ca" stroke="#d9b8a9" strokeWidth="2"/>
    <path d="M43 156 C34 139 35 113 36 86 C38 52 47 26 75 21 C103 26 112 52 114 86 C115 113 116 139 107 156 C94 171 56 171 43 156Z" fill={hex} stroke="#ffffff" strokeOpacity=".65" strokeWidth="2"/>
    <path d="M43 58 C48 36 58 27 69 25 C57 49 53 78 53 108 C53 126 55 143 61 160 C48 153 42 137 41 116 C39 93 39 74 43 58Z" fill="url(#nailGloss)"/>
  </svg>;
}

export default function ColorMixer() {
  const [inventory, setInventory] = useState<Esmalte[]>(() => readStore<Esmalte>(INVENTORY_KEY));
  const [recipes, setRecipes] = useState<Receta[]>(() => readStore<Receta>(RECIPES_KEY));
  const [target, setTarget] = useState("#3C8D56");
  const [targetHexInput, setTargetHexInput] = useState("#3C8D56");
  const [name, setName] = useState("");
  const [newHex, setNewHex] = useState("#D8799B");
  const [ml, setMl] = useState("10");
  const [tab, setTab] = useState<"mezclar" | "buscar" | "inventario" | "recetas" | "capturar">("mezclar");
  const [result, setResult] = useState<Array<{ hex: string; deltaE: number; ingredientes: Ingrediente[] }>>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [recipeName, setRecipeName] = useState("Mi mezcla");
  const [manual, setManual] = useState<Array<{ id: string; porcentaje: number }>>([]);
  const [showAddPolish, setShowAddPolish] = useState(false);
  const [volumenGotas, setVolumenGotas] = useState<"4" | "12" | "20" | "custom">("12");
  const [gotasPersonalizadas, setGotasPersonalizadas] = useState("12");
  const [recetaEditandoGotas, setRecetaEditandoGotas] = useState<string | null>(null);
  const [tamanoReceta, setTamanoReceta] = useState<"4" | "12" | "20" | "custom">("12");
  const [gotasRecetaPersonalizadas, setGotasRecetaPersonalizadas] = useState("12");
  // Solo se establece al cargar una receta desde el buscador inverso. Las mezclas libres conservan null.
  const [manualObjetivoHex, setManualObjetivoHex] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoPoint, setPhotoPoint] = useState({ x: 0.5, y: 0.5 });
  const [photoDisplayPoint, setPhotoDisplayPoint] = useState({ x: 0.5, y: 0.5 });
  const [sampleSize, setSampleSize] = useState(18);
  const [photoSample, setPhotoSample] = useState<{ hex: string; confidence: string; pixels: number } | null>(null);

  const active = useMemo(() => inventory.filter(e => e.ml > 0), [inventory]);
  const persistInventory = (next: Esmalte[]) => { setInventory(next); localStorage.setItem(INVENTORY_KEY, JSON.stringify(next)); };
  const persistRecipes = (next: Receta[]) => { setRecipes(next); localStorage.setItem(RECIPES_KEY, JSON.stringify(next)); };
  const manualItems = manual.map(item => ({ esmalte: inventory.find(e => e.id === item.id), porcentaje: item.porcentaje })).filter((x): x is { esmalte: Esmalte; porcentaje: number } => Boolean(x.esmalte));
  const activeInMix = manualItems.filter(item => item.porcentaje > 0);
  const availableToAdd = active.filter(esmalte => !manual.some(item => item.id === esmalte.id));
  const manualHex = manualItems.length ? mixColors(manualItems.map(x => ({ hex: x.esmalte.hex, porcentaje: x.porcentaje }))) : target;
  const totalManual = manualItems.reduce((s, x) => s + x.porcentaje, 0);
  const totalGotas = volumenGotas === "custom" ? Math.max(1, Math.min(10000, Math.floor(Number(gotasPersonalizadas) || 1))) : Number(volumenGotas);
  const gotasPorEsmalte = useMemo(() => {
    if (!activeInMix.length) return [] as Array<{ id: string; cantidad: number; exacta: number }>;
    const exactas = activeInMix.map(item => ({ id: item.esmalte.id, exacta: item.porcentaje / 100 * totalGotas }));
    const cantidades = exactas.map(item => Math.round(item.exacta));
    cantidades[cantidades.length - 1] += totalGotas - cantidades.reduce((sum, amount) => sum + amount, 0);
    return exactas.map((item, index) => ({ id: item.id, exacta: item.exacta, cantidad: cantidades[index] }));
  }, [activeInMix, totalGotas]);
  const gotasPorId = (id: string) => gotasPorEsmalte.find(item => item.id === id);
  // Calcula cantidades de presentación sin alterar los porcentajes originales.
  const calcularGotas = (ingredientes: Ingrediente[], total: number) => {
    if (!ingredientes.length || total < 1) return [] as Array<{ esmalteId: string; cantidad: number }>;
    const cantidades = ingredientes.map(x => Math.round(x.porcentaje * total / 100));
    const diff = total - cantidades.reduce((sum, amount) => sum + amount, 0);
    if (diff !== 0) {
      const idx = ingredientes.reduce((best, item, index, all) => item.porcentaje > all[best].porcentaje ? index : best, 0);
      cantidades[idx] = Math.max(0, cantidades[idx] + diff);
    }
    return ingredientes.map((x, i) => ({ esmalteId: x.esmalteId, cantidad: cantidades[i] }));
  };
  const gotasTexto = (cantidad: number) => cantidad === 1 ? "1 gota" : cantidad + " gotas";
  const abrirTamanoReceta = (recipe: Receta) => {
    const total = recipe.totalGotas;
    setTamanoReceta(total == null ? "12" : total === 4 || total === 12 || total === 20 ? String(total) as "4" | "12" | "20" : "custom");
    setGotasRecetaPersonalizadas(String(total ?? 12));
    setRecetaEditandoGotas(recipe.id);
  };
  const guardarTamanoReceta = () => {
    if (!recetaEditandoGotas) return;
    const total = tamanoReceta === "custom" ? Math.max(1, Math.min(10000, Math.floor(Number(gotasRecetaPersonalizadas) || 1))) : Number(tamanoReceta);
    persistRecipes(recipes.map(recipe => recipe.id === recetaEditandoGotas ? { ...recipe, totalGotas: total } : recipe));
    setRecetaEditandoGotas(null);
    setMessage("Tamaño de gotas actualizado solo para esa receta.");
  };

  const readTargetPhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Selecciona un archivo de imagen."); return; }
    if (file.size > 18 * 1024 * 1024) { setMessage("La foto supera 18 MB. Elige una imagen más pequeña."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { setMessage("No se pudo abrir esa foto."); return; }
      setPhotoUrl(reader.result);
      setPhotoName(file.name);
      setPhotoPoint({ x: 0.5, y: 0.5 });
      setPhotoDisplayPoint({ x: 0.5, y: 0.5 });
      setPhotoSample(null);
      setMessage("Toca el centro del esmalte en la foto para seleccionar la zona que quieres analizar.");
    };
    reader.onerror = () => setMessage("No se pudo leer esa foto.");
    reader.readAsDataURL(file);
  };

  const samplePhotoRegion = () => {
    if (!photoUrl) return;
    const image = new Image();
    image.onload = () => {
      try {
        // Reducimos la imagen a una copia pequeña para limitar memoria y tiempo de cálculo.
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("No se pudo analizar la imagen en este dispositivo.");
        ctx.drawImage(image, 0, 0, width, height);
        const cx = Math.round(photoPoint.x * width), cy = Math.round(photoPoint.y * height);
        const radius = Math.max(2, Math.round(Math.min(width, height) * sampleSize / 200));
        const x0 = Math.max(0, cx - radius), y0 = Math.max(0, cy - radius);
        const x1 = Math.min(width, cx + radius + 1), y1 = Math.min(height, cy + radius + 1);
        const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const reds: number[] = [], greens: number[] = [], blues: number[] = [];
        let rejected = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], alpha = data[i + 3];
          if (alpha < 200) { rejected++; continue; }
          // La máscara circular mantiene el muestreo dentro del área elegida, no en las esquinas.
          const px = x0 + (i / 4) % (x1 - x0);
          const py = y0 + Math.floor((i / 4) / (x1 - x0));
          if (Math.pow((px - cx) / radius, 2) + Math.pow((py - cy) / radius, 2) > 1) { rejected++; continue; }
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          // Excluye reflejos casi blancos y sombras casi negras que sesgan el color del esmalte.
          if ((min > 232 && max - min < 28) || max < 18) { rejected++; continue; }
          reds.push(r); greens.push(g); blues.push(b);
        }
        if (reds.length < 12) throw new Error("Hay pocos píxeles útiles en esa zona. Amplía la zona o elige otro punto.");
        const median = (values: number[]) => {
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        };
        const hex = rgbHex({ r: median(reds), g: median(greens), b: median(blues) });
        const confidence = rejected / (reds.length + rejected) > 0.45 ? "Baja: muchos reflejos o sombras" : rejected / (reds.length + rejected) > 0.2 ? "Media: revisa la iluminación" : "Buena: zona relativamente uniforme";
        setPhotoSample({ hex, confidence, pixels: reds.length });
        setTarget(hex);
        setTargetHexInput(hex);
        setMessage("Color calculado con la mediana de los píxeles útiles de la zona seleccionada.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No se pudo extraer el color.");
      }
    };
    image.onerror = () => setMessage("No se pudo abrir esa foto.");
    image.src = photoUrl;
  };

  const choosePhotoPoint = (event: React.MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const imageX = clamp((event.clientX - rect.left) / rect.width);
    const imageY = clamp((event.clientY - rect.top) / rect.height);
    const canvas = event.currentTarget.parentElement;
    const canvasRect = canvas?.getBoundingClientRect();
    setPhotoPoint({ x: imageX, y: imageY });
    // Coordenadas de la marca visual respecto al contenedor, aunque la foto tenga márgenes laterales.
    setPhotoDisplayPoint(canvasRect ? {
      x: clamp((event.clientX - canvasRect.left) / canvasRect.width),
      y: clamp((event.clientY - canvasRect.top) / canvasRect.height)
    } : { x: imageX, y: imageY });
    setPhotoSample(null);
  };

  const buscarRecetasEnInventario = useMemo(
    () => crearBuscadorRecetas({ mezclar: mixColors, hexToLab, deltaE2000 }),
    []
  );

  const searchRecipes = async () => {
    if (active.length < 2) {
      setResult([]);
      setMessage("Necesitás al menos 2 esmaltes en tu inventario para buscar recetas.");
      return;
    }
    setWorking(true);
    setMessage("Buscando recetas en tu inventario…");
    setResult([]);
    try {
      const sugeridas = await buscarRecetasEnInventario(target, inventory, 3);
      setResult(sugeridas.map(receta => ({
        hex: receta.hexResultante,
        deltaE: receta.deltaE,
        ingredientes: receta.ingredientes.map(item => ({
          esmalteId: item.esmalteId,
          nombre: item.nombre,
          hex: item.hex,
          porcentaje: item.porcentaje,
          ml: Number((item.porcentaje / 100).toFixed(2))
        }))
      })));
      setMessage(sugeridas.length
        ? "Estas son las mejores recetas encontradas con tu inventario."
        : "No hay combinaciones posibles con los esmaltes disponibles.");
    } catch (error) {
      setResult([]);
      setMessage(error instanceof Error ? error.message : "No se pudo completar la búsqueda.");
    } finally {
      setWorking(false);
    }
  };

  const saveRecipe = (item: { hex: string; deltaE: number; objetivoHex?: string | null; ingredientes: Ingrediente[] }, label = recipeName) => {
    const objetivoHex = item.objetivoHex === undefined ? manualObjetivoHex : item.objetivoHex;
    const deltaE = objetivoHex ? deltaE2000(hexToLab(item.hex), hexToLab(objetivoHex)) : 0;
    const recipe: Receta = {
      id: uid(),
      nombre: label.trim() || "Mi mezcla",
      hex: item.hex,
      deltaE,
      objetivoHex: objetivoHex ?? null,
      totalGotas,
      ingredientes: item.ingredientes,
      creada: new Date().toISOString()
    };
    persistRecipes([recipe, ...recipes]);
    setMessage("Receta guardada en este dispositivo.");
  };
  const addPolishToMix = (esmalteId: string) => {
    const esmalte = inventory.find(item => item.id === esmalteId);
    if (!esmalte || manual.some(item => item.id === esmalte.id) || esmalte.ml <= 0) return;
    const current = manual.filter(item => item.porcentaje > 0).map(item => ({ ...item }));
    let total = current.reduce((sum, item) => sum + item.porcentaje, 0);
    let toAdd = Math.min(10, Math.max(0, 100 - total));
    if (toAdd < 10 && total + 10 > 100) {
      let excess = total + 10 - 100;
      for (const item of [...current].sort((a, b) => b.porcentaje - a.porcentaje)) {
        const reduction = Math.min(item.porcentaje, excess);
        item.porcentaje -= reduction;
        excess -= reduction;
        if (excess <= 0) break;
      }
      total = current.reduce((sum, item) => sum + item.porcentaje, 0);
      toAdd = 10;
    }
    setManual([...current, { id: esmalte.id, porcentaje: toAdd }]);
    const names = [...current.filter(item => item.porcentaje > 0).map(item => inventory.find(e => e.id === item.id)?.nombre), esmalte.nombre]
      .filter((itemName): itemName is string => Boolean(itemName));
    setRecipeName(names.map(capitalizar).join(" + "));
    setShowAddPolish(false);
  };

  const updateManualPercentage = (esmalte: Esmalte, value: string) => {
    const n = Number(value);
    const next = n <= 0
      ? manual.filter(item => item.id !== esmalte.id)
      : [...manual.filter(item => item.id !== esmalte.id), { id: esmalte.id, porcentaje: Math.min(100, Math.max(0, n)) }];
    setManual(next);
    const selectedNames = next
      .map(item => inventory.find(itemInventory => itemInventory.id === item.id)?.nombre)
      .filter((itemName): itemName is string => Boolean(itemName));
    setRecipeName(selectedNames.length ? selectedNames.map(capitalizar).join(" + ") : "Mi mezcla");
  };
  const status = (d: number) => d < 2 ? "Idéntico" : d < 5 ? "Muy parecido" : d < 10 ? "Aceptable" : "Lejos";
  const categoriaDeColor = (hex: string): string => {
    const lab = hexToLab(hex);
    return COLOR_PALETTE.reduce((best, category) =>
      deltaE2000(lab, hexToLab(category.hex)) < deltaE2000(lab, hexToLab(best.hex)) ? category : best
    , COLOR_PALETTE[0]).nombre;
  };
  const categoriasQueAyudan: Record<string, string[]> = {
    "Rojo": ["Naranja", "Rosa", "Fucsia", "Marrón"],
    "Naranja": ["Rojo", "Amarillo"],
    "Amarillo": ["Naranja", "Verde", "Marrón"],
    "Verde": ["Amarillo", "Turquesa", "Azul"],
    "Turquesa": ["Verde", "Azul"],
    "Azul": ["Turquesa", "Violeta", "Morado"],
    "Violeta": ["Azul", "Rojo", "Fucsia"],
    "Morado": ["Azul", "Rojo", "Fucsia"],
    "Rosa": ["Rojo", "Fucsia", "Magenta"],
    "Fucsia": ["Rosa", "Rojo", "Violeta"],
    "Marrón": ["Rojo", "Naranja", "Amarillo"],
    "Blanco": ["Rojo", "Azul", "Amarillo"]
  };
  const categoriasInventario = new Set(inventory.map(esmalte => categoriaDeColor(esmalte.hex)));
  const categoriasFaltantes = (objetivo: string): string[] => {
    const helpers = categoriasQueAyudan[objetivo] ?? [];
    const normalizarCategoria = (categoria: string) => categoria === "Magenta" ? "Fucsia" : categoria;
    return [...new Set(helpers)]
      .filter(categoria => !categoriasInventario.has(normalizarCategoria(categoria)))
      .map(normalizarCategoria);
  };
  const objetivoCategoria = categoriaDeColor(target);
  const faltantesObjetivo = categoriasFaltantes(objetivoCategoria);
  const advertirFaltaVariedad = result.length > 0 && result[0].deltaE >= 15;
  const resultadosVisibles = result.length > 0 && result[0].deltaE >= 30 ? result.slice(0, 1) : result;

  return <section className="workspace color-mixer">
    <div className="welcome-row"><div><span className="eyebrow">COLORIMETRÍA PARA TU ESTUDIO</span><h1>Mezclador <em>de colores.</em></h1><p>Prueba mezclas, encuentra una receta cercana y guarda tus fórmulas sin conexión.</p></div></div>
    <div className="section-tabs" role="tablist" aria-label="Herramientas de color">
      {([["mezclar","Mezclar"],["buscar","Buscar color"],["capturar","Capturar color"],["inventario","Mis esmaltes"],["recetas","Recetas guardadas"]] as const).map(([id,label]) => <button key={id} role="tab" aria-selected={tab===id} className={tab===id?"selected":""} onClick={()=>setTab(id)}>{label}</button>)}
    </div>
    {message && <p className="form-notice" role="status">{message}</p>}
    {tab === "mezclar" && <div className="color-mixer-grid">
      <article className="provider-card color-mixer-card"><h2>Vista previa</h2><NailPreview hex={manualHex}/><p className="color-hex">{manualHex}</p><label>Nombre de la receta<input value={recipeName} onChange={e=>setRecipeName(e.target.value)} /></label>
        <p className="saved-recipe-drops">Receta para {totalGotas} gotas</p>
        <div className="preview-drop-breakdown">{activeInMix.map(item => { const cantidad = gotasPorId(item.esmalte.id)?.cantidad ?? 0; return <div key={item.esmalte.id}><span className="polish-dot" style={{background:item.esmalte.hex}}/><b>{capitalizar(item.esmalte.nombre)}</b><strong>{gotasTexto(cantidad)} <small>({item.porcentaje}%)</small></strong></div>; })}</div>
        <p className="muted-small">Suma de proporciones: {totalManual}%</p>
        <button className="provider-primary" disabled={!manualItems.length || totalManual !== 100} onClick={()=>saveRecipe({hex:manualHex,deltaE:0,objetivoHex:manualObjetivoHex,ingredientes:manualItems.map(x=>({esmalteId:x.esmalte.id,nombre:x.esmalte.nombre,hex:x.esmalte.hex,porcentaje:x.porcentaje,ml:Number((x.porcentaje/100).toFixed(2))}))})}>Guardar receta</button>
      </article>
      <article className="provider-card color-mixer-card"><h2>Selecciona esmaltes</h2>
        {activeInMix.map(({ esmalte: e, porcentaje }) =>
          <div className="mixer-polish-row" key={e.id}><span className="polish-dot" style={{background:e.hex}}/><div className="polish-meta"><b>{capitalizar(e.nombre)}</b><small>{e.ml} ml disponibles · {e.hex}</small><small className="drop-count">{(gotasPorId(e.id)?.cantidad ?? 0) <= 20 ? "●".repeat(Math.max(0, gotasPorId(e.id)?.cantidad ?? 0)) : "● ×" + gotasPorId(e.id)?.cantidad}</small><strong className="mix-drop-primary">{gotasTexto(gotasPorId(e.id)?.cantidad ?? 0)} <small>({porcentaje}%)</small></strong></div><input aria-label={`Porcentaje de ${e.nombre}`} type="number" min="0" max="100" step="10" value={porcentaje} onChange={ev=>updateManualPercentage(e, ev.target.value)} /><button type="button" className="provider-secondary" aria-label={`Quitar ${capitalizar(e.nombre)} de la mezcla`} onClick={()=>{setManual(prev=>prev.filter(item=>item.id!==e.id));setRecipeName(prev=>prev.split(" + ").filter(name=>name.toLocaleLowerCase("es")!==e.nombre.toLocaleLowerCase("es")).join(" + ") || "Mi mezcla");}}>Quitar</button></div>
        )}
        <div className="mixer-add-polish">
          <button type="button" className="provider-secondary" disabled={availableToAdd.length===0} onClick={()=>setShowAddPolish(value=>!value)}>+ Agregar esmalte</button>
          {showAddPolish && <div className="mixer-add-polish-picker">
            <label>Selecciona un esmalte del inventario
              <select value="" onChange={event=>{if(event.target.value)addPolishToMix(event.target.value);}}>
                <option value="">Elegir esmalte…</option>
                {availableToAdd.map(esmalte=><option key={esmalte.id} value={esmalte.id}>{capitalizar(esmalte.nombre)} · {esmalte.ml} ml</option>)}
              </select>
            </label>
          </div>}
          {activeInMix.length===0 && <p className="muted-small">No hay esmaltes activos. Agrega uno para comenzar la mezcla.</p>}
        </div>
        <section className="mix-volume-section" aria-labelledby="mix-volume-heading">
          <h3 id="mix-volume-heading">¿Cuánto preparar?</h3>
          <div className="mix-volume-segmented" role="group" aria-label="Volumen de la mezcla">
            <button type="button" aria-pressed={volumenGotas==="4"} className={volumenGotas==="4"?"selected":""} onClick={()=>setVolumenGotas("4")}>Uña sola <small>4 gotas</small></button>
            <button type="button" aria-pressed={volumenGotas==="12"} className={volumenGotas==="12"?"selected":""} onClick={()=>setVolumenGotas("12")}>Mano completa <small>12 gotas</small></button>
            <button type="button" aria-pressed={volumenGotas==="20"} className={volumenGotas==="20"?"selected":""} onClick={()=>setVolumenGotas("20")}>Dos manos <small>20 gotas</small></button>
            <button type="button" aria-pressed={volumenGotas==="custom"} className={volumenGotas==="custom"?"selected":""} onClick={()=>setVolumenGotas("custom")}>Personalizado</button>
          </div>
          {volumenGotas==="custom" && <label className="custom-drops-label">Gotas totales<input type="number" min="1" max="10000" step="1" value={gotasPersonalizadas} onChange={event=>setGotasPersonalizadas(event.target.value)} /></label>}
          <p className="muted-small">Total: <strong>{totalGotas} gotas</strong>. Las cantidades se redondean y el ajuste final garantiza que sumen exactamente el total.</p>
          {activeInMix.filter(item=>(item.porcentaje/100*totalGotas)<1).map(item=><p className="drop-warning" role="alert" key={item.esmalte.id}>⚠️ {capitalizar(item.esmalte.nombre)} queda en menos de 1 gota. El resultado puede no coincidir con la vista previa. Probá con una mezcla más grande.</p>)}
        </section>
        <p className="muted-small">Introduce proporciones en incrementos de 10 %. La suma debe ser 100 % para guardar.</p>
      </article>
    </div>}
    {tab === "buscar" && <div className="color-mixer-grid">
      <article className="provider-card color-mixer-card"><h2>Color objetivo</h2>
        <div className="target-color-row">
          <input type="color" aria-label="Seleccionar color objetivo" value={target} onChange={e=>{setTarget(e.target.value.toUpperCase());setTargetHexInput(e.target.value.toUpperCase());}}/>
          <span>{target}</span>
        </div>
        <label className="target-hex-field">Código HEX
          <input aria-label="Código HEX del color objetivo" value={targetHexInput} placeholder="#F07835" maxLength={7}
            onChange={e=>{const value=e.target.value.toUpperCase();setTargetHexInput(value);const normalized=value.startsWith("#")?value:"#"+value;if(/^#[0-9A-F]{6}$/.test(normalized)){setTarget(normalized);}}}
            onBlur={()=>{const value=targetHexInput.trim().toUpperCase();const normalized=value.startsWith("#")?value:"#"+value;if(/^#[0-9A-F]{6}$/.test(normalized)){setTarget(normalized);setTargetHexInput(normalized);}else{setTargetHexInput(target);}}}/>
        </label>
        <div className="target-palette" aria-label="Paleta de colores predefinidos">
          {COLOR_PALETTE.map(({ nombre, hex })=><button type="button" key={hex} className={target===hex?"target-palette-color selected":"target-palette-color"} aria-label={`Elegir ${nombre} ${hex}`} title={`${nombre} · ${hex}`} onClick={()=>{setTarget(hex);setTargetHexInput(hex);}}>
            <span style={{background:hex}}/><small>{nombre}</small>
          </button>)}
        </div>
        <NailPreview hex={target}/>
        <p className="muted-small">Se comparan los colores en CIELAB con ΔE2000. La búsqueda usa hasta 15 esmaltes disponibles y prueba mezclas de 2 o 3 colores con proporciones en pasos del 10 %.</p>
        {active.length<2 && <p className="form-notice" role="status">Necesitás al menos 2 esmaltes en tu inventario para buscar recetas.</p>}
        <button className="provider-primary" disabled={working || active.length<2} onClick={()=>void searchRecipes()}>{working?"Buscando recetas…":"Buscar recetas en mi inventario"}</button>
      </article>
      <article className="provider-card color-mixer-card"><h2>Recetas sugeridas</h2>
        {working && <div className="recipe-search-loading" role="status"><span className="recipe-spinner" aria-hidden="true"/><p>Comparando combinaciones de tu inventario…</p></div>}
        {!working && result.length===0 && <p>Elige un color objetivo y pulsa «Buscar recetas en mi inventario».</p>}
        {!working && advertirFaltaVariedad && <div className="recipe-warning" role="alert">
          <div className="recipe-warning-title"><span aria-hidden="true">⚠️</span><strong>Ninguna de tus mezclas se acerca al color objetivo.</strong></div>
          <p>ΔE más bajo: {result[0].deltaE.toFixed(2)}. Te falta variedad de esmaltes.</p>
          {objetivoCategoria === "Rosa" && !["Rojo", "Rosa", "Fucsia", "Marrón"].some(category => categoriasInventario.has(category))
            ? <p>Sumá un rojo, magenta o fucsia para cubrir el canal rojo.</p>
            : faltantesObjetivo.length > 0 && <div><strong>Categorías que podrían ayudarte:</strong><ul>{faltantesObjetivo.map(category=><li key={category}>{category}</li>)}</ul></div>}
        </div>}
        {resultadosVisibles.map((item,i)=><div className="suggested-recipe" key={item.ingredientes.map(x=>x.esmalteId+":"+x.porcentaje).join("-")}>
          <div className="suggested-recipe-head"><span className="polish-dot large" style={{background:item.hex}}/><div><b>Opción {i+1}</b><small>{item.hex} · ΔE2000 {item.deltaE.toFixed(2)} · {status(item.deltaE)}</small></div></div>
          <div className="recipe-ingredients">{item.ingredientes.map(x=><div className="recipe-ingredient" key={x.esmalteId}>
            <span className="polish-dot" style={{background:x.hex}}/><span><b>{capitalizar(x.nombre)}</b><small>{x.hex}</small></span><strong>{x.porcentaje}%</strong>
          </div>)}</div>
          <button className="provider-primary" onClick={()=>{setManual(item.ingredientes.map(x=>({id:x.esmalteId,porcentaje:x.porcentaje})));setManualObjetivoHex(target);setRecipeName("Receta para "+target);setTab("mezclar");setMessage("Receta precargada en el mezclador. Se conservará el color objetivo al guardarla.");}}>Usar esta receta</button>
        </div>)}
      </article>
    </div>}
    {tab === "inventario" && <div className="provider-card color-mixer-card"><h2>Inventario de esmaltes</h2><p>El inventario se guarda en este dispositivo y está disponible sin conexión.</p><form className="mixer-inventory-form" onSubmit={e=>{e.preventDefault();if(!name.trim()||Number(ml)<0)return;persistInventory([...inventory,{id:uid(),nombre:name.trim(),hex:newHex.toUpperCase(),ml:Number(ml)}]);setName("");setMl("10");setMessage("Esmalte añadido al inventario.");}}><label>Nombre<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Rojo cereza"/></label><label>Color<input type="color" value={newHex} onChange={e=>setNewHex(e.target.value.toUpperCase())}/></label><label>Cantidad (ml)<input type="number" min="0" step=".1" required value={ml} onChange={e=>setMl(e.target.value)}/></label><button className="provider-primary" type="submit">Añadir esmalte</button></form>
      {inventory.length===0?<p>Aún no has añadido esmaltes.</p>:<div className="mixer-inventory-list">{inventory.map(e=><div className="mixer-polish-row" key={e.id}><span className="polish-dot" style={{background:e.hex}}/><div className="polish-meta"><b>{capitalizar(e.nombre)}</b><small>{e.hex} · {e.ml} ml</small></div><label className="stock-label">ml<input aria-label={`Cantidad de ${e.nombre}`} type="number" min="0" step=".1" value={e.ml} onChange={ev=>persistInventory(inventory.map(x=>x.id===e.id?{...x,ml:Math.max(0,Number(ev.target.value))}:x))}/></label><button className="provider-secondary" onClick={()=>persistInventory(inventory.filter(x=>x.id!==e.id))}>Eliminar</button></div>)}</div>}
    </div>}
    {tab === "recetas" && <div className="provider-card color-mixer-card"><h2>Mis recetas guardadas</h2>{recipes.length===0?<p>Aún no has guardado recetas.</p>:recipes.map(recipe=><article className="saved-recipe" key={recipe.id}><NailPreview hex={recipe.hex}/><div className="saved-recipe-content"><b>{recipe.nombre}</b><span className="color-hex">{recipe.hex}</span>{recipe.objetivoHex && <><div className="saved-recipe-comparison" aria-label="Comparación entre color objetivo y resultado"><div><span className="saved-recipe-color-dot" style={{background:recipe.objetivoHex}}/><small>Objetivo</small><code>{recipe.objetivoHex}</code></div><span className="saved-recipe-compare-arrow" aria-hidden="true">→</span><div><span className="saved-recipe-color-dot" style={{background:recipe.hex}}/><small>Resultado</small><code>{recipe.hex}</code></div></div><small>ΔE00 {recipe.deltaE.toFixed(2)} · {status(recipe.deltaE)}</small></>}<div className="saved-recipe-size-row"><p className="saved-recipe-drops">{recipe.totalGotas == null ? "Tamaño sin definir" : "Receta para " + recipe.totalGotas + (recipe.totalGotas === 1 ? " gota" : " gotas")}</p><button type="button" className="provider-secondary saved-recipe-change-size" onClick={()=>abrirTamanoReceta(recipe)}>{recipe.totalGotas == null ? "Elegir tamaño" : "✏️ Cambiar"}</button></div><ul className="saved-recipe-ingredients">{recipe.ingredientes.map((x,i)=>{ const cantidad = recipe.totalGotas == null ? null : calcularGotas(recipe.ingredientes, recipe.totalGotas)[i]?.cantidad; return <li key={x.esmalteId+i}><span>{capitalizar(x.nombre)}</span>{cantidad == null ? <span className="saved-ingredient-percent">{x.porcentaje}%</span> : <span className="saved-ingredient-amount">{gotasTexto(cantidad)} <small>({x.porcentaje}%)</small></span>}</li>; })}</ul><button className="provider-secondary" onClick={()=>persistRecipes(recipes.filter(x=>x.id!==recipe.id))}>Eliminar receta</button></div></article>)}</div>}
    {recetaEditandoGotas && <div className="recipe-drops-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setRecetaEditandoGotas(null);}}><section className="recipe-drops-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-drops-title"><button type="button" className="recipe-drops-close" aria-label="Cerrar" onClick={()=>setRecetaEditandoGotas(null)}>×</button><h2 id="recipe-drops-title">¿Para cuántas gotas?</h2><p>Se mantienen los porcentajes de la receta. Solo cambia la cantidad que vas a preparar.</p><div className="recipe-drops-options"><label><input type="radio" name="tamano-receta" checked={tamanoReceta==="4"} onChange={()=>setTamanoReceta("4")}/> Uña sola <small>4 gotas</small></label><label><input type="radio" name="tamano-receta" checked={tamanoReceta==="12"} onChange={()=>setTamanoReceta("12")}/> Mano completa <small>12 gotas</small></label><label><input type="radio" name="tamano-receta" checked={tamanoReceta==="20"} onChange={()=>setTamanoReceta("20")}/> Dos manos <small>20 gotas</small></label><label className="recipe-drops-custom"><input type="radio" name="tamano-receta" checked={tamanoReceta==="custom"} onChange={()=>setTamanoReceta("custom")}/> Personalizado <input aria-label="Cantidad personalizada de gotas" type="number" min="1" max="10000" step="1" value={gotasRecetaPersonalizadas} onFocus={()=>setTamanoReceta("custom")} onChange={event=>{setGotasRecetaPersonalizadas(event.target.value);setTamanoReceta("custom");}}/></label></div><div className="recipe-drops-dialog-actions"><button type="button" className="provider-secondary" onClick={()=>setRecetaEditandoGotas(null)}>Cancelar</button><button type="button" className="provider-primary" onClick={guardarTamanoReceta}>Guardar tamaño</button></div></section></div>}
    {tab === "capturar" && <ColorCapture onColorCaptured={hex => { setTarget(hex); setTargetHexInput(hex); setTab("buscar"); setMessage("Color capturado y guardado como objetivo. Ahora puedes buscar una receta en tu inventario."); }} />}
  </section>;
}
