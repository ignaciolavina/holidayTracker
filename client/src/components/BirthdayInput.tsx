import { daysInMonth } from '@ht/shared';
import { MONTH_NAMES, cap } from '@/lib/format';
import { Select } from '@/components/ui/select';

/** Selector de cumpleaños (mes + día) que produce `MM-DD`. El 29 de febrero es válido. */
export function BirthdayInput({ value, onChange, idPrefix = 'birthday', testId = 'birthday' }: { value: string; onChange: (mmdd: string) => void; idPrefix?: string; testId?: string }) {
  const [mm, dd] = value ? value.split('-') : ['', ''];
  const maxDay = mm ? daysInMonth(2024, Number(mm)) : 31; // 2024 es bisiesto: permite 29-02
  const set = (m: string, d: string) => onChange(m && d ? `${m}-${d}` : m ? `${m}-` : '');
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select aria-label="Mes de cumpleaños" id={`${idPrefix}-month`} data-testid={`${testId}-month`} value={mm ?? ''} onChange={(e) => set(e.target.value, dd && Number(dd) <= daysInMonth(2024, Number(e.target.value)) ? dd : '')}>
        <option value="">Mes</option>
        {MONTH_NAMES.map((n, i) => (
          <option key={n} value={String(i + 1).padStart(2, '0')}>
            {cap(n)}
          </option>
        ))}
      </Select>
      <Select aria-label="Día de cumpleaños" id={`${idPrefix}-day`} data-testid={`${testId}-day`} value={dd ?? ''} disabled={!mm} onChange={(e) => set(mm ?? '', e.target.value)}>
        <option value="">Día</option>
        {Array.from({ length: maxDay }, (_, i) => (
          <option key={i} value={String(i + 1).padStart(2, '0')}>
            {i + 1}
          </option>
        ))}
      </Select>
    </div>
  );
}
