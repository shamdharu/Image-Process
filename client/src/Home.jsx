import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  Folder,
  LogOut,
  Image as ImageIcon,
} from "lucide-react";
import Taskbar from "./Taskbar";
import "./Home.css";

const fallbackFolders = [
  { id: "brand", name: "Brand Assets", count: 48, color: "blue" },
  { id: "product", name: "Product Specs", count: 19, color: "peach" },
  { id: "client", name: "Client Work", count: 102, color: "green" },
  { id: "archive", name: "Archives", count: 41, color: "gray" },
];

export default function Home({
  user,
  theme = "light",
  onThemeToggle,
  categories = [],
  access = null,
  onOpenFolder,
  onUpload,
  onCreateFolder,
  onAdmin,
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const displayName = user?.username || user?.email?.split("@")[0] || "there";
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";

  const folders = useMemo(() => {
    const allowedNumbers =
      access && !access.isAdmin
        ? new Set(
            (access.grants || [])
              .map((grant) => Number(grant.number))
              .filter((value) => Number.isFinite(value)),
          )
        : null;

    const roots = categories.filter((item) => {
      if (item.parentId) return false;
      if (!allowedNumbers) return true;
      return allowedNumbers.has(Number(item.number));
    });

    if (!roots.length) {
      return [];
    }

    return roots.slice(0, 6).map((item, index) => ({
      ...item,
      id: item.id,
      name: item.name,
      count: Number(item.count || 0),
      color: fallbackFolders[index % fallbackFolders.length].color,
    }));
  }, [categories, access]);

  const totalImages = useMemo(
    () => folders.reduce((sum, item) => sum + Number(item.count || 0), 0),
    [folders],
  );

  const folderCount = folders.length;
  const storagePercent = totalImages
    ? Math.min(100, Math.round((totalImages / Math.max(1, folderCount * 120)) * 100))
    : 0;

  const activityItems = useMemo(
    () =>
      folders.slice(0, 4).map((folder, index) => ({
        icon: index % 2 === 0 ? Folder : Clock3,
        title: folder.name,
        detail: `${Number(folder.count || 0)} assets in this folder`,
        meta: index === 0 ? "Now" : index === 1 ? "Today" : "Recent",
        tone: index % 2 === 0 ? "teal" : "blue",
      })),
    [folders],
  );

  const taskbarFooter = (
    <>
      <button>
        <Clock3 size={15} /> Activity
      </button>
      <div className="home-user">
        <span className="home-user-avatar">
          {displayName.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{displayName}</strong>
          <small>{user?.role === "admin" ? "Administrator" : "Editor"}</small>
        </span>
        <button
          className="taskbar-profile-more"
          onClick={() => setProfileOpen((open) => !open)}
          aria-label="Open profile menu"
        >
          <Clock3 size={15} />
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
    <main className="home-page">
      <header className="home-topbar">
          <Taskbar
            active="home"
            onHome={() => {}}
            onFolders={() => folders[0] && onOpenFolder(folders[0])}
            onAdmin={user?.role === "admin" ? onAdmin : null}
            footer={taskbarFooter}
          />
      </header>
      <div className="home-layout">
        <section className="home-content">
          <div className="home-heading-row">
            <div>
              <h1>
                {greeting}, <em>{displayName}</em>
              </h1>
            </div>
          </div>

          <div className="home-overview-grid">
            <section className="home-panel docs-panel">
              <div className="panel-title">
                <span className="panel-icon dark">
                  <Database size={17} />
                </span>
                <div>
                  <h2>Project overview</h2>
                  <p>
                    {folderCount} folders · {totalImages} assets
                  </p>
                </div>
                <ArrowUpRight size={17} />
              </div>
              <p className="panel-copy">
                Live folder and asset data for your project.
              </p>
              <div className="doc-list">
                <div>
                  <ImageIcon size={13} />
                  <span>Total images</span>
                  <b>{totalImages}</b>
                </div>
                <div>
                  <Folder size={13} />
                  <span>Active folders</span>
                  <b>{folderCount}</b>
                </div>
                <div>
                  <Database size={13} />
                  <span>Storage usage</span>
                  <b>{storagePercent}%</b>
                </div>
              </div>
              <div className="panel-footer">
                <span>
                  <span className="sync-dot" /> Live project data
                </span>
                <button onClick={onUpload}>
                  Upload files <ArrowUpRight size={13} />
                </button>
              </div>
            </section>

            <section className="home-panel folders-panel">
              <div className="panel-title">
                <span className="panel-icon">
                  <Folder size={18} />
                </span>
                <div>
                  <h2>Folders</h2>
                  <p>{folderCount} available</p>
                </div>
              </div>

              <div className="folder-grid">
                {folders.length ? (
                  folders.map((folder) => (
                    <button
                      className="folder-tile"
                      key={folder.id || folder.name}
                      onClick={() => onOpenFolder(folder)}
                    >
                      <span className={`folder-icon ${folder.color}`}>
                        <Folder size={15} />
                      </span>
                      <strong>{folder.name}</strong>
                      <small>{Number(folder.count || 0)} assets</small>
                    </button>
                  ))
                ) : (
                  <div className="empty-folder-state">
                    No accessible folders for this user.
                  </div>
                )}
              </div>

              <div className="storage-summary">
                <div>
                  <span>Storage utilization</span>
                  <strong>{storagePercent}%</strong>
                </div>
                <div className="storage-track">
                  <span style={{ width: `${storagePercent}%` }} />
                </div>
                <small>Usage updates from the current folder and asset counts.</small>
              </div>
            </section>

            <section className="home-panel organization-panel">
              <div className="panel-title">
                <span className="panel-icon">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <h2>Quick status</h2>
                  <p>{totalImages ? "Assets ready" : "No files uploaded yet"}</p>
                </div>
              </div>

              <div className="organization-links">
                <button onClick={onCreateFolder}>
                  <span>
                    <strong>Create folder</strong>
                    <small>{folderCount} folders available</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <button onClick={onUpload}>
                  <span>
                    <strong>Upload assets</strong>
                    <small>{totalImages} items already stored</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <button onClick={() => folders[0] && onOpenFolder(folders[0])}>
                  <Folder size={14} />
                  <span>
                    <strong>Open latest folder</strong>
                    <small>{folders[0]?.name || "No folder yet"}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          </div>

          <div className="home-lower-grid">
            <section className="home-panel activity-panel">
              <div className="activity-header">
                <h2>
                  <Clock3 size={17} /> Recent folders
                </h2>
              </div>
              <div className="activity-list">
                {activityItems.map(({ icon: Icon, title, detail, meta, tone }) => (
                  <button className="activity-row" key={title} onClick={() => onOpenFolder(folders.find((folder) => folder.name === title))}>
                    <span className={`activity-icon ${tone}`}>
                      <Icon size={14} />
                    </span>
                    <span className="activity-copy">
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                    <time>{meta}</time>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </section>

            <section className="home-panel health-panel">
              <div className="side-panel-title">
                <h2>Current usage</h2>
                <CheckCircle2 size={15} />
              </div>
              <strong>{totalImages}</strong>
              <span>{totalImages ? `${folderCount} folders with assets` : "Waiting for uploads"}</span>
              <div className="health-chart" aria-label="Storage activity graph">
                {Array.from({ length: 6 }).map((_, index) => (
                  <i
                    key={index}
                    style={{
                      height: `${Math.max(12, (totalImages || 12) / (index + 1) + (index * 8))}%`,
                    }}
                  />
                ))}
              </div>
              <div className="chart-labels">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Now</span>
              </div>
              <small>
                Usage level: <b>{storagePercent}%</b>
              </small>
            </section>
          </div>
        </section>
      </div>

    </main>
  );
}
