import { useCallback, useEffect, useState } from "react";
import {
  blockDay,
  getMyWeeklySchedule,
  getMyDailyAppointmentLimit,
  saveMyDailyAppointmentLimit,
  listMyDayBlocks,
  saveMyWeeklySchedule,
  setProviderAppointmentStatus,
  unblockDay,
  type DayBlock,
  type ProviderAppointment,
  type WeeklyWindow,
} from "@lumi/api";

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const LIVE = new Set(["pending_confirmation", "confirmed"]);

type Row = { on: boolean; start: string; end: string; extras: WeeklyWindow[] };
type Rows = Record<number, Row>;

const DEFAULT_ROWS: Rows = Object.fromEntries(
  WEEKDAYS.map(d => [d, { on: d <= 5, start: "09:00", end: "17:00", extras: [] }])
) as Rows;

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rowsFromWindows(windows: WeeklyWindow[]): Rows {
  const rows = Object.fromEntries(
    WEEKDAYS.map(d => [d, { on: false, start: "09:00", end: "17:00", extras: [] as WeeklyWindow[] }])
  ) as Rows;
  for (const w of windows) {
    const row = rows[w.weekday];
    if (!row) continue;
    if (!row.on) { row.on = true; row.start = w.start; row.end = w.end; }
    else row.extras.push(w); // más de un tramo en el día: se conservan al guardar
  }
  return rows;
}

const rowError = (row: Row) =>
  row.on && (!row.start || !row.end || row.end <= row.start)
    ? "La hora de fin debe ser posterior a la de inicio."
    : "";

const blockLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CU", { weekday: "long", day: "numeric", month: "long" });

const liveInRange = (appointments: ProviderAppointment[], startIso: string, endIso: string) =>
  appointments.filter(a => LIVE.has(a.status) && a.starts_at < endIso && a.ends_at > startIso).length;

type Props = { providerId: string; appointments: ProviderAppointment[]; timezone: string; legacyScheduleHidden?: boolean };

export default function ScheduleEditor({ providerId, appointments, timezone, legacyScheduleHidden = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Rows>(DEFAULT_ROWS);
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [blockDate, setBlockDate] = useState("");
  const [pendingBlockDate, setPendingBlockDate] = useState("");
  const [reviewedAppointmentIds, setReviewedAppointmentIds] = useState<string[]>([]);
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [dailyLimit, setDailyLimit] = useState(8);
  const [limitDraft, setLimitDraft] = useState("8");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [windows, blockRows, limit] = await Promise.all([legacyScheduleHidden ? Promise.resolve([] as WeeklyWindow[]) : getMyWeeklySchedule(), listMyDayBlocks(providerId), getMyDailyAppointmentLimit(providerId)]);
      setIsNew(windows.length === 0);
      setRows(windows.length === 0 ? DEFAULT_ROWS : rowsFromWindows(windows));
      setBlocks(blockRows);
      setDailyLimit(limit);
      setLimitDraft(String(limit));
      setDirty(false);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo cargar tu horario." });
    } finally {
      setLoading(false);
    }
  }, [providerId, legacyScheduleHidden]);

  useEffect(() => { void load(); }, [load]);

  const update = (day: number, patch: Partial<Row>) => {
    setRows(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }));
    setDirty(true);
    setMessage(null);
  };

  const copyToActive = () => {
    const first = WEEKDAYS.map(d => rows[d]).find(r => r.on);
    if (!first) return;
    setRows(prev => Object.fromEntries(
      WEEKDAYS.map(d => [d, prev[d].on ? { ...prev[d], start: first.start, end: first.end } : prev[d]])
    ) as Rows);
    setDirty(true);
    setMessage(null);
  };

  const hasErrors = WEEKDAYS.some(d => rowError(rows[d]));

  const save = async () => {
    if (hasErrors) return;
    setSaving(true);
    setMessage(null);
    try {
      const windows: WeeklyWindow[] = WEEKDAYS.flatMap(d => {
        const r = rows[d];
        return r.on ? [{ weekday: d, start: r.start, end: r.end }, ...r.extras] : [];
      });
      await saveMyWeeklySchedule(windows);
      setIsNew(false);
      setDirty(false);
      setMessage({
        kind: "ok",
        text: windows.length === 0
          ? "Horario guardado. Sin días activos, nadie podrá reservar contigo."
          : "Horario guardado. Ya se pueden reservar citas en estos horarios.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo guardar el horario." });
    } finally {
      setSaving(false);
    }
  };

  const appointmentsForPendingBlock = pendingBlockDate
    ? appointments.filter(a => LIVE.has(a.status) &&
        new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(a.starts_at)) === pendingBlockDate)
    : [];

  const addBlock = () => {
    if (!blockDate) return;
    setPendingBlockDate(blockDate);
    setReviewedAppointmentIds([]);
    setCancelReasons({});
    setMessage(null);
  };

  const reviewAppointment = async (appointment: ProviderAppointment, action: "keep" | "cancel") => {
    if (action === "keep") {
      setReviewedAppointmentIds(prev => prev.includes(appointment.id) ? prev : [...prev, appointment.id]);
      return;
    }
    const reason = (cancelReasons[appointment.id] ?? "").trim();
    if (!reason) { setMessage({ kind: "error", text: "Escribe el motivo para informar a la clienta." }); return; }
    setSaving(true); setMessage(null);
    try {
      const nextStatus = appointment.status === "pending_confirmation" ? "rejected" : "cancelled";
      await setProviderAppointmentStatus(appointment.id, nextStatus, reason);
      setReviewedAppointmentIds(prev => prev.includes(appointment.id) ? prev : [...prev, appointment.id]);
      setMessage({ kind: "ok", text: "Cita actualizada. El motivo quedará visible para la clienta en Mis citas." });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo gestionar la cita." }); }
    finally { setSaving(false); }
  };

  const confirmBlock = async () => {
    if (!pendingBlockDate) return;
    const unresolved = appointmentsForPendingBlock.filter(a => !reviewedAppointmentIds.includes(a.id));
    if (unresolved.length) { setMessage({ kind: "error", text: `Revisa las ${unresolved.length} citas pendientes antes de bloquear el día.` }); return; }
    setSaving(true); setMessage(null);
    try {
      await blockDay(pendingBlockDate);
      setBlocks(await listMyDayBlocks(providerId));
      setBlockDate(""); setPendingBlockDate("");
      setMessage({ kind: "ok", text: "Día bloqueado. Las citas afectadas fueron revisadas y las cancelaciones incluyen el motivo para la clienta." });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo bloquear el día." }); }
    finally { setSaving(false); }
  };

  const saveLimit = async () => {
    const limit = Number(limitDraft);
    setSaving(true); setMessage(null);
    try {
      await saveMyDailyAppointmentLimit(providerId, limit);
      setDailyLimit(limit); setLimitDraft(String(limit));
      setMessage({ kind: "ok", text: `Límite diario guardado: máximo ${limit} citas por día.` });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo guardar el límite diario." }); }
    finally { setSaving(false); }
  };
  const removeBlock = async (id: string) => {
    setSaving(true);
    setMessage(null);
    try {
      await unblockDay(id);
      setBlocks(prev => prev.filter(b => b.id !== id));
      setMessage({ kind: "ok", text: "Bloqueo quitado. Ese día vuelve a estar disponible." });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo quitar el bloqueo." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="schedule-card" aria-labelledby="schedule-title">
      {!legacyScheduleHidden && <><h3 id="schedule-title">Horario semanal antiguo</h3><p>Este horario ya no genera turnos reservables. La disponibilidad nueva se define en «Turnos individuales».</p></>}
      <div className="block-form">
        <label className="date-filter">Máximo de citas por día
          <input type="number" min="1" max="50" step="1" value={limitDraft} onChange={e => setLimitDraft(e.target.value)} />
        </label>
        <button type="button" className="provider-secondary" disabled={saving || !/^([1-9]|[1-4][0-9]|50)$/.test(limitDraft) || Number(limitDraft) === dailyLimit} onClick={() => void saveLimit()}>Guardar límite</button>
      </div>
      <p className="schedule-hint">Actualmente: máximo {dailyLimit} citas pendientes o confirmadas al día.</p>

      {loading ? <p className="schedule-hint">Cargando tu horario…</p> : <>
        {!legacyScheduleHidden && isNew && (
          <p className="schedule-banner" role="note">
            Aún no has guardado tu horario: mientras tanto, nadie puede reservar contigo. Revisa los días y pulsa «Guardar horario».
          </p>
        )}

        {!legacyScheduleHidden && <div className="schedule-rows">
          {WEEKDAYS.map(d => {
            const row = rows[d];
            const error = rowError(row);
            return (
              <div className="schedule-row" key={d}>
                <label className="schedule-day">
                  <input type="checkbox" checked={row.on} onChange={e => update(d, { on: e.target.checked })} />
                  {DAY_NAMES[d]}
                </label>
                {row.on ? (
                  <div className="schedule-times">
                    <input type="time" step={1800} value={row.start} aria-label={`${DAY_NAMES[d]}: hora de inicio`}
                      onChange={e => update(d, { start: e.target.value })} />
                    <span aria-hidden="true">a</span>
                    <input type="time" step={1800} value={row.end} aria-label={`${DAY_NAMES[d]}: hora de fin`}
                      onChange={e => update(d, { end: e.target.value })} />
                    {row.extras.length > 0 && (
                      <span className="schedule-extra">
                        y {row.extras.map(x => `${x.start}–${x.end}`).join(", ")}
                      </span>
                    )}
                    {error && <span className="schedule-error" role="alert">{error}</span>}
                  </div>
                ) : <span className="schedule-off">Cerrado</span>}
              </div>
            );
          })}
        </div>}

        {!legacyScheduleHidden && <div className="schedule-actions">
          <button type="button" className="provider-primary" disabled={saving || hasErrors || (!dirty && !isNew)} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar horario"}
          </button>
          <button type="button" className="provider-secondary" disabled={saving || !WEEKDAYS.some(d => rows[d].on)} onClick={copyToActive}>
            Copiar el primer día a los demás activos
          </button>
        </div>}

        <h4 className="schedule-subtitle">Días bloqueados</h4>
        <p className="schedule-hint">Vacaciones, festivos o emergencias. Antes de completar el bloqueo tendrás que revisar cada cita afectada y decidir si la mantienes o la cancelas.</p>
        <div className="block-form">
          <label className="date-filter">Fecha
            <input type="date" min={localDate(new Date())} value={blockDate} onChange={e => setBlockDate(e.target.value)} />
          </label>
          <button type="button" className="provider-secondary" disabled={saving || !blockDate} onClick={() => void addBlock()}>
            Bloquear día
          </button>
        </div>
        {pendingBlockDate && <div className="schedule-banner" role="region" aria-label="Revisión de citas antes de bloquear">
          <h4>Revisar citas del {new Date(pendingBlockDate + "T12:00:00").toLocaleDateString("es-CU", { weekday: "long", day: "numeric", month: "long" })}</h4>
          {appointmentsForPendingBlock.length === 0 ? <p>No hay citas pendientes ni confirmadas ese día.</p> :
            <ul className="block-list">{appointmentsForPendingBlock.map(a => <li key={a.id} style={{ display: "block", padding: "12px 0" }}>
              <b>{new Date(a.starts_at).toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit", timeZone: timezone })} · {a.client_display_name || "Clienta"} · {a.client_service_name}</b>
              <p>{a.client_phone ? <a href={"tel:" + a.client_phone}>{a.client_phone}</a> : "La clienta no ha indicado teléfono"} · {a.status === "confirmed" ? "Confirmada" : "Pendiente de confirmar"}</p>
              {reviewedAppointmentIds.includes(a.id) ? <span className="schedule-status">Revisada</span> : <>
                <label className="field-label">Motivo (si vas a cancelar o rechazar)
                  <input value={cancelReasons[a.id] ?? ""} onChange={e => setCancelReasons(prev => ({ ...prev, [a.id]: e.target.value }))} placeholder="Ej. enfermedad, emergencia…" />
                </label>
                <div className="schedule-actions">
                  <button type="button" className="provider-secondary" disabled={saving} onClick={() => void reviewAppointment(a, "keep")}>Mantener cita</button>
                  <button type="button" className="provider-secondary" disabled={saving || !(cancelReasons[a.id] ?? "").trim()} onClick={() => void reviewAppointment(a, "cancel")}>{a.status === "confirmed" ? "Cancelar e informar" : "Rechazar e informar"}</button>
                </div>
              </>}
            </li>)}</ul>}
          <div className="schedule-actions">
            <button type="button" className="provider-primary" disabled={saving || appointmentsForPendingBlock.some(a => !reviewedAppointmentIds.includes(a.id))} onClick={() => void confirmBlock()}>{saving ? "Procesando…" : "Completar bloqueo"}</button>
            <button type="button" className="provider-secondary" disabled={saving} onClick={() => setPendingBlockDate("")}>No bloquear</button>
          </div>
        </div>}
        {blocks.length === 0 ? <p className="schedule-hint">No tienes días bloqueados.</p> : (
          <ul className="block-list">
            {blocks.map(b => {
              const n = liveInRange(appointments, b.starts_at, b.ends_at);
              return (
                <li key={b.id}>
                  <span>
                    {blockLabel(b.starts_at)}
                    {n > 0 && <span className="block-warning">⚠ {n} {n === 1 ? "cita ya reservada" : "citas ya reservadas"} ese día</span>}
                  </span>
                  <button type="button" className="provider-secondary" disabled={saving} onClick={() => void removeBlock(b.id)}>Quitar</button>
                </li>
              );
            })}
          </ul>
        )}

        {message && <p className={message.kind === "ok" ? "schedule-status" : "schedule-status error"} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
      </>}
    </section>
  );
}
