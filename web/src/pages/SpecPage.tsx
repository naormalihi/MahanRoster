import PrintIcon from "@mui/icons-material/PrintOutlined";
import {
  Box,
  Button,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState } from "../components/EmptyState";
import type { SpecDocument } from "../lib/api";
import { useAuth } from "../lib/auth";
import { chapters, parseSpec, type Block, type Inline } from "../lib/specMarkdown";

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <Box component="strong" key={i} sx={{ fontWeight: 800 }}>
            {p.text}
          </Box>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case "heading":
      if (b.level === 1) return null; // the page title stands for it
      return (
        <Typography
          id={b.id}
          variant={b.level === 2 ? "h2" : "h3"}
          sx={{ fontWeight: 800, mt: b.level === 2 ? 4 : 2.5, mb: 1, scrollMarginTop: 80, fontSize: b.level === 2 ? 22 : 18 }}
        >
          {b.text}
        </Typography>
      );
    case "paragraph":
      return (
        <Typography sx={{ my: 1, lineHeight: 1.75 }}>
          <Text parts={b.parts} />
        </Typography>
      );
    case "list":
      return (
        <Box component="ul" sx={{ my: 1, pr: 3, pl: 0, "& li": { mb: 0.5, lineHeight: 1.7 } }}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Text parts={it} />
            </li>
          ))}
        </Box>
      );
    case "table":
      return (
        <TableContainer component={Paper} variant="outlined" sx={{ my: 1.5, overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {b.head.map((c, i) => (
                  <TableCell key={i} sx={{ fontWeight: 800, bgcolor: "action.hover", whiteSpace: "nowrap" }}>
                    <Text parts={c} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {b.rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} sx={{ verticalAlign: "top", minWidth: j === 0 ? 110 : 140 }}>
                      <Text parts={c} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      );
    case "image":
      return (
        <Box component="figure" sx={{ m: 0, my: 2, breakInside: "avoid" }}>
          <Link href={b.src} target="_blank" rel="noopener">
            <Box
              component="img"
              src={b.src}
              alt={b.alt}
              loading="lazy"
              sx={{ display: "block", maxWidth: "100%", maxHeight: 640, mx: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}
            />
          </Link>
          <Typography component="figcaption" variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 0.75 }}>
            {b.alt}
          </Typography>
        </Box>
      );
    case "formula":
      return (
        <Box sx={{ my: 1.5, py: 1.25, textAlign: "center", fontSize: 20, fontFamily: "serif", direction: "ltr", bgcolor: "action.hover", borderRadius: 1 }}>
          {b.parts.map((p, i) => (p.sub ? <sub key={i}>{p.text}</sub> : <Fragment key={i}>{p.text}</Fragment>))}
        </Box>
      );
  }
}

/** "מסמך האפיון" – the full spec, for staff and commanders. */
export function SpecPage() {
  const { api } = useAuth();
  const [doc, setDoc] = useState<SpecDocument | null | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setDoc(undefined);
    if (!api) return;
    api.specDocument().then(setDoc, () => setError(true));
  }, [api]);
  useEffect(load, [load]);

  const blocks = useMemo(() => (doc ? parseSpec(doc.body) : []), [doc]);
  const toc = useMemo(() => chapters(blocks), [blocks]);
  const title = blocks.find((b) => b.kind === "heading" && b.level === 1);

  if (error) return <ErrorState text="לא הצלחנו לטעון את מסמך האפיון." onRetry={load} />;
  if (doc === undefined) return <CircularProgress />;
  if (doc === null) return <EmptyState title="מסמך האפיון" text="המסמך זמין במערכת עצמה, לסגל ולמפקדים – לא בהדגמה." />;

  return (
    <Box sx={{ maxWidth: 920, mx: "auto" }}>
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "flex-start", justifyContent: "space-between" }}>
        <Typography variant="h1" sx={{ fontWeight: 800, fontSize: { xs: 24, sm: 28 } }}>
          {title && title.kind === "heading" ? title.text : "מסמך האפיון"}
        </Typography>
        <Button startIcon={<PrintIcon />} onClick={() => window.print()} sx={{ flexShrink: 0, displayPrint: "none" }}>
          הדפסה
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, displayPrint: "none" }}>
        <Typography sx={{ fontWeight: 800, mb: 1 }}>תוכן העניינים</Typography>
        <Box component="ol" sx={{ m: 0, pr: 0, listStyle: "none", columnCount: { xs: 1, sm: 2 }, columnGap: 4 }}>
          {toc.map((c) => (
            <li key={c.id}>
              <Link
                component="button"
                underline="hover"
                onClick={() => document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                sx={{ textAlign: "start", py: 0.25 }}
              >
                {c.text}
              </Link>
            </li>
          ))}
        </Box>
      </Paper>

      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </Box>
  );
}
