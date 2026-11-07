import { Alert, Box, CircularProgress } from "@mui/material";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { isStaff } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { ChangePasswordPage, LoginPage, MfaPage } from "./pages/AuthPages";
import { BoardPage } from "./pages/BoardPage";
import { CyclesPage } from "./pages/CyclesPage";
import { SoldiersPage } from "./pages/SoldiersPage";

// Excel parsing is heavy and only נע"ת needs it.
const ConstraintsPage = lazy(() => import("./pages/ConstraintsPage").then((m) => ({ default: m.ConstraintsPage })));
const PotentialPage = lazy(() => import("./pages/PotentialPage").then((m) => ({ default: m.PotentialPage })));
const SlotsPage = lazy(() => import("./pages/SlotsPage").then((m) => ({ default: m.SlotsPage })));
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
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<BoardPage />} />
        {staff && <Route path="/cycles" element={<CyclesPage />} />}
        {staff && (
          <Route
            path="/constraints"
            element={
              <Suspense fallback={<CircularProgress />}>
                <ConstraintsPage />
              </Suspense>
            }
          />
        )}
        {staff && (
          <Route
            path="/potential"
            element={
              <Suspense fallback={<CircularProgress />}>
                <PotentialPage />
              </Suspense>
            }
          />
        )}
        {staff && (
          <Route
            path="/slots"
            element={
              <Suspense fallback={<CircularProgress />}>
                <SlotsPage />
              </Suspense>
            }
          />
        )}
        {staff && <Route path="/soldiers" element={<SoldiersPage />} />}
        {staff && (
          <Route
            path="/roster"
            element={
              <Suspense fallback={<CircularProgress />}>
                <RosterImportPage />
              </Suspense>
            }
          />
        )}
        {staff && (
          <Route
            path="/admin"
            element={
              <Suspense fallback={<CircularProgress />}>
                <AdminPage />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
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
