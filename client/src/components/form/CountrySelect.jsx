import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COUNTRY_BY_ISO, searchCountries, supportsFlagEmoji } from '../../lib/countries.js';
import { CheckIcon, ChevronDownIcon, SearchIcon } from '../icons.jsx';

const SHEET_QUERY = '(max-width: 640px)';
const POPOVER_HEIGHT = 340;

export function Flag({ country }) {
  if (supportsFlagEmoji()) {
    return (
      <span className="flag" aria-hidden="true">
        {country.flag}
      </span>
    );
  }
  return (
    <span className="flag flag-fallback" aria-hidden="true">
      {country.iso}
    </span>
  );
}

/**
 * Searchable country-code picker (button + popover listbox; bottom sheet on phones).
 * Keyboard: ↑/↓ Home End to move, Enter to choose, Esc to close, type to filter.
 */
export function CountrySelect({ id, value, onChange, anchorRef, invalid, describedBy }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState(null);
  const [sheet, setSheet] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const selected = COUNTRY_BY_ISO.get(value) ?? COUNTRY_BY_ISO.get('US');
  const results = useMemo(() => searchCountries(query), [query]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = () => {
    setSheet(window.matchMedia(SHEET_QUERY).matches);
    setQuery('');
    setActive(Math.max(0, searchCountries('').findIndex((c) => c.iso === selected.iso)));
    setOpen(true);
  };

  const choose = (country) => {
    onChange(country.iso);
    close();
  };

  const updatePosition = useCallback(() => {
    const anchor = (anchorRef?.current ?? triggerRef.current)?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(Math.max(anchor.width, 300), window.innerWidth - 24);
    const left = Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12);
    const below = window.innerHeight - anchor.bottom;
    const placeAbove = below < POPOVER_HEIGHT + 16 && anchor.top > below;
    setPosition(
      placeAbove
        ? { left, width, bottom: window.innerHeight - anchor.top + 8, maxHeight: Math.min(POPOVER_HEIGHT, anchor.top - 16) }
        : { left, width, top: anchor.bottom + 8, maxHeight: Math.min(POPOVER_HEIGHT, below - 16) },
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    if (!sheet) updatePosition();
    searchRef.current?.focus({ preventScroll: true });
    if (sheet) return undefined;
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, sheet, updatePosition]);

  // Close on outside pointer down.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (popoverRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active, results]);

  const onSearchKeyDown = (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(results.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(results.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        if (results[active]) choose(results[active]);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
    }
  };

  const optionId = (country) => `${listId}-${country.iso}`;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="country-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Country code: ${selected.name} +${selected.dial}`}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <Flag country={selected} />
        <span className="country-dial">+{selected.dial}</span>
        <ChevronDownIcon className="country-chevron" />
      </button>

      {open &&
        createPortal(
          <div className="country-layer" data-sheet={sheet ? 'true' : undefined}>
            {sheet && <div className="country-backdrop" aria-hidden="true" />}
            <div
              ref={popoverRef}
              className="country-popover"
              role="dialog"
              aria-label="Choose a country code"
              style={sheet || !position ? undefined : position}
            >
              {sheet && <div className="country-grabber" aria-hidden="true" />}
              <div className="country-search">
                <SearchIcon />
                <input
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={results[active] ? optionId(results[active]) : undefined}
                  aria-label="Search countries"
                  placeholder="Search country or code"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
              <ul ref={listRef} id={listId} role="listbox" aria-label="Countries" className="country-list">
                {results.map((country, index) => (
                  <li
                    key={country.iso}
                    id={optionId(country)}
                    role="option"
                    aria-selected={country.iso === selected.iso}
                    data-active={index === active ? 'true' : undefined}
                    onPointerMove={() => index !== active && setActive(index)}
                    onClick={() => choose(country)}
                  >
                    <Flag country={country} />
                    <span className="country-name">{country.name}</span>
                    <span className="country-code">+{country.dial}</span>
                    <span className="country-check">{country.iso === selected.iso && <CheckIcon width={14} height={14} />}</span>
                  </li>
                ))}
                {results.length === 0 && (
                  <li className="country-empty" role="presentation">
                    No countries match “{query}”
                  </li>
                )}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
