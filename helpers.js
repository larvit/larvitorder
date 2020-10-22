'use strict';

const topLogPrefix = 'larvitorder: helpers.js: ';
const uuidLib = require('uuid');
const async = require('async');

let orderFields = [];
let rowFields = [];

class Helpers {
	static get orderFields() { return orderFields; }

	static get rowFields() { return rowFields; }

	constructor(options) {
		for (const ro of ['db', 'log']) {
			if (!options[ro]) throw new Error('Missing required option "' + ro + '"');
		}

		for (const key of Object.keys(options)) {
			this[key] = options[key];
		}
	}

	getFieldValues(options, cb) {
		const tasks = [];
		const names = [];

		if (typeof options === 'string' || options instanceof String) {
			options = { fieldName: options };
		}

		tasks.push(cb => {
			const dbFields = [];

			let sql = 'SELECT DISTINCT fieldValue\n';

			sql += 'FROM orders_orders_fields\n';
			sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?)\n';
			dbFields.push(options.fieldName);

			if (options.matchAllFields !== undefined) {
				for (let fieldName in options.matchAllFields) {
					dbFields.push(fieldName);
					sql += 'AND orderUuid IN (\n';
					sql += 'SELECT orderUuid\n';
					sql += 'FROM orders_orders_fields\n';
					if (Array.isArray(options.matchAllFields[fieldName])) {
						sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue IN (';
						for (let i = 0; i < options.matchAllFields[fieldName].length; i++) {
							dbFields.push(options.matchAllFields[fieldName][i]);
							sql += '?,';
						}
						sql = sql.substring(0, sql.length - 1);
						sql += ')\n';
					} else {
						dbFields.push(options.matchAllFields[fieldName]);
						sql += 'WHERE fieldUuid = (SELECT uuid FROM orders_orderFields WHERE name = ?) AND fieldValue = ?\n';
					}

					sql += ')';
				}
			}
			sql += 'ORDER BY fieldValue;';

			this.db.query(sql, dbFields, (err, rows) => {
				if (err) return cb(err);

				for (let i = 0; rows[i] !== undefined; i++) {
					names.push(rows[i].fieldValue);
				}

				cb(null, names);
			});
		});

		async.series(tasks, err => {
			cb(err, names);
		});
	}

	getOrderFieldUuid(fieldName, cb) {
		const tasks = [];
		const cachedOrderField = orderFields.find(field => field.name === fieldName);

		if (cachedOrderField) return cb(null, cachedOrderField.uuid);

		// If we get down here, the field does not exist, create it and rerun
		tasks.push(cb => {
			const uuid = uuidLib.v1();

			this.db.query('INSERT IGNORE INTO orders_orderFields (uuid, name) VALUES(?,?)', [uuid, fieldName], cb);
		});

		tasks.push(cb => {
			this.loadOrderFieldsToCache(cb);
		});

		async.series(tasks, err => {
			if (err) return cb(err);

			this.getOrderFieldUuid(fieldName, cb);
		});
	};

	getOrderFieldUuids(fieldNames, cb) {
		const fieldUuidsByName = {};
		const tasks = [];

		for (let i = 0; fieldNames[i] !== undefined; i++) {
			const fieldName = fieldNames[i];

			tasks.push(cb => {
				this.getOrderFieldUuid(fieldName, (err, fieldUuid) => {
					if (err) return cb(err);

					fieldUuidsByName[fieldName] = fieldUuid;
					cb();
				});
			});
		}

		async.parallel(tasks, err => {
			if (err) return cb(err);

			cb(null, fieldUuidsByName);
		});
	};

	getRowFieldUuid(rowFieldName, cb) {
		const logPrefix = topLogPrefix + 'getRowFieldUuid() - ';
		const tasks = [];

		if (rowFieldName === 'uuid') {
			const err = new Error('Row field "uuid" is reserved and have no uuid');

			log.warn(logPrefix + '' + err.message);

			return cb(err);
		}

		const cachedField = rowFields.find(field => field.name === rowFieldName);

		if (cachedField) return cb(null, cachedField.uuid);

		// If we get down here, the field does not exist, create it and rerun
		tasks.push(cb => {
			const uuid = uuidLib.v1();

			this.db.query('INSERT IGNORE INTO orders_rowFields (uuid, name) VALUES(?,?)', [uuid, rowFieldName], cb);
		});

		tasks.push(cb => {
			this.loadRowFieldsToCache(cb);
		});

		async.series(tasks, err => {
			if (err) return cb(err);

			this.getRowFieldUuid(rowFieldName, cb);
		});
	};

	getRowFieldUuids(rowFieldNames, cb) {
		const rowFieldUuidsByName = {};
		const tasks = [];

		for (let i = 0; rowFieldNames[i] !== undefined; i++) {
			const rowFieldName = rowFieldNames[i];

			if (rowFieldName === 'uuid') continue; // Ignore uuid

			tasks.push(cb => {
				this.getRowFieldUuid(rowFieldName, (err, fieldUuid) => {
					if (err) return cb(err);

					rowFieldUuidsByName[rowFieldName] = fieldUuid;
					cb();
				});
			});
		}

		async.parallel(tasks, err => {
			if (err) return cb(err);

			cb(null, rowFieldUuidsByName);
		});
	};

	loadOrderFieldsToCache(cb) {
		if (!this || !this.db) return cb();

		this.db.query('SELECT * FROM orders_orderFields ORDER BY name;', (err, rows) => {
			if (err) return;

			// Empty the previous cache
			orderFields.length = 0;

			// Load the new values
			for (let i = 0; rows[i] !== undefined; i++) {
				orderFields.push(rows[i]);
			}

			cb();
		});
	};

	loadRowFieldsToCache(cb) {
		if (!this || !this.db) return cb();

		this.db.query('SELECT * FROM orders_rowFields ORDER BY name;', (err, rows) => {
			if (err) return;

			// Empty the previous cache
			rowFields.length = 0;

			// Load the new values
			for (let i = 0; rows[i] !== undefined; i++) {
				rowFields.push(rows[i]);
			}

			cb();
		});
	}

	isBufferEqual(b1, b2) {
		if (b1.length !== b2.length) return false;

		for (let i = 0; i < b1.length; i++) {
			if (b1[i] !== b2[i]) return false;
		}

		return true;
	}

	getChangedRows(dbCon, orderUuidBuf, order, rowFieldUuidsByName, cb) {
		const tasks = [];
		const changedRows = [];
		const removeRows = [];

		let dbOrderRowUuidBuffs = [];
		let dbOrderRowData = [];

		// Get order rows
		tasks.push(cb => {
			const query = 'SELECT rowUuid FROM orders_rows WHERE orderUuid = ?';

			dbCon.query(query, [orderUuidBuf], function (err, rows) {
				if (err) return cb(err);

				dbOrderRowUuidBuffs = rows;

				cb();
			});
		});

		// Get order row data
		tasks.push(cb => {
			const query = 'SELECT \n' +
			'rowUuid, \n' +
			'rowFieldUuid, \n' +
			'rowIntValue, \n' +
			'rowStrValue\n' +
			'FROM orders_rows_fields \n' +
			'WHERE rowUuid IN ( \n' +
				'SELECT rowUuid FROM orders_rows WHERE orderUuid = ? \n' +
			')';

			dbCon.query(query, [orderUuidBuf], function (err, rows) {
				if (err) return cb(err);

				dbOrderRowData = rows;

				cb();
			});
		});

		// Compare data and remove untouched rows
		tasks.push(cb => {
			let rowAdded = false;

			for (const dbRowUuidBuff of dbOrderRowUuidBuffs.map(x => x.rowUuid)) {
				const dbRowUuid = order.lUtils.formatUuid(dbRowUuidBuff);

				if (order.rows.map(x => x.uuid).indexOf(dbRowUuid) === -1) {
					removeRows.push({rowUuid: dbRowUuid, rowUuidBuff: dbRowUuidBuff});

					continue;
				}
			}

			for (const row of order.rows) {
				const rowUuidBuff = order.lUtils.uuidToBuffer(row.uuid);

				let foundDbRows = dbOrderRowData.filter(x => this.isBufferEqual(x.rowUuid, rowUuidBuff));

				if (!foundDbRows.length) {
					// New row.
					changedRows.push({rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row});
					rowAdded = true;

					continue;
				}

				rowAdded = false;

				for (const rowFieldName of Object.keys(row)) {
					if (rowAdded) break;

					let foundRowsByField;

					if (rowUuidBuff === false) {
						return cb(new Error('Invalid row uuid'));
					}

					if (rowFieldName === 'uuid') continue;

					if (!(row[rowFieldName] instanceof Array)) {
						row[rowFieldName] = [row[rowFieldName]];
					}

					foundRowsByField = foundDbRows.filter(x => this.isBufferEqual(x.rowFieldUuid, rowFieldUuidsByName[rowFieldName]));

					if (!foundRowsByField.length) {
						// New row.
						changedRows.push({rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row});
						rowAdded = true;

						break;
					}

					for (const rowFieldValue of row[rowFieldName]) {
						if (rowAdded) continue;

						let intValue = undefined;
						let strValue = undefined;

						if (typeof rowFieldValue === 'number' && (rowFieldValue % 1) === 0) {
							intValue = rowFieldValue;
						} else {
							strValue = rowFieldValue;
						}

						if (!foundRowsByField.find(x => x.rowIntValue === (intValue !== undefined ? intValue : null)
							&& x.rowStrValue === (strValue !== undefined ? strValue : null))) {
							// Changed row.
							changedRows.push({rowUuid: row.uuid, rowUuidBuff: rowUuidBuff, row: row});
							rowAdded = true;

							break;
						}
					}
				}
			}

			cb();
		});

		async.series(tasks, err => {
			if (err) return cb(err);

			cb(null, changedRows, removeRows);
		});
	}
}

module.exports = exports = Helpers;
