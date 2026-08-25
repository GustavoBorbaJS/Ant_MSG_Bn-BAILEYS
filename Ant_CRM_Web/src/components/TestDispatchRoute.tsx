import { Navigate, Outlet } from 'react-router-dom';
import { useCurrentUser } from '../lib/useCurrentUser';

// Mesma ideia do AdminRoute: defesa em profundidade no frontend (o backend
// ja bloqueia de verdade quem nao e admin nem tem canDispatchTest - ver
// TestDispatchService) - so evita mostrar a tela pra quem nao pode usar.
export function TestDispatchRoute() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) return null;
  if (user?.role !== 'admin' && !user?.canDispatchTest) {
    return <Navigate to="/instances" replace />;
  }
  return <Outlet />;
}
