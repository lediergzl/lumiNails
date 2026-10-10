import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";

export type AuthResult = {
  user: User;
  session: Session | null;
};

const AUTH_MESSAGES_BY_CODE: Record<string, string> = {
  user_already_exists: "Ya existe una cuenta con ese correo. Inicia sesión.",
  email_exists: "Ya existe una cuenta con ese correo. Inicia sesión.",
  invalid_credentials: "Correo o contraseña incorrectos.",
  email_not_confirmed: "Este correo aún no está confirmado. Revisa tu bandeja de entrada.",
  weak_password: "La contraseña es demasiado débil. Usa al menos 6 caracteres.",
  email_address_invalid: "Escribe un correo electrónico válido.",
  over_request_rate_limit: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  over_email_send_rate_limit: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  otp_expired: "El código no es válido o ya venció. Pide uno nuevo.",
  same_password: "La nueva contraseña debe ser distinta de la anterior.",
  signup_disabled: "El registro de cuentas nuevas no está disponible en este momento.",
};

const AUTH_MESSAGES_BY_TEXT: Array<[RegExp, string]> = [
  [/user already registered/i, "Ya existe una cuenta con ese correo. Inicia sesión."],
  [/invalid login credentials/i, "Correo o contraseña incorrectos."],
  [/email not confirmed/i, "Este correo aún no está confirmado. Revisa tu bandeja de entrada."],
  [/password should be at least/i, "La contraseña es demasiado corta. Usa al menos 6 caracteres."],
  [/unable to validate email|invalid format/i, "Escribe un correo electrónico válido."],
  [/token has expired or is invalid|otp.*(expired|invalid)/i, "El código no es válido o ya venció. Pide uno nuevo."],
  [/rate limit|too many requests/i, "Demasiados intentos. Espera unos minutos e inténtalo de nuevo."],
];

export function friendlyAuthMessage(error: Pick<AuthError, "message"> & { code?: string }): string {
  if (error.code && AUTH_MESSAGES_BY_CODE[error.code]) return AUTH_MESSAGES_BY_CODE[error.code];
  return AUTH_MESSAGES_BY_TEXT.find(([pattern]) => pattern.test(error.message))?.[1] ?? error.message;
}

function throwAuthError(error: AuthError | null): void {
  if (error) throw new Error(friendlyAuthMessage(error));
}

/**
 * Crea la cuenta. Si el proyecto de Supabase tiene desactivado "Confirm email",
 * `session` viene informada y el usuario ya está dentro. Si sigue activado,
 * `session` es null hasta que confirme el correo.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
  accountRole: "client" | "provider" = "client"
): Promise<AuthResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { display_name: displayName.trim(), signup_role: accountRole } },
  });
  throwAuthError(error);
  if (!data.user) throw new Error("Supabase no devolvió el usuario creado.");
  return { user: data.user, session: data.session };
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  throwAuthError(error);
  if (!data.user) throw new Error("No se pudo iniciar sesión.");
  return { user: data.user, session: data.session };
}

/** Envía un código de recuperación al correo (no revela si el correo existe). */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim().toLowerCase());
  throwAuthError(error);
}

/**
 * Verifica el código recibido por correo y fija la contraseña nueva.
 * Deja la sesión iniciada. Si la contraseña no se puede guardar, cierra la
 * sesión (el código ya se consumió) y pide uno nuevo.
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string
): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "recovery",
  });
  throwAuthError(error);

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    await supabase.auth.signOut().catch(() => undefined);
    throw new Error(`${friendlyAuthMessage(updateError)} Pide un código nuevo e inténtalo otra vez.`);
  }
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  throwAuthError(error);
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  throwAuthError(error);
  return data.session;
}

export function onAuthStateChange(
  callback: (session: Session | null) => void
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}


/** Teléfono de contacto del cliente autenticado. */
export async function getMyProfilePhone(): Promise<string> {
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return "";
  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.phone ?? "");
}

/** Guarda el teléfono propio; nunca modifica el perfil de otra persona. */
export async function saveMyProfilePhone(phone: string): Promise<void> {
  const clean = phone.trim();
  const digits = clean.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new Error("Introduce un teléfono válido con entre 7 y 15 dígitos.");
  }
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("Inicia sesión para guardar tu teléfono.");
  const { error } = await getSupabaseClient()
    .from("profiles")
    .update({ phone: clean })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
}
