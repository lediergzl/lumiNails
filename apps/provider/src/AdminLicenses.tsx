import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@lumi/api";

type Plan = { code: "monthly" | "quarterly" | "annual"; label: string; duration_days: number; price_cents: number; currency: string; active: boolean };
type Method = { code: string; label: string; active: boolean };
type Request = { id: string; provider_id: string; user_id: string; plan_label: string; duration_days: number; amount_cents: number; currency: string; payment_method: string; payment_reference: string | null; status: "pending" | "approved" | "rejected"; admin_note: string; created_at: string };
type Provider = { id: string; user_id: string; business_name: string; license_status: string; license_expires_at: string | null; trial_started_at: string | null };

const defaultPlans: Plan[] = [
  { code: "monthly", label: "Mensual", duration_days: 30, price_cents: 0, currency: "CUP", active: true },
  { code: "quarterly", label: "Trimestral", duration_days: 90, price_cents: 0, currency: "CUP", active: true },
  { code: "annual", label: "Anual", duration_days: 365, price_cents: 0, currency: "CUP", active: true },
];
const cash = (n: number, c = "CUP") => new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(n / 100) + " " + c;
const date = (v: string | null) => v ? new Date(v).toLocaleDateString("es-CU") : "Sin vencimiento";

export default function AdminLicenses() {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [plans, setPlans] = useState<Plan[]>(defaultPlans);
  const [methods, setMethods] = useState<Method[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newMethod, setNewMethod] = useState({ code: "", label: "" });
  const [selectedProvider, setSelectedProvider] = useState("");
  const [licenseStatus, setLicenseStatus] = useState("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adminSection, setAdminSection] = useState<"plans" | "methods" | "requests" | "assign">("plans");

  const refresh = useCallback(async () => {
    const db = getSupabaseClient();
    const { data: isAdmin, error: roleError } = await db.rpc("luni_is_admin");
    if (roleError) throw roleError;
    setAllowed(isAdmin === true);
    if (isAdmin !== true) return;
    const [planR, methodR, requestR, providerR] = await Promise.all([
      db.from("app_settings").select("value").eq("key", "license_prices").maybeSingle(),
      db.from("app_settings").select("value").eq("key", "payment_methods").maybeSingle(),
      db.from("license_payment_requests").select("id,provider_id,user_id,plan_label,duration_days,amount_cents,currency,payment_method,payment_reference,status,admin_note,created_at").order("created_at", { ascending: false }).limit(100),
      db.from("provider_profiles").select("id,user_id,business_name,license_status,license_expires_at,trial_started_at").is("deleted_at", null).order("business_name"),
    ]);
    const failure = planR.error ?? methodR.error ?? requestR.error ?? providerR.error;
    if (failure) throw failure;
    if (Array.isArray(planR.data?.value) && planR.data.value.length) setPlans(planR.data.value as Plan[]);
    const rawMethods = Array.isArray(methodR.data?.value) ? methodR.data.value : [];
    setMethods(rawMethods.map((m: string | Method) => typeof m === "string" ? { code: m, label: m, active: true } : m) as Method[]);
    setRequests((requestR.data ?? []) as Request[]);
    setProviders((providerR.data ?? []) as Provider[]);
  }, []);

  useEffect(() => { void refresh().catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setChecking(false)); }, [refresh]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const savePlans = () => run(async () => {
    const invalid = plans.some(p => !p.label.trim() || !Number.isInteger(Number(p.duration_days)) || Number(p.duration_days) < 1 || Number(p.duration_days) > 3650 || !Number.isFinite(Number(p.price_cents)) || Number(p.price_cents) <= 0);
    if (invalid) throw new Error("Cada plan debe tener una duración entre 1 y 3650 días y un precio mayor que cero en CUP.");
    const payload = plans.map(p => ({ ...p, price_cents: Math.round(Number(p.price_cents)), currency: "CUP" }));
    const { error: e } = await getSupabaseClient().rpc("luni_admin_set_license_plans", { p_plans: payload });
    if (e) throw e;
  }, "Planes guardados.");
  const saveMethods = () => run(async () => {
    if (methods.length === 0 || methods.some(m => !m.code.trim() || !m.label.trim())) throw new Error("Añade al menos un método de pago con código y nombre.");
    const { error: e } = await getSupabaseClient().rpc("luni_admin_set_payment_methods", { p_methods: methods });
    if (e) throw e;
  }, "Métodos de pago guardados.");
  const processRequest = (r: Request, approve: boolean) => run(async () => {
    const { error: e } = await getSupabaseClient().rpc("luni_admin_process_license_request", { p_request_id: r.id, p_approve: approve, p_note: notes[r.id] ?? "" });
    if (e) throw e;
  }, approve ? "Pago aprobado y licencia renovada." : "Solicitud rechazada.");
  const saveProviderLicense = () => run(async () => {
    if (!selectedProvider) throw new Error("Selecciona un estudio.");
    const expiry = licenseStatus === "active" || licenseStatus === "grace" ? (expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null) : null;
    if (!expiry && (licenseStatus === "active" || licenseStatus === "grace")) throw new Error("Indica la fecha de vencimiento.");
    const { error: e } = await getSupabaseClient().rpc("luni_admin_set_provider_license", { p_provider_id: selectedProvider, p_status: licenseStatus, p_expires_at: expiry, p_note: "Cambio manual desde LumiNails" });
    if (e) throw e;
  }, "Licencia actualizada.");

  if (checking) return <section className="settings-card"><div><h3>Administración de licencias</h3><p>Comprobando permisos…</p></div></section>;
  if (!allowed) return null;
  return <section className="settings-card license-admin-card">
    <div className="settings-icon" aria-hidden="true">♜</div>
    <div className="license-renewal-content">
      <span className="eyebrow">SOLO ADMINISTRADORES</span><h3>Administración de licencias</h3>
      <p>Gestiona renovaciones, precios, métodos de pago y licencias desde esta misma APK.</p>
      <div className="admin-license-tabs" role="tablist" aria-label="Gestión de licencias">
        <button type="button" role="tab" aria-selected={adminSection === "plans"} className={adminSection === "plans" ? "admin-license-tab active" : "admin-license-tab"} onClick={() => setAdminSection("plans")}>Planes y precios</button>
        <button type="button" role="tab" aria-selected={adminSection === "methods"} className={adminSection === "methods" ? "admin-license-tab active" : "admin-license-tab"} onClick={() => setAdminSection("methods")}>Métodos de pago</button>
        <button type="button" role="tab" aria-selected={adminSection === "requests"} className={adminSection === "requests" ? "admin-license-tab active" : "admin-license-tab"} onClick={() => setAdminSection("requests")}>Renovaciones</button>
        <button type="button" role="tab" aria-selected={adminSection === "assign"} className={adminSection === "assign" ? "admin-license-tab active" : "admin-license-tab"} onClick={() => setAdminSection("assign")}>Asignar licencia</button>
      </div>
      {error && <p role="alert" className="photo-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {adminSection === "plans" && <div className="license-admin-section"><h4>Planes y precios (CUP)</h4>
        {plans.map((p, i) => <div className="license-admin-plan" key={p.code}>
          <b>{p.label}</b>
          <label>Duración (días)<input type="number" min="1" max="3650" step="1" value={p.duration_days} onChange={e => setPlans(old => old.map((x, j) => i === j ? { ...x, duration_days: Math.max(1, Math.min(3650, Math.floor(Number(e.target.value || 1)))) } : x))}/></label>
          <label>Precio (CUP)<input type="number" min="1" step="0.01" value={p.price_cents / 100} onChange={e => setPlans(old => old.map((x, j) => i === j ? { ...x, price_cents: Math.round(Number(e.target.value || 0) * 100) } : x))}/></label>
          <label className="license-admin-check"><input type="checkbox" checked={p.active} onChange={e => setPlans(old => old.map((x, j) => i === j ? { ...x, active: e.target.checked } : x))}/> Disponible para renovación</label>
        </div>)}
        <button className="provider-primary" disabled={busy} onClick={() => void savePlans()}>Guardar precios</button>
      </div>}
      {adminSection === "methods" && <div className="license-admin-section"><h4>Métodos de pago</h4>
        {methods.map((m, i) => <div className="license-admin-method" key={m.code}><label>Nombre<input value={m.label} onChange={e => setMethods(old => old.map((x,j) => i===j ? {...x,label:e.target.value} : x))}/></label><label className="license-admin-check"><input type="checkbox" checked={m.active} onChange={e => setMethods(old => old.map((x,j) => i===j ? {...x,active:e.target.checked} : x))}/> Activo</label><button className="provider-secondary" disabled={busy} onClick={() => setMethods(old => old.filter((_,j) => j!==i))}>Quitar</button></div>)}
        <div className="license-admin-method"><label>Código<input value={newMethod.code} onChange={e => setNewMethod(x=>({...x,code:e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,"_")}))} placeholder="transferencia"/></label><label>Nombre visible<input value={newMethod.label} onChange={e => setNewMethod(x=>({...x,label:e.target.value}))} placeholder="Transferencia bancaria"/></label><button className="provider-secondary" onClick={() => { if (!newMethod.code.trim() || !newMethod.label.trim() || methods.some(m=>m.code===newMethod.code)) { setError("Completa un código único y un nombre."); return; } setMethods(old=>[...old,{...newMethod,active:true}]); setNewMethod({code:"",label:""}); setError(""); }}>Añadir</button></div>
        <button className="provider-primary" disabled={busy} onClick={() => void saveMethods()}>Guardar métodos de pago</button>
      </div>}
      {adminSection === "requests" && <div className="license-admin-section"><h4>Solicitudes de renovación</h4>
        {requests.length===0 ? <p>No hay solicitudes todavía.</p> : requests.map(r => <article className="license-admin-request" key={r.id}>
          <b>{providers.find(p=>p.id===r.provider_id)?.business_name ?? "Estudio"} · {r.plan_label}</b><small>{cash(r.amount_cents,r.currency)} · {r.duration_days} días · {new Date(r.created_at).toLocaleString("es-CU")}</small><small>Método: {r.payment_method} · Referencia: {r.payment_reference || "No indicada"}</small><span className={"trial-pill license-status-"+r.status}>{r.status==="pending"?"Pendiente":r.status==="approved"?"Aprobada":"Rechazada"}</span>
          {r.status==="pending" && <><label>Nota (opcional)<input value={notes[r.id] ?? ""} maxLength={300} onChange={e=>setNotes(old=>({...old,[r.id]:e.target.value}))} placeholder="Motivo o comprobación"/></label><div className="license-admin-actions"><button className="provider-primary" disabled={busy} onClick={()=>void processRequest(r,true)}>Confirmar pago y renovar</button><button className="provider-secondary" disabled={busy} onClick={()=>void processRequest(r,false)}>Rechazar</button></div></>}
          {r.admin_note && <small>Nota del administrador: {r.admin_note}</small>}
        </article>)}
      </div>}
      {adminSection === "assign" && <div className="license-admin-section"><h4>Asignar o modificar una licencia</h4>
        <label>Estudio<select value={selectedProvider} onChange={e=>setSelectedProvider(e.target.value)}><option value="">Seleccionar estudio…</option>{providers.map(p=><option key={p.id} value={p.id}>{p.business_name} · {p.license_status} · vence {date(p.license_expires_at)}</option>)}</select></label>
        <label>Estado<select value={licenseStatus} onChange={e=>setLicenseStatus(e.target.value)}><option value="active">Activa</option><option value="grace">Gracia</option><option value="suspended">Suspendida</option><option value="expired">Vencida</option></select></label>
        {(licenseStatus==="active"||licenseStatus==="grace") && <label>Vence el<input type="date" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}/></label>}
        <button className="provider-primary" disabled={busy||!selectedProvider} onClick={()=>void saveProviderLicense()}>Guardar licencia</button>
      </div>}
      <button className="provider-secondary" disabled={busy} onClick={()=>void run(async()=>{}, "Datos actualizados.")}>Actualizar datos</button>
    </div>
  </section>;
}
