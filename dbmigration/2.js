'use strict';

const	uuidLib	= require('node-uuid'),
	async	= require('async'),
	db	= require('larvitdb');

exports = module.exports = function(cb) {
	const	tasks	= [];

	// Add uuid column on orders_rowFields
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rowFields` ADD `uuid` binary(16) NOT NULL FIRST;', cb);
	});

	// Assign uuid values to the new column
	tasks.push(function(cb) {
		db.query('SELECT * FROM orders_rowFields', function(err, rows) {
			const	tasks	= [];

			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				const	row = rows[i];

				tasks.push(function(cb) {
					db.query('UPDATE orders_rowFields SET uuid = ? WHERE id = ?', [uuidLib.v4(), row.id], cb);
				});
			}

			async.parallel(tasks, cb);
		});
	});

	// Random SQL stuff
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rows_fields` ADD `rowFieldUuid` binary(16) NOT NULL AFTER `rowFieldId`;', cb);
	});
	tasks.push(function(cb) {
		db.query('UPDATE orders_rows_fields rf JOIN orders_rowFields f ON f.id = rf.rowFieldId SET rf.rowFieldUuid = f.uuid;', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rows_fields` DROP FOREIGN KEY `orders_rows_fields_ibfk_2`;', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rows_fields` ADD INDEX `rowFieldUuid` (`rowFieldUuid`), DROP INDEX `rowFieldId`;', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rowFields` DROP `id`;', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rowFields` ADD PRIMARY KEY `uuid` (`uuid`);', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rows_fields` ADD FOREIGN KEY (`rowFieldUuid`) REFERENCES `orders_rowFields` (`uuid`) ON DELETE NO ACTION ON UPDATE NO ACTION;', cb);
	});
	tasks.push(function(cb) {
		db.query('ALTER TABLE `orders_rows_fields` DROP `rowFieldId`;', cb);
	});


	async.series(tasks, function(err) {
		if (err) throw err;
console.log('dying :)');
		process.exit();
		cb();
	});
};
