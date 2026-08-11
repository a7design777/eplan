import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Waypoint } from '../../src/types';

interface Props {
  value: Waypoint | null;
  placeholder: string;
  onChange: (w: Waypoint | null) => void;
}

/** Поле адреси з підказками. Пошук стартує лише після паузи в наборі. */
export function WaypointInput({ value, placeholder, onChange }: Props) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [options, setOptions] = useState<Waypoint[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef(value?.name ?? '');

  useEffect(() => {
    setQuery(value?.name ?? '');
    pickedRef.current = value?.name ?? '';
  }, [value]);

  useEffect(() => {
    // Не шукаємо те, що користувач щойно обрав зі списку.
    if (query.trim().length < 3 || query === pickedRef.current) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.geocode(query);
        if (!cancelled) {
          setOptions(results);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (w: Waypoint) => {
    pickedRef.current = w.name ?? '';
    setQuery(w.name ?? '');
    setOptions([]);
    setOpen(false);
    onChange(w);
  };

  return (
    <div className="suggest" ref={boxRef}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim() === '') onChange(null);
        }}
        onFocus={() => options.length > 0 && setOpen(true)}
        aria-label={placeholder}
      />
      {open && options.length > 0 && (
        <ul className="suggest-list">
          {options.map((o, i) => (
            <li key={`${o.lat},${o.lon},${i}`}>
              <button type="button" onClick={() => pick(o)}>
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && query.length >= 3 && (
        <span className="muted" style={{ position: 'absolute', right: 10, top: 10 }}>
          <span className="spinner" />
        </span>
      )}
    </div>
  );
}
