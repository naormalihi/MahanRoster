import { Alert, Box, CircularProgress } from "@mui/material";
import { lazy, Suspense, type ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { canRead, isStaff } from "./lib/api";
import { ReadOnlyScope } from "./components/ReadOnly";
import { AuthProvider, useAuth } from "./lib/auth";
import { ChangePasswordPage, LoginPage, MfaPage } from "./pages/AuthPages";
import { BoardPage } from "./pages/BoardPage";
import { CyclesPage } from "./pages/CyclesPage";
import { CycleWorkspace } from "./pages/CycleWorkspace";
import { HomePage } from "./pages/HomePage";
import { CycleProvider } from "./lib/cycleContext";
import { SoldiersPage } from "./pages/SoldiersPage";

// Excel parsing is heavy and only נע"ת needs it (the cycle steps load lazily inside the workspace).
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const RosterImportPage = lazy(() => import("./pages/RosterImportPage").then((m) => ({ default: m.RosterImportPage })));

function Gate() {
  const { stage, me, error } = useAuth();
  if (stage === "loading")
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  if (stage === "error")
    return (
      <Box sx={{ p: 3, maxWidth: 560, mx: "auto", mt: 6 }}>
        <Alert severity="error">האפליקציה לא מוגדרת כראוי: {error}</Alert>
      </Box>
    );
  if (stage === "signedOut") return <LoginPage />;
  if (stage === "mfa") return <MfaPage />;
  if (stage === "changePassword") return <ChangePasswordPage />;
  const staff = isStaff(me);
  const reader = canRead(me);
  const lazyEl = (el: ReactElement) => <Suspense fallback={<CircularProgress />}>{el}</Suspense>;
  const ro = (el: ReactElement) => <ReadOnlyScope>{el}</ReadOnlyScope>;
  return (
    <CycleProvider>
      <Layout>
        <Routes>
          <Route path="/" element={reader ? <HomePage /> : <BoardPage />} />
          <Route path="/board" element={<BoardPage />} />
          {reader && (
            <>
              <Route path="/cycle" element={ro(<CycleWorkspace step="overview" />)} />
              <Route path="/cycle/constraints" element={ro(<CycleWorkspace step="constraints" />)} />
              <Route path="/cycle/potential" element={ro(<CycleWorkspace step="potential" />)} />
              <Route path="/cycle/slots" element={ro(<CycleWorkspace step="slots" />)} />
              <Route path="/cycle/schedule" element={ro(<CycleWorkspace step="schedule" />)} />
              <Route path="/cycle/operate" element={ro(<CycleWorkspace step="operate" />)} />
              <Route path="/soldiers" element={ro(<SoldiersPage />)} />
            </>
          )}
          {staff && (
            <>
              <Route path="/cycles" element={<CyclesPage />} />
              <Route path="/soldiers/import" element={lazyEl(<RosterImportPage />)} />
              <Route path="/admin" element={lazyEl(<AdminPage />)} />
              {/* old addresses, kept so bookmarks still work */}
              <Route path="/constraints" element={<Navigate to="/cycle/constraints" replace />} />
              <Route path="/potential" element={<Navigate to="/cycle/potential" replace />} />
              <Route path="/slots" element={<Navigate to="/cycle/slots" replace />} />
              <Route path="/schedule" element={<Navigate to="/cycle/schedule" replace />} />
              <Route path="/draft" element={<Navigate to="/cycle/schedule" replace />} />
              <Route path="/roster" element={<Navigate to="/soldiers/import" replace />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </CycleProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
