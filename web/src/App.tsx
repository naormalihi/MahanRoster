import { Alert, Box, CircularProgress } from "@mui/material";
import { lazy, Suspense, useEffect, type ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { canRead, isSoldier, isStaff, isUnitCommander } from "./lib/api";
import { ReadOnlyScope } from "./components/ReadOnly";
import { AuthProvider, useAuth } from "./lib/auth";
import { isStaleBuild, showUpdate } from "./lib/staleBuild";
import { ChangePasswordPage, LoginPage, MfaPage } from "./pages/AuthPages";
import { BoardPage } from "./pages/BoardPage";
import { CyclesPage } from "./pages/CyclesPage";
import { CycleWorkspace } from "./pages/CycleWorkspace";
import { HomePage } from "./pages/HomePage";
import { MyPage } from "./pages/MyPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RequestsPage } from "./pages/RequestsPage";
import { CycleProvider } from "./lib/cycleContext";
import { SoldiersPage } from "./pages/SoldiersPage";

// Excel parsing is heavy and only נע"ת needs it (the cycle steps load lazily inside the workspace).
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const ScoringPage = lazy(() => import("./pages/ScoringPage").then((m) => ({ default: m.ScoringPage })));
const RosterImportPage = lazy(() => import("./pages/RosterImportPage").then((m) => ({ default: m.RosterImportPage })));

function Gate() {
  const { stage, me, error } = useAuth();
  // back from another page, or a tab left open over a deploy: the old version's files are gone,
  // so the owl screen reloads into the new version instead of a configuration error
  const stale = stage === "error" && isStaleBuild(error);
  useEffect(() => {
    if (stale) showUpdate();
  }, [stale]);
  if (stage === "loading" || stale)
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
          <Route path="/" element={isUnitCommander(me) ? <DashboardPage /> : reader ? <HomePage /> : isSoldier(me) ? <MyPage /> : <BoardPage />} />
          {reader && <Route path="/dashboard" element={<DashboardPage />} />}
          <Route path="/board" element={<BoardPage />} />
          <Route path="/scoring" element={lazyEl(<ScoringPage />)} />
          {isSoldier(me) && <Route path="/requests" element={<RequestsPage />} />}
          {/* staff and commanders who do duties too: their own duties, next to the unit's home */}
          {isSoldier(me) && <Route path="/my" element={<MyPage />} />}
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
