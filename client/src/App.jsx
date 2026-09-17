import { useEffect, useRef, useState } from 'react'
import { Aperture, Archive, Bell, Camera, Check, ChevronDown, ChevronRight, Download, Edit3, FileImage, Grid2X2, GripVertical, LayoutGrid, List, LogOut, Menu, MoreVertical, PanelLeft, PanelRight, Plus, Search, Shield, SlidersHorizontal, Trash2, Upload, UserPlus, X, ZoomIn, ZoomOut } from 'lucide-react'
import JSZip from 'jszip'
import { menuConfig } from './menuConfig'
import LoginPage from './Loginpage'
import './App.css'

const categoryKey = (number) => String(number).padStart(2, '0')

const previewSizes = [
  { key: 'small', label: 'Small preview', short: 'Small', variant: 'thumbnail' },
  { key: 'medium', label: 'Medium preview', short: 'Medium', variant: 'web' },
  { key: 'large', label: 'Large preview', short: 'Large', variant: 'web' },
  { key: 'extra', label: 'Extra large preview', short: 'Extra large', variant: 'web' },
]
const defaultPreviewSize = 'medium'
const QUEUE_DISPLAY_LIMIT = 8
const QUEUE_MAX = 40
const previewSizeKeys = { 'Small preview': 'small', 'Medium preview': 'medium', 'Large preview': 'large', 'Extra large preview': 'extra' }
const readPreviewSize = () => { const saved = window.localStorage.getItem('imagery.preview-size'); return previewSizes.some((item) => item.key === saved) ? saved : defaultPreviewSize }
const previewSizeLabel = (size) => previewSizes.find((item) => item.key === size)?.short || previewSizes.find((item) => item.key === defaultPreviewSize).short
const tileSource = (image, size) => {
  const variant = previewSizes.find((item) => item.key === size)?.variant
  return variant && typeof image.id === 'number' ? `http://localhost:4000/api/variants/${image.id}/${variant}` : image.src
}
const fullSource = (image) => typeof image.id === 'number' ? `http://localhost:4000/api/variants/${image.id}/hd` : image.src
const userInitials = (user) => (user?.username || user?.email || '?').slice(0, 2).toUpperCase()

// Vite serves the client on :5173 and the API on :4000, so every call is
// cross-origin and has to opt in to sending the imagery_session cookie.
// Without credentials:'include' the browser strips the cookie and the server's
// requireAuth/requirePermission middleware answers 401 Unauthorized.
const apiFetch = (path, options = {}) => fetch(`http://localhost:4000${path}`, { credentials: 'include', ...options })

// Mirrors EMAIL_PATTERN in server/src/routes/users.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// FILE-menu rows that only an admin may use. POST /api/users and
// POST /api/categories are admin-scoped operations, so a standard user should
// not even be offered them.
const ADMIN_ONLY_MENU_ROWS = new Set(['Create User', 'New Category'])

const readCategoryOrder = () => { try { return JSON.parse(window.localStorage.getItem('imagery.category-order') || '{}') } catch { return {} } }
const writeCategoryOrder = (map) => { try { window.localStorage.setItem('imagery.category-order', JSON.stringify(map)) } catch {} }
const readPreviewEnabled = () => {
  try {
    const saved = window.localStorage.getItem('imagery.preview-enabled')
    if (saved === 'true') return true
    if (saved === 'false') return false
  } catch {}
  return true
}

function buildCategoryTree(categories) {
  const nodes = categories.map((category) => ({ ...category, children: [] }))
  const byId = new Map(nodes.map((category) => [String(category.id), category]))
  const roots = []
  nodes.forEach((category) => {
    const parent = category.parentId ? byId.get(String(category.parentId)) : null
    if (parent) parent.children.push(category)
    else roots.push(category)
  })
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)
  roots.sort(byOrder)
  nodes.forEach((category) => category.children.sort(byOrder))
  return roots
}

// ---- Folder-as-ZIP download helpers -------------------------------------

// Every category (this one + all nested subfolders), collected recursively.
function collectDescendantIds(rootId, categories) {
  const direct = categories.filter((item) => String(item.parentId || '') === String(rootId)).map((item) => item.id)
  return direct.flatMap((id) => [id, ...collectDescendantIds(id, categories)])
}

// Builds the folder's path inside the zip relative to the folder being downloaded,
// e.g. downloading "Trips" and zipping "Trips/Japan/Tokyo" gives "Japan/Tokyo".
function relativeFolderPath(cat, categories, rootId) {
  const byId = new Map(categories.map((item) => [String(item.id), item]))
  const parts = []
  let current = cat
  while (current && String(current.id) !== String(rootId)) {
    parts.unshift(current.name)
    current = current.parentId ? byId.get(String(current.parentId)) : null
  }
  return parts.join('/')
}

// Downloads a category and every nested subfolder as a single ZIP, preserving
// the folder structure and each image's real filename.
async function downloadCategoryAsZip(rootCategory, categories, onProgress) {
  const descendantIds = collectDescendantIds(rootCategory.id, categories)
  const allCats = categories.filter((item) => item.id === rootCategory.id || descendantIds.includes(item.id))
  const zip = new JSZip()
  let done = 0
  let total = 0

  // Fetch each folder's image list up front so progress reflects the real total.
  const perFolder = await Promise.all(allCats.map(async (cat) => {
    const response = await apiFetch(`/api/images?categoryId=${cat.id}`)
    const items = response.ok ? await response.json() : []
    total += items.length
    return { cat, items }
  }))

  onProgress?.(2)

  for (const { cat, items } of perFolder) {
    const relPath = relativeFolderPath(cat, categories, rootCategory.id)
    const folder = relPath ? zip.folder(relPath) : zip
    for (const item of items) {
      try {
        const fileRes = await apiFetch(`/api/variants/${item.id}/original`)
        if (fileRes.ok) {
          const blob = await fileRes.blob()
          folder.file(item.original_name, blob)
        }
      } catch {
        // Skip files that fail to fetch rather than aborting the whole zip.
      }
      done += 1
      onProgress?.(2 + Math.round((done / Math.max(total, 1)) * 88))
    }
  }

  const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    onProgress?.(90 + Math.round(metadata.percent * 0.1))
  })
  const href = URL.createObjectURL(content)
  const link = document.createElement('a')
  link.href = href
  link.download = `${rootCategory.name}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

// ---------------------------------------------------------------------------

function MenuBar({ onUpload, user, canDownload = true, isAdmin = false }) {
  const [open, setOpen] = useState(null)
  const [webcamOpen, setWebcamOpen] = useState(false)
  useEffect(() => {
    if (open === null) return undefined
    // 'open' is null | nav index | 'profile', so both the nav dropdowns and the
    // profile panel count as "inside" for the click-outside-to-close check.
    const insideMenu = (target) => Boolean(target.closest('.menu-wrap') || target.closest('.profile-wrap'))
    const closeMenu = (event) => { if (!insideMenu(event.target)) setOpen(null) }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeMenu); document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  return <><header className="topbar"><div className="brand"><Aperture size={18} /><span>IMAGERY</span><i>workspace</i></div><button className="mobile-menu icon-button"><Menu size={18} /></button><nav className="menus">{menuConfig.map((menu, index) => <div className="menu-wrap" key={menu.label} onMouseEnter={() => open !== null && open !== 'profile' && setOpen(index)}><button className={`menu-button ${open === index ? 'active' : ''}`} onClick={() => { const next = open === index ? null : index; if (next !== null) window.dispatchEvent(new Event('close-popovers')); setOpen(next) }}>{menu.label}<ChevronDown size={12} /></button>{open === index && <div className="dropdown">{menu.items.filter((item) => isAdmin || !ADMIN_ONLY_MENU_ROWS.has(item.label)).map((item) => <div key={item.label} className={`dropdown-row ${item.permission === 'download' && !canDownload ? 'disabled' : ''}`} onClick={() => { if (item.permission === 'download' && !canDownload) return; if (item.label === 'Create User') window.dispatchEvent(new Event('create-user')); else if (item.label === 'New Category') window.dispatchEvent(new Event('new-category')); else if (item.label === 'Open Category') window.dispatchEvent(new Event('open-category')); else if (item.label === 'Recent Categories') window.dispatchEvent(new Event('recent-categories')); else if (item.label === 'Preview Size') window.dispatchEvent(new Event('preview-size-menu')); else if (item.label.includes('Webcam')) setWebcamOpen(true); else if (item.label.includes('Upload')) onUpload(); else if (item.label === 'Sign Out and Exit' || item.label === 'Exit Application' || item.label === 'Lock Screen') window.dispatchEvent(new Event('sign-out')); setOpen(null) }}><span>{item.label}</span>{item.submenu && <ChevronRight size={13} />}</div>)}</div>}</div>)}</nav><div className="top-actions"><button className="icon-button"><Search size={16} /></button><button className="icon-button"><Bell size={16} /></button><div className="profile-wrap"><button className={`profile ${open === 'profile' ? 'active' : ''}`} onClick={() => { const next = open === 'profile' ? null : 'profile'; if (next) window.dispatchEvent(new Event('close-popovers')); setOpen(next) }} aria-expanded={open === 'profile'} title={user?.email || ''}><span className="avatar">{userInitials(user)}</span><span>{user?.username || 'Guest'}</span><ChevronDown size={13} /></button>{open === 'profile' && <ProfileMenu user={user} onSignOut={() => { setOpen(null); window.dispatchEvent(new Event('sign-out')) }} />}</div></div></header>{webcamOpen && <WebcamDialog onCancel={() => setWebcamOpen(false)} onCapture={(file) => { setWebcamOpen(false); window.dispatchEvent(new CustomEvent('webcam-captured', { detail: file })) }} />}</>
}

function Sidebar({ categories, selected, setSelected, onAdd, onAddChild, onReorder, onDownloadFolder, isAdmin = false, canDownloadIn = () => true, canManageIn = () => true, onEdit = (category) => window.dispatchEvent(new CustomEvent('edit-category', { detail: category })), onDelete = (category) => window.dispatchEvent(new CustomEvent('delete-category', { detail: category })) }) {
  const [categorySearch, setCategorySearch] = useState('')
  const [chooserTitle, setChooserTitle] = useState(null)
  const [categoryAction, setCategoryAction] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  useEffect(() => {
    const openCategory = () => setChooserTitle('Open category')
    const openRecent = () => setChooserTitle('Recent categories')
    window.addEventListener('open-category', openCategory)
    window.addEventListener('recent-categories', openRecent)
    return () => { window.removeEventListener('open-category', openCategory); window.removeEventListener('recent-categories', openRecent) }
  }, [])

  useEffect(() => {
    if (!categoryAction) return undefined
    const closeMenu = (event) => { if (!event.target.closest('.image-action-menu') && !event.target.closest('.category-more')) setCategoryAction(null) }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [categoryAction])

  // Auto-open every parent of the selected folder so the selection is always visible
  useEffect(() => {
    if (!selected) return
    const byId = new Map(categories.map((item) => [String(item.id), item]))
    let current = categories.find((item) => categoryKey(item.number) === selected)
    const toOpen = []
    while (current?.parentId) {
      const parent = byId.get(String(current.parentId))
      if (!parent || toOpen.includes(parent.id)) break
      toOpen.push(parent.id)
      current = parent
    }
    if (toOpen.length) setExpanded((prev) => { const next = new Set(prev); toOpen.forEach((id) => next.add(id)); return next })
  }, [selected, categories])

  const searchTerm = categorySearch.trim().toLowerCase()
  const matchesSearch = (category) => !searchTerm || category.name.toLowerCase().includes(searchTerm) || category.children.some(matchesSearch)
  const tree = buildCategoryTree(categories).filter(matchesSearch)
  const toggleExpand = (id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const canDrag = Boolean(onReorder) && !searchTerm
  const handleDragStart = (event, category) => {
    event.stopPropagation()
    setDraggedId(category.id)
    event.dataTransfer.effectAllowed = 'move'
    try { event.dataTransfer.setData('text/plain', String(category.id)) } catch {}
  }
  const handleDragEnter = (event, category) => {
    if (draggedId == null || draggedId === category.id) return
    event.preventDefault()
    setDragOverId(category.id)
  }
  const handleDragOver = (event, category) => {
    if (draggedId == null || draggedId === category.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const handleDrop = (event, category) => {
    event.preventDefault()
    event.stopPropagation()
    if (draggedId != null && draggedId !== category.id) onReorder?.(draggedId, category.id)
    setDraggedId(null)
    setDragOverId(null)
  }
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null) }

  const renderCategory = (category, depth = 0) => {
    const key = categoryKey(category.number)
    const visibleChildren = category.children.filter(matchesSearch)
    const hasChildren = visibleChildren.length > 0
    const isOpen = Boolean(searchTerm) || expanded.has(category.id)
    // Ancestor-only folders (no grant of their own) get no action menu, so the
    // "..." trigger stays hidden instead of opening an empty popover.
    const canDownload = canDownloadIn(key)
    const canManage = canManageIn(key)
    return (
      <div className="category-tree-row" key={category.id || category.number}>
        <div
          className={`category-item ${selected === key ? 'selected' : ''} ${draggedId === category.id ? 'dragging' : ''} ${dragOverId === category.id ? 'drag-over' : ''}`}
          style={{ '--depth': depth }}
          draggable={canDrag}
          onDragStart={canDrag ? (event) => handleDragStart(event, category) : undefined}
          onDragEnter={canDrag ? (event) => handleDragEnter(event, category) : undefined}
          onDragOver={canDrag ? (event) => handleDragOver(event, category) : undefined}
          onDrop={canDrag ? (event) => handleDrop(event, category) : undefined}
          onDragEnd={canDrag ? handleDragEnd : undefined}
        >
          {canDrag && <GripVertical size={13} className="drag-handle" title="Drag to reorder" />}
          {hasChildren ? (
            <button
              type="button"
              className={`tree-caret ${isOpen ? 'open' : ''}`}
              aria-expanded={isOpen}
              title={isOpen ? 'Collapse folder' : 'Expand folder'}
              onClick={(event) => { event.stopPropagation(); toggleExpand(category.id) }}
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
            onClick={() => { setSelected(key); if (hasChildren && !expanded.has(category.id)) toggleExpand(category.id) }}
            onDoubleClick={() => { if (hasChildren) toggleExpand(category.id) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(key) }
              if (event.key === 'ArrowRight' && hasChildren && !isOpen) { event.preventDefault(); toggleExpand(category.id) }
              if (event.key === 'ArrowLeft' && hasChildren && isOpen) { event.preventDefault(); toggleExpand(category.id) }
            }}
          >
            <span className="category-number">{key}</span>
            <span className="category-name category-name-bold">
              {category.name}
              <small>{category.count} images{hasChildren ? ` • ${visibleChildren.length} folders` : ''}</small>
            </span>
          </div>
          {(canDownload || canManage) && (
          <button
            className="category-more icon-button"
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setCategoryAction((current) => current?.category?.id === category.id ? null : { category, left: rect.right - 180, top: rect.bottom + 6 })
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
    )
  }

  return (
    <aside className="sidebar">
      <div className="category-heading category-heading-only"><span>FOLDERS</span><span>{categories.length}</span></div>
      <label className="category-search"><Search size={13} /><input placeholder="Search folders" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} /></label>
      <div className="category-list">{tree.map((category) => renderCategory(category))}</div>
      {tree.length === 0 && <p className="category-empty">No folders found</p>}
      {isAdmin && <button className="new-category" onClick={onAdd}><Plus size={14} /> New folder</button>}
      {categoryAction && <CategoryActionMenu action={categoryAction} canDownload={canDownloadIn(categoryKey(categoryAction.category.number))} canManage={canManageIn(categoryKey(categoryAction.category.number))} onAddChild={(category) => { onAddChild(category); setCategoryAction(null) }} onEdit={(category) => { onEdit(category); setCategoryAction(null) }} onDownload={(category) => { onDownloadFolder(category); setCategoryAction(null) }} onDelete={(category) => { onDelete(category); setCategoryAction(null) }} />}
      {chooserTitle && <CategoryChooserDialog title={chooserTitle} categories={categories} onSelect={(number) => { setSelected(categoryKey(number)); setChooserTitle(null) }} onClose={() => setChooserTitle(null)} />}
    </aside>
  )
}

function UploadDialog({ file, categories, category, setCategory, name, setName, onCancel, onConfirm }) {
  const [categorySearch, setCategorySearch] = useState('')
  const [format, setFormat] = useState('original')
  if (!file) return null
  const matches = categories.filter((item) => item.name.toLowerCase().includes(categorySearch.toLowerCase()))
  return <div className="modal-backdrop"><div className="upload-dialog"><div className="dialog-header"><div><p className="eyebrow">ADD IMAGE</p><h2>Upload to workspace</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><div className="dialog-preview"><img src={URL.createObjectURL(file)} alt="Upload preview" /></div><div className="dialog-file"><FileImage size={18} /><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></div></div><label className="dialog-label">Image name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="dialog-label">Upload format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="original">Original format</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label><label className="dialog-label">Search category<input placeholder="Search categories" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} /></label><div className="category-selection-label">{category ? 'Selected category' : 'Select a category'}</div><div className="category-results">{matches.map((item) => { const chosen = category === String(item.id); return <button className={chosen ? 'chosen' : ''} key={item.id} onClick={() => setCategory(String(item.id))}><span>{String(item.number).padStart(2, '0')}</span><strong>{item.name}</strong>{chosen && <><em>Selected</em><Check size={14} /></>}</button> })}</div><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={!category || !name.trim()} onClick={() => onConfirm(format)}><Upload size={15} /> Add image</button></div></div></div>
}

function BulkUploadDialog({ files, categories, category, setCategory, onCancel, onConfirm }) {
  const [categorySearch, setCategorySearch] = useState('')
  const [format, setFormat] = useState('original')
  if (!files || files.length === 0) return null
  const matches = categories.filter((item) => item.name.toLowerCase().includes(categorySearch.toLowerCase()))
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)
  const preview = files.slice(0, 6)
  return <div className="modal-backdrop"><div className="upload-dialog bulk-upload-dialog"><div className="dialog-header"><div><p className="eyebrow">BULK UPLOAD</p><h2>Upload {files.length} images</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><div className="bulk-summary"><span>{files.length} files selected</span><span>{(totalSize / 1024 / 1024).toFixed(2)} MB total</span></div><div className="bulk-file-list">{preview.map((file, index) => <div className="bulk-file-row" key={`${file.name}-${index}`}><FileImage size={14} /><span>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></div>)}{files.length > preview.length && <div className="bulk-file-more">+ {files.length - preview.length} more files</div>}</div><label className="dialog-label">Upload format (applies to all)<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="original">Original format</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label><label className="dialog-label">Search category<input placeholder="Search categories" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} /></label><div className="category-selection-label">{category ? 'Selected category' : 'Select a category'}</div><div className="category-results">{matches.map((item) => { const chosen = category === String(item.id); return <button className={chosen ? 'chosen' : ''} key={item.id} onClick={() => setCategory(String(item.id))}><span>{String(item.number).padStart(2, '0')}</span><strong>{item.name}</strong>{chosen && <><em>Selected</em><Check size={14} /></>}</button> })}</div><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={!category} onClick={() => onConfirm(format)}><Upload size={15} /> Upload {files.length} images</button></div></div></div>
}

function DownloadDialog({ image, onCancel, onDownload }) {
  const [format, setFormat] = useState('original')
  if (!image) return null
  return <div className="modal-backdrop"><div className="download-dialog"><div className="dialog-header"><div><p className="eyebrow">EXPORT IMAGE</p><h2>Download image</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><div className="download-preview"><img src={image.src} alt={image.name} /></div><strong className="download-name">{image.name}</strong><label className="dialog-label">Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="original">Original file</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="heic">HEIC</option></select></label><small className="format-note">PNG, JPEG, and WebP are converted in your browser. HEIC downloads the original file.</small><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" onClick={() => onDownload(format)}><Download size={15} /> Download</button></div></div></div>
}

function FullscreenPreview({ image, zoom, setZoom, onClose }) {
  const [sharpReady, setSharpReady] = useState(false)
  const [sharpFailed, setSharpFailed] = useState(false)

  useEffect(() => {
    if (!image) return undefined
    setSharpReady(false)
    setSharpFailed(false)
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [image, onClose])

  if (!image) return null
  const zoomed = zoom !== 100
  const source = sharpReady ? fullSource(image) : image.src

  return <div className="fullscreen-preview" onDoubleClick={(event) => { if (!event.target.closest('.fullscreen-bar') && event.target.tagName !== 'IMG') onClose() }}><div className="fullscreen-bar"><div><p className="eyebrow">FULL SCREEN PREVIEW</p><strong>{image.name}</strong></div><div className="fullscreen-actions">{!sharpReady && !sharpFailed && <span className="fullscreen-hint">Loading full resolution…</span>}<span className="zoom-readout">{zoom}%</span><button className="icon-button" onClick={() => setZoom(100)} title="Fit to screen">Fit</button><button className="icon-button" onClick={() => setZoom(Math.max(50, zoom - 25))} title="Zoom out"><ZoomOut size={18} /></button><button className="icon-button" onClick={() => setZoom(Math.min(300, zoom + 25))} title="Zoom in"><ZoomIn size={18} /></button><button className="icon-button" onClick={onClose} title="Close full screen"><X size={20} /></button></div></div><div className={`fullscreen-stage ${zoomed ? 'zoomed' : ''}`}><img src={source} alt={image.name} draggable={false} onDoubleClick={() => setZoom(zoom === 100 ? 200 : 100)} onLoad={(event) => { if (event.currentTarget.src.includes('/hd')) setSharpReady(true) }} onError={(event) => { if (event.currentTarget.src !== image.src) { setSharpFailed(true); setSharpReady(false); event.currentTarget.src = image.src } }} style={zoomed ? { width: `${zoom}%` } : undefined} /></div></div>
}

function CategoryDialog({ open, name, setName, categories, parentId, setParentId, onCancel, onConfirm }) {
  if (!open) return null
  return <div className="modal-backdrop"><div className="category-dialog"><div className="dialog-header"><div><p className="eyebrow">NEW FOLDER</p><h2>Create folder</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><p className="dialog-description">Create a folder at the top level or inside another folder.</p><label className="dialog-label">Folder name<input autoFocus placeholder="For example, Product photos" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onConfirm()} /></label><label className="dialog-label">Location<select value={parentId || ''} onChange={(event) => setParentId(event.target.value)}><option value="">Top level</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryKey(category.number)} - {category.name}</option>)}</select></label><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={!name.trim()} onClick={onConfirm}><Plus size={15} /> Create folder</button></div></div></div>
}

function ImageActionMenu({ action, onDownload, onDelete, onClose, canDownload = true }) {
  if (!action) return null
  return <div className="image-action-menu" style={{ left: action.left, top: action.top }}>{canDownload && <button onClick={() => { onDownload(action.image); onClose() }}><Download size={14} /> Download</button>}<button className="danger-action" onClick={() => { onDelete(action.image); onClose() }}><Trash2 size={14} /> Delete</button></div>
}

function CategoryActionMenu({ action, onAddChild, onEdit, onDownload, onDelete, canDownload = true, canManage = true }) {
  if (!canDownload && !canManage) return null
  return <div className="image-action-menu category-action-menu" style={{ left: action.left, top: action.top }}>{canManage && <button onClick={() => onAddChild(action.category)}><Plus size={14} /> New subfolder</button>}{canManage && <button onClick={() => onEdit(action.category)}><Edit3 size={14} /> Rename folder</button>}{canDownload && <button onClick={() => onDownload(action.category)}><Archive size={14} /> Download folder as ZIP</button>}{canManage && <button className="danger-action" onClick={() => onDelete(action.category)}><Trash2 size={14} /> Delete folder</button>}</div>
}

function PreviewSizeMenu({ size, anchor, setSize, onClose }) {
  useEffect(() => {
    const closeMenu = (event) => { if (!event.target.closest('.preview-size-menu') && !event.target.closest('.size-control')) onClose() }
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeMenu); document.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])
  return <div className="image-action-menu preview-size-menu" style={{ left: anchor.left, top: anchor.top }}><p className="preview-size-title">PREVIEW SIZE</p>{previewSizes.map((item) => <button key={item.key} className={item.key === size ? 'active' : ''} onClick={() => { setSize(item.key); onClose() }}><i className="size-swatch" data-size={item.key} /><span>{item.label}</span>{item.key === size && <Check size={14} />}</button>)}</div>
}

const roleLabel = (role) => role === 'admin' ? 'Administrator' : 'Standard user'

// Opened from the topbar profile chip. Sign out dispatches the same 'sign-out'
// event the EXIT menu uses, so App.signOut() stays the single sign-out path.
function ProfileMenu({ user, onSignOut }) {
  return <div className="profile-dropdown"><p className="eyebrow">PROFILE</p><div className="profile-identity"><span className="avatar">{userInitials(user)}</span><div><strong>{user?.username || 'Guest'}</strong><span>{user?.email || 'Not signed in'}</span></div></div><div className="detail-grid profile-detail"><span>Role</span><strong>{roleLabel(user?.role)}</strong><span>User ID</span><strong>{user?.id ?? '—'}</strong></div><button className="profile-signout" onClick={onSignOut}><LogOut size={14} /> Sign out</button></div>
}

function DeleteDialog({ image, onCancel, onConfirm }) {
  if (!image) return null
  return <div className="modal-backdrop"><div className="category-dialog"><div className="dialog-header"><div><p className="eyebrow">DELETE IMAGE</p><h2>Delete this image?</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><p className="dialog-description"><strong>{image.name}</strong> and all generated files will be permanently removed from the database and storage folder.</p><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="delete-button" onClick={onConfirm}><Trash2 size={15} /> Delete image</button></div></div></div>
}

function CategoryEditDialog({ category, name, setName, onCancel, onConfirm }) {
  if (!category) return null
  return <div className="modal-backdrop"><div className="category-dialog"><div className="dialog-header"><div><p className="eyebrow">EDIT CATEGORY</p><h2>Rename category</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><p className="dialog-description">Update the display name for category {String(category.number).padStart(2, '0')}.</p><label className="dialog-label">Category name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onConfirm()} /></label><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={!name.trim()} onClick={onConfirm}><Check size={15} /> Save changes</button></div></div></div>
}

function CategoryDeleteDialog({ category, onCancel, onConfirm }) {
  if (!category) return null
  return <div className="modal-backdrop"><div className="category-dialog"><div className="dialog-header"><div><p className="eyebrow">DELETE CATEGORY</p><h2>Delete this category?</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div><p className="dialog-description"><strong>{category.name}</strong> contains {category.count} images. The category, its images, and generated files will be permanently removed.</p><div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="delete-button" onClick={onConfirm}><Trash2 size={15} /> Delete category</button></div></div></div>
}

const PERMISSION_LEVELS = [
  { key: 'none', label: 'No access' },
  { key: 'view', label: 'View only' },
  { key: 'edit', label: 'View + upload/download' },
  { key: 'manage', label: 'Full control (incl. delete)' },
]

// Flattens the category tree into a depth-aware list purely for rendering
// indented rows in the permission picker (doesn't mutate the tree used elsewhere).
function flattenCategoryTree(categories, depth = 0, out = []) {
  categories.forEach((category) => {
    out.push({ ...category, depth })
    if (category.children?.length) flattenCategoryTree(category.children, depth + 1, out)
  })
  return out
}

function CreateUserDialog({ open, categories, onCancel, onConfirm, error, submitting }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [permissions, setPermissions] = useState({})

  useEffect(() => {
    if (!open) { setUsername(''); setEmail(''); setPassword(''); setRole('user'); setPermissions({}) }
  }, [open])

  if (!open) return null
  const flatCategories = flattenCategoryTree(buildCategoryTree(categories))
  const setLevel = (categoryId, level) => setPermissions((current) => ({ ...current, [categoryId]: level }))
  const canSubmit = EMAIL_PATTERN.test(email.trim()) && Boolean(password.trim())

  const submit = () => {
    if (!canSubmit) return
    const grantedPermissions = Object.entries(permissions)
      .filter(([, level]) => level && level !== 'none')
      .map(([categoryId, level]) => ({ categoryId: Number(categoryId), level }))
    // Username is optional - the API derives one from the email when it's blank.
    onConfirm({ username: username.trim() || undefined, email: email.trim(), password, role, permissions: grantedPermissions })
  }

  return <div className="modal-backdrop"><div className="category-dialog" style={{ width: 'min(480px, calc(100vw - 30px))' }}>
    <div className="dialog-header"><div><p className="eyebrow">ADMIN</p><h2>Create user</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div>
    <p className="dialog-description">New users sign in with their email and can access only the folders you grant below.</p>
    <label className="dialog-label">Email<input autoFocus type="email" placeholder="e.g. jane@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="dialog-label">Username (optional)<input placeholder="e.g. jane.doe" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <p className="format-note">Leave blank to use the email address instead.</p>
    <label className="dialog-label">Temporary password<input type="password" placeholder="User should change this after first login" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label className="dialog-label">Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="user">Standard user</option><option value="admin">Admin</option></select></label>
    {role === 'user' && <>
      <div className="category-selection-label" style={{ marginTop: 16 }}>FOLDER PERMISSIONS</div>
      <div className="category-chooser-list" style={{ maxHeight: 220 }}>
        {flatCategories.length ? flatCategories.map((cat) => <div key={cat.id} className="dropdown-row" style={{ paddingLeft: 10 + cat.depth * 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
          <select value={permissions[cat.id] || 'none'} onChange={(event) => setLevel(cat.id, event.target.value)} style={{ height: 28, fontSize: 11 }}>
            {PERMISSION_LEVELS.map((level) => <option key={level.key} value={level.key}>{level.label}</option>)}
          </select>
        </div>) : <p className="category-empty">No folders exist yet</p>}
      </div>
    </>}
    {role === 'admin' && <p className="format-note" style={{ marginTop: 10 }}><Shield size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />Admins automatically have full access to every folder.</p>}
    {error && <p className="format-note" style={{ color: '#b24f52', marginTop: 10 }}>{error}</p>}
    <div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={!canSubmit || submitting} onClick={submit}><UserPlus size={15} /> {submitting ? 'Creating…' : 'Create user'}</button></div>
  </div></div>
}

async function convertForUpload(file, format) {
  if (format === 'original') return file
  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = sourceUrl
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    const mime = `image/${format === 'jpeg' ? 'jpeg' : format}`
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, format === 'jpeg' ? 0.92 : undefined))
    const baseName = file.name.replace(/\.[^.]+$/, '')
    return new File([blob], `${baseName}.${format === 'jpeg' ? 'jpg' : format}`, { type: mime })
  } finally { URL.revokeObjectURL(sourceUrl) }
}

function CategoryChooserDialog({ title, categories, onSelect, onClose }) {
  return <div className="modal-backdrop"><div className="category-dialog"><div className="dialog-header"><div><p className="eyebrow">CATEGORY</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose}><X size={16} /></button></div><div className="category-chooser-list">{categories.length ? categories.map((item) => <button key={item.id} onClick={() => onSelect(item.number)}><span>{String(item.number).padStart(2, '0')}</span><strong>{item.name}</strong><small>{item.count} images</small><ChevronRight size={14} /></button>) : <p className="category-empty">No categories available</p>}</div></div></div>
}

function WebcamDialog({ onCancel, onCapture }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then((stream) => {
      if (!active) return stream.getTracks().forEach((track) => track.stop())
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    }).catch(() => setError('Camera permission was denied or no camera is available.'))
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()) }
  }, [])
  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => { if (blob) onCapture(new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' })) }, 'image/jpeg', 0.92)
  }
  return <div className="modal-backdrop"><div className="webcam-dialog"><div className="dialog-header"><div><p className="eyebrow">CAMERA</p><h2>Capture from webcam</h2></div><button className="icon-button" onClick={onCancel}><X size={16} /></button></div>{error ? <div className="camera-error"><Camera size={24} /><span>{error}</span></div> : <video ref={videoRef} autoPlay muted playsInline className="webcam-video" />}<div className="dialog-actions"><button className="cancel-button" onClick={onCancel}>Cancel</button><button className="upload-button" disabled={Boolean(error)} onClick={capture}><Camera size={15} /> Capture image</button></div></div></div>
}

function App() {
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [images, setImages] = useState([])
  const [selectedImage, setSelectedImage] = useState(null)
  const [view, setView] = useState('grid')
  const [previewSize, setPreviewSize] = useState(readPreviewSize)
  const [sizeMenu, setSizeMenu] = useState(null)
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(100)
  const [queue, setQueue] = useState([])
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingFiles, setPendingFiles] = useState([])
  const [bulkCategory, setBulkCategory] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadCategory, setUploadCategory] = useState('')
  const [downloadImage, setDownloadImage] = useState(null)
  const [deleteImage, setDeleteImage] = useState(null)
  const [imageAction, setImageAction] = useState(null)
  const [previewEnabled, setPreviewEnabled] = useState(readPreviewEnabled)
  const [previewOpen, setPreviewOpen] = useState(() => readPreviewEnabled() && (typeof window === 'undefined' || window.innerWidth > 720))
  const [fullscreenImage, setFullscreenImage] = useState(null)
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParentId, setNewCategoryParentId] = useState('')
  const [editCategory, setEditCategory] = useState(null)
  const [editCategoryName, setEditCategoryName] = useState('')
  const [deleteCategory, setDeleteCategory] = useState(null)
  const [categoryChooser, setCategoryChooser] = useState(null)
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [createUserError, setCreateUserError] = useState('')
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false)
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [access, setAccess] = useState(null)
  const fileInput = useRef(null)
  const category = categories.find((item) => categoryKey(item.number) === selectedCategory)
  const visibleImages = images.filter((image) => image.category === selectedCategory && image.name.toLowerCase().includes(search.toLowerCase()))
  const changeCategoryCount = (number, delta) => setCategories((items) => items.map((item) => categoryKey(item.number) === categoryKey(number) ? { ...item, count: Math.max(0, Number(item.count || 0) + delta) } : item))

  // Mirrors the server's requirePermission checks so download affordances can be
  // hidden up front instead of failing with a 403 after the click.
  useEffect(() => {
    if (!user) return
    apiFetch('/api/me/permissions')
      .then((response) => response.ok ? response.json() : null)
      .then((value) => setAccess(value))
      .catch(() => setAccess(null))
  }, [user])

  // Grants are keyed by category number but the gallery tracks folders by their
  // zero-padded key, so normalise before comparing. Unknown access denies.
  const canDownloadIn = (categoryNumberKey) => {
    if (!access) return false
    if (access.isAdmin) return true
    const number = Number(categoryNumberKey)
    return Boolean(access.grants.find((entry) => Number(entry.number) === number)?.permissions?.includes('download'))
  }

  const canManageIn = (categoryNumberKey) => {
    if (!access) return false
    if (access.isAdmin) return true
    const number = Number(categoryNumberKey)
    return Boolean(access.grants.find((entry) => Number(entry.number) === number)?.permissions?.includes('category.edit'))
  }

  // Drives the UI-only gates: creating users/folders and seeing every folder are
  // admin-scoped on the API, so a standard user is never offered them.
  const isAdminUser = user?.role === 'admin'

  // Clearing the cookie server-side matters: without it the next load would
  // silently sign straight back in from the session cookie in /api/me.
  const signOut = async () => {
    await apiFetch('/api/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setAccess(null)
    setCategories([])
    setImages([])
    setSelectedImage(null)
    setSelectedCategory('')
    setQueue([])
  }

  useEffect(() => {
    const buttons = document.querySelectorAll('.card-more')
    buttons.forEach((button, index) => {
      button.onclick = (event) => {
        event.stopPropagation()
        const image = visibleImages[index]
        if (image) {
          const rect = button.getBoundingClientRect()
          setImageAction({ image, left: rect.right - 150, top: rect.bottom + 6 })
        }
      }
    })
    return () => buttons.forEach((button) => { button.onclick = null })
  }, [visibleImages])

  useEffect(() => {
    if (!imageAction) return undefined
    const closeMenu = (event) => {
      if (!event.target.closest('.image-action-menu') && !event.target.closest('.card-more')) setImageAction(null)
    }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setImageAction(null) }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeMenu); document.removeEventListener('keydown', closeOnEscape) }
  }, [imageAction])

  useEffect(() => {
    const handleWebcamCapture = (event) => {
      const file = event.detail
      if (!file) return
      setPendingFile(file)
      setUploadName(file.name)
      setUploadCategory(category?.id ? String(category.id) : '')
    }
    window.addEventListener('webcam-captured', handleWebcamCapture)
    return () => window.removeEventListener('webcam-captured', handleWebcamCapture)
  }, [category?.id])

  useEffect(() => {
    const openNew = () => { setNewCategoryParentId(''); setNewCategoryOpen(true) }
    const openCategory = () => setCategoryChooser('Open category')
    const openRecent = () => setCategoryChooser('Recent categories')
    const openEdit = (event) => beginEditCategory(event.detail)
    const openDelete = (event) => setDeleteCategory(event.detail)
    const openCreateUser = () => { setCreateUserError(''); setCreateUserOpen(true) }
    window.addEventListener('new-category', openNew)
    window.addEventListener('open-category', openCategory)
    window.addEventListener('recent-categories', openRecent)
    window.addEventListener('edit-category', openEdit)
    window.addEventListener('delete-category', openDelete)
    window.addEventListener('create-user', openCreateUser)
    window.addEventListener('sign-out', signOut)
    return () => { window.removeEventListener('new-category', openNew); window.removeEventListener('open-category', openCategory); window.removeEventListener('recent-categories', openRecent); window.removeEventListener('edit-category', openEdit); window.removeEventListener('delete-category', openDelete); window.removeEventListener('create-user', openCreateUser); window.removeEventListener('sign-out', signOut) }
  }, [])

  useEffect(() => { window.localStorage.setItem('imagery.preview-size', previewSize) }, [previewSize])
  useEffect(() => { try { window.localStorage.setItem('imagery.preview-enabled', String(previewEnabled)) } catch {}; if (!previewEnabled) setPreviewOpen(false) }, [previewEnabled])

  // Only one topbar popover may be open at a time. Opening the nav menus or the
  // profile panel dispatches 'close-popovers', which dismisses the
  // preview-size popover - previously both could be open and overlap.
  useEffect(() => {
    const closePopovers = () => setSizeMenu(null)
    window.addEventListener('close-popovers', closePopovers)
    return () => window.removeEventListener('close-popovers', closePopovers)
  }, [])

  useEffect(() => {
    const openSizeMenu = () => {
      const rect = document.querySelector('.size-control')?.getBoundingClientRect()
      setSizeMenu({ left: (rect?.right ?? 320) - 176, top: (rect?.bottom ?? 118) + 6 })
    }
    const applySize = (event) => { const key = previewSizeKeys[event.detail]; if (key) setPreviewSize(key) }
    window.addEventListener('preview-size-menu', openSizeMenu)
    window.addEventListener('preview-size', applySize)
    return () => { window.removeEventListener('preview-size-menu', openSizeMenu); window.removeEventListener('preview-size', applySize) }
  }, [])

  // Restore the session cookie on load. Until /api/me answers there is no user,
  // and the workspace must not render or it fires unauthenticated requests.
  useEffect(() => {
    apiFetch('/api/me')
      .then((response) => response.ok ? response.json() : null)
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => { if (!user) return; apiFetch('/api/categories').then((response) => response.ok ? response.json() : []).then((items) => { const savedOrder = readCategoryOrder(); const loaded = items.map((item, index) => ({ id: item.id, number: item.number, name: item.name, parentId: item.parent_id || null, count: Number(item.image_count || 0), accessLevel: item.access_level ?? null, order: savedOrder[item.id] ?? index })); setCategories(loaded); const landing = loaded.find((item) => item.accessLevel) || loaded[0]; if (landing) setSelectedCategory((current) => current && loaded.some((item) => categoryKey(item.number) === current) ? current : categoryKey(landing.number)) }).catch(() => {}) }, [user])
  useEffect(() => {
    if (!user || !category?.id) return
    apiFetch(`/api/images?categoryId=${category.id}`).then((response) => response.ok ? response.json() : []).then((items) => {
      const persisted = items.map((item) => ({ id: item.id, name: item.original_name, originalName: item.original_name, size: Number(item.file_size), date: new Date(item.created_at).toLocaleString(), src: `http://localhost:4000/api/variants/${item.id}/web`, category: selectedCategory }))
      setImages((current) => {
        const localImages = current.filter((image) => image.category === selectedCategory && typeof image.id !== 'number' && !persisted.some((saved) => saved.name === image.name))
        return [...localImages, ...persisted, ...current.filter((image) => image.category !== selectedCategory)]
      })
    }).catch(() => {})
  }, [user, category?.id, selectedCategory])

  const beginUpload = (file) => { if (!file) return; setPendingFile(file); setUploadName(file.name); setUploadCategory(category?.id ? String(category.id) : '') }
  const beginBulkUpload = (files) => { if (!files.length) return; setPendingFiles(files); setBulkCategory(category?.id ? String(category.id) : '') }
  const chooseFile = (event) => {
    const list = Array.from(event.target.files || [])
    event.target.value = ''
    if (list.length === 0) return
    if (list.length === 1) beginUpload(list[0])
    else beginBulkUpload(list)
  }
  const handleGalleryDragOver = (event) => { if (!category) return; if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); setIsDraggingFiles(true) } }
  const handleGalleryDragLeave = (event) => { if (event.currentTarget.contains(event.relatedTarget)) return; setIsDraggingFiles(false) }
  const handleGalleryDrop = (event) => {
    if (!category) return
    event.preventDefault()
    setIsDraggingFiles(false)
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) return
    if (files.length === 1) beginUpload(files[0])
    else beginBulkUpload(files)
  }
  const captureWebcam = (file) => { setWebcamOpen(false); beginUpload(file) }
  const openViewer = (image) => { if (!image) return; setSelectedImage(image); setZoom(75); setFullscreenImage(image) }
  const showPreviewPanel = () => { if (previewEnabled) setPreviewOpen(true) }
  const beginCreateCategory = (parent = null) => { setNewCategoryParentId(parent?.id ? String(parent.id) : ''); setNewCategoryOpen(true) }
  const childCategoryIds = (rootId, items = categories) => { const direct = items.filter((item) => String(item.parentId || '') === String(rootId)).map((item) => item.id); return direct.flatMap((id) => [id, ...childCategoryIds(id, items)]) }
  const createCategory = async () => { if (!newCategoryName.trim()) return; const parentId = newCategoryParentId || null; try { const response = await apiFetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCategoryName.trim(), parentId }) }); if (response.ok) { const item = await response.json(); setCategories((items) => { const siblingOrders = items.filter((existing) => String(existing.parentId || '') === String(parentId || '')).map((existing) => existing.order ?? 0); const order = siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0; const next = { id: item.id, number: item.number, name: item.name, parentId: item.parent_id || parentId, count: 0, order }; setSelectedCategory(categoryKey(next.number)); return [...items, next] }); } } catch {} setNewCategoryName(''); setNewCategoryParentId(''); setNewCategoryOpen(false) }
  const reorderCategory = (sourceId, targetId) => {
    setCategories((items) => {
      const source = items.find((item) => item.id === sourceId)
      const target = items.find((item) => item.id === targetId)
      if (!source || !target || sourceId === targetId) return items
      if (String(source.parentId || '') !== String(target.parentId || '')) return items
      const siblings = items.filter((item) => String(item.parentId || '') === String(source.parentId || '')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const others = items.filter((item) => String(item.parentId || '') !== String(source.parentId || ''))
      const withoutSource = siblings.filter((item) => item.id !== sourceId)
      const targetIndex = withoutSource.findIndex((item) => item.id === targetId)
      withoutSource.splice(targetIndex, 0, source)
      const reordered = withoutSource.map((item, index) => ({ ...item, order: index }))
      const orderMap = readCategoryOrder()
      reordered.forEach((item) => { orderMap[item.id] = item.order })
      writeCategoryOrder(orderMap)
      return [...others, ...reordered]
    })
  }
  const beginEditCategory = (item) => { setEditCategory(item); setEditCategoryName(item.name) }
  const saveCategory = async () => { if (!editCategory || !editCategoryName.trim()) return; const name = editCategoryName.trim(); setCategories((items) => items.map((item) => item.id === editCategory.id ? { ...item, name } : item)); setEditCategory(null); setEditCategoryName(''); await apiFetch(`/api/categories/${editCategory.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {}) }
  const deleteCategoryRecord = async () => { if (!deleteCategory) return; const idsToDelete = [deleteCategory.id, ...childCategoryIds(deleteCategory.id)]; const keysToDelete = categories.filter((item) => idsToDelete.includes(item.id)).map((item) => categoryKey(item.number)); setCategories((items) => { const next = items.filter((item) => !idsToDelete.includes(item.id)); if (keysToDelete.includes(selectedCategory)) setSelectedCategory(next[0] ? categoryKey(next[0].number) : ''); return next }); setImages((items) => items.filter((image) => !keysToDelete.includes(image.category))); if (selectedImage && keysToDelete.includes(selectedImage.category)) setSelectedImage(null); setDeleteCategory(null); await apiFetch(`/api/categories/${deleteCategory.id}`, { method: 'DELETE' }).catch(() => {}) }

  // Download a folder (and all of its nested subfolders) as a single ZIP,
  // tracked as a job in the existing upload-queue panel.
  const downloadFolder = async (cat) => {
    const jobId = crypto.randomUUID()
    setQueue((items) => [{ id: jobId, name: `${cat.name}.zip`, status: 'Zipping', progress: 0 }, ...items].slice(0, QUEUE_MAX))
    try {
      await downloadCategoryAsZip(cat, categories, (pct) => {
        setQueue((items) => items.map((item) => item.id === jobId ? { ...item, progress: pct } : item))
      })
      setQueue((items) => items.map((item) => item.id === jobId ? { ...item, status: 'Downloaded', progress: 100 } : item))
    } catch (error) {
      setQueue((items) => items.map((item) => item.id === jobId ? { ...item, status: 'Failed', progress: 100 } : item))
    }
  }

  const createUser = async ({ username, email, password, role, permissions }) => {
    setCreateUserSubmitting(true)
    setCreateUserError('')
    try {
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, role, permissions }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Could not create user (${response.status})`)
      }
      setCreateUserOpen(false)
    } catch (error) {
      setCreateUserError(error.message || 'Something went wrong creating the user')
    } finally {
      setCreateUserSubmitting(false)
    }
  }

  const confirmUpload = async (format = 'original') => { if (!pendingFile || !uploadName.trim()) return; const target = categories.find((item) => String(item.id) === String(uploadCategory)); if (!target) return; const convertedFile = await convertForUpload(pendingFile, format); const ext = convertedFile.name.includes('.') ? convertedFile.name.split('.').pop().toLowerCase() : (convertedFile.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'); const name = uploadName.includes('.') ? uploadName.trim().replace(/\.[^.]+$/, `.${ext}`) : `${uploadName.trim()}.${ext}`; const local = { id: crypto.randomUUID(), name, originalName: name, size: convertedFile.size, date: new Date().toLocaleString(), src: URL.createObjectURL(convertedFile), category: categoryKey(target.number), file: convertedFile }; setImages((items) => [local, ...items]); setSelectedCategory(local.category); setSelectedImage(local); showPreviewPanel(); changeCategoryCount(target.number, 1); setQueue((items) => [{ id: crypto.randomUUID(), name, status: 'Uploaded', progress: 100 }, ...items].slice(0, QUEUE_MAX)); setPendingFile(null); const body = new FormData(); body.append('file', convertedFile); body.append('categoryId', target.id); body.append('name', name); await apiFetch('/api/uploads', { method: 'POST', body }).catch(() => {}) }
  const confirmBulkUpload = async (format = 'original') => {
    if (!pendingFiles.length) return
    const target = categories.find((item) => String(item.id) === String(bulkCategory))
    if (!target) return
    const files = pendingFiles
    setPendingFiles([])
    const jobs = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, status: 'Queued', progress: 5, file }))
    setQueue((items) => [...jobs.map(({ file: jobFile, ...rest }) => rest), ...items].slice(0, QUEUE_MAX))
    let firstImage = null
    for (const job of jobs) {
      try {
        setQueue((items) => items.map((item) => item.id === job.id ? { ...item, status: 'Uploading', progress: 45 } : item))
        const convertedFile = await convertForUpload(job.file, format)
        const name = convertedFile.name
        const local = { id: crypto.randomUUID(), name, originalName: name, size: convertedFile.size, date: new Date().toLocaleString(), src: URL.createObjectURL(convertedFile), category: categoryKey(target.number), file: convertedFile }
        if (!firstImage) firstImage = local
        setImages((items) => [local, ...items])
        changeCategoryCount(target.number, 1)
        const body = new FormData()
        body.append('file', convertedFile)
        body.append('categoryId', target.id)
        body.append('name', name)
        await apiFetch('/api/uploads', { method: 'POST', body }).catch(() => {})
        setQueue((items) => items.map((item) => item.id === job.id ? { ...item, status: 'Uploaded', progress: 100 } : item))
      } catch (error) {
        setQueue((items) => items.map((item) => item.id === job.id ? { ...item, status: 'Failed', progress: 100 } : item))
      }
    }
    setSelectedCategory(categoryKey(target.number))
    if (firstImage) setSelectedImage(firstImage)
    showPreviewPanel()
  }
  const deleteImageRecord = async (target) => { setImages((items) => items.filter((item) => item.id !== target.id)); changeCategoryCount(target.category, -1); if (selectedImage?.id === target.id) setSelectedImage(null); setDeleteImage(null); if (typeof target.id === 'number') await apiFetch(`/api/images/${target.id}`, { method: 'DELETE' }).catch(() => {}) }
  const download = async (format) => { if (!downloadImage) return; try { const originalUrl = typeof downloadImage.id === 'number' ? `http://localhost:4000/api/variants/${downloadImage.id}/original` : downloadImage.src; const sourceUrl = format === 'original' || format === 'heic' ? originalUrl : downloadImage.src; const blob = downloadImage.file || await fetch(sourceUrl, { credentials: 'include' }).then((response) => response.blob()); let href = URL.createObjectURL(blob); let extension = format === 'original' ? downloadImage.originalName.split('.').pop() : format; if (format !== 'original' && format !== 'heic') { const image = new Image(); image.src = href; await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject }); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); const converted = await new Promise((resolve) => canvas.toBlob(resolve, `image/${format === 'jpeg' ? 'jpeg' : format}`, .92)); URL.revokeObjectURL(href); href = URL.createObjectURL(converted) } const link = document.createElement('a'); link.href = href; link.download = `${downloadImage.name.replace(/\.[^.]+$/, '')}.${extension}`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000); setDownloadImage(null) } catch (error) { console.error('download:', error) } }

  // /api/categories and /api/images sit behind requireAuth, so the workspace
  // cannot render before the session is known - otherwise every load logs 401s.
  if (!authChecked) return <div className="login-page"><div className="login-brand"><Aperture size={20} /><span>IMAGERY</span></div></div>
  if (!user) return <LoginPage onLogin={setUser} />

  return <div className="app-shell"><input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic" onChange={chooseFile} /><MenuBar onUpload={() => fileInput.current?.click()} user={user} canDownload={canDownloadIn(selectedCategory)} isAdmin={isAdminUser} /><div className={`workspace ${previewOpen ? '' : 'preview-closed'}`}><Sidebar categories={categories} selected={selectedCategory} setSelected={setSelectedCategory} onAdd={() => beginCreateCategory()} onAddChild={beginCreateCategory} onReorder={reorderCategory} onDownloadFolder={downloadFolder} canDownloadIn={canDownloadIn} canManageIn={canManageIn} isAdmin={isAdminUser} /><main className="main-content"><div className="toolbar"><button className="mobile-sidebar icon-button"><PanelLeft size={17} /></button><div className="breadcrumb"><span>Files</span><ChevronRight size={13} /><strong>{category?.name || 'No folder selected'}</strong></div><div className="toolbar-actions"><label className="search-box"><Search size={14} /><input placeholder="Search files" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className="icon-button" onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{view === 'grid' ? <List size={16} /> : <Grid2X2 size={16} />}</button>{view === 'grid' && <button className="size-control icon-button" title={`Preview size: ${previewSizeLabel(previewSize)}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setSizeMenu((current) => current ? null : { left: rect.right - 176, top: rect.bottom + 6 }) }}><LayoutGrid size={15} /><span>{previewSizeLabel(previewSize)}</span><ChevronDown size={12} /></button>}<button className="icon-button"><SlidersHorizontal size={16} /></button>{<button className={`preview-toggle ${previewEnabled ? 'active' : ''}`} onClick={() => setPreviewEnabled((enabled) => { const next = !enabled; if (next) setPreviewOpen(true); return next })} title={previewEnabled ? 'Turn preview panel off permanently' : 'Turn preview panel on permanently'}><PanelRight size={15} /><span>Preview {previewEnabled ? 'on' : 'off'}</span></button>}</div></div><div className="content-heading"><div><p className="eyebrow">{category ? `FOLDER ${selectedCategory}` : 'NO FOLDER'}</p><h1>{category?.name || 'Create a folder to begin'}</h1><span className="muted">{visibleImages.length} images <span className="sep">•</span> Double-click preview for full screen</span></div><button className="upload-button" disabled={!category} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload images</button></div><div className={`drop-zone ${isDraggingFiles ? 'active' : ''}`} onDragOver={handleGalleryDragOver} onDragLeave={handleGalleryDragLeave} onDrop={handleGalleryDrop}>{!category || visibleImages.length === 0 ? <div className="empty-gallery"><Upload size={30} /><strong>{category ? 'No images in this folder' : (isAdminUser ? 'No folders yet' : 'No folders shared with you')}</strong><span>{category ? 'Upload images or drag and drop them here to preview and manage them.' : (isAdminUser ? 'Create a folder before uploading an image.' : 'Ask an administrator to grant you access to a folder.')}</span>{category ? <button className="empty-upload" onClick={() => fileInput.current?.click()}>Choose images</button> : isAdminUser && <button className="empty-upload" onClick={() => beginCreateCategory()}>Create folder</button>}</div> : view === 'grid' ? <section className="gallery" data-size={previewSize}>{visibleImages.map((image) => <article className={`image-card ${selectedImage?.id === image.id ? 'selected' : ''}`} key={image.id} onClick={(event) => { if (event.detail > 1) return; setSelectedImage(image); showPreviewPanel() }} onDoubleClick={() => openViewer(image)}><div className="image-wrap"><img src={tileSource(image, previewSize)} alt={image.name} onError={(event) => { if (event.currentTarget.src !== image.src) event.currentTarget.src = image.src }} /><span className="file-type">IMAGE</span><button className="card-more" title="Image actions" onDoubleClick={(event) => event.stopPropagation()}><MoreVertical size={15} /></button></div><div className="card-meta"><strong>{image.name}</strong><span>{(image.size / 1024 / 1024).toFixed(2)} MB <i />{image.date}</span></div></article>)}</section> : <section className="list-view">{visibleImages.map((image) => <div className="list-row" key={image.id} onClick={(event) => { if (event.detail > 1) return; setSelectedImage(image); showPreviewPanel() }} onDoubleClick={() => openViewer(image)}><img src={image.src} alt={image.name} /><strong>{image.name}</strong><span>{(image.size / 1024 / 1024).toFixed(2)} MB</span><span>{image.date}</span><MoreVertical size={15} /></div>)}</section>}{isDraggingFiles && <div className="drop-zone-overlay"><Upload size={26} /><strong>Drop to upload</strong><span>Release to add these images to {category?.name}</span></div>}</div></main>{previewOpen && <div className="inspector-backdrop" onClick={() => setPreviewOpen(false)} />}<aside className={`inspector ${previewOpen ? '' : 'closed'}`}><div className="inspector-head"><span>PREVIEW</span><div className="inspector-actions">{selectedImage && canDownloadIn(selectedImage.category) && <button className="download-button" onClick={() => setDownloadImage(selectedImage)}><Download size={14} /> Download</button>}<button className="close-preview icon-button" onClick={() => setPreviewOpen(false)} title="Close preview"><X size={15} /></button></div></div>{selectedImage ? <><div className="preview" onDoubleClick={() => openViewer(selectedImage)} title="Double-click to open full screen"><img src={selectedImage.src} alt={selectedImage.name} style={{ transform: `scale(${zoom / 100})` }} /></div><div className="preview-tools"><button className="icon-button" onClick={() => setZoom(Math.max(50, zoom - 10))}><ZoomOut size={15} /></button><span>{zoom}%</span><button className="icon-button" onClick={() => setZoom(Math.min(250, zoom + 10))}><ZoomIn size={15} /></button></div><div className="inspector-details"><p className="eyebrow">SELECTED IMAGE</p><h2>{selectedImage.name}</h2><div className="detail-grid"><span>File size</span><strong>{(selectedImage.size / 1024 / 1024).toFixed(2)} MB</strong><span>Original file</span><strong>{selectedImage.originalName}</strong><span>Folder</span><strong>{category?.name}</strong><span>Added</span><strong>{selectedImage.date}</strong></div></div></> : <div className="no-preview"><FileImage size={25} /><span>Select an image to preview it here.</span></div>}<div className="queue-panel"><div className="queue-title"><span>UPLOAD QUEUE</span><div className="queue-title-actions"><strong>{queue.length} job{queue.length === 1 ? '' : 's'}</strong>{queue.length > 0 && <button className="queue-clear" onClick={() => setQueue([])}>Clear</button>}</div></div>{queue.slice(0, QUEUE_DISPLAY_LIMIT).map((job, index) => <div className="job" key={job.id || `${job.name}-${index}`}><div><FileImage size={14} /><span>{job.name}</span><small>{job.status}</small></div><div className="progress"><span className={job.status === 'Failed' ? 'failed' : ''} style={{ width: `${job.progress}%` }} /></div></div>)}{queue.length === 0 && <p className="queue-empty">No recent uploads</p>}{queue.length > QUEUE_DISPLAY_LIMIT && <p className="queue-more">+ {queue.length - QUEUE_DISPLAY_LIMIT} earlier uploads</p>}</div></aside></div>{sizeMenu && <PreviewSizeMenu size={previewSize} anchor={sizeMenu} setSize={setPreviewSize} onClose={() => setSizeMenu(null)} />}<ImageActionMenu action={imageAction} onDownload={setDownloadImage} onDelete={setDeleteImage} onClose={() => setImageAction(null)} canDownload={canDownloadIn(imageAction?.image?.category)} /><UploadDialog file={pendingFile} category={uploadCategory} categories={categories} setCategory={setUploadCategory} name={uploadName} setName={setUploadName} onCancel={() => setPendingFile(null)} onConfirm={confirmUpload} /><BulkUploadDialog files={pendingFiles} category={bulkCategory} categories={categories} setCategory={setBulkCategory} onCancel={() => setPendingFiles([])} onConfirm={confirmBulkUpload} /><DownloadDialog image={downloadImage} onCancel={() => setDownloadImage(null)} onDownload={download} /><DeleteDialog image={deleteImage} onCancel={() => setDeleteImage(null)} onConfirm={() => deleteImageRecord(deleteImage)} /><FullscreenPreview image={fullscreenImage} zoom={zoom} setZoom={setZoom} onClose={() => setFullscreenImage(null)} /><CategoryDialog open={newCategoryOpen} name={newCategoryName} setName={setNewCategoryName} categories={categories} parentId={newCategoryParentId} setParentId={setNewCategoryParentId} onCancel={() => { setNewCategoryName(''); setNewCategoryParentId(''); setNewCategoryOpen(false) }} onConfirm={createCategory} /><CategoryEditDialog category={editCategory} name={editCategoryName} setName={setEditCategoryName} onCancel={() => { setEditCategory(null); setEditCategoryName('') }} onConfirm={saveCategory} /><CategoryDeleteDialog category={deleteCategory} onCancel={() => setDeleteCategory(null)} onConfirm={deleteCategoryRecord} /><CreateUserDialog open={createUserOpen} categories={categories} onCancel={() => setCreateUserOpen(false)} onConfirm={createUser} error={createUserError} submitting={createUserSubmitting} /></div>
}

export default App