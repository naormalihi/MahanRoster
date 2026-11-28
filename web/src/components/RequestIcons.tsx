import ExemptionIcon from "@mui/icons-material/VerifiedUserOutlined";
import AbsenceIcon from "@mui/icons-material/LuggageOutlined";
import BlockIcon from "@mui/icons-material/EventBusyOutlined";
import type { ReactNode } from "react";
import type { RequestKind } from "../lib/requestList";
import { TONE, type BadgeTone } from "./IconBadge";

/** Each kind of request's icon and color – the same in "בקשות ואילוצים" and in the staff's constraints (2.74). */
export const KIND_LOOK: Record<RequestKind, { icon: ReactNode; tone: BadgeTone }> = {
  exemption: { icon: <ExemptionIcon />, tone: TONE.exemption },
  absence: { icon: <AbsenceIcon />, tone: TONE.absence },
  block: { icon: <BlockIcon />, tone: TONE.block },
};
