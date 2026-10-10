import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@lumi/api";

type AppRole = "client" | "provider" | "admin";
type Account = { user_id: string; email: string; display_name: string; role: AppRole; created_at: string };
const roleLabel: Record<AppRole, string> = { client: "Clienta", provider: "Manicurista", admin: "Administrador" };

export default function AdminRoles() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draftRoles, setDraftRoles] = useState<Record<string, AppRole>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    const db = getSupabaseClient();
    const { data: allowed, error: authError } = await db.rpc("luni_is_admin");
    if (authError) throw authError;
    if (allowed !== true) throw new Error("No tienes permisos para administrar roles.");
    const { data, error: listError } = await db.rpc("luni_admin_list_users");
    if (listError) throw listError;
    const rows = (data ?? []) as Account[];
    setAccounts(rows);
    setDraftRoles(Object.fromEntries(rows.map(row => [row.user_id, row.role])));
  }, []);

  useEffect(() => { void refresh().catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }, [refresh]);

  const save = async (account: Account) => {
    const role = draftRoles[account.user_id] ?? account.role;
    if (role === account.role) return;
    setSaving(account.user_id); setError(""); setNotice("");
    try {
      const { error: saveError } = await getSupabaseClient().rpc("luni_admin_set_user_role", {
        p_user_id: account.user_id, p_role: role
      });
      if (saveError) throw saveError;
      setNotice("Rol actualizado para " + (account.email || account.display_name || "la cuenta") + ".");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(null); }
  };

  const visible = accounts.filter(a => (a.email + " " + a.display_name + " " + roleLabel[a.role]).toLowerCase().includes(filter.toLowerCase().trim()));

  return <section className="settings-card license-admin-card admin-roles-card">
    <div className="settings-icon" aria-hidden="true">♙</div>
    <div className="license-renewal-content">
      <span className="eyebrow">CONTROL DE ACCESOS</span>
      <h3>Roles de usuarios</h3>
      <p>Asigna a cada cuenta el acceso que necesita. Los cambios se validan en Supabase; una cuenta no puede cambiar su propio rol desde este panel.</p>
      {error && <p role="alert" className="photo-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label className="admin-roles-search">Buscar cuenta<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Correo o nombre"/></label>
      {loading ? <p>Cargando cuentas…</p> : visible.length === 0 ? <p>No se encontraron cuentas.</p> :
        <div className="admin-roles-list">{visible.map(account => {
          const draft = draftRoles[account.user_id] ?? account.role;
          return <article className="admin-role-row" key={account.user_id}>
            <div className="admin-role-identity"><b>{account.display_name || "Cuenta sin nombre"}</b><span>{account.email || "Sin correo"}</span><small>Alta: {new Date(account.created_at).toLocaleDateString("es-CU")}</small></div>
            <label>Rol de acceso<select value={draft} disabled={saving === account.user_id} onChange={e => setDraftRoles(old => ({ ...old, [account.user_id]: e.target.value as AppRole }))}>
              <option value="client">Clienta</option><option value="provider">Manicurista</option><option value="admin">Administrador</option>
            </select></label>
            <button className="provider-primary" disabled={saving !== null || draft === account.role} onClick={() => void save(account)}>{saving === account.user_id ? "Guardando…" : "Guardar rol"}</button>
          </article>;
        })}</div>}
      <button className="provider-secondary" disabled={loading || saving !== null} onClick={() => { setLoading(true); setError(""); void refresh().catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false)); }}>Actualizar cuentas</button>
    </div>
  </section>;
}
