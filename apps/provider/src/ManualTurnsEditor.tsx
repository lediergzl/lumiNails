import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMyTurn, deleteMyTurn, listMyTurns, updateMyTurn,
  createMyWeeklyTurn, deleteMyWeeklyTurn, listMyWeeklyTurns, updateMyWeeklyTurn,
  isMyTurnDayOverride, setMyTurnDayOverride,
  type ProviderAppointment, type ProviderTurn, type WeeklyProviderTurn,
} from "@lumi/api";

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const addDays = (date: Date, amount: number) => { const copy = new Date(date); copy.setDate(copy.getDate()+amount); return localDate(copy); };
const hhmm = (value: string) => value.slice(0,5);
const weekdayFor = (day: string) => { const d = new Date(day + "T12:00:00").getDay(); return d === 0 ? 7 : d; };
const localDateTime = (iso: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

type Props = { providerId: string; appointments: ProviderAppointment[]; timezone: string };
type Mode = "general" | "day";

export default function ManualTurnsEditor({ providerId, appointments, timezone }: Props) {
  const [mode, setMode] = useState<Mode>("general");
  const [day, setDay] = useState(localDate(new Date()));
  const [weekday, setWeekday] = useState(weekdayFor(localDate(new Date())));
  const [turns, setTurns] = useState<ProviderTurn[]>([]);
  const [weeklyTurns, setWeeklyTurns] = useState<WeeklyProviderTurn[]>([]);
  const [override, setOverride] = useState(false);
  const [time, setTime] = useState("09:00");
  const [buffer, setBuffer] = useState("15");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("09:00");
  const [editBuffer, setEditBuffer] = useState("15");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{kind:"ok"|"error";text:string}|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "general") {
        setWeeklyTurns(await listMyWeeklyTurns(providerId, weekday));
      } else {
        const isOverride = await isMyTurnDayOverride(providerId, day);
        setOverride(isOverride);
        if (isOverride) {
          setTurns(await listMyTurns(providerId, day, day));
          setWeeklyTurns([]);
        } else {
          setWeeklyTurns(await listMyWeeklyTurns(providerId, weekdayFor(day)));
          setTurns([]);
        }
      }
    } catch (e) {
      setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudieron cargar los turnos."});
    } finally { setLoading(false); }
  }, [providerId, mode, weekday, day]);
  useEffect(() => { void load(); }, [load]);

  const appointmentAt = (turn: ProviderTurn) => appointments.filter(a =>
    localDateTime(a.starts_at, timezone) === `${turn.turn_date}T${hhmm(turn.start_time)}`
  );
  const activeAppointmentAt = (turn: ProviderTurn) => appointmentAt(turn).some(a =>
    a.status === "pending_confirmation" || a.status === "confirmed"
  );

  const add = async () => {
    setSaving(true); setMessage(null);
    try {
      if (mode === "general") {
        await createMyWeeklyTurn({providerId,weekday,startTime:time,bufferAfterMinutes:Number(buffer)});
      } else {
        if (!override) throw new Error("Personaliza este día antes de agregar un turno.");
        await createMyTurn({providerId,day,startTime:time,bufferAfterMinutes:Number(buffer)});
      }
      await load();
      setMessage({kind:"ok",text:mode==="general"?"Turno general guardado. Se aplicará automáticamente a todos los días de la semana seleccionada, salvo fechas personalizadas.":"Turno agregado para esta fecha."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo agregar el turno."}); }
    finally { setSaving(false); }
  };

  const beginEdit = (turn: ProviderTurn | WeeklyProviderTurn) => {
    setEditing(turn.id); setEditTime(hhmm(turn.start_time)); setEditBuffer(String(turn.buffer_after_minutes));
  };
  const saveEdit = async (turn: ProviderTurn | WeeklyProviderTurn) => {
    setSaving(true); setMessage(null);
    try {
      if (mode === "general") {
        await updateMyWeeklyTurn(turn.id,{providerId,weekday,startTime:editTime,bufferAfterMinutes:Number(editBuffer)});
      } else {
        await updateMyTurn(turn.id,{providerId,day,startTime:editTime,bufferAfterMinutes:Number(editBuffer)});
      }
      setEditing(null); await load(); setMessage({kind:"ok",text:"Turno actualizado."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo actualizar el turno."}); }
    finally { setSaving(false); }
  };
  const remove = async (turn: ProviderTurn | WeeklyProviderTurn) => {
    if (!window.confirm(`¿Eliminar el turno de las ${hhmm(turn.start_time)}?`)) return;
    setSaving(true); setMessage(null);
    try {
      if (mode === "general") await deleteMyWeeklyTurn(turn.id,providerId);
      else await deleteMyTurn(turn.id,providerId);
      await load(); setMessage({kind:"ok",text:"Turno eliminado."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo eliminar el turno."}); }
    finally { setSaving(false); }
  };

  const toggleOverride = async (enabled: boolean) => {
    setSaving(true); setMessage(null);
    try {
      await setMyTurnDayOverride(day,enabled);
      await load();
      setMessage({kind:"ok",text:enabled?"Día personalizado. Se copiaron los turnos generales para que puedas ajustarlos sin afectar otros días.":"Se quitó la personalización; este día vuelve a seguir el horario general."});
    } catch(e) { setMessage({kind:"error",text:e instanceof Error?e.message:"No se pudo cambiar la configuración del día."}); }
    finally { setSaving(false); }
  };

  const displayedTurns = useMemo(() => mode === "general" ? weeklyTurns : override ? turns : weeklyTurns, [mode, weeklyTurns, override, turns]);

  return <section className="schedule-card manual-turns-card" aria-labelledby="manual-turns-title">
    <h3 id="manual-turns-title">Turnos y horarios de reserva</h3>
    <p>Define una plantilla general por día de la semana. Se repetirá automáticamente en las fechas futuras. Si necesitas cambiar una sola fecha, personalízala: los demás días no se modificarán.</p>
    <div className="block-form">
      <label>Tipo de horario
        <select value={mode} onChange={e=>{setMode(e.target.value as Mode);setEditing(null);setMessage(null);}}>
          <option value="general">Horario general semanal</option>
          <option value="day">Personalizar una fecha</option>
        </select>
      </label>
      {mode==="general" ? <label>Día de la semana
        <select value={weekday} onChange={e=>{setWeekday(Number(e.target.value));setEditing(null);setMessage(null);}}>
          {DAY_NAMES.slice(1).map((name,index)=><option key={name} value={index+1}>{name}</option>)}
        </select>
      </label> : <label className="date-filter">Fecha
        <input type="date" min={localDate(new Date())} max={addDays(new Date(),90)} value={day} onChange={e=>{setDay(e.target.value);setEditing(null);setMessage(null);}} />
      </label>}
    </div>

    {mode==="day" && !loading && <div className="schedule-banner" role="note">
      {override ? <><b>Fecha personalizada</b><p>Los turnos de esta fecha son independientes del horario general.</p><button type="button" className="provider-secondary" disabled={saving} onClick={()=>void toggleOverride(false)}>Volver al horario general</button></>
      : <><b>Esta fecha sigue el horario general del {DAY_NAMES[weekdayFor(day)].toLowerCase()}.</b><p>Para cambiar solo este día, crea una personalización. Se copiarán los turnos generales actuales y podrás editarlos sin alterar otras fechas.</p><button type="button" className="provider-primary" disabled={saving} onClick={()=>void toggleOverride(true)}>Personalizar este día</button></>}
    </div>}

    {(mode==="general" || override) && <div className="manual-turn-add">
      <label>Hora de inicio<input type="time" step={60} value={time} onChange={e=>setTime(e.target.value)} /></label>
      <label>Margen después del servicio (min)<input type="number" min="0" max="180" step="5" value={buffer} onChange={e=>setBuffer(e.target.value)} /></label>
      <button type="button" className="provider-primary" disabled={saving||!time||!Number.isInteger(Number(buffer))||Number(buffer)<0||Number(buffer)>180||(mode==="day"&&day<localDate(new Date()))} onClick={()=>void add()}>＋ Agregar turno</button>
    </div>}
    <p className="schedule-hint">El margen se aplica después de la duración del servicio. Los turnos solo se ofrecerán si el servicio cabe antes del siguiente turno y no hay citas ni bloqueos que se solapen.</p>
    {loading ? <p className="schedule-hint">Cargando turnos…</p> : displayedTurns.length===0 ?
      <div className="provider-empty"><span>◷</span><b>{mode==="day"&&!override?"No hay turnos generales definidos para este día de la semana":"No has definido turnos para esta selección"}</b><p>{mode==="day"&&!override?"Define turnos en Horario general semanal o personaliza esta fecha.":"Agrega las horas exactas a las que estás dispuesta a recibir clientas."}</p></div> :
      <div className="manual-turn-list">{displayedTurns.map(turn=>{
        const isWeekly = mode==="general" || !override;
        const booked = !isWeekly && activeAppointmentAt(turn as ProviderTurn).length>0;
        const hasHistory = !isWeekly && appointmentAt(turn as ProviderTurn).length>0;
        return <article className="manual-turn-row" key={turn.id}>
          {editing===turn.id ? <div className="manual-turn-edit">
            <label>Hora<input type="time" step={60} value={editTime} onChange={e=>setEditTime(e.target.value)} /></label>
            <label>Margen (min)<input type="number" min="0" max="180" step="5" value={editBuffer} onChange={e=>setEditBuffer(e.target.value)} /></label>
            <button className="provider-primary" disabled={saving||!editTime||!Number.isInteger(Number(editBuffer))||Number(editBuffer)<0||Number(editBuffer)>180} onClick={()=>void saveEdit(turn)}>Guardar</button>
            <button className="provider-secondary" disabled={saving} onClick={()=>setEditing(null)}>Cancelar</button>
          </div> : <>
            <div className="manual-turn-time"><b>{hhmm(turn.start_time)}</b><span>{isWeekly?"Se repite cada "+DAY_NAMES[weekday].toLowerCase():booked?"Cita pendiente o confirmada":hasHistory?"Conservado por historial de citas":"Turno de esta fecha"}</span></div>
            <div className="manual-turn-meta"><span>Margen: {turn.buffer_after_minutes} min</span><span className={booked||hasHistory?"turn-booked":"turn-available"}>{booked?"Ocupado":hasHistory?"Historial":isWeekly?"General":"Personalizado"}</span></div>
            <div className="manual-turn-actions"><button className="provider-secondary" disabled={saving||booked||hasHistory} onClick={()=>beginEdit(turn)}>Editar</button><button className="provider-secondary" disabled={saving||booked||hasHistory} onClick={()=>void remove(turn)}>Eliminar</button></div>
          </>}
        </article>;
      })}</div>}
    {message&&<p className={message.kind==="ok"?"schedule-status":"schedule-status error"} role={message.kind==="ok"?"status":"alert"}>{message.text}</p>}
  </section>;
}
