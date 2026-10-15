import { useState } from "react";
import { requestPasswordReset, resetPasswordWithCode, signInWithEmail, signUpWithEmail } from "@lumi/api";

type Mode = "login" | "signup" | "forgot" | "reset";

type Props = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onSignedIn: (kind: "login" | "signup" | "reset") => Promise<void> | void;
};

const normalizeLoginEmail = (value: string) => {
  const input = value.trim().toLowerCase();
  return input.includes("@") ? input : `${input}@gmail.com`;
};

const TITLES: Record<Mode, string> = {
  login: "Iniciar sesión",
  signup: "Crear cuenta profesional",
  forgot: "Recupera tu contraseña",
  reset: "Crea una contraseña nueva",
};

export default function AuthPanel({ onError, onNotice, onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");

  const subtitle: Record<Mode, string> = {
    login: "Accede a tu agenda, servicios y configuración del estudio.",
    signup: "Accede a tu agenda, servicios y configuración del estudio.",
    forgot: "Escribe tu correo y te enviaremos un código para crear una contraseña nueva.",
    reset: `Escribe el código que enviamos a ${normalizeLoginEmail(email)} y tu nueva contraseña.`,
  };

  const canSubmit =
    mode === "login" ? email.trim() !== "" && password.length >= 6
    : mode === "signup" ? email.trim() !== "" && password.length >= 6 && displayName.trim() !== ""
    : mode === "forgot" ? email.trim() !== ""
    : code.trim().length >= 6 && password.length >= 6;

  const goTo = (next: Mode) => {
    setMode(next);
    setPassword("");
    setCode("");
    onError("");
  };

  const submit = async () => {
    setBusy(true);
    onError("");
    onNotice("");
    try {
      if (mode === "signup") {
        const { session } = await signUpWithEmail(normalizeLoginEmail(email), password, displayName, "provider");
        if (session) {
          await onSignedIn("signup");
          onNotice("Cuenta creada. Registra tu estudio para empezar.");
        } else {
          onNotice("Cuenta creada. Confirma tu correo y después inicia sesión para registrar tu estudio.");
          setMode("login");
        }
      } else if (mode === "login") {
        await signInWithEmail(normalizeLoginEmail(email), password);
        await onSignedIn("login");
        onNotice("Sesión iniciada.");
      } else if (mode === "forgot") {
        await requestPasswordReset(normalizeLoginEmail(email));
        onNotice("Si ese correo tiene una cuenta, te enviamos un código. Puede tardar un minuto.");
        setMode("reset");
      } else {
        await resetPasswordWithCode(normalizeLoginEmail(email), code, password);
        await onSignedIn("reset");
        onNotice("Contraseña actualizada. Ya has iniciado sesión.");
      }
      setPassword("");
      setCode("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-card auth-provider-card">
      <div className="settings-avatar">♡</div>
      <div>
        <h3>{TITLES[mode]}</h3>
        <p>{subtitle[mode]}</p>
      </div>
      <form
        className="provider-auth-fields"
        onSubmit={e => {
          e.preventDefault();
          if (canSubmit && !busy) void submit();
        }}
      >
        {mode === "signup" && (
          <label>Tu nombre
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" />
          </label>
        )}
        {mode !== "reset" && (
          <label>Nombre de usuario
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" placeholder="fulanito" />
            <small>Se utilizará {email.trim() ? normalizeLoginEmail(email) : "tuusuario@gmail.com"}</small>
          </label>
        )}
        {mode === "reset" && (
          <label>Código del correo
            <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={10} />
          </label>
        )}
        {mode !== "forgot" && (
          <label>{mode === "reset" ? "Nueva contraseña" : "Contraseña"}
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
        )}
        <button type="submit" className="provider-primary full-provider-button" disabled={busy || !canSubmit}>
          {busy ? "Procesando…"
            : mode === "login" ? "Iniciar sesión"
            : mode === "signup" ? "Crear cuenta"
            : mode === "forgot" ? "Enviar código"
            : "Guardar contraseña"}
        </button>
        {mode === "login" && (
          <button type="button" className="auth-link" onClick={() => goTo("forgot")}>¿Olvidaste tu contraseña?</button>
        )}
        {mode === "reset" && (
          <button type="button" className="auth-link" onClick={() => goTo("forgot")}>Pedir otro código</button>
        )}
        <button
          type="button"
          className="provider-secondary"
          onClick={() => goTo(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "No tengo cuenta · Registrarme" : "Ya tengo cuenta · Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
