import { useEffect, useRef, useState } from "react";

type Punto = { x: number; y: number };
type RGB = { r: number; g: number; b: number };
type Paso = "instrucciones" | "camara" | "referencia" | "esmalte" | "resultado" | "error";

const limitar = (n: number) => Math.max(0, Math.min(255, n));
const hexDe = (c: RGB) => "#" + [c.r, c.g, c.b].map(v => Math.round(limitar(v)).toString(16).padStart(2, "0")).join("").toUpperCase();
const promedio = (pixels: Uint8ClampedArray, width: number, cx: number, cy: number, radio: number): RGB | null => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, cy - radio); y <= Math.min(Math.floor(pixels.length / 4 / width) - 1, cy + radio); y++) {
    for (let x = Math.max(0, cx - radio); x <= Math.min(width - 1, cx + radio); x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 200) continue;
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
};

export default function ColorCapture({ onColorCaptured }: { onColorCaptured: (hex: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const originalRef = useRef<ImageData | null>(null);
  const [paso, setPaso] = useState<Paso>("instrucciones");
  const [error, setError] = useState("");
  const [puntoBlanco, setPuntoBlanco] = useState<Punto | null>(null);
  const [puntoEsmalte, setPuntoEsmalte] = useState<Punto | null>(null);
  const [factores, setFactores] = useState<RGB>({ r: 1, g: 1, b: 1 });
  const [color, setColor] = useState("#FFFFFF");
  const [deteccionAutomatica, setDeteccionAutomatica] = useState(false);

  const detenerCamara = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const iniciarCamara = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no permite abrir la cámara desde la app. Comprueba los permisos o actualiza Android System WebView.");
      setPaso("error");
      return;
    }
    try {
      detenerCamara();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      streamRef.current = stream;
      setPaso("camara");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => setError("Pulsa de nuevo para permitir la vista previa de la cámara."));
        }
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError"
        ? "Permite el acceso a la cámara en los permisos de la aplicación y vuelve a intentarlo."
        : name === "NotFoundError"
          ? "No se encontró una cámara disponible en este dispositivo."
          : "No se pudo abrir la cámara. Comprueba los permisos y vuelve a intentarlo.");
      setPaso("error");
    }
  };

  const dibujarFoto = (data: ImageData, corregir: boolean) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    canvas.width = data.width;
    canvas.height = data.height;
    const copia = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
    if (corregir) {
      for (let i = 0; i < copia.data.length; i += 4) {
        copia.data[i] = limitar(copia.data[i] * factores.r);
        copia.data[i + 1] = limitar(copia.data[i + 1] * factores.g);
        copia.data[i + 2] = limitar(copia.data[i + 2] * factores.b);
      }
    }
    ctx.putImageData(copia, 0, 0);
  };

  const capturar = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("La cámara todavía no está lista. Espera un momento e inténtalo otra vez.");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { setError("No se pudo procesar la foto."); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    originalRef.current = data;
    detenerCamara();
    const cellW = Math.max(1, Math.floor(data.width / 10));
    const cellH = Math.max(1, Math.floor(data.height / 10));
    let best: { point: Punto; score: number } | null = null;
    for (let gy = 0; gy < 10; gy++) for (let gx = 0; gx < 10; gx++) {
      const sample = promedio(data.data, data.width, Math.min(data.width - 1, gx * cellW + Math.floor(cellW / 2)), Math.min(data.height - 1, gy * cellH + Math.floor(cellH / 2)), Math.max(1, Math.floor(Math.min(cellW, cellH) / 8)));
      if (!sample) continue;
      const lum = (sample.r + sample.g + sample.b) / 3 / 255;
      const neutralidad = 1 - (Math.max(sample.r, sample.g, sample.b) - Math.min(sample.r, sample.g, sample.b)) / 255;
      const score = lum * neutralidad;
      if (lum > 0.5 && neutralidad > 0.72 && (!best || score > best.score)) {
        best = { point: { x: (gx * cellW + cellW / 2) / data.width, y: (gy * cellH + cellH / 2) / data.height }, score };
      }
    }
    setPuntoEsmalte(null);
    setPuntoBlanco(best?.point ?? null);
    setDeteccionAutomatica(Boolean(best && best.score > 0.5));
    setPaso("referencia");
    requestAnimationFrame(() => dibujarFoto(data, false));
    setError(best && best.score > 0.5
      ? "Detectamos una posible zona blanca. Confirma el punto sobre el fondo blanco."
      : "No encontramos un blanco fiable automáticamente. Toca una zona blanca de la foto.");
  };

  const coordenadas = (event: React.MouseEvent<HTMLCanvasElement>): Punto => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  };

  const elegirReferencia = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (paso !== "referencia" || !originalRef.current) return;
    const p = coordenadas(event);
    setPuntoBlanco(p);
    const data = originalRef.current;
    const rgb = promedio(data.data, data.width, Math.round(p.x * (data.width - 1)), Math.round(p.y * (data.height - 1)), Math.max(2, Math.round(Math.min(data.width, data.height) / 100)));
    if (!rgb || (rgb.r + rgb.g + rgb.b) / 3 < 90) {
      setError("Esa zona parece demasiado oscura. Toca una superficie blanca bien iluminada.");
      return;
    }
    const next = { r: Math.min(2.5, 245 / Math.max(1, rgb.r)), g: Math.min(2.5, 245 / Math.max(1, rgb.g)), b: Math.min(2.5, 245 / Math.max(1, rgb.b)) };
    setFactores(next);
    setPaso("esmalte");
    setError("Balance de blancos configurado. Ahora toca el centro del esmalte, evitando reflejos.");
    dibujarFoto(data, true);
  };

  const elegirEsmalte = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (paso !== "esmalte" || !originalRef.current) return;
    const p = coordenadas(event);
    const data = originalRef.current;
    const rgb = promedio(data.data, data.width, Math.round(p.x * (data.width - 1)), Math.round(p.y * (data.height - 1)), 2);
    if (!rgb) return;
    const corrected = { r: rgb.r * factores.r, g: rgb.g * factores.g, b: rgb.b * factores.b };
    const hex = hexDe(corrected);
    setPuntoEsmalte(p);
    setColor(hex);
    setPaso("resultado");
    setError("Color extraído de una región de 5 × 5 píxeles y corregido con la referencia blanca.");
  };

  return <section className="provider-card color-capture-card" aria-label="Captura de color con cámara">
    <div className="color-capture-heading"><span className="eyebrow">COLORIMETRÍA</span><h2>Capturar color con cámara</h2><p>Usa una superficie blanca común como referencia. No necesitas una tarjeta especial.</p></div>
    {paso === "instrucciones" && <div className="color-capture-instructions">
      <div className="white-reference-illustration" aria-hidden="true"><span>BLANCO</span><i /><b>Frasco de esmalte</b></div>
      <h3>Prepara la foto</h3><p>Colocá el frasco de esmalte sobre una hoja blanca o cualquier superficie blanca, bien iluminada. Evitá sombras sobre el frasco.</p>
      <button type="button" className="provider-primary" onClick={() => void iniciarCamara()}>Continuar</button>
    </div>}
    {paso === "camara" && <div className="color-camera-stage">
      <div className="color-camera-preview"><video ref={videoRef} autoPlay muted playsInline /><div className="color-camera-guide" aria-hidden="true" /><span className="color-camera-tip">Asegurate de que se vea el blanco alrededor del frasco</span></div>
      {error && <p className="form-notice" role="status">{error}</p>}
      <div className="color-capture-actions"><button type="button" className="provider-secondary" onClick={() => { detenerCamara(); setPaso("instrucciones"); }}>Cancelar</button><button type="button" className="provider-primary" onClick={capturar}>Capturar foto</button></div>
    </div>}
    {(paso === "referencia" || paso === "esmalte" || paso === "resultado") && <div className="color-captured-stage">
      <p className="form-notice" role="status">{error}</p>
      <div className="color-canvas-wrap">
        <canvas ref={canvasRef} onClick={paso === "referencia" ? elegirReferencia : paso === "esmalte" ? elegirEsmalte : undefined} className={paso === "resultado" ? "color-captured-canvas read-only" : "color-captured-canvas"} aria-label={paso === "referencia" ? "Toca la zona blanca de referencia" : "Toca el color del esmalte"} />
        {puntoBlanco && <span className="color-point-marker white-point" style={{ left: (puntoBlanco.x * 100) + "%", top: (puntoBlanco.y * 100) + "%" }} aria-label="Punto de referencia blanca" />}
        {puntoEsmalte && <span className="color-point-marker polish-point" style={{ left: (puntoEsmalte.x * 100) + "%", top: (puntoEsmalte.y * 100) + "%" }} aria-label="Punto de color seleccionado" />}
      </div>
      {paso === "referencia" && <button type="button" className="provider-primary" onClick={() => { if (!puntoBlanco || !originalRef.current) { setError("Toca una zona blanca de la foto para continuar."); return; } const data = originalRef.current; const rgb = promedio(data.data, data.width, Math.round(puntoBlanco.x * (data.width - 1)), Math.round(puntoBlanco.y * (data.height - 1)), Math.max(2, Math.round(Math.min(data.width, data.height) / 100))); if (!rgb || (rgb.r + rgb.g + rgb.b) / 3 < 90) { setError("El punto no parece blanco. Selecciona una zona blanca más iluminada."); return; } const next = { r: Math.min(2.5, 245 / Math.max(1, rgb.r)), g: Math.min(2.5, 245 / Math.max(1, rgb.g)), b: Math.min(2.5, 245 / Math.max(1, rgb.b)) }; setFactores(next); setPaso("esmalte"); setError("Balance de blancos configurado. Toca el centro del esmalte, evitando reflejos."); dibujarFoto(data, true); }}>Confirmar blanco y continuar</button>}
      {paso === "esmalte" && <p className="muted-small">Toca el centro del esmalte en la foto corregida. Evita el brillo de la luz y los bordes del frasco.</p>}
      {paso === "resultado" && <div className="captured-color-result"><span className="captured-color-swatch" style={{ background: color }} /><div><strong>{color}</strong><small>Color corregido · {deteccionAutomatica ? "referencia detectada automáticamente" : "referencia seleccionada manualmente"}</small></div></div>}
      <div className="color-capture-actions">
        {paso === "resultado" && <button type="button" className="provider-primary" onClick={() => { onColorCaptured(color); }}>Guardar color</button>}
        {paso !== "referencia" && <button type="button" className="provider-secondary" onClick={() => { setPaso("referencia"); setPuntoEsmalte(null); setError("Toca o confirma una zona blanca para recalibrar el balance de blancos."); if (originalRef.current) dibujarFoto(originalRef.current, false); }}>Elegir otro punto blanco</button>}
        {paso === "resultado" && <button type="button" className="provider-secondary" onClick={() => { setPaso("esmalte"); setPuntoEsmalte(null); setError("Toca otro punto del esmalte para volver a calcular el color."); if (originalRef.current) dibujarFoto(originalRef.current, true); }}>Elegir otro punto</button>}
        <button type="button" className="provider-secondary" onClick={() => { setPuntoBlanco(null); setPuntoEsmalte(null); setPaso("instrucciones"); setError(""); originalRef.current = null; }}>Repetir foto</button>
      </div>
    </div>}
    {paso === "error" && <div className="color-capture-error"><p className="form-notice" role="alert">{error}</p><button type="button" className="provider-primary" onClick={() => void iniciarCamara()}>Intentar de nuevo</button><button type="button" className="provider-secondary" onClick={() => { setPaso("instrucciones"); setError(""); }}>Volver</button></div>}
    <p className="muted-small color-capture-disclaimer">La lectura depende de la iluminación, del brillo del frasco y de la cámara. El HEX es una estimación, no una medición de laboratorio.</p>
  </section>;
}
