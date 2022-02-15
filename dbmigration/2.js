'use strict';

const uuidLib = require('uuid');

exports = module.exports = async function (options) {
	const {db} = options;
	const sqls = [];

	// Add uuid column on orders_rowFields and orders_orderFields
	await db.query('ALTER TABLE `orders_rowFields` ADD `uuid` binary(16) NOT NULL FIRST;');
	await db.query('ALTER TABLE `orders_orderFields` ADD `uuid` binary(16) NOT NULL AFTER `id`;');

	// Assign uuid values to orders_rowFields
	const {rows: rowFields} = await db.query('SELECT * FROM orders_rowFields');
	for (const rowField of rowFields) {
		await db.query('UPDATE orders_rowFields SET uuid = ? WHERE id = ?', [uuidLib.v1(), rowField.id]);
	}

	// Assign uuid values to orders_orderFields
	const {rows: orderFields} = await db.query('SELECT * FROM orders_orderFields');
	for (const orderField of orderFields) {
		await db.query('UPDATE orders_orderFields SET uuid = ? WHERE id = ?', [uuidLib.v1(), orderField.id]);
	}

	// Stuff
	sqls.push('ALTER TABLE `orders_rows_fields` ADD `rowFieldUuid` binary(16) NOT NULL AFTER `rowFieldId`;');
	sqls.push('UPDATE orders_rows_fields rf JOIN orders_rowFields f ON f.id = rf.rowFieldId SET rf.rowFieldUuid = f.uuid;');
	sqls.push('ALTER TABLE `orders_rows_fields` DROP FOREIGN KEY `orders_rows_fields_ibfk_2`;');
	sqls.push('ALTER TABLE `orders_rows_fields` ADD INDEX `rowFieldUuid` (`rowFieldUuid`), DROP INDEX `rowFieldId`;');
	sqls.push('ALTER TABLE `orders_rowFields` DROP `id`;');
	sqls.push('ALTER TABLE `orders_rowFields` ADD PRIMARY KEY `uuid` (`uuid`);');
	sqls.push('ALTER TABLE `orders_rows_fields` ADD FOREIGN KEY (`rowFieldUuid`) REFERENCES `orders_rowFields` (`uuid`) ON DELETE NO ACTION ON UPDATE NO ACTION;');
	sqls.push('ALTER TABLE `orders_rows_fields` DROP `rowFieldId`;');
	sqls.push('ALTER TABLE `orders_orders_fields` ADD `fieldUuid` binary(16) NOT NULL AFTER `fieldId`;');
	sqls.push('UPDATE orders_orders_fields of JOIN orders_orderFields f ON f.id = of.fieldId SET of.fieldUuid = f.uuid;');
	sqls.push('ALTER TABLE `orders_orders_fields` DROP FOREIGN KEY `orders_orders_fields_ibfk_2`;');
	sqls.push('ALTER TABLE `orders_orders_fields` ADD INDEX `fieldUuid` (`fieldUuid`), DROP INDEX `fieldId`;');
	sqls.push('ALTER TABLE `orders_orderFields` DROP `id`;');
	sqls.push('ALTER TABLE `orders_orderFields` ADD PRIMARY KEY `uuid` (`uuid`);');
	sqls.push('ALTER TABLE `orders_orders_fields` DROP `fieldId`;');
	sqls.push('ALTER TABLE `orders_orders_fields` ADD FOREIGN KEY (`fieldUuid`) REFERENCES `orders_orderFields` (`uuid`) ON DELETE NO ACTION ON UPDATE NO ACTION;');

	for (const sql of sqls) {
		await db.query(sql);
	}
};
