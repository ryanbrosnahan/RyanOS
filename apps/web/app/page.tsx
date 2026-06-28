import { AuthGate } from "./auth-gate";
import { HomeDashboard } from "./home-dashboard";

export default function Home() {
  return (
    <AuthGate>
      <main className="min-h-screen">
        <HomeDashboard />
      </main>
    </AuthGate>
  );
}
