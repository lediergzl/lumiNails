import { getSupabaseClient } from "./client";

export type CreateAppointmentInput = {
  id: string;
  providerId: string;
  serviceId: string;
  startsAt: string;
  idempotencyKey: string;
  notes?: string;
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

export async function createAppointment(
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
      INVALID_APPOINTMENT_TIME: "Selecciona una hora con al menos una hora de anticipación.",
      PHONE_REQUIRED: "Añade tu número de teléfono antes de reservar.",
      DAILY_LIMIT_REACHED: "Este estudio ya alcanzó su límite de citas para ese día. Elige otra fecha.",
      INVALID_APPOINTMENT_SLOT: "Ese horario no es válido. Selecciona uno de los horarios disponibles.",
      INVALID_APPOINTMENT_DATE: "La fecha está fuera del período de reservas permitido.",
      SERVICE_NOT_AVAILABLE: "Este servicio ya no está disponible.",
      PROVIDER_NOT_AVAILABLE: "Este estudio no está disponible para reservas.",
      PROVIDER_LICENSE_INACTIVE: "Este estudio no puede aceptar reservas en este momento.",
      OUTSIDE_WORKING_HOURS: "La hora seleccionada está fuera del horario de atención.",
      SLOT_BLOCKED: "Ese horario está bloqueado por el estudio.",
      SLOT_ALREADY_TAKEN: "Otra persona acaba de ocupar ese horario. Elige otro.",
    };
    const message = knownMessages[error.message] ?? error.message;
    throw new Error(message);
  }

  if (!data) throw new Error("El servidor no devolvió la cita creada.");
  return data as RemoteAppointment;
}

export async function listMyAppointments(): Promise<RemoteAppointment[]> {
  const { data, error } = await getSupabaseClient()
    .from("appointments")
    .select("id,provider_id,client_id,service_id,starts_at,ends_at,status,notes,client_service_name,client_price_cents,client_currency")
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RemoteAppointment[];
}
