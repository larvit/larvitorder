/* eslint-disable no-tabs */
'use strict';

const topLogPrefix = 'larvitorder: order.js: ';
const Helpers = require(__dirname + '/helpers.js');
const uuidLib = require('uuid');
const LUtils = require('larvitutils');
const async = require('async');

/**
 * Order constructor
 *
 * @param {object} options - All options
 * @param {object} options.db - Database instance
 * @param {object} [options.uuid] - UUID of order
 * @param {object} [options.log] - Logging instance
 * @param {function} cb - Callback when all initialization is done
 */
function Order(options, cb) {
	const logPrefix = topLogPrefix + 'Order() - ';
	const tasks = [];

	this.options = options || {};

	if (typeof cb !== 'function') {
		cb = () => '';
	}

	if (!options.log) {
		const tmpLUtils = new LUtils();

		options.log = new tmpLUtils.Log();
	}

	for (const key of Object.keys(options)) {
		this[key] = options[key];
	}

	this.lUtils = new LUtils({log: this.log});

	if (!this.db) {
		const err = new Error('Required option db is missing');

		this.log.error(logPrefix + err.message);
		throw err;
	}

	this.init(options);

	this.helpers = new Helpers({
		log: this.log,
		db: this.db
	});

	this.loadOrderFieldsToCache = this.helpers.loadOrderFieldsToCache;
	this.loadRowFieldsToCache = this.helpers.loadRowFieldsToCache;

	// Load order fields
	tasks.push(cb => this.loadOrderFieldsToCache(cb));

	// Load row fields
	tasks.push(cb => this.loadRowFieldsToCache(cb));

	async.series(tasks, err => {
		if (err) {
			this.log.error(logPrefix + err.message);

			return cb(err);
		}

		cb();
	});
}

Order.prototype.init = function (options) {
	const logPrefix = topLogPrefix + 'Order.prototype.init() - ';

	if (options === undefined) {
		options = {};
	}

	// If options is a string, assume it is an uuid
	if (typeof options === 'string') {
		options = {uuid: options};
	}

	if (options.uuid === undefined) {
		options.uuid = uuidLib.v1();
		this.log.debug(logPrefix + 'New Order - Creating Order with uuid: ' + options.uuid);
	} else {
		this.log.debug(logPrefix + 'Instanciating order with uuid: ' + options.uuid);
	}

	this.uuid = options.uuid;

	if (options.created !== undefined) {
		this.created = options.created;
	} else {
		this.created = new Date();
	}

	if (!(this.created instanceof Date)) {
		throw new Error('created is not an instance of Date');
	}

	this.fields = options.fields;
	this.rows = options.rows;

	if (this.fields === undefined) {
		this.fields = {};
	}

	if (this.rows === undefined) {
		this.rows = [];
	}

	for (let i = 0; this.rows[i] !== undefined; i++) {
		if (this.rows[i].uuid === undefined) {
			this.rows[i].uuid = uuidLib.v1();
		}
	}
};

Order.prototype.loadFromDb = function (cb) {
	const logPrefix = topLogPrefix + 'Order.prototype.loadFromDb() - uuid: "' + this.uuid + '" - ';
	const tasks = [];
	const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

	if (uuidBuffer === false) {
		const err = new Error('Invalid order uuid');

		this.log.warn(logPrefix + err.message);

		return cb(err);
	}

	// Get basic order data
	tasks.push(cb => {
		this.log.debug(logPrefix + 'Getting basic order data');
		this.db.query('SELECT * FROM orders WHERE uuid = ?', [uuidBuffer], (err, rows) => {
			if (err) return cb(err);

			if (rows.length) {
				this.uuid = this.lUtils.formatUuid(rows[0].uuid);
				this.created = rows[0].created;
			}
			cb();
		});
	});

	// Get fields
	tasks.push(cb => {
		this.getOrderFields((err, fields) => {
			this.fields = fields;
			cb(err);
		});
	});

	// Get rows
	tasks.push(cb => {
		this.getOrderRows((err, rows) => {
			this.rows = rows;
			cb(err);
		});
	});

	// Sort rows
	tasks.push(cb => {
		this.sortRows();
		cb();
	});

	async.series(tasks, cb);
};

Order.prototype.getOrderFields = function (cb) {
	const tasks = [];
	const fields = {};

	tasks.push(cb => {
		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

		if (uuidBuffer === false) {
			const e = new Error('Invalid order uuid');

			this.log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);

			return cb(e);
		}

		let sql = '';

		sql += 'SELECT orders_orderFields.name AS name, orders_orders_fields.fieldValue AS value\n';
		sql += 'FROM orders_orders_fields\n';
		sql += '	INNER JOIN orders_orderFields\n';
		sql += '		ON orders_orders_fields.fieldUuid = orders_orderFields.uuid\n';
		sql += 'WHERE orders_orders_fields.orderUuid = ?';


		this.db.query(sql, [uuidBuffer], (err, data) => {
			if (err) return cb(err);

			for (let i = 0; data.length > i; i++) {
				if (fields[data[i].name] !== undefined) {
					fields[data[i].name].push(data[i].value);
				} else {
					fields[data[i].name] = [data[i].value];
				}
			}
			cb(null);
		});
	});

	async.series(tasks, err => {
		cb(err, fields);
	});
};

Order.prototype.getOrderRows = function (cb) {
	const tasks = [];
	const rows = [];

	tasks.push(cb => {
		const sorter = [];
		const uuidBuffer = this.lUtils.uuidToBuffer(this.uuid);

		if (uuidBuffer === false) {
			const e = new Error('Invalid order uuid');

			this.log.warn(topLogPrefix + 'getOrderFields() - ' + e.message);

			return cb(e);
		}

		let sql = '';

		sql += 'SELECT orders_rows.rowUuid AS uuid, orders_rows_fields.rowStrValue, orders_rows_fields.rowIntValue, orders_rowFields.name\n';
		sql += 'FROM orders_rows\n';
		sql += '	INNER JOIN orders_rows_fields\n';
		sql += '		ON orders_rows_fields.rowUuid = orders_rows.rowUuid\n';
		sql += '	INNER JOIN orders_rowFields\n';
		sql += '		ON orders_rowFields.uuid = orders_rows_fields.rowFieldUuid\n';
		sql += 'WHERE orders_rows.orderUuid = ?';

		this.db.query(sql, [uuidBuffer], (err, data) => {
			if (err) return cb(err);

			for (let i = 0; data.length > i; i++) {
				let value;

				data[i].uuid = this.lUtils.formatUuid(data[i].uuid);

				if (sorter[data[i].uuid] === undefined) {
					sorter[data[i].uuid] = {
						uuid: data[i].uuid
					};
				}

				if (data[i].rowStrValue === null) {
					value = data[i].rowIntValue;
				} else {
					value = data[i].rowStrValue;
				}

				if (sorter[data[i].uuid][data[i].name] === undefined) {
					sorter[data[i].uuid][data[i].name] = [];
				}

				if (!(sorter[data[i].uuid][data[i].name] instanceof Array)) {
					sorter[data[i].uuid][data[i].name] = [sorter[data[i].uuid][data[i].name]];
				}

				sorter[data[i].uuid][data[i].name].push(value);
			}

			for (let key in sorter) {
				rows.push(sorter[key]);
			}

			cb(null);
		});
	});

	async.series(tasks, err => {
		cb(err, rows);
	});
};

Order.prototype.rm = function (cb) {
	const orderUuid = this.uuid;
	const orderUuidBuf = this.lUtils.uuidToBuffer(orderUuid);
	const tasks = [];

	if (typeof cb !== 'function') {
		cb = () => {};
	}

	if (orderUuidBuf === false) {
		const err = new Error('Invalid order uuid');

		this.log.warn(topLogPrefix + 'rm() - ' + err.message);

		return cb(err);
	}

	// Delete field data
	tasks.push(cb => {
		this.db.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Delete row field data
	tasks.push(cb => {
		this.db.query('SELECT rowUuid FROM orders_rows WHERE orderUuid = ?', [orderUuidBuf], (err, rows) => {
			if (err) return cb(err);

			if (rows.length === 0) return cb();

			let sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (';
			sql += rows.map(() => '?').join(',');
			sql += ')';

			this.db.query(sql, rows.map(n => n.rowUuid), cb);
		});
	});

	// Delete rows
	tasks.push(cb => {
		const dbFields = [orderUuidBuf];
		const sql = 'DELETE FROM orders_rows WHERE orderUuid = ?';

		this.db.query(sql, dbFields, cb);
	});

	// Delete order
	tasks.push(cb => {
		const dbFields = [orderUuidBuf];
		const sql = 'DELETE FROM orders WHERE uuid = ?';

		this.db.query(sql, dbFields, cb);
	});

	async.series(tasks, err => {
		if (err) {
			this.log.warn(`${topLogPrefix} rm() - Error removing order with UUID: "${orderUuid}", err: ${err.message}`);

			return cb(err);
		}

		this.log.info(`${topLogPrefix} rm() - Removed order with UUID: "${orderUuid}"`);
		cb(err);
	});
};

// Saving the order object to the database using a diff.
Order.prototype.save = function (cb) {
	const logPrefix = topLogPrefix + 'writeOrder() - ';
	const orderFields = this.fields;
	const orderRows = this.rows;
	const orderUuid = this.uuid;
	const created = this.created;
	const orderUuidBuf = this.lUtils.uuidToBuffer(orderUuid);
	const tasks = [];
	const uniqueUpdateRowUuids = [];

	let rowFieldUuidsByName;
	let fieldUuidsByName;
	let dbCon;
	let updateRows;
	let removeRows;

	if (typeof cb !== 'function') {
		cb = () => {};
	}

	if (this.lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
		const err = new Error('Invalid orderUuid: "' + orderUuid + '"');

		this.log.error(logPrefix + err.message);

		return cb(err);
	}

	if (this.lUtils.formatUuid(orderUuid) === false || orderUuidBuf === false) {
		const err = new Error('Invalid orderUuid: "' + orderUuid + '"');

		this.log.error(logPrefix + err.message);

		return cb(err);
	}

	if (created && !created instanceof Date) {
		const err = new Error('Invalid value of "created". Value must be an instance of Date.');

		this.log.warn(logPrefix + err.message);

		return cb(err);
	}

	// Get all field uuids
	tasks.push(cb => {
		this.helpers.getOrderFieldUuids(Object.keys(orderFields), (err, result) => {
			fieldUuidsByName = result;
			cb(err);
		});
	});

	// Get all row field uuids and make sure all rows got an uuid
	tasks.push(cb => {
		const rowFieldNames = [];

		for (let i = 0; orderRows[i] !== undefined; i++) {
			const row = orderRows[i];

			if (row.uuid === undefined) {
				row.uuid = uuidLib.v4();
			}

			// Set sortOrder on rows to maintain order independent of storage engine
			row.sortOrder = i;

			for (const rowFieldName of Object.keys(row)) {
				if (rowFieldNames.indexOf(rowFieldName) === -1) {
					rowFieldNames.push(rowFieldName);
				}
			}
		}

		this.helpers.getRowFieldUuids(rowFieldNames, (err, result) => {
			rowFieldUuidsByName = result;
			cb(err);
		});
	});

	// Get a database connection
	tasks.push(cb => {
		this.db.pool.getConnection((err, result) => {
			dbCon = result;
			cb(err);
		});
	});

	// Lock tables
	tasks.push(cb => {
		dbCon.query('LOCK TABLES orders WRITE, orders_orders_fields WRITE, orders_rows_fields WRITE, orders_rows WRITE', cb);
	});

	// Make sure the base order row exists
	tasks.push(cb => {
		const sql = 'INSERT IGNORE INTO orders (uuid, created) VALUES(?,?)';

		dbCon.query(sql, [orderUuidBuf, created], cb);
	});

	// Clean out old field data
	tasks.push(cb => {
		dbCon.query('DELETE FROM orders_orders_fields WHERE orderUuid = ?', [orderUuidBuf], cb);
	});

	// Insert fields
	tasks.push(cb => {
		const dbFields = [];
		let sql = 'INSERT INTO orders_orders_fields (orderUuid, fieldUuid, fieldValue) VALUES';

		for (const fieldName of Object.keys(orderFields)) {
			if (!(orderFields[fieldName] instanceof Array)) {
				orderFields[fieldName] = [orderFields[fieldName]];
			}

			for (let i = 0; orderFields[fieldName][i] !== undefined; i++) {
				const fieldValue = orderFields[fieldName][i];

				if (fieldValue === null || fieldValue === undefined) continue;

				sql += '(?,?,?),';
				dbFields.push(orderUuidBuf);
				dbFields.push(fieldUuidsByName[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1) + ';';
		dbCon.query(sql, dbFields, cb);
	});

	// Get rows to update
	tasks.push(cb => {
		this.helpers.getChangedRows(dbCon, orderUuidBuf, this, rowFieldUuidsByName, (err, update, remove) => {
			updateRows = update;
			removeRows = remove;

			cb(err);
		});
	});

	// Get unique rowUuids from updateRows
	tasks.push(cb => {
		const seen = {};
		let j = 0;
		for (let i = 0; i < updateRows.length; i++) {
			const row = updateRows[i];
			if (seen[row.rowUuid] !== 1) {
				seen[row.rowUuid] = 1;
				uniqueUpdateRowUuids[j++] = {rowUuid: row.rowUuid, rowUuidBuff: row.rowUuidBuff};
			}
		}

		cb();
	});

	// Clean out changed orders_rows_fields
	tasks.push(cb => {
		if (!uniqueUpdateRowUuids.length && !removeRows.length) return cb();

		let sql = 'DELETE FROM orders_rows_fields WHERE rowUuid IN (';

		if (uniqueUpdateRowUuids.length) {
			sql += uniqueUpdateRowUuids.map(() => '?').join(',');
		}

		if (removeRows.length) {
			if (uniqueUpdateRowUuids.length) {
				sql += ',';
			}

			sql += removeRows.map(() => '?').join(',');
		}

		sql += ')';

		dbCon.query(sql, [...uniqueUpdateRowUuids.map(x => x.rowUuidBuff), ...removeRows.map(x => x.rowUuidBuff)], cb, err => {
			if (err) {
				this.log.error(logPrefix + 'db err: ' + err.message);
			}

			cb(err);
		});

	});

	// Clean out changed orders_rows
	tasks.push(cb => {
		if (!uniqueUpdateRowUuids.length && !removeRows.length) return cb();

		let sql = 'DELETE FROM orders_rows WHERE orderUuid = ? AND rowUuid IN (';

		if (uniqueUpdateRowUuids.length) {
			sql += uniqueUpdateRowUuids.map(() => '?').join(',');
		}

		if (removeRows.length) {
			if (uniqueUpdateRowUuids.length) {
				sql += ',';
			}

			sql += removeRows.map(() => '?').join(',');
		}

		sql += ')';

		dbCon.query(sql, [orderUuidBuf, ...uniqueUpdateRowUuids.map(x => x.rowUuidBuff), ...removeRows.map(x => x.rowUuidBuff)], err => {
			if (err) {
				this.log.error(logPrefix + 'db err: ' + err.message);
			}

			cb(err);
		});
	});

	// Insert rows
	tasks.push(cb => {
		if (!uniqueUpdateRowUuids.length) return cb();

		const dbFields = [];

		let sql = 'INSERT INTO orders_rows (rowUuid, orderUuid) VALUES';

		for (const rowUuid of uniqueUpdateRowUuids.map(x => x.rowUuidBuff)) {
			sql += '(?,?),';
			dbFields.push(rowUuid);
			dbFields.push(orderUuidBuf);
		}

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1);
		dbCon.query(sql, dbFields, err => {
			if (err) {
				this.log.error(logPrefix + 'db err: ' + err.message);
			}

			cb(err);
		});
	});

	// Insert row fields
	tasks.push(cb => {
		if (!updateRows.length) return cb();

		const dbFields = [];

		let sql = 'INSERT INTO orders_rows_fields (rowUuid, rowFieldUuid, rowIntValue, rowStrValue) VALUES';

		for (let i = 0; updateRows[i] !== undefined; i++) {
			const updateRow = updateRows[i];

			for (const rowFieldName of Object.keys(updateRow.row)) {

				if (rowFieldName === 'uuid') continue;

				if (!(updateRow.row[rowFieldName] instanceof Array)) {
					updateRow.row[rowFieldName] = [updateRow.row[rowFieldName]];
				}

				for (let j = 0; updateRow.row[rowFieldName][j] !== undefined; j++) {
					const rowFieldValue = updateRow.row[rowFieldName][j];

					sql += '(?,?,?,?),';
					dbFields.push(updateRow.rowUuidBuff);
					dbFields.push(rowFieldUuidsByName[rowFieldName]);

					if (typeof rowFieldValue === 'number' && (rowFieldValue % 1) === 0) {
						dbFields.push(rowFieldValue);
						dbFields.push(null);
					} else {
						dbFields.push(null);
						dbFields.push(rowFieldValue);
					}
				}
			}
		}

		if (dbFields.length === 0) return cb();

		sql = sql.substring(0, sql.length - 1) + ';';

		dbCon.query(sql, dbFields, err => {
			if (err) {
				this.log.error(logPrefix + 'db err: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, err => {
		// Always unlock tables
		dbCon.query('UNLOCK TABLES', unlockErr => {
			if (unlockErr) {
				this.log.err(`${topLogPrefix} save() - Unable to UNLOCK TABLES when saving order UUID: "${orderUuid}", err: ${unlockErr.message}`);

				return cb(unlockErr);
			}

			if (dbCon) {
				dbCon.release();
			}

			if (err) {
				this.log.warn(`${topLogPrefix} save() - Error saving order with UUID: "${orderUuid}", err: ${err.message}`);

				return cb(err);
			}

			this.log.info(`${topLogPrefix} save() - Saved order with UUID: "${orderUuid}"`);

			return cb(err);
		});
	});
};

// Sorting rows on the row field "sortOrder" if it exists
Order.prototype.sortRows = function sortRows() {
	if (!this.rows || this.rows.length === 0) return;

	this.rows.sort(function (a, b) {
		const ax = Number(Array.isArray(a.sortOrder) ? a.sortOrder[0] : a.sortOrder);
		const bx = Number(Array.isArray(b.sortOrder) ? b.sortOrder[0] : b.sortOrder);

		if (ax === bx) return 0;

		if (isNaN(ax) && !isNaN(bx)) return 1;
		if (isNaN(bx) && !isNaN(ax)) return -1;

		return ax - bx;
	});

	// Remove all sortOrder fields
	for (let i = 0; this.rows[i] !== undefined; i++) {
		delete this.rows[i].sortOrder;
	}
};

exports = module.exports = Order;
