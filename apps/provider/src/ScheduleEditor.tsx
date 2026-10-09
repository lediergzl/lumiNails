import { useCallback, useEffect, useState } from "react";
import {
  blockDay,
  getMyWeeklySchedule,
  listMyDayBlocks,
  saveMyWeeklySchedule,
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

type Props = { providerId: string; appointments: ProviderAppointment[] };

export default function ScheduleEditor({ providerId, appointments }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Rows>(DEFAULT_ROWS);
  const [isNew, setIsNew] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [blocks, setBlocks] = useState<DayBlock[]>([]);
  const [blockDate, setBlockDate] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [windows, blockRows] = await Promise.all([getMyWeeklySchedule(), listMyDayBlocks(providerId)]);
      setIsNew(windows.length === 0);
      setRows(windows.length === 0 ? DEFAULT_ROWS : rowsFromWindows(windows));
      setBlocks(blockRows);
      setDirty(false);
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo cargar tu horario." });
    } finally {
      setLoading(false);
    }
  }, [providerId]);

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

  const addBlock = async () => {
    if (!blockDate) return;
    setSaving(true);
    setMessage(null);
    try {
      await blockDay(blockDate);
      const start = new Date(`${blockDate}T00:00:00`);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const count = liveInRange(appointments, start.toISOString(), end.toISOString());
      setBlocks(await listMyDayBlocks(providerId));
      setBlockDate("");
      setMessage({
        kind: "ok",
        text: count > 0
          ? `Día bloqueado. Ya tienes ${count} ${count === 1 ? "cita" : "citas"} ese día: no se cancelan solas, revísalas en tu agenda.`
          : "Día bloqueado. Nadie podrá reservar ese día.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "No se pudo bloquear el día." });
    } finally {
      setSaving(false);
    }
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
      <h3 id="schedule-title">Horario de atención</h3>
      <p>Las citas pueden empezar cada 30 minutos dentro de cada tramo. Los clientes solo ven horas libres.</p>

      {loading ? <p className="schedule-hint">Cargando tu horario…</p> : <>
        {isNew && (
          <p className="schedule-banner" role="note">
            Aún no has guardado tu horario: mientras tanto, nadie puede reservar contigo. Revisa los días y pulsa «Guardar horario».
          </p>
        )}

        <div className="schedule-rows">
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
        </div>

        <div className="schedule-actions">
          <button type="button" className="provider-primary" disabled={saving || hasErrors || (!dirty && !isNew)} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar horario"}
          </button>
          <button type="button" className="provider-secondary" disabled={saving || !WEEKDAYS.some(d => rows[d].on)} onClick={copyToActive}>
            Copiar el primer día a los demás activos
          </button>
        </div>

        <h4 className="schedule-subtitle">Días bloqueados</h4>
        <p className="schedule-hint">Vacaciones, festivos o un día libre. Las citas que ya tengas no se cancelan solas.</p>
        <div className="block-form">
          <label className="date-filter">Fecha
            <input type="date" min={localDate(new Date())} value={blockDate} onChange={e => setBlockDate(e.target.value)} />
          </label>
          <button type="button" className="provider-secondary" disabled={saving || !blockDate} onClick={() => void addBlock()}>
            Bloquear día
          </button>
        </div>
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
