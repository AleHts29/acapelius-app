import { useEffect, useRef, useState } from 'react'

import { Button, Search, Seg } from '../ui/Button'
import { Card } from '../ui/Card'
import { DataList } from '../ui/DataList'
import { Figure, SubFigs } from '../ui/Figure'
import { Group } from '../ui/Group'
import { Heel } from '../ui/Heel'
import { Label } from '../ui/Label'
import { Modal } from '../ui/Modal'
import { Rhythm } from '../ui/Rhythm'
import { Row } from '../ui/Row'
import { Drawer, Sheet } from '../ui/Sheet'
import { SaleStatus, Status } from '../ui/Status'
import { FnTile, Tile } from '../ui/Tile'

// Inventario de los componentes de C19 (spec §4). No linkeada desde la app; se
// entra por URL: /app/dev/ui. Cada componente se muestra dos veces, en claro y
// en oscuro, con los datos del mockup. Si algo se ve mal acá, se ve mal en
// nueve pantallas.

// --- Contraste: se mide en vivo sobre los tokens de cada modo --------------

const PARES: Array<[string, string]> = [
  ['--ink2', '--paper'], ['--ink2', '--card'], ['--ink2', '--card2'],
  ['--ink3', '--paper'], ['--ink3', '--card'], ['--ink3', '--card2'],
  ['--ticket-text', '--card'], ['--ok', '--card'], ['--warn', '--card'],
  ['--bad', '--card'], ['--indigo', '--card'],
]

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function Contraste() {
  const ref = useRef<HTMLDivElement>(null)
  const [filas, setFilas] = useState<Array<[string, string, number | null]>>([])
  useEffect(() => {
    if (!ref.current) return
    const cs = getComputedStyle(ref.current)
    const v = (t: string) => cs.getPropertyValue(t).trim()
    setFilas(
      PARES.map(([fg, bg]) => {
        const [a, b] = [v(fg), v(bg)]
        const hex = /^#[0-9a-f]{6}$/i
        return [fg, bg, hex.test(a) && hex.test(b) ? ratio(a, b) : null]
      }),
    )
  }, [])
  return (
    <div ref={ref} className="card">
      {filas.map(([fg, bg, r]) => (
        <Row
          key={fg + bg}
          title={`${fg} sobre ${bg}`}
          status={
            r === null ? <Status tone="mute">No es hex</Status>
            : r >= 4.5 ? <Status tone="ok">AA</Status>
            : <Status tone="bad">No llega a AA</Status>
          }
          amount={r === null ? '—' : `${r.toFixed(2)}:1`}
        />
      ))}
    </div>
  )
}

// --- Las muestras ------------------------------------------------------------

function Muestra({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
      <Label>{`${n} · ${titulo}`}</Label>
      {children}
    </section>
  )
}

const VENTAS = [
  { voided_at: null, is_comp: false, payment_method: 'transfer' as const, amount_cents: 3000000, paid_cents: 3000000 },
  { voided_at: null, is_comp: false, payment_method: null, amount_cents: 2400000, paid_cents: 1600000 },
  { voided_at: null, is_comp: true, payment_method: null, amount_cents: 0, paid_cents: 0 },
  { voided_at: '2026-12-01', is_comp: false, payment_method: null, amount_cents: 1500000, paid_cents: 0 },
]

const TRAMOS = [2, 4, 7, 9, 14, 11, 6, 0, 0]

function Catalogo({ abrir }: { abrir: (q: 'modal' | 'sheet' | 'drawer') => void }) {
  const [seg, setSeg] = useState<'todas' | 'debe' | 'pago' | 'cor' | 'anul'>('todas')
  const [buscar, setBuscar] = useState('')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
      <Muestra n="01" titulo="Label">
        <div style={{ display: 'flex', gap: 'var(--s4)' }}>
          <Label>Falta cobrar</Label>
          <Label>Próxima función</Label>
        </div>
      </Muestra>

      <Muestra n="02 · 03 · 04" titulo="Card, Group y Row">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s4)', alignItems: 'start' }}>
          <Card
            title="Te están esperando"
            action={{ label: 'Ver todo', onClick: () => {} }}
            footer={<><span>3 de 6</span><a href="#ver">Ver las 6</a></>}
          >
            <Row title="Carolina Méndez" sub="Debe rendir desde el 9 dic" onClick={() => abrir('drawer')} />
            <Row title="Repartir cupos" sub="Sáb 12 dic · 14 sin repartir" onClick={() => {}} />
            <Row title="Diego Ríos" sub="Sin rendir" amount="45.000" unit="debe" onClick={() => {}} />
          </Card>
          <Group label="Vie 11 dic" count="4 ventas · 9 entradas">
            <div className="card">
              <Row title="María Dutra" sub="2 entradas · le vendió Carolina" status={<SaleStatus sale={VENTAS[0]} />} amount="30.000" onClick={() => abrir('sheet')} />
              <Row title="Roberto Silva" sub="3 entradas · le vendió Diego" status={<SaleStatus sale={VENTAS[1]} />} amount="24.000" onClick={() => abrir('sheet')} />
              <Row title="Graciela Torres" sub="1 entrada · invitada" status={<SaleStatus sale={VENTAS[2]} />} amount="0" onClick={() => abrir('sheet')} />
              <Row title="Pablo Ferrer" sub="2 entradas" status={<SaleStatus sale={VENTAS[3]} />} amount="15.000" dim off onClick={() => abrir('sheet')} />
            </div>
          </Group>
        </div>
      </Muestra>

      <Muestra n="05" titulo="Status">
        <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap' }}>
          <Status tone="ok">Pagó</Status>
          <Status tone="ok">Al día</Status>
          <Status tone="warn">Debe $ 45.000</Status>
          <Status tone="mute">Sin cupo</Status>
          <Status tone="cor">Cortesía</Status>
          <Status tone="bad">Anulada</Status>
          <Status tone="bad">Ya entró</Status>
        </div>
      </Muestra>

      <Muestra n="06" titulo="Figure">
        <div className="card" style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <Figure label="Falta cobrar" tone="warn">$ 218.000</Figure>
          <SubFigs
            items={[
              { label: 'Cobrado', value: '$ 1.016.000' },
              { label: 'Vendidas', value: '138' },
              { label: 'Cortesías', value: '11' },
            ]}
          />
        </div>
      </Muestra>

      <Muestra n="07" titulo="Button, Search y Seg">
        <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button go>Nueva venta</Button>
          <Button>Recordarle</Button>
          <Button disabled>Deshabilitado</Button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Search aria-label="Buscar venta" placeholder="Buscar por nombre o mail" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          <Seg
            label="Filtrar ventas"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'todas', label: 'Todas' },
              { value: 'debe', label: 'Debe' },
              { value: 'pago', label: 'Pagó' },
              { value: 'cor', label: 'Cortesías' },
              { value: 'anul', label: 'Anuladas' },
            ]}
          />
        </div>
        <div style={{ maxWidth: 360 }}>
          <Button go wide>Nueva venta</Button>
        </div>
      </Muestra>

      <Muestra n="08 · 12" titulo="Heel y Rhythm">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s4)', alignItems: 'start' }}>
          <Heel
            label="Próxima función · en 4 días"
            title="Vie 11 dic"
            meta="21:00 · Teatro Municipal"
            progress={{ value: 62, max: 80, left: '62 de 80 vendidas', right: '78%' }}
          />
          <Heel label="Ingresaron">
            <div className="fig" style={{ color: 'var(--ok-on-black)', marginTop: 6 }}>
              62 <span style={{ color: 'rgba(244,241,234,.6)' }}>de 80</span>
            </div>
            <Rhythm
              tramos={TRAMOS}
              ahora={5}
              ejes={['19:20', '19:50', 'Ahora 20:17', '20:50']}
              label="Ingresos por tramo de 10 minutos: el pico fue a las 20:00, con 14."
            />
          </Heel>
        </div>
      </Muestra>

      <Muestra n="09" titulo="Tile y FnTile">
        <div className="tiles tiles--3">
          <Tile
            name="Carolina Méndez"
            sub="carolina@mail.com"
            bar={{ value: 6, max: 12 }}
            quantity={<>6 <em>/ 12 vendidas</em></>}
            aside={<span className="rs">50%</span>}
            footer={<><Status tone="warn">Debe $ 45.000</Status><span className="rs">rindió el 9 dic</span></>}
            flag
            onClick={() => abrir('modal')}
          />
          <Tile
            name="Diego Ríos"
            sub="diego@mail.com"
            bar={{ value: 12, max: 12, tone: 'ok' }}
            quantity={<>12 <em>/ 12 vendidas</em></>}
            aside={<span className="rs">100%</span>}
            footer={<><Status tone="ok">Al día</Status><span className="rs">rindió ayer</span></>}
            onClick={() => abrir('modal')}
          />
          <Tile name="Eli Paredes" sub="Dirección" />
        </div>
        <div className="tiles tiles--5">
          <FnTile
            label="Vie · en 4 días"
            date="11 dic"
            venue="21:00 · Teatro Municipal"
            bar={{ value: 62, max: 80, tone: 'tk' }}
            quantity={<>62 <em>/ 80</em></>}
            aside={<span className="rs">$ 930.000</span>}
            footer={<Status tone="mute">Sin repartir · 6</Status>}
            on
            onClick={() => {}}
          />
          <FnTile
            label="Sáb · en 5 días"
            date="Agotada"
            venue="21:00 · Teatro Municipal"
            bar={{ value: 80, max: 80, tone: 'ok' }}
            quantity={<>80 <em>/ 80</em></>}
            footer={<Status tone="ok">Repartida</Status>}
            onClick={() => {}}
          />
          <FnTile
            label="Dom · hace 3 días"
            date="6 dic"
            venue="20:00 · Sala Verdi"
            bar={{ value: 71, max: 80 }}
            quantity={<>71 <em>/ 80</em></>}
            footer={<Status tone="mute">Entraron 68</Status>}
            off
            onClick={() => {}}
          />
        </div>
      </Muestra>

      <Muestra n="10 · 11 · 13" titulo="Modal, DataList, Sheet y Drawer">
        <DataList
          rows={[
            ['Cobró', '$ 90.000'],
            ['Ya rindió', '$ 45.000'],
            ['Última rendición', '9 dic · efectivo'],
            ['Cortesías usadas', '1'],
          ]}
        />
        <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
          <Button onClick={() => abrir('modal')}>Abrir popup</Button>
          <Button onClick={() => abrir('sheet')}>Abrir hoja</Button>
          <Button onClick={() => abrir('drawer')}>Abrir drawer</Button>
        </div>
        <p className="rs" style={{ whiteSpace: 'normal' }}>
          Los diálogos se abren en el modo de la app: para verlos en el otro, cambialo arriba.
        </p>
      </Muestra>

      <Muestra n="§3.2" titulo="Contraste medido sobre los tokens de este modo">
        <Contraste />
      </Muestra>
    </div>
  )
}

export function DevUIPage() {
  const [abierto, setAbierto] = useState<'modal' | 'sheet' | 'drawer' | null>(null)
  const cerrar = () => setAbierto(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)', paddingBottom: 80 }}>
      <div>
        <Label>C19 · sistema B</Label>
        <div style={{ fontFamily: 'var(--fd)', fontSize: 'var(--t-page)', lineHeight: 1, marginTop: 6 }}>/dev/ui</div>
      </div>

      {(['light', 'dark'] as const).map((modo) => (
        <div
          key={modo}
          data-theme={modo}
          style={{ background: 'var(--paper)', color: 'var(--ink)', padding: 'var(--s4)', borderRadius: 'var(--r)' }}
        >
          <div className="grp__h" style={{ marginBottom: 'var(--s4)' }}>
            <Label>{modo === 'light' ? 'Claro' : 'Oscuro'}</Label>
          </div>
          <Catalogo abrir={setAbierto} />
        </div>
      ))}

      <Modal
        open={abierto === 'modal'}
        onClose={cerrar}
        label="Corista · temporada 2026"
        title="Carolina Méndez"
        sub="carolina@mail.com · en el coro desde 2024"
        footer={
          <>
            <Button>Cambiar cupo</Button>
            <Button>Recordarle</Button>
            <Button go>Registrar rendición</Button>
          </>
        }
      >
        <div style={{ display: 'flex', gap: 'var(--s6)' }}>
          <Figure label="Debe" tone="warn">$ 45.000</Figure>
          <Figure label="Vendió" unit="/ 12">6</Figure>
        </div>
        <div>
          <Label>Cupo por función</Label>
          <div className="mini" style={{ marginTop: 7 }}>
            <Row title="Vie 11 dic" sub="vendió 4" amount="4 / 4" />
            <Row title="Sáb 12 dic" sub="vendió 2" amount="2 / 8" />
            <Row title="Vie 18 dic" sub="sin asignar" amount="— / —" />
          </div>
        </div>
        <DataList
          rows={[
            ['Cobró', '$ 90.000'],
            ['Ya rindió', '$ 45.000'],
            ['Última rendición', '9 dic · efectivo'],
            ['Cortesías usadas', '1'],
          ]}
        />
      </Modal>

      <Sheet
        open={abierto === 'sheet'}
        onClose={cerrar}
        title="María Dutra"
        sub="2 entradas · Vie 11 dic"
        status={<SaleStatus sale={VENTAS[0]} />}
        actions={
          <>
            <Button>Reenviar QR</Button>
            <Button go>Ver entrada</Button>
          </>
        }
      >
        <DataList
          rows={[
            ['Mail', 'maria.dutra@mail.com'],
            ['Total', '$ 30.000'],
            ['Pagó', '8 dic · transferencia'],
            ['Ingreso', 'todavía no'],
          ]}
        />
      </Sheet>

      <Drawer
        open={abierto === 'drawer'}
        onClose={cerrar}
        label="Rendición"
        title="Carolina Méndez"
        sub="carolina@mail.com · corista desde 2024"
        actions={
          <>
            <Button>Recordarle</Button>
            <Button go>Registrar rendición</Button>
          </>
        }
      >
        <Figure label="Debe" tone="warn">$ 45.000</Figure>
        <DataList
          rows={[
            ['Cupo asignado', '12 entradas'],
            ['Vendió', '6 entradas'],
            ['Cobró', '$ 90.000'],
            ['Ya rindió', '$ 45.000'],
          ]}
        />
        <div>
          <Label>De dónde sale la deuda</Label>
          <div className="mini" style={{ marginTop: 8 }}>
            <Row title="Roberto Silva" sub="3 entradas · 12 dic" amount="45.000" />
          </div>
        </div>
      </Drawer>
    </div>
  )
}
