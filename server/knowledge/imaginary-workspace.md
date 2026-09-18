# Imaginary Workspace Knowledge Base

## Product
Imaginary is a private image-management workspace for organizing, reviewing, previewing, and sharing image assets. The main authenticated views are the Home dashboard and the Folders workspace.

## Home dashboard
The Home dashboard gives a high-level view of the workspace. It shows active folders, documentation, organization controls, recent activity, live workspace presence, sync health, storage utilization, and the Imaginary Assistant. The Home and Folders tabs are available in the shared left navigation.

## Folders
Folders are the main containers for image assets. Users can open a folder from the Home dashboard or the Folders workspace. Folder access is controlled by the user's permissions. Administrators can create, edit, reorder, and delete folders. A folder can contain nested subfolders.

## Uploads
Images can be uploaded from the file browser, captured from a webcam, or added in bulk. Supported image inputs include JPEG, PNG, WebP, and HEIC. The workspace shows upload progress and keeps an upload queue. Images are processed into preview variants while the original remains available to authorized users.

## Image previews
The Folders workspace supports grid and list views. Users can choose preview sizes, select an image, open a preview inspector, zoom in or out, and open a full-screen preview. Preview variants include thumbnail, web, HD, and original access depending on permissions.

## Permissions
Administrators have full access. Standard users receive access through folder-level grants. View access allows viewing. Edit access includes viewing, downloading, and uploading. Manage access additionally includes image deletion and folder creation, editing, and deletion. The assistant must never claim that a user has a permission unless the application provides that information.

## Organization
The organization area contains tags and metadata, team permissions, workflows and rules, audit and access logs, and workspace policies. These areas describe how a team governs and finds its image library.

## Recommended workflows
For a new image project, create a top-level folder, add a clear naming convention, create subfolders for source files and approved exports, upload images in batches, add useful metadata, review previews, and grant the smallest folder permission level needed by each collaborator.

## Assistant boundaries
The Imaginary Assistant can explain workspace workflows, suggest folder structures, recommend metadata, generate image-production prompts, and help users search conceptually. It cannot directly change folders, upload files, grant permissions, inspect private images, or report live workspace state unless a connected application feature explicitly provides that action or data.
