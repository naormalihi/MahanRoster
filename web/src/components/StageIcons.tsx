import ConstraintsIcon from "@mui/icons-material/EventBusyOutlined";
import PotentialIcon from "@mui/icons-material/GridViewOutlined";
import SlotsIcon from "@mui/icons-material/UploadFileOutlined";
import ScheduleIcon from "@mui/icons-material/AutoFixHighOutlined";
import OperateIcon from "@mui/icons-material/TuneOutlined";
import type { ReactNode } from "react";
import type { StepKey } from "../lib/workspace";
import type { BadgeTone } from "./IconBadge";

/** Each cycle step's icon and color – the home card and the steps bar show the same ones (2.73). */
export const STEP_LOOK: Record<Exclude<StepKey, "overview">, { icon: ReactNode; tone: BadgeTone }> = {
  constraints: { icon: <ConstraintsIcon />, tone: "success" },
  potential: { icon: <PotentialIcon />, tone: "primary" },
  slots: { icon: <SlotsIcon />, tone: "info" },
  schedule: { icon: <ScheduleIcon />, tone: "secondary" },
  operate: { icon: <OperateIcon />, tone: "error" },
};
