DROP DATABASE IF EXISTS image_platform;

CREATE DATABASE image_platform
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE image_platform;


-- =========================================
-- USER
-- =========================================

CREATE TABLE User (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(191) NOT NULL UNIQUE,
    email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    quota_bytes BIGINT NOT NULL DEFAULT 687194767360,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


-- =========================================
-- ORGANIZATION
-- Organizations sit above folders: every folder (Category) belongs to exactly
-- one organization and the sidebar shows only the selected org's folders.
-- =========================================

CREATE TABLE Organization (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL UNIQUE,
    created_by BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by)
        REFERENCES User(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;


-- =========================================
-- CATEGORY
-- =========================================

CREATE TABLE Category (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    number INT NOT NULL UNIQUE,
    parent_id BIGINT NULL,
    organization_id BIGINT NULL,
    name VARCHAR(120) NOT NULL,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY category_number_name (number, name),
    INDEX category_parent_idx (parent_id),
    INDEX category_organization_idx (organization_id),

    FOREIGN KEY (parent_id)
        REFERENCES Category(id)
        ON DELETE SET NULL,

    FOREIGN KEY (organization_id)
        REFERENCES Organization(id)
        ON DELETE SET NULL,

    FOREIGN KEY (created_by)
        REFERENCES User(id)
) ENGINE=InnoDB;


-- =========================================
-- IMAGE
-- =========================================

CREATE TABLE Image (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    category_id BIGINT NOT NULL,
    original_name VARCHAR(255) NOT NULL,

    document_id VARCHAR(120) NOT NULL UNIQUE,

    checksum_hash CHAR(64) NOT NULL UNIQUE,

    status ENUM(
        'processing',
        'ready',
        'failed',
        'deleted'
    ) NOT NULL DEFAULT 'processing',

    mime_type VARCHAR(80) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,

    width INT NULL,
    height INT NULL,

    exif JSON NULL,

    uploaded_by BIGINT NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX image_category_idx (category_id),

    FOREIGN KEY (category_id)
        REFERENCES Category(id),

    FOREIGN KEY (uploaded_by)
        REFERENCES User(id)
) ENGINE=InnoDB;


-- =========================================
-- IMAGE VARIANT
-- =========================================

CREATE TABLE ImageVariant (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    image_id BIGINT NOT NULL,

    variant_type ENUM(
        'thumbnail',
        'web',
        'hd',
        'original',
        'print',
        'custom'
    ) NOT NULL,

    file_path VARCHAR(500) NOT NULL,

    width INT NOT NULL,
    height INT NOT NULL,

    file_size BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY image_variant_unique (
        image_id,
        variant_type,
        width,
        height
    ),

    FOREIGN KEY (image_id)
        REFERENCES Image(id)
) ENGINE=InnoDB;


-- =========================================
-- UPLOAD JOB
-- =========================================

CREATE TABLE UploadJob (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    image_id BIGINT NOT NULL,

    status ENUM(
        'queued',
        'processing',
        'complete',
        'failed',
        'cancelled'
    ) NOT NULL DEFAULT 'queued',

    progress TINYINT NOT NULL DEFAULT 0,

    error_message VARCHAR(500) NULL,

    created_by BIGINT NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (image_id)
        REFERENCES Image(id),

    FOREIGN KEY (created_by)
        REFERENCES User(id)
) ENGINE=InnoDB;


-- =========================================
-- SHARE LINK
-- =========================================

CREATE TABLE ShareLink (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    token CHAR(36) NOT NULL UNIQUE,

    image_id BIGINT NOT NULL,

    created_by BIGINT NOT NULL,

    expires_at DATETIME NOT NULL,

    max_variant ENUM(
        'thumbnail',
        'web',
        'hd',
        'original'
    ) NOT NULL DEFAULT 'web',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (image_id)
        REFERENCES Image(id),

    FOREIGN KEY (created_by)
        REFERENCES User(id)
) ENGINE=InnoDB;


-- =========================================
-- CATEGORY PERMISSION
-- =========================================

CREATE TABLE CategoryPermission (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    user_id BIGINT NOT NULL,

    category_id BIGINT NOT NULL,

    level ENUM(
        'view',
        'edit',
        'manage'
    ) NOT NULL,

    UNIQUE KEY user_category (
        user_id,
        category_id
    ),

    FOREIGN KEY (user_id)
        REFERENCES User(id)
        ON DELETE CASCADE,

    FOREIGN KEY (category_id)
        REFERENCES Category(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;