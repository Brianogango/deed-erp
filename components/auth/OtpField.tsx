'use client'

import { useRef, useState } from 'react'

type OtpFieldProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  label?: string
  length?: number
  disabled?: boolean
  verifying?: boolean
  autoFocus?: boolean
}

export default function OtpField({
  id = 'mfa-code',
  value,
  onChange,
  label = 'Authenticator PIN',
  length = 6,
  disabled = false,
  verifying = false,
  autoFocus = true,
}: OtpFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  const digits = Array.from({ length }, (_, index) => value[index] || '')
  const complete = value.length === length
  const activeIndex = complete ? -1 : Math.min(value.length, length - 1)

  const normalize = (raw: string) => raw.replace(/\D/g, '').slice(0, length)

  return (
    <div className={`otp-field ${focused ? 'otp-field--focused' : ''} ${complete ? 'otp-field--complete' : ''} ${verifying ? 'otp-field--verifying' : ''}`}>
      <div className="otp-field__meta">
        <label htmlFor={id} className="otp-field__label">
          {label}
        </label>
        <span className={`otp-field__status ${complete ? 'otp-field__status--ready' : ''}`}>
          {verifying ? 'Checking…' : complete ? 'Ready' : `${value.length}/${length}`}
        </span>
      </div>

      <div
        className="otp-field__frame"
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={event => onChange(normalize(event.target.value))}
          onPaste={event => {
            const pasted = normalize(event.clipboardData.getData('text'))
            if (!pasted) return
            event.preventDefault()
            onChange(pasted)
          }}
          aria-label={`${length}-digit authenticator PIN`}
          className="otp-field__native-input"
        />

        <div className="otp-field__cells" aria-hidden="true">
          {digits.map((digit, index) => {
            const active = focused && index === activeIndex
            const filled = Boolean(digit)
            return (
              <div
                key={index}
                className={[
                  'otp-field__cell',
                  active ? 'otp-field__cell--active' : '',
                  filled ? 'otp-field__cell--filled' : '',
                ].filter(Boolean).join(' ')}
              >
                <span key={digit || `empty-${index}`} className={digit ? 'otp-field__digit' : 'otp-field__placeholder'}>
                  {digit || '•'}
                </span>
                {active && <span className="otp-field__cursor" />}
              </div>
            )
          })}
        </div>

        {verifying && <div className="otp-field__scan" aria-hidden="true" />}
      </div>

      <div className="otp-field__progress" aria-hidden="true">
        <span style={{ width: `${(value.length / length) * 100}%` }} />
      </div>

      <div className="otp-field__hint">
        <span className="otp-field__hint-dot" aria-hidden="true" />
        Enter the current code from your authenticator app
      </div>
    </div>
  )
}
