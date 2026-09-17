DROP DATABASE IF EXISTS image_platform;
CREATE DATABASE image_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE image_platform;

CREATE TABLE User (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  quota_bytes BIGINT NOT NULL DEFAULT 687194767360,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE Category (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  number INT NOT NULL UNIQUE,
  parent_id BIGINT NULL,
  name VARCHAR(120) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY category_number_name (number, name),
  INDEX category_parent_idx (parent_id),
  FOREIGN KEY (parent_id) REFERENCES Category(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES User(id)
) ENGINE=InnoDB;

CREATE TABLE Image (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  checksum_hash CHAR(64) NOT NULL UNIQUE,
  status ENUM('processing','ready','failed','deleted') NOT NULL DEFAULT 'processing',
  mime_type VARCHAR(80) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  width INT, height INT, exif JSON,
  uploaded_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX image_category_idx (category_id),
  INDEX image_checksum_idx (checksum_hash),
  FOREIGN KEY (category_id) REFERENCES Category(id),
  FOREIGN KEY (uploaded_by) REFERENCES User(id)
) ENGINE=InnoDB;

CREATE TABLE ImageVariant (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT NOT NULL,
  variant_type ENUM('thumbnail','web','hd','original','print','custom') NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  width INT NOT NULL, height INT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY image_variant_unique (image_id, variant_type, width, height),
  FOREIGN KEY (image_id) REFERENCES Image(id)
) ENGINE=InnoDB;

CREATE TABLE UploadJob (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  image_id BIGINT NOT NULL,
  status ENUM('queued','processing','complete','failed','cancelled') NOT NULL DEFAULT 'queued',
  progress TINYINT NOT NULL DEFAULT 0,
  error_message VARCHAR(500),
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES Image(id),
  FOREIGN KEY (created_by) REFERENCES User(id)
) ENGINE=InnoDB;

CREATE TABLE ShareLink (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  token CHAR(36) NOT NULL UNIQUE,
  image_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  expires_at DATETIME NOT NULL,
  max_variant ENUM('thumbnail','web','hd','original') NOT NULL DEFAULT 'web',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_id) REFERENCES Image(id),
  FOREIGN KEY (created_by) REFERENCES User(id)
) ENGINE=InnoDB;

-- CategoryPermission is also auto-created by index.js on server start
-- (ensureUserTables()), so this is just here for a complete picture.
CREATE TABLE CategoryPermission (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  level ENUM('view','edit','manage') NOT NULL,
  UNIQUE KEY user_category (user_id, category_id),
  FOREIGN KEY (user_id) REFERENCES User(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES Category(id) ON DELETE CASCADE
) ENGINE=InnoDB;