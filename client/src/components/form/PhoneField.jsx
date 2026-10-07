import { useRef } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import { COUNTRY_BY_ISO } from '../../lib/countries.js';
import { CountrySelect } from './CountrySelect.jsx';
import { FieldError } from './TextField.jsx';

/** Country code picker + national mobile number as two linked controls. */
export function PhoneField({ idPrefix, country, number, countryError, numberError, onCountryChange, onNumberChange, onBlur }) {
  const anchorRef = useRef(null);
  const countryId = `${idPrefix}-phoneCountry`;
  const numberId = `${idPrefix}-phone`;
  const error = countryError ?? numberError;
  const errorId = `${numberId}-error`;

  const handleBlur = () => {
    const value = number.trim();
    // An international number typed in full ("+44 7400…") selects its country.
    const parsed = value && parsePhoneNumberFromString(value, value.startsWith('+') ? undefined : country);
    if (parsed?.isValid() && parsed.country && COUNTRY_BY_ISO.has(parsed.country)) {
      if (parsed.country !== country) onCountryChange(parsed.country);
      onNumberChange(parsed.format('NATIONAL', { nationalPrefix: false }));
    }
    onBlur();
  };

  return (
    <div className="field" data-invalid={error ? 'true' : undefined}>
      <label className="field-label" htmlFor={numberId}>
        Mobile number
      </label>
      <div ref={anchorRef} className="input-wrap phone-wrap" data-invalid={error ? 'true' : undefined}>
        <CountrySelect
          id={countryId}
          value={country}
          onChange={onCountryChange}
          anchorRef={anchorRef}
          invalid={Boolean(countryError)}
          describedBy={countryError ? errorId : undefined}
        />
        <span className="phone-divider" aria-hidden="true" />
        <input
          id={numberId}
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Mobile number"
          value={number}
          maxLength={24}
          aria-invalid={numberError ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onNumberChange(event.target.value.replace(/[^\d\s()+-]/g, ''))}
          onBlur={handleBlur}
        />
      </div>
      <FieldError id={errorId} error={error} />
    </div>
  );
}
