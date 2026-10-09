import { useMemo, useState } from "react";

type Service = { id: number; name: string; description: string; price: number; duration: string; tag: string; tone: string };
const services: Service[] = [
  { id: 1, name: "Manicura clásica", description: "Cuidado delicado y acabado impecable", price: 800, duration: "45 min", tag: "ESENCIAL", tone: "rose" },
  { id: 2, name: "Uñas acrílicas", description: "Forma, longitud y estilo a tu gusto", price: 1800, duration: "90 min", tag: "FAVORITO", tone: "peach" },
  { id: 3, name: "Gel con diseño", description: "Color duradero con detalles especiales", price: 1400, duration: "60 min", tag: "TENDENCIA", tone: "lilac" }
];
const money = (n: number) => new Intl.NumberFormat("es-CU", { maximumFractionDigits: 0 }).format(n) + " CUP";

export default function App() {
  const [tab, setTab] = useState<"inicio" | "citas" | "perfil">("inicio");
  const [selected, setSelected] = useState<Service | null>(null);
  const [day, setDay] = useState("Mañana · Jue 9");
  const [time, setTime] = useState("10:00");
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const visible = useMemo(() => services.filter(s => s.name.toLowerCase().includes(search.toLowerCase())), [search]);

  return <main className="client-shell">
    <header className="client-top">
      <div className="brand-lockup"><div className="brand-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div>
      <button className="avatar-button" aria-label="Perfil" onClick={() => setTab("perfil")}>A</button>
    </header>

    <nav className="client-tabs" aria-label="Navegación principal">
      <button className={tab === "inicio" ? "active" : ""} onClick={() => setTab("inicio")}>Descubrir</button>
      <button className={tab === "citas" ? "active" : ""} onClick={() => setTab("citas")}>Mis citas</button>
      <button className={tab === "perfil" ? "active" : ""} onClick={() => setTab("perfil")}>Mi perfil</button>
    </nav>

    {tab === "inicio" && <>
      <section className="client-hero">
        <div className="hero-copy"><span className="eyebrow">BELLEZA QUE SE SIENTE</span><h1>Un momento<br/>solo <em>para ti.</em></h1><p>Encuentra tu próximo estilo favorito y reserva tu espacio.</p><button className="button-dark" onClick={() => document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" })}>Explorar servicios <span>↗</span></button></div>
        <div className="hero-art" aria-label="Ilustración decorativa de manicura"><div className="sun-disc"></div><div className="flower flower-one">✿</div><div className="flower flower-two">✿</div><div className="nail-bottle"><div className="bottle-cap"></div><div className="bottle-neck"></div><div className="bottle-body"><span>l</span></div></div><div className="art-caption">BEAUTY, IN YOUR OWN WAY</div></div>
      </section>
      <section className="trust-row"><div><span className="trust-icon">♡</span><span><b>A tu ritmo</b><small>Reserva cuando quieras</small></span></div><div><span className="trust-icon">✧</span><span><b>Tu estilo</b><small>Servicios para ti</small></span></div><div><span className="trust-icon">⌁</span><span><b>Sin sorpresas</b><small>Precios transparentes</small></span></div></section>
      <section id="catalogo" className="catalog-section"><div className="section-heading"><div><span className="eyebrow">ELIGE TU FAVORITO</span><h2>Pequeños detalles,<br/><em>gran diferencia.</em></h2></div><span className="service-count">0{visible.length} servicios</span></div>
        <label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar un servicio..." /></label>
        <div className="service-grid">{visible.map(service => <article className="service-card" key={service.id}><div className={"service-art " + service.tone}><span className="service-tag">{service.tag}</span><div className="nail-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span className="art-number">0{service.id}</span></div><div className="service-info"><h3>{service.name}</h3><p>{service.description}</p><div className="service-meta"><span>◷ {service.duration}</span><b>{money(service.price)}</b></div><button className="button-outline" onClick={() => { setSelected(service); setPending(false); }}>Reservar este servicio <span>↗</span></button></div></article>)}</div>
        {visible.length === 0 && <p className="empty-state">No encontramos servicios con ese nombre.</p>}
      </section>
      <section className="salon-note"><span className="note-star">✳</span><div><span className="eyebrow">UN ESPACIO PARA TI</span><h2>La belleza está<br/>en los detalles.</h2><p>Guarda un ratito para ti. Te lo mereces.</p></div><span className="note-flower">✿</span></section>
    </>}

    {tab === "citas" && <section className="simple-page"><span className="eyebrow">TU AGENDA PERSONAL</span><h1>Mis <em>citas.</em></h1>{pending ? <article className="appointment-card"><span className="pending-pill">Pendiente de confirmar</span><h3>{selected?.name ?? "Servicio seleccionado"}</h3><p>{day} · {time}</p><b>{selected ? money(selected.price) : ""}</b><p className="muted">La reserva aún no está confirmada por el servidor.</p></article> : <div className="empty-appointments"><span>♡</span><h3>Tu próximo momento empieza aquí</h3><p>Cuando reserves un servicio, podrás consultar aquí los detalles de tu cita.</p><button className="button-dark" onClick={() => setTab("inicio")}>Descubrir servicios <span>↗</span></button></div>}</section>}
    {tab === "perfil" && <section className="simple-page"><span className="eyebrow">TU ESPACIO LUNI</span><h1>Hola, <em>bonita.</em></h1><div className="profile-panel"><div className="profile-avatar">A</div><div><h3>Tu perfil</h3><p>Inicia sesión para guardar tus citas y preferencias.</p></div><button className="button-outline" onClick={() => alert("La autenticación se conectará a Supabase en la siguiente fase.")}>Iniciar sesión</button></div><p className="muted offline-note">♡ Tus servicios guardados estarán disponibles también sin conexión después de la primera sincronización.</p></section>}

    <footer className="client-footer"><div className="brand-lockup"><div className="brand-mark small-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div><span>Hecho con cariño ♡</span></footer>

    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button>{!pending ? <><span className="eyebrow">TU PRÓXIMO MOMENTO</span><h2 id="booking-title">Reserva tu <em>espacio.</em></h2><div className="selected-service"><div className={"mini-service-art " + selected.tone}>✿</div><div><b>{selected.name}</b><small>{selected.duration} · {money(selected.price)}</small></div></div><label className="field-label">Día preferido<select value={day} onChange={e => setDay(e.target.value)}><option>Mañana · Jue 9</option><option>Viernes · 10 oct.</option><option>Sábado · 11 oct.</option></select></label><label className="field-label">Hora preferida<div className="time-options">{["09:00","10:00","11:30","14:00","16:00"].map(t => <button key={t} className={time === t ? "time-chip chosen" : "time-chip"} onClick={() => setTime(t)}>{t}</button>)}</div></label><p className="booking-disclaimer">La disponibilidad debe validarse antes de confirmar. Esta solicitud no reserva el horario todavía.</p><button className="button-dark full-button" onClick={() => { setPending(true); setTab("citas"); }}>Guardar solicitud <span>↗</span></button></> : <div className="success-content"><div className="success-icon">♡</div><span className="eyebrow">SOLICITUD GUARDADA EN ESTA VISTA</span><h2>Un paso más<br/><em>para ti.</em></h2><p>Tu solicitud aparece como pendiente. La confirmación real estará disponible cuando conectemos el sistema de reservas y sincronización.</p><button className="button-dark full-button" onClick={() => setSelected(null)}>Entendido</button></div>}</section></div>}
  </main>;
}
