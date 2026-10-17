import Taskbar from './Taskbar'
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Aperture,
  Archive,
  Bell,
  Camera,
  Check,
  ChevronLeft,
  Clock3,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FileImage,
  Grid2X2,
  GripVertical,
  LayoutGrid,
  List,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings2,
  Shield,
  Sun,
  MoveVertical,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
  Copy,
} from "lucide-react";
import JSZip from "jszip";
import { menuConfig } from "./menuConfig";
import LoginPage from "./Loginpage";
import Home from "./Home";
import AdminDashboard from "./AdminDashboard";
import "./App.css";

const categoryKey = (number) => String(number).padStart(2, "0");

const previewSizes = [
  {
    key: "small",
    label: "Small preview",
    short: "Small",
    variant: "thumbnail",
  },
  { key: "medium", label: "Medium preview", short: "Medium", variant: "web" },
  { key: "large", label: "Large preview", short: "Large", variant: "web" },
  {
    key: "extra",
    label: "Extra large preview",
    short: "Extra large",
    variant: "web",
  },
];
const defaultPreviewSize = "medium";
const QUEUE_DISPLAY_LIMIT = 8;
const QUEUE_MAX = 40;
const previewSizeKeys = {
  "Small preview": "small",
  "Medium preview": "medium",
  "Large preview": "large",
  "Extra large preview": "extra",
};
const readPreviewSize = () => {
  const saved = window.localStorage.getItem("imagery.preview-size");
  return previewSizes.some((item) => item.key === saved)
    ? saved
    : defaultPreviewSize;
};
const previewSizeLabel = (size) =>
  previewSizes.find((item) => item.key === size)?.short ||
  previewSizes.find((item) => item.key === defaultPreviewSize).short;
const previewSizeOrder = ["small", "medium", "large", "extra"];
const resolutionVariants = {
  Thumbnail: "thumbnail",
  Web: "web",
  HD: "hd",
  Original: "original",
};
const tileSource = (image, size, resolution = null) => {
  const fallback =
    previewSizes.find((item) => item.key === size)?.variant || "web";
  const variant = resolution || fallback;
  return variant && typeof image.id === "number"
    ? `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/variants/${image.id}/${variant}`
    : image.src;
};
const fullSource = (image) =>
  typeof image.id === "number"
    ? `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/variants/${image.id}/hd`
    : image.src;

// Document ids mirror normalizeDocumentId() on the server: trimmed, and blank
// means "not supplied" rather than an empty string. Uploads require one, so
// these helpers gate the upload buttons and back up the server's 400.
const cleanDocumentId = (value) => (value || "").trim();

// Bulk uploads number the ids they generate, e.g. DSC-1, DSC-2, ... in the order
// the files were selected, so one prefix can label a whole batch.
const bulkDocumentId = (prefix, index) => {
  const base = cleanDocumentId(prefix);
  return base ? `${base}-${index + 1}` : "";
};

// Placement for the small fixed-position popovers (image / folder action menus).
// The menu hangs from the bottom-left (start) corner of the control that opened
// it, so it reads as growing out of the button instead of floating at a fixed
// guess. Near the right edge of the window it flips to right-alignment so it
// stays on screen, and it lifts above the anchor when there is no room below.
// Called before any early return so the hook order stays stable.
function useMenuPlacement(anchor, menuRef, open) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return undefined;
    const place = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const { offsetWidth: width, offsetHeight: height } = menu;
      if (!width || !height) return;
      const margin = 8;
      const gap = 6;
      // Start-corner alignment: the menu's left edge lines up with the button's
      // left edge and grows rightwards. Only when that would run past the right
      // edge of the window does it flip to right-alignment.
      let left = anchor.left;
      if (left + width > window.innerWidth - margin) left = anchor.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      let top = anchor.bottom + gap;
      if (top + height > window.innerHeight - margin) {
        const above = anchor.top - height - gap;
        top =
          above >= margin
            ? above
            : Math.max(margin, window.innerHeight - height - margin);
      }
      setPosition((current) =>
        current && current.left === left && current.top === top
          ? current
          : { left, top },
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, menuRef, open]);
  return position;
}

// Vite serves the client on :5173 and the API on :4000, so every call is
// cross-origin and has to opt in to sending the imagery_session cookie.
// Without credentials:'include' the browser strips the cookie and the server's
// requireAuth/requirePermission middleware answers 401 Unauthorized.
const apiFetch = (path, options = {}) =>
  fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}${path}`, { credentials: "include", ...options });

// Mirrors EMAIL_PATTERN in server/src/routes/users.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Folder creation remains an admin-only File-menu action.
const ADMIN_ONLY_MENU_ROWS = new Set(["New Category"]);

const readCategoryOrder = () => {
  try {
    return JSON.parse(
      window.localStorage.getItem("imagery.category-order") || "{}",
    );
  } catch {
    return {};
  }
};
const writeCategoryOrder = (map) => {
  try {
    window.localStorage.setItem("imagery.category-order", JSON.stringify(map));
  } catch {}
};
const readPreviewEnabled = () => {
  try {
    const saved = window.localStorage.getItem("imagery.preview-enabled");
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {}
  return true;
};

// ---- Organizations (sidebar tab) ----------------------------------------
// Organizations live in the database now (Organization table) and each folder
// belongs to exactly one of them, so selecting an org filters the folder list.
// The list itself comes from GET /api/organizations; only the selection is
// remembered locally.
const orgInitials = (name) => (name || "?").trim().slice(0, 2).toUpperCase();

function buildCategoryTree(categories) {
  const nodes = categories.map((category) => ({ ...category, children: [] }));
  const byId = new Map(
    nodes.map((category) => [String(category.id), category]),
  );
  const roots = [];
  nodes.forEach((category) => {
    const parent = category.parentId
      ? byId.get(String(category.parentId))
      : null;
    if (parent) parent.children.push(category);
    else roots.push(category);
  });
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  roots.sort(byOrder);
  nodes.forEach((category) => category.children.sort(byOrder));
  return roots;
}

function getCategoryPath(category, categories) {
  if (!category) return [];
  const byId = new Map(categories.map((item) => [String(item.id), item]));
  const path = [];
  const visited = new Set();
  let current = category;
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    path.unshift(current);
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return path;
}

// ---- Folder-as-ZIP download helpers -------------------------------------

// Every category (this one + all nested subfolders), collected recursively.
function collectDescendantIds(rootId, categories) {
  const direct = categories
    .filter((item) => String(item.parentId || "") === String(rootId))
    .map((item) => item.id);
  return direct.flatMap((id) => [id, ...collectDescendantIds(id, categories)]);
}

// Builds the folder's path inside the zip relative to the folder being downloaded,
// e.g. downloading "Trips" and zipping "Trips/Japan/Tokyo" gives "Japan/Tokyo".
function relativeFolderPath(cat, categories, rootId) {
  const byId = new Map(categories.map((item) => [String(item.id), item]));
  const parts = [];
  let current = cat;
  while (current && String(current.id) !== String(rootId)) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return parts.join("/");
}

// Downloads a category and every nested subfolder as a single ZIP, preserving
// the folder structure and each image's real filename.
async function downloadCategoryAsZip(rootCategory, categories, onProgress) {
  const descendantIds = collectDescendantIds(rootCategory.id, categories);
  const allCats = categories.filter(
    (item) => item.id === rootCategory.id || descendantIds.includes(item.id),
  );
  const zip = new JSZip();
  let done = 0;
  let total = 0;

  // Fetch each folder's image list up front so progress reflects the real total.
  const perFolder = await Promise.all(
    allCats.map(async (cat) => {
      const response = await apiFetch(`/api/images?categoryId=${cat.id}`);
      const items = response.ok ? await response.json() : [];
      total += items.length;
      return { cat, items };
    }),
  );

  onProgress?.(2);

  for (const { cat, items } of perFolder) {
    const relPath = relativeFolderPath(cat, categories, rootCategory.id);
    const folder = relPath ? zip.folder(relPath) : zip;
    for (const item of items) {
      try {
        const fileRes = await apiFetch(`/api/variants/${item.id}/original`);
        if (fileRes.ok) {
          const blob = await fileRes.blob();
          folder.file(item.original_name, blob);
        }
      } catch {
        // Skip files that fail to fetch rather than aborting the whole zip.
      }
      done += 1;
      onProgress?.(2 + Math.round((done / Math.max(total, 1)) * 88));
    }
  }

  const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
    onProgress?.(90 + Math.round(metadata.percent * 0.1));
  });
  const href = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${rootCategory.name}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ---------------------------------------------------------------------------

function MenuRow({
  item,
  canDownload,
  subOpen,
  setSubOpen,
  previewSizeKey,
  activeView,
  activeResolution,
  onClose,
  onUpload,
  setWebcamOpen,
  onViewChange,
  onPreviewSize,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onResolution,
  onProperties,
  onPrint,
  onDownloadEntry,
}) {
  const hasSubmenu = Boolean(item.submenu);
  const isSubOpen = subOpen === item.label;
  // Rows that need download rights are greyed out and inert without them.
  const isDisabled = item.permission === "download" && !canDownload;
  const isChecked =
    (item.label === "Gallery / Grid view" && activeView === "grid") ||
    (item.label === "List view" && activeView === "list");
  const handleSelect = () => {
    if (item.permission === "download" && !canDownload) return;
    if (item.label === "New Category")
      window.dispatchEvent(new Event("new-category"));
    else if (item.label === "Open Category")
      window.dispatchEvent(new Event("open-category"));
    else if (item.label === "Recent Categories")
      window.dispatchEvent(new Event("recent-categories"));
    else if (item.label === "Gallery / Grid view") onViewChange("grid");
    else if (item.label === "List view") onViewChange("list");
    else if (item.label === "Zoom In") onZoomIn();
    else if (item.label === "Zoom Out") onZoomOut();
    else if (item.label === "Fit to Screen") onFitToScreen();
    else if (item.label === "Properties") onProperties();
    else if (item.label.startsWith("Print")) onPrint();
    else if (item.label.includes("Webcam")) setWebcamOpen(true);
    else if (item.label.includes("Upload")) onUpload();
    else if (
      item.label === "Sign Out and Exit" ||
      item.label === "Exit Application" ||
      item.label === "Lock Screen"
    )
      window.dispatchEvent(new Event("sign-out"));
    onClose();
  };
  return (
    <div
      className={`dropdown-row ${isDisabled ? "disabled" : ""} ${isChecked ? "checked" : ""} ${hasSubmenu && isSubOpen ? "sub-open" : ""}`}
      onMouseEnter={() =>
        setSubOpen(hasSubmenu && !isDisabled ? item.label : null)
      }
      onClick={() => {
        if (isDisabled) return;
        if (hasSubmenu) {
          setSubOpen(isSubOpen ? null : item.label);
          return;
        }
        handleSelect();
      }}
    >
      <span>{item.label}</span>
      {isChecked ? (
        <Check size={13} />
      ) : (
        item.submenu && <ChevronRight size={13} />
      )}
      {hasSubmenu && isSubOpen && (
        <div
          className="dropdown submenu"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {item.submenu.map((entry) => {
            const entryActive =
              (item.label === "Preview Size" &&
                previewSizeKeys[entry] === previewSizeKey) ||
              (item.label === "Resolution selector" &&
                activeResolution === entry);
            return (
              <div
                key={entry}
                className={`dropdown-row ${entryActive ? "checked" : ""}`}
                onClick={() => {
                  if (item.label === "Preview Size") onPreviewSize(entry);
                  else if (item.label === "Resolution selector")
                    onResolution(entry);
                  else if (item.label === "Download") onDownloadEntry(entry);
                  onClose();
                }}
              >
                <span>{entry}</span>
                {entryActive && <Check size={13} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MenuBar({
  onUpload,
  onHome = () => window.dispatchEvent(new Event("go-home")),
  onThemeToggle = () => {},
  theme = "light",
  user,
  canDownload = true,
  isAdmin = false,
  onViewChange = () => {},
  onPreviewSize = () => {},
  onZoomIn = () => {},
  onZoomOut = () => {},
  onFitToScreen = () => {},
  onResolution = () => {},
  onProperties = () => {},
  onPrint = () => {},
  onDownloadEntry = () => {},
  onAdmin = null,
  previewSizeKey = "medium",
  activeView = "grid",
  activeResolution = null,
}) {
  const [open, setOpen] = useState(null);
  const [subOpen, setSubOpen] = useState(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const openMenu = (index) => {
    setOpen(index);
    setSubOpen(null);
  };
  useEffect(() => {
    if (open === null) return undefined;
    // 'open' is null | nav index | 'profile'. Everything that belongs to an open
    // menu counts as "inside" for the click-outside-to-close check: the nav
    // dropdowns, plus — in the sidebar footer — the "..." chip and its popup.
    // The chip must be listed or a mousedown on it closes the menu first and
    // the click that follows re-opens it, so the second click never closes it.
    const insideMenu = (target) =>
      Boolean(
        target.closest(".menu-wrap") ||
          target.closest(".profile-wrap") ||
          target.closest(".taskbar-profile-more") ||
          target.closest(".sidebar-profile-menu"),
      );
    const closeMenu = (event) => {
      if (!insideMenu(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
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
          {(user?.username || user?.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{user?.username || "Guest"}</strong>
          <small>{user?.role === "admin" ? "Administrator" : "Editor"}</small>
        </span>
        <button
          className="taskbar-profile-more"
          onClick={() => setOpen(open === "profile" ? null : "profile")}
          aria-label="Open profile menu"
        >
          <MoreHorizontal size={15} />
        </button>
        {open === "profile" && (
          <ProfileMenu
            onSignOut={() => {
              setOpen(null);
              window.dispatchEvent(new Event("sign-out"));
            }}
          />
        )}
      </div>
    </>
  );
  return (
    <>
      <header className="topbar">
        <Taskbar
          active="folders"
          onHome={onHome}
          onFolders={() => {}}
          onAdmin={isAdmin ? onAdmin : null}
          footer={footer}
        >
          <button className="mobile-menu icon-button">
            <Menu size={18} />
          </button>
          <nav className="menus">
            {menuConfig.map((menu, index) => (
              <div
                className="menu-wrap"
                key={menu.label}
                onMouseEnter={() =>
                  open !== null && open !== "profile" && openMenu(index)
                }
              >
                <button
                  className={`menu-button ${open === index ? "active" : ""}`}
                  onClick={() => {
                    const next = open === index ? null : index;
                    if (next !== null)
                      window.dispatchEvent(new Event("close-popovers"));
                    if (next === null) {
                      setOpen(null);
                      setSubOpen(null);
                    } else {
                      openMenu(next);
                    }
                  }}
                >
                  {menu.label}
                  <ChevronDown size={12} />
                </button>
                {open === index && (
                  <div className="dropdown">
                    {menu.items
                      .filter(
                        (item) =>
                          isAdmin || !ADMIN_ONLY_MENU_ROWS.has(item.label),
                      )
                      .map((item) => (
                        <MenuRow
                          key={item.label}
                          item={item}
                          canDownload={canDownload}
                          subOpen={subOpen}
                          setSubOpen={setSubOpen}
                          previewSizeKey={previewSizeKey}
                          activeView={activeView}
                          activeResolution={activeResolution}
                          onClose={() => {
                            setOpen(null);
                            setSubOpen(null);
                          }}
                          onUpload={onUpload}
                          setWebcamOpen={setWebcamOpen}
                          onViewChange={onViewChange}
                          onPreviewSize={onPreviewSize}
                          onZoomIn={onZoomIn}
                          onZoomOut={onZoomOut}
                          onFitToScreen={onFitToScreen}
                          onResolution={onResolution}
                          onProperties={onProperties}
                          onPrint={onPrint}
                          onDownloadEntry={onDownloadEntry}
                        />
                      ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </Taskbar>
      </header>
      {webcamOpen && (
        <WebcamDialog
          onCancel={() => setWebcamOpen(false)}
          onCapture={(file) => {
            setWebcamOpen(false);
            window.dispatchEvent(
              new CustomEvent("webcam-captured", { detail: file }),
            );
          }}
        />
      )}
    </>
  );
}

// ---- Organization dialog & panel -----------------------------------------
// Mirrors CategoryDialog's shape/behaviour so it feels like the same "New
// folder" creation flow, just scoped to organizations instead of folders.
function OrganizationDialog({
  open,
  name,
  setName,
  onCancel,
  onConfirm,
  editing = false,
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">
              {editing ? "EDIT ORGANIZATION" : "NEW ORGANIZATION"}
            </p>
            <h2>{editing ? "Rename organization" : "Create organization"}</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <label className="dialog-label">
          Organization name
          <input
            autoFocus
            placeholder="For example, Acme Studio"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onConfirm()}
          />
        </label>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={!name.trim()}
            onClick={onConfirm}
          >
            {editing ? <Edit3 size={15} /> : <Plus size={15} />}{" "}
            {editing ? "Save name" : "Create organization"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrganizationDeleteDialog({ organization, onCancel, onConfirm }) {
  if (!organization) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">DELETE ORGANIZATION</p>
            <h2>Delete organization?</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          This will remove <strong>{organization.name}</strong> from this
          workspace.
        </p>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="delete-button" onClick={onConfirm}>
            <Trash2 size={15} /> Delete organization
          </button>
        </div>
      </div>
    </div>
  );
}

function OrganizationPanel({
  organizations,
  selectedOrgId,
  setSelectedOrgId,
  onAdd,
  onEdit,
  onDelete,
  onOpen = null,
  isAdmin = false,
}) {
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);
  const position = useMenuPlacement(
    openMenu?.anchor,
    menuRef,
    Boolean(openMenu),
  );
  useEffect(() => {
    if (openMenu === null) return undefined;
    const closeMenu = (event) => {
      if (
        !event.target.closest(".org-actions") &&
        !event.target.closest(".image-action-menu")
      )
        setOpenMenu(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [openMenu]);
  return (
    <>
      <div className="category-heading category-heading-only">
        <span>Organizations</span>
        <span className="category-count">{organizations.length}</span>
      </div>
      <div className="org-list">
        {organizations.map((org) => {
          const selected = String(selectedOrgId) === String(org.id);
          return (
            <div
              key={org.id}
              className={`org-card ${selected ? "selected" : ""}`}
              onClick={(event) => {
                // Selecting an organization scopes the folder list to it and
                // slides the folders layer in. stopPropagation keeps the
                // shrunken organizations layer from treating this as "go back".
                event.stopPropagation();
                setSelectedOrgId(org.id);
                onOpen?.(org);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setSelectedOrgId(org.id);
                onOpen?.(org);
              }}
            >
              <span className="org-mark">{orgInitials(org.name)}</span>
              <span className="org-info">
                <strong>{org.name}</strong>
                <span>
                  {org.foldersCount ?? 0} folder
                  {(org.foldersCount ?? 0) === 1 ? "" : "s"}
                </span>
              </span>
              {isAdmin && (
                <div className="org-actions">
                  <button
                    type="button"
                    className="org-more"
                    aria-label={`Options for ${org.name}`}
                    title="Organization options"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (openMenu?.id === org.id) {
                        setOpenMenu(null);
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      setOpenMenu({
                        id: org.id,
                        anchor: {
                          left: rect.left,
                          right: rect.right,
                          top: rect.top,
                          bottom: rect.bottom,
                        },
                      });
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenu?.id === org.id && (
                    <div
                      ref={menuRef}
                      className="image-action-menu org-action-menu"
                      style={{
                        left: position?.left ?? openMenu.anchor.left,
                        top: position?.top ?? openMenu.anchor.bottom + 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenu(null);
                          onEdit(org);
                        }}
                      >
                        <Edit3 size={14} /> Rename
                      </button>
                      <button
                        type="button"
                        className="danger-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenu(null);
                          onDelete(org);
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {organizations.length === 0 && (
        <p className="category-empty">No organizations yet</p>
      )}
      {isAdmin && (
        <button className="new-category" onClick={onAdd}>
          <Plus size={14} /> New organization
        </button>
      )}
    </>
  );
}

function Sidebar({
  categories,
  selected,
  setSelected,
  onAdd,
  onAddChild,
  onReorder,
  onDownloadFolder,
  isAdmin = false,
  canDownloadIn = () => true,
  canManageIn = () => true,
  onEdit = (category) =>
    window.dispatchEvent(
      new CustomEvent("edit-category", { detail: category }),
    ),
  onDelete = (category) =>
    window.dispatchEvent(
      new CustomEvent("delete-category", { detail: category }),
    ),
  organizations = [],
  selectedOrgId = null,
  setSelectedOrgId = () => {},
  onAddOrganization = () => {},
  onEditOrganization = () => {},
  onDeleteOrganization = () => {},
  // Notifies the parent so the workspace can widen the sidebar column (the
  // image playground shrinks) while the folders layer is open.
  onFoldersLayerChange = () => {},
  // Folder keys ("01", "02", ...) in most-recently-opened order, for
  // FILE > Recent Categories.
  recentCategoryKeys = [],
  // Folders shown in the drawer are already scoped to the selected org by the
  // parent, which fetches /api/categories?organizationId=...
}) {
  const [categorySearch, setCategorySearch] = useState("");
  const [chooserTitle, setChooserTitle] = useState(null);
  const [categoryAction, setCategoryAction] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // Sidebar always shows organizations; picking one slides the folders drawer
  // in over the list. drawerClosing keeps the slide-out transition (grid
  // shrink + content fade) running before the drawer unmounts; the timer is
  // tracked so a quick re-open cancels it instead of being closed by it.
  const [drawerOrg, setDrawerOrg] = useState(null);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const drawerCloseTimer = useRef(null);
  const closeFolderDrawer = () => {
    setDrawerClosing(true);
    onFoldersLayerChange(false);
    // The CSS close transition runs .26s (starting a frame after commit), so
    // wait past it before unmounting: at 260ms the content could unmount while
    // the column still had width, flashing an empty/glitched bar for a frame.
    // 320ms biases late — the column is already 0 wide by then, so waiting
    // extra is invisible while unmounting early is not.
    clearTimeout(drawerCloseTimer.current);
    drawerCloseTimer.current = setTimeout(() => {
      setDrawerOrg(null);
      setDrawerClosing(false);
      drawerCloseTimer.current = null;
    }, 320);
  };
  // If the org whose drawer is open gets deleted elsewhere, slide it away.
  useEffect(() => {
    if (
      drawerOrg &&
      !organizations.some((org) => String(org.id) === String(drawerOrg.id))
    )
      closeFolderDrawer();
  }, [organizations, drawerOrg]);
  // Drop the pending close timer if the workspace unmounts mid-animation.
  useEffect(() => () => clearTimeout(drawerCloseTimer.current), []);

  useEffect(() => {
    const openCategory = () => setChooserTitle("Open category");
    const openRecent = () => setChooserTitle("Recent categories");
    window.addEventListener("open-category", openCategory);
    window.addEventListener("recent-categories", openRecent);
    return () => {
      window.removeEventListener("open-category", openCategory);
      window.removeEventListener("recent-categories", openRecent);
    };
  }, []);

  useEffect(() => {
    if (!categoryAction) return undefined;
    const closeMenu = (event) => {
      if (
        !event.target.closest(".image-action-menu") &&
        !event.target.closest(".category-more")
      )
        setCategoryAction(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [categoryAction]);

  // Auto-open every parent of the selected folder so the selection is always visible
  useEffect(() => {
    if (!selected) return;
    const byId = new Map(categories.map((item) => [String(item.id), item]));
    let current = categories.find(
      (item) => categoryKey(item.number) === selected,
    );
    const toOpen = [];
    while (current?.parentId) {
      const parent = byId.get(String(current.parentId));
      if (!parent || toOpen.includes(parent.id)) break;
      toOpen.push(parent.id);
      current = parent;
    }
    if (toOpen.length)
      setExpanded((prev) => {
        const next = new Set(prev);
        toOpen.forEach((id) => next.add(id));
        return next;
      });
  }, [selected, categories]);

  const searchTerm = categorySearch.trim().toLowerCase();
  const matchesSearch = (category) =>
    !searchTerm ||
    category.name.toLowerCase().includes(searchTerm) ||
    category.children.some(matchesSearch);
  const tree = buildCategoryTree(categories).filter(matchesSearch);
  const toggleExpand = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canDrag = Boolean(onReorder) && !searchTerm;
  const handleDragStart = (event, category) => {
    event.stopPropagation();
    setDraggedId(category.id);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", String(category.id));
    } catch {}
  };
  const handleDragEnter = (event, category) => {
    if (draggedId == null || draggedId === category.id) return;
    event.preventDefault();
    setDragOverId(category.id);
  };
  const handleDragOver = (event, category) => {
    if (draggedId == null || draggedId === category.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (event, category) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedId != null && draggedId !== category.id)
      onReorder?.(draggedId, category.id);
    setDraggedId(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const renderCategory = (category, depth = 0) => {
    const key = categoryKey(category.number);
    const visibleChildren = category.children.filter(matchesSearch);
    const hasChildren = visibleChildren.length > 0;
    const isOpen = Boolean(searchTerm) || expanded.has(category.id);
    // Ancestor-only folders (no grant of their own) get no action menu, so the
    // "..." trigger stays hidden instead of opening an empty popover.
    const canDownload = canDownloadIn(key);
    const canManage = canManageIn(key);
    return (
      <div className="category-tree-row" key={category.id || category.number}>
        <div
          className={`category-item ${selected === key ? "selected" : ""} ${draggedId === category.id ? "dragging" : ""} ${dragOverId === category.id ? "drag-over" : ""}`}
          style={{ "--depth": depth }}
          draggable={canDrag}
          onDragStart={
            canDrag ? (event) => handleDragStart(event, category) : undefined
          }
          onDragEnter={
            canDrag ? (event) => handleDragEnter(event, category) : undefined
          }
          onDragOver={
            canDrag ? (event) => handleDragOver(event, category) : undefined
          }
          onDrop={canDrag ? (event) => handleDrop(event, category) : undefined}
          onDragEnd={canDrag ? handleDragEnd : undefined}
        >
          {canDrag && (
            <GripVertical
              size={13}
              className="drag-handle"
              title="Drag to reorder"
            />
          )}
          {hasChildren ? (
            <button
              type="button"
              className={`tree-caret ${isOpen ? "open" : ""}`}
              aria-expanded={isOpen}
              title={isOpen ? "Collapse folder" : "Expand folder"}
              onClick={(event) => {
                event.stopPropagation();
                toggleExpand(category.id);
              }}
            >
              <ChevronRight size={13} />
            </button>
          ) : (
            <span className="tree-caret empty" />
          )}
          <div
            className="category-select"
            role="button"
            tabIndex={0}
            onClick={() => {
              setSelected(key);
              if (hasChildren && !expanded.has(category.id))
                toggleExpand(category.id);
            }}
            onDoubleClick={() => {
              if (hasChildren) toggleExpand(category.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelected(key);
              }
              if (event.key === "ArrowRight" && hasChildren && !isOpen) {
                event.preventDefault();
                toggleExpand(category.id);
              }
              if (event.key === "ArrowLeft" && hasChildren && isOpen) {
                event.preventDefault();
                toggleExpand(category.id);
              }
            }}
          >
            <span className="category-name category-name-bold">
              {category.name}
              <small className="category-meta">
                {category.count} image{category.count === 1 ? "" : "s"}
                {hasChildren ? ` • ${visibleChildren.length} folder${visibleChildren.length === 1 ? "" : "s"}` : ""}
              </small>
            </span>
          </div>
          {(canDownload || canManage) && (
            <button
              className="category-more icon-button"
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setCategoryAction((current) =>
                  current?.category?.id === category.id
                    ? null
                    : {
                        category,
                        anchor: {
                          left: rect.left,
                          right: rect.right,
                          top: rect.top,
                          bottom: rect.bottom,
                        },
                      },
                );
              }}
            >
              <MoreVertical size={14} />
            </button>
          )}
        </div>
        {hasChildren && isOpen && (
          <div className="category-children">
            {visibleChildren.map((child) => renderCategory(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside className="sidebar">
        <OrganizationPanel
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          setSelectedOrgId={setSelectedOrgId}
          onAdd={onAddOrganization}
          onEdit={onEditOrganization}
          onDelete={onDeleteOrganization}
          onOpen={(org) => {
            // Cancel a pending close so opening during the close animation
            // doesn't get ripped shut by the old timeout.
            clearTimeout(drawerCloseTimer.current);
            drawerCloseTimer.current = null;
            setSelectedOrgId(org.id);
            setDrawerOrg(org);
            onFoldersLayerChange(true);
          }}
          isAdmin={isAdmin}
        />
        {categoryAction && (
          <CategoryActionMenu
            action={categoryAction}
            canDownload={canDownloadIn(
              categoryKey(categoryAction.category.number),
            )}
            canManage={canManageIn(categoryKey(categoryAction.category.number))}
            onAddChild={(category) => {
              onAddChild(category);
              setCategoryAction(null);
            }}
            onEdit={(category) => {
              onEdit(category);
              setCategoryAction(null);
            }}
            onDownload={(category) => {
              onDownloadFolder(category);
              setCategoryAction(null);
            }}
            onDelete={(category) => {
              onDelete(category);
              setCategoryAction(null);
            }}
          />
        )}
        {chooserTitle && (
          <CategoryChooserDialog
            title={chooserTitle}
            categories={
              chooserTitle === "Recent categories"
                ? recentCategoryKeys
                    .map((key) =>
                      categories.find(
                        (item) => categoryKey(item.number) === key,
                      ),
                    )
                    .filter(Boolean)
                : categories
            }
            emptyText={
              chooserTitle === "Recent categories"
                ? "No recent categories yet"
                : undefined
            }
            onSelect={(number) => {
              setSelected(categoryKey(number));
              setChooserTitle(null);
            }}
            onClose={() => setChooserTitle(null)}
          />
        )}
      </aside>
      <section
        className={`folders-column ${drawerOrg ? "open" : ""} ${drawerClosing ? "closing" : ""}`}
        aria-hidden={!drawerOrg}
      >
        {drawerOrg && (
          <>
            <div className="category-heading category-heading-only">
              <span className="folders-heading-left">
                <button
                  className="icon-button folders-back"
                  onClick={() => closeFolderDrawer()}
                  aria-label="Back to organizations"
                  title="Back to organizations"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>Folders</span>
              </span>
              <span className="category-count">{categories.length}</span>
            </div>
            <label className="category-search">
              <Search size={13} />
              <input
                placeholder="Search folders"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
              />
            </label>
            <div className="category-list">
              {tree.map((category) => renderCategory(category))}
            </div>
            {tree.length === 0 && (
              <p className="category-empty">No folders in {drawerOrg.name}</p>
            )}
            {isAdmin && (
              <button
                className="new-category"
                onClick={onAdd}
                disabled={!selectedOrgId}
                title={
                  selectedOrgId == null
                    ? "Create an organization first"
                    : undefined
                }
              >
                <Plus size={14} /> New folder
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

function UploadDialog({
  file,
  categories,
  category,
  setCategory,
  name,
  setName,
  documentId,
  setDocumentId,
  documentIdTaken = false,
  onCancel,
  onConfirm,
}) {
  const [categorySearch, setCategorySearch] = useState("");
  const [format, setFormat] = useState("original");
  if (!file) return null;
  const matches = categories.filter((item) =>
    item.name.toLowerCase().includes(categorySearch.toLowerCase()),
  );
  return (
    <div className="modal-backdrop">
      <div className="upload-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">ADD IMAGE</p>
            <h2>Upload to workspace</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-preview">
          <img src={URL.createObjectURL(file)} alt="Upload preview" />
        </div>
        <div className="dialog-file">
          <FileImage size={18} />
          <div>
            <strong>{file.name}</strong>
            <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
          </div>
        </div>
        <div className="dialog-columns">
          <div className="dialog-col">
            <label className="dialog-label">
              Image name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="dialog-label required">
              Document ID *
              <input
                required
                placeholder="e.g. DOC-2024-001"
                value={documentId}
                onChange={(event) => setDocumentId(event.target.value)}
              />
            </label>
            {documentIdTaken ? (
              <p className="dialog-hint dialog-hint-error">
                That document ID is already used by another image in this
                folder.
              </p>
            ) : (
              <p className="dialog-hint">Required</p>
            )}
            <label className="dialog-label">
              Upload format
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                <option value="original">Original format</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
          </div>
          <div className="dialog-col">
            <label className="dialog-label dialog-label-tight">
              Search category
              <input
                placeholder="Search categories"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
              />
            </label>
            <div className="category-selection-label">
              {category ? "Selected category" : "Select a category"}
            </div>
            <div className="category-results">
              {matches.map((item) => {
                const chosen = category === String(item.id);
                return (
                  <button
                    className={chosen ? "chosen" : ""}
                    key={item.id}
                    onClick={() => setCategory(String(item.id))}
                  >
                    <span>{String(item.number).padStart(2, "0")}</span>
                    <strong>{item.name}</strong>
                    {chosen && (
                      <>
                        <em>Selected</em>
                        <Check size={14} />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={
              !category ||
              !name.trim() ||
              !cleanDocumentId(documentId) ||
              documentIdTaken
            }
            onClick={() => onConfirm(format)}
          >
            <Upload size={15} /> Add image
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkUploadDialog({
  files,
  categories,
  category,
  setCategory,
  documentPrefix,
  setDocumentPrefix,
  onCancel,
  onConfirm,
}) {
  const [categorySearch, setCategorySearch] = useState("");
  const [format, setFormat] = useState("original");
  if (!files || files.length === 0) return null;
  const matches = categories.filter((item) =>
    item.name.toLowerCase().includes(categorySearch.toLowerCase()),
  );
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const preview = files.slice(0, 6);
  return (
    <div className="modal-backdrop">
      <div className="upload-dialog bulk-upload-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">BULK UPLOAD</p>
            <h2>Upload {files.length} images</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="bulk-summary">
          <span>{files.length} files selected</span>
          <span>{(totalSize / 1024 / 1024).toFixed(2)} MB total</span>
        </div>
        <div className="bulk-file-list">
          {preview.map((file, index) => (
            <div className="bulk-file-row" key={`${file.name}-${index}`}>
              <FileImage size={14} />
              <span>{file.name}</span>
              <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
            </div>
          ))}
          {files.length > preview.length && (
            <div className="bulk-file-more">
              + {files.length - preview.length} more files
            </div>
          )}
        </div>
        <div className="dialog-columns">
          <div className="dialog-col">
            <label className="dialog-label dialog-label-tight required">
              Document ID prefix *
              <input
                required
                placeholder="e.g. DSC"
                value={documentPrefix}
                onChange={(event) => setDocumentPrefix(event.target.value)}
              />
            </label>
            <p className="dialog-hint">
              Each image is numbered in selection order, for example{" "}
              {cleanDocumentId(documentPrefix) || "DOC"}-1,{" "}
              {cleanDocumentId(documentPrefix) || "DOC"}-2. A prefix is
              required so every image gets a document ID.
            </p>
            <label className="dialog-label">
              Upload format (applies to all)
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value)}
              >
                <option value="original">Original format</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
          </div>
          <div className="dialog-col">
            <label className="dialog-label dialog-label-tight">
              Search category
              <input
                placeholder="Search categories"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
              />
            </label>
            <div className="category-selection-label">
              {category ? "Selected category" : "Select a category"}
            </div>
            <div className="category-results">
              {matches.map((item) => {
                const chosen = category === String(item.id);
                return (
                  <button
                    className={chosen ? "chosen" : ""}
                    key={item.id}
                    onClick={() => setCategory(String(item.id))}
                  >
                    <span>{String(item.number).padStart(2, "0")}</span>
                    <strong>{item.name}</strong>
                    {chosen && (
                      <>
                        <em>Selected</em>
                        <Check size={14} />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={!category || !cleanDocumentId(documentPrefix)}
            onClick={() => onConfirm(format)}
          >
            <Upload size={15} /> Upload {files.length} images
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentIdDialog({
  image,
  value,
  setValue,
  error,
  saving,
  onCancel,
  onSave,
}) {
  if (!image) return null;
  return (
    <div className="modal-backdrop">
      <div className="upload-dialog document-id-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">DOCUMENT ID</p>
            <h2>Edit document ID</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-file">
          <FileImage size={18} />
          <div>
            <strong>{image.name}</strong>
            <small>
              {typeof image.id === "number"
                ? `Image #${image.id}`
                : "Still uploading - saved locally"}
            </small>
          </div>
        </div>
        <label className="dialog-label">
          Document ID
          <input
            autoFocus
            placeholder="e.g. DOC-2024-001"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onSave()}
          />
        </label>
        <p className="dialog-hint">
          Document IDs must be unique within a folder, but the same ID can be
          used in different folders. Leave the field blank to clear the
          document ID for this image.
        </p>
        {error && (
          <p
            className="format-note"
            style={{ color: "#b24f52", marginTop: 10 }}
          >
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="upload-button" disabled={saving} onClick={onSave}>
            <Check size={15} /> {saving ? "Saving…" : "Save document ID"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DownloadDialog({ image, onCancel, onDownload }) {
  const [format, setFormat] = useState("original");
  if (!image) return null;
  return (
    <div className="modal-backdrop">
      <div className="download-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">EXPORT IMAGE</p>
            <h2>Download image</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <div className="download-preview">
          <img src={image.src} alt={image.name} />
        </div>
        <strong className="download-name">{image.name}</strong>
        <label className="dialog-label">
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="original">Original file</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="heic">HEIC</option>
          </select>
        </label>
        <small className="format-note">
          PNG, JPEG, and WebP are converted in your browser. HEIC downloads the
          original file.
        </small>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="upload-button" onClick={() => onDownload(format)}>
            <Download size={15} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

function FullscreenPreview({ image, zoom, setZoom, onClose }) {
  const [sharpReady, setSharpReady] = useState(false);
  const [sharpFailed, setSharpFailed] = useState(false);

  useEffect(() => {
    if (!image) return undefined;
    setSharpFailed(false);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [image, onClose]);

  if (!image) return null;
  const zoomed = zoom !== 100;
  const source = sharpReady ? fullSource(image) : image.src;

  return (
    <div
      className="fullscreen-preview"
      onDoubleClick={(event) => {
        if (
          !event.target.closest(".fullscreen-bar") &&
          event.target.tagName !== "IMG"
        )
          onClose();
      }}
    >
      <div className="fullscreen-bar">
        <div>
          <p className="eyebrow">FULL SCREEN PREVIEW</p>
          <strong>{image.name}</strong>
        </div>
        <div className="fullscreen-actions">
          {!sharpReady && !sharpFailed && (
            <span className="fullscreen-hint">Loading full resolution…</span>
          )}
          <span className="zoom-readout">{zoom}%</span>
          <button
            className="icon-button"
            onClick={() => setZoom(100)}
            title="Fit to screen"
          >
            Fit
          </button>
          <button
            className="icon-button"
            onClick={() => setZoom(Math.max(50, zoom - 25))}
            title="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setZoom(Math.min(300, zoom + 25))}
            title="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
          <button
            className="icon-button"
            onClick={onClose}
            title="Close full screen"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className={`fullscreen-stage ${zoomed ? "zoomed" : ""}`}>
        <img
          src={source}
          alt={image.name}
          draggable={false}
          onDoubleClick={() => setZoom(zoom === 100 ? 200 : 100)}
          onLoad={(event) => {
            if (event.currentTarget.src.includes("/hd")) setSharpReady(true);
          }}
          onError={(event) => {
            if (event.currentTarget.src !== image.src) {
              setSharpFailed(true);
              setSharpReady(false);
              event.currentTarget.src = image.src;
            }
          }}
          style={zoomed ? { width: `${zoom}%` } : undefined}
        />
      </div>
    </div>
  );
}

function CategoryDialog({
  open,
  name,
  setName,
  categories,
  parentId,
  setParentId,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">NEW FOLDER</p>
            <h2>Create folder</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          Create a folder in different level.
        </p>
        <label className="dialog-label">
          Folder name
          <input
            autoFocus
            placeholder="Product photos"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onConfirm()}
          />
        </label>
        <label className="dialog-label">
          Location
          <select
            value={parentId || ""}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">Top level</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryKey(category.number)} - {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={!name.trim()}
            onClick={onConfirm}
          >
            <Plus size={15} /> Create folder
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageActionMenu({
  action,
  onDownload,
  onEditDocumentId,
  onDelete,
  onMoveToFolder,
  onCopyToFolder,
  onClose,
  canDownload = true,
  canEdit = false,
  canMoveToFolder = false,
  canCopyToFolder = false,
}) {
  const menuRef = useRef(null);
  const anchor = action?.anchor;
  const position = useMenuPlacement(anchor, menuRef, Boolean(anchor));
  if (!action || !anchor) return null;
  return (
    <div
      ref={menuRef}
      className="image-action-menu"
      style={{
        left: position?.left ?? anchor.left,
        top: position?.top ?? anchor.bottom + 6,
      }}
    >
      {canDownload && (
        <button
          onClick={() => {
            onDownload(action.image);
            onClose();
          }}
        >
          <Download size={14} /> Download
        </button>
      )}
      {canEdit && (
        <button
          onClick={() => {
            onEditDocumentId(action.image);
            onClose();
          }}
        >
          <Tag size={14} /> Edit document ID
        </button>
      )}
      {canMoveToFolder && (
        <button
          onClick={() => {
            onMoveToFolder(action.image);
            onClose();
          }}
        >
          <MoveVertical size={14} /> Move to folder
        </button>
      )}
      {canCopyToFolder && (
        <button
          onClick={() => {
            onCopyToFolder(action.image);
            onClose();
          }}
        >
          <Copy size={14} /> Copy to folder
        </button>
      )}
      <button
        className="danger-action"
        onClick={() => {
          onDelete(action.image);
          onClose();
        }}
      >
        <Trash2 size={14} /> Delete
      </button>
    </div>
  );
}

// Shared by the Move and Copy dialogs. They differ only in the endpoint, the
// copy on screen and the callback, so one component keeps them in sync.
function ImageFolderDialog({
  mode, // "move" | "copy"
  image,
  onClose,
  onDone,
  categories,
  canUploadTo,
  currentCategoryNumberKey,
}) {
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The dialog component stays mounted between uses, so start fresh each time
  // a different image is passed in.
  useEffect(() => {
    setTargetId("");
    setError("");
    setSaving(false);
  }, [image]);

  if (!image) return null;

  const isMove = mode === "move";
  const destinationOptions = categories
    .filter(
      (cat) =>
        categoryKey(cat.number) !== currentCategoryNumberKey &&
        canUploadTo(categoryKey(cat.number)),
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const submit = async () => {
    if (!targetId || !Number.isInteger(image.id)) return;
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/images/${image.id}/${isMove ? "move" : "copy"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId: Number(targetId) }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          body.error ||
            (isMove ? "Could not move the image." : "Could not copy the image."),
        );
      }
      onDone({ image, categoryId: Number(targetId), result: body });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(targetId && !saving && Number.isInteger(image.id));

  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">{isMove ? "MOVE IMAGE" : "COPY IMAGE"}</p>
            <h2>{isMove ? "Move to folder" : "Copy to folder"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={saving}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          {isMove ? "Move" : "Copy"} <strong>{image.name}</strong>{" "}
          {isMove
            ? "to another folder."
            : "into another folder. The original stays where it is and the copy keeps the same document ID."}
        </p>
        <label className="dialog-label">
          Destination folder
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={saving}
          >
            <option value="" disabled>
              Select a folder
            </option>
            {destinationOptions.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {categoryKey(cat.number)} - {cat.name}
              </option>
            ))}
          </select>
        </label>
        {destinationOptions.length === 0 && (
          <p className="format-note">
            You don't have upload access to any other folder.
          </p>
        )}
        {error && (
          <p
            className="format-note"
            style={{ color: "#b24f52", marginTop: 10 }}
          >
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="upload-button" onClick={submit} disabled={!canSave}>
            {isMove ? <MoveVertical size={15} /> : <Copy size={15} />}{" "}
            {saving
              ? isMove
                ? "Moving…"
                : "Copying…"
              : isMove
                ? "Move"
                : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveImageDialog({
  image,
  onClose,
  onMoved,
  categories,
  canUploadTo,
  currentCategoryNumberKey,
}) {
  return (
    <ImageFolderDialog
      mode="move"
      image={image}
      onClose={onClose}
      onDone={onMoved}
      categories={categories}
      canUploadTo={canUploadTo}
      currentCategoryNumberKey={currentCategoryNumberKey}
    />
  );
}

function CopyImageDialog({
  image,
  onClose,
  onCopied,
  categories,
  canUploadTo,
  currentCategoryNumberKey,
}) {
  return (
    <ImageFolderDialog
      mode="copy"
      image={image}
      onClose={onClose}
      onDone={onCopied}
      categories={categories}
      canUploadTo={canUploadTo}
      currentCategoryNumberKey={currentCategoryNumberKey}
    />
  );
}

function CategoryActionMenu({
  action,
  onAddChild,
  onEdit,
  onDownload,
  onDelete,
  canDownload = true,
  canManage = true,
}) {
  const menuRef = useRef(null);
  const anchor = action?.anchor;
  const position = useMenuPlacement(anchor, menuRef, Boolean(anchor));
  if (!action || !anchor) return null;
  if (!canDownload && !canManage) return null;
  return (
    <div
      ref={menuRef}
      className="image-action-menu category-action-menu"
      style={{
        left: position?.left ?? anchor.left,
        top: position?.top ?? anchor.bottom + 6,
      }}
    >
      {canManage && (
        <button onClick={() => onAddChild(action.category)}>
          <Plus size={14} /> New subfolder
        </button>
      )}
      {canManage && (
        <button onClick={() => onEdit(action.category)}>
          <Edit3 size={14} /> Rename folder
        </button>
      )}
      {canDownload && (
        <button onClick={() => onDownload(action.category)}>
          <Archive size={14} /> Download folder as ZIP
        </button>
      )}
      {canManage && (
        <button
          className="danger-action"
          onClick={() => onDelete(action.category)}
        >
          <Trash2 size={14} /> Delete folder
        </button>
      )}
    </div>
  );
}

function PreviewSizeMenu({ size, anchor, setSize, onClose }) {
  useEffect(() => {
    const closeMenu = (event) => {
      if (
        !event.target.closest(".preview-size-menu") &&
        !event.target.closest(".size-control")
      )
        onClose();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  return (
    <div
      className="image-action-menu preview-size-menu"
      style={{ left: anchor.left, top: anchor.top }}
    >
      <p className="preview-size-title">PREVIEW SIZE</p>
      {previewSizes.map((item) => (
        <button
          key={item.key}
          className={item.key === size ? "active" : ""}
          onClick={() => {
            setSize(item.key);
            onClose();
          }}
        >
          <i className="size-swatch" data-size={item.key} />
          <span>{item.label}</span>
          {item.key === size && <Check size={14} />}
        </button>
      ))}
    </div>
  );
}

// Opened from the sidebar footer's "..." chip. Renders the exact same
// .sidebar-profile-menu markup as the Home and Admin sidebars (styled once in
// Home.css) so the Sign out popup is identical on every page. Sign out
// dispatches the same 'sign-out' event the EXIT menu uses, so App.signOut()
// stays the single sign-out path.
function ProfileMenu({ onSignOut }) {
  return (
    <div className="sidebar-profile-menu">
      <button onClick={onSignOut}>
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );
}

function DeleteDialog({ image, onCancel, onConfirm }) {
  if (!image) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">DELETE IMAGE</p>
            <h2>Delete this image?</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          <strong>{image.name}</strong> will be permanently removed from the
          database and storage folder.
        </p>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="delete-button" onClick={onConfirm}>
            <Trash2 size={15} /> Delete image
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryEditDialog({ category, name, setName, onCancel, onConfirm }) {
  if (!category) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">EDIT CATEGORY</p>
            <h2>Rename category</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          Update the display name for category{" "}
          {String(category.number).padStart(2, "0")}.
        </p>
        <label className="dialog-label">
          Category name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && onConfirm()}
          />
        </label>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={!name.trim()}
            onClick={onConfirm}
          >
            <Check size={15} /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryDeleteDialog({ category, onCancel, onConfirm }) {
  if (!category) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">DELETE CATEGORY</p>
            <h2>Delete this category?</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          <strong>{category.name}</strong> contains {category.count} images. The
          category, its images, and generated files will be permanently removed.
        </p>
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="delete-button" onClick={onConfirm}>
            <Trash2 size={15} /> Delete category
          </button>
        </div>
      </div>
    </div>
  );
}

const PERMISSION_LEVELS = [
  { key: "none", label: "No access" },
  { key: "view", label: "View only" },
  { key: "download", label: "View & download" },
  { key: "edit", label: "View + upload/download/edit details" },
  { key: "manage", label: "Full control (incl. delete)" },
];

// Flattens the category tree into a depth-aware list purely for rendering
// indented rows in the permission picker (doesn't mutate the tree used elsewhere).
function flattenCategoryTree(categories, depth = 0, out = []) {
  categories.forEach((category) => {
    out.push({ ...category, depth });
    if (category.children?.length)
      flattenCategoryTree(category.children, depth + 1, out);
  });
  return out;
}

function CreateUserDialog({
  open,
  categories,
  onCancel,
  onConfirm,
  error,
  submitting,
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [permissions, setPermissions] = useState({});

  useEffect(() => {
    if (!open) {
      setUsername("");
      setEmail("");
      setPassword("");
      setRole("user");
      setPermissions({});
    }
  }, [open]);

  if (!open) return null;
  const flatCategories = flattenCategoryTree(buildCategoryTree(categories));
  const setLevel = (categoryId, level) =>
    setPermissions((current) => ({ ...current, [categoryId]: level }));
  const canSubmit =
    EMAIL_PATTERN.test(email.trim()) && Boolean(password.trim());

  const submit = () => {
    if (!canSubmit) return;
    const grantedPermissions = Object.entries(permissions)
      .filter(([, level]) => level && level !== "none")
      .map(([categoryId, level]) => ({
        categoryId: Number(categoryId),
        level,
      }));
    // Username is optional - the API derives one from the email when it's blank.
    onConfirm({
      username: username.trim() || undefined,
      email: email.trim(),
      password,
      role,
      permissions: grantedPermissions,
    });
  };

  return (
    <div className="modal-backdrop">
      <div
        className="category-dialog"
        style={{ width: "min(480px, calc(100vw - 30px))" }}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">ADMIN</p>
            <h2>Create user</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">
          New users sign in with their email and can access only the folders you
          grant below.
        </p>
        <label className="dialog-label">
          Email
          <input
            autoFocus
            type="email"
            placeholder="e.g. jane@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="dialog-label">
          Username (optional)
          <input
            placeholder="e.g. jane.doe"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <p className="format-note">
          Leave blank to use the email address instead.
        </p>
        <label className="dialog-label">
          Temporary password
          <input
            type="password"
            placeholder="User should change this after first login"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="dialog-label">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="user">Standard user</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {role === "user" && (
          <>
            <div className="category-selection-label" style={{ marginTop: 16 }}>
              FOLDER PERMISSIONS
            </div>
            <div className="category-chooser-list" style={{ maxHeight: 220 }}>
              {flatCategories.length ? (
                flatCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className="dropdown-row"
                    style={{ paddingLeft: 10 + cat.depth * 16 }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cat.name}
                    </span>
                    <select
                      value={permissions[cat.id] || "none"}
                      onChange={(event) => setLevel(cat.id, event.target.value)}
                      style={{ height: 28, fontSize: 11 }}
                    >
                      {PERMISSION_LEVELS.map((level) => (
                        <option key={level.key} value={level.key}>
                          {level.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              ) : (
                <p className="category-empty">No folders exist yet</p>
              )}
            </div>
          </>
        )}
        {role === "admin" && (
          <p className="format-note" style={{ marginTop: 10 }}>
            <Shield
              size={12}
              style={{ verticalAlign: "-2px", marginRight: 4 }}
            />
            Admins automatically have full access to every folder.
          </p>
        )}
        {error && (
          <p
            className="format-note"
            style={{ color: "#b24f52", marginTop: 10 }}
          >
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={!canSubmit || submitting}
            onClick={submit}
          >
            <UserPlus size={15} /> {submitting ? "Creating…" : "Create user"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function convertForUpload(file, format) {
  if (format === "original") return file;
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const mime = `image/${format === "jpeg" ? "jpeg" : format}`;
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mime, format === "jpeg" ? 0.92 : undefined),
    );
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File(
      [blob],
      `${baseName}.${format === "jpeg" ? "jpg" : format}`,
      { type: mime },
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function CategoryChooserDialog({
  title,
  categories,
  onSelect,
  onClose,
  emptyText = "No categories available",
}) {
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">CATEGORY</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="category-chooser-list">
          {categories.length ? (
            categories.map((item) => (
              <button key={item.id} onClick={() => onSelect(item.number)}>
                <span>{String(item.number).padStart(2, "0")}</span>
                <strong>{item.name}</strong>
                <small className="category-meta">{item.count} image{item.count === 1 ? "" : "s"}</small>
                <ChevronRight size={14} />
              </button>
            ))
          ) : (
            <p className="category-empty">{emptyText}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Small message box used when a menu command can't run yet (for example
// "Print" with no image selected).
function NoticeDialog({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">NOTICE</p>
            <h2>{notice.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="dialog-description">{notice.message}</p>
        <div className="dialog-actions">
          <button className="upload-button" autoFocus onClick={onClose}>
            <Check size={15} /> OK
          </button>
        </div>
      </div>
    </div>
  );
}

// FILE > Properties. Shows the selected image (and the folder it lives in), or
// just the open folder when no image is selected.
function PropertiesDialog({
  open,
  image,
  category,
  organizationName,
  subfolderCount,
  onClose,
}) {
  if (!open) return null;
  const formatSize = (bytes) => {
    const value = Number(bytes || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
    return `${(value / 1024).toFixed(1)} KB`;
  };
  return (
    <div className="modal-backdrop">
      <div className="category-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">PROPERTIES</p>
            <h2>{image ? image.name : category?.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {image && (
          <>
            <p className="eyebrow" style={{ marginBottom: 6 }}>
              IMAGE
            </p>
            <div className="detail-grid">
              <span>File name</span>
              <strong title={image.name}>{image.name}</strong>
              <span>Original file</span>
              <strong title={image.originalName}>{image.originalName}</strong>
              <span>Document ID</span>
              <strong>{image.documentId || "Not set"}</strong>
              <span>File size</span>
              <strong>{formatSize(image.size)}</strong>
              <span>Image ID</span>
              <strong>
                {typeof image.id === "number" ? image.id : "Uploading…"}
              </strong>
              <span>Added</span>
              <strong>{image.date}</strong>
            </div>
          </>
        )}
        {category && (
          <>
            <p
              className="eyebrow"
              style={{ marginTop: image ? 16 : 0, marginBottom: 6 }}
            >
              FOLDER
            </p>
            <div className="detail-grid">
              <span>Name</span>
              <strong>{category.name}</strong>
              <span>Folder number</span>
              <strong>{String(category.number).padStart(2, "0")}</strong>
              <span>Images</span>
              <strong>{category.count}</strong>
              <span>Subfolders</span>
              <strong>{subfolderCount}</strong>
              <span>Organization</span>
              <strong>{organizationName || "—"}</strong>
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button className="upload-button" onClick={onClose}>
            <Check size={15} /> Close
          </button>
        </div>
      </div>
    </div>
  );
}

function WebcamDialog({ onCancel, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((stream) => {
        if (!active) return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() =>
        setError("Camera permission was denied or no camera is available."),
      );
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob)
          onCapture(
            new File([blob], `webcam-${Date.now()}.jpg`, {
              type: "image/jpeg",
            }),
          );
      },
      "image/jpeg",
      0.92,
    );
  };
  return (
    <div className="modal-backdrop">
      <div className="webcam-dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">CAMERA</p>
            <h2>Capture from webcam</h2>
          </div>
          <button className="icon-button" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>
        {error ? (
          <div className="camera-error">
            <Camera size={24} />
            <span>{error}</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="webcam-video"
            style={{ transform: "scaleX(-1)" }}
          />
        )}
        <div className="dialog-actions">
          <button className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="upload-button"
            disabled={Boolean(error)}
            onClick={capture}
          >
            <Camera size={15} /> Capture image
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [view, setView] = useState("grid");
  const [previewSize, setPreviewSize] = useState(readPreviewSize);
  const [tileResolution, setTileResolution] = useState(null);
  const [sizeMenu, setSizeMenu] = useState(null);
  const [search, setSearch] = useState("");
  // Cross-folder document-id search: matches from the server, whether the
  // dropdown is open, and an image to select once its folder has loaded.
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState(null);
  const searchBoxRef = useRef(null);
  // FILE menu: Properties dialog, a small message box, and the folders opened
  // most recently (persisted so "Recent Categories" survives a reload).
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [recentCategoryKeys, setRecentCategoryKeys] = useState(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("imagery.recent-categories") || "[]",
      );
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [zoom, setZoom] = useState(100);
  const [queue, setQueue] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [downloadImage, setDownloadImage] = useState(null);
  const [deleteImage, setDeleteImage] = useState(null);
  const [imageAction, setImageAction] = useState(null);
  const [moveImage, setMoveImage] = useState(null);
  const [copyImage, setCopyImage] = useState(null);
  // Document ids: the mandatory value typed during an upload, the mandatory
  // prefix used to number a bulk batch, and the image being edited after the fact.
  const [uploadDocumentId, setUploadDocumentId] = useState("");
  const [bulkDocumentPrefix, setBulkDocumentPrefix] = useState("");
  const [documentIdImage, setDocumentIdImage] = useState(null);
  const [documentIdDraft, setDocumentIdDraft] = useState("");
  const [documentIdError, setDocumentIdError] = useState("");
  const [documentIdSaving, setDocumentIdSaving] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(readPreviewEnabled);
  // When the sidebar's folders layer is open the workspace widens the sidebar
  // column, so the image playground shrinks to give the folder view space.
  const [foldersLayerOpen, setFoldersLayerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(
    () =>
      readPreviewEnabled() &&
      (typeof window === "undefined" || window.innerWidth > 720),
  );
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryParentId, setNewCategoryParentId] = useState("");
  const [editCategory, setEditCategory] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [deleteCategory, setDeleteCategory] = useState(null);
  const [categoryChooser, setCategoryChooser] = useState(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserError, setCreateUserError] = useState("");
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(
    () => window.localStorage.getItem("imaginary.theme") || "light",
  );
  const [homeView, setHomeView] = useState(true);
  const [adminView, setAdminView] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [access, setAccess] = useState(null);
  // Organizations come from the database (Organization table). Selecting one
  // scopes the folder list: the categories request carries ?organizationId=.
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState(() => {
    try {
      return window.localStorage.getItem("imagery.selected-organization");
    } catch {}
    return null;
  });
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [editOrg, setEditOrg] = useState(null);
  const [editOrgName, setEditOrgName] = useState("");
  const [deleteOrg, setDeleteOrg] = useState(null);
  const fileInput = useRef(null);
  useEffect(() => {
    window.localStorage.setItem("imaginary.theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const category = categories.find(
    (item) => categoryKey(item.number) === selectedCategory,
  );
  const categoryPath = getCategoryPath(category, categories);
  const tileResolutionLabel = tileResolution;
  const tileVariant =
    (tileResolution && resolutionVariants[tileResolution]) || null;
  // The search box filters the open folder by file name OR document ID.
  const searchTerm = search.trim().toLowerCase();
  const visibleImages = images.filter(
    (image) =>
      image.category === selectedCategory &&
      (!searchTerm ||
        image.name.toLowerCase().includes(searchTerm) ||
        cleanDocumentId(image.documentId).toLowerCase().includes(searchTerm)),
  );
  const changeCategoryCount = (number, delta) =>
    setCategories((items) =>
      items.map((item) =>
        categoryKey(item.number) === categoryKey(number)
          ? { ...item, count: Math.max(0, Number(item.count || 0) + delta) }
          : item,
      ),
    );

  // Mirrors the server's requirePermission checks so download affordances can be
  // hidden up front instead of failing with a 403 after the click.
  useEffect(() => {
    if (!user) return;
    apiFetch("/api/me/permissions")
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setAccess(value))
      .catch(() => setAccess(null));
  }, [user]);

  // Grants are keyed by category number but the gallery tracks folders by their
  // zero-padded key, so normalise before comparing. Unknown access denies.
  const canDownloadIn = (categoryNumberKey) => {
    if (!access) return false;
    if (access.isAdmin) return true;
    const number = Number(categoryNumberKey);
    return Boolean(
      access.grants
        .find((entry) => Number(entry.number) === number)
        ?.permissions?.includes("download"),
    );
  };

  const canManageIn = (categoryNumberKey) => {
    if (!access) return false;
    if (access.isAdmin) return true;
    const number = Number(categoryNumberKey);
    return Boolean(
      access.grants
        .find((entry) => Number(entry.number) === number)
        ?.permissions?.includes("category.edit"),
    );
  };

  // Editing an image's own details (its document id) needs 'image.edit', which the
  // server grants to the 'edit' and 'manage' levels. Moving an image out of a
  // folder also uses 'image.edit' on the source.
  const canEditImageIn = (categoryNumberKey) => {
    if (!access) return false;
    if (access.isAdmin) return true;
    const number = Number(categoryNumberKey);
    return Boolean(
      access.grants
        .find((entry) => Number(entry.number) === number)
        ?.permissions?.includes("image.edit"),
    );
  };

  // Moving an image *into* a folder needs 'upload' on the destination (the same
  // gate as uploading into a folder). Used to grey out folders in the picker
  // that the user can't move into.
  const canUploadTo = (categoryNumberKey) => {
    if (!access) return false;
    if (access.isAdmin) return true;
    const number = Number(categoryNumberKey);
    return Boolean(
      access.grants
        .find((entry) => Number(entry.number) === number)
        ?.permissions?.includes("upload"),
    );
  };

  // Drives the UI-only gates: creating users/folders and seeing every folder are
  // admin-scoped on the API, so a standard user is never offered them.
  const isAdminUser = user?.role === "admin";

  // Clearing the cookie server-side matters: without it the next load would
  // silently sign straight back in from the session cookie in /api/me.
  const signOut = async () => {
    await apiFetch("/api/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setAccess(null);
    setCategories([]);
    setImages([]);
    setSelectedImage(null);
    setSelectedCategory("");
    setQueue([]);
    setAdminView(false);
  };

  useEffect(() => {
    const buttons = document.querySelectorAll(".card-more");
    buttons.forEach((button, index) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const image = visibleImages[index];
        if (image) {
          const rect = button.getBoundingClientRect();
          setImageAction({
            image,
            anchor: {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            },
          });
        }
      };
    });
    return () =>
      buttons.forEach((button) => {
        button.onclick = null;
      });
  }, [visibleImages]);

  useEffect(() => {
    if (!imageAction) return undefined;
    const closeMenu = (event) => {
      if (
        !event.target.closest(".image-action-menu") &&
        !event.target.closest(".card-more")
      )
        setImageAction(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setImageAction(null);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [imageAction]);

  useEffect(() => {
    const handleWebcamCapture = (event) => {
      const file = event.detail;
      if (!file) return;
      setPendingFile(file);
      setUploadName(file.name);
      setUploadCategory(category?.id ? String(category.id) : "");
    };
    window.addEventListener("webcam-captured", handleWebcamCapture);
    return () =>
      window.removeEventListener("webcam-captured", handleWebcamCapture);
  }, [category?.id]);

  useEffect(() => {
    const openNew = () => {
      // Folders always belong to an organization: without one, guide the admin
      // to create it first instead of a dialog that cannot save.
      if (selectedOrgId == null) {
        setNewOrgName("");
        setNewOrgOpen(true);
        return;
      }
      setNewCategoryParentId("");
      setNewCategoryOpen(true);
    };
    const openCategory = () => setCategoryChooser("Open category");
    const openRecent = () => setCategoryChooser("Recent categories");
    const openEdit = (event) => beginEditCategory(event.detail);
    const openDelete = (event) => setDeleteCategory(event.detail);
    const openCreateUser = () => {
      setCreateUserError("");
      setCreateUserOpen(true);
    };
    window.addEventListener("new-category", openNew);
    window.addEventListener("open-category", openCategory);
    window.addEventListener("recent-categories", openRecent);
    window.addEventListener("edit-category", openEdit);
    window.addEventListener("delete-category", openDelete);
    window.addEventListener("create-user", openCreateUser);
    window.addEventListener("sign-out", signOut);
    return () => {
      window.removeEventListener("new-category", openNew);
      window.removeEventListener("open-category", openCategory);
      window.removeEventListener("recent-categories", openRecent);
      window.removeEventListener("edit-category", openEdit);
      window.removeEventListener("delete-category", openDelete);
      window.removeEventListener("create-user", openCreateUser);
      window.removeEventListener("sign-out", signOut);
    };
  }, [selectedOrgId]);

  useEffect(() => {
    window.localStorage.setItem("imagery.preview-size", previewSize);
  }, [previewSize]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "imagery.preview-enabled",
        String(previewEnabled),
      );
    } catch {}
    if (!previewEnabled) setPreviewOpen(false);
  }, [previewEnabled]);
  useEffect(() => {
    // The org list lives in the database; localStorage only remembers the
    // selection. Once loaded, fall back to the first org when the saved id no
    // longer exists (e.g. it was deleted from another session).
    if (!user) return;
    apiFetch("/api/organizations")
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => {
        const list = items.map((item) => ({
          id: item.id,
          name: item.name,
          foldersCount: Number(item.foldersCount || 0),
          membersCount: Number(item.membersCount || 1),
        }));
        setOrganizations(list);
        setSelectedOrgId((current) => {
          if (
            current != null &&
            list.some((org) => String(org.id) === String(current))
          )
            return current;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {});
  }, [user]);
  useEffect(() => {
    try {
      if (selectedOrgId != null)
        window.localStorage.setItem(
          "imagery.selected-organization",
          String(selectedOrgId),
        );
    } catch {}
  }, [selectedOrgId]);
  useEffect(() => {
    if (homeView || adminView) setFoldersLayerOpen(false);
  }, [homeView, adminView]);
  useEffect(() => {
    const openHome = (event) => {
      if (event.target.closest(".brand")) setHomeView(true);
    };
    const goHome = () => setHomeView(true);
    document.addEventListener("click", openHome);
    window.addEventListener("go-home", goHome);
    return () => {
      document.removeEventListener("click", openHome);
      window.removeEventListener("go-home", goHome);
    };
  }, []);

  // Only one topbar popover may be open at a time. Opening the nav menus or the
  // profile panel dispatches 'close-popovers', which dismisses the
  // preview-size popover - previously both could be open and overlap.
  useEffect(() => {
    const closePopovers = () => setSizeMenu(null);
    window.addEventListener("close-popovers", closePopovers);
    return () => window.removeEventListener("close-popovers", closePopovers);
  }, []);

  useEffect(() => {
    const openSizeMenu = () => {
      const rect = document
        .querySelector(".size-control")
        ?.getBoundingClientRect();
      setSizeMenu({
        left: (rect?.right ?? 320) - 176,
        top: (rect?.bottom ?? 118) + 6,
      });
    };
    const applySize = (event) => {
      const key = previewSizeKeys[event.detail];
      if (key) setPreviewSize(key);
    };
    window.addEventListener("preview-size-menu", openSizeMenu);
    window.addEventListener("preview-size", applySize);
    return () => {
      window.removeEventListener("preview-size-menu", openSizeMenu);
      window.removeEventListener("preview-size", applySize);
    };
  }, []);

  // Restore the session cookie on load. Until /api/me answers there is no user,
  // and the workspace must not render or it fires unauthenticated requests.
  useEffect(() => {
    apiFetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // Folders of the organization selected in the sidebar. Every folder belongs
  // to exactly one organization, so switching orgs re-fetches its folder tree.
  useEffect(() => {
    if (!user) return;
    if (selectedOrgId == null) {
      setCategories([]);
      return;
    }
    // Drop the previous org's folders immediately so the drawer never shows
    // another organization's list while the new one is loading.
    setCategories((current) => {
      const stale = current.some(
        (item) =>
          item.organizationId &&
          String(item.organizationId) !== String(selectedOrgId),
      );
      return stale ? [] : current;
    });
    apiFetch(
      `/api/categories?organizationId=${encodeURIComponent(selectedOrgId)}`,
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => {
        const savedOrder = readCategoryOrder();
        const loaded = items.map((item, index) => ({
          id: item.id,
          number: item.number,
          name: item.name,
          parentId: item.parent_id || null,
          organizationId: item.organization_id || selectedOrgId,
          count: Number(item.image_count || 0),
          accessLevel: item.access_level ?? null,
          order: savedOrder[item.id] ?? index,
        }));
        setCategories(loaded);
        const landing = loaded.find((item) => item.accessLevel) || loaded[0];
        if (landing)
          setSelectedCategory((current) =>
            current &&
            loaded.some((item) => categoryKey(item.number) === current)
              ? current
              : categoryKey(landing.number),
          );
        else setSelectedCategory(null);
      })
      .catch(() => {});
  }, [user, selectedOrgId]);
  useEffect(() => {
    // No folder selected (or none in this organization): the gallery must not
    // keep showing the previous folder's images or count.
    if (!user || !category?.id) {
      setImages((current) => (current.length ? [] : current));
      setSelectedImage(null);
      return;
    }
    apiFetch(`/api/images?categoryId=${category.id}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((items) => {
        const persisted = items.map((item) => ({
          id: item.id,
          name: item.original_name,
          originalName: item.original_name,
          documentId: item.document_id || "",
          size: Number(item.file_size),
          date: new Date(item.created_at).toLocaleString(),
          src: `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/variants/${item.id}/web`,
          category: selectedCategory,
        }));
        setImages((current) => {
          const localImages = current.filter(
            (image) =>
              image.category === selectedCategory &&
              typeof image.id !== "number" &&
              !persisted.some((saved) => saved.name === image.name),
          );
          return [
            ...localImages,
            ...persisted,
            ...current.filter((image) => image.category !== selectedCategory),
          ];
        });
      })
      .catch(() => {});
  }, [user, category?.id, selectedCategory]);

  const beginUpload = (file) => {
    if (!file) return;
    setPendingFile(file);
    setUploadName(file.name);
    setUploadDocumentId("");
    setUploadCategory(category?.id ? String(category.id) : "");
  };
  const beginBulkUpload = (files) => {
    if (!files.length) return;
    setPendingFiles(files);
    setBulkDocumentPrefix("");
    setBulkCategory(category?.id ? String(category.id) : "");
  };
  const chooseFile = (event) => {
    const list = Array.from(event.target.files || []);
    event.target.value = "";
    if (list.length === 0) return;
    if (list.length === 1) beginUpload(list[0]);
    else beginBulkUpload(list);
  };
  const handleGalleryDragOver = (event) => {
    if (!category) return;
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
      setIsDraggingFiles(true);
    }
  };
  const handleGalleryDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDraggingFiles(false);
  };
  const handleGalleryDrop = (event) => {
    if (!category) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    if (files.length === 1) beginUpload(files[0]);
    else beginBulkUpload(files);
  };
  const captureWebcam = (file) => {
    setWebcamOpen(false);
    beginUpload(file);
  };
  const stepPreviewSize = (direction) => {
    setView("grid");
    setPreviewSize((current) => {
      const index = previewSizeOrder.indexOf(current);
      const next = index + direction;
      if (next < 0 || next >= previewSizeOrder.length) return current;
      return previewSizeOrder[next];
    });
  };
  const openViewer = (image) => {
    if (!image) return;
    setSelectedImage(image);
    setZoom(75);
    setFullscreenImage(image);
  };
  const showPreviewPanel = () => {
    if (previewEnabled) setPreviewOpen(true);
  };

  // Document-ID search across every folder the user can access (in the selected
  // organization). Debounced so it doesn't fire on every keystroke.
  useEffect(() => {
    const term = search.trim();
    if (!user || !term) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      const orgQuery =
        selectedOrgId != null
          ? `&organizationId=${encodeURIComponent(selectedOrgId)}`
          : "";
      apiFetch(`/api/images/search?q=${encodeURIComponent(term)}${orgQuery}`)
        .then((response) => (response.ok ? response.json() : []))
        .then((items) => {
          if (!cancelled) setSearchResults(items);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, user, selectedOrgId]);

  // Close the results dropdown on outside click or Escape.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const closeOnOutside = (event) => {
      if (
        !event.target.closest(".search-box") &&
        !event.target.closest(".search-results-menu")
      )
        setSearchOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [searchOpen]);

  // After jumping to a search result's folder, select the image as soon as that
  // folder's images have loaded.
  useEffect(() => {
    if (pendingSelectId == null) return;
    const match = images.find(
      (image) =>
        image.id === pendingSelectId && image.category === selectedCategory,
    );
    if (match) {
      setSelectedImage(match);
      showPreviewPanel();
      setPendingSelectId(null);
    }
  }, [pendingSelectId, images, selectedCategory]);

  const openSearchResult = (result) => {
    const target = categories.find(
      (item) => String(item.id) === String(result.category_id),
    );
    if (!target) return;
    setSelectedCategory(categoryKey(target.number));
    setSearch(result.document_id || result.name || search);
    setSearchOpen(false);
    setPendingSelectId(result.id);
  };

  // Remember the folders the user opens (newest first, max 8) for
  // FILE > Recent Categories.
  useEffect(() => {
    if (!selectedCategory) return;
    setRecentCategoryKeys((current) =>
      current[0] === selectedCategory
        ? current
        : [
            selectedCategory,
            ...current.filter((key) => key !== selectedCategory),
          ].slice(0, 8),
    );
  }, [selectedCategory]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "imagery.recent-categories",
        JSON.stringify(recentCategoryKeys),
      );
    } catch {}
  }, [recentCategoryKeys]);
  const beginCreateCategory = (parent = null) => {
    // Folders always live inside an organization: without one, open the
    // organization dialog instead so the admin creates it first.
    if (selectedOrgId == null) {
      setNewOrgName("");
      setNewOrgOpen(true);
      return;
    }
    setNewCategoryParentId(parent?.id ? String(parent.id) : "");
    setNewCategoryOpen(true);
  };
  const childCategoryIds = (rootId, items = categories) => {
    const direct = items
      .filter((item) => String(item.parentId || "") === String(rootId))
      .map((item) => item.id);
    return direct.flatMap((id) => [id, ...childCategoryIds(id, items)]);
  };
  const createCategory = async () => {
    if (!newCategoryName.trim()) return;
    const parentId = newCategoryParentId || null;
    try {
      const response = await apiFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          parentId,
          // New folders land in the organization selected in the sidebar.
          organizationId: selectedOrgId != null ? Number(selectedOrgId) : null,
        }),
      });
      if (response.ok) {
        const item = await response.json();
        setCategories((items) => {
          const siblingOrders = items
            .filter(
              (existing) =>
                String(existing.parentId || "") === String(parentId || ""),
            )
            .map((existing) => existing.order ?? 0);
          const order = siblingOrders.length
            ? Math.max(...siblingOrders) + 1
            : 0;
          const next = {
            id: item.id,
            number: item.number,
            name: item.name,
            parentId: item.parent_id || parentId,
            organizationId: item.organization_id || selectedOrgId,
            count: 0,
            order,
          };
          setSelectedCategory(categoryKey(next.number));
          return [...items, next];
        });
      }
    } catch {}
    setNewCategoryName("");
    setNewCategoryParentId("");
    setNewCategoryOpen(false);
  };
  const reorderCategory = (sourceId, targetId) => {
    setCategories((items) => {
      const source = items.find((item) => item.id === sourceId);
      const target = items.find((item) => item.id === targetId);
      if (!source || !target || sourceId === targetId) return items;
      if (String(source.parentId || "") !== String(target.parentId || ""))
        return items;
      const siblings = items
        .filter(
          (item) =>
            String(item.parentId || "") === String(source.parentId || ""),
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const others = items.filter(
        (item) => String(item.parentId || "") !== String(source.parentId || ""),
      );
      const withoutSource = siblings.filter((item) => item.id !== sourceId);
      const targetIndex = withoutSource.findIndex(
        (item) => item.id === targetId,
      );
      withoutSource.splice(targetIndex, 0, source);
      const reordered = withoutSource.map((item, index) => ({
        ...item,
        order: index,
      }));
      const orderMap = readCategoryOrder();
      reordered.forEach((item) => {
        orderMap[item.id] = item.order;
      });
      writeCategoryOrder(orderMap);
      return [...others, ...reordered];
    });
  };
  const beginEditCategory = (item) => {
    setEditCategory(item);
    setEditCategoryName(item.name);
  };
  const saveCategory = async () => {
    if (!editCategory || !editCategoryName.trim()) return;
    const name = editCategoryName.trim();
    setCategories((items) =>
      items.map((item) =>
        item.id === editCategory.id ? { ...item, name } : item,
      ),
    );
    setEditCategory(null);
    setEditCategoryName("");
    await apiFetch(`/api/categories/${editCategory.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  };
  const deleteCategoryRecord = async () => {
    if (!deleteCategory) return;
    const idsToDelete = [
      deleteCategory.id,
      ...childCategoryIds(deleteCategory.id),
    ];
    const keysToDelete = categories
      .filter((item) => idsToDelete.includes(item.id))
      .map((item) => categoryKey(item.number));
    setCategories((items) => {
      const next = items.filter((item) => !idsToDelete.includes(item.id));
      if (keysToDelete.includes(selectedCategory))
        setSelectedCategory(next[0] ? categoryKey(next[0].number) : "");
      return next;
    });
    setImages((items) =>
      items.filter((image) => !keysToDelete.includes(image.category)),
    );
    if (selectedImage && keysToDelete.includes(selectedImage.category))
      setSelectedImage(null);
    setDeleteCategory(null);
    await apiFetch(`/api/categories/${deleteCategory.id}`, {
      method: "DELETE",
    }).catch(() => {});
  };

  // Download a folder (and all of its nested subfolders) as a single ZIP,
  // tracked as a job in the existing upload-queue panel.
  const downloadFolder = async (cat) => {
    const jobId = crypto.randomUUID();
    setQueue((items) =>
      [
        { id: jobId, name: `${cat.name}.zip`, status: "Zipping", progress: 0 },
        ...items,
      ].slice(0, QUEUE_MAX),
    );
    try {
      await downloadCategoryAsZip(cat, categories, (pct) => {
        setQueue((items) =>
          items.map((item) =>
            item.id === jobId ? { ...item, progress: pct } : item,
          ),
        );
      });
      setQueue((items) =>
        items.map((item) =>
          item.id === jobId
            ? { ...item, status: "Downloaded", progress: 100 }
            : item,
        ),
      );
    } catch (error) {
      setQueue((items) =>
        items.map((item) =>
          item.id === jobId
            ? { ...item, status: "Failed", progress: 100 }
            : item,
        ),
      );
    }
  };

  // Organizations are database rows now; create/rename/delete go through the
  // API and the list is refreshed from GET /api/organizations on mutation.
  const refreshOrganizations = () => {
    apiFetch("/api/organizations")
      .then((response) => (response.ok ? response.json() : []))
      .then((items) =>
        setOrganizations(
          items.map((item) => ({
            id: item.id,
            name: item.name,
            foldersCount: Number(item.foldersCount || 0),
            membersCount: Number(item.membersCount || 1),
          })),
        ),
      )
      .catch(() => {});
  };
  const createOrganization = async () => {
    if (!newOrgName.trim()) return;
    try {
      const response = await apiFetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });
      if (response.ok) {
        const org = await response.json();
        setOrganizations((items) => [
          ...items,
          { id: org.id, name: org.name, foldersCount: 0, membersCount: 1 },
        ]);
        setSelectedOrgId(String(org.id));
        refreshOrganizations();
      }
    } catch {}
    setNewOrgName("");
    setNewOrgOpen(false);
  };
  const beginEditOrganization = (organization) => {
    setEditOrg(organization);
    setEditOrgName(organization.name);
  };
  const saveOrganization = async () => {
    if (!editOrg || !editOrgName.trim()) return;
    const name = editOrgName.trim();
    try {
      const response = await apiFetch(`/api/organizations/${editOrg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.ok) {
        setOrganizations((items) =>
          items.map((item) =>
            item.id === editOrg.id ? { ...item, name } : item,
          ),
        );
      }
    } catch {}
    setEditOrg(null);
    setEditOrgName("");
  };
  const deleteOrganization = (organization) => {
    setDeleteOrg(organization);
  };
  const confirmDeleteOrganization = async () => {
    if (!deleteOrg) return;
    const deletedId = deleteOrg.id;
    try {
      const response = await apiFetch(`/api/organizations/${deletedId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        const next = organizations.filter((item) => item.id !== deletedId);
        setOrganizations(next);
        if (String(selectedOrgId) === String(deletedId)) {
          setSelectedOrgId(next[0]?.id ?? null);
        }
        // Folders of the deleted org were re-assigned, so refetch the folder
        // list once the (possibly new) selection is in place.
        refreshOrganizations();
      }
    } catch {}
    setDeleteOrg(null);
  };

  const createUser = async ({
    username,
    email,
    password,
    role,
    permissions,
  }) => {
    setCreateUserSubmitting(true);
    setCreateUserError("");
    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role, permissions }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || `Could not create user (${response.status})`,
        );
      }
      setCreateUserOpen(false);
    } catch (error) {
      setCreateUserError(
        error.message || "Something went wrong creating the user",
      );
    } finally {
      setCreateUserSubmitting(false);
    }
  };

  // Document ids are mandatory on upload and unique within a folder (the same id
  // may exist in different folders, e.g. after "Copy to folder"). MySQL's default
  // collation is case-insensitive, so compare folded values to catch a clash
  // before the server answers 409.
  const documentIdInUse = (
    value,
    ignoreId = null,
    folderKey = selectedCategory,
  ) => {
    const key = cleanDocumentId(value).toLowerCase();
    if (!key) return false;
    return images.some(
      (image) =>
        image.id !== ignoreId &&
        image.category === folderKey &&
        cleanDocumentId(image.documentId).toLowerCase() === key,
    );
  };
  // Folder key ("01", "02", ...) for a category id chosen in an upload dialog.
  const folderKeyForId = (categoryId) => {
    const target = categories.find(
      (item) => String(item.id) === String(categoryId),
    );
    return target ? categoryKey(target.number) : selectedCategory;
  };
  const confirmUpload = async (format = "original") => {
    if (!pendingFile || !uploadName.trim()) return;
    const documentId = cleanDocumentId(uploadDocumentId);
    const target = categories.find(
      (item) => String(item.id) === String(uploadCategory),
    );
    if (!target) return;
    if (
      !documentId ||
      documentIdInUse(documentId, null, categoryKey(target.number))
    )
      return;
    setUploadError("");
    const convertedFile = await convertForUpload(pendingFile, format);
    const ext = convertedFile.name.includes(".")
      ? convertedFile.name.split(".").pop().toLowerCase()
      : (convertedFile.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const name = uploadName.includes(".")
      ? uploadName.trim().replace(/\.[^.]+$/, `.${ext}`)
      : `${uploadName.trim()}.${ext}`;
    const local = {
      id: crypto.randomUUID(),
      name,
      originalName: name,
      documentId,
      size: convertedFile.size,
      date: new Date().toLocaleString(),
      src: URL.createObjectURL(convertedFile),
      category: categoryKey(target.number),
      file: convertedFile,
    };
    setImages((items) => [local, ...items]);
    setSelectedCategory(local.category);
    setSelectedImage(local);
    showPreviewPanel();
    changeCategoryCount(target.number, 1);
    const queueId = crypto.randomUUID();
    setQueue((items) =>
      [{ id: queueId, name, status: "Uploaded", progress: 100 }, ...items].slice(
        0,
        QUEUE_MAX,
      ),
    );
    setPendingFile(null);
    const body = new FormData();
    body.append("file", convertedFile);
    body.append("categoryId", target.id);
    body.append("name", name);
    body.append("documentId", documentId);
    let response;
    try {
      response = await apiFetch("/api/uploads", { method: "POST", body });
    } catch {
      response = null;
    }
    // The gallery entry above is optimistic. Roll it back when the server refuses
    // the upload (a document ID it already has, a duplicate image, ...) so the
    // gallery never lists an image the server never stored.
    if (!response || !response.ok) {
      let message = "Upload failed";
      if (response) {
        const errorBody = await response.json().catch(() => ({}));
        if (errorBody.error) message = errorBody.error;
      }
      setUploadError(message);
      setImages((items) => items.filter((item) => item.id !== local.id));
      setQueue((items) =>
        items.map((item) =>
          item.id === queueId
            ? { ...item, status: "Failed", progress: 100 }
            : item,
        ),
      );
      setSelectedImage((current) =>
        current?.id === local.id ? null : current,
      );
      changeCategoryCount(target.number, -1);
    }
  };
  const confirmBulkUpload = async (format = "original") => {
    if (!pendingFiles.length) return;
    const bulkPrefix = cleanDocumentId(bulkDocumentPrefix);
    if (!bulkPrefix) return;
    const target = categories.find(
      (item) => String(item.id) === String(bulkCategory),
    );
    if (!target) return;
    setUploadError("");
    const files = pendingFiles;
    setPendingFiles([]);
    const jobs = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      status: "Queued",
      progress: 5,
      file,
    }));
    setQueue((items) =>
      [...jobs.map(({ file: jobFile, ...rest }) => rest), ...items].slice(
        0,
        QUEUE_MAX,
      ),
    );
    let firstImage = null;
    for (const [index, job] of jobs.entries()) {
      let localImage = null;
      try {
        setQueue((items) =>
          items.map((item) =>
            item.id === job.id
              ? { ...item, status: "Uploading", progress: 45 }
              : item,
          ),
        );
        const convertedFile = await convertForUpload(job.file, format);
        const name = convertedFile.name;
        const documentId = bulkDocumentId(bulkPrefix, index);
        const local = {
          id: crypto.randomUUID(),
          name,
          originalName: name,
          documentId,
          size: convertedFile.size,
          date: new Date().toLocaleString(),
          src: URL.createObjectURL(convertedFile),
          category: categoryKey(target.number),
          file: convertedFile,
        };
        if (!firstImage) firstImage = local;
        localImage = local;
        setImages((items) => [local, ...items]);
        changeCategoryCount(target.number, 1);
        const body = new FormData();
        body.append("file", convertedFile);
        body.append("categoryId", target.id);
        body.append("name", name);
        body.append("documentId", documentId);
        let response;
        try {
          response = await apiFetch("/api/uploads", { method: "POST", body });
        } catch {
          response = null;
        }
        // A rejected upload (for example a document ID the server already has)
        // must not be reported as uploaded, otherwise the queue and the local
        // gallery both claim an image the server never stored.
        if (!response || !response.ok) {
          let message = "Upload rejected";
          if (response) {
            const errorBody = await response.json().catch(() => ({}));
            if (errorBody.error) message = errorBody.error;
          }
          throw new Error(message);
        }
        setQueue((items) =>
          items.map((item) =>
            item.id === job.id
              ? { ...item, status: "Uploaded", progress: 100 }
              : item,
          ),
        );
      } catch (error) {
        setUploadError(error.message || "Upload failed");
        // Drop the optimistic gallery entry too: the server refused this file, so
        // the folder must not keep showing it as present.
        if (localImage) {
          setImages((items) =>
            items.filter((item) => item.id !== localImage.id),
          );
          if (firstImage?.id === localImage.id) firstImage = null;
          changeCategoryCount(target.number, -1);
        }
        setQueue((items) =>
          items.map((item) =>
            item.id === job.id
              ? { ...item, status: "Failed", progress: 100 }
              : item,
          ),
        );
      }
    }
    setSelectedCategory(categoryKey(target.number));
    if (firstImage) setSelectedImage(firstImage);
    showPreviewPanel();
  };
  const deleteImageRecord = async (target) => {
    setImages((items) => items.filter((item) => item.id !== target.id));
    changeCategoryCount(target.category, -1);
    if (selectedImage?.id === target.id) setSelectedImage(null);
    setDeleteImage(null);
    if (typeof target.id === "number")
      await apiFetch(`/api/images/${target.id}`, { method: "DELETE" }).catch(
        () => {},
      );
  };

  // When an image is moved to another folder via the context menu's
  // "Move to folder", remove it from the current grid immediately and keep the
  // folder counts in step. The destination folder's images are re-fetched from
  // the server the next time that folder is opened.
  const handleImageMoved = ({ image, categoryId }) => {
    if (!image) return;
    setImages((items) => items.filter((item) => item.id !== image.id));
    if (selectedImage?.id === image.id) setSelectedImage(null);
    changeCategoryCount(image.category, -1);
    const destination = categories.find(
      (item) => String(item.id) === String(categoryId),
    );
    if (destination) changeCategoryCount(destination.number, 1);
  };

  // When an image is copied into another folder via the context menu's
  // "Copy to folder", the source stays where it is. The destination is never
  // the folder currently on screen, so only its count needs updating; the copy
  // itself shows up when that folder is opened and its images are re-fetched.
  const handleImageCopied = ({ categoryId }) => {
    const destination = categories.find(
      (item) => String(item.id) === String(categoryId),
    );
    if (destination) changeCategoryCount(destination.number, 1);
  };

  // Document ids can be given at upload time or set/corrected later; this is the
  // "later" path. Images that are still uploading only exist locally (their id is
  // a uuid), so those are updated in state without a round trip.
  const openDocumentIdEditor = (image) => {
    if (!image) return;
    setDocumentIdImage(image);
    setDocumentIdDraft(image.documentId || "");
    setDocumentIdError("");
  };
  const saveDocumentId = async () => {
    const target = documentIdImage;
    if (!target) return;
    const next = cleanDocumentId(documentIdDraft);
    setDocumentIdSaving(true);
    setDocumentIdError("");
    try {
      if (typeof target.id === "number") {
        const response = await apiFetch(`/api/images/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: next }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Could not save the document ID");
        }
      }
      // Passed to setSelectedImage/setFullscreenImage as their updater function so
      // whichever image is currently open is patched too.
      const applyDocumentId = (item) =>
        item && item.id === target.id ? { ...item, documentId: next } : item;
      setImages((items) => items.map(applyDocumentId));
      setSelectedImage(applyDocumentId);
      setFullscreenImage(applyDocumentId);
      setImageAction((current) =>
        current
          ? { ...current, image: applyDocumentId(current.image) }
          : current,
      );
      setDocumentIdImage(null);
      setDocumentIdDraft("");
    } catch (error) {
      setDocumentIdError(error.message || "Could not save the document ID");
    } finally {
      setDocumentIdSaving(false);
    }
  };
  // Downloads one image in the given format. Returns true on success. Used by
  // the download dialog and by FILE > Download.
  const downloadImageAs = async (target, format) => {
    if (!target) return false;
    try {
      const originalUrl =
        typeof target.id === "number"
          ? `${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/variants/${target.id}/original`
          : target.src;
      const sourceUrl =
        format === "original" || format === "heic" ? originalUrl : target.src;
      const blob =
        target.file ||
        (await fetch(sourceUrl, { credentials: "include" }).then((response) =>
          response.blob(),
        ));
      let href = URL.createObjectURL(blob);
      let extension =
        format === "original" ? target.originalName.split(".").pop() : format;
      if (format !== "original" && format !== "heic") {
        const image = new Image();
        image.src = href;
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const converted = await new Promise((resolve) =>
          canvas.toBlob(
            resolve,
            `image/${format === "jpeg" ? "jpeg" : format}`,
            0.92,
          ),
        );
        URL.revokeObjectURL(href);
        href = URL.createObjectURL(converted);
      }
      const link = document.createElement("a");
      link.href = href;
      link.download = `${target.name.replace(/\.[^.]+$/, "")}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      return true;
    } catch (error) {
      console.error("download:", error);
      setNotice({
        title: "Download failed",
        message: "The image could not be downloaded. Please try again.",
      });
      return false;
    }
  };
  const download = async (format) => {
    if (!downloadImage) return;
    if (await downloadImageAs(downloadImage, format)) setDownloadImage(null);
  };

  // FILE > Download. The submenu entries come from menuConfig, so they are
  // matched by wording: anything about a folder / ZIP / "all" downloads the open
  // folder as a ZIP; PNG / JPEG / WebP / HEIC / Original download the selected
  // image in that format; any other entry opens the download dialog for it.
  const handleMenuDownload = (entry) => {
    const text = String(entry).toLowerCase();
    if (/\bzip\b|folder|categor|\ball\b|entire|whole/.test(text)) {
      if (!category) {
        setNotice({
          title: "No folder open",
          message: "Open a folder first, then choose Download again.",
        });
        return;
      }
      downloadFolder(category);
      return;
    }
    if (!selectedImage) {
      setNotice({
        title: "Select an image first",
        message:
          "Click an image in the gallery, then choose Download again.",
      });
      return;
    }
    const format = text.includes("png")
      ? "png"
      : /jpe?g/.test(text)
        ? "jpeg"
        : text.includes("webp")
          ? "webp"
          : text.includes("heic")
            ? "heic"
            : text.includes("original")
              ? "original"
              : null;
    if (format) downloadImageAs(selectedImage, format);
    else setDownloadImage(selectedImage);
  };

  // FILE > Print. Prints the selected image on its own page using a hidden
  // iframe, so nothing else on screen ends up on the paper.
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          char
        ],
    );
  const printSelectedImage = async () => {
    const target = selectedImage;
    if (!target) {
      setNotice({
        title: "Select an image first",
        message: "Click the image you want to print, then choose Print again.",
      });
      return;
    }
    let objectUrl = null;
    try {
      // The hd variant is print-sharp and only needs view access; images that
      // are still uploading only exist locally.
      const source = typeof target.id === "number" ? fullSource(target) : target.src;
      const blob = await fetch(source, { credentials: "include" }).then(
        (response) => {
          if (!response.ok) throw new Error("Image could not be loaded");
          return response.blob();
        },
      );
      objectUrl = URL.createObjectURL(blob);
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      doc.open();
      doc.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(target.name)}</title>` +
          `<style>@page{margin:12mm}html,body{margin:0;height:100%}` +
          `body{display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif}` +
          `img{max-width:100%;max-height:calc(100vh - 28px);object-fit:contain}` +
          `p{margin:8px 0 0;font-size:12px;color:#333}</style></head><body>` +
          `<img id="print-image" src="${objectUrl}" alt="">` +
          `<p>${escapeHtml(target.name)}${target.documentId ? ` &middot; ID ${escapeHtml(target.documentId)}` : ""}</p>` +
          `</body></html>`,
      );
      doc.close();
      const img = doc.getElementById("print-image");
      await new Promise((resolve) => {
        if (img.complete) resolve();
        else {
          img.onload = resolve;
          img.onerror = resolve;
        }
      });
      const cleanup = () => {
        frame.remove();
        URL.revokeObjectURL(objectUrl);
      };
      frame.contentWindow.onafterprint = cleanup;
      // Fallback for browsers that never fire afterprint.
      setTimeout(cleanup, 5 * 60 * 1000);
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      console.error("print:", error);
      setNotice({
        title: "Could not print",
        message: "The image could not be loaded for printing.",
      });
    }
  };

  // FILE > Properties: the selected image and its folder, or just the open folder.
  const openProperties = () => {
    if (!selectedImage && !category) {
      setNotice({
        title: "Nothing to show",
        message: "Open a folder or select an image to see its properties.",
      });
      return;
    }
    setPropertiesOpen(true);
  };

  // /api/categories and /api/images sit behind requireAuth, so the workspace
  // cannot render before the session is known - otherwise every load logs 401s.
  if (!authChecked)
    return (
      <div className="login-page">
        <div className="login-brand">
          <Aperture size={20} />
          <span>IMAGINARY</span>
        </div>
      </div>
    );
  if (!user) return <LoginPage onLogin={setUser} />;

  if (homeView)
    return (
      <>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic"
          onChange={chooseFile}
        />
        <Home
          user={user}
          theme={theme}
          onThemeToggle={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          categories={categories}
          access={access}
          onOpenFolder={(folder) => {
            setSelectedCategory(categoryKey(folder.number));
            setHomeView(false);
            setAdminView(false);
          }}
          onUpload={() => {
            setHomeView(false);
            fileInput.current?.click();
          }}
          onCreateFolder={() => {
            setHomeView(false);
            setAdminView(false);
            window.dispatchEvent(new Event("new-category"));
          }}
          onAdmin={() => {
            setHomeView(false);
            setAdminView(true);
          }}
        />
      </>
    );

  if (adminView && isAdminUser)
    return <AdminDashboard
      user={user}
      onHome={() => { setAdminView(false); setHomeView(true); }}
      onFolders={() => setAdminView(false)}
      theme={theme}
      onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
    />;

  // The folder shown in FILE > Properties: the selected image's own folder when
  // an image is selected, otherwise the open folder.
  const propertiesCategory =
    (selectedImage &&
      categories.find(
        (item) => categoryKey(item.number) === selectedImage.category,
      )) ||
    category;

  return (
    <div className="app-shell" data-theme={theme}>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic"
        onChange={chooseFile}
      />
      <MenuBar
        onUpload={() => fileInput.current?.click()}
        theme={theme}
        onThemeToggle={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        user={user}
        canDownload={canDownloadIn(selectedCategory)}
        isAdmin={isAdminUser}
        activeView={view}
        previewSizeKey={previewSize}
        activeResolution={tileResolutionLabel}
        onViewChange={setView}
        onPreviewSize={(entry) => {
          const key = previewSizeKeys[entry];
          if (key) {
            setView("grid");
            setPreviewSize(key);
          }
        }}
        onZoomIn={() => stepPreviewSize(1)}
        onZoomOut={() => stepPreviewSize(-1)}
        onProperties={openProperties}
        onPrint={printSelectedImage}
        onDownloadEntry={handleMenuDownload}
        onFitToScreen={() => {
          setView("grid");
          setPreviewSize("medium");
        }}
        onResolution={(entry) => {
          if (entry === "Custom") {
            setView("grid");
            setPreviewSize("extra");
            setTileResolution(null);
            return;
          }
          const variant = resolutionVariants[entry];
          if (variant) {
            setView("grid");
            setTileResolution(entry);
          }
        }}
        onAdmin={() => {
          setHomeView(false);
          setAdminView(true);
        }}
      />
      <div
        className={`workspace ${previewOpen ? "" : "preview-closed"} ${
          foldersLayerOpen ? "folder-layer-open" : ""
        }`}
      >
        <Sidebar
          categories={categories}
          selected={selectedCategory}
          setSelected={setSelectedCategory}
          onAdd={() => beginCreateCategory()}
          onAddChild={beginCreateCategory}
          onReorder={reorderCategory}
          onDownloadFolder={downloadFolder}
          canDownloadIn={canDownloadIn}
          canManageIn={canManageIn}
          isAdmin={isAdminUser}
          onFoldersLayerChange={setFoldersLayerOpen}
          recentCategoryKeys={recentCategoryKeys}
          organizations={organizations}
          selectedOrgId={selectedOrgId}
          setSelectedOrgId={setSelectedOrgId}
          onAddOrganization={() => {
            setNewOrgName("");
            setNewOrgOpen(true);
          }}
          onEditOrganization={beginEditOrganization}
          onDeleteOrganization={deleteOrganization}
        />
        <main className="main-content">
          <div className="toolbar">
            <button className="mobile-sidebar icon-button">
              <PanelLeft size={17} />
            </button>
            <div className="breadcrumb">
              <span>Files</span>
              {categoryPath.length ? (
                categoryPath.map((folder, index) => (
                  <span className="breadcrumb-segment" key={folder.id}>
                    <ChevronRight size={13} aria-hidden="true" />
                    {index === categoryPath.length - 1 ? (
                      <strong>{folder.name}</strong>
                    ) : (
                      <span className="breadcrumb-parent">{folder.name}</span>
                    )}
                  </span>
                ))
              ) : (
                <>
                  <ChevronRight size={13} aria-hidden="true" />
                  <strong>No folder selected</strong>
                </>
              )}
            </div>
            <div className="toolbar-actions">
              {view === "grid" && (
                <button
                  className="size-control icon-button"
                  title={`Preview size: ${previewSizeLabel(previewSize)}`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setSizeMenu((current) =>
                      current
                        ? null
                        : { left: rect.right - 176, top: rect.bottom + 6 },
                    );
                  }}
                >
                  <LayoutGrid size={15} />
                  <span>{previewSizeLabel(previewSize)}</span>
                  <ChevronDown size={12} />
                </button>
              )}
              <button
                className={`preview-toggle ${previewEnabled ? "active" : ""}`}
                onClick={() =>
                  setPreviewEnabled((enabled) => {
                    const next = !enabled;
                    if (next) setPreviewOpen(true);
                    return next;
                  })
                }
                title={
                  previewEnabled
                    ? "Turn preview panel off permanently"
                    : "Turn preview panel on permanently"
                }
              >
                <PanelRight size={15} />
              </button>
              <button
                className="icon-button"
                onClick={() => setView(view === "grid" ? "list" : "grid")}
                title={
                  view === "grid" ? "Switch to list view" : "Switch to grid view"
                }
              >
                {view === "grid" ? <List size={16} /> : <Grid2X2 size={16} />}
              </button>
            </div>
          </div>
          {/* Reference layout: the search box lives on its own full-width
              second row under the breadcrumb/controls row. The results popup
              anchors to searchBoxRef.getBoundingClientRect(), so it follows the
              box to the new row automatically. */}
          <div className="toolbar-search">
            <label className="search-box" ref={searchBoxRef}>
              <Search size={14} />
              <input
                placeholder="Search by name or document ID"
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchResults[0])
                    openSearchResult(searchResults[0]);
                }}
              />
            </label>
          </div>
          <div className="content-heading content-heading-actions">
            <button
              className="upload-button"
              disabled={!category}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} /> Upload images
            </button>
          </div>
          <div
            className={`drop-zone ${isDraggingFiles ? "active" : ""}`}
            onDragOver={handleGalleryDragOver}
            onDragLeave={handleGalleryDragLeave}
            onDrop={handleGalleryDrop}
          >
            {!category || visibleImages.length === 0 ? (
              <div className="empty-gallery">
                <Upload size={30} />
                <strong>
                  {category
                    ? "No images in this folder"
                    : isAdminUser
                      ? "No folders yet"
                      : "No folders shared with you"}
                </strong>
                <span>
                  {category
                    ? "Upload or drag and drop images"
                    : isAdminUser
                      ? ""
                      : "Ask an administrator to grant you access to a folder."}
                </span>
                {category ? (
                  <button
                    className="empty-upload"
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose images
                  </button>
                ) : !selectedOrgId ? (
                  // Folders always live inside an organization: without one the
                  // admin is pointed at creating it instead of a dead button.
                  isAdminUser && (
                    <button
                      className="empty-upload"
                      onClick={() => {
                        setNewOrgName("");
                        setNewOrgOpen(true);
                      }}
                    >
                      + Create organization
                    </button>
                  )
                ) : (
                  isAdminUser && (
                    <button
                      className="empty-upload"
                      onClick={() => beginCreateCategory()}
                    >
                      Create folder
                    </button>
                  )
                )}
              </div>
            ) : view === "grid" ? (
              <section className="gallery" data-size={previewSize}>
                {visibleImages.map((image) => (
                  <article
                    className={`image-card ${selectedImage?.id === image.id ? "selected" : ""}`}
                    key={image.id}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      setSelectedImage(image);
                      showPreviewPanel();
                    }}
                    onDoubleClick={() => openViewer(image)}
                  >
                    <div className="image-wrap">
                      <img
                        src={tileSource(image, previewSize, tileVariant)}
                        alt={image.name}
                        onError={(event) => {
                          if (event.currentTarget.src !== image.src)
                            event.currentTarget.src = image.src;
                        }}
                      />
                      <button
                        className="card-more"
                        title="Image actions"
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <MoreVertical size={15} />
                      </button>
                    </div>
                    <div className="card-meta">
                      <strong>{image.name}</strong>
                      <span className="card-document-id">
                        {image.documentId
                          ? `ID ${image.documentId}`
                          : "No document ID"}
                      </span>
                      <span>
                        {(image.size / 1024 / 1024).toFixed(2)} MB <i />
                        {image.date}
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            ) : (
              <section className="list-view">
                {visibleImages.map((image) => (
                  <div
                    className="list-row"
                    key={image.id}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      setSelectedImage(image);
                      showPreviewPanel();
                    }}
                    onDoubleClick={() => openViewer(image)}
                  >
                    <img src={image.src} alt={image.name} />
                    <strong>{image.name}</strong>
                    <span className="list-document-id">
                      {image.documentId || "No document ID"}
                    </span>
                    <span>{(image.size / 1024 / 1024).toFixed(2)} MB</span>
                    <span>{image.date}</span>
                    <MoreVertical size={15} />
                  </div>
                ))}
              </section>
            )}
            {isDraggingFiles && (
              <div className="drop-zone-overlay">
                <Upload size={26} />
                <strong>Drop to upload</strong>
                <span>Release to add these images to {category?.name}</span>
              </div>
            )}
          </div>
        </main>
        {previewOpen && (
          <div
            className="inspector-backdrop"
            onClick={() => setPreviewOpen(false)}
          />
        )}
        <aside className={`inspector ${previewOpen ? "" : "closed"}`}>
          <div className="inspector-head">
            <span>PREVIEW</span>
            <div className="inspector-actions">
              {selectedImage && canDownloadIn(selectedImage.category) && (
                <button
                  className="download-button"
                  onClick={() => setDownloadImage(selectedImage)}
                >
                  <Download size={14} /> Download
                </button>
              )}
              <button
                className="close-preview icon-button"
                onClick={() => setPreviewOpen(false)}
                title="Close preview"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {selectedImage ? (
            <>
              <div
                className="preview"
                onDoubleClick={() => openViewer(selectedImage)}
                title="Double-click to open full screen"
              >
                <img
                  src={selectedImage.src}
                  alt={selectedImage.name}
                  style={{ transform: `scale(${zoom / 100})` }}
                />
              </div>
              <div className="preview-tools">
                <button
                  className="icon-button"
                  onClick={() => setZoom(Math.max(50, zoom - 10))}
                >
                  <ZoomOut size={15} />
                </button>
                <span>{zoom}%</span>
                <button
                  className="icon-button"
                  onClick={() => setZoom(Math.min(250, zoom + 10))}
                >
                  <ZoomIn size={15} />
                </button>
              </div>
              <div className="inspector-details">
                <p className="eyebrow">SELECTED IMAGE</p>
                <h2 title={selectedImage.name}>{selectedImage.name}</h2>
                <div className="detail-grid">
                  <span>File size</span>
                  <strong>
                    {(selectedImage.size / 1024 / 1024).toFixed(2)} MB
                  </strong>
                  <span>Original file</span>
                  <strong title={selectedImage.originalName}>
                    {selectedImage.originalName}
                  </strong>
                  <span>Document ID</span>
                  <strong title={selectedImage.documentId || undefined}>
                    {selectedImage.documentId || "Not set"}
                  </strong>
                  <span>Folder</span>
                  <strong title={category?.name}>{category?.name}</strong>
                  <span>Added</span>
                  <strong title={selectedImage.date}>{selectedImage.date}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="no-preview">
              <FileImage size={25} />
              <span>Select an image to preview it here.</span>
            </div>
          )}
          {uploadError && (
            <div className="upload-error">
              <X size={14} />
              <span>{uploadError}</span>
              <button
                className="upload-error-dismiss"
                onClick={() => setUploadError("")}
                aria-label="Dismiss error"
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div className="queue-panel">
            <div className="queue-title">
              <span>UPLOAD QUEUE</span>
              <div className="queue-title-actions">
                <strong>
                  {queue.length} job{queue.length === 1 ? "" : "s"}
                </strong>
                {queue.length > 0 && (
                  <button className="queue-clear" onClick={() => setQueue([])}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            {queue.slice(0, QUEUE_DISPLAY_LIMIT).map((job, index) => (
              <div className="job" key={job.id || `${job.name}-${index}`}>
                <div>
                  <FileImage size={14} />
                  <span>{job.name}</span>
                  <small>{job.status}</small>
                </div>
                <div className="progress">
                  <span
                    className={job.status === "Failed" ? "failed" : ""}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
            ))}
            {queue.length === 0 && (
              <p className="queue-empty">No recent uploads</p>
            )}
            {queue.length > QUEUE_DISPLAY_LIMIT && (
              <p className="queue-more">
                + {queue.length - QUEUE_DISPLAY_LIMIT} earlier uploads
              </p>
            )}
          </div>
        </aside>
      </div>
      {sizeMenu && (
        <PreviewSizeMenu
          size={previewSize}
          anchor={sizeMenu}
          setSize={setPreviewSize}
          onClose={() => setSizeMenu(null)}
        />
      )}
      {searchOpen &&
        search.trim() &&
        searchBoxRef.current &&
        (() => {
          const rect = searchBoxRef.current.getBoundingClientRect();
          const width = Math.max(rect.width, 340);
          return (
            <div
              className="image-action-menu search-results-menu"
              style={{
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                top: rect.bottom + 6,
                width,
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              <p className="preview-size-title">Document id :</p>
              {searchLoading && <p className="category-empty">Searching…</p>}
              {!searchLoading && searchResults.length === 0 && (
                <p className="category-empty">
                  No document ID matches “{search.trim()}”
                </p>
              )}
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => openSearchResult(result)}
                  title={`${result.original_name} — ${result.category_name}`}
                >
                  <Tag size={14} />
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      minWidth: 0,
                      textAlign: "left",
                    }}
                  >
                    <strong>{result.document_id}</strong>
                    <small style={{ opacity: 0.7 }}>
                      {result.original_name} · {result.category_name}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          );
        })()}
      <ImageActionMenu
        action={imageAction}
        onDownload={setDownloadImage}
        onEditDocumentId={openDocumentIdEditor}
        onDelete={setDeleteImage}
        onMoveToFolder={setMoveImage}
        onCopyToFolder={setCopyImage}
        onClose={() => setImageAction(null)}
        canDownload={canDownloadIn(imageAction?.image?.category)}
        canEdit={canEditImageIn(imageAction?.image?.category)}
        canMoveToFolder={canEditImageIn(imageAction?.image?.category)}
        canCopyToFolder={canEditImageIn(imageAction?.image?.category)}
      />
      <UploadDialog
        file={pendingFile}
        category={uploadCategory}
        categories={categories}
        setCategory={setUploadCategory}
        name={uploadName}
        setName={setUploadName}
        documentId={uploadDocumentId}
        setDocumentId={setUploadDocumentId}
        documentIdTaken={documentIdInUse(
          uploadDocumentId,
          null,
          folderKeyForId(uploadCategory),
        )}
        onCancel={() => setPendingFile(null)}
        onConfirm={confirmUpload}
      />
      <BulkUploadDialog
        files={pendingFiles}
        category={bulkCategory}
        categories={categories}
        setCategory={setBulkCategory}
        documentPrefix={bulkDocumentPrefix}
        setDocumentPrefix={setBulkDocumentPrefix}
        onCancel={() => setPendingFiles([])}
        onConfirm={confirmBulkUpload}
      />
      <DocumentIdDialog
        image={documentIdImage}
        value={documentIdDraft}
        setValue={setDocumentIdDraft}
        error={documentIdError}
        saving={documentIdSaving}
        onCancel={() => {
          setDocumentIdImage(null);
          setDocumentIdDraft("");
          setDocumentIdError("");
        }}
        onSave={saveDocumentId}
      />
      <MoveImageDialog
        image={moveImage}
        onClose={() => setMoveImage(null)}
        onMoved={handleImageMoved}
        categories={categories}
        canUploadTo={canUploadTo}
        currentCategoryNumberKey={selectedCategory}
      />
      <CopyImageDialog
        image={copyImage}
        onClose={() => setCopyImage(null)}
        onCopied={handleImageCopied}
        categories={categories}
        canUploadTo={canUploadTo}
        currentCategoryNumberKey={selectedCategory}
      />
      <DownloadDialog
        image={downloadImage}
        onCancel={() => setDownloadImage(null)}
        onDownload={download}
      />
      <DeleteDialog
        image={deleteImage}
        onCancel={() => setDeleteImage(null)}
        onConfirm={() => deleteImageRecord(deleteImage)}
      />
      <FullscreenPreview
        image={fullscreenImage}
        zoom={zoom}
        setZoom={setZoom}
        onClose={() => setFullscreenImage(null)}
      />
      <CategoryDialog
        open={newCategoryOpen}
        name={newCategoryName}
        setName={setNewCategoryName}
        categories={categories}
        parentId={newCategoryParentId}
        setParentId={setNewCategoryParentId}
        onCancel={() => {
          setNewCategoryName("");
          setNewCategoryParentId("");
          setNewCategoryOpen(false);
        }}
        onConfirm={createCategory}
      />
      <CategoryEditDialog
        category={editCategory}
        name={editCategoryName}
        setName={setEditCategoryName}
        onCancel={() => {
          setEditCategory(null);
          setEditCategoryName("");
        }}
        onConfirm={saveCategory}
      />
      <CategoryDeleteDialog
        category={deleteCategory}
        onCancel={() => setDeleteCategory(null)}
        onConfirm={deleteCategoryRecord}
      />
      <CreateUserDialog
        open={createUserOpen}
        categories={categories}
        onCancel={() => setCreateUserOpen(false)}
        onConfirm={createUser}
        error={createUserError}
        submitting={createUserSubmitting}
      />
      <OrganizationDialog
        open={newOrgOpen}
        name={newOrgName}
        setName={setNewOrgName}
        onCancel={() => {
          setNewOrgName("");
          setNewOrgOpen(false);
        }}
        onConfirm={createOrganization}
      />
      <OrganizationDialog
        open={Boolean(editOrg)}
        name={editOrgName}
        setName={setEditOrgName}
        editing
        onCancel={() => {
          setEditOrg(null);
          setEditOrgName("");
        }}
        onConfirm={saveOrganization}
      />
      <OrganizationDeleteDialog
        organization={deleteOrg}
        onCancel={() => setDeleteOrg(null)}
        onConfirm={confirmDeleteOrganization}
      />
      <PropertiesDialog
        open={propertiesOpen}
        image={selectedImage}
        category={propertiesCategory}
        organizationName={
          organizations.find(
            (org) => String(org.id) === String(propertiesCategory?.organizationId),
          )?.name
        }
        subfolderCount={
          propertiesCategory ? childCategoryIds(propertiesCategory.id).length : 0
        }
        onClose={() => setPropertiesOpen(false)}
      />
      <NoticeDialog notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

export default App;
