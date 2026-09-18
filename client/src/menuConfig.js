
export const menuConfig = [
  {
    label: 'FILE',
    items: [
      { label: 'Create User', permission: 'user.create' },
      { label: 'New Category', permission: 'category.create' },
      { label: 'Open Category', permission: 'category.view' },
      { label: 'Recent Categories', permission: 'category.view' },
      { label: 'Properties', permission: 'view' },
      {
        label: 'Download',
        permission: 'download',
        submenu: ['Thumbnail', 'Web', 'HD', 'Original', 'Custom size...']
      },
      { label: 'Print...', permission: 'print' }
    ]
  },

  {
    label: 'UPLOADS',
    items: [
      { label: 'Upload from File Browser', permission: 'upload' },
      { label: 'Capture from Webcam', permission: 'upload' },
      { label: 'Capture from Mobile Camera', permission: 'upload' },
      { label: 'Bulk Upload', permission: 'upload' }
    ]
  },

  {
    label: 'VIEW',
    items: [
      { label: 'Gallery / Grid view', permission: 'view' },
      { label: 'List view', permission: 'view' },
      {
        label: 'Preview Size',
        permission: 'view',
        submenu: [
          'Small preview',
          'Medium preview',
          'Large preview',
          'Extra large preview'
        ]
      },
      {
        label: 'Resolution selector',
        permission: 'view',
        submenu: ['Thumbnail', 'Web', 'HD', 'Original', 'Custom']
      },
      { label: 'Zoom In', permission: 'view' },
      { label: 'Zoom Out', permission: 'view' },
      { label: 'Fit to Screen', permission: 'view' }
    ]
  },

  {
    label: 'EXIT',
    items: [
      { label: 'Close Current Category', permission: 'category.view' },
      { label: 'Lock Screen', permission: 'session.lock' },
      { label: 'Sign Out and Exit', permission: 'session.end' },
      { label: 'Exit Application', permission: 'session.end' }
    ]
  },

  {
    label: 'HELP',
    items: [
      { label: 'User Guide', permission: 'help.view' },
      { label: 'Keyboard Shortcuts', permission: 'help.view' },
      { label: 'Supported Formats & Size Limits', permission: 'help.view' },
      { label: 'My Role & Permissions', permission: 'help.view' },
      { label: 'Report an Issue', permission: 'help.view' },
      { label: 'About', permission: 'help.view' }
    ]
  }
]

