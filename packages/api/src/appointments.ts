import { getSupabaseClient } from "./client";
import { registerOutboxHandler, withOfflineCache, writeOrQueue } from "./offline";

export type CreateAppointmentInput = {
  id: string;
  providerId: string;
  serviceId: string;
  startsAt: string;
  idempotencyKey: string;
  notes?: string;
  /** Optional local metadata used only to render a queued offline request. */
  serviceName?: string;
  priceCents?: number;
  currency?: string;
  durationMinutes?: number;
};

export type RemoteAppointment = {
  id: string;
  provider_id: string;
  client_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: "pending_confirmation" | "confirmed" | "cancelled" | "rejected" | "completed";
  notes: string;
  client_service_name: string;
  client_price_cents: number;
  client_currency: string;
  cancellation_reason?: string;
};

async function createAppointmentRemote(
  input: CreateAppointmentInput
): Promise<RemoteAppointment> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_create_appointment", {
      p_id: input.id,
      p_provider_id: input.providerId,
      p_service_id: input.serviceId,
      p_starts_at: input.startsAt,
      p_idempotency_key: input.idempotencyKey,
      p_notes: input.notes ?? "",
    });

  if (error) {
    const knownMessages: Record<string, string> = {
      AUTH_REQUIRED: "Inicia sesión antes de solicitar una cita.",
      CLIENT_PROVIDER_LINK_REQUIRED: "Primero debes añadir esta manicurista a tu cartera desde su invitación personal.",
      INVALID_APPOINTMENT_TIME: "Selecciona una hora con al menos una hora de anticipación.",
      PHONE_REQUIRED: "Añade tu número de teléfono antes de reservar.",
      DAILY_LIMIT_REACHED: "Este estudio ya alcanzó su límite de citas para ese día. Elige otra fecha.",
      INVALID_APPOINTMENT_SLOT: "Ese horario no es válido. Selecciona uno de los turnos que la manicurista configuró.",
      SERVICE_DOES_NOT_FIT_BEFORE_NEXT_TURN: "Ese servicio no cabe antes del siguiente turno. Elige otra hora o un servicio más corto.",
      INVALID_APPOINTMENT_DATE: "La fecha está fuera del período de reservas permitido.",
      SERVICE_NOT_AVAILABLE: "Este servicio ya no está disponible.",
      PROVIDER_NOT_AVAILABLE: "Este estudio no está disponible para reservas.",
      PROVIDER_LICENSE_INACTIVE: "Este estudio no puede aceptar reservas en este momento.",
      OUTSIDE_WORKING_HOURS: "La hora seleccionada está fuera del horario de atención.",
      SLOT_BLOCKED: "Ese horario está bloqueado por el estudio.",
      SLOT_ALREADY_TAKEN: "Otra persona acaba de ocupar ese horario. Elige otro.",
      CLIENT_HAS_ACTIVE_APPOINTMENT: "Ya tienes una cita pendiente o confirmada. Modifica esa cita o cancélala antes de reservar otra.",
    };
    throw new Error(knownMessages[error.message] ?? error.message);
  }

  if (!data) throw new Error("El servidor no devolvió la cita creada.");
  return data as RemoteAppointment;
}

/**
 * Crea una cita online o la deja en la cola offline. Una cita en cola es solo una solicitud local:
 * la disponibilidad y la aprobación definitivas siempre se deciden en el servidor al sincronizar.
 */
export async function createAppointment(
  input: CreateAppointmentInput
): Promise<{ queued: boolean; appointment?: RemoteAppointment }> {
  const duration = Math.max(1, input.durationMinutes ?? 30);
  const startMs = Date.parse(input.startsAt);
  const sessionResult = await getSupabaseClient().auth.getSession().catch(() => null);
  const userId = sessionResult?.data.session?.user.id ?? "";
  const optimistic: RemoteAppointment = {
    id: input.id,
    provider_id: input.providerId,
    client_id: userId,
    service_id: input.serviceId,
    starts_at: input.startsAt,
    ends_at: new Date(startMs + duration * 60_000).toISOString(),
    status: "pending_confirmation",
    notes: input.notes ?? "",
    client_service_name: input.serviceName ?? "Cita pendiente de sincronizar",
    client_price_cents: input.priceCents ?? 0,
    client_currency: input.currency ?? "CUP",
  };
  const outcome = await writeOrQueue(
    {
      type: "appointment.create",
      payload: input,
      label: "Solicitar cita",
      patches: [{
        read: "listMyAppointments",
        op: "upsert",
        id: input.id,
        item: optimistic as unknown as Record<string, unknown>,
      }],
    },
    () => createAppointmentRemote(input)
  );
  return outcome.queued
    ? { queued: true, appointment: optimistic }
    : { queued: false, appointment: outcome.result };
}

registerOutboxHandler("appointment.create", (payload: CreateAppointmentInput) => createAppointmentRemote(payload));

async function listMyAppointmentsRemote(): Promise<RemoteAppointment[]> {
  const { data, error } = await getSupabaseClient()
    .from("appointments")
    .select("id,provider_id,client_id,service_id,starts_at,ends_at,status,notes,client_service_name,client_price_cents,client_currency,cancellation_reason")
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RemoteAppointment[];
}

/** La clienta cancela su propia cita (solo si sigue pendiente o confirmada). */
async function cancelMyAppointmentRemote(appointmentId: string, reason: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from("appointments")
    .update({ status: "cancelled", cancellation_reason: reason.trim() })
    .eq("id", appointmentId)
    .in("status", ["pending_confirmation", "confirmed"])
    .select("id");
  if (error) throw new Error(error.message.includes("APPOINTMENT_STATUS_CHANGE_FORBIDDEN") ? "Esa cita ya no admite este cambio. Actualiza la lista." : error.message);
  if (!data?.length) throw new Error("Esta cita ya no se puede cancelar.");
}

/** Cancela la cita; sin conexión queda en cola y se envía al volver la red (`queued: true`). */
export async function cancelMyAppointment(appointmentId: string, reason = "", label = ""): Promise<{ queued: boolean }> {
  const cleanReason = reason.trim();
  const outcome = await writeOrQueue(
    {
      type: "appointment.cancel_mine",
      payload: { appointmentId, reason: cleanReason },
      label: label || "Cancelar cita",
      patches: [{ read: "listMyAppointments", op: "merge", id: appointmentId, changes: { status: "cancelled", cancellation_reason: cleanReason } }],
    },
    () => cancelMyAppointmentRemote(appointmentId, cleanReason)
  );
  return { queued: outcome.queued };
}

registerOutboxHandler("appointment.cancel_mine", (p: { appointmentId: string; reason: string }) => cancelMyAppointmentRemote(p.appointmentId, p.reason));


async function rescheduleMyAppointmentRemote(appointmentId: string, startsAt: string): Promise<RemoteAppointment> {
  const { data, error } = await getSupabaseClient().rpc("luni_reschedule_appointment", {
    p_appointment_id: appointmentId,
    p_starts_at: startsAt,
  });
  if (error) {
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Inicia sesión antes de modificar una cita.",
      APPOINTMENT_NOT_FOUND: "No encontramos esa cita en tu cuenta.",
      APPOINTMENT_NOT_ACTIVE: "Esta cita ya no está pendiente ni confirmada. Actualiza la lista.",
      INVALID_APPOINTMENT_TIME: "Elige una fecha y hora futura.",
      OUTSIDE_WORKING_HOURS: "La hora seleccionada está fuera del horario de atención.",
      SLOT_BLOCKED: "Ese horario está bloqueado por el estudio.",
      SLOT_ALREADY_TAKEN: "Otra persona acaba de ocupar ese horario. Elige otro.",
      SERVICE_NOT_AVAILABLE: "Este servicio ya no está disponible para modificar la cita.",
      PROVIDER_LICENSE_INACTIVE: "Este estudio no puede aceptar cambios de citas en este momento.",
    };
    throw new Error(messages[error.message] ?? error.message);
  }
  if (!data) throw new Error("El servidor no devolvió la cita modificada.");
  return data as RemoteAppointment;
}

/** Reprograma la misma cita; sin conexión se encola y el horario queda sujeto a validación del servidor. */
export async function rescheduleMyAppointment(
  appointmentId: string,
  startsAt: string
): Promise<{ queued: boolean; appointment?: RemoteAppointment }> {
  const existing = (await listMyAppointments().catch(() => [] as RemoteAppointment[])).find(a => a.id === appointmentId);
  const duration = existing
    ? Math.max(1, (Date.parse(existing.ends_at) - Date.parse(existing.starts_at)) / 60_000)
    : 30;
  const startMs = Date.parse(startsAt);
  const changes = {
    starts_at: startsAt,
    ends_at: new Date(startMs + duration * 60_000).toISOString(),
  };
  const outcome = await writeOrQueue(
    {
      type: "appointment.reschedule_mine",
      payload: { appointmentId, startsAt },
      label: "Modificar fecha y hora de la cita",
      patches: [{ read: "listMyAppointments", op: "merge", id: appointmentId, changes }],
    },
    () => rescheduleMyAppointmentRemote(appointmentId, startsAt)
  );
  return outcome.queued
    ? { queued: true, appointment: existing ? { ...existing, ...changes } : undefined }
    : { queued: false, appointment: outcome.result };
}

registerOutboxHandler("appointment.reschedule_mine", (p: { appointmentId: string; startsAt: string }) =>
  rescheduleMyAppointmentRemote(p.appointmentId, p.startsAt)
);

export const listMyAppointments = withOfflineCache("listMyAppointments", listMyAppointmentsRemote);
