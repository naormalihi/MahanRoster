import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import { IconButton, InputAdornment, TextField, Tooltip, type TextFieldProps } from "@mui/material";
import { useState } from "react";

/** A password box with an eye to show what was typed (and hide it again). */
export function PasswordField(props: Omit<TextFieldProps, "type">) {
  const [shown, setShown] = useState(false);
  const { slotProps, ...rest } = props;
  const label = shown ? "הסתרת הסיסמה" : "הצגת הסיסמה";
  return (
    <TextField
      {...rest}
      type={shown ? "text" : "password"}
      slotProps={{
        ...slotProps,
        htmlInput: { dir: "ltr", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, ...(slotProps?.htmlInput as object) },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={label}>
                <IconButton
                  aria-label={label}
                  aria-pressed={shown}
                  onClick={() => setShown((v) => !v)}
                  onMouseDown={(e) => e.preventDefault()} // keep the cursor in the box
                  edge="end"
                >
                  {shown ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
