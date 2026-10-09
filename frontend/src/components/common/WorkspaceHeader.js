import React, { useEffect, useId, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import restaurantLogo from '../../restaurant-logo.jpg';
import './WorkspaceHeader.css';

const matchesPath = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

export default function WorkspaceHeader({ section, groups, pathname, userName, onPasswordChange, onLogout, className = '', navigationLabel }) {
  const activeGroup = groups.find((group) => group.items?.some((item) => matchesPath(pathname, item.path)));
  const activePage = activeGroup?.items.find((item) => matchesPath(pathname, item.path))
    || groups.find((item) => item.path === pathname) || groups[0];
  const [openGroup, setOpenGroup] = useState(activeGroup?.id || null);
  const headerRef = useRef(null);
  const navigationId = useId();
  const expandedGroup = groups.find((group) => group.id === openGroup);

  useEffect(() => {
    const nextGroup = groups.find((group) => group.items?.some((item) => matchesPath(pathname, item.path)));
    setOpenGroup(nextGroup?.id || null);
  }, [pathname, groups]);

  const closeSubmenu = (event) => {
    if (event.key !== 'Escape' || !openGroup) return;
    headerRef.current?.querySelector('[aria-expanded="true"]')?.focus();
    setOpenGroup(null);
  };

  return <header ref={headerRef} className={`workspace-topbar ${className}`} onKeyDown={closeSubmenu}>
    <div className="workspace-topbar-identity">
      <div className="workspace-brand">
        <span className="workspace-brand-mark"><img src={restaurantLogo} alt="Logo du restaurant Razafimamonjy" /></span>
        <span className="workspace-brand-section">{section}</span>
      </div>
      <div className="workspace-account">
        <span className="workspace-user">{userName || 'Utilisateur'}</span>
        <button type="button" onClick={onPasswordChange}>Mot de passe</button>
        <button type="button" className="workspace-signout" onClick={onLogout}>Deconnexion</button>
      </div>
    </div>
    <div className="workspace-topbar-navigation">
      <nav aria-label={navigationLabel}>
        {groups.map((group) => group.items ? <NavLink to={group.items[0].path} key={group.id}
          className={`workspace-nav-link${activeGroup?.id === group.id ? ' is-active' : ''}${openGroup === group.id ? ' is-open' : ''}`}
          aria-expanded={openGroup === group.id} aria-controls={`${navigationId}-${group.id}`}
          onClick={() => setOpenGroup(group.id)}>{group.label}</NavLink>
          : <NavLink key={group.id || group.path} to={group.path} end
            className={({ isActive }) => `workspace-nav-link${isActive ? ' is-active' : ''}`}>{group.label}</NavLink>)}
      </nav>
      <h1>{activePage.label}</h1>
    </div>
    {expandedGroup?.items ? <nav id={`${navigationId}-${expandedGroup.id}`} className="workspace-subnav" aria-label={expandedGroup.label}>
      {expandedGroup.items.map((item) => <NavLink key={item.id || item.path} to={item.path}
        className={({ isActive }) => `workspace-subnav-link${isActive ? ' is-active' : ''}`}>{item.label}</NavLink>)}
    </nav> : null}
  </header>;
}
