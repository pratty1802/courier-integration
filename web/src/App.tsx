import { NavLink, Outlet } from 'react-router-dom';

export function AppLayout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Courier Ops</div>
        <nav className="nav">
          <NavLink to="/" end>
            Settings
          </NavLink>
          <NavLink to="/create">Create</NavLink>
          <NavLink to="/track">Track</NavLink>
          <NavLink to="/cancel">Cancel</NavLink>
          <NavLink to="/bulk">Bulk</NavLink>
          <NavLink to="/batch">Batch</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
