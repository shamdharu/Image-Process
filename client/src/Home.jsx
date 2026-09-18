import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  Layers3,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Moon,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import Taskbar from "./Taskbar";
import AiChat from "./AiChat";
import "./Home.css";

const activityItems = [
  {
    icon: Layers3,
    title: "Workspace is ready for review",
    detail: "Your shared image library is organized and up to date.",
    meta: "Just now",
    tone: "teal",
  },
  {
    icon: FolderOpen,
    title: "Browse your latest folders",
    detail: "Open a folder to continue working with image assets.",
    meta: "Today",
    tone: "blue",
  },
  {
    icon: CheckCircle2,
    title: "Sync health is excellent",
    detail: "All local changes are available in this workspace.",
    meta: "Today",
    tone: "green",
  },
  {
    icon: ShieldCheck,
    title: "Permissions are protected",
    detail: "Folder access follows your workspace role.",
    meta: "Yesterday",
    tone: "orange",
  },
];

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
  onOpenFolder,
  onUpload,
  onCreateFolder,
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const displayName = user?.username || user?.email?.split("@")[0] || "there";
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12
    ? "Good morning"
    : currentHour < 18
      ? "Good afternoon"
      : "Good evening";
  const folders = useMemo(() => {
    const roots = categories.filter((item) => !item.parentId).slice(0, 4);
    return roots.length
      ? roots.map((item, index) => ({
          ...item,
          color: fallbackFolders[index % fallbackFolders.length].color,
        }))
      : fallbackFolders;
  }, [categories]);
  const totalImages = categories.reduce(
    (sum, item) => sum + Number(item.count || 0),
    0,
  );
  const folderCount = categories.length || 24;
  const graphValues = [
    42,
    58,
    47,
    72,
    64,
    Math.min(96, 68 + (totalImages % 24)),
  ];
  const taskbarFooter = (
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
          <small>{user?.role === "admin" ? "Administrator" : "Editor"}</small>
        </span>
        <MoreHorizontal size={15} />
      </div>
    </>
  );

  return (
    <main className="home-page">
      <div className="home-layout">
        <aside className="home-sidebar">
          <Taskbar
            active="home"
            onHome={() => {}}
            onFolders={() => folders[0] && onOpenFolder(folders[0])}
            footer={taskbarFooter}
          />
        </aside>

        <section className="home-content">
          <div className="home-heading-row">
            <div>
              <h1>
                { greeting}, <em>{displayName}</em>
              </h1>
            </div>
            <div className="home-heading-actions">
              <label className="home-search">
                <Search size={15} />
                <input placeholder="Search resources, tags, files..." />
              </label>
              <button onClick={onCreateFolder}>
                <FolderOpen size={15} /> Folder
              </button>
              <button onClick={onUpload}>
                <Upload size={15} /> Upload
              </button>
              <button className="home-new-page" onClick={onCreateFolder}>
                <Plus size={15} /> New Page
              </button>
              <button
                className="home-spark-button"
                onClick={() => setChatOpen(true)}
                aria-label="Open AI assistant"
              >
                <Sparkles size={17} />
              </button>
            </div>
          </div>

          <div className="home-overview-grid">
            <section className="home-panel docs-panel">
              <div className="panel-title">
                <span className="panel-icon dark">
                  <BookOpen size={17} />
                </span>
                <div>
                  <h2>
                    Documentation <b>Active</b>
                  </h2>
                  <p>
                    {categories.length
                      ? `${categories.length} folders · ${totalImages} images`
                      : "128 articles · 6 drafts"}
                  </p>
                </div>
                <MoreHorizontal size={17} />
              </div>
              <p className="panel-copy">
                Centralized repository for design specifications, operational
                guides, and image collections.
              </p>
              <div className="doc-list">
                <div>
                  <BookOpen size={13} />
                  <span>Design System Guidelines v2</span>
                  <b>v2.4</b>
                </div>
                <div>
                  <ShieldCheck size={13} />
                  <span>API Auth Specs & Handshake</span>
                  <b className="ready">Ready</b>
                </div>
                <div>
                  <BookOpen size={13} />
                  <span>Onboarding Playbook 2025</span>
                  <b className="draft">Draft</b>
                </div>
                <div>
                  <ShieldCheck size={13} />
                  <span>Security & Compliance Standard</span>
                  <b className="review">Review</b>
                </div>
              </div>
              <div className="panel-footer">
                <span>
                  <span className="sync-dot" /> Syncing with local library
                </span>
                <button>
                  Browse all docs <ArrowUpRight size={13} />
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
                  <p>{folderCount} directories · 4 shared</p>
                </div>
                <MoreHorizontal size={17} />
              </div>
              <div className="folder-grid">
                {folders.map((folder) => (
                  <button
                    className="folder-tile"
                    key={folder.id}
                    onClick={() => onOpenFolder(folder)}
                  >
                    <span className={`folder-icon ${folder.color}`}>
                      <Folder size={15} />
                    </span>
                    <strong>{folder.name}</strong>
                    <small>
                      {Number(folder.count || folder.image_count || 0)} files
                    </small>
                  </button>
                ))}
              </div>
              <div className="storage-summary">
                <div>
                  <span>Storage utilization</span>
                  <strong>
                    {totalImages
                      ? `${Math.min(78, Math.max(24, Math.round(totalImages / 4)))}%`
                      : "35%"}
                  </strong>
                </div>
                <div className="storage-track">
                  <span />
                </div>
                <small>
                  <i className="client" /> Client <i className="brand" /> Brand{" "}
                  <i className="other" /> Other
                </small>
              </div>
            </section>

            <section className="home-panel organization-panel">
              <div className="panel-title">
                <span className="panel-icon">
                  <Users size={17} />
                </span>
                <div>
                  <h2>Organization</h2>
                  <p>8 Teams · 42 Workspaces</p>
                </div>
                <Settings2 size={16} />
              </div>
              <div className="organization-links">
                <button>
                  <Tag size={14} />
                  <span>
                    <strong>Tags & Metadata</strong>
                    <small>64 taxonomy entries</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button>
                  <ShieldCheck size={14} />
                  <span>
                    <strong>Team Permissions</strong>
                    <small>RBAC · Okta SSO</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button>
                  <Zap size={14} />
                  <span>
                    <strong>Workflows & Rules</strong>
                    <small>12 active triggers</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                <button>
                  <Clock3 size={14} />
                  <span>
                    <strong>Audit & Access Logs</strong>
                    <small>Real-time tracking</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>
              <button className="policy-button">
                <Users size={13} /> Workspace Policies
              </button>
            </section>
          </div>

          <div className="home-lower-grid">
            <section className="home-panel activity-panel">
              <div className="activity-header">
                <h2>
                  <Clock3 size={17} /> Recent Activity
                </h2>
                <div>
                  <button className="selected">All Logs</button>
                  <button>My Edits</button>
                  <button>Review Requests</button>
                </div>
              </div>
              <div className="activity-list">
                {activityItems.map(
                  ({ icon: Icon, title, detail, meta, tone }) => (
                    <button className="activity-row" key={title}>
                      <span className={`activity-icon ${tone}`}>
                        <Icon size={14} />
                      </span>
                      <span className="activity-copy">
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <time>{meta}</time>
                      <ChevronRight size={14} />
                    </button>
                  ),
                )}
              </div>
            </section>
            <div className="home-side-panels">
              <section className="home-panel pulse-panel">
                <div className="side-panel-title">
                  <h2>Workspace Live Pulse</h2>
                  <span>
                    <i /> 28 Active Now
                  </span>
                </div>
                <div className="people-stack">
                  <span>AM</span>
                  <span>SL</span>
                  <span>ER</span>
                  <span>MC</span>
                  <b>+24</b>
                </div>
                <p>
                  Real-time presence enabled via Imaginary Mesh Protocol.
                  Latency: 18ms.
                </p>
              </section>
              <section className="home-panel health-panel">
                <div className="side-panel-title">
                  <h2>Storage & Activity</h2>
                  <CheckCircle2 size={15} />
                </div>
                <strong>{totalImages || "99.98%"}</strong>
                <span>
                  {totalImages
                    ? `${totalImages} images across ${folderCount} folders`
                    : "Continuous Uptime"}
                </span>
                <div
                  className="health-chart"
                  aria-label="Workspace activity graph"
                >
                  {graphValues.map((value, index) => (
                    <i
                      key={`${value}-${index}`}
                      style={{ height: `${value}%` }}
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
                  Cache hit ratio: 94.2% <b>Healthy</b>
                </small>
              </section>
            </div>
          </div>
        </section>
      </div>
      {!chatOpen && (
        <button
          className="ai-chat-launcher"
          onClick={() => setChatOpen(true)}
          aria-label="Open Imaginary Assistant"
          title="Open Imaginary Assistant"
        >
          <MessageCircle size={21} />
          <span className="ai-chat-launcher-dot" />
        </button>
      )}
      <AiChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </main>
  );
}
