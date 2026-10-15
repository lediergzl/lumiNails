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
  login: "Inicia sesión",
  signup: "Crea tu cuenta",
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
    login: "Accede a tus citas y preferencias desde cualquier dispositivo.",
    signup: "Accede a tus citas y preferencias desde cualquier dispositivo.",
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
        const { session } = await signUpWithEmail(normalizeLoginEmail(email), password, displayName, "client");
        if (session) {
          await onSignedIn("signup");
          onNotice("Cuenta creada. Ya puedes reservar tu primera cita.");
        } else {
          onNotice("Cuenta creada. Confirma tu correo para poder iniciar sesión.");
          setMode("login");
        }
      } else if (mode === "login") {
        await signInWithEmail(normalizeLoginEmail(email), password);
        await onSignedIn("login");
        onNotice("Sesión iniciada correctamente.");
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
    <div className="profile-panel auth-panel">
      <div className="profile-avatar">♡</div>
      <div>
        <h3>{TITLES[mode]}</h3>
        <p>{subtitle[mode]}</p>
      </div>
      <form
        className="auth-fields"
        onSubmit={e => {
          e.preventDefault();
          if (canSubmit && !busy) void submit();
        }}
      >
        {mode === "signup" && (
          <label className="field-label">Nombre
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" />
          </label>
        )}
        {mode !== "reset" && (
          <label className="field-label">Nombre de usuario
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" placeholder="fulanito" />
            <small>Se utilizará {email.trim() ? normalizeLoginEmail(email) : "tuusuario@gmail.com"}</small>
          </label>
        )}
        {mode === "reset" && (
          <label className="field-label">Código del correo
            <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={10} />
          </label>
        )}
        {mode !== "forgot" && (
          <label className="field-label">{mode === "reset" ? "Nueva contraseña" : "Contraseña"}
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
        )}
        <button type="submit" className="button-dark full-button" disabled={busy || !canSubmit}>
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
          className="button-outline auth-toggle"
          onClick={() => goTo(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "No tengo cuenta · Registrarme" : "Ya tengo cuenta · Iniciar sesión"}
        </button>
      </form>
    </div>
  );
}
