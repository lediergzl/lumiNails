import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { cacheRemoteImage, resolveImageUrl, serviceImageUrl } from "@lumi/api";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** Ruta de la imagen en el almacenamiento (la misma que guarda la base de datos). */
  path: string | null | undefined;
};

/**
 * Imagen que se ve también sin conexión: usa la copia guardada en el teléfono y, si no la hay, la descarga
 * y la guarda al cargar. Si no se puede mostrar, no pinta nada (debajo queda el diseño de relleno).
 */
export function CachedImage({ path, onLoad, onError, ...rest }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    if (!path) return;
    void resolveImageUrl(path).then((local) => {
      if (alive) setSrc(local ?? serviceImageUrl(path));
    });
    return () => { alive = false; };
  }, [path]);

  if (!src || failed) return null;
  return (
    <img
      {...rest}
      src={src}
      onLoad={(event) => {
        onLoad?.(event);
        if (path && !src.startsWith("blob:")) void cacheRemoteImage(path);
      }}
      onError={(event) => {
        onError?.(event);
        setFailed(true);
      }}
    />
  );
}