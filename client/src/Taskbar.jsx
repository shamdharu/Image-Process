import { Aperture, FolderOpen, Home as HomeIcon, Shield } from 'lucide-react'

export default function Taskbar({ active = 'home', onHome, onFolders, onAdmin = null, footer = null, children = null }) {
  return <div className="taskbar">
    <div className="taskbar-brand"><Aperture size={18} /><span>IMAGINARY</span><i>workspace</i></div>
    {/* Arrangement: Home/Folders/Admin form one evenly spaced tab group; the
        File/Uploads menu list that follows in `children` is separated from the
        group by the divider on .menus (App.css). No color changes here. */}
    <nav className="taskbar-tabs" aria-label="Workspace sections">
      <button className={active === 'home' ? 'active' : ''} onClick={onHome}><HomeIcon size={16} /><span>Home</span></button>
      <button className={active === 'folders' ? 'active' : ''} onClick={onFolders}><FolderOpen size={16} /><span>Folders</span></button>
      {onAdmin && <button className={active === 'admin' ? 'active' : ''} onClick={onAdmin}><Shield size={16} /><span>Admin</span></button>}
    </nav>
    {children}
    {footer && <div className="taskbar-footer">{footer}</div>}
  </div>
}