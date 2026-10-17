import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CornerDownRight,
  Building2,
  FolderKey,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import Taskbar from "./Taskbar";
import "./AdminDashboard.css";
import "./AdminModal.css";
import "./AdminLayout.css";

const apiFetch = (path, options = {}) =>
  fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}${path}`, { credentials: "include", ...options });

const levels = [
  ["none", "No access"],
  ["view", "View only"],
  ["download", "View & download"],
  ["edit", "Editable"],
];

// Human label for the little "3 folders" badge shown on a collapsed row.
const grantSummary = (grantsForUser = {}) => {
  const count = Object.values(grantsForUser).filter(
    (level) => level && level !== "none",
  ).length;
  if (!count) return "No folder access";
  return `${count} folder${count === 1 ? "" : "s"}`;
};

// Mirrors orgInitials in App.jsx so organizations look the same on both pages.
const orgInitials = (name) => (name || "?").trim().slice(0, 2).toUpperCase();

// One organization's folders flattened into render order, each carrying its
// depth so subfolders read as an indented tree (same idea as the Folders
// workspace). Folders whose parent lives in another organization are treated as
// roots so nothing is ever dropped from the list.
const flattenFolders = (folders = []) => {
  const ids = new Set(folders.map((folder) => String(folder.id)));
  const childrenOf = new Map();
  const roots = [];
  for (const folder of folders) {
    const parent = folder.parentId == null ? null : String(folder.parentId);
    if (parent && ids.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(folder);
    } else {
      roots.push(folder);
    }
  }
  const rows = [];
  const walk = (folder, depth) => {
    rows.push({ folder, depth });
    (childrenOf.get(String(folder.id)) || []).forEach((child) =>
      walk(child, depth + 1),
    );
  };
  roots.forEach((folder) => walk(folder, 0));
  return rows;
};

export default function AdminDashboard({
  user,
  onHome,
  onFolders,
  theme,
  onThemeToggle,
}) {
  const [users, setUsers] = useState([]);
  const [grants, setGrants] = useState({});
  // Access is granted per organization, so the page loads the organization list
  // plus every folder: the categories the sidebar passes are scoped to just the
  // selected organization and would hide the other organizations' folders.
  const [organizations, setOrganizations] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  // Which user's folder-permission panel is expanded. Only one open at a
  // time keeps a long user list scannable instead of one huge scroll.
  const [expandedId, setExpandedId] = useState(null);
  // Which organization is drilled into inside that panel: the panel lists
  // organizations first, then the folders of the one that was opened.
  const [openOrg, setOpenOrg] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [userResponse, orgResponse, folderResponse] = await Promise.all([
        apiFetch("/api/users"),
        apiFetch("/api/organizations"),
        apiFetch("/api/categories"),
      ]);
      if (!userResponse.ok) throw new Error("Could not load users");
      const rows = await userResponse.json();
      setUsers(rows);
      const organizationRows = orgResponse.ok ? await orgResponse.json() : [];
      setOrganizations(
        organizationRows.map((entry) => ({
          id: entry.id,
          name: entry.name,
        })),
      );
      const folderRows = folderResponse.ok ? await folderResponse.json() : [];
      setFolders(
        folderRows.map((entry) => ({
          id: entry.id,
          name: entry.name,
          parentId: entry.parent_id || null,
          organizationId: entry.organization_id ?? null,
        })),
      );
      const pairs = await Promise.all(
        rows
          .filter((entry) => entry.role !== "admin")
          .map(async (entry) => {
            const result = await apiFetch(`/api/users/${entry.id}/permissions`);
            return [entry.id, result.ok ? await result.json() : []];
          }),
      );
      setGrants(
        Object.fromEntries(
          pairs.map(([id, entries]) => [
            id,
            Object.fromEntries(
              entries.map((entry) => [entry.categoryId, entry.level]),
            ),
          ]),
        ),
      );
    } catch (reason) {
      setError(reason.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const toggleExpanded = (userId) => {
    // Opening a user always starts from the organization list again.
    setOpenOrg("");
    setExpandedId((current) => (current === userId ? null : userId));
  };

  // Organizations together with their folders, in sidebar order. Folders that
  // lost their organization are grouped last as "No organization" so they stay
  // reachable instead of silently disappearing from the permission list.
  const folderGroups = organizations
    .map((org) => ({
      key: String(org.id),
      name: org.name,
      folders: folders.filter(
        (folder) => String(folder.organizationId) === String(org.id),
      ),
    }))
    .concat(
      folders.some((folder) => !folder.organizationId)
        ? [
            {
              key: "none",
              name: "No organization",
              folders: folders.filter((folder) => !folder.organizationId),
            },
          ]
        : [],
    );
  const openGroup =
    folderGroups.find((group) => group.key === openOrg) || null;
  const allFolders = folderGroups.flatMap((group) =>
    flattenFolders(group.folders).map(({ folder }) => ({
      ...folder,
      organizationName: group.name,
    })),
  );
  const filteredUsers = users.filter(
    (entry) =>
      entry.role !== "admin" &&
      `${entry.username || ""} ${entry.email || ""}`
        .toLowerCase()
        .includes(userSearch.trim().toLowerCase()),
  );

  const setLevel = (userId, categoryId, level) =>
    setGrants((current) => ({
      ...current,
      [userId]: { ...(current[userId] || {}), [categoryId]: level },
    }));
  const save = async (userId) => {
    setSavingId(userId);
    setError("");
    const permissions = Object.entries(grants[userId] || {})
      .filter(([, level]) => level !== "none")
      .map(([categoryId, level]) => ({
        categoryId: Number(categoryId),
        level,
      }));
    try {
      const response = await apiFetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).error ||
            "Could not save permissions",
        );
      setExpandedId((current) => (current === userId ? null : current));
      setOpenOrg("");
    } catch (reason) {
      setError(reason.message || "Could not save permissions");
    } finally {
      setSavingId(null);
    }
  };
  const remove = async (entry) => {
    if (
      !window.confirm(
        `Remove ${entry.email}? This also removes their folder access.`,
      )
    )
      return;
    const response = await apiFetch(`/api/users/${entry.id}`, {
      method: "DELETE",
    });
    if (!response.ok)
      return setError(
        (await response.json().catch(() => ({}))).error ||
          "Could not remove user",
      );
    load();
  };
  const create = async (event) => {
    event.preventDefault();
    setError("");
    const response = await apiFetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, permissions: [] }),
    });
    if (!response.ok)
      return setError(
        (await response.json().catch(() => ({}))).error ||
          "Could not create user",
      );
    setCreating(false);
    setEmail("");
    setPassword("");
    load();
  };

  const displayName =
    user?.username || user?.email?.split("@")[0] || "Administrator";
  const adminAccount = users.find((entry) => entry.role === "admin") || user || {};
  const adminName =
    adminAccount.username ||
    adminAccount.email?.split("@")[0] ||
    "Administrator";
  const footer = (
    <>
      <button
        onClick={onThemeToggle}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button>
        <Clock3 size={15} /> Notifications <i />
      </button>
      <div className="home-user">
        <span className="home-user-avatar">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{displayName}</strong>
          <small>Administrator</small>
        </span>
        <button
          className="taskbar-profile-more"
          onClick={() => setProfileOpen((open) => !open)}
          aria-label="Open profile menu"
        >
          <MoreHorizontal size={15} />
        </button>
        {profileOpen && (
          <div className="sidebar-profile-menu">
            <button onClick={() => window.dispatchEvent(new Event("sign-out"))}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <Taskbar
          active="admin"
          onHome={onHome}
          onFolders={onFolders}
          onAdmin={() => {}}
          footer={footer}
        />
      </header>
      <section className="admin-content">
        <header className="admin-heading">
          <div>
            <p>ADMINISTRATION</p>
            <h1>Users & folder access</h1>
            <span>
              Only you can create accounts and grant workspace access.
            </span>
          </div>
          <div className="admin-header-identity">
            <span className="admin-header-avatar">
              {(adminAccount.email || adminName).slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-header-copy">
              <strong>{adminName}</strong>
              <small>{adminAccount.email || user?.email || ""}</small>
            </span>
            <span className="admin-header-role">Administrator</span>
          </div>
          <div>
            <button
              className="admin-secondary"
              onClick={load}
              title="Refresh users"
            >
              <RefreshCw size={16} />
            </button>
            <button className="admin-create" onClick={() => setCreating(true)}>
              <Plus size={16} /> Create user
            </button>
          </div>
        </header>
        <section className="admin-overview" aria-label="Workspace totals">
          <article className="admin-stat">
            <span className="admin-stat-icon"><Users size={18} /></span>
            <span><strong>{loading ? "—" : users.length}</strong><small>Users</small></span>
          </article>
          <article className="admin-stat">
            <span className="admin-stat-icon"><Building2 size={18} /></span>
            <span><strong>{loading ? "—" : organizations.length}</strong><small>Organizations</small></span>
          </article>
          <article className="admin-stat">
            <span className="admin-stat-icon"><FolderKey size={18} /></span>
            <span><strong>{loading ? "—" : folders.length}</strong><small>Folders</small></span>
          </article>
        </section>
        <label className="admin-user-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search users by name or email"
            aria-label="Search users by name or email"
          />
        </label>
        {error && <p className="admin-error">{error}</p>}
        {loading ? (
          <p className="admin-empty">Loading users…</p>
        ) : (
          <div className="admin-users">
            {filteredUsers.map((entry) => {
              const isAdminRow = entry.role === "admin";
              const isOpen = expandedId === entry.id;
              const userGrants = grants[entry.id] || {};
              // "2 of 5 folders" style count shown on each organization row.
              const sharedIn = (group) =>
                group.folders.filter(
                  (folder) => (userGrants[folder.id] || "none") !== "none",
                ).length;
              const selectedAccess = allFolders.filter(
                (folder) => (userGrants[folder.id] || "none") !== "none",
              );
              return (
                <article
                  className={`admin-user ${isOpen ? "expanded" : ""}`}
                  key={entry.id}
                >
                  <header
                    className={isAdminRow ? "" : "admin-user-toggle"}
                    onClick={
                      isAdminRow ? undefined : () => toggleExpanded(entry.id)
                    }
                    role={isAdminRow ? undefined : "button"}
                    tabIndex={isAdminRow ? undefined : 0}
                    onKeyDown={
                      isAdminRow
                        ? undefined
                        : (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleExpanded(entry.id);
                            }
                          }
                    }
                  >
                    <div className="admin-avatar">
                      {entry.email.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{entry.username}</strong>
                      <span>{entry.email}</span>
                    </div>
                    <em>
                      {isAdminRow ? "Administrator" : "Standard user"}
                    </em>
                    {!isAdminRow && (
                      <span className="admin-grant-badge">
                        {grantSummary(grants[entry.id])}
                      </span>
                    )}
                    {!isAdminRow && (
                      <button
                        className="admin-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          remove(entry);
                        }}
                        title="Remove user"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                    {!isAdminRow && (
                      <ChevronDown
                        size={16}
                        className={`admin-chevron ${isOpen ? "open" : ""}`}
                      />
                    )}
                  </header>
                  {isAdminRow ? (
                    <p className="admin-full-access">
                      This is the protected administrator account with access
                      to every folder.
                    </p>
                  ) : (
                    isOpen && (
                      <div className="admin-grants">
                        <div className="admin-permission-layout">
                          <div className="admin-permission-editor">
                            <div className="admin-grants-title">
                              <FolderKey size={15} /> Folder permissions
                            </div>
                            {openGroup ? (
                              <>
                                <div className="admin-grants-head">
                                  <button
                                    type="button"
                                    className="admin-back"
                                    onClick={() => setOpenOrg("")}
                                  >
                                    <ChevronLeft size={14} /> All organizations
                                  </button>
                                  <span className="admin-grants-scope">
                                    {openGroup.name} · {sharedIn(openGroup)} of{" "}
                                    {openGroup.folders.length} shared
                                  </span>
                                </div>
                                <div className="admin-folder-rows">
                                  {flattenFolders(openGroup.folders).map(
                                    ({ folder, depth }) => (
                                      <label key={folder.id}>
                                        <span
                                          className="admin-folder-name"
                                          style={{ "--depth": depth }}
                                        >
                                          {depth > 0 && (
                                            <CornerDownRight size={13} />
                                          )}
                                          {folder.name}
                                        </span>
                                        <select
                                          value={userGrants[folder.id] || "none"}
                                          aria-label={`Access level for ${folder.name}`}
                                          onChange={(event) =>
                                            setLevel(
                                              entry.id,
                                              folder.id,
                                              event.target.value,
                                            )
                                          }
                                        >
                                          {levels.map(([value, label]) => (
                                            <option key={value} value={value}>
                                              {label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    ),
                                  )}
                                  {!openGroup.folders.length && (
                                    <p className="admin-empty">
                                      No folders in {openGroup.name} yet.
                                    </p>
                                  )}
                                </div>
                              </>
                            ) : folderGroups.length ? (
                              <div className="admin-org-rows">
                                {folderGroups.map((group) => (
                                  <button
                                    type="button"
                                    key={group.key}
                                    className="admin-org-row"
                                    onClick={() => setOpenOrg(group.key)}
                                    disabled={!group.folders.length}
                                  >
                                    <span className="admin-org-mark">
                                      {orgInitials(group.name)}
                                    </span>
                                    <span className="admin-org-copy">
                                      <strong>{group.name}</strong>
                                      <span>
                                        {group.folders.length
                                          ? `${sharedIn(group)} of ${group.folders.length} folder${
                                              group.folders.length === 1 ? "" : "s"
                                            } shared`
                                          : "No folders in this organization"}
                                      </span>
                                    </span>
                                    {group.folders.length > 0 && (
                                      <ChevronRight size={16} />
                                    )}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="admin-empty">
                                {organizations.length
                                  ? "Create a folder before granting access."
                                  : "Create an organization and a folder before granting access."}
                              </p>
                            )}
                            <button
                              className="admin-save"
                              onClick={() => save(entry.id)}
                              disabled={savingId === entry.id}
                            >
                              {savingId === entry.id
                                ? "Saving…"
                                : "Save permissions"}
                            </button>
                          </div>
                          <aside className="admin-user-access-summary">
                            <p className="admin-summary-eyebrow">USER ACCESS</p>
                            <div className="admin-summary-user">
                              <span className="admin-avatar">
                                {entry.email.slice(0, 1).toUpperCase()}
                              </span>
                              <span>
                                <strong>{entry.username}</strong>
                                <small>{entry.email}</small>
                              </span>
                            </div>
                            <div className="admin-summary-divider" />
                            <div className="admin-summary-title">
                              <strong>Granted folders</strong>
                              <span>{selectedAccess.length}</span>
                            </div>
                            {selectedAccess.length ? (
                              <ul className="admin-summary-list">
                                {selectedAccess.map((folder) => (
                                  <li key={folder.id}>
                                    <span>
                                      <strong>{folder.name}</strong>
                                      <small>{folder.organizationName}</small>
                                    </span>
                                    <em>
                                      {levels.find(
                                        ([value]) =>
                                          value === userGrants[folder.id],
                                      )?.[1] || "No access"}
                                    </em>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="admin-summary-empty">
                                No folder access selected.
                              </p>
                            )}
                          </aside>
                        </div>
                      </div>
                    )
                  )}
                </article>
              );
            })}
            {!filteredUsers.length && (
              <p className="admin-empty">
                <Users size={18} />
                {users.length
                  ? "No users match this search."
                  : "No users found."}
              </p>
            )}
          </div>
        )}
        {creating && (
          <div className="admin-modal">
            <form onSubmit={create}>
              <h2>Create user</h2>
              <p>
                They can sign in with this email. Set folder access after
                creating the account.
              </p>
              <label>
                Email
                <input
                  autoFocus
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Temporary password
                <input
                  type="password"
                  minLength="8"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
                <button className="admin-create">Create user</button>
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}