SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `orders` (
  `uuid` binary(16) NOT NULL,
  `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders_orderFields` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders_orders_fields` (
  `orderUuid` binary(16) NOT NULL,
  `fieldId` int(10) unsigned NOT NULL,
  `fieldValue` text COLLATE utf8mb4_unicode_ci NOT NULL,
  KEY `orderUuid` (`orderUuid`),
  KEY `fieldId` (`fieldId`),
  CONSTRAINT `orders_orders_fields_ibfk_1` FOREIGN KEY (`orderUuid`) REFERENCES `orders` (`uuid`),
  CONSTRAINT `orders_orders_fields_ibfk_2` FOREIGN KEY (`fieldId`) REFERENCES `orders_orderFields` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders_rowFields` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders_rows` (
  `rowUuid` binary(16) NOT NULL,
  `orderUuid` binary(16) NOT NULL,
  PRIMARY KEY (`rowUuid`),
  KEY `orderUuid` (`orderUuid`),
  KEY `rowUuid` (`rowUuid`),
  CONSTRAINT `orders_rows_ibfk_1` FOREIGN KEY (`orderUuid`) REFERENCES `orders` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders_rows_fields` (
  `rowUuid` binary(16) NOT NULL,
  `rowFieldUuid` int(10) unsigned NOT NULL,
  `rowIntValue` int(11) DEFAULT NULL,
  `rowStrValue` text COLLATE utf8mb4_unicode_ci,
  KEY `rowUuid` (`rowUuid`),
  KEY `rowFieldUuid` (`rowFieldUuid`),
  CONSTRAINT `orders_rows_fields_ibfk_1` FOREIGN KEY (`rowUuid`) REFERENCES `orders_rows` (`rowUuid`),
  CONSTRAINT `orders_rows_fields_ibfk_2` FOREIGN KEY (`rowFieldUuid`) REFERENCES `orders_rowFields` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;