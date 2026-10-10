import { useCallback, useEffect, useState } from "react";
import { createMyTurn, deleteMyTurn, listMyTurns, updateMyTurn, type ProviderAppointment, type ProviderTurn } from "@lumi/api";

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const addDays = (date: Date, amount: number) => { const copy = new Date(date); copy.setDate(copy.getDate()+amount); return localDate(copy); };
const hhmm = (value: string) => value.slice(0,5);
const localDateTime = (iso: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

type Props = { providerId: string; appointments: ProviderAppointment[]; timezone: string };

export default function ManualTurnsEditor({ providerId, appointments, timezone }: Props) {
  const [day, setDay] = useState(localDate(new Date()));
  const [turns, setTurns] = useState<ProviderTurn[]>([]);
  const [time, setTime] = useState("09:00");
  const [buffer, setBuffer] = useState("0");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("09:00");
  const [editBuffer, setEditBuffer] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{kind:"ok"|"error";text:string}|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTurns(await listMyTurns(providerId, day, day)); }
    catch (e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudieron cargar los turnos."}); }
    finally { setLoading(false); }
  }, [providerId,day]);
  useEffect(() => { void load(); }, [load]);

  const activeAppointmentAt = (turn: ProviderTurn) => appointments.some(a =>
    (a.status === "pending_confirmation" || a.status === "confirmed") &&
    localDateTime(a.starts_at, timezone) === `${turn.turn_date}T${hhmm(turn.start_time)}`
  );

  const add = async () => {
    setSaving(true); setMessage(null);
    try {
      await createMyTurn({providerId,day,startTime:time,bufferAfterMinutes:Number(buffer)});
      await load();
      setMessage({kind:"ok",text:"Turno agregado. Solo se ofrecerá a clientas si el servicio cabe antes del siguiente turno."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo agregar el turno."}); }
    finally { setSaving(false); }
  };

  const beginEdit = (turn: ProviderTurn) => {
    setEditing(turn.id); setEditTime(hhmm(turn.start_time)); setEditBuffer(String(turn.buffer_after_minutes));
  };
  const saveEdit = async (turn: ProviderTurn) => {
    setSaving(true); setMessage(null);
    try {
      await updateMyTurn(turn.id,{providerId,day,startTime:editTime,bufferAfterMinutes:Number(editBuffer)});
      setEditing(null); await load(); setMessage({kind:"ok",text:"Turno actualizado."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo actualizar el turno."}); }
    finally { setSaving(false); }
  };
  const remove = async (turn: ProviderTurn) => {
    if (!window.confirm(`¿Eliminar el turno de las ${hhmm(turn.start_time)}?`)) return;
    setSaving(true); setMessage(null);
    try { await deleteMyTurn(turn.id,providerId); await load(); setMessage({kind:"ok",text:"Turno eliminado."}); }
    catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo eliminar el turno."}); }
    finally { setSaving(false); }
  };

  return <section className="schedule-card manual-turns-card" aria-labelledby="manual-turns-title">
    <h3 id="manual-turns-title">Turnos individuales</h3>
    <p>Define cada cita por separado. No se generan horas automáticamente: la duración se calcula a partir del servicio que elija la clienta.</p>
    <div className="block-form">
      <label className="date-filter">Fecha de la agenda
        <input type="date" min={localDate(new Date())} max={addDays(new Date(),90)} value={day} onChange={e=>{setDay(e.target.value);setEditing(null);setMessage(null);}} />
      </label>
      <button type="button" className="provider-secondary" onClick={()=>setDay(localDate(new Date()))}>Hoy</button>
    </div>
    <div className="manual-turn-add">
      <label>Hora de inicio<input type="time" step={60} value={time} onChange={e=>setTime(e.target.value)} /></label>
      <label>Margen después del servicio (min)<input type="number" min="0" max="180" step="5" value={buffer} onChange={e=>setBuffer(e.target.value)} /></label>
      <button type="button" className="provider-primary" disabled={saving||!time||!Number.isInteger(Number(buffer))||Number(buffer)<0||Number(buffer)>180||day<localDate(new Date())} onClick={()=>void add()}>＋ Agregar turno</button>
    </div>
    <p className="schedule-hint">El margen se aplica después de la duración del servicio. Ej.: 90 minutos desde las 09:00 terminan a las 10:30; si el siguiente turno empieza a las 10:30, solo cabe con margen cero.</p>
    {loading ? <p className="schedule-hint">Cargando turnos…</p> : turns.length===0 ?
      <div className="provider-empty"><span>◷</span><b>No has definido turnos para esta fecha</b><p>Agrega las horas exactas a las que estás dispuesta a recibir clientas.</p></div> :
      <div className="manual-turn-list">{turns.map(turn=>{
        const booked=activeAppointmentAt(turn);
        return <article className="manual-turn-row" key={turn.id}>
          {editing===turn.id ? <div className="manual-turn-edit">
            <label>Hora<input type="time" step={60} value={editTime} onChange={e=>setEditTime(e.target.value)} /></label>
            <label>Margen (min)<input type="number" min="0" max="180" step="5" value={editBuffer} onChange={e=>setEditBuffer(e.target.value)} /></label>
            <button className="provider-primary" disabled={saving||!editTime||!Number.isInteger(Number(editBuffer))||Number(editBuffer)<0||Number(editBuffer)>180} onClick={()=>void saveEdit(turn)}>Guardar</button>
            <button className="provider-secondary" disabled={saving} onClick={()=>setEditing(null)}>Cancelar</button>
          </div> : <>
            <div className="manual-turn-time"><b>{hhmm(turn.start_time)}</b><span>{booked?"Cita pendiente o confirmada":"Inicio definido por ti"}</span></div>
            <div className="manual-turn-meta"><span>Margen: {turn.buffer_after_minutes} min</span><span className={booked?"turn-booked":"turn-available"}>{booked?"Ocupado":"Configurado"}</span></div>
            <div className="manual-turn-actions"><button className="provider-secondary" disabled={saving||booked} onClick={()=>beginEdit(turn)}>Editar</button><button className="provider-secondary" disabled={saving||booked} onClick={()=>void remove(turn)}>Eliminar</button></div>
          </>}
        </article>;
      })}</div>}
    {message&&<p className={message.kind==="ok"?"schedule-status":"schedule-status error"} role={message.kind==="ok"?"status":"alert"}>{message.text}</p>}
  </section>;
}
