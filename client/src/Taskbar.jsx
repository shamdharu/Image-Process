import { Aperture, FolderOpen, Home as HomeIcon } from 'lucide-react'

export default function Taskbar({ active = 'home', onHome, onFolders, footer = null, children = null }) {
  return <div className="taskbar">
    <div className="taskbar-brand"><Aperture size={18} /><span>IMAGINARY</span><i>workspace</i></div>
    <nav className="taskbar-tabs" aria-label="Workspace sections">
      <button className={active === 'home' ? 'active' : ''} onClick={onHome}><HomeIcon size={16} /><span>Home</span></button>
      <button className={active === 'folders' ? 'active' : ''} onClick={onFolders}><FolderOpen size={16} /><span>Folders</span></button>
    </nav>
    {children}
    {footer && <div className="taskbar-footer">{footer}</div>}
  </div>
}
