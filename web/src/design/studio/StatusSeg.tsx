import type { BookStatus } from '@shared/types';

const OPTIONS: [BookStatus, string][] = [['unread', 'Unread'], ['reading', 'Reading'], ['finished', 'Finished']];

/** Unread / Reading / Finished segmented control; the caller wires it to the status PATCH. */
export default function StatusSeg({ value, onChange }: { value: BookStatus; onChange: (s: BookStatus) => void }) {
  return (
    <div className="st-seg3" role="group" aria-label="Reading status">
      {OPTIONS.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => value !== v && onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
