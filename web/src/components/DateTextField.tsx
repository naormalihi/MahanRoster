import CalendarMonthOutlined from "@mui/icons-material/CalendarMonthOutlined";
import { Box, InputAdornment, TextField, type TextFieldProps } from "@mui/material";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { dmyToIso, isoToDmy } from "../lib/dmy";

type Props = Omit<TextFieldProps, "type" | "value" | "onChange"> & {
  /** ISO: "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM" with withTime; "" when empty */
  value: string;
  /** called with the ISO value (or "" when cleared) – only for a complete, valid date */
  onChange: (e: { target: { value: string } }) => void;
  withTime?: boolean;
};

/**
 * A date field that is always dd/mm/yyyy (and HH:MM with withTime) – the browser's own date
 * input follows the browser's language, so an English browser showed mm/dd/yyyy.
 * Typed, or picked from the calendar button (the browser's picker).
 */
export function DateTextField(props: Props) {
  const { value, onChange, withTime, slotProps, helperText, error, disabled, ...rest } = props;
  const html = ((slotProps as { htmlInput?: { min?: string; max?: string } } | undefined)?.htmlInput ?? {}) as { min?: string; max?: string };
  const [text, setText] = useState(isoToDmy(value));
  const [bad, setBad] = useState<string | null>(null);
  const emitted = useRef(value);
  const native = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(isoToDmy(value));
      setBad(null);
    }
  }, [value]);

  const outOfRange = (iso: string) => {
    const d = iso.slice(0, 10);
    if (html.min && d < html.min.slice(0, 10)) return `לא לפני ${isoToDmy(html.min.slice(0, 10))}`;
    if (html.max && d > html.max.slice(0, 10)) return `לא אחרי ${isoToDmy(html.max.slice(0, 10))}`;
    return null;
  };

  const emit = (iso: string) => {
    emitted.current = iso;
    onChange({ target: { value: iso } });
  };

  const typed = (t: string, final = false) => {
    setText(t);
    if (!t.trim()) {
      setBad(null);
      if (value !== "") emit("");
      return;
    }
    const iso = dmyToIso(t, withTime);
    if (!iso) {
      setBad(final ? (withTime ? "תאריך ושעה בפורמט dd/mm/yyyy HH:MM" : "תאריך בפורמט dd/mm/yyyy") : null);
      return;
    }
    const range = outOfRange(iso);
    setBad(range);
    if (!range && iso !== value) emit(iso);
    if (final) setText(isoToDmy(iso));
  };

  return (
    <TextField
      {...rest}
      disabled={disabled}
      value={text}
      onChange={(e: ChangeEvent<HTMLInputElement>) => typed(e.target.value)}
      onBlur={() => typed(text, true)}
      error={error || !!bad}
      helperText={bad ?? helperText}
      slotProps={{
        ...slotProps,
        inputLabel: { shrink: true },
        htmlInput: {
          dir: "ltr",
          inputMode: "numeric",
          placeholder: withTime ? "dd/mm/yyyy HH:MM" : "dd/mm/yyyy",
          style: { textAlign: "right" },
        },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Box sx={{ position: "relative", display: "flex", color: disabled ? "action.disabled" : "action.active" }}>
                <CalendarMonthOutlined fontSize="small" />
                {/* the browser's picker, invisible over the icon: a tap opens it on phones too */}
                <input
                  ref={native}
                  type={withTime ? "datetime-local" : "date"}
                  aria-label="בחירה מלוח שנה"
                  tabIndex={-1}
                  disabled={!!disabled}
                  min={html.min}
                  max={html.max}
                  value={value}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker?.();
                    } catch {
                      /* not supported – the tap itself opens it */
                    }
                  }}
                  onChange={(e) => {
                    const iso = e.target.value;
                    setText(isoToDmy(iso));
                    setBad(iso ? outOfRange(iso) : null);
                    emit(iso);
                  }}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%", padding: 0, border: 0 }}
                />
              </Box>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
