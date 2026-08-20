import { Navigate, Outlet } from 'react-router-dom';
import { useCurrentUser } from '../lib/useCurrentUser';

// Defesa em profundidade no frontend - o backend (RolesGuard) ja bloqueia de
// verdade quem nao e admin; isso aqui so evita mostrar a tela pra quem nao pode usar.
export function AdminRoute() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) return null;
  if (user?.role !== 'admin') {
    return <Navigate to="/instances" replace />;
  }
  return <Outlet />;
}
