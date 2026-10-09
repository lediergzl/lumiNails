import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";

export type AuthResult = {
  user: User;
  session: Session | null;
};

function throwAuthError(error: AuthError | null): void {
  if (error) throw new Error(error.message);
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<AuthResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { display_name: displayName.trim() } },
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
