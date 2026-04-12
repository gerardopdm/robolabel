import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import AppShell from './layouts/AppShell'
import AnnotatePage from './pages/AnnotatePage'
import ClassesPage from './pages/ClassesPage'
import DatasetVersionsPage from './pages/DatasetVersionsPage'
import ForbiddenPage from './pages/ForbiddenPage'
import GroupDetailPage from './pages/GroupDetailPage'
import GroupsListPage from './pages/GroupsListPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import ProjectEditPage from './pages/ProjectEditPage'
import ProjectHubPage from './pages/ProjectHubPage'
import ProjectNewPage from './pages/ProjectNewPage'
import ProjectsPage from './pages/ProjectsPage'
import UsersPage from './pages/UsersPage'

function PrivateLayout() {
  const { access, loading } = useAuth()
  if (loading) return <div className="p-8 text-slate-500">Cargando…</div>
  if (!access) return <Navigate to="/login" replace />
  return <AppShell />
}

/** Raíz `/`: envía a proyectos si hay sesión, si no al login (evita 404 al abrir la app). */
function RootRedirect() {
  const { access, loading } = useAuth()
  if (loading) return <div className="p-8 text-slate-500">Cargando…</div>
  return <Navigate to={access ? '/projects' : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<PrivateLayout />}>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/projects/new" element={<ProjectNewPage />} />
        <Route path="/projects/:projectId" element={<ProjectHubPage />} />
        <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
        <Route path="/projects/:projectId/groups" element={<GroupsListPage />} />
        <Route path="/projects/:projectId/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/projects/:projectId/groups/:groupId/annotate/:imageId" element={<AnnotatePage />} />
        <Route path="/projects/:projectId/classes" element={<ClassesPage />} />
        <Route path="/projects/:projectId/dataset-versions" element={<DatasetVersionsPage />} />
      </Route>
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
