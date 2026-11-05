import { Box, CircularProgress } from "@mui/material";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { isStaff } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { ChangePasswordPage, LoginPage, MfaPage } from "./pages/AuthPages";
import { BoardPage } from "./pages/BoardPage";

// Excel parsing is heavy and only נע"ת needs it.
const RosterImportPage = lazy(() => import("./pages/RosterImportPage").then((m) => ({ default: m.RosterImportPage })));

function Gate() {
  const { stage, me } = useAuth();
  if (stage === "loading")
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
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
