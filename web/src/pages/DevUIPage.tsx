import { useState } from 'react'
import { Banknote, CheckCircle2, Home, Landmark, Link2, Mail, PartyPopper, ScanLine, Ticket, TicketCheck, Wallet, X } from 'lucide-react'

import { ActionPanel, SheetAction } from '../ui/ActionPanel'
import {
  AlertCard,
  EmptyState,
  FAB,
  FilterChips,
  LiveDot,
  ProgressBar,
  SearchBar,
  SegmentedToggle,
  StackedBar,
  Stepper,
} from '../ui/controls'
import { BalanceChip, Chip, CounterChip, PendingInviteChip, SaleChip } from '../ui/StatusChip'

// Inventario interno de los primitivos en lenguaje afiche (C18 paso 1). No
// linkeada desde la app; se entra por URL: /app/dev/ui. Cada bloque muestra
// el componente real con sus clases reales: si algo se ve mal aca, se ve mal
// en la app.

const TOKENS: Array<[string, string]> = [
  ['--paper', 'fondo'], ['--paper2', 'paneles'], ['--paper3', 'thead / bandas'], ['--hair', 'divisiones 1px'],
  ['--ink', 'tinta'], ['--ink2', 'secundario'], ['--ticket', 'acción'], ['--ok', 'pagó'],
  ['--warn', 'debe'], ['--bad', 'anulada'], ['--indigo', 'cortesía'],
]

function Bloque({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel__head">
        <b>{title}</b>
      </div>
      {children}
    </section>
  )
}

export function DevUIPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'debt' | 'paid' | 'comp'>('all')
  const [toggle, setToggle] = useState<'in' | 'out'>('in')
  const [qty, setQty] = useState(3)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <div className="stack" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">/dev/ui — afiche</h1>
          <p className="page-head__sub">Tokens y primitivos (C18 · paso 1)</p>
        </div>
      </div>

      <Bloque title="Tokens">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {TOKENS.map(([name, use]) => (
            <div key={name} style={{ border: '1px solid var(--hair)' }}>
              <div style={{ height: 34, background: `var(${name})`, borderBottom: '1px solid var(--hair)' }} />
              <div style={{ padding: '6px 8px' }}>
                <span className="eyebrow" style={{ display: 'block' }}>{name}</span>
                <span className="muted" style={{ fontSize: 11 }}>{use}</span>
              </div>
            </div>
          ))}
        </div>
      </Bloque>

      <Bloque title="Tipografía">
        <h2 style={{ fontSize: 28 }}>Anton · títulos y cifras</h2>
        <p className="eyebrow" style={{ marginTop: 6 }}>JetBrains Mono · etiquetas, columnas, botones, chips</p>
        <p style={{ margin: '8px 0 0', fontSize: 13 }}>Inter · celdas de tabla, nombres, subtítulos, formularios. Anton nunca en una celda ni en un párrafo.</p>
      </Bloque>

      <Bloque title="Button">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="button" type="button" style={{ width: 'auto' }}>Primary · 44</button>
          <button className="button button--ghost" type="button">Secondary</button>
          <button className="button button--ink" type="button" style={{ width: 'auto' }}>Dark</button>
          <button className="button button--danger" type="button" style={{ width: 'auto' }}>Danger</button>
          <button className="button button--xs" type="button">xs · 36</button>
          <button className="button button--ghost button--xs" type="button">xs ghost</button>
          <button className="button" type="button" style={{ width: 'auto' }} disabled>Disabled</button>
        </div>
      </Bloque>

      <Bloque title="StatusChip (contorno)">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <SaleChip sale={{ voided_at: null, is_comp: false, payment_status: 'paid', payment_method: 'cash', amount_cents: 2000000, paid_cents: 2000000 }} />
          <SaleChip sale={{ voided_at: null, is_comp: false, payment_status: 'pending', payment_method: null, amount_cents: 2400000, paid_cents: 1600000 }} />
          <SaleChip sale={{ voided_at: null, is_comp: true, payment_status: 'pending', payment_method: null, amount_cents: 0, paid_cents: 0 }} />
          <SaleChip sale={{ voided_at: '2026-01-01', is_comp: false, payment_status: 'pending', payment_method: null, amount_cents: 100, paid_cents: 0 }} />
          <BalanceChip balanceCents={0} />
          <CounterChip count={2} total={3} />
          <CounterChip count={3} total={3} />
          <PendingInviteChip />
          <Chip tone="neutral">Neutro</Chip>
          <Chip tone="ink">Tinta</Chip>
        </div>
      </Bloque>

      <Bloque title="Tira de resumen">
        <div className="sumstrip">
          <div><b>138</b><span>Entradas vendidas</span></div>
          <div className="g"><b>$1.016.000</b><span>Cobrado</span></div>
          <div className="y"><b>$218.000</b><span>Por cobrar</span></div>
          <div><b>11</b><span>Cortesías</span></div>
        </div>
      </Bloque>

      <Bloque title="Hero de función">
        <div className="hero">
          <div className="hero__l">
            <p className="eyebrow">Próxima función · en 4 días</p>
            <p className="hero__fn">Cierre de temporada</p>
            <p className="hero__meta">Dom 13 sept, 21:00 · Teatro Municipal</p>
            <div className="hero__bar"><i style={{ width: '18%' }} /></div>
            <p className="hero__barlbl"><span>14 de 80 vendidas</span><span>18%</span></p>
          </div>
          <div className="hero__stats">
            <div className="hero__st"><b>$36.000</b><span>Recaudó</span></div>
            <div className="hero__st"><b>31</b><span>Sin asignar</span></div>
          </div>
          <button className="hero__cta" type="button">Asignar entradas</button>
        </div>
      </Bloque>

      <Bloque title="Panel + Table (44px)">
        <div className="sblock" style={{ margin: '0 -16px -16px', borderWidth: '2px 0 0' }}>
          <div className="sblock__h">
            <span className="sblock__nm"><b>Cierre de temporada</b><span>Dom 13 sept · en venta</span></span>
            <span className="sblock__t"><span>6 ventas</span><span><b>14</b> entradas</span><span>Debe <b className="y">$96.000</b></span></span>
          </div>
          {[
            ['RS', 'Rosa Suárez', 'rosasuarez@gmail.com', 'warn', 'Debe'],
            ['LM', 'Lucía Molina', 'luciamolina@gmail.com', 'ok', 'Pagó'],
            ['GT', 'Graciela Torres', 'Sin email', 'blue', 'Cortesía'],
          ].map(([ini, nombre, mail, tone, label]) => (
            <div className="srow" key={nombre} role="row">
              <span className="srow__buyer">
                <span className="ini">{ini}</span>
                <span className="srow__who"><b>{nombre}</b><span className="srow__sub">{mail}</span></span>
              </span>
              <Chip tone={tone as 'warn' | 'ok' | 'blue'}>{label}</Chip>
            </div>
          ))}
        </div>
      </Bloque>

      <Bloque title="SearchBar + FilterChips">
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar comprador o vendedora…" />
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas', count: 58 },
            { value: 'debt', label: 'Deben', count: 12, tone: 'warn' },
            { value: 'paid', label: 'Pagas' },
            { value: 'comp', label: 'Cortesías' },
          ]}
        />
      </Bloque>

      <Bloque title="Input / Select / Stepper / Segmented">
        <label className="field">
          <span className="field__label">Comprador</span>
          <input className="field__input" placeholder="Nombre y apellido" />
        </label>
        <label className="field">
          <span className="field__label">Método</span>
          <select className="field__input" defaultValue="cash">
            <option value="cash">Efectivo</option>
            <option value="transfer">Transferencia</option>
          </select>
        </label>
        <div className="field">
          <span className="field__label">Cantidad</span>
          <Stepper value={qty} onChange={setQty} max={4} maxReason="Llegaste a tu cupo. Si necesitás más, pedile a Eli." />
        </div>
        <SegmentedToggle
          value={toggle}
          onChange={setToggle}
          options={[
            { value: 'in', label: 'Ingresaron · 38' },
            { value: 'out', label: 'Faltan · 42' },
          ]}
        />
        <LiveDot />
      </Bloque>

      <Bloque title="Avatar">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="avatar">E</span>
          <span className="ini">MD</span>
          <span className="ini ini--ok">CV</span>
          <span className="ini ini--blue">PB</span>
          <span className="ini ini--ink">EL</span>
        </div>
      </Bloque>

      <Bloque title="Barras">
        <ProgressBar value={51} max={80} />
        <div style={{ height: 8 }} />
        <StackedBar
          label="60 asignadas, 45 vendidas, 20 libres"
          total={80}
          segments={[
            { value: 45, tone: 'ok' },
            { value: 15, tone: 'blue' },
            { value: 20, tone: 'line' },
          ]}
        />
      </Bloque>

      <div>
        <div className="ghead"><b>Necesita tu atención</b><span className="n-warn">3</span></div>
        <AlertCard tone="warn" icon={<Wallet size={15} />} title="Carolina debe rendir $90.000" context="Cobró hace 12 días" actionLabel="Registrar" onAction={() => {}} />
        <AlertCard tone="warn" icon={<Ticket size={15} />} title="2da función: 20 entradas sin asignar" context="Sáb 5 dic · cupo 80" actionLabel="Asignar" onAction={() => {}} />
        <AlertCard tone="blue" icon={<Mail size={15} />} title="Josefina nunca entró a la app" context="Invitada hace 5 días" actionLabel="Reenviar" onAction={() => {}} />
        <AlertCard tone="ok" icon={<CheckCircle2 size={16} />} title="Todo en orden" context="Sin rendiciones pendientes ni tareas abiertas." />
      </div>

      <EmptyState icon={<PartyPopper size={18} />} title="Todo en orden">
        Sin rendiciones pendientes ni tareas abiertas. ¡Gran temporada!
      </EmptyState>

      <p className="alert" role="alert">Un error, en rojo, con borde de 2px.</p>

      <Bloque title="Tab bar (mobile) y Sidebar (desktop)">
        <div style={{ border: '2px solid var(--ink)', maxWidth: 360 }}>
          <div className="tabbar" style={{ position: 'static' }}>
            <div className="tabbar__inner">
              <a className="on-ink" href="#tab"><Home size={19} aria-hidden />Inicio</a>
              <a href="#tab"><TicketCheck size={19} aria-hidden />Ventas</a>
              <a href="#tab"><ScanLine size={19} aria-hidden />Puerta</a>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          La sidebar real está a la izquierda en escritorio (logo Anton, temporada arriba separada por 1px, ítem activo en tinta con borde ticket).
        </p>
      </Bloque>

      <Bloque title="Modal / BottomSheet">
        <button className="button button--ghost" type="button" onClick={() => setSheetOpen(true)}>
          Abrir sheet de acciones
        </button>
      </Bloque>

      <ActionPanel open={sheetOpen} onClose={() => setSheetOpen(false)} label="Acciones de la venta">
        <div className="sheet-head">
          <span className="ini">MD</span>
          <span>
            <b>María Dutra</b>
            <span>2 entradas · Gala vie 4 dic · vendió Carolina · $90.000</span>
          </span>
        </div>
        <SheetAction icon={<Banknote size={15} />} tone="ok" onClick={() => setSheetOpen(false)}>Marcar pagó — efectivo</SheetAction>
        <SheetAction icon={<Landmark size={15} />} tone="ok" onClick={() => setSheetOpen(false)}>Marcar pagó — transferencia</SheetAction>
        <SheetAction icon={<Link2 size={15} />} onClick={() => setSheetOpen(false)}>Copiar link de la entrada</SheetAction>
        <SheetAction icon={<X size={15} />} tone="danger" hint="Sin vuelta" onClick={() => setSheetOpen(false)}>Anular venta</SheetAction>
      </ActionPanel>

      <FAB onClick={() => setSheetOpen(true)}>Nueva venta</FAB>
    </div>
  )
}
