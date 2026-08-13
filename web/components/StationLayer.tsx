import { useMemo, useState } from 'react';
import type { NetworkInfo } from '../api';

interface Props {
  networks: NetworkInfo[];
  selected: number[];
  count: number;
  freeOnly: boolean;
  onChange: (ids: number[]) => void;
  onFreeOnlyChange: (v: boolean) => void;
  onClose: () => void;
}

/**
 * Вибір мереж для шару станцій на мапі.
 *
 * Свідомо не зв'язаний з улюбленими мережами у фільтрах: подивитись, де стоять
 * зарядки Electra, і вимагати від планувальника віддавати їм перевагу — різні
 * наміри, і змішувати їх в одному перемикачі виявилось незручно.
 */
export function StationLayer({
  networks,
  selected,
  count,
  freeOnly,
  onChange,
  onFreeOnlyChange,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  // На телефоні панель займає майже всю мапу — тому її можна згорнути
  // в один рядок, не вимикаючи сам шар станцій.
  const [collapsed, setCollapsed] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? networks.filter((n) => n.name.toLowerCase().includes(q)) : networks;
    // Обрані завжди зверху, інакше після пошуку їх не знайти.
    return [...list].sort((a, b) => {
      const sa = selected.includes(a.id) ? 0 : 1;
      const sb = selected.includes(b.id) ? 0 : 1;
      return sa - sb || b.station_count - a.station_count;
    });
  }, [networks, query, selected]);

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className={`station-layer${collapsed ? ' collapsed' : ''}`}>
      <div className="station-layer-head">
        <button
          className="btn-plain collapse"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Розгорнути' : 'Згорнути'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <strong>
          Станції{selected.length > 0 ? ` · ${selected.length}` : ''}
          {collapsed && count > 0 ? ` · ${count} на екрані` : ''}
        </strong>
        <button className="btn-plain" onClick={onClose} title="Прибрати з мапи">
          ✕
        </button>
      </div>

      {collapsed ? null : (
      <>
      <input
        type="text"
        value={query}
        placeholder="Пошук мережі"
        aria-label="Пошук мережі"
        onChange={(e) => setQuery(e.target.value)}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={freeOnly}
          onChange={(e) => onFreeOnlyChange(e.target.checked)}
        />
        Тільки безкоштовні
      </label>

      <div className="station-layer-meta">
        {selected.length === 0 ? 'Показано всі мережі' : `Обрано мереж: ${selected.length}`}
        {count > 0 && ` · ${count} на екрані`}
        {selected.length > 0 && (
          <button className="btn-plain" onClick={() => onChange([])}>
            Скинути
          </button>
        )}
      </div>

      <div className="network-list">
        {visible.slice(0, 120).map((n) => (
          <label className="check" key={n.id}>
            <input
              type="checkbox"
              checked={selected.includes(n.id)}
              onChange={() => toggle(n.id)}
            />
            {n.name}
            <span className="count">{n.station_count}</span>
          </label>
        ))}
        {visible.length === 0 && <span className="muted">Нічого не знайдено</span>}
      </div>
      </>
      )}
    </div>
  );
}
