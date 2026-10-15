/// <reference types="vite/client" />
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reportNetworkFailure, reportNetworkSuccess } from "./offline";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env de esta aplicación."
    );
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      // Avisa a la capa offline en cuanto una petición se cae por falta de red, sin esperar los reintentos de la librería.
      fetch: (input, init) =>
        fetch(input, init).then(
          (response) => { reportNetworkSuccess(); return response; },
          (error) => { reportNetworkFailure(); throw error; }
        ),
    },
  });

  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL?.trim() &&
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  );
}

/** Clave donde supabase-js guarda la sesión (misma regla que usa la librería por defecto). */
export function getAuthStorageKey(): string {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!url) throw new Error("Supabase no está configurado.");
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}
