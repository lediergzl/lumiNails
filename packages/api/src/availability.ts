import { getSupabaseClient } from "./client";

/** Un tramo de atención. weekday sigue ISO: 1 = lunes … 7 = domingo. Horas en "HH:MM" (hora local del estudio). */
export type WeeklyWindow = { weekday: number; start: string; end: string };

/** Un día del calendario de reserva con cuántas horas libres tiene. day es "YYYY-MM-DD". */
export type AvailableDay = { day: string; slots: number };

export type DayBlock = { id: string; starts_at: string; ends_at: string };

const SCHEDULE_ERRORS: Record<string, string> = {
  PROVIDER_REQUIRED: "Registra tu estudio antes de configurar el horario.",
  INVALID_SCHEDULE: "El horario no es válido. Revisa que cada hora de fin sea posterior a la de inicio.",
  OVERLAPPING_WINDOWS: "Hay tramos que se solapan en un mismo día.",
  INVALID_DAY: "Elige una fecha válida.",
};

function fail(error: { message: string }): never {
  throw new Error(SCHEDULE_ERRORS[error.message] ?? error.message);
}

const hhmm = (time: string) => time.slice(0, 5);

/** Días de un rango con su número de horas libres para un servicio (el servidor decide qué es libre). */
export async function listAvailableDays(
  providerId: string,
  serviceId: string,
  fromDay: string,
  days = 14
): Promise<AvailableDay[]> {
  const { data, error } = await getSupabaseClient().rpc("luni_available_days", {
    p_provider_id: providerId,
    p_service_id: serviceId,
    p_from: fromDay,
    p_days: days,
  });
  if (error) fail(error);
  return ((data ?? []) as Array<{ day: string; slots: number }>).map(r => ({ day: r.day, slots: r.slots }));
}

/** Horas de inicio libres (ISO) de un día para un servicio, en orden. */
export async function listAvailableSlots(
  providerId: string,
  serviceId: string,
  day: string
): Promise<string[]> {
  const { data, error } = await getSupabaseClient().rpc("luni_available_slots", {
    p_provider_id: providerId,
    p_service_id: serviceId,
    p_day: day,
  });
  if (error) fail(error);
  return ((data ?? []) as Array<{ starts_at: string }>).map(r => r.starts_at);
}

/** Horario semanal de la manicurista con sesión iniciada (RLS solo devuelve el suyo). */
export async function getMyWeeklySchedule(): Promise<WeeklyWindow[]> {
  const { data, error } = await getSupabaseClient()
    .from("weekly_schedule")
    .select("weekday,start_time,end_time")
    .order("weekday")
    .order("start_time");
  if (error) fail(error);
  return ((data ?? []) as Array<{ weekday: number; start_time: string; end_time: string }>).map(r => ({
    weekday: r.weekday,
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
  }));
}

/** Reemplaza todo el horario semanal de forma atómica. */
export async function saveMyWeeklySchedule(windows: WeeklyWindow[]): Promise<void> {
  const { error } = await getSupabaseClient().rpc("luni_save_weekly_schedule", { p_windows: windows });
  if (error) fail(error);
}

/** Días bloqueados activos que aún no terminaron. */
export async function listMyDayBlocks(providerId: string): Promise<DayBlock[]> {
  const { data, error } = await getSupabaseClient()
    .from("availability")
    .select("id,starts_at,ends_at")
    .eq("provider_id", providerId)
    .eq("kind", "block")
    .eq("status", "active")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at");
  if (error) fail(error);
  return (data ?? []) as DayBlock[];
}

/** Bloquea un día completo ("YYYY-MM-DD", hora local del estudio). */
export async function blockDay(day: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("luni_block_day", { p_day: day });
  if (error) fail(error);
}

export async function unblockDay(blockId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("availability")
    .update({ status: "inactive" })
    .eq("id", blockId)
    .eq("kind", "block");
  if (error) fail(error);
}


/** Límite diario configurable de citas activas para el estudio autenticado. */
export async function getMyDailyAppointmentLimit(providerId: string): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .select("daily_appointment_limit")
    .eq("id", providerId)
    .maybeSingle();
  if (error) fail(error);
  return Number(data?.daily_appointment_limit ?? 8);
}

export async function saveMyDailyAppointmentLimit(providerId: string, limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("El límite diario debe estar entre 1 y 50 citas.");
  }
  const { error } = await getSupabaseClient()
    .from("provider_profiles")
    .update({ daily_appointment_limit: limit })
    .eq("id", providerId);
  if (error) fail(error);
}


/** Turno individual configurado por la manicurista para una fecha concreta. */
export type ProviderTurn = {
  id: string;
  provider_id: string;
  turn_date: string;
  start_time: string;
  buffer_after_minutes: number;
  status: "active" | "inactive";
};

export async function listMyTurns(providerId: string, fromDay: string, toDay: string): Promise<ProviderTurn[]> {
  const { data, error } = await getSupabaseClient()
    .from("provider_turns")
    .select("id,provider_id,turn_date,start_time,buffer_after_minutes,status")
    .eq("provider_id", providerId)
    .eq("status", "active")
    .gte("turn_date", fromDay)
    .lte("turn_date", toDay)
    .order("turn_date")
    .order("start_time");
  if (error) fail(error);
  return (data ?? []) as ProviderTurn[];
}

export async function createMyTurn(input: {
  providerId: string; day: string; startTime: string; bufferAfterMinutes: number;
}): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error("Elige una fecha válida.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) throw new Error("Elige una hora válida.");
  if (!Number.isInteger(input.bufferAfterMinutes) || input.bufferAfterMinutes < 0 || input.bufferAfterMinutes > 180) {
    throw new Error("El margen debe estar entre 0 y 180 minutos.");
  }
  const { error } = await getSupabaseClient().from("provider_turns").insert({
    provider_id: input.providerId, turn_date: input.day, start_time: input.startTime,
    buffer_after_minutes: input.bufferAfterMinutes, status: "active",
  });
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe un turno a esa hora.");
    fail(error);
  }
}

export async function updateMyTurn(id: string, input: {
  providerId: string; day: string; startTime: string; bufferAfterMinutes: number;
}): Promise<void> {
  const { error } = await getSupabaseClient().from("provider_turns").update({
    turn_date: input.day, start_time: input.startTime, buffer_after_minutes: input.bufferAfterMinutes,
  }).eq("id", id).eq("provider_id", input.providerId);
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe un turno a esa hora.");
    if (error.message.includes("TURN_HAS_ACTIVE_APPOINTMENT")) throw new Error("No puedes cambiar ese turno porque tiene una cita pendiente o confirmada.");
    fail(error);
  }
}

export async function deleteMyTurn(id: string, providerId: string): Promise<void> {
  const { error } = await getSupabaseClient().from("provider_turns").delete()
    .eq("id", id).eq("provider_id", providerId);
  if (error) {
    if (error.message.includes("TURN_HAS_ACTIVE_APPOINTMENT")) throw new Error("No puedes eliminar ese turno porque tiene una cita pendiente o confirmada.");
    fail(error);
  }
}
