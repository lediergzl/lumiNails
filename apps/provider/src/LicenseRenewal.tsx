import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@lumi/api";

type LicensePlan = {
  code: "monthly" | "quarterly" | "annual";
  label: string;
  duration_days: number;
  price_cents: number;
  currency: string;
  active: boolean;
};
type PaymentMethod = { code: string; label: string; active: boolean };
type LicenseRequest = {
  id: string;
  plan_label: string;
  duration_days: number;
  amount_cents: number;
  currency: string;
  payment_method: string;
  payment_reference: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string;
  created_at: string;
  processed_at: string | null;
};

const statusLabel: Record<LicenseRequest["status"], string> = {
  pending: "Pendiente de verificación",
  approved: "Aprobada",
  rejected: "Rechazada",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(cents / 100) + " " + currency;
}

export default function LicenseRenewal({ providerId }: { providerId: string }) {
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configured, setConfigured] = useState(true);

  const refresh = useCallback(async () => {
    const db = getSupabaseClient();
    const [planResult, methodResult, requestResult] = await Promise.all([
      db.from("app_settings").select("value").eq("key", "license_prices").maybeSingle(),
      db.from("app_settings").select("value").eq("key", "payment_methods").maybeSingle(),
      db.from("license_payment_requests")
        .select("id,plan_label,duration_days,amount_cents,currency,payment_method,payment_reference,status,admin_note,created_at,processed_at")
        .eq("provider_id", providerId).order("created_at", { ascending: false }).limit(10),
    ]);
    const firstError = planResult.error ?? methodResult.error ?? requestResult.error;
    if (firstError) throw new Error(firstError.message);
    const allPlans = Array.isArray(planResult.data?.value) ? planResult.data.value as LicensePlan[] : [];
    const allMethods = Array.isArray(methodResult.data?.value)
      ? (methodResult.data.value as Array<string | PaymentMethod>).map(m => typeof m === "string" ? { code: m, label: m, active: true } : m)
      : [];
    const validPlans = allPlans.filter(p => p.active && Number.isInteger(Number(p.duration_days)) && Number(p.duration_days) >= 1 && Number(p.duration_days) <= 3650 && Number(p.price_cents) > 0);
    const validMethods = allMethods.filter(m => m.active !== false && m.code && m.label);
    setPlans(validPlans);
    setMethods(validMethods);
    setRequests((requestResult.data ?? []) as LicenseRequest[]);
    setPlanCode(current => validPlans.some(p => p.code === current) ? current : validPlans[0]?.code ?? "");
    setMethodCode(current => validMethods.some(m => m.code === current) ? current : validMethods[0]?.code ?? "");
    setConfigured(true);
  }, [providerId]);

  useEffect(() => {
    void refresh().catch(e => {
      setConfigured(false);
      setError(e instanceof Error ? e.message : "No se pudo cargar la configuración de licencias.");
    });
  }, [refresh]);

  const submit = async () => {
    if (!planCode || !methodCode) {
      setError("Todavía no hay planes con precio y métodos de pago configurados.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: rpcError } = await getSupabaseClient().rpc("luni_request_license", {
        p_provider_id: providerId,
        p_plan_code: planCode,
        p_payment_method: methodCode,
        p_payment_reference: reference.trim() || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.id) throw new Error("Supabase no confirmó la creación de la solicitud.");
      setReference("");
      setNotice("Solicitud registrada. La licencia no cambia hasta que el administrador verifique el pago.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="settings-card license-renewal-card">
    <div className="settings-icon" aria-hidden="true">♧</div>
    <div className="license-renewal-content">
      <span className="eyebrow">LICENCIA DEL ESTUDIO</span>
      <h3>Renovar mi licencia</h3>
      <p>Selecciona un período y el método de pago. Tu licencia se renueva después de que el administrador confirme el pago.</p>
      {!configured && <p role="alert" className="photo-error">No se pudo cargar la configuración. Comprueba que aplicaste la migración de licencias en Supabase. {error}</p>}
      {configured && plans.length === 0 && <p>No hay planes disponibles todavía. El administrador debe configurar los precios reales en Supabase.</p>}
      {configured && methods.length === 0 && <p>No hay métodos de pago configurados todavía. El administrador debe habilitar al menos uno en Supabase.</p>}
      {plans.length > 0 && methods.length > 0 && <div className="license-renewal-form">
        <label>Período de licencia
          <select value={planCode} onChange={e => setPlanCode(e.target.value)}>
            {plans.map(plan => <option key={plan.code} value={plan.code}>{plan.label} · {plan.duration_days} días · {money(plan.price_cents, plan.currency)}</option>)}
          </select>
        </label>
        <label>Método de pago
          <select value={methodCode} onChange={e => setMethodCode(e.target.value)}>
            {methods.map(method => <option key={method.code} value={method.code}>{method.label}</option>)}
          </select>
        </label>
        <label>Referencia o comprobante (opcional)
          <input maxLength={160} value={reference} onChange={e => setReference(e.target.value)} placeholder="Número de operación, referencia…" />
        </label>
        <button className="provider-primary" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Enviando solicitud…" : "Solicitar renovación"}</button>
      </div>}
      {notice && <p role="status">{notice}</p>}
      {error && configured && <p role="alert" className="photo-error">{error}</p>}
      <div className="license-request-history">
        <h4>Mis solicitudes recientes</h4>
        {requests.length === 0 ? <p>Aún no has solicitado una renovación.</p> : requests.map(request => <article key={request.id} className="license-request-row">
          <div><b>{request.plan_label} · {request.duration_days} días</b><small>{new Date(request.created_at).toLocaleString("es-CU")}</small><small>{money(request.amount_cents, request.currency)} · {request.payment_method}</small></div>
          <span className={"trial-pill license-status-" + request.status}>{statusLabel[request.status]}</span>
          {request.status === "rejected" && request.admin_note && <small>Nota: {request.admin_note}</small>}
        </article>)}
      </div>
    </div>
  </section>;
}
