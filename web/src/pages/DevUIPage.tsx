import { useState } from 'react'
import { Banknote, CheckCircle2, Landmark, Link2, Mail, PartyPopper, Ticket, Wallet, X } from 'lucide-react'

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
import { BalanceChip, Chip, CounterChip, PendingInviteChip } from '../ui/StatusChip'

// Demo interna de los componentes comunes (C10). No linkeada desde la app;
// se entra por URL: /dev/ui.
export function DevUIPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'debt' | 'paid' | 'comp'>('all')
  const [toggle, setToggle] = useState<'in' | 'out'>('in')
  const [qty, setQty] = useState(3)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <div className="stack" style={{ paddingBottom: 80 }}>
      <h1 className="page-title">/dev/ui — componentes v2</h1>

      <div className="panel">
        <p className="panel__label">SearchBar + FilterChips (sticky en uso real)</p>
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
      </div>

      <div className="panel">
        <p className="panel__label">Chips de estado (sistema único)</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip tone="warn">Debe $90.000</Chip>
          <Chip tone="ok">Pagó (transf.)</Chip>
          <Chip tone="blue">Cortesía</Chip>
          <Chip tone="danger">Anulada</Chip>
          <BalanceChip balanceCents={0} />
          <CounterChip count={2} total={3} />
          <CounterChip count={3} total={3} />
          <PendingInviteChip />
        </div>
      </div>

      <div className="panel">
        <p className="panel__label">SegmentedToggle + LiveDot</p>
        <SegmentedToggle
          value={toggle}
          onChange={setToggle}
          options={[
            { value: 'in', label: 'Ingresaron · 38' },
            { value: 'out', label: 'Faltan · 42' },
          ]}
        />
        <LiveDot />
      </div>

      <div className="panel">
        <p className="panel__label">Stepper con límite</p>
        <Stepper value={qty} onChange={setQty} max={4} maxReason="Llegaste a tu cupo. Si necesitás más, pedile a Eli." />
      </div>

      <div className="panel">
        <p className="panel__label">Barras</p>
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
      </div>

      <div>
        <div className="ghead"><b>Necesita tu atención</b><span className="n-warn">3</span></div>
        <AlertCard
          tone="warn"
          icon={<Wallet size={15} />}
          title="Carolina debe rendir $90.000"
          context="Cobró hace 12 días"
          actionLabel="Registrar"
          onAction={() => {}}
        />
        <AlertCard
          tone="warn"
          icon={<Ticket size={15} />}
          title="2da función: 20 entradas sin asignar"
          context="Sáb 5 dic · cupo 80"
          actionLabel="Asignar"
          onAction={() => {}}
        />
        <AlertCard
          tone="blue"
          icon={<Mail size={15} />}
          title="Josefina nunca entró a la app"
          context="Invitada hace 5 días"
          actionLabel="Reenviar"
          onAction={() => {}}
        />
        <AlertCard tone="ok" icon={<CheckCircle2 size={16} />} title="Todo en orden" context="Sin rendiciones pendientes ni tareas abiertas." />
      </div>

      <EmptyState icon={<PartyPopper size={18} />} title="Todo en orden">
        Sin rendiciones pendientes ni tareas abiertas. ¡Gran temporada!
      </EmptyState>

      <div className="panel">
        <p className="panel__label">BottomSheet</p>
        <button className="button button--ghost" type="button" onClick={() => setSheetOpen(true)}>
          Abrir sheet de acciones
        </button>
      </div>

      <ActionPanel open={sheetOpen} onClose={() => setSheetOpen(false)} label="Acciones de la venta">
        <div className="sheet-head">
          <span className="ini">MD</span>
          <span>
            <b>María Dutra</b>
            <span>2 entradas · Gala vie 4 dic · vendió Carolina · $90.000</span>
          </span>
        </div>
        <SheetAction icon={<Banknote size={15} />} tone="ok" onClick={() => setSheetOpen(false)}>
          Marcar pagó — efectivo
        </SheetAction>
        <SheetAction icon={<Landmark size={15} />} tone="ok" onClick={() => setSheetOpen(false)}>
          Marcar pagó — transferencia
        </SheetAction>
        <SheetAction icon={<Link2 size={15} />} onClick={() => setSheetOpen(false)}>
          Copiar link de la entrada
        </SheetAction>
        <SheetAction icon={<Mail size={15} />} hint="enviado hace 2 días" onClick={() => setSheetOpen(false)}>
          Reenviar email
        </SheetAction>
        <SheetAction icon={<X size={15} />} tone="danger" onClick={() => setSheetOpen(false)}>
          Anular venta
        </SheetAction>
      </ActionPanel>

      <FAB onClick={() => setSheetOpen(true)}>Nueva venta</FAB>
    </div>
  )
}
